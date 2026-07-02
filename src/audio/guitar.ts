/* ============================================================
 * guitar.ts — Karplus-Strong plucked guitar.
 * Direct port of the proven Fretboard Explorer implementation,
 * routed into the shared mixer's `guitar` channel by default.
 * ============================================================ */
import { midiFreq } from "../engine/theory";
import { getCtx, masterBus } from "./context";

const bufCache = new Map<number, AudioBuffer>();

function ksBuffer(midi: number): AudioBuffer {
  const cached = bufCache.get(midi);
  if (cached) return cached;
  const ctx = getCtx();
  const sr = ctx.sampleRate;
  const f = midiFreq(midi);
  const N = Math.floor(sr * 1.7);
  const p = Math.max(2, Math.round(sr / f));
  const buf = ctx.createBuffer(1, N, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < N; i++) {
    if (i < p) {
      d[i] = Math.random() * 2 - 1;
    } else {
      d[i] = 0.9994 * 0.5 * (d[i - p] + d[i - p + 1]);
    }
  }
  const fade = Math.floor(sr * 0.06);
  for (let i = 0; i < fade; i++) d[N - 1 - i] *= i / fade;
  bufCache.set(midi, buf);
  return buf;
}

/**
 * Pluck a single note.
 * @param whenAbs ABSOLUTE AudioContext time; omit to play immediately.
 * @param destination optional routing override (defaults to the `guitar` bus channel).
 */
export function playGuitarMidi(midi: number, whenAbs?: number, gain = 0.5, destination?: AudioNode): void {
  const ctx = getCtx();
  const src = ctx.createBufferSource();
  src.buffer = ksBuffer(midi);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 3600;
  lp.Q.value = 0.4;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(lp);
  lp.connect(g);
  g.connect(destination ?? masterBus().guitar);
  src.start(whenAbs ?? ctx.currentTime);
}

/**
 * Strum a chord low→high with a 55ms stagger per string.
 * @param whenAbs ABSOLUTE AudioContext time of the first (lowest) pluck.
 */
export function strumGuitar(midis: number[], whenAbs?: number, gain = 0.44, destination?: AudioNode): void {
  const base = whenAbs ?? getCtx().currentTime;
  midis
    .slice()
    .sort((a, b) => a - b)
    .forEach((m, i) => playGuitarMidi(m, base + i * 0.055, gain, destination));
}
