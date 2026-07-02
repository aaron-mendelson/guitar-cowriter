import { describe, it, expect } from "vitest";
import {
  ROOTS, chordTones, buildVoicings, shape, setsFor, scalePcs, scaleSpelling,
  diatonicChords, chordScaleChoices, classifyPc, guideTonePcs, rootForPc, romanInKey,
} from "./theory";
import { songFromChordNames, slotVoicing, songTimeline, chordAtBeat, songLengthBeats } from "./progression";
import { topNoteLine, guideToneLine, pentatonicBed, targetAndBridge, invert, transpose } from "./melody";

const C = ROOTS[0], A = ROOTS[9], F = ROOTS[5], G = ROOTS[7];

describe("ported engine (parity with Fretboard Explorer)", () => {
  it("C major chord tones = C E G", () => {
    const t = chordTones(C, "major").tones;
    expect(t.map((x) => x.name)).toEqual(["C", "E", "G"]);
    expect(t.map((x) => x.pc)).toEqual([0, 4, 7]);
  });
  it("E♭ minor7 spells with flats", () => {
    const eb = ROOTS[3];
    const t = chordTones(eb, "min7").tones;
    expect(t.map((x) => x.name)).toEqual(["E♭", "G♭", "B♭", "D♭"]);
  });
  it("voicings: C major has 3 inversions, maj7 has 4 (drop-2, slotted by bass)", () => {
    expect(buildVoicings(C, "major")).toHaveLength(3);
    const v7 = buildVoicings(C, "maj7");
    expect(v7).toHaveLength(4);
    v7.forEach((pcs, inv) => {
      // bass of inversion i is chord tone i (R,3,5,7)
      const bass = pcs[0];
      expect(bass).toBe(chordTones(C, "maj7").tones[inv].pc);
    });
  });
  it("shape returns playable frets ≤ 18", () => {
    for (const root of ROOTS) {
      for (const typeKey of ["major", "minor", "maj7", "dom7", "min7"]) {
        const sets = setsFor(typeKey);
        for (const strings of sets) {
          for (const pcs of buildVoicings(root, typeKey)) {
            const frets = shape(strings, pcs);
            expect(Math.max(...frets)).toBeLessThanOrEqual(18);
            expect(Math.min(...frets)).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});

describe("scales & modes", () => {
  it("C Lydian = C D E F♯ G A B", () => {
    expect(scaleSpelling(C, "lydian")).toEqual(["C", "D", "E", "F♯", "G", "A", "B"]);
  });
  it("F Lydian pitch classes ⊂ C major (the free ♯11)", () => {
    const fLyd = scalePcs(F.pc, "lydian");
    const cMaj = scalePcs(C.pc, "major");
    fLyd.forEach((pc) => expect(cMaj).toContain(pc));
  });
  it("C major pentatonic = C D E G A", () => {
    expect(scalePcs(0, "majorPent")).toEqual([0, 2, 4, 7, 9]);
  });
});

describe("diatonic harmony", () => {
  it("C major diatonic = C Dm Em F G Am B°", () => {
    const d = diatonicChords(C, "major");
    expect(d.map((x) => x.root.name + "/" + x.triadKey)).toEqual([
      "C/major", "D/minor", "E/minor", "F/major", "G/major", "A/minor", "B/dim",
    ]);
    expect(d.map((x) => x.roman)).toEqual(["I", "ii", "iii", "IV", "V", "vi", "vii°"]);
  });
  it("A minor diatonic sevenths include G7 as VII7... (natural minor)", () => {
    const d = diatonicChords(A, "minor");
    expect(d[0].seventhKey).toBe("min7");
    expect(d[2].root.name).toBe("C");
    expect(d[2].seventhKey).toBe("maj7");
  });
  it("romanInKey: Am in C major = vi", () => {
    expect(romanInKey(A, "minor", C, "major")).toBe("vi");
    expect(romanInKey(G, "major", C, "major")).toBe("V");
  });
  it("rootForPc picks correct enharmonic (pc 6 with letter F = F♯)", () => {
    expect(rootForPc(6, 3).name).toBe("F♯");
    expect(rootForPc(3, 2).name).toBe("E♭");
  });
});

describe("chord-scale colors", () => {
  it("F in key of C: Lydian is free (no outside note)", () => {
    const choices = chordScaleChoices({ root: F, typeKey: "major" }, C, "major");
    const lyd = choices.find((c) => c.scaleKey === "lydian")!;
    expect(lyd.outside).toBe(false);
    expect(lyd.colorPcs).toContain(11); // B natural = ♯11 of F
  });
  it("C in key of C: Lydian is outside (F♯)", () => {
    const choices = chordScaleChoices({ root: C, typeKey: "major" }, C, "major");
    const lyd = choices.find((c) => c.scaleKey === "lydian")!;
    expect(lyd.outside).toBe(true);
    expect(lyd.colorPcs).toContain(6); // F♯
  });
  it("classifyPc: E over C = target, D = bridge, E♭ = color (key C major)", () => {
    const chord = { root: C, typeKey: "major" };
    expect(classifyPc(4, chord, C, "major")).toBe("target");
    expect(classifyPc(2, chord, C, "major")).toBe("bridge");
    expect(classifyPc(3, chord, C, "major")).toBe("color");
  });
  it("guide tones of C Am F G = E C A B", () => {
    const gts = guideTonePcs([
      { root: C, typeKey: "major" }, { root: A, typeKey: "minor" },
      { root: F, typeKey: "major" }, { root: G, typeKey: "major" },
    ]);
    expect(gts.map((g) => g.name)).toEqual(["E", "C", "A", "B"]);
  });
});

describe("progression model", () => {
  const song = songFromChordNames(["C", "Am", "F", "G"], 0, "major", 90);
  it("parses C Am F G", () => {
    const tl = songTimeline(song);
    expect(tl).toHaveLength(4);
    expect(tl.map((x) => x.startBeat)).toEqual([0, 4, 8, 12]);
    expect(songLengthBeats(song)).toBe(16);
  });
  it("chordAtBeat wraps around the loop", () => {
    expect(chordAtBeat(song, 0).slot.rootIdx).toBe(0);
    expect(chordAtBeat(song, 5).slot.rootIdx).toBe(9);
    expect(chordAtBeat(song, 17).slot.rootIdx).toBe(0); // 17 wraps to beat 1 → C
    expect(chordAtBeat(song, 21).slot.rootIdx).toBe(9); // 21 wraps to beat 5 → Am
  });
  it("slotVoicing produces midis and a top note", () => {
    const v = slotVoicing(song.sections[0].slots[0]);
    expect(v.midis.length).toBe(3);
    expect(v.topMidi).toBe(Math.max(...v.midis));
  });
});

describe("melodic lenses", () => {
  const song = songFromChordNames(["C", "Am", "F", "G"], 0, "major", 90);
  it("every lens produces in-range, placeable, correctly-timed events", () => {
    for (const phrase of [topNoteLine(song), guideToneLine(song), pentatonicBed(song), targetAndBridge(song)]) {
      expect(phrase.events.length).toBeGreaterThan(0);
      expect(phrase.lengthBeats).toBe(16);
      for (const e of phrase.events) {
        expect(e.midi).toBeGreaterThanOrEqual(36);
        expect(e.midi).toBeLessThanOrEqual(88);
        expect(e.stringNum).toBeDefined();
        expect(e.fret).toBeDefined();
        expect(e.startBeat).toBeGreaterThanOrEqual(0);
        expect(e.startBeat).toBeLessThan(16);
      }
    }
  });
  it("guide-tone line lands on the 3rds", () => {
    const p = guideToneLine(song);
    expect(p.events.map((e) => e.midi % 12)).toEqual([4, 0, 9, 11]); // E C A B
  });
  it("motif transforms: invert is its own inverse; transpose shifts", () => {
    const p = pentatonicBed(song);
    const inv2 = invert(invert(p.events));
    expect(inv2.map((e) => e.midi)).toEqual(p.events.map((e) => e.midi));
    const up = transpose(p.events, 5);
    expect(up.map((e) => e.midi)).toEqual(p.events.map((e) => e.midi + 5));
  });
});
