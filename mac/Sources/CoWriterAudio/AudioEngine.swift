// ============================================================
// AudioEngine.swift — the AVAudioEngine "body".
//
// Graph:
//   [ai instrument]      → aiMixer      ┐
//   [backing instrument] → backingMixer ├→ mainMixerNode → output
//   [click sampler]      → clickMixer   ┘
//   inputNode ── (tap only: meters / pitch tracking / recording)
//
// The input is NEVER routed to the output — the user monitors
// through his audio interface. The input node exists in the graph
// solely so it can be tapped.
// ============================================================
import AVFoundation
import Accelerate
import Foundation

// MARK: - Public enums

/// Mixer channels addressable for volume / mute / metering.
public enum AudioChannel: String, CaseIterable, Sendable, Hashable {
    case ai, backing, click, input, master
}

/// Instrument slots the transport plays into.
public enum Voice: String, CaseIterable, Sendable, Hashable {
    case ai, backing
}

public enum CoWriterAudioError: Error, Sendable {
    case inputUnitUnavailable
    case osStatus(OSStatus)
    case formatUnavailable
    case notRecording
}

// MARK: - Audio-thread-safe helpers

/// A single Float guarded by a lock. @unchecked Sendable: all access
/// goes through `value`, which takes `lock`.
final class AtomicFloat: @unchecked Sendable {
    private let lock = NSLock()
    private var v: Float
    init(_ v: Float) { self.v = v }
    var value: Float {
        get { lock.lock(); defer { lock.unlock() }; return v }
        set { lock.lock(); v = newValue; lock.unlock() }
    }
}

/// Per-channel RMS store written from audio-tap threads, read from the UI.
/// @unchecked Sendable: the dictionary is only touched under `lock`.
final class MeterStore: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [AudioChannel: Float] = [:]
    func set(_ c: AudioChannel, _ v: Float) { lock.lock(); values[c] = v; lock.unlock() }
    func get(_ c: AudioChannel) -> Float { lock.lock(); defer { lock.unlock() }; return values[c] ?? 0 }
    func reset() { lock.lock(); values.removeAll(); lock.unlock() }
}

/// Fan-out for a single AVAudioNode tap (a node allows only one tap per bus).
/// Consumers (meter, pitch tracker, recorder) register handlers; `broadcast`
/// is called from the audio tap thread. @unchecked Sendable: the registry is
/// only touched under `lock`; handlers themselves must be audio-thread-safe.
final class TapHub: @unchecked Sendable {
    private let lock = NSLock()
    private var consumers: [UUID: (AVAudioPCMBuffer, AVAudioTime) -> Void] = [:]

    @discardableResult
    func add(_ handler: @escaping (AVAudioPCMBuffer, AVAudioTime) -> Void) -> UUID {
        let id = UUID()
        lock.lock(); consumers[id] = handler; lock.unlock()
        return id
    }

    func remove(_ id: UUID) {
        lock.lock(); consumers.removeValue(forKey: id); lock.unlock()
    }

    func broadcast(_ buffer: AVAudioPCMBuffer, _ time: AVAudioTime) {
        lock.lock(); let list = Array(consumers.values); lock.unlock()
        for h in list { h(buffer, time) }
    }
}

// MARK: - Engine

@MainActor
public final class CoWriterEngine {

    /// App-wide default instance (injectable elsewhere for tests/tools).
    public static let shared = CoWriterEngine()

    // Internal graph (module-visible for Instruments/Devices/Recorder extensions).
    let avEngine = AVAudioEngine()
    let aiMixer = AVAudioMixerNode()
    let backingMixer = AVAudioMixerNode()
    let clickMixer = AVAudioMixerNode()

    var instruments: [Voice: AVAudioUnit] = [:]
    var clickSampler: AVAudioUnitSampler?
    var inputEffect: AVAudioUnit?

    /// Fan-outs for the two shared taps (input node, main mixer).
    let inputHub = TapHub()
    let masterHub = TapHub()
    let meters = MeterStore()
    /// Software gain on the input *metering/recording* path only — the input
    /// is never monitored, so this never touches what the user hears.
    let inputGain = AtomicFloat(1.0)

    private var graphBuilt = false
    private var tapsInstalled = false
    private var volumes: [AudioChannel: Float] = [
        .ai: 1, .backing: 0.9, .click: 0.7, .input: 1, .master: 1,
    ]
    private var mutedChannels: Set<AudioChannel> = []

    public init() {}

    public var isRunning: Bool { avEngine.isRunning }

    // MARK: Lifecycle

    /// Build the graph, ensure fallback instruments, start the engine, install taps.
    /// Idempotent; call lazily before any sound-producing operation.
    public func start() throws {
        guard !avEngine.isRunning else { return }
        buildGraphIfNeeded()
        ensureDefaultInstruments()
        avEngine.prepare()
        try avEngine.start()
        installTaps()
    }

    public func stop() {
        removeTaps()
        avEngine.stop()
    }

    // MARK: Volume / mute / meters

    /// Set a channel's volume [0, 1]. For `.input` this only scales metering
    /// and the recording mix — input is never routed to the speakers.
    public func setVolume(_ channel: AudioChannel, _ v: Float) {
        volumes[channel] = max(0, min(1, v))
        applyVolume(channel)
    }

    public func setMute(_ channel: AudioChannel, _ muted: Bool) {
        if muted { mutedChannels.insert(channel) } else { mutedChannels.remove(channel) }
        applyVolume(channel)
    }

    public func volume(_ channel: AudioChannel) -> Float { volumes[channel] ?? 1 }
    public func isMuted(_ channel: AudioChannel) -> Bool { mutedChannels.contains(channel) }

    /// Most recent RMS level of a channel (written by the audio taps).
    /// Callable from any thread — the store is lock-guarded.
    nonisolated public func rms(_ channel: AudioChannel) -> Float {
        meters.get(channel)
    }

    // MARK: Internals — graph

    func buildGraphIfNeeded() {
        guard !graphBuilt else { return }
        graphBuilt = true
        let main = avEngine.mainMixerNode
        avEngine.attach(aiMixer)
        avEngine.attach(backingMixer)
        avEngine.attach(clickMixer)
        avEngine.connect(aiMixer, to: main, fromBus: 0, toBus: main.nextAvailableInputBus, format: nil)
        avEngine.connect(backingMixer, to: main, fromBus: 0, toBus: main.nextAvailableInputBus, format: nil)
        avEngine.connect(clickMixer, to: main, fromBus: 0, toBus: main.nextAvailableInputBus, format: nil)
        // Materialize the input node in the graph. Tap-only — never connected
        // toward the output (no monitoring through the app).
        _ = avEngine.inputNode
        for c in AudioChannel.allCases { applyVolume(c) }
    }

    func mixer(for voice: Voice) -> AVAudioMixerNode {
        switch voice {
        case .ai: return aiMixer
        case .backing: return backingMixer
        }
    }

    private func applyVolume(_ channel: AudioChannel) {
        let eff = mutedChannels.contains(channel) ? 0 : (volumes[channel] ?? 1)
        switch channel {
        case .ai: aiMixer.outputVolume = eff
        case .backing: backingMixer.outputVolume = eff
        case .click: clickMixer.outputVolume = eff
        case .master: avEngine.mainMixerNode.outputVolume = eff
        case .input: inputGain.value = eff   // metering/recording bus only
        }
    }

    // MARK: Internals — taps

    private func installTaps() {
        guard !tapsInstalled else { return }
        tapsInstalled = true

        // Capture only Sendable-safe locals in the tap closures (they run on
        // audio render/tap threads, never on the main actor).
        let meters = self.meters
        let masterHub = self.masterHub
        let inputHub = self.inputHub
        let gain = self.inputGain

        func meterTap(_ node: AVAudioNode, _ channel: AudioChannel) {
            let fmt = node.outputFormat(forBus: 0)
            node.installTap(onBus: 0, bufferSize: 1024, format: fmt) { buffer, _ in
                meters.set(channel, CoWriterEngine.rmsOf(buffer))
            }
        }
        meterTap(aiMixer, .ai)
        meterTap(backingMixer, .backing)
        meterTap(clickMixer, .click)

        let main = avEngine.mainMixerNode
        main.installTap(onBus: 0, bufferSize: 1024, format: main.outputFormat(forBus: 0)) { buffer, time in
            meters.set(.master, CoWriterEngine.rmsOf(buffer))
            masterHub.broadcast(buffer, time)
        }

        let input = avEngine.inputNode
        let inFmt = input.inputFormat(forBus: 0)
        if inFmt.sampleRate > 0 && inFmt.channelCount > 0 {
            // 4096-frame tap: shared by input meter, PitchTracker, Recorder.
            input.installTap(onBus: 0, bufferSize: 4096, format: inFmt) { buffer, time in
                meters.set(.input, CoWriterEngine.rmsOf(buffer) * gain.value)
                inputHub.broadcast(buffer, time)
            }
        }
    }

    private func removeTaps() {
        guard tapsInstalled else { return }
        tapsInstalled = false
        aiMixer.removeTap(onBus: 0)
        backingMixer.removeTap(onBus: 0)
        clickMixer.removeTap(onBus: 0)
        avEngine.mainMixerNode.removeTap(onBus: 0)
        avEngine.inputNode.removeTap(onBus: 0)
        meters.reset()
    }

    /// Restart around a device/graph change: removes taps, stops, runs `body`,
    /// then restarts (and reinstalls taps) if the engine was running.
    func restartAround(_ body: () throws -> Void) throws {
        let wasRunning = avEngine.isRunning
        removeTaps()
        avEngine.stop()
        try body()
        if wasRunning { try start() }
    }

    // MARK: Internals — DSP

    nonisolated static func rmsOf(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let ch = buffer.floatChannelData, buffer.frameLength > 0 else { return 0 }
        var v: Float = 0
        vDSP_rmsqv(ch[0], 1, &v, vDSP_Length(buffer.frameLength))
        return v
    }
}
