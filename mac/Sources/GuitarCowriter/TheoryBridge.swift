// ============================================================
// TheoryBridge.swift — the app's single seam onto CoWriterKit's
// ported theory engine. PLACEHOLDER implementations below keep
// the app compiling while the port lands; the integration pass
// replaces each body with the real engine call.
// NOTE(integration): replace all bodies marked TODO(engine).
// ============================================================
import Foundation
import CoWriterKit

enum TheoryBridge {
    private static let rootNames = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]
    private static let openMidi = [6: 40, 5: 45, 4: 50, 3: 55, 2: 59, 1: 64]

    static func slotLabel(_ slot: ChordSlot) -> String {
        // TODO(engine): Theory.slotLabel
        let suffix: String
        switch slot.typeKey {
        case "major": suffix = ""
        case "minor": suffix = "m"
        case "dom7": suffix = "7"
        case "maj7": suffix = "maj7"
        case "min7": suffix = "m7"
        case "dim": suffix = "°"
        case "dim7": suffix = "°7"
        case "m7b5": suffix = "m7♭5"
        case "aug": suffix = "+"
        default: suffix = slot.typeKey
        }
        return rootNames[slot.rootIdx % 12] + suffix
    }

    static func inversionCount(_ slot: ChordSlot) -> Int {
        ["maj7", "dom7", "min7", "m7b5", "dim7"].contains(slot.typeKey) ? 4 : 3
    }

    static func songFromChordNames(_ names: [String], bpm: Double, minor: Bool) -> Song {
        // TODO(engine): Theory.songFromChordNames (correct suffix parsing + tonic)
        let slots = names.map { raw -> ChordSlot in
            let name = raw.replacingOccurrences(of: "#", with: "♯")
            let rootTok = String(name.prefix(name.count > 1 && "♯♭b".contains(Array(name)[1]) ? 2 : 1))
                .replacingOccurrences(of: "b", with: "♭")
            let rootIdx = rootNames.firstIndex(of: rootTok) ?? 0
            let rest = String(name.dropFirst(rootTok.count)).lowercased()
            let typeKey: String
            switch rest {
            case "": typeKey = "major"
            case "m", "min", "minor": typeKey = "minor"
            case "7": typeKey = "dom7"
            case "maj7": typeKey = "maj7"
            case "m7", "min7": typeKey = "min7"
            case "dim", "°": typeKey = "dim"
            case "dim7": typeKey = "dim7"
            case "m7b5": typeKey = "m7b5"
            case "aug", "+": typeKey = "aug"
            default: typeKey = "major"
            }
            return ChordSlot(rootIdx: rootIdx, typeKey: typeKey)
        }
        let tonicIdx = slots.first?.rootIdx ?? 0
        return Song(tonicIdx: tonicIdx, mode: minor ? .minor : .major, bpm: bpm,
                    sections: [SongSection(name: "Loop", slots: slots)])
    }

    static func songLengthBeats(_ song: Song) -> Double {
        song.sections.reduce(0) { $0 + $1.slots.reduce(0) { $0 + $1.beats } }
    }

    static func chordDots(song: Song, atBeat: Double) -> [BoardDot] {
        // TODO(engine): slotVoicing → real voicing dots
        []
    }

    static func placeOnNeck(_ events: [NoteEvent]) -> [NoteEvent] {
        // TODO(engine): CoWriterKit placeOnNeck (fret-region continuity)
        events.map { e in
            var e = e
            if e.stringNum == nil || e.fret == nil {
                var best: (s: Int, f: Int, score: Int)? = nil
                for s in stride(from: 6, through: 1, by: -1) {
                    let f = e.midi - (openMidi[s] ?? 40)
                    guard (0...18).contains(f) else { continue }
                    let score = abs(f - 5)
                    if best == nil || score < best!.score { best = (s, f, score) }
                }
                e.stringNum = best?.s
                e.fret = best?.f
            }
            return e
        }
    }

    static func sanitize(_ options: [MelodyOption], song: Song?) -> [MelodyOption] {
        // TODO(engine): role re-classification via classifyPc + monophony clamp
        options.map { opt in
            var opt = opt
            opt.events = placeOnNeck(opt.events.filter { $0.midi >= 36 && $0.midi <= 88 && $0.durBeat > 0 }
                .sorted { $0.startBeat < $1.startBeat })
            return opt
        }
    }

    static func systemPrompt(song: Song?) -> String {
        // TODO(engine): full musical context (romans, chord tones, scale choices)
        var s = """
        You are a warm, momentum-keeping co-writing bandmate for an intermediate guitarist named Aaron. \
        Think out loud concisely; tie every suggestion to chord tones and degrees; name your method as a short \
        teaching label; give 2-3 options each with a one-word character; always end with a small nudge forward. \
        Melodies must be MONOPHONIC note events with startBeat within the loop, durations > 0, midi 52-80 preferred. \
        Use role "target" for chord tones, "bridge" for diatonic passing tones, "color" for outside notes. \
        Leave space — rests are musical.
        """
        if let song {
            let names = song.sections.flatMap { $0.slots }.map { slotLabel($0) }
            s += "\n\nCURRENT LOOP: \(names.joined(separator: " – ")) at \(Int(song.bpm)) bpm, " +
                 "\(rootNames[song.tonicIdx]) \(song.mode.rawValue), \(Int(songLengthBeats(song))) beats total. " +
                 "Each chord lasts 4 beats starting at beats 0, 4, 8, …"
        }
        return s
    }

    static func diffSummary(proposal: [NoteEvent], variant: [NoteEvent]) -> String {
        // TODO(engine): full diff port (pitch/rhythm/add/drop); this is a serviceable v1
        var parts: [String] = []
        let n = min(proposal.count, variant.count)
        for i in 0..<n {
            let dp = variant[i].midi - proposal[i].midi
            if dp != 0 { parts.append("note \(i + 1): played \(dp > 0 ? "+" : "")\(dp) semitones") }
            let dt = variant[i].startBeat - proposal[i].startBeat
            if abs(dt) >= 0.25 { parts.append("note \(i + 1): entrance \(dt > 0 ? "late" : "early") by \(String(format: "%.2g", abs(dt))) beats") }
        }
        if variant.count > proposal.count { parts.append("added \(variant.count - proposal.count) notes") }
        if variant.count < proposal.count { parts.append("dropped \(proposal.count - variant.count) notes") }
        return parts.isEmpty ? "played it essentially as proposed" : parts.joined(separator: "; ")
    }
}
