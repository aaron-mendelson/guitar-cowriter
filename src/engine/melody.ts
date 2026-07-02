/* ============================================================
 * melody.ts — the melodic toolkit ("sonic lenses").
 * Deterministic generators that turn a progression into candidate
 * melody material. The AI co-writer reasons over WHICH lens and
 * WHERE; these functions guarantee the notes are correct.
 * ============================================================ */
import {
  ROOTS, chordTones, scalePcs, classifyPc, guideTonePcs,
  type Root,
} from "./theory";
import { type Song, songTimeline, slotVoicing, slotRoot } from "./progression";
import { type NoteEvent, type Phrase, placeOnNeck, normalizePhrase } from "./noteEvents";
import { newId } from "./progression";

function tonic(song: Song): Root {
  return ROOTS[song.tonicIdx];
}

function role(pc: number, song: Song, chord: { root: Root; typeKey: string }) {
  return classifyPc(pc, chord, tonic(song), song.mode);
}

/** Lens 1 — top-note voice-leading: the melody the inversions already imply. */
export function topNoteLine(song: Song): Phrase {
  const tl = songTimeline(song);
  const events: NoteEvent[] = tl.map(({ slot, startBeat }) => {
    const v = slotVoicing(slot);
    return {
      midi: v.topMidi,
      startBeat,
      durBeat: slot.beats,
      role: "target" as const,
      vel: 0.8,
    };
  });
  return normalizePhrase({
    id: newId("ph"), label: "Top-note line", voice: "ai",
    lengthBeats: tl.length ? tl[tl.length - 1].startBeat + tl[tl.length - 1].slot.beats : 0,
    events, method: "top-note voice-leading",
  });
}

/** Lens 2 — guide-tone line: the 3rd of each chord, the emotional center. */
export function guideToneLine(song: Song, register = 64): Phrase {
  const tl = songTimeline(song);
  const gts = guideTonePcs(tl.map(({ slot }) => ({ root: slotRoot(slot), typeKey: slot.typeKey })));
  let prev = register;
  const events: NoteEvent[] = tl.map(({ slot, startBeat }, i) => {
    // choose the octave of the guide tone nearest the previous note
    const pc = gts[i].pc;
    let midi = prev + (((pc - prev) % 12) + 12) % 12;
    if (midi - prev > 6) midi -= 12;
    prev = midi;
    return { midi, startBeat: startBeat + 1, durBeat: slot.beats - 1, role: "target" as const, vel: 0.75 };
  });
  return normalizePhrase({
    id: newId("ph"), label: "Guide-tone line", voice: "ai",
    lengthBeats: tl.length ? tl[tl.length - 1].startBeat + tl[tl.length - 1].slot.beats : 0,
    events, method: "guide-tone line (3rds)",
  });
}

/** Lens 3 — pentatonic bed: a simple singable line from the key pentatonic. */
export function pentatonicBed(song: Song, seed = 1): Phrase {
  const t = tonic(song);
  const pent = scalePcs(t.pc, song.mode === "major" ? "majorPent" : "minorPent");
  const tl = songTimeline(song);
  const events: NoteEvent[] = [];
  let cursor = 62; // around D4
  let rng = seed;
  const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (const { slot, startBeat } of tl) {
    const chord = { root: slotRoot(slot), typeKey: slot.typeKey };
    const chordPcs = chordTones(chord.root, chord.typeKey).tones.map((x) => x.pc);
    // strong beat: nearest pentatonic note that is ALSO a chord tone (fall back to pentatonic)
    const strongPool = pent.filter((pc) => chordPcs.includes(pc));
    const pool = strongPool.length ? strongPool : pent;
    const pickNear = (cands: number[], from: number) => {
      let best = from, score = 99;
      for (const pc of cands) {
        for (const oct of [-12, 0, 12]) {
          const m = from + ((((pc - from) % 12) + 12) % 12) + oct - (((((pc - from) % 12) + 12) % 12) > 6 ? 12 : 0);
          const d = Math.abs(m - from);
          if (d < score && m >= 52 && m <= 76) { score = d; best = m; }
        }
      }
      return best;
    };
    cursor = pickNear(pool, cursor + (rand() > 0.5 ? 2 : -2));
    events.push({ midi: cursor, startBeat, durBeat: 1.5, role: role(cursor % 12, song, chord), vel: 0.8 });
    // breathe: one answering note on the "and of 2", rest the rest of the bar
    if (rand() > 0.35) {
      const next = pickNear(pent, cursor + (rand() > 0.5 ? 3 : -3));
      events.push({ midi: next, startBeat: startBeat + 2.5, durBeat: 1, role: role(next % 12, song, chord), vel: 0.7 });
      cursor = next;
    }
  }
  return normalizePhrase({
    id: newId("ph"), label: "Pentatonic sketch", voice: "ai",
    lengthBeats: tl.length ? tl[tl.length - 1].startBeat + tl[tl.length - 1].slot.beats : 0,
    events, method: "pentatonic bed",
  });
}

/** Lens 4 — chord-tone targets joined by bridge notes (approach tones). */
export function targetAndBridge(song: Song): Phrase {
  const tl = songTimeline(song);
  const keyPcs = scalePcs(tonic(song).pc, song.mode === "major" ? "major" : "minor");
  const events: NoteEvent[] = [];
  let prev = 64;
  for (let i = 0; i < tl.length; i++) {
    const { slot, startBeat } = tl[i];
    const chord = { root: slotRoot(slot), typeKey: slot.typeKey };
    const tones = chordTones(chord.root, chord.typeKey).tones;
    // target = 3rd on beat 1, held
    const targetPc = tones[1].pc;
    let target = prev + ((((targetPc - prev) % 12) + 12) % 12);
    if (target - prev > 6) target -= 12;
    events.push({ midi: target, startBeat, durBeat: 2.5, role: "target", vel: 0.85 });
    prev = target;
    // bridge into the NEXT chord's target on beat 4 / 4.5
    const next = tl[(i + 1) % tl.length];
    const nextTones = chordTones(slotRoot(next.slot), next.slot.typeKey).tones;
    const nextPc = nextTones[1].pc;
    let dest = prev + ((((nextPc - prev) % 12) + 12) % 12);
    if (dest - prev > 6) dest -= 12;
    const below = dest - 1;
    const diatonicBelow = keyPcs.includes(((below % 12) + 12) % 12);
    events.push({
      midi: below,
      startBeat: startBeat + slot.beats - 1,
      durBeat: 0.5,
      role: diatonicBelow ? "bridge" : "color",
      vel: 0.7,
    });
  }
  return normalizePhrase({
    id: newId("ph"), label: "Targets + bridges", voice: "ai",
    lengthBeats: tl.length ? tl[tl.length - 1].startBeat + tl[tl.length - 1].slot.beats : 0,
    events, method: "chord-tone targeting + bridge notes",
  });
}

/* ---------- Motif transforms (for motivic callback) ---------- */

export function transpose(events: NoteEvent[], semitones: number): NoteEvent[] {
  return placeOnNeck(events.map((e) => ({ ...e, midi: e.midi + semitones, stringNum: undefined, fret: undefined })));
}

export function invert(events: NoteEvent[], axisMidi?: number): NoteEvent[] {
  if (!events.length) return events;
  const axis = axisMidi ?? events[0].midi;
  return placeOnNeck(events.map((e) => ({ ...e, midi: axis - (e.midi - axis), stringNum: undefined, fret: undefined })));
}

export function augment(events: NoteEvent[], factor = 2): NoteEvent[] {
  return events.map((e) => ({ ...e, startBeat: e.startBeat * factor, durBeat: e.durBeat * factor }));
}

export function displace(events: NoteEvent[], beats: number): NoteEvent[] {
  return events.map((e) => ({ ...e, startBeat: e.startBeat + beats }));
}

/* ---------- Style-knob transforms: make the knobs physical ---------- */

export interface Knobs { density: number; chromaticism: number; feel: number; register: number }

/** Reshape a phrase according to the style knobs (0..1 each, 0.5 = neutral).
 *  density   — <0.4 thins to strong-beat notes; >0.6 adds pickup notes
 *  register  — transposes by octaves toward a target center (55..73)
 *  chromaticism — >0.6 converts bridge notes to chromatic approaches (color)
 *  feel      — >0.55 swings off-beat eighths later (up to ~0.12 beat)
 */
export function applyKnobs(phrase: Phrase, knobs: Knobs): Phrase {
  let events = [...phrase.events].sort((a, b) => a.startBeat - b.startBeat);

  // density: thin
  if (knobs.density < 0.4 && events.length > 2) {
    const keepEvery = knobs.density < 0.2 ? 2 : 3; // drop 1 of every N weak-beat notes
    let weakCount = 0;
    events = events.filter((e) => {
      const strong = Math.abs(e.startBeat - Math.round(e.startBeat)) < 0.01 && Math.round(e.startBeat) % 2 === 0;
      if (strong) return true;
      weakCount++;
      return weakCount % keepEvery !== 0;
    });
  }
  // density: add pickups into the next note
  if (knobs.density > 0.6) {
    const extra: NoteEvent[] = [];
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1], cur = events[i];
      const gap = cur.startBeat - (prev.startBeat + prev.durBeat);
      if (gap >= 0.5 && Math.abs(cur.midi - prev.midi) >= 2) {
        const step = cur.midi > prev.midi ? -2 : 2; // approach from a step away
        extra.push({
          midi: cur.midi + step, startBeat: cur.startBeat - 0.5, durBeat: 0.5,
          role: "bridge", vel: (cur.vel ?? 0.8) * 0.8,
        });
      }
      if (knobs.density > 0.85 && extra.length && i % 2 === 0) {
        // extra-busy: double the pickup an eighth earlier
        const p = extra[extra.length - 1];
        extra.push({ ...p, startBeat: p.startBeat - 0.5, midi: p.midi + (cur.midi > prev.midi ? -1 : 1) });
      }
    }
    events = [...events, ...extra].sort((a, b) => a.startBeat - b.startBeat);
  }
  // register: shift toward target center by whole octaves
  const target = 55 + knobs.register * 18;
  if (events.length) {
    const avg = events.reduce((n, e) => n + e.midi, 0) / events.length;
    const octaves = Math.round((target - avg) / 12);
    if (octaves !== 0) events = events.map((e) => ({ ...e, midi: e.midi + 12 * octaves }));
  }
  // chromaticism: sharpen bridge notes into chromatic approaches
  if (knobs.chromaticism > 0.6) {
    events = events.map((e, i) => {
      const next = events[i + 1];
      if (e.role === "bridge" && next && Math.abs(next.midi - e.midi) >= 2) {
        return { ...e, midi: next.midi + (next.midi > e.midi ? -1 : 1), role: "color" as const };
      }
      return e;
    });
  }
  // feel: swing the off-beat eighths late
  if (knobs.feel > 0.55) {
    const push = (knobs.feel - 0.5) * 0.24; // up to ~0.12 beat
    events = events.map((e) => {
      const frac = e.startBeat - Math.floor(e.startBeat);
      return Math.abs(frac - 0.5) < 0.05 ? { ...e, startBeat: e.startBeat + push } : e;
    });
  }

  return normalizePhrase({
    ...phrase,
    events: events.map((e) => ({ ...e, stringNum: undefined, fret: undefined })),
  });
}

/** All lenses, keyed — the menu the co-writer picks from. */
export const LENSES = {
  topNote: { label: "Top-note line", gen: topNoteLine, teach: "The top note of each chord voicing is already a melody — choosing inversions IS writing the top-line." },
  guideTone: { label: "Guide-tone line", gen: guideToneLine, teach: "The 3rd of each chord is its emotional center; connecting them makes a skeleton melody." },
  pentatonic: { label: "Pentatonic sketch", gen: pentatonicBed, teach: "The key pentatonic never fights the changes — a safe, singable bed." },
  targetBridge: { label: "Targets + bridges", gen: targetAndBridge, teach: "Land chord tones on strong beats; connect them with passing/approach tones for forward lean." },
} as const;

export type LensKey = keyof typeof LENSES;
