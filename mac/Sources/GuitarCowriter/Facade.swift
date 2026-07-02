// ============================================================
// Facade.swift — the single integration point between UI and the
// audio layer (CoWriterAudio). UI talks ONLY to this.
// ============================================================
import Foundation
import CoWriterKit
import CoWriterAudio

@MainActor
final class AudioFacade {
    static let shared = AudioFacade()

    private let engine = CoWriterEngine.shared
    private lazy var transport = Transport(engine: engine)
    private var tracker: PitchTracker?
    private var captureT0: Double = 0

    var onBeat: ((Double) -> Void)? {
        didSet { transport.onBeat = onBeat }
    }

    private func ensureStarted() {
        do { try engine.start() } catch {
            NSLog("[facade] engine start failed: \(error)")
        }
    }

    private var currentSong: Song?
    private var melodic: [Phrase] = []
    private(set) var band: Arrangement?

    func applySong(_ song: Song) {
        ensureStarted()
        currentSong = song
        transport.setBpm(song.bpm)
        transport.setSong(chordHits: TheoryBridge.chordHits(song))
        let len = TheoryBridge.songLengthBeats(song)
        transport.setLoop(startBeat: 0, endBeat: len, on: true)
        syncPhrases()
    }

    func setPhrases(_ phrases: [Phrase]) {
        ensureStarted()
        melodic = phrases
        syncPhrases()
    }

    func setBand(_ arr: Arrangement?) {
        band = arr
        syncPhrases()
    }

    private func syncPhrases() {
        let backing = (band != nil && currentSong != nil) ? backingPhrases(currentSong!, band!) : []
        transport.setPhrases(melodic + backing)
    }

    func play(from beat: Double = 0) {
        ensureStarted()
        transport.play(fromBeat: beat)
    }

    func stop() { transport.stop() }

    func setBpm(_ bpm: Double) { transport.setBpm(bpm) }
    func setCountIn(_ on: Bool) { transport.setCountIn(on) }
    func setClick(_ on: Bool) { transport.setClick(on) }

    func pluck(midi: Int) {
        ensureStarted()
        let m = UInt8(clamping: midi)
        engine.send(noteOn: m, vel: 96, to: .backing)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [engine] in
            engine.send(noteOff: m, to: .backing)
        }
    }

    // MARK: mixer / devices / instruments (pass-throughs for future UI)

    private(set) var volumeCache: [AudioChannel: Float] = [.ai: 0.8, .backing: 0.8, .click: 0.8, .master: 0.8, .input: 0]
    func setVolume(_ channel: AudioChannel, _ v: Float) {
        volumeCache[channel] = v
        engine.setVolume(channel, v)
    }
    func rms(_ channel: AudioChannel) -> Float { engine.rms(channel) }
    func inputDevices() -> [AudioInputDevice] { AudioDevices.listInputDevices() }
    func selectInput(_ d: AudioInputDevice?) throws { try engine.selectInput(d) }
    func instruments() -> [InstrumentInfo] { CoWriterEngine.listInstruments() }
    func loadInstrument(_ i: InstrumentInfo?, for voice: Voice) async throws {
        try await engine.loadInstrument(i, for: voice)
    }

    // MARK: capture

    func startCapture() throws {
        ensureStarted()
        let t = PitchTracker(engine: engine)
        try t.start()
        captureT0 = t.timeSec
        tracker = t
    }

    func stopCapture(bpm: Double) -> [NoteEvent] {
        guard let t = tracker else { return [] }
        tracker = nil
        let notes = t.stop()
        return PitchTracker.toEvents(notes, bpm: bpm, t0: captureT0)
    }
}
