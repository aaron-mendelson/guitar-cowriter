/* ============================================================
 * theory.ts — core music theory engine
 * Ported from Fretboard Explorer (proven across 12 keys × 9 chord types),
 * extended with scales/modes, diatonic harmony, and chord-scale color logic.
 * ============================================================ */

/** MIDI numbers of open strings, standard tuning. String 6 = low E. */
export const OPEN: Record<number, number> = { 6: 40, 5: 45, 4: 50, 3: 55, 2: 59, 1: 64 };
export const STRING_LETTER: Record<number, string> = { 6: "E", 5: "A", 4: "D", 3: "G", 2: "B", 1: "e" };
export const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;
export const LETTER_PC = [0, 2, 4, 5, 7, 9, 11] as const;

export type ChordKind = "triad" | "seventh";
export interface ChordDef { iv: number[]; label: string; n: number; kind: ChordKind }

/** iv = intervals ABOVE the root (root's own 0 omitted). n = note count. */
export const CHORDS: Record<string, ChordDef> = {
  major: { iv: [4, 7], label: "Major", n: 3, kind: "triad" },
  minor: { iv: [3, 7], label: "Minor", n: 3, kind: "triad" },
  dim:   { iv: [3, 6], label: "Diminished", n: 3, kind: "triad" },
  aug:   { iv: [4, 8], label: "Augmented", n: 3, kind: "triad" },
  maj7:  { iv: [4, 7, 11], label: "Major 7", n: 4, kind: "seventh" },
  dom7:  { iv: [4, 7, 10], label: "Dominant 7", n: 4, kind: "seventh" },
  min7:  { iv: [3, 7, 10], label: "Minor 7", n: 4, kind: "seventh" },
  m7b5:  { iv: [3, 6, 10], label: "Minor 7♭5", n: 4, kind: "seventh" },
  dim7:  { iv: [3, 6, 9], label: "Diminished 7", n: 4, kind: "seventh" },
};

export interface Root { name: string; letter: number; pc: number }
export const ROOTS: Root[] = [
  { name: "C", letter: 0, pc: 0 }, { name: "C♯", letter: 0, pc: 1 }, { name: "D", letter: 1, pc: 2 },
  { name: "E♭", letter: 2, pc: 3 }, { name: "E", letter: 2, pc: 4 }, { name: "F", letter: 3, pc: 5 },
  { name: "F♯", letter: 3, pc: 6 }, { name: "G", letter: 4, pc: 7 }, { name: "A♭", letter: 5, pc: 8 },
  { name: "A", letter: 5, pc: 9 }, { name: "B♭", letter: 6, pc: 10 }, { name: "B", letter: 6, pc: 11 },
];

export const INV_NAME = ["Root position", "1st inversion", "2nd inversion", "3rd inversion"];
export const INV_SHORT = ["Root", "1st", "2nd", "3rd"];
export const INV_BASS = ["root", "3rd", "5th", "7th"];

export function accidental(d: number): string {
  return d === 0 ? "" : d === 1 ? "♯" : d === 2 ? "𝄪" : d === -1 ? "♭" : d === -2 ? "♭♭" : d > 0 ? "+" + d : "" + d;
}
export function spell(letterIdx: number, pc: number): string {
  const nat = LETTER_PC[((letterIdx % 7) + 7) % 7];
  let d = ((pc - nat) % 12 + 12) % 12;
  if (d > 6) d -= 12;
  return LETTERS[((letterIdx % 7) + 7) % 7] + accidental(d);
}
export function degName(posIdx: number, interval: number): string {
  if (posIdx === 0) return interval === 4 ? "3" : "♭3";
  if (posIdx === 1) return interval === 7 ? "5" : interval === 6 ? "♭5" : "♯5";
  return interval === 11 ? "7" : interval === 10 ? "♭7" : "♭♭7";
}

export interface ChordTone { deg: string; pc: number; name: string }
export interface ChordTonesResult { tones: ChordTone[]; byPc: Record<number, ChordTone> }

/** Chord tones with correct enharmonic spelling (stacked thirds). */
export function chordTones(root: Root, typeKey: string): ChordTonesResult {
  const iv = CHORDS[typeKey].iv;
  const tones: ChordTone[] = [{ deg: "R", pc: root.pc % 12, name: spell(root.letter, root.pc) }];
  iv.forEach((interval, idx) => {
    const pc = (root.pc + interval) % 12;
    tones.push({ deg: degName(idx, interval), pc, name: spell(root.letter + 2 * (idx + 1), pc) });
  });
  const byPc: Record<number, ChordTone> = {};
  tones.forEach((t) => (byPc[t.pc] = t));
  return { tones, byPc };
}

export function lowestFret(openMidi: number, pc: number, abovePitch: number): number {
  let f = ((pc - openMidi) % 12 + 12) % 12;
  while (openMidi + f <= abovePitch) f += 12;
  return f;
}

/** Close-position ascending voicing across N strings, min fret span. */
export function shape(strings: number[], pcs: number[]): number[] {
  const o = strings.map((s) => OPEN[s]);
  const base = ((pcs[0] - o[0]) % 12 + 12) % 12;
  let best: { score: number; frets: number[] } | null = null;
  for (const fLow of [base, base + 12]) {
    let prev = o[0] + fLow;
    const frets = [fLow];
    for (let i = 1; i < pcs.length; i++) {
      const f = lowestFret(o[i], pcs[i], prev);
      frets.push(f);
      prev = o[i] + f;
    }
    if (Math.max(...frets) > 18) continue;
    const span = Math.max(...frets) - Math.min(...frets);
    const score = span * 100 + Math.max(...frets);
    if (best === null || score < best.score) best = { score, frets };
  }
  return best!.frets;
}

/** Drop-2: from close inversion i, drop the 2nd-from-top voice an octave. */
export function drop2Order(T: number[], i: number): number[] {
  let prev = -1;
  const pit: number[] = [];
  for (let k = 0; k < 4; k++) {
    let p = T[(i + k) % 4];
    while (p <= prev) p += 12;
    pit.push(p);
    prev = p;
  }
  pit[2] -= 12;
  pit.sort((a, b) => a - b);
  return pit.map((p) => ((p % 12) + 12) % 12);
}

/** Voicings indexed by inversion (0=root..n-1), each = pitch-class order low→high. */
export function buildVoicings(root: Root, typeKey: string): number[][] {
  const t = chordTones(root, typeKey).tones;
  const T = t.map((x) => x.pc);
  const n = T.length;
  const out: number[][] = new Array(n);
  if (n === 3) {
    for (let i = 0; i < 3; i++) out[i] = [T[i], T[(i + 1) % 3], T[(i + 2) % 3]];
  } else {
    for (let i = 0; i < 4; i++) {
      const order = drop2Order(T, i);
      out[T.indexOf(order[0])] = order;
    }
    for (let i = 0; i < 4; i++) if (!out[i]) out[i] = drop2Order(T, i);
  }
  return out;
}

export function setsFor(typeKey: string): number[][] {
  return CHORDS[typeKey].n === 3
    ? [[6, 5, 4], [5, 4, 3], [4, 3, 2], [3, 2, 1]]
    : [[6, 5, 4, 3], [5, 4, 3, 2], [4, 3, 2, 1]];
}

/* ============================================================
 * NEW — Scales, modes, diatonic harmony, chord-scale colors
 * ============================================================ */

/** Interval sets (semitones from tonic). */
export const SCALES: Record<string, { iv: number[]; label: string }> = {
  major:        { iv: [0, 2, 4, 5, 7, 9, 11], label: "Major (Ionian)" },
  dorian:       { iv: [0, 2, 3, 5, 7, 9, 10], label: "Dorian" },
  phrygian:     { iv: [0, 1, 3, 5, 7, 8, 10], label: "Phrygian" },
  lydian:       { iv: [0, 2, 4, 6, 7, 9, 11], label: "Lydian" },
  mixolydian:   { iv: [0, 2, 4, 5, 7, 9, 10], label: "Mixolydian" },
  minor:        { iv: [0, 2, 3, 5, 7, 8, 10], label: "Natural Minor (Aeolian)" },
  locrian:      { iv: [0, 1, 3, 5, 6, 8, 10], label: "Locrian" },
  majorPent:    { iv: [0, 2, 4, 7, 9], label: "Major Pentatonic" },
  minorPent:    { iv: [0, 3, 5, 7, 10], label: "Minor Pentatonic" },
  blues:        { iv: [0, 3, 5, 6, 7, 10], label: "Blues" },
  harmonicMinor:{ iv: [0, 2, 3, 5, 7, 8, 11], label: "Harmonic Minor" },
  melodicMinor: { iv: [0, 2, 3, 5, 7, 9, 11], label: "Melodic Minor" },
};

/** Pitch classes of a scale built on a root pc. */
export function scalePcs(rootPc: number, scaleKey: string): number[] {
  return SCALES[scaleKey].iv.map((i) => (rootPc + i) % 12);
}

/** Spelled note names for a 7-note scale on a given root (correct letters). */
export function scaleSpelling(root: Root, scaleKey: string): string[] {
  const iv = SCALES[scaleKey].iv;
  if (iv.length !== 7) return iv.map((i) => spell(root.letter, (root.pc + i) % 12));
  return iv.map((i, idx) => spell(root.letter + idx, (root.pc + i) % 12));
}

export interface DiatonicChord {
  degree: number;          // 1..7
  roman: string;           // e.g. "I", "ii", "V7", "vii°"
  root: Root;
  triadKey: string;        // key into CHORDS
  seventhKey: string;      // key into CHORDS
}

const MAJOR_TRIADS = ["major", "minor", "minor", "major", "major", "minor", "dim"];
const MAJOR_SEVENTHS = ["maj7", "min7", "min7", "maj7", "dom7", "min7", "m7b5"];
const MINOR_TRIADS = ["minor", "dim", "major", "minor", "minor", "major", "major"];
const MINOR_SEVENTHS = ["min7", "m7b5", "maj7", "min7", "min7", "maj7", "dom7"];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

function romanFor(deg: number, triadKey: string): string {
  const base = ROMAN[deg];
  if (triadKey === "major" || triadKey === "aug") return base;
  if (triadKey === "dim") return base.toLowerCase() + "°";
  return base.toLowerCase();
}

/** Find (or synthesize) the Root entry matching a pc with the right letter. */
export function rootForPc(pc: number, letter: number): Root {
  const norm = ((letter % 7) + 7) % 7;
  const found = ROOTS.find((r) => r.pc === pc % 12 && r.letter === norm);
  return found ?? { name: spell(norm, pc % 12), letter: norm, pc: pc % 12 };
}

/** The 7 diatonic chords of a major or natural-minor key. */
export function diatonicChords(tonic: Root, mode: "major" | "minor"): DiatonicChord[] {
  const scaleKey = mode === "major" ? "major" : "minor";
  const iv = SCALES[scaleKey].iv;
  const triads = mode === "major" ? MAJOR_TRIADS : MINOR_TRIADS;
  const sevenths = mode === "major" ? MAJOR_SEVENTHS : MINOR_SEVENTHS;
  return iv.map((interval, idx) => {
    const pc = (tonic.pc + interval) % 12;
    const root = rootForPc(pc, tonic.letter + idx);
    return {
      degree: idx + 1,
      roman: romanFor(idx, triads[idx]),
      root,
      triadKey: triads[idx],
      seventhKey: sevenths[idx],
    };
  });
}

/** Identify the roman numeral of an arbitrary chord within a key (or null). */
export function romanInKey(root: Root, typeKey: string, tonic: Root, mode: "major" | "minor"): string | null {
  const dia = diatonicChords(tonic, mode);
  const kind = CHORDS[typeKey].kind;
  for (const d of dia) {
    if (d.root.pc !== root.pc) continue;
    if (kind === "triad" && d.triadKey === typeKey) return d.roman;
    if (kind === "seventh" && d.seventhKey === typeKey) return d.roman + "7";
  }
  return null;
}

/* ---------- Chord-scale map & color notes ---------- */

export type NoteRole = "target" | "bridge" | "color";

export interface ScaleChoice {
  scaleKey: string;          // key into SCALES
  scaleRootPc: number;       // pc the scale is built on
  label: string;             // human label, e.g. "C Lydian"
  colorPcs: number[];        // the notes that give this choice its flavor
  outside: boolean;          // true if it introduces non-key notes
  why: string;               // one-line teaching rationale
}

/**
 * Chord-scale map: for a chord functioning inside a key, which scales/colors apply.
 * This encodes the "melodic lenses" the co-writer reasons over.
 */
export function chordScaleChoices(chord: { root: Root; typeKey: string }, tonic: Root, mode: "major" | "minor"): ScaleChoice[] {
  const keyPcs = scalePcs(tonic.pc, mode === "major" ? "major" : "minor");
  const out: ScaleChoice[] = [];
  const rn = chord.root.name;
  const kind = CHORDS[chord.typeKey];
  const isMajorish = kind.iv[0] === 4;
  const isMinorish = kind.iv[0] === 3 && kind.iv[1] === 7;

  // Parent-key pentatonic bed (always available, never fights the changes)
  out.push({
    scaleKey: mode === "major" ? "majorPent" : "minorPent",
    scaleRootPc: tonic.pc,
    label: `${tonic.name} ${mode === "major" ? "major" : "minor"} pentatonic`,
    colorPcs: [],
    outside: false,
    why: "The singable bed — five notes that never fight any diatonic chord.",
  });

  if (isMajorish) {
    const lydPcs = scalePcs(chord.root.pc, "lydian");
    const sharp4 = (chord.root.pc + 6) % 12;
    const isFree = lydPcs.every((pc) => keyPcs.includes(pc));
    out.push({
      scaleKey: "lydian",
      scaleRootPc: chord.root.pc,
      label: `${rn} Lydian`,
      colorPcs: [sharp4],
      outside: !isFree,
      why: isFree
        ? `${rn} Lydian is free here — its ♯11 (${spell(chord.root.letter + 3, sharp4)}) is already in the key. Shimmer with no outside note.`
        : `Raise the 4th to ${spell(chord.root.letter + 3, sharp4)} — the Lydian ♯11 floats and sparkles over ${rn}.`,
    });
    // Mixolydian for dominant-function chords
    if (chord.typeKey === "dom7" || chord.typeKey === "major") {
      const mixPcs = scalePcs(chord.root.pc, "mixolydian");
      const b7 = (chord.root.pc + 10) % 12;
      out.push({
        scaleKey: "mixolydian",
        scaleRootPc: chord.root.pc,
        label: `${rn} Mixolydian`,
        colorPcs: [b7],
        outside: !mixPcs.every((pc) => keyPcs.includes(pc)),
        why: `The dominant sound — ♭7 (${spell(chord.root.letter + 6, b7)}) gives ${rn} its pull.`,
      });
    }
  }
  if (isMinorish) {
    const dorPcs = scalePcs(chord.root.pc, "dorian");
    const nat6 = (chord.root.pc + 9) % 12;
    out.push({
      scaleKey: "dorian",
      scaleRootPc: chord.root.pc,
      label: `${rn} Dorian`,
      colorPcs: [nat6],
      outside: !dorPcs.every((pc) => keyPcs.includes(pc)),
      why: `Dorian's natural 6 (${spell(chord.root.letter + 5, nat6)}) warms the minor color — hopeful instead of sad.`,
    });
  }

  // Blues color relative to the key tonic
  const b3 = (tonic.pc + 3) % 12;
  const b7k = (tonic.pc + 10) % 12;
  out.push({
    scaleKey: "blues",
    scaleRootPc: tonic.pc,
    label: `${tonic.name} blues`,
    colorPcs: mode === "major" ? [b3, b7k] : [(tonic.pc + 6) % 12],
    outside: true,
    why: mode === "major"
      ? `Blue notes — ♭3 (${spell(tonic.letter + 2, b3)}) and ♭7 (${spell(tonic.letter + 6, b7k)}) add grit and sweat.`
      : "The ♭5 blue note adds the growl.",
  });

  return out;
}

/** Classify a pitch class's role against a chord + key context. */
export function classifyPc(pc: number, chord: { root: Root; typeKey: string }, tonic: Root, mode: "major" | "minor"): NoteRole {
  const ct = chordTones(chord.root, chord.typeKey);
  if (ct.byPc[((pc % 12) + 12) % 12]) return "target";
  const keyPcs = scalePcs(tonic.pc, mode === "major" ? "major" : "minor");
  if (keyPcs.includes(((pc % 12) + 12) % 12)) return "bridge";
  return "color";
}

/** Guide-tone (3rd of each chord) line across a progression. */
export function guideTonePcs(chords: { root: Root; typeKey: string }[]): { pc: number; name: string }[] {
  return chords.map((c) => {
    const t = chordTones(c.root, c.typeKey).tones[1]; // the 3rd
    return { pc: t.pc, name: t.name };
  });
}

export function midiFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** Nearest MIDI note number for a frequency (+ cents offset). */
export function freqToMidi(f: number): { midi: number; cents: number } {
  const m = 69 + 12 * Math.log2(f / 440);
  const midi = Math.round(m);
  return { midi, cents: Math.round((m - midi) * 100) };
}

/** Map a MIDI note to a playable {string, fret} near a preferred fret region. */
export function midiToFretChoice(midi: number, preferFret = 5): { stringNum: number; fret: number } | null {
  let best: { stringNum: number; fret: number; score: number } | null = null;
  for (let s = 6; s >= 1; s--) {
    const fret = midi - OPEN[s];
    if (fret < 0 || fret > 18) continue;
    const score = Math.abs(fret - preferFret);
    if (!best || score < best.score) best = { stringNum: s, fret, score };
  }
  return best ? { stringNum: best.stringNum, fret: best.fret } : null;
}
