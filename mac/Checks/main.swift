import Foundation
import CoWriterKit

var failures = 0
func check(_ ok: Bool, _ label: String) {
  if ok { print("  ok  \(label)") } else { failures += 1; print("FAIL  \(label)") }
}

check(NoteRole.target.rawValue == "target", "core types")

// ---------- theory: chord tones & spelling ----------
let C = Theory.ROOTS[0]
let cMajTones = Theory.chordTones(C, "major").tones
check(cMajTones.map { $0.name } == ["C", "E", "G"], "C major tone names == C E G")
check(cMajTones.map { $0.pc } == [0, 4, 7], "C major tone pcs == 0 4 7")
let Eb = Theory.ROOTS[3]
check(Theory.chordTones(Eb, "min7").tones.map { $0.name } == ["E♭", "G♭", "B♭", "D♭"],
      "E♭ min7 spells E♭ G♭ B♭ D♭")

// ---------- voicings ----------
check(Theory.buildVoicings(C, "major").count == 3, "C major has 3 voicings")
let cMaj7Voicings = Theory.buildVoicings(C, "maj7")
check(cMaj7Voicings.count == 4, "C maj7 has 4 voicings")
let cMaj7Tones = Theory.chordTones(C, "maj7").tones
var bassOK = true
for i in 0..<4 where cMaj7Voicings[i][0] != cMaj7Tones[i].pc { bassOK = false }
check(bassOK, "maj7 inversion i bass == chord tone i pc")

// ---------- shape: all roots × types × sets × voicings within frets 0...18 ----------
var fretsOK = true
for root in Theory.ROOTS {
  for typeKey in ["major", "minor", "maj7", "dom7", "min7"] {
    let voicings = Theory.buildVoicings(root, typeKey)
    for set in Theory.setsFor(typeKey) {
      for pcs in voicings {
        let frets = Theory.shape(set, pcs)
        if frets.contains(where: { $0 < 0 || $0 > 18 }) { fretsOK = false }
      }
    }
  }
}
check(fretsOK, "all shapes (12 roots × 5 types × sets × voicings) within frets 0...18")

// ---------- scales ----------
check(Theory.scaleSpelling(C, "lydian") == ["C", "D", "E", "F♯", "G", "A", "B"], "C Lydian spelling")
let fLydPcs = Theory.scalePcs(5, "lydian")
let cMajorPcs = Theory.scalePcs(0, "major")
check(fLydPcs.allSatisfy { cMajorPcs.contains($0) }, "F Lydian pcs ⊂ C major pcs")
check(Theory.scalePcs(0, "majorPent") == [0, 2, 4, 7, 9], "C major pentatonic == 0 2 4 7 9")

// ---------- diatonic harmony ----------
let dia = Theory.diatonicChords(C, .major)
check(dia.map { $0.root.name } == ["C", "D", "E", "F", "G", "A", "B"], "C major diatonic roots")
check(dia.map { $0.triadKey } == ["major", "minor", "minor", "major", "major", "minor", "dim"],
      "C major diatonic triad types")
check(dia.map { $0.roman } == ["I", "ii", "iii", "IV", "V", "vi", "vii°"], "C major romans")

let A = Theory.ROOTS[9]
let G = Theory.ROOTS[7]
check(Theory.romanInKey(A, "minor", C, .major) == "vi", "Am in C major == vi")
check(Theory.romanInKey(G, "major", C, .major) == "V", "G in C major == V")
check(Theory.rootForPc(6, 3).name == "F♯", "rootForPc(6, letter 3) == F♯")

// ---------- chord-scale choices ----------
let F = Theory.ROOTS[5]
let fChoices = Theory.chordScaleChoices(ChordRef(root: F, typeKey: "major"), tonic: C, mode: .major)
let fLydChoice = fChoices.first { $0.scaleKey == "lydian" }
check(fLydChoice != nil && fLydChoice!.outside == false && fLydChoice!.colorPcs.contains(11),
      "F-in-C Lydian: outside==false, colorPcs contains 11")
let cChoices = Theory.chordScaleChoices(ChordRef(root: C, typeKey: "major"), tonic: C, mode: .major)
let cLydChoice = cChoices.first { $0.scaleKey == "lydian" }
check(cLydChoice != nil && cLydChoice!.outside == true && cLydChoice!.colorPcs.contains(6),
      "C-in-C Lydian: outside==true, colorPcs contains 6")

// ---------- classify & guide tones ----------
let cChord = ChordRef(root: C, typeKey: "major")
check(Theory.classifyPc(4, chord: cChord, tonic: C, mode: .major) == .target, "E over C == target")
check(Theory.classifyPc(2, chord: cChord, tonic: C, mode: .major) == .bridge, "D over C == bridge")
check(Theory.classifyPc(3, chord: cChord, tonic: C, mode: .major) == .color, "E♭ over C == color")
let gts = Theory.guideTonePcs([
  ChordRef(root: C, typeKey: "major"),
  ChordRef(root: A, typeKey: "minor"),
  ChordRef(root: F, typeKey: "major"),
  ChordRef(root: G, typeKey: "major"),
])
check(gts.map { $0.name } == ["E", "C", "A", "B"], "guide tones of C Am F G == E C A B")

// ---------- progression / song ----------
let song = songFromChordNames(["C", "Am", "F", "G"], tonicIdx: 0, mode: .major, bpm: 90)
let tl = songTimeline(song)
check(tl.count == 4, "songFromChordNames: 4 timeline entries")
check(tl.map { $0.startBeat } == [0, 4, 8, 12], "timeline start beats == 0 4 8 12")
check(songLengthBeats(song) == 16, "song length == 16 beats")
check(chordAtBeat(song, 5).slot.rootIdx == 9, "chordAtBeat(5).rootIdx == 9 (Am)")
check(chordAtBeat(song, 17).slot.rootIdx == 0, "chordAtBeat(17) wraps to C")

// ---------- lenses ----------
let lensPhrases: [(String, Phrase)] = [
  ("topNoteLine", topNoteLine(song)),
  ("guideToneLine", guideToneLine(song)),
  ("pentatonicBed", pentatonicBed(song)),
  ("targetAndBridge", targetAndBridge(song)),
]
for (name, ph) in lensPhrases {
  check(!ph.events.isEmpty, "\(name): > 0 events")
  check(ph.lengthBeats == 16, "\(name): lengthBeats == 16")
  check(ph.events.allSatisfy { $0.midi >= 36 && $0.midi <= 88 }, "\(name): all midis in 36...88")
  check(ph.events.allSatisfy { $0.stringNum != nil && $0.fret != nil }, "\(name): all events placed on neck")
  check(ph.events.allSatisfy { $0.startBeat >= 0 && $0.startBeat < 16 }, "\(name): all startBeats in 0..<16")
}
let gtl = guideToneLine(song)
check(gtl.events.map { $0.midi % 12 } == [4, 0, 9, 11], "guideToneLine pcs == [4, 0, 9, 11]")

// ---------- motif transforms ----------
let motif = gtl.events
let doubleInverted = invert(invert(motif))
check(doubleInverted.map { $0.midi } == motif.map { $0.midi }, "invert ∘ invert == identity on midis")
let up5 = transpose(motif, 5)
check(up5.map { $0.midi } == motif.map { $0.midi + 5 }, "transpose(+5) shifts all midis by 5")

// ---------- style knobs ----------
let neutral = Knobs(density: 0.5, chromaticism: 0.5, feel: 0.5, register: 0.5)
check(applyKnobs(gtl, neutral).events.count == gtl.events.count, "neutral knobs preserve guide-tone count")
let tb = targetAndBridge(song)
let sparseCount = applyKnobs(tb, Knobs(density: 0.1)).events.count
let busyCount = applyKnobs(tb, Knobs(density: 0.9)).events.count
check(sparseCount < tb.events.count, "density 0.1 thins targetAndBridge")
check(tb.events.count < busyCount, "density 0.9 adds to targetAndBridge")
func avgMidi(_ p: Phrase) -> Double {
  p.events.isEmpty ? 0 : Double(p.events.reduce(0) { $0 + $1.midi }) / Double(p.events.count)
}
let highReg = applyKnobs(gtl, Knobs(register: 1.0))
let lowReg = applyKnobs(gtl, Knobs(register: 0.0))
check(avgMidi(highReg) > avgMidi(lowReg), "register 1.0 avg midi > register 0.0 avg midi")

if failures > 0 { print("\(failures) FAILURES"); exit(1) }
print("ALL CHECKS PASS")
