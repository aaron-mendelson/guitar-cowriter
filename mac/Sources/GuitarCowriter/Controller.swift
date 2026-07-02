// ============================================================
// Controller.swift — the core bandmate loop:
// intent → brain turn → audition/keep → capture → react.
// Theory calls are wired to CoWriterKit's ported engine at
// integration (see NOTE markers).
// ============================================================
import Foundation
import CoWriterKit

@MainActor
final class Controller {
    let state: AppState
    let brain: BrainClient
    private var history: [ChatMessage] = []

    init(state: AppState) {
        self.state = state
        self.brain = BrainClient(config: state.brainConfig)
    }

    func boot() async {
        AudioFacade.shared.onBeat = { [weak state] beat in
            state?.posBeat = beat
        }
        let healthy = await brain.health()
        if !healthy {
            state.add(.system, "⚠ Can't reach the brain at \(state.brainConfig.url) — check Settings (are you on the tailnet?).")
        }
    }

    // MARK: intent → turn

    func submit(_ text: String) {
        state.add(.user, text)
        state.busy = true
        Task {
            defer { state.busy = false }
            // build/refresh the song from any chords in the text
            let intent = parseIntentFallback(text)
            if !intent.chords.isEmpty {
                let song = makeSong(chords: intent.chords, bpm: intent.bpm ?? state.bpm, minor: intent.minorKey)
                state.song = song
                state.bpm = song.bpm
                AudioFacade.shared.applySong(song)
            }
            await turn(userText: text)
        }
    }

    private func turn(userText: String) async {
        await brain.update(config: state.brainConfig)
        history.append(ChatMessage(role: "user", content: userText))
        if history.count > 20 { history.removeFirst(history.count - 20) }
        do {
            let turn = try await brain.cowriterTurn(system: systemPrompt(), messages: history)
            let encoded = (try? JSONEncoder().encode(turn)).flatMap { String(data: $0, encoding: .utf8) } ?? turn.say
            history.append(ChatMessage(role: "assistant", content: encoded))
            state.add(.ai, turn.say, options: sanitized(turn.options), nudge: turn.nudge)
            if let first = turn.options.first {
                placeOnBoard(first)   // every reply visibly changes the board
            }
        } catch {
            state.add(.system, "⚠ \(error.localizedDescription)")
        }
    }

    // MARK: options → board/loop

    func audition(_ opt: MelodyOption) {
        placeOnBoard(opt)
        if !state.playing { playStop() }
    }

    func keep(_ opt: MelodyOption) {
        placeOnBoard(opt)
        state.add(.system, "Kept: \(opt.character) (\(opt.method))")
    }

    private func placeOnBoard(_ opt: MelodyOption) {
        let length = state.song.map { songLength($0) } ?? 16
        let phrase = Phrase(label: "\(opt.character) · \(opt.method)",
                            lengthBeats: length,
                            events: placeEvents(opt.events),
                            voice: .ai, method: opt.method)
        state.activePhrase = phrase
        AudioFacade.shared.setPhrases([phrase])
    }

    // MARK: transport

    func playStop() {
        if state.playing {
            AudioFacade.shared.stop()
            state.playing = false
            state.posBeat = 0
        } else {
            AudioFacade.shared.play(from: 0)
            state.playing = true
        }
    }

    // MARK: capture → diff → react

    func captureToggle() {
        if !state.listening {
            do {
                try AudioFacade.shared.startCapture()
                state.listening = true
                state.add(.system, "Listening — play your take, then tap again.")
            } catch {
                state.add(.system, "⚠ Couldn't open the input: \(error.localizedDescription)")
            }
            return
        }
        state.listening = false
        let events = AudioFacade.shared.stopCapture(bpm: state.bpm)
        guard !events.isEmpty else {
            state.add(.system, "Didn't catch any notes — check the input device and try again.")
            return
        }
        let length = state.song.map { songLength($0) } ?? 16
        state.userPhrase = Phrase(label: "your take", lengthBeats: length, events: placeEvents(events), voice: .user)
        state.add(.system, "Heard \(events.count) notes.")
        if let proposal = state.activePhrase {
            let summary = diffSummary(proposal: proposal.events, variant: events)
            state.busy = true
            Task {
                defer { state.busy = false }
                await turn(userText: "I played your line back with these changes: \(summary) — react to my variation as creative intent; if you like a change, lean into it. Propose ONE refined option.")
            }
        }
    }

    // MARK: - Theory hooks (wired to CoWriterKit port at integration)

    func slotName(_ slot: ChordSlot) -> String {
        TheoryBridge.slotLabel(slot)
    }
    func inversionCount(_ slot: ChordSlot) -> Int {
        TheoryBridge.inversionCount(slot)
    }
    func setInversion(section: Int, slot: Int, inv: Int) {
        guard var song = state.song else { return }
        song.sections[section].slots[slot].invIdx = inv
        state.song = song
        AudioFacade.shared.applySong(song)
    }
    func chordDots() -> [BoardDot] {
        guard let song = state.song else { return [] }
        return TheoryBridge.chordDots(song: song, atBeat: state.playing ? state.posBeat : 0)
    }
    private func makeSong(chords: [String], bpm: Double, minor: Bool) -> Song {
        TheoryBridge.songFromChordNames(chords, bpm: bpm, minor: minor)
    }
    private func songLength(_ song: Song) -> Double { TheoryBridge.songLengthBeats(song) }
    private func placeEvents(_ events: [NoteEvent]) -> [NoteEvent] { TheoryBridge.placeOnNeck(events) }
    private func sanitized(_ options: [MelodyOption]) -> [MelodyOption] { TheoryBridge.sanitize(options, song: state.song) }
    private func systemPrompt() -> String { TheoryBridge.systemPrompt(song: state.song) }
    private func diffSummary(proposal: [NoteEvent], variant: [NoteEvent]) -> String {
        TheoryBridge.diffSummary(proposal: proposal, variant: variant)
    }
}
