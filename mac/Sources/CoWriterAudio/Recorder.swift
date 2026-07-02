// ============================================================
// Recorder.swift — record the master mix (+ the un-monitored
// input, software-mixed in) to an .m4a (AAC) in
// ~/Music/GuitarCowriter/.
//
// The master tap provides the file's clock; input buffers are
// gain-scaled (AudioChannel.input volume), resampled to the
// master rate if needed, and pulled from a FIFO into each
// master buffer before writing. Alignment is loose (a few ms) —
// fine for v1 idea-capture takes.
// ============================================================
import AVFoundation
import Accelerate
import Foundation

@MainActor
public final class Recorder {

    private let engine: CoWriterEngine
    private var session: RecordingSession?

    public init(engine: CoWriterEngine) {
        self.engine = engine
    }

    /// Recorder over the shared engine.
    public convenience init() {
        self.init(engine: .shared)
    }

    public var isRecording: Bool { session != nil }

    /// Start a new take. Starts the engine if needed. Returns the file URL
    /// the take is being written to.
    @discardableResult
    public func startRecording() throws -> URL {
        if isRecording { _ = stopRecording() }
        try engine.start()

        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Music/GuitarCowriter", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let stamp = Self.timestampFormatter.string(from: Date())
        let url = dir.appendingPathComponent("take-\(stamp).m4a")

        let masterFormat = engine.avEngine.mainMixerNode.outputFormat(forBus: 0)
        guard masterFormat.sampleRate > 0, masterFormat.channelCount > 0 else {
            throw CoWriterAudioError.formatUnavailable
        }

        let s = try RecordingSession(url: url, format: masterFormat, inputGain: engine.inputGain)
        s.masterID = engine.masterHub.add { [weak s] buffer, _ in s?.writeMaster(buffer) }
        s.inputID = engine.inputHub.add { [weak s] buffer, _ in s?.pushInput(buffer) }
        session = s
        return url
    }

    /// Finish the take and return its URL (nil if nothing was recording).
    @discardableResult
    public func stopRecording() -> URL? {
        guard let s = session else { return nil }
        session = nil
        if let id = s.masterID { engine.masterHub.remove(id) }
        if let id = s.inputID { engine.inputHub.remove(id) }
        return s.finish()
    }

    private static let timestampFormatter: DateFormatter = {
        let df = DateFormatter()
        df.dateFormat = "yyyyMMdd-HHmmss"
        return df
    }()
}

/// @unchecked Sendable: fed from two audio tap threads (master + input) and
/// finished from the main actor; all mutable state is only touched under `lock`.
final class RecordingSession: @unchecked Sendable {

    let url: URL
    var masterID: UUID?
    var inputID: UUID?

    private let lock = NSLock()
    private var file: AVAudioFile?
    private let inputGain: AtomicFloat
    private let dstRate: Double
    private var fifo: [Float] = []   // mono input, at the master sample rate
    private var closed = false

    init(url: URL, format: AVAudioFormat, inputGain: AtomicFloat) throws {
        self.url = url
        self.inputGain = inputGain
        self.dstRate = format.sampleRate
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: format.sampleRate,
            AVNumberOfChannelsKey: format.channelCount,
            AVEncoderBitRateKey: 192_000,
        ]
        self.file = try AVAudioFile(forWriting: url, settings: settings,
                                    commonFormat: .pcmFormatFloat32, interleaved: false)
    }

    /// Input tap consumer: gain-scale, (naively) resample to the master rate,
    /// enqueue mono samples for mixing into the next master buffers.
    func pushInput(_ buffer: AVAudioPCMBuffer) {
        guard let ch = buffer.floatChannelData else { return }
        let n = Int(buffer.frameLength)
        let srcRate = buffer.format.sampleRate
        guard n > 0, srcRate > 0 else { return }

        var mono = [Float](repeating: 0, count: n)
        memcpy(&mono, ch[0], n * MemoryLayout<Float>.size)
        var g = inputGain.value
        if g != 1 {
            vDSP_vsmul(mono, 1, &g, &mono, 1, vDSP_Length(n))
        }

        let out: [Float]
        if abs(srcRate - dstRate) < 1 {
            out = mono
        } else {
            // Linear-interpolation resample; per-buffer (no cross-buffer
            // continuity) — inaudible for v1 idea-capture takes.
            let ratio = dstRate / srcRate
            let outN = max(1, Int(Double(n) * ratio))
            var res = [Float](repeating: 0, count: outN)
            for i in 0..<outN {
                let pos = Double(i) / ratio
                let i0 = min(Int(pos), n - 1)
                let i1 = min(i0 + 1, n - 1)
                let frac = Float(pos - Double(i0))
                res[i] = mono[i0] + (mono[i1] - mono[i0]) * frac
            }
            out = res
        }

        lock.lock()
        if !closed {
            fifo.append(contentsOf: out)
            let cap = Int(dstRate * 5)  // never buffer more than ~5s of input
            if fifo.count > cap { fifo.removeFirst(fifo.count - cap) }
        }
        lock.unlock()
    }

    /// Master tap consumer: copy the buffer, add queued input, write to disk.
    func writeMaster(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        defer { lock.unlock() }
        guard !closed, let file else { return }
        let n = Int(buffer.frameLength)
        guard n > 0, let src = buffer.floatChannelData,
              let copy = AVAudioPCMBuffer(pcmFormat: buffer.format,
                                          frameCapacity: buffer.frameLength) else { return }
        copy.frameLength = buffer.frameLength
        let channels = Int(buffer.format.channelCount)
        guard let dst = copy.floatChannelData else { return }
        for c in 0..<channels {
            memcpy(dst[c], src[c], n * MemoryLayout<Float>.size)
        }

        let take = min(n, fifo.count)
        if take > 0 {
            fifo.withUnsafeBufferPointer { fb in
                for c in 0..<channels {
                    vDSP_vadd(dst[c], 1, fb.baseAddress!, 1, dst[c], 1, vDSP_Length(take))
                }
            }
            fifo.removeFirst(take)
        }

        do {
            try file.write(from: copy)
        } catch {
            closed = true  // disk error: stop writing, keep what we have
        }
    }

    /// Close the file (released → header finalized) and return its URL.
    func finish() -> URL {
        lock.lock()
        closed = true
        file = nil
        fifo.removeAll()
        lock.unlock()
        return url
    }
}
