// ============================================================
// Melody.swift — the melodic toolkit ("sonic lenses").
// Faithful port of src/engine/melody.ts + src/engine/noteEvents.ts.
// Deterministic generators that turn a progression into candidate
// melody material. The AI co-writer reasons over WHICH lens and
// WHERE; these functions guarantee the notes are correct.
// ============================================================
import Foundation

// MARK: - Neck placement & phrase normalization (noteEvents.ts)

/// Assign playable string/fret positions to any events missing them,
/// keeping consecutive notes near each other on the neck.
public func placeOnNeck(_ events: [NoteEvent], preferFret: Int = 5) -> [NoteEvent] {
    var anchor = preferFret
    return events.map { e in
        if let _ = e.stringNum, let fret = e.fret {
            anchor = fret
            return e
        }
        guard let pos = Theory.midiToFretChoice(e.midi, preferFret: anchor) else { return e }
        anchor = pos.fret
        var out = e
        out.stringNum = pos.stringNum
        out.fret = pos.fret
        return out
    }
}

/// Stable sort by startBeat (JS Array.sort is stable; Swift's is not guaranteed).
func stableSortedByStart(_ events: [NoteEvent]) -> [NoteEvent] {
    events.enumerated()
        .sorted { ($0.element.startBeat, $0.offset) < ($1.element.startBeat, $1.offset) }
        .map { $0.element }
}

/// Sort + sanity-clamp a phrase's events.
public func normalizePhrase(_ p: Phrase) -> Phrase {
    var events = p.events.filter { $0.midi >= 36 && $0.midi <= 88 && $0.startBeat >= 0 && $0.durBeat > 0 }
    events = stableSortedByStart(events).map { e in
        var out = e
        out.startBeat = min(e.startBeat, p.lengthBeats - 0.25)
        return out
    }
    var out = p
    out.events = placeOnNeck(events)
    return out
}

// MARK: - Lens helpers

private func tonic(_ song: Song) -> Root {
    Theory.ROOTS[song.tonicIdx]
}

private func role(_ pc: Int, _ song: Song, _ chord: ChordRef) -> NoteRole {
    Theory.classifyPc(pc, chord: chord, tonic: tonic(song), mode: song.mode)
}

private func phraseLength(_ tl: [TimelineEntry]) -> Double {
    tl.isEmpty ? 0 : tl[tl.count - 1].startBeat + tl[tl.count - 1].slot.beats
}

// MARK: - The four lenses

/// Lens 1 — top-note voice-leading: the melody the inversions already imply.
public func topNoteLine(_ song: Song) -> Phrase {
    let tl = songTimeline(song)
    let events: [NoteEvent] = tl.map { entry in
        NoteEvent(midi: slotVoicing(entry.slot).topMidi, startBeat: entry.startBeat,
                  durBeat: entry.slot.beats, role: .target, vel: 0.8)
    }
    return normalizePhrase(Phrase(
        label: "Top-note line", lengthBeats: phraseLength(tl),
        events: events, voice: .ai, method: "top-note voice-leading"
    ))
}

/// Lens 2 — guide-tone line: the 3rd of each chord, the emotional center.
public func guideToneLine(_ song: Song, register: Int = 64) -> Phrase {
    let tl = songTimeline(song)
    let gts = Theory.guideTonePcs(tl.map { ChordRef(root: slotRoot($0.slot), typeKey: $0.slot.typeKey) })
    var prev = register
    var events: [NoteEvent] = []
    for (i, entry) in tl.enumerated() {
        // choose the octave of the guide tone nearest the previous note
        let pc = gts[i].pc
        var midi = prev + mod12(pc - prev)
        if midi - prev > 6 { midi -= 12 }
        prev = midi
        events.append(NoteEvent(midi: midi, startBeat: entry.startBeat + 1,
                                durBeat: entry.slot.beats - 1, role: .target, vel: 0.75))
    }
    return normalizePhrase(Phrase(
        label: "Guide-tone line", lengthBeats: phraseLength(tl),
        events: events, voice: .ai, method: "guide-tone line (3rds)"
    ))
}

/// Lens 3 — pentatonic bed: a simple singable line from the key pentatonic.
/// Uses the TS integer LCG ((seed*1103515245+12345) & 0x7fffffff) for reproducibility.
public func pentatonicBed(_ song: Song, seed: Int = 1) -> Phrase {
    let t = tonic(song)
    let pent = Theory.scalePcs(t.pc, song.mode == .major ? "majorPent" : "minorPent")
    let tl = songTimeline(song)
    var events: [NoteEvent] = []
    var cursor = 62 // around D4
    var rng = seed
    func rand() -> Double {
        rng = (rng &* 1103515245 &+ 12345) & 0x7fffffff
        return Double(rng) / Double(0x7fffffff)
    }
    func pickNear(_ cands: [Int], _ from: Int) -> Int {
        var best = from
        var score = 99
        for pc in cands {
            for oct in [-12, 0, 12] {
                let up = mod12(pc - from)
                let m = from + up + oct - (up > 6 ? 12 : 0)
                let d = abs(m - from)
                if d < score && m >= 52 && m <= 76 { score = d; best = m }
            }
        }
        return best
    }
    for entry in tl {
        let chord = ChordRef(root: slotRoot(entry.slot), typeKey: entry.slot.typeKey)
        let chordPcs = Theory.chordTones(chord.root, chord.typeKey).tones.map { $0.pc }
        // strong beat: nearest pentatonic note that is ALSO a chord tone (fall back to pentatonic)
        let strongPool = pent.filter { chordPcs.contains($0) }
        let pool = strongPool.isEmpty ? pent : strongPool
        cursor = pickNear(pool, cursor + (rand() > 0.5 ? 2 : -2))
        events.append(NoteEvent(midi: cursor, startBeat: entry.startBeat, durBeat: 1.5,
                                role: role(mod12(cursor), song, chord), vel: 0.8))
        // breathe: one answering note on the "and of 2", rest the rest of the bar
        if rand() > 0.35 {
            let next = pickNear(pent, cursor + (rand() > 0.5 ? 3 : -3))
            events.append(NoteEvent(midi: next, startBeat: entry.startBeat + 2.5, durBeat: 1,
                                    role: role(mod12(next), song, chord), vel: 0.7))
            cursor = next
        }
    }
    return normalizePhrase(Phrase(
        label: "Pentatonic sketch", lengthBeats: phraseLength(tl),
        events: events, voice: .ai, method: "pentatonic bed"
    ))
}

/// Lens 4 — chord-tone targets joined by bridge notes (approach tones).
public func targetAndBridge(_ song: Song) -> Phrase {
    let tl = songTimeline(song)
    let keyPcs = Theory.scalePcs(tonic(song).pc, song.mode == .major ? "major" : "minor")
    var events: [NoteEvent] = []
    var prev = 64
    for i in 0..<tl.count {
        let entry = tl[i]
        let chord = ChordRef(root: slotRoot(entry.slot), typeKey: entry.slot.typeKey)
        let tones = Theory.chordTones(chord.root, chord.typeKey).tones
        // target = 3rd on beat 1, held
        let targetPc = tones[1].pc
        var target = prev + mod12(targetPc - prev)
        if target - prev > 6 { target -= 12 }
        events.append(NoteEvent(midi: target, startBeat: entry.startBeat, durBeat: 2.5, role: .target, vel: 0.85))
        prev = target
        // bridge into the NEXT chord's target on beat 4 / 4.5
        let next = tl[(i + 1) % tl.count]
        let nextTones = Theory.chordTones(slotRoot(next.slot), next.slot.typeKey).tones
        let nextPc = nextTones[1].pc
        var dest = prev + mod12(nextPc - prev)
        if dest - prev > 6 { dest -= 12 }
        let below = dest - 1
        let diatonicBelow = keyPcs.contains(mod12(below))
        events.append(NoteEvent(midi: below, startBeat: entry.startBeat + entry.slot.beats - 1,
                                durBeat: 0.5, role: diatonicBelow ? .bridge : .color, vel: 0.7))
    }
    return normalizePhrase(Phrase(
        label: "Targets + bridges", lengthBeats: phraseLength(tl),
        events: events, voice: .ai, method: "chord-tone targeting + bridge notes"
    ))
}

// MARK: - Motif transforms (for motivic callback)

public func transpose(_ events: [NoteEvent], _ semitones: Int) -> [NoteEvent] {
    placeOnNeck(events.map { e in
        var out = e
        out.midi = e.midi + semitones
        out.stringNum = nil
        out.fret = nil
        return out
    })
}

public func invert(_ events: [NoteEvent], axisMidi: Int? = nil) -> [NoteEvent] {
    if events.isEmpty { return events }
    let axis = axisMidi ?? events[0].midi
    return placeOnNeck(events.map { e in
        var out = e
        out.midi = axis - (e.midi - axis)
        out.stringNum = nil
        out.fret = nil
        return out
    })
}

public func augment(_ events: [NoteEvent], factor: Double = 2) -> [NoteEvent] {
    events.map { e in
        var out = e
        out.startBeat = e.startBeat * factor
        out.durBeat = e.durBeat * factor
        return out
    }
}

public func displace(_ events: [NoteEvent], beats: Double) -> [NoteEvent] {
    events.map { e in
        var out = e
        out.startBeat = e.startBeat + beats
        return out
    }
}

// MARK: - Style-knob transforms: make the knobs physical

public struct Knobs: Sendable, Codable, Equatable {
    public var density: Double
    public var chromaticism: Double
    public var feel: Double
    public var register: Double
    public init(density: Double = 0.5, chromaticism: Double = 0.5, feel: Double = 0.5, register: Double = 0.5) {
        self.density = density; self.chromaticism = chromaticism; self.feel = feel; self.register = register
    }
}

/// Reshape a phrase according to the style knobs (0..1 each, 0.5 = neutral).
///  density   — <0.4 thins to strong-beat notes; >0.6 adds pickup notes
///  register  — transposes by octaves toward a target center (55..73)
///  chromaticism — >0.6 converts bridge notes to chromatic approaches (color)
///  feel      — >0.55 swings off-beat eighths later (up to ~0.12 beat)
public func applyKnobs(_ phrase: Phrase, _ knobs: Knobs) -> Phrase {
    var events = stableSortedByStart(phrase.events)

    // density: thin
    if knobs.density < 0.4 && events.count > 2 {
        let keepEvery = knobs.density < 0.2 ? 2 : 3 // drop 1 of every N weak-beat notes
        var weakCount = 0
        events = events.filter { e in
            let rounded = jsRound(e.startBeat)
            let strong = abs(e.startBeat - Double(rounded)) < 0.01 && rounded % 2 == 0
            if strong { return true }
            weakCount += 1
            return weakCount % keepEvery != 0
        }
    }
    // density: add pickups into the next note
    if knobs.density > 0.6 {
        var extra: [NoteEvent] = []
        if events.count > 1 {
            for i in 1..<events.count {
                let prev = events[i - 1], cur = events[i]
                let gap = cur.startBeat - (prev.startBeat + prev.durBeat)
                if gap >= 0.5 && abs(cur.midi - prev.midi) >= 2 {
                    let step = cur.midi > prev.midi ? -2 : 2 // approach from a step away
                    extra.append(NoteEvent(midi: cur.midi + step, startBeat: cur.startBeat - 0.5,
                                           durBeat: 0.5, role: .bridge, vel: (cur.vel ?? 0.8) * 0.8))
                }
                if knobs.density > 0.85 && !extra.isEmpty && i % 2 == 0 {
                    // extra-busy: double the pickup an eighth earlier
                    var p = extra[extra.count - 1]
                    p.startBeat -= 0.5
                    p.midi += cur.midi > prev.midi ? -1 : 1
                    extra.append(p)
                }
            }
        }
        events = stableSortedByStart(events + extra)
    }
    // register: shift toward target center by whole octaves
    let target = 55 + knobs.register * 18
    if !events.isEmpty {
        let avg = Double(events.reduce(0) { $0 + $1.midi }) / Double(events.count)
        let octaves = jsRound((target - avg) / 12)
        if octaves != 0 {
            events = events.map { e in
                var out = e
                out.midi = e.midi + 12 * octaves
                return out
            }
        }
    }
    // chromaticism: sharpen bridge notes into chromatic approaches
    if knobs.chromaticism > 0.6 {
        let snapshot = events
        events = snapshot.enumerated().map { i, e in
            if e.role == .bridge, i + 1 < snapshot.count {
                let next = snapshot[i + 1]
                if abs(next.midi - e.midi) >= 2 {
                    var out = e
                    out.midi = next.midi + (next.midi > e.midi ? -1 : 1)
                    out.role = .color
                    return out
                }
            }
            return e
        }
    }
    // feel: swing the off-beat eighths late
    if knobs.feel > 0.55 {
        let push = (knobs.feel - 0.5) * 0.24 // up to ~0.12 beat
        events = events.map { e in
            let frac = e.startBeat - e.startBeat.rounded(.down)
            if abs(frac - 0.5) < 0.05 {
                var out = e
                out.startBeat = e.startBeat + push
                return out
            }
            return e
        }
    }

    var out = phrase
    out.events = events.map { e in
        var c = e
        c.stringNum = nil
        c.fret = nil
        return c
    }
    return normalizePhrase(out)
}

// MARK: - Lens menu

/// One melodic lens: a labeled, teachable deterministic generator.
public struct Lens: Sendable {
    public let key: String
    public let label: String
    public let teach: String
    public let gen: @Sendable (Song) -> Phrase
    public init(key: String, label: String, teach: String, gen: @escaping @Sendable (Song) -> Phrase) {
        self.key = key; self.label = label; self.teach = teach; self.gen = gen
    }
}

/// All lenses, keyed — the menu the co-writer picks from.
public let LENSES: [Lens] = [
    Lens(key: "topNote", label: "Top-note line",
         teach: "The top note of each chord voicing is already a melody — choosing inversions IS writing the top-line.",
         gen: { topNoteLine($0) }),
    Lens(key: "guideTone", label: "Guide-tone line",
         teach: "The 3rd of each chord is its emotional center; connecting them makes a skeleton melody.",
         gen: { guideToneLine($0) }),
    Lens(key: "pentatonic", label: "Pentatonic sketch",
         teach: "The key pentatonic never fights the changes — a safe, singable bed.",
         gen: { pentatonicBed($0) }),
    Lens(key: "targetBridge", label: "Targets + bridges",
         teach: "Land chord tones on strong beats; connect them with passing/approach tones for forward lean.",
         gen: { targetAndBridge($0) }),
]
