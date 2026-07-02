/* ============================================================
 * audioFacade.ts — single integration point between the UI and
 * the audio/listening layers. All cross-layer wiring lives here
 * so API drift is fixed in one file.
 * ============================================================ */
import type { Song } from "../engine/progression";
import type { Phrase, NoteEvent } from "../engine/noteEvents";
import { useStore } from "../state/store";

// Audio layer (built by the audio workstream)
import { getTransport } from "../audio/transport";
import { playGuitarMidi } from "../audio/guitar";
import { loadAiVoice, aiVoiceReady, playAiNote } from "../audio/midiVoice";
import { listAudioInputs, openInput, closeInput, inputStream, setChannelGain, muteChannel, channelMeter } from "../audio/mixer";
// Listening layer
import { PitchTracker, type TrackedNote } from "../listen/pitchTrack";
import { tracksToEvents } from "../listen/quantize";
import { getCtx } from "../audio/context";

export { listAudioInputs, setChannelGain, muteChannel, channelMeter, closeInput };

let wired = false;

/** Wire transport → store mirrors once. */
export function ensureWired(): void {
  if (wired) return;
  wired = true;
  const t = getTransport();
  t.onBeat((beat: number) => {
    useStore.getState().setPosBeat(beat);
  });
}

export async function prepareVoices(): Promise<void> {
  if (!aiVoiceReady()) await loadAiVoice();
}

export function applySong(song: Song | null): void {
  ensureWired();
  const t = getTransport();
  if (song) {
    t.setBpm(song.bpm);
    t.setSong(song);
    useStore.getState().setBpm(song.bpm);
  }
}

export function applyPhrases(phrases: Phrase[]): void {
  ensureWired();
  getTransport().setPhrases(phrases);
}

export async function play(fromBeat = 0): Promise<void> {
  ensureWired();
  await prepareVoices();
  getTransport().play(fromBeat);
  useStore.getState().setPlaying(true);
}

export function stop(): void {
  getTransport().stop();
  const st = useStore.getState();
  st.setPlaying(false);
  st.setPosBeat(0);
}

export function setBpm(n: number): void {
  getTransport().setBpm(n);
  useStore.getState().setBpm(n);
}

export function pluck(midi: number): void {
  playGuitarMidi(midi);
}

/** Audition a phrase once, immediately, in the right voice (no transport). */
export async function auditionPhrase(phrase: Phrase, bpm: number): Promise<void> {
  await prepareVoices();
  const ctx = getCtx();
  const t0 = ctx.currentTime + 0.08;
  const spb = 60 / bpm;
  for (const e of phrase.events) {
    const when = t0 + e.startBeat * spb;
    const dur = Math.max(0.12, e.durBeat * spb);
    if (phrase.voice === "ai") playAiNote(e.midi, when, dur, e.vel ?? 0.8);
    else playGuitarMidi(e.midi, when, (e.vel ?? 0.8) * 0.6);
  }
}

/* ---------------- listening / capture ---------------- */

let tracker: PitchTracker | null = null;
let captureT0 = 0;

export async function startCapture(deviceId: string | null): Promise<void> {
  await openInput(deviceId ?? undefined);
  const stream = inputStream();
  if (!stream) throw new Error("No input stream — check mic permission / device.");
  const ctx = getCtx();
  tracker = new PitchTracker(ctx, stream);
  captureT0 = ctx.currentTime;
  tracker.start();
  useStore.getState().setListening(true);
}

export function stopCapture(bpm: number): NoteEvent[] {
  const st = useStore.getState();
  st.setListening(false);
  if (!tracker) return [];
  const notes: TrackedNote[] = tracker.stop();
  tracker = null;
  return tracksToEvents(notes, bpm, captureT0);
}
