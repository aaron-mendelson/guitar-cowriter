/* ============================================================
 * quantize.ts — TrackedNotes (wall-clock seconds) → NoteEvents
 * (beats on a grid), relative to a phrase start time t0Sec.
 * ============================================================ */
import type { NoteEvent } from "../engine/noteEvents";
import type { TrackedNote } from "./pitchTrack";

/** Snap x to the nearest multiple of grid. */
export function snap(x: number, grid: number): number {
  return Math.round(x / grid) * grid;
}

/**
 * Convert tracked notes to NoteEvents relative to t0Sec.
 * - startBeat / durBeat snapped to `grid` (default 0.25 beat)
 * - durBeat floored at 0.25
 * - notes starting before t0Sec are dropped
 * - role is "target" as a placeholder; the caller re-classifies
 *   against the harmony with the engine's classifyPc.
 */
export function tracksToEvents(
  notes: TrackedNote[],
  bpm: number,
  t0Sec: number,
  opts?: { grid?: number },
): NoteEvent[] {
  const grid = opts?.grid ?? 0.25;
  const beatsPerSec = bpm / 60;
  const out: NoteEvent[] = [];
  for (const n of notes) {
    if (n.startSec < t0Sec) continue;
    const startBeat = snap((n.startSec - t0Sec) * beatsPerSec, grid);
    const durBeat = Math.max(0.25, snap(n.durSec * beatsPerSec, grid));
    out.push({ midi: n.midi, startBeat, durBeat, role: "target" });
  }
  return out.sort((a, b) => a.startBeat - b.startBeat);
}
