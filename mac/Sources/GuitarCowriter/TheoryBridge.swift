// ============================================================
// TheoryBridge.swift — the app's single seam onto CoWriterKit's
// ported theory engine (now fully wired to the real port).
// ============================================================
import Foundation
import CoWriterKit

enum TheoryBridge {
    private static let noteNames = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]

    static func slotLabel(_ slot: ChordSlot) -> String {
        CoWriterKit.slotLabel(slot)
    }

    static func inversionCount(_ slot: ChordSlot) -> Int {
        Theory.CHORDS[slot.typeKey]?.n ?? 3
    }

    static func songFromChordNames(_ names: [String], bpm: Double, minor: Bool) -> Song {
        // probe parse to find the first chord's root → tonic (mirrors web frameToSong)
        let probe = CoWriterKit.songFromChordNames(names, tonicIdx: 0, mode: .major, bpm: bpm)
        let first = probe.sections.first?.slots.first
        let tonicIdx = first?.rootIdx ?? 0
        let mode: KeyMode = minor || (first.map { $0.typeKey == "minor" || $0.typeKey == "min7" } ?? false) ? .minor : .major
        return CoWriterKit.songFromChordNames(names, tonicIdx: tonicIdx, mode: mode, bpm: bpm)
    }

    static func songLengthBeats(_ song: Song) -> Double {
        CoWriterKit.songLengthBeats(song)
    }

    /// The governing chord's voicing as subdued board dots.
    static func chordDots(song: Song, atBeat: Double) -> [BoardDot] {
        let entry = chordAtBeat(song, atBeat)
        let v = slotVoicing(entry.slot)
        return v.dots.map {
            BoardDot(stringNum: $0.stringNum, fret: $0.fret, label: $0.tone.name,
                     fill: Palette.faint, ring: nil)
        }
    }

    /// Chord hits for the transport's backing strums.
    static func chordHits(_ song: Song) -> [(startBeat: Double, midis: [Int], beats: Double)] {
        songTimeline(song).map { entry in
            (startBeat: entry.startBeat, midis: slotVoicing(entry.slot).midis, beats: entry.slot.beats)
        }
    }

    static func placeOnNeck(_ events: [NoteEvent]) -> [NoteEvent] {
        CoWriterKit.placeOnNeck(events, preferFret: 5)
    }

    /// Engine sanitization — never trust the model's roles/timing (port of sanitizeTurn).
    static func sanitize(_ options: [MelodyOption], song: Song?) -> [MelodyOption] {
        options.prefix(3).map { opt in
            var opt = opt
            var events = opt.events
                .filter { $0.midi >= 36 && $0.midi <= 88 && $0.durBeat > 0 && $0.startBeat >= 0 }
                .sorted { $0.startBeat < $1.startBeat }
            if let song {
                let len = CoWriterKit.songLengthBeats(song)
                let tonic = Theory.ROOTS[song.tonicIdx]
                events = events.map { e in
                    var e = e
                    if len > 0, e.startBeat >= len { e.startBeat = e.startBeat.truncatingRemainder(dividingBy: len) }
                    let entry = chordAtBeat(song, e.startBeat)
                    let chord = ChordRef(root: slotRoot(entry.slot), typeKey: entry.slot.typeKey)
                    e.role = Theory.classifyPc(((e.midi % 12) + 12) % 12, chord: chord, tonic: tonic, mode: song.mode)
                    if len > 0 { e.durBeat = min(e.durBeat, len - e.startBeat) }
                    return e
                }
                .sorted { $0.startBeat < $1.startBeat }
            }
            // monophony: truncate overlaps
            for i in 0..<max(0, events.count - 1) {
                let nextStart = events[i + 1].startBeat
                if events[i].startBeat + events[i].durBeat > nextStart {
                    events[i].durBeat = max(0.25, nextStart - events[i].startBeat)
                }
            }
            opt.events = CoWriterKit.placeOnNeck(events, preferFret: 5)
            return opt
        }
    }

    /// Full musical context for the co-writer (port of cowriterPrompt.ts core).
    static func systemPrompt(song: Song?) -> String {
        var s = """
        You are a warm, momentum-keeping co-writing bandmate for an intermediate guitarist named Aaron. \
        Think out loud concisely. Tie every suggestion to chord tones and degrees. Name your method as a short \
        teaching label. Offer 2-3 options, each with a one-word character (e.g. "sparse", "hopeful", "bluesy"). \
        Always end with a small nudge forward. Never overwhelm.

        OUTPUT RULES for note events: melody is MONOPHONIC (no overlaps); startBeat within [0, loop length); \
        durations > 0; prefer midi 52-80; land chord tones ("target") on strong beats; connect with diatonic \
        passing tones ("bridge"); outside notes are deliberate spice ("color"). LEAVE SPACE — rests are musical.
        """
        guard let song else { return s }
        let tonic = Theory.ROOTS[song.tonicIdx]
        let len = CoWriterKit.songLengthBeats(song)
        s += "\n\nKEY: \(tonic.name) \(song.mode.rawValue) · \(Int(song.bpm)) bpm · loop \(Int(len)) beats\nTHE CHANGES:"
        for entry in songTimeline(song) {
            let slot = entry.slot
            let root = slotRoot(slot)
            let chord = ChordRef(root: root, typeKey: slot.typeKey)
            let roman = Theory.romanInKey(root, slot.typeKey, tonic, song.mode) ?? "·"
            let tones = Theory.chordTones(root, slot.typeKey).tones
                .map { "\($0.name)(\($0.deg))" }.joined(separator: " ")
            let guide = Theory.chordTones(root, slot.typeKey).tones[1]
            let choices = Theory.chordScaleChoices(chord, tonic: tonic, mode: song.mode)
                .map { c in "\(c.label)\(c.outside ? " [OUTSIDE]" : "") — \(c.why)" }
                .joined(separator: " | ")
            s += "\n• beat \(Int(entry.startBeat)), \(Int(slot.beats)) beats: \(CoWriterKit.slotLabel(slot)) (\(roman)) — tones \(tones); guide tone \(guide.name); scales: \(choices)"
        }
        return s
    }

    /// Musical diff summary (compact port of src/listen/diff.ts).
    static func diffSummary(proposal: [NoteEvent], variant: [NoteEvent]) -> String {
        var parts: [String] = []
        var usedVariant = Set<Int>()
        let beatTol = 0.6
        func name(_ midi: Int) -> String { noteNames[((midi % 12) + 12) % 12] + "\(midi / 12 - 1)" }

        for (pi, p) in proposal.enumerated() {
            // nearest unused variant note within tolerance
            var best: (vi: Int, d: Double)? = nil
            for (vi, v) in variant.enumerated() where !usedVariant.contains(vi) {
                let d = abs(v.startBeat - p.startBeat)
                if d <= beatTol && (best == nil || d < best!.d) { best = (vi, d) }
            }
            guard let match = best else {
                parts.append("dropped note \(pi + 1) (\(name(p.midi)))")
                continue
            }
            usedVariant.insert(match.vi)
            let v = variant[match.vi]
            let dSemi = v.midi - p.midi
            if dSemi != 0 {
                parts.append("note \(pi + 1): played \(name(v.midi)) instead of \(name(p.midi)) (\(dSemi > 0 ? "+" : "")\(dSemi) semitones)")
            }
            let dBeat = v.startBeat - p.startBeat
            if abs(dBeat) >= 0.25 {
                parts.append("note \(pi + 1): entrance \(dBeat > 0 ? "delayed" : "rushed") by \(String(format: "%.2g", abs(dBeat))) beats")
            }
            if abs(v.durBeat - p.durBeat) >= 0.5 {
                parts.append("note \(pi + 1): held \(v.durBeat > p.durBeat ? "longer" : "shorter")")
            }
        }
        for (vi, v) in variant.enumerated() where !usedVariant.contains(vi) {
            parts.append("added a note (\(name(v.midi)))")
        }
        return parts.isEmpty ? "played it essentially as proposed" : parts.joined(separator: "; ")
    }
}
