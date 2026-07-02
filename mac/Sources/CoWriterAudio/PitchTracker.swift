// ============================================================
// PitchTracker.swift — monophonic pitch + onset tracking from the
// engine's input tap. Port of src/listen/pitchTrack.ts semantics:
//   - clarity threshold 0.9, RMS gate 0.01
//   - new-semitone requires 2 consecutive frames
//   - notes shorter than 0.09s are discarded
//   - final midi/cents are medians over the note's frames
// Pitch detection is a normalized autocorrelation (McLeod NSDF)
// via Accelerate/vDSP — same approach as the web app's `pitchy`.
// ============================================================
import AVFoundation
import Accelerate
import CoWriterKit
import Foundation

public struct TrackedNote: Sendable, Equatable {
    public let midi: Int
    public let cents: Int
    public let startSec: Double
    public let durSec: Double
    public let rms: Double

    public init(midi: Int, cents: Int, startSec: Double, durSec: Double, rms: Double) {
        self.midi = midi
        self.cents = cents
        self.startSec = startSec
        self.durSec = durSec
        self.rms = rms
    }
}

public struct PitchTrackerOptions: Sendable {
    /// RMS gate below which input is treated as silence.
    public var minRms: Double = 0.01
    /// Notes shorter than this are discarded.
    public var minDurSec: Double = 0.09
    /// Inclusive MIDI range accepted (guitar-ish).
    public var midiRange: ClosedRange<Int> = 40...88
    /// NSDF clarity required to accept a pitch frame.
    public var clarityThreshold: Double = 0.9
    public init() {}
}

/// @unchecked Sendable: `process()` runs on the audio tap thread while the
/// public API runs on the main actor; every piece of mutable state is only
/// touched while holding `lock`.
public final class PitchTracker: @unchecked Sendable {

    private struct Frame {
        let midi: Int
        let cents: Int
        let rms: Double
        let tSec: Double
    }

    private struct Active {
        var frames: [Frame]
        var startSec: Double
        var lastSec: Double
    }

    private let engine: CoWriterEngine
    private let opts: PitchTrackerOptions
    private let lock = NSLock()

    // -- lock-guarded state --
    private var consumerID: UUID?
    private var framesSeen: Double = 0
    private var sampleRate: Double = 0
    private var active: Active?
    private var pendingNote: (midi: Int, frames: [Frame])?
    private var finalized: [TrackedNote] = []
    private var instant: (midi: Int?, cents: Int, rms: Double) = (nil, 0, 0)
    private var _onNote: ((TrackedNote) -> Void)?

    @MainActor
    public init(engine: CoWriterEngine, options: PitchTrackerOptions = .init()) {
        self.engine = engine
        self.opts = options
    }

    /// Tracker on the shared engine's input.
    @MainActor
    public convenience init(options: PitchTrackerOptions = .init()) {
        self.init(engine: .shared, options: options)
    }

    /// Called (on the main queue) each time a note finalizes (note-off detected).
    public var onNote: ((TrackedNote) -> Void)? {
        get { lock.lock(); defer { lock.unlock() }; return _onNote }
        set { lock.lock(); _onNote = newValue; lock.unlock() }
    }

    /// Seconds of input processed since start() — the clock `startSec`/`t0` live on.
    public var timeSec: Double {
        lock.lock(); defer { lock.unlock() }
        return sampleRate > 0 ? framesSeen / sampleRate : 0
    }

    /// Begin listening on the engine's shared input tap. Idempotent.
    @MainActor
    public func start() throws {
        lock.lock()
        let already = consumerID != nil
        if !already {
            framesSeen = 0
            active = nil
            pendingNote = nil
            finalized = []
            instant = (nil, 0, 0)
        }
        lock.unlock()
        guard !already else { return }
        try engine.start()
        let id = engine.inputHub.add { [weak self] buffer, _ in
            self?.process(buffer)
        }
        lock.lock(); consumerID = id; lock.unlock()
    }

    /// Stop listening, finalize any in-flight note, return all finalized notes.
    @MainActor
    @discardableResult
    public func stop() -> [TrackedNote] {
        lock.lock()
        let id = consumerID
        consumerID = nil
        lock.unlock()
        if let id { engine.inputHub.remove(id) }

        lock.lock()
        let now = sampleRate > 0 ? framesSeen / sampleRate : 0
        _ = finalizeActiveLocked(endSec: now)
        pendingNote = nil
        let out = finalized
        lock.unlock()
        return out
    }

    /// Instantaneous reading for a live tuner-style UI. midi is nil on silence/noise.
    public func current() -> (midi: Int?, cents: Int, rms: Double) {
        lock.lock(); defer { lock.unlock() }
        return instant
    }

    /// TrackedNotes (seconds on this tracker's clock) → NoteEvents (beats on a
    /// grid), relative to t0. Same semantics as src/listen/quantize.ts;
    /// role is .target as a placeholder — the caller re-classifies harmonically.
    public static func toEvents(_ notes: [TrackedNote], bpm: Double, t0: Double,
                                grid: Double = 0.25) -> [NoteEvent] {
        var out: [NoteEvent] = []
        for n in notes {
            guard let q = PureTiming.quantize(startSec: n.startSec, durSec: n.durSec,
                                              bpm: bpm, t0Sec: t0, grid: grid) else { continue }
            out.append(NoteEvent(midi: n.midi, startBeat: q.startBeat,
                                 durBeat: q.durBeat, role: .target))
        }
        return out.sorted { $0.startBeat < $1.startBeat }
    }

    // MARK: Audio-thread processing

    private func process(_ buffer: AVAudioPCMBuffer) {
        guard let ch = buffer.floatChannelData else { return }
        let frames = Int(buffer.frameLength)
        guard frames > 0 else { return }
        let n = min(frames, 4096)
        let sr = buffer.format.sampleRate
        guard sr > 0 else { return }

        var rms: Float = 0
        vDSP_rmsqv(ch[0], 1, &rms, vDSP_Length(n))

        // Advance the tracker clock (frames → seconds).
        lock.lock()
        sampleRate = sr
        framesSeen += Double(frames)
        let now = framesSeen / sr
        lock.unlock()

        var midi: Int?
        var cents = 0
        if Double(rms) > opts.minRms {
            let (freq, clarity) = Self.detectPitch(ch[0], count: n, sampleRate: sr)
            if clarity >= opts.clarityThreshold, freq > 0 {
                let conv = PureTiming.freqToMidiCents(freq)
                if opts.midiRange.contains(conv.midi) {
                    midi = conv.midi
                    cents = conv.cents
                }
            }
        }

        var fired: [TrackedNote] = []
        lock.lock()
        instant = (midi, cents, Double(rms))
        if let midi {
            let frame = Frame(midi: midi, cents: cents, rms: Double(rms), tSec: now)
            if active == nil {
                active = Active(frames: [frame], startSec: now, lastSec: now)
                pendingNote = nil
            } else {
                let activeMidi = Int(PureTiming.median(active!.frames.map { Double($0.midi) }).rounded())
                if abs(midi - activeMidi) >= 1 {
                    // Possible new note — require 2 consecutive frames at the new semitone.
                    if pendingNote?.midi == midi {
                        pendingNote!.frames.append(frame)
                        if pendingNote!.frames.count >= 2 {
                            let newStart = pendingNote!.frames[0].tSec
                            if let done = finalizeActiveLocked(endSec: newStart) { fired.append(done) }
                            active = Active(frames: pendingNote!.frames,
                                            startSec: newStart, lastSec: now)
                            pendingNote = nil
                        }
                    } else {
                        pendingNote = (midi, [frame])
                    }
                } else {
                    // Same semitone — continue the active note.
                    pendingNote = nil
                    active!.frames.append(frame)
                    active!.lastSec = now
                }
            }
        } else {
            // Silence / noise / out of range → note-off for any active note.
            if let done = finalizeActiveLocked(endSec: now) { fired.append(done) }
            pendingNote = nil
        }
        let cb = _onNote
        lock.unlock()

        if !fired.isEmpty, let cb {
            DispatchQueue.main.async {
                for note in fired { cb(note) }
            }
        }
    }

    /// Must be called with `lock` held.
    private func finalizeActiveLocked(endSec: Double) -> TrackedNote? {
        guard let note = active else { return nil }
        active = nil
        let durSec = max(endSec, note.lastSec) - note.startSec
        guard durSec >= opts.minDurSec else { return nil }

        let finalMidi = Int(PureTiming.median(note.frames.map { Double($0.midi) }).rounded())
        let matching = note.frames.filter { $0.midi == finalMidi }
        let centsSrc = matching.isEmpty ? note.frames : matching
        let finalCents = Int(PureTiming.median(centsSrc.map { Double($0.cents) }).rounded())
        let meanRms = note.frames.reduce(0.0) { $0 + $1.rms } / Double(note.frames.count)

        let tracked = TrackedNote(midi: finalMidi, cents: finalCents,
                                  startSec: note.startSec, durSec: durSec, rms: meanRms)
        finalized.append(tracked)
        return tracked
    }

    // MARK: NSDF pitch detection (McLeod pitch method, vDSP-accelerated)

    /// Returns (frequency Hz, clarity 0…1). clarity 0 means no pitch found.
    static func detectPitch(_ x: UnsafePointer<Float>, count n: Int, sampleRate: Double,
                            minFreq: Double = 70, maxFreq: Double = 1500)
        -> (freq: Double, clarity: Double) {
        guard n >= 256, sampleRate > 0 else { return (0, 0) }

        // Prefix sums of x^2 for the NSDF normalizer m(tau).
        var sq = [Float](repeating: 0, count: n)
        vDSP_vsq(x, 1, &sq, 1, vDSP_Length(n))
        var prefix = [Double](repeating: 0, count: n + 1)
        var running = 0.0
        for i in 0..<n {
            running += Double(sq[i])
            prefix[i + 1] = running
        }
        guard running > 0 else { return (0, 0) }

        let minTau = max(2, Int(sampleRate / maxFreq))
        let maxTau = min(n - 2, Int(sampleRate / minFreq))
        guard maxTau > minTau + 2 else { return (0, 0) }

        // nsdf(tau) = 2*r(tau) / (m(tau)), r via vDSP dot products.
        var nsdf = [Double](repeating: 0, count: maxTau + 1)
        for tau in minTau...maxTau {
            var r: Float = 0
            vDSP_dotpr(x, 1, x + tau, 1, &r, vDSP_Length(n - tau))
            let m = prefix[n - tau] + (running - prefix[tau])
            nsdf[tau] = m > 0 ? 2.0 * Double(r) / m : 0
        }

        // Key-maxima picking: skip the initial positive lobe, collect the local
        // max of each positive region, choose the first one >= 0.9 * global max.
        var i = minTau
        while i <= maxTau && nsdf[i] > 0 { i += 1 }
        var maxima: [(tau: Int, val: Double)] = []
        var best = 0.0
        while i < maxTau {
            if nsdf[i] > 0 {
                var peakTau = i
                var peakVal = nsdf[i]
                while i < maxTau && nsdf[i] > 0 {
                    if nsdf[i] > peakVal {
                        peakVal = nsdf[i]
                        peakTau = i
                    }
                    i += 1
                }
                maxima.append((peakTau, peakVal))
                best = max(best, peakVal)
            } else {
                i += 1
            }
        }
        guard best > 0, let chosen = maxima.first(where: { $0.val >= 0.9 * best }) else {
            return (0, 0)
        }

        // Parabolic interpolation around the chosen peak for sub-sample tau.
        var refined = Double(chosen.tau)
        if chosen.tau > minTau && chosen.tau < maxTau {
            let a = nsdf[chosen.tau - 1]
            let b = nsdf[chosen.tau]
            let c = nsdf[chosen.tau + 1]
            let denom = a - 2 * b + c
            if abs(denom) > 1e-12 {
                refined = Double(chosen.tau) + 0.5 * (a - c) / denom
            }
        }
        guard refined > 0 else { return (0, 0) }
        return (sampleRate / refined, chosen.val)
    }
}
