/* ============================================================
 * midiVoice.ts — the AI's distinct voice.
 * A smplr SoundFont instrument routed into the `ai` bus channel,
 * plus an optional Web MIDI passthrough for external synths.
 * ============================================================ */
import { Soundfont } from "smplr";
import { getCtx, masterBus } from "./context";

/** General-MIDI instrument names valid for smplr's Soundfont loader. */
export const AVAILABLE_VOICES = [
  "electric_piano_1",
  "vibraphone",
  "muted_trumpet",
  "synth_strings_1",
  "acoustic_grand_piano",
  "pad_2_warmth",
] as const;

export type AiVoiceName = (typeof AVAILABLE_VOICES)[number];

let inst: Soundfont | null = null;
let ready = false;
let loadedName: string | null = null;

/** Load (or swap) the AI voice. Resolves when samples are ready to play. */
export async function loadAiVoice(name: string = "electric_piano_1"): Promise<void> {
  if (inst && ready && loadedName === name) return;
  ready = false;
  if (inst) {
    inst.dispose();
    inst = null;
  }
  const ctx = getCtx();
  const next = Soundfont(ctx, { instrument: name, destination: masterBus().ai });
  inst = next;
  await next.ready;
  // Ignore stale loads if a newer loadAiVoice call replaced us mid-flight.
  if (inst === next) {
    ready = true;
    loadedName = name;
  }
}

export function aiVoiceReady(): boolean {
  return ready;
}

/**
 * Schedule one AI note at an ABSOLUTE ctx time.
 * @param vel 0..1 (converted to MIDI 0-127 internally).
 * Silently no-ops if the voice has not finished loading.
 * Also mirrors to Web MIDI when an output is selected.
 */
export function playAiNote(midi: number, whenAbs: number, durSec: number, vel = 0.8): void {
  if (inst && ready) {
    inst.start({
      note: midi,
      time: whenAbs,
      duration: durSec,
      velocity: Math.max(1, Math.min(127, Math.round(vel * 127))),
    });
  }
  sendWebMidi(midi, whenAbs, durSec, vel);
}

/* ---------- Web MIDI passthrough (optional, silently no-ops) ---------- */

let midiAccess: MIDIAccess | null = null;
let midiOut: MIDIOutput | null = null;

/** Request Web MIDI access. Returns false when unsupported or denied. */
export async function initWebMidi(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("requestMIDIAccess" in navigator)) return false;
  try {
    midiAccess = await navigator.requestMIDIAccess();
    return true;
  } catch {
    return false;
  }
}

export function listMidiOuts(): { id: string; name: string }[] {
  if (!midiAccess) return [];
  return [...midiAccess.outputs.values()].map((o) => ({ id: o.id, name: o.name ?? o.id }));
}

/** Select a MIDI output by id (pass null to deselect). */
export function selectMidiOut(id: string | null): void {
  midiOut = id !== null && midiAccess ? midiAccess.outputs.get(id) ?? null : null;
}

/**
 * Send note-on/note-off to the selected Web MIDI output.
 * Silently no-ops when no output is selected.
 */
export function sendWebMidi(midi: number, whenAbs: number, durSec: number, vel = 0.8): void {
  if (!midiOut) return;
  const ctx = getCtx();
  const delayMs = Math.max(0, (whenAbs - ctx.currentTime) * 1000);
  const t = performance.now() + delayMs;
  const note = midi & 0x7f;
  const v = Math.max(1, Math.min(127, Math.round(vel * 127)));
  midiOut.send([0x90, note, v], t);
  midiOut.send([0x80, note, 0], t + Math.max(10, durSec * 1000));
}
