// ============================================================
// Progression.swift — song / section / chord-slot helpers.
// Faithful port of src/engine/progression.ts, consuming the
// ChordSlot / SongSection / Song types from Core.swift.
// ============================================================
import Foundation

public func slotRoot(_ slot: ChordSlot) -> Root {
    Theory.ROOTS[slot.rootIdx]
}

public func slotLabel(_ slot: ChordSlot) -> String {
    let suffix: String
    switch slot.typeKey {
    case "major": suffix = ""
    case "minor": suffix = "m"
    case "dim":   suffix = "°"
    case "aug":   suffix = "+"
    case "maj7":  suffix = "maj7"
    case "dom7":  suffix = "7"
    case "min7":  suffix = "m7"
    case "m7b5":  suffix = "m7♭5"
    case "dim7":  suffix = "°7"
    default:      suffix = Theory.CHORDS[slot.typeKey]!.label
    }
    return slotRoot(slot).name + suffix
}

/// One fretted dot of a slot voicing.
public struct VoicingDot: Sendable {
    public let stringNum: Int
    public let fret: Int
    public let pc: Int
    public let tone: ChordTone
    public let midi: Int
    public init(stringNum: Int, fret: Int, pc: Int, tone: ChordTone, midi: Int) {
        self.stringNum = stringNum; self.fret = fret; self.pc = pc; self.tone = tone; self.midi = midi
    }
}

public struct SlotVoicing: Sendable {
    public let strings: [Int]
    public let dots: [VoicingDot]
    public let midis: [Int]
    public let topMidi: Int
    public init(strings: [Int], dots: [VoicingDot], midis: [Int], topMidi: Int) {
        self.strings = strings; self.dots = dots; self.midis = midis; self.topMidi = topMidi
    }
}

/// Fretted voicing (string/fret/midi dots) for a slot.
public func slotVoicing(_ slot: ChordSlot) -> SlotVoicing {
    let root = slotRoot(slot)
    let byPc = Theory.chordTones(root, slot.typeKey).byPc
    let voicings = Theory.buildVoicings(root, slot.typeKey)
    let sets = Theory.setsFor(slot.typeKey)
    let strings = sets[min(slot.setIdx, sets.count - 1)]
    let pcs = voicings[min(slot.invIdx, voicings.count - 1)]
    let frets = Theory.shape(strings, pcs)
    let dots = pcs.enumerated().map { i, pc in
        VoicingDot(
            stringNum: strings[i],
            fret: frets[i],
            pc: pc,
            tone: byPc[pc]!,
            midi: Theory.OPEN[strings[i]]! + frets[i]
        )
    }
    return SlotVoicing(strings: strings, dots: dots, midis: dots.map { $0.midi }, topMidi: dots[dots.count - 1].midi)
}

/// One entry of the flattened song timeline.
public struct TimelineEntry: Sendable {
    public let slot: ChordSlot
    public let sectionIdx: Int
    public let startBeat: Double
    public init(slot: ChordSlot, sectionIdx: Int, startBeat: Double) {
        self.slot = slot; self.sectionIdx = sectionIdx; self.startBeat = startBeat
    }
}

/// Flattened timeline: each slot with absolute startBeat.
public func songTimeline(_ song: Song) -> [TimelineEntry] {
    var out: [TimelineEntry] = []
    var t: Double = 0
    for (sectionIdx, section) in song.sections.enumerated() {
        for slot in section.slots {
            out.append(TimelineEntry(slot: slot, sectionIdx: sectionIdx, startBeat: t))
            t += slot.beats
        }
    }
    return out
}

public func songLengthBeats(_ song: Song) -> Double {
    song.sections.reduce(0) { n, s in n + s.slots.reduce(0) { m, sl in m + sl.beats } }
}

/// Which chord governs a given beat position (wraps around the loop).
public func chordAtBeat(_ song: Song, _ beat: Double) -> TimelineEntry {
    let tl = songTimeline(song)
    let total = songLengthBeats(song)
    let b = (beat.truncatingRemainder(dividingBy: total) + total).truncatingRemainder(dividingBy: total)
    for entry in tl.reversed() where b >= entry.startBeat {
        return entry
    }
    return tl[0]
}

public func serializeSong(_ song: Song) throws -> String {
    String(data: try JSONEncoder().encode(song), encoding: .utf8) ?? "{}"
}

public func deserializeSong(_ s: String) throws -> Song {
    try JSONDecoder().decode(Song.self, from: Data(s.utf8))
}

/// Convenience: build a one-section song from chord names like "C Am F G".
public func songFromChordNames(_ names: [String], tonicIdx: Int, mode: KeyMode, bpm: Double = 90) -> Song {
    let slots: [ChordSlot] = names.map { raw in
        let s = raw.trimmingCharacters(in: .whitespaces)
        // Mirror of the TS regex ^([A-G](?:♯|#|♭|b)?)(.*)$
        var rootName = "C"
        var rest = ""
        if let first = s.first, "ABCDEFG".contains(first) {
            rootName = String(first)
            var idx = s.index(after: s.startIndex)
            if idx < s.endIndex, "♯#♭b".contains(s[idx]) {
                rootName.append(s[idx])
                idx = s.index(after: idx)
            }
            rest = String(s[idx...])
        }
        rootName = rootName
            .replacingOccurrences(of: "#", with: "♯")
            .replacingOccurrences(of: "b", with: "♭")
        rest = rest.trimmingCharacters(in: .whitespaces).lowercased()
        let rootIdx = max(0, Theory.ROOTS.firstIndex(where: { $0.name == rootName }) ?? -1)
        let typeKey: String
        switch rest {
        case "":                        typeKey = "major"
        case "m", "min", "minor":       typeKey = "minor"
        case "maj7", "△7":              typeKey = "maj7"
        case "7":                       typeKey = "dom7"
        case "m7", "min7":              typeKey = "min7"
        case "m7b5", "ø":               typeKey = "m7b5"
        case "dim", "°":                typeKey = "dim"
        case "dim7", "°7":              typeKey = "dim7"
        case "aug", "+":                typeKey = "aug"
        default:                        typeKey = "major"
        }
        return ChordSlot(rootIdx: rootIdx, typeKey: typeKey, beats: 4, setIdx: 1, invIdx: 0)
    }
    return Song(
        title: "Untitled",
        tonicIdx: tonicIdx,
        mode: mode,
        bpm: bpm,
        sections: [SongSection(name: "Loop", slots: slots)]
    )
}
