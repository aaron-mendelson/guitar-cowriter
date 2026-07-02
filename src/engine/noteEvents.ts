/* ============================================================
 * noteEvents.ts — the shared musical data contract.
 * Every layer (AI, audio, listening, UI) speaks NoteEvent.
 * ============================================================ */
import type { NoteRole } from "./theory";
import { midiToFretChoice } from "./theory";

export interface NoteEvent {
  /** MIDI note number */
  midi: number;
  /** start position in beats from the top of the phrase/loop */
  startBeat: number;
  /** duration in beats */
  durBeat: number;
  /** musical role vs. the underlying chord/key — drives dot coloring */
  role: NoteRole;
  /** optional playable position; filled by placeOnNeck when absent */
  stringNum?: number;
  fret?: number;
  /** optional articulation hint (slide, bend, hammer, pull) */
  art?: "slide" | "bend" | "hammer" | "pull";
  /** 0..1 velocity/emphasis */
  vel?: number;
}

export interface Phrase {
  id: string;
  label: string;
  /** total length in beats (phrase loops against the progression) */
  lengthBeats: number;
  events: NoteEvent[];
  /** which voice this phrase belongs to */
  voice: "ai" | "user";
  /** the melodic method used, e.g. "guide-tone line", "Lydian color" */
  method?: string;
}

/** Assign playable string/fret positions to any events missing them,
 * keeping consecutive notes near each other on the neck. */
export function placeOnNeck(events: NoteEvent[], preferFret = 5): NoteEvent[] {
  let anchor = preferFret;
  return events.map((e) => {
    if (e.stringNum != null && e.fret != null) {
      anchor = e.fret;
      return e;
    }
    const pos = midiToFretChoice(e.midi, anchor);
    if (pos) anchor = pos.fret;
    return pos ? { ...e, stringNum: pos.stringNum, fret: pos.fret } : e;
  });
}

/** Sort + sanity-clamp a phrase's events. */
export function normalizePhrase(p: Phrase): Phrase {
  const events = [...p.events]
    .filter((e) => e.midi >= 36 && e.midi <= 88 && e.startBeat >= 0 && e.durBeat > 0)
    .sort((a, b) => a.startBeat - b.startBeat)
    .map((e) => ({ ...e, startBeat: Math.min(e.startBeat, p.lengthBeats - 0.25) }));
  return { ...p, events: placeOnNeck(events) };
}
