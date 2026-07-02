// ============================================================
// Theory.swift — core music theory engine.
// Faithful port of src/engine/theory.ts (proven across
// 12 keys × 9 chord types), extended with scales/modes,
// diatonic harmony, and chord-scale color logic.
// ============================================================
import Foundation

// MARK: - Shared value types

/// A chord/scale root: spelled name, letter index (0=C..6=B), pitch class.
public struct Root: Sendable, Equatable, Codable {
    public var name: String
    public var letter: Int
    public var pc: Int
    public init(name: String, letter: Int, pc: Int) {
        self.name = name; self.letter = letter; self.pc = pc
    }
}

public enum ChordKind: String, Sendable, Codable { case triad, seventh }

/// iv = intervals ABOVE the root (root's own 0 omitted). n = note count.
public struct ChordDef: Sendable {
    public let iv: [Int]
    public let label: String
    public let n: Int
    public let kind: ChordKind
    public init(iv: [Int], label: String, n: Int, kind: ChordKind) {
        self.iv = iv; self.label = label; self.n = n; self.kind = kind
    }
}

public struct ChordTone: Sendable, Equatable {
    public let deg: String
    public let pc: Int
    public let name: String
    public init(deg: String, pc: Int, name: String) {
        self.deg = deg; self.pc = pc; self.name = name
    }
}

public struct ChordTonesResult: Sendable {
    public let tones: [ChordTone]
    public let byPc: [Int: ChordTone]
    public init(tones: [ChordTone], byPc: [Int: ChordTone]) {
        self.tones = tones; self.byPc = byPc
    }
}

/// A chord reference (root + type) — mirrors the TS `{ root, typeKey }` shape.
public struct ChordRef: Sendable {
    public var root: Root
    public var typeKey: String
    public init(root: Root, typeKey: String) {
        self.root = root; self.typeKey = typeKey
    }
}

public struct ScaleDef: Sendable {
    public let iv: [Int]
    public let label: String
    public init(iv: [Int], label: String) { self.iv = iv; self.label = label }
}

public struct DiatonicChord: Sendable {
    public let degree: Int          // 1..7
    public let roman: String        // e.g. "I", "ii", "V7", "vii°"
    public let root: Root
    public let triadKey: String     // key into Theory.CHORDS
    public let seventhKey: String   // key into Theory.CHORDS
    public init(degree: Int, roman: String, root: Root, triadKey: String, seventhKey: String) {
        self.degree = degree; self.roman = roman; self.root = root
        self.triadKey = triadKey; self.seventhKey = seventhKey
    }
}

public struct ScaleChoice: Sendable {
    public let scaleKey: String     // key into Theory.SCALES
    public let scaleRootPc: Int     // pc the scale is built on
    public let label: String        // human label, e.g. "C Lydian"
    public let colorPcs: [Int]      // the notes that give this choice its flavor
    public let outside: Bool        // true if it introduces non-key notes
    public let why: String          // one-line teaching rationale
    public init(scaleKey: String, scaleRootPc: Int, label: String, colorPcs: [Int], outside: Bool, why: String) {
        self.scaleKey = scaleKey; self.scaleRootPc = scaleRootPc; self.label = label
        self.colorPcs = colorPcs; self.outside = outside; self.why = why
    }
}

public struct GuideTone: Sendable, Equatable {
    public let pc: Int
    public let name: String
    public init(pc: Int, name: String) { self.pc = pc; self.name = name }
}

public struct MidiCents: Sendable, Equatable {
    public let midi: Int
    public let cents: Int
    public init(midi: Int, cents: Int) { self.midi = midi; self.cents = cents }
}

public struct FretChoice: Sendable, Equatable {
    public let stringNum: Int
    public let fret: Int
    public init(stringNum: Int, fret: Int) { self.stringNum = stringNum; self.fret = fret }
}

// MARK: - Internal helpers (JS semantics)

/// Non-negative modulo — matches TS `((a % n) + n) % n`.
func posMod(_ a: Int, _ n: Int) -> Int { ((a % n) + n) % n }
func mod12(_ a: Int) -> Int { posMod(a, 12) }

/// JS Math.round: half rounds toward +∞ (matters for negative halves).
func jsRound(_ x: Double) -> Int { Int((x + 0.5).rounded(.down)) }

// MARK: - Theory namespace

public enum Theory {

    /// MIDI numbers of open strings, standard tuning. String 6 = low E.
    public static let OPEN: [Int: Int] = [6: 40, 5: 45, 4: 50, 3: 55, 2: 59, 1: 64]
    public static let STRING_LETTER: [Int: String] = [6: "E", 5: "A", 4: "D", 3: "G", 2: "B", 1: "e"]
    public static let LETTERS = ["C", "D", "E", "F", "G", "A", "B"]
    public static let LETTER_PC = [0, 2, 4, 5, 7, 9, 11]

    public static let CHORDS: [String: ChordDef] = [
        "major": ChordDef(iv: [4, 7], label: "Major", n: 3, kind: .triad),
        "minor": ChordDef(iv: [3, 7], label: "Minor", n: 3, kind: .triad),
        "dim":   ChordDef(iv: [3, 6], label: "Diminished", n: 3, kind: .triad),
        "aug":   ChordDef(iv: [4, 8], label: "Augmented", n: 3, kind: .triad),
        "maj7":  ChordDef(iv: [4, 7, 11], label: "Major 7", n: 4, kind: .seventh),
        "dom7":  ChordDef(iv: [4, 7, 10], label: "Dominant 7", n: 4, kind: .seventh),
        "min7":  ChordDef(iv: [3, 7, 10], label: "Minor 7", n: 4, kind: .seventh),
        "m7b5":  ChordDef(iv: [3, 6, 10], label: "Minor 7♭5", n: 4, kind: .seventh),
        "dim7":  ChordDef(iv: [3, 6, 9], label: "Diminished 7", n: 4, kind: .seventh),
    ]

    public static let ROOTS: [Root] = [
        Root(name: "C", letter: 0, pc: 0), Root(name: "C♯", letter: 0, pc: 1), Root(name: "D", letter: 1, pc: 2),
        Root(name: "E♭", letter: 2, pc: 3), Root(name: "E", letter: 2, pc: 4), Root(name: "F", letter: 3, pc: 5),
        Root(name: "F♯", letter: 3, pc: 6), Root(name: "G", letter: 4, pc: 7), Root(name: "A♭", letter: 5, pc: 8),
        Root(name: "A", letter: 5, pc: 9), Root(name: "B♭", letter: 6, pc: 10), Root(name: "B", letter: 6, pc: 11),
    ]

    public static let INV_NAME = ["Root position", "1st inversion", "2nd inversion", "3rd inversion"]
    public static let INV_SHORT = ["Root", "1st", "2nd", "3rd"]
    public static let INV_BASS = ["root", "3rd", "5th", "7th"]

    public static func accidental(_ d: Int) -> String {
        d == 0 ? "" : d == 1 ? "♯" : d == 2 ? "𝄪" : d == -1 ? "♭" : d == -2 ? "♭♭" : d > 0 ? "+\(d)" : "\(d)"
    }

    public static func spell(_ letterIdx: Int, _ pc: Int) -> String {
        let li = posMod(letterIdx, 7)
        let nat = LETTER_PC[li]
        var d = mod12(pc - nat)
        if d > 6 { d -= 12 }
        return LETTERS[li] + accidental(d)
    }

    public static func degName(_ posIdx: Int, _ interval: Int) -> String {
        if posIdx == 0 { return interval == 4 ? "3" : "♭3" }
        if posIdx == 1 { return interval == 7 ? "5" : interval == 6 ? "♭5" : "♯5" }
        return interval == 11 ? "7" : interval == 10 ? "♭7" : "♭♭7"
    }

    /// Chord tones with correct enharmonic spelling (stacked thirds).
    public static func chordTones(_ root: Root, _ typeKey: String) -> ChordTonesResult {
        let iv = CHORDS[typeKey]!.iv
        var tones = [ChordTone(deg: "R", pc: mod12(root.pc), name: spell(root.letter, root.pc))]
        for (idx, interval) in iv.enumerated() {
            let pc = (root.pc + interval) % 12
            tones.append(ChordTone(deg: degName(idx, interval), pc: pc, name: spell(root.letter + 2 * (idx + 1), pc)))
        }
        var byPc: [Int: ChordTone] = [:]
        for t in tones { byPc[t.pc] = t }
        return ChordTonesResult(tones: tones, byPc: byPc)
    }

    public static func lowestFret(_ openMidi: Int, _ pc: Int, _ abovePitch: Int) -> Int {
        var f = mod12(pc - openMidi)
        while openMidi + f <= abovePitch { f += 12 }
        return f
    }

    /// Close-position ascending voicing across N strings, min fret span.
    public static func shape(_ strings: [Int], _ pcs: [Int]) -> [Int] {
        let o = strings.map { OPEN[$0]! }
        let base = mod12(pcs[0] - o[0])
        var best: (score: Int, frets: [Int])? = nil
        for fLow in [base, base + 12] {
            var prev = o[0] + fLow
            var frets = [fLow]
            for i in 1..<pcs.count {
                let f = lowestFret(o[i], pcs[i], prev)
                frets.append(f)
                prev = o[i] + f
            }
            let maxF = frets.max()!
            if maxF > 18 { continue }
            let span = maxF - frets.min()!
            let score = span * 100 + maxF
            if best == nil || score < best!.score { best = (score, frets) }
        }
        return best!.frets
    }

    /// Drop-2: from close inversion i, drop the 2nd-from-top voice an octave.
    public static func drop2Order(_ T: [Int], _ i: Int) -> [Int] {
        var prev = -1
        var pit: [Int] = []
        for k in 0..<4 {
            var p = T[(i + k) % 4]
            while p <= prev { p += 12 }
            pit.append(p)
            prev = p
        }
        pit[2] -= 12
        pit.sort()
        return pit.map { mod12($0) }
    }

    /// Voicings indexed by inversion (0=root..n-1), each = pitch-class order low→high.
    public static func buildVoicings(_ root: Root, _ typeKey: String) -> [[Int]] {
        let T = chordTones(root, typeKey).tones.map { $0.pc }
        let n = T.count
        var out: [[Int]?] = Array(repeating: nil, count: n)
        if n == 3 {
            for i in 0..<3 { out[i] = [T[i], T[(i + 1) % 3], T[(i + 2) % 3]] }
        } else {
            for i in 0..<4 {
                let order = drop2Order(T, i)
                out[T.firstIndex(of: order[0])!] = order
            }
            for i in 0..<4 where out[i] == nil { out[i] = drop2Order(T, i) }
        }
        return out.map { $0! }
    }

    public static func setsFor(_ typeKey: String) -> [[Int]] {
        CHORDS[typeKey]!.n == 3
            ? [[6, 5, 4], [5, 4, 3], [4, 3, 2], [3, 2, 1]]
            : [[6, 5, 4, 3], [5, 4, 3, 2], [4, 3, 2, 1]]
    }

    // ============================================================
    // Scales, modes, diatonic harmony, chord-scale colors
    // ============================================================

    /// Interval sets (semitones from tonic).
    public static let SCALES: [String: ScaleDef] = [
        "major":         ScaleDef(iv: [0, 2, 4, 5, 7, 9, 11], label: "Major (Ionian)"),
        "dorian":        ScaleDef(iv: [0, 2, 3, 5, 7, 9, 10], label: "Dorian"),
        "phrygian":      ScaleDef(iv: [0, 1, 3, 5, 7, 8, 10], label: "Phrygian"),
        "lydian":        ScaleDef(iv: [0, 2, 4, 6, 7, 9, 11], label: "Lydian"),
        "mixolydian":    ScaleDef(iv: [0, 2, 4, 5, 7, 9, 10], label: "Mixolydian"),
        "minor":         ScaleDef(iv: [0, 2, 3, 5, 7, 8, 10], label: "Natural Minor (Aeolian)"),
        "locrian":       ScaleDef(iv: [0, 1, 3, 5, 6, 8, 10], label: "Locrian"),
        "majorPent":     ScaleDef(iv: [0, 2, 4, 7, 9], label: "Major Pentatonic"),
        "minorPent":     ScaleDef(iv: [0, 3, 5, 7, 10], label: "Minor Pentatonic"),
        "blues":         ScaleDef(iv: [0, 3, 5, 6, 7, 10], label: "Blues"),
        "harmonicMinor": ScaleDef(iv: [0, 2, 3, 5, 7, 8, 11], label: "Harmonic Minor"),
        "melodicMinor":  ScaleDef(iv: [0, 2, 3, 5, 7, 9, 11], label: "Melodic Minor"),
    ]

    /// Pitch classes of a scale built on a root pc.
    public static func scalePcs(_ rootPc: Int, _ scaleKey: String) -> [Int] {
        SCALES[scaleKey]!.iv.map { (rootPc + $0) % 12 }
    }

    /// Spelled note names for a 7-note scale on a given root (correct letters).
    public static func scaleSpelling(_ root: Root, _ scaleKey: String) -> [String] {
        let iv = SCALES[scaleKey]!.iv
        if iv.count != 7 { return iv.map { spell(root.letter, (root.pc + $0) % 12) } }
        return iv.enumerated().map { idx, i in spell(root.letter + idx, (root.pc + i) % 12) }
    }

    private static let MAJOR_TRIADS = ["major", "minor", "minor", "major", "major", "minor", "dim"]
    private static let MAJOR_SEVENTHS = ["maj7", "min7", "min7", "maj7", "dom7", "min7", "m7b5"]
    private static let MINOR_TRIADS = ["minor", "dim", "major", "minor", "minor", "major", "major"]
    private static let MINOR_SEVENTHS = ["min7", "m7b5", "maj7", "min7", "min7", "maj7", "dom7"]
    private static let ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"]

    private static func romanFor(_ deg: Int, _ triadKey: String) -> String {
        let base = ROMAN[deg]
        if triadKey == "major" || triadKey == "aug" { return base }
        if triadKey == "dim" { return base.lowercased() + "°" }
        return base.lowercased()
    }

    /// Find (or synthesize) the Root entry matching a pc with the right letter.
    public static func rootForPc(_ pc: Int, _ letter: Int) -> Root {
        let norm = posMod(letter, 7)
        if let found = ROOTS.first(where: { $0.pc == pc % 12 && $0.letter == norm }) { return found }
        return Root(name: spell(norm, pc % 12), letter: norm, pc: pc % 12)
    }

    /// The 7 diatonic chords of a major or natural-minor key.
    public static func diatonicChords(_ tonic: Root, _ mode: KeyMode) -> [DiatonicChord] {
        let scaleKey = mode == .major ? "major" : "minor"
        let iv = SCALES[scaleKey]!.iv
        let triads = mode == .major ? MAJOR_TRIADS : MINOR_TRIADS
        let sevenths = mode == .major ? MAJOR_SEVENTHS : MINOR_SEVENTHS
        return iv.enumerated().map { idx, interval in
            let pc = (tonic.pc + interval) % 12
            let root = rootForPc(pc, tonic.letter + idx)
            return DiatonicChord(
                degree: idx + 1,
                roman: romanFor(idx, triads[idx]),
                root: root,
                triadKey: triads[idx],
                seventhKey: sevenths[idx]
            )
        }
    }

    /// Identify the roman numeral of an arbitrary chord within a key (or nil).
    public static func romanInKey(_ root: Root, _ typeKey: String, _ tonic: Root, _ mode: KeyMode) -> String? {
        let dia = diatonicChords(tonic, mode)
        let kind = CHORDS[typeKey]!.kind
        for d in dia {
            if d.root.pc != root.pc { continue }
            if kind == .triad && d.triadKey == typeKey { return d.roman }
            if kind == .seventh && d.seventhKey == typeKey { return d.roman + "7" }
        }
        return nil
    }

    // MARK: Chord-scale map & color notes

    /// Chord-scale map: for a chord functioning inside a key, which scales/colors apply.
    /// This encodes the "melodic lenses" the co-writer reasons over.
    public static func chordScaleChoices(_ chord: ChordRef, tonic: Root, mode: KeyMode) -> [ScaleChoice] {
        let keyPcs = scalePcs(tonic.pc, mode == .major ? "major" : "minor")
        var out: [ScaleChoice] = []
        let rn = chord.root.name
        let kind = CHORDS[chord.typeKey]!
        let isMajorish = kind.iv[0] == 4
        let isMinorish = kind.iv[0] == 3 && kind.iv[1] == 7

        // Parent-key pentatonic bed (always available, never fights the changes)
        out.append(ScaleChoice(
            scaleKey: mode == .major ? "majorPent" : "minorPent",
            scaleRootPc: tonic.pc,
            label: "\(tonic.name) \(mode == .major ? "major" : "minor") pentatonic",
            colorPcs: [],
            outside: false,
            why: "The singable bed — five notes that never fight any diatonic chord."
        ))

        if isMajorish {
            let lydPcs = scalePcs(chord.root.pc, "lydian")
            let sharp4 = (chord.root.pc + 6) % 12
            let isFree = lydPcs.allSatisfy { keyPcs.contains($0) }
            out.append(ScaleChoice(
                scaleKey: "lydian",
                scaleRootPc: chord.root.pc,
                label: "\(rn) Lydian",
                colorPcs: [sharp4],
                outside: !isFree,
                why: isFree
                    ? "\(rn) Lydian is free here — its ♯11 (\(spell(chord.root.letter + 3, sharp4))) is already in the key. Shimmer with no outside note."
                    : "Raise the 4th to \(spell(chord.root.letter + 3, sharp4)) — the Lydian ♯11 floats and sparkles over \(rn)."
            ))
            // Mixolydian for dominant-function chords
            if chord.typeKey == "dom7" || chord.typeKey == "major" {
                let mixPcs = scalePcs(chord.root.pc, "mixolydian")
                let b7 = (chord.root.pc + 10) % 12
                out.append(ScaleChoice(
                    scaleKey: "mixolydian",
                    scaleRootPc: chord.root.pc,
                    label: "\(rn) Mixolydian",
                    colorPcs: [b7],
                    outside: !mixPcs.allSatisfy { keyPcs.contains($0) },
                    why: "The dominant sound — ♭7 (\(spell(chord.root.letter + 6, b7))) gives \(rn) its pull."
                ))
            }
        }
        if isMinorish {
            let dorPcs = scalePcs(chord.root.pc, "dorian")
            let nat6 = (chord.root.pc + 9) % 12
            out.append(ScaleChoice(
                scaleKey: "dorian",
                scaleRootPc: chord.root.pc,
                label: "\(rn) Dorian",
                colorPcs: [nat6],
                outside: !dorPcs.allSatisfy { keyPcs.contains($0) },
                why: "Dorian's natural 6 (\(spell(chord.root.letter + 5, nat6))) warms the minor color — hopeful instead of sad."
            ))
        }

        // Blues color relative to the key tonic
        let b3 = (tonic.pc + 3) % 12
        let b7k = (tonic.pc + 10) % 12
        out.append(ScaleChoice(
            scaleKey: "blues",
            scaleRootPc: tonic.pc,
            label: "\(tonic.name) blues",
            colorPcs: mode == .major ? [b3, b7k] : [(tonic.pc + 6) % 12],
            outside: true,
            why: mode == .major
                ? "Blue notes — ♭3 (\(spell(tonic.letter + 2, b3))) and ♭7 (\(spell(tonic.letter + 6, b7k))) add grit and sweat."
                : "The ♭5 blue note adds the growl."
        ))

        return out
    }

    /// Classify a pitch class's role against a chord + key context.
    public static func classifyPc(_ pc: Int, chord: ChordRef, tonic: Root, mode: KeyMode) -> NoteRole {
        let ct = chordTones(chord.root, chord.typeKey)
        if ct.byPc[mod12(pc)] != nil { return .target }
        let keyPcs = scalePcs(tonic.pc, mode == .major ? "major" : "minor")
        if keyPcs.contains(mod12(pc)) { return .bridge }
        return .color
    }

    /// Guide-tone (3rd of each chord) line across a progression.
    public static func guideTonePcs(_ chords: [ChordRef]) -> [GuideTone] {
        chords.map { c in
            let t = chordTones(c.root, c.typeKey).tones[1] // the 3rd
            return GuideTone(pc: t.pc, name: t.name)
        }
    }

    public static func midiFreq(_ m: Int) -> Double {
        440 * pow(2, Double(m - 69) / 12)
    }

    /// Nearest MIDI note number for a frequency (+ cents offset).
    public static func freqToMidi(_ f: Double) -> MidiCents {
        let m = 69 + 12 * log2(f / 440)
        let midi = jsRound(m)
        return MidiCents(midi: midi, cents: jsRound((m - Double(midi)) * 100))
    }

    /// Map a MIDI note to a playable {string, fret} near a preferred fret region.
    public static func midiToFretChoice(_ midi: Int, preferFret: Int = 5) -> FretChoice? {
        var best: (stringNum: Int, fret: Int, score: Int)? = nil
        for s in stride(from: 6, through: 1, by: -1) {
            let fret = midi - OPEN[s]!
            if fret < 0 || fret > 18 { continue }
            let score = abs(fret - preferFret)
            if best == nil || score < best!.score { best = (s, fret, score) }
        }
        return best.map { FretChoice(stringNum: $0.stringNum, fret: $0.fret) }
    }
}
