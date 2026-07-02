// ============================================================
// Facade.swift — the single integration point between UI and the
// audio layer (CoWriterAudio). UI talks ONLY to this; when the
// audio engine lands, wireEngine() connects the real thing.
// ============================================================
import Foundation
import CoWriterKit

@MainActor
final class AudioFacade {
    static let shared = AudioFacade()

    // wired at integration to CoWriterAudio; stubbed until then
    var onBeat: ((Double) -> Void)?

    private(set) var wired = false

    func applySong(_ song: Song) { /* wired in Integration.swift */ pendingSong = song }
    func setPhrases(_ phrases: [Phrase]) { pendingPhrases = phrases }
    func play(from beat: Double = 0) {}
    func stop() {}
    func setBpm(_ bpm: Double) {}
    func pluck(midi: Int) {}
    func startCapture() throws {}
    func stopCapture(bpm: Double) -> [NoteEvent] { [] }

    // state handed to the real engine when it wires up
    var pendingSong: Song?
    var pendingPhrases: [Phrase] = []
}
