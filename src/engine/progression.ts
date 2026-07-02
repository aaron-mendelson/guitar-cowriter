/* ============================================================
 * progression.ts — song / section / chord-slot model.
 * ============================================================ */
import { CHORDS, ROOTS, type Root, chordTones, buildVoicings, setsFor, shape, OPEN } from "./theory";

export interface ChordSlot {
  rootIdx: number;        // index into ROOTS
  typeKey: string;        // key into CHORDS
  beats: number;          // duration in beats (4 = one bar of 4/4)
  setIdx: number;         // which string set
  invIdx: number;         // which inversion (drives the top note = melody lever)
}

export interface Section {
  id: string;
  name: string;           // "Verse", "Chorus", ...
  slots: ChordSlot[];
}

export interface Song {
  title: string;
  tonicIdx: number;       // index into ROOTS
  mode: "major" | "minor";
  bpm: number;
  sections: Section[];
}

export function slotRoot(slot: ChordSlot): Root {
  return ROOTS[slot.rootIdx];
}

export function slotLabel(slot: ChordSlot): string {
  const c = CHORDS[slot.typeKey];
  const suffix =
    slot.typeKey === "major" ? "" :
    slot.typeKey === "minor" ? "m" :
    slot.typeKey === "dim" ? "°" :
    slot.typeKey === "aug" ? "+" :
    slot.typeKey === "maj7" ? "maj7" :
    slot.typeKey === "dom7" ? "7" :
    slot.typeKey === "min7" ? "m7" :
    slot.typeKey === "m7b5" ? "m7♭5" :
    slot.typeKey === "dim7" ? "°7" : c.label;
  return slotRoot(slot).name + suffix;
}

/** Fretted voicing (string/fret/midi dots) for a slot. */
export function slotVoicing(slot: ChordSlot) {
  const root = slotRoot(slot);
  const { byPc } = chordTones(root, slot.typeKey);
  const voicings = buildVoicings(root, slot.typeKey);
  const sets = setsFor(slot.typeKey);
  const strings = sets[Math.min(slot.setIdx, sets.length - 1)];
  const pcs = voicings[Math.min(slot.invIdx, voicings.length - 1)];
  const frets = shape(strings, pcs);
  const dots = pcs.map((pc, i) => ({
    stringNum: strings[i],
    fret: frets[i],
    pc,
    tone: byPc[pc],
    midi: OPEN[strings[i]] + frets[i],
  }));
  return { strings, dots, midis: dots.map((d) => d.midi), topMidi: dots[dots.length - 1].midi };
}

/** Flattened timeline: each slot with absolute startBeat. */
export function songTimeline(song: Song): { slot: ChordSlot; section: Section; startBeat: number }[] {
  const out: { slot: ChordSlot; section: Section; startBeat: number }[] = [];
  let t = 0;
  for (const section of song.sections) {
    for (const slot of section.slots) {
      out.push({ slot, section, startBeat: t });
      t += slot.beats;
    }
  }
  return out;
}

export function songLengthBeats(song: Song): number {
  return song.sections.reduce((n, s) => n + s.slots.reduce((m, sl) => m + sl.beats, 0), 0);
}

/** Which chord governs a given beat position. */
export function chordAtBeat(song: Song, beat: number) {
  const tl = songTimeline(song);
  const total = songLengthBeats(song);
  const b = ((beat % total) + total) % total;
  for (let i = tl.length - 1; i >= 0; i--) {
    if (b >= tl[i].startBeat) return tl[i];
  }
  return tl[0];
}

export function serializeSong(song: Song): string {
  return JSON.stringify(song);
}
export function deserializeSong(s: string): Song {
  return JSON.parse(s) as Song;
}

let idCounter = 0;
export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

/** Convenience: build a one-section song from chord names like "C Am F G". */
export function songFromChordNames(names: string[], tonicIdx: number, mode: "major" | "minor", bpm = 90): Song {
  const slots: ChordSlot[] = names.map((raw) => {
    const m = raw.trim().match(/^([A-G](?:♯|#|♭|b)?)(.*)$/);
    const rootName = (m?.[1] ?? "C").replace("#", "♯").replace(/([A-G])b/, "$1♭");
    const rest = (m?.[2] ?? "").trim().toLowerCase();
    const rootIdx = Math.max(0, ROOTS.findIndex((r) => r.name === rootName));
    const typeKey =
      rest === "" ? "major" :
      rest === "m" || rest === "min" || rest === "minor" ? "minor" :
      rest === "maj7" || rest === "△7" ? "maj7" :
      rest === "7" ? "dom7" :
      rest === "m7" || rest === "min7" ? "min7" :
      rest === "m7b5" || rest === "ø" ? "m7b5" :
      rest === "dim" || rest === "°" ? "dim" :
      rest === "dim7" || rest === "°7" ? "dim7" :
      rest === "aug" || rest === "+" ? "aug" : "major";
    return { rootIdx, typeKey, beats: 4, setIdx: 1, invIdx: 0 };
  });
  return {
    title: "Untitled",
    tonicIdx,
    mode,
    bpm,
    sections: [{ id: newId("sec"), name: "Loop", slots }],
  };
}
