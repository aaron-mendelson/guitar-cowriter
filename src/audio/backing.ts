/* ============================================================
 * backing.ts — programmatic arrangement generator + drum synth.
 * Bass / keys / drums phrases locked to the progression, plus
 * synthesized kick/snare/hat routed to the `backing` channel.
 * ============================================================ */
import type { NoteEvent, Phrase } from "../engine/noteEvents";
import { type ChordSlot, type Song, slotRoot, slotVoicing, songLengthBeats, songTimeline } from "../engine/progression";
import { getCtx, masterBus } from "./context";

export interface Arrangement {
  drums: boolean;
  bass: boolean;
  keys: boolean;
  style: "rock" | "pop" | "ballad" | "funk";
}

/** General MIDI drum map subset used by generated drum phrases. */
export const DRUM_MIDI = { kick: 35, snare: 38, hat: 42 } as const;
export type DrumKind = keyof typeof DRUM_MIDI;

/* ---------- Phrase generation ---------- */

function bassRootMidi(slot: ChordSlot): number {
  // Root pitch class placed in octave 2 → midi 36..47.
  return 36 + slotRoot(slot).pc;
}

function bassEventsForSlot(slot: ChordSlot, slotStart: number, style: Arrangement["style"]): NoteEvent[] {
  const root = bassRootMidi(slot);
  const out: NoteEvent[] = [];
  const push = (offset: number, midi: number, dur: number, vel = 0.85): void => {
    if (offset < slot.beats) {
      out.push({ midi, startBeat: slotStart + offset, durBeat: Math.min(dur, slot.beats - offset), role: "target", vel });
    }
  };
  switch (style) {
    case "rock":
      for (let t = 0; t < slot.beats; t += 0.5) push(t, root, 0.45, t % 1 === 0 ? 0.9 : 0.7);
      break;
    case "pop":
      for (let bar = 0; bar < slot.beats; bar += 4) {
        push(bar, root, 1.9);
        push(bar + 2, root, 0.5);
        push(bar + 2.5, root + 7, 1.4, 0.75); // the fifth on 3.5
      }
      break;
    case "ballad":
      push(0, root, slot.beats);
      break;
    case "funk": {
      const pattern: { t: number; oct: 0 | 1; vel: number }[] = [
        { t: 0, oct: 0, vel: 1 },
        { t: 0.75, oct: 1, vel: 0.7 },
        { t: 1.5, oct: 0, vel: 0.8 },
        { t: 2, oct: 0, vel: 0.9 },
        { t: 2.5, oct: 1, vel: 0.7 },
        { t: 3.25, oct: 0, vel: 0.75 },
        { t: 3.75, oct: 1, vel: 0.65 },
      ];
      for (let bar = 0; bar < slot.beats; bar += 4) {
        for (const p of pattern) push(bar + p.t, root + p.oct * 12, 0.25, p.vel);
      }
      break;
    }
  }
  return out;
}

function drumEventsForBar(barStart: number, style: Arrangement["style"]): NoteEvent[] {
  const out: NoteEvent[] = [];
  const hit = (kind: DrumKind, offset: number, vel: number): void => {
    out.push({ midi: DRUM_MIDI[kind], startBeat: barStart + offset, durBeat: 0.25, role: "target", vel });
  };
  const hats = (step: number, vel = 0.5): void => {
    for (let t = 0; t < 4; t += step) hit("hat", t, t % 1 === 0 ? vel : vel * 0.7);
  };
  switch (style) {
    case "rock":
      hit("kick", 0, 1); hit("kick", 2, 0.9);
      hit("snare", 1, 0.9); hit("snare", 3, 0.9);
      hats(0.5, 0.55);
      break;
    case "pop":
      hit("kick", 0, 1); hit("kick", 2.5, 0.8);
      hit("snare", 1, 0.85); hit("snare", 3, 0.85);
      hats(0.5, 0.5);
      break;
    case "ballad":
      hit("kick", 0, 0.9);
      hit("snare", 2, 0.7);
      hats(1, 0.4);
      break;
    case "funk":
      hit("kick", 0, 1); hit("kick", 0.75, 0.7); hit("kick", 2.5, 0.85);
      hit("snare", 1, 0.9); hit("snare", 3, 0.9);
      hats(0.25, 0.45);
      break;
  }
  return out;
}

/** Generate bass / keys / drums phrases spanning the whole song, per the arrangement. */
export function backingPhrases(song: Song, arr: Arrangement): Phrase[] {
  const tl = songTimeline(song);
  const len = songLengthBeats(song);
  const phrases: Phrase[] = [];

  if (arr.bass) {
    const events: NoteEvent[] = [];
    for (const { slot, startBeat } of tl) events.push(...bassEventsForSlot(slot, startBeat, arr.style));
    phrases.push({ id: "backing-bass", label: "bass", lengthBeats: len, events, voice: "ai", method: `${arr.style} bass` });
  }

  if (arr.keys) {
    const events: NoteEvent[] = [];
    for (const { slot, startBeat } of tl) {
      const { midis } = slotVoicing(slot);
      for (const midi of midis) {
        events.push({ midi, startBeat, durBeat: slot.beats, role: "target", vel: 0.45 });
      }
    }
    phrases.push({ id: "backing-keys", label: "keys", lengthBeats: len, events, voice: "ai", method: "sustained pad" });
  }

  if (arr.drums) {
    const events: NoteEvent[] = [];
    for (let bar = 0; bar < len; bar += 4) events.push(...drumEventsForBar(bar, arr.style));
    phrases.push({ id: "backing-drums", label: "drums", lengthBeats: len, events, voice: "ai", method: `${arr.style} drums` });
  }

  return phrases;
}

/* ---------- Synthesized drum hits (backing channel) ---------- */

let noiseBuf: AudioBuffer | null = null;

function noiseBuffer(): AudioBuffer {
  if (noiseBuf) return noiseBuf;
  const ctx = getCtx();
  const n = Math.floor(ctx.sampleRate * 0.5);
  noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

/**
 * Play one synthesized drum hit at an ABSOLUTE ctx time, into the backing channel.
 * kick = sine with fast pitch+amp decay to ~60Hz territory,
 * snare = bandpassed noise burst, hat = highpassed noise ≥6kHz, very short.
 */
export function playDrum(kind: DrumKind, whenAbs: number, gain = 0.8): void {
  const ctx = getCtx();
  const out = masterBus().backing;
  if (kind === "kick") {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(120, whenAbs);
    osc.frequency.exponentialRampToValueAtTime(48, whenAbs + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, whenAbs);
    g.gain.exponentialRampToValueAtTime(0.001, whenAbs + 0.25);
    osc.connect(g);
    g.connect(out);
    osc.start(whenAbs);
    osc.stop(whenAbs + 0.3);
    return;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer();
  const f = ctx.createBiquadFilter();
  let dur: number;
  let level: number;
  if (kind === "snare") {
    f.type = "bandpass";
    f.frequency.value = 1800;
    f.Q.value = 0.8;
    dur = 0.12;
    level = gain * 0.7;
  } else {
    f.type = "highpass";
    f.frequency.value = 6000;
    dur = 0.04;
    level = gain * 0.5;
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(level, whenAbs);
  g.gain.exponentialRampToValueAtTime(0.001, whenAbs + dur);
  src.connect(f);
  f.connect(g);
  g.connect(out);
  src.start(whenAbs);
  src.stop(whenAbs + dur + 0.02);
}

/** Map a drum-phrase NoteEvent (GM midi 35/38/42) to a synthesized hit. Unknown midis are ignored. */
export function scheduleDrumEvent(ev: NoteEvent, whenAbs: number): void {
  const kind: DrumKind | null =
    ev.midi === DRUM_MIDI.kick ? "kick" : ev.midi === DRUM_MIDI.snare ? "snare" : ev.midi === DRUM_MIDI.hat ? "hat" : null;
  if (kind) playDrum(kind, whenAbs, ev.vel ?? 0.8);
}
