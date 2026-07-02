/* ============================================================
 * pitchTrack.ts — monophonic pitch + onset tracking.
 * Turns live guitar/hum input into TrackedNotes via pitchy's
 * McLeod pitch method on an AnalyserNode tap.
 * No React. Browser-only at runtime (AudioContext), but the
 * module itself compiles standalone.
 * ============================================================ */
import { PitchDetector } from "pitchy";
import { freqToMidi } from "../engine/theory";

export interface TrackedNote {
  midi: number;
  cents: number;
  startSec: number;
  durSec: number;
  rms: number;
}

export interface PitchTrackerOpts {
  /** RMS gate below which input is treated as silence. Default 0.01 */
  minRms?: number;
  /** Notes shorter than this are discarded. Default 0.09s */
  minDurSec?: number;
  /** Inclusive MIDI range accepted (guitar-ish). Default [40, 88] */
  midiRange?: [number, number];
}

const CLARITY_THRESHOLD = 0.9;
const POLL_MS = 30;
const FFT_SIZE = 2048;

interface Frame {
  midi: number;
  cents: number;
  rms: number;
  tSec: number;
}

interface ActiveNote {
  frames: Frame[];
  startSec: number;
  lastSec: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export class PitchTracker {
  private ctx: AudioContext;
  private analyser: AnalyserNode;
  private tap: AudioNode;
  private detector: PitchDetector<Float32Array>;
  private buf: Float32Array<ArrayBuffer>;

  private minRms: number;
  private minDurSec: number;
  private midiRange: [number, number];

  private timer: ReturnType<typeof setInterval> | null = null;
  private active: ActiveNote | null = null;
  /** Candidate new-semitone frames awaiting 2-consecutive confirmation. */
  private pending: { midi: number; frames: Frame[] } | null = null;
  private finalized: TrackedNote[] = [];
  private listeners = new Set<(n: TrackedNote) => void>();
  private instant: { midi: number | null; cents: number; rms: number } = {
    midi: null,
    cents: 0,
    rms: 0,
  };

  constructor(ctx: AudioContext, source: AudioNode | MediaStream, opts?: PitchTrackerOpts) {
    this.ctx = ctx;
    this.minRms = opts?.minRms ?? 0.01;
    this.minDurSec = opts?.minDurSec ?? 0.09;
    this.midiRange = opts?.midiRange ?? [40, 88];

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.tap =
      source instanceof AudioNode ? source : ctx.createMediaStreamSource(source);
    this.tap.connect(this.analyser);

    this.detector = PitchDetector.forFloat32Array(this.analyser.fftSize);
    this.buf = new Float32Array(this.analyser.fftSize);
  }

  /** Begin polling the analyser (~every 30ms). Idempotent. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  /** Stop polling, finalize any in-flight note, return all finalized notes. */
  stop(): TrackedNote[] {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.endActive(this.ctx.currentTime);
    this.pending = null;
    try {
      this.tap.disconnect(this.analyser);
    } catch {
      /* already disconnected — fine */
    }
    return [...this.finalized];
  }

  /** Subscribe to notes as they finalize (note-off detected). Returns unsubscribe. */
  onNote(cb: (n: TrackedNote) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Instantaneous reading for a live tuner-style UI. midi is null on silence/noise. */
  current(): { midi: number | null; cents: number; rms: number } {
    return { ...this.instant };
  }

  /* ---------- internals ---------- */

  private poll(): void {
    this.analyser.getFloatTimeDomainData(this.buf);

    let sumSq = 0;
    for (let i = 0; i < this.buf.length; i++) sumSq += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sumSq / this.buf.length);

    const [freq, clarity] = this.detector.findPitch(this.buf, this.ctx.sampleRate);
    const now = this.ctx.currentTime;

    let midi: number | null = null;
    let cents = 0;
    if (clarity >= CLARITY_THRESHOLD && rms > this.minRms && freq > 0) {
      const conv = freqToMidi(freq);
      if (conv.midi >= this.midiRange[0] && conv.midi <= this.midiRange[1]) {
        midi = conv.midi;
        cents = conv.cents;
      }
    }
    this.instant = { midi, cents, rms };

    if (midi === null) {
      // Silence / noise / out of range → note-off for any active note.
      this.endActive(now);
      this.pending = null;
      return;
    }

    const frame: Frame = { midi, cents, rms, tSec: now };

    if (!this.active) {
      this.active = { frames: [frame], startSec: now, lastSec: now };
      this.pending = null;
      return;
    }

    const activeMidi = Math.round(median(this.active.frames.map((f) => f.midi)));
    if (Math.abs(midi - activeMidi) >= 1) {
      // Possible new note — require 2 consecutive frames at the new semitone.
      if (this.pending && this.pending.midi === midi) {
        this.pending.frames.push(frame);
        if (this.pending.frames.length >= 2) {
          const newStart = this.pending.frames[0].tSec;
          this.endActive(newStart);
          this.active = {
            frames: [...this.pending.frames],
            startSec: newStart,
            lastSec: now,
          };
          this.pending = null;
        }
      } else {
        this.pending = { midi, frames: [frame] };
      }
    } else {
      // Same semitone — continue the active note.
      this.pending = null;
      this.active.frames.push(frame);
      this.active.lastSec = now;
    }
  }

  private endActive(endSec: number): void {
    const note = this.active;
    this.active = null;
    if (!note) return;
    const durSec = Math.max(endSec, note.lastSec) - note.startSec;
    if (durSec < this.minDurSec) return;

    const finalMidi = Math.round(median(note.frames.map((f) => f.midi)));
    const matching = note.frames.filter((f) => f.midi === finalMidi);
    const centsSrc = matching.length > 0 ? matching : note.frames;
    const finalCents = Math.round(median(centsSrc.map((f) => f.cents)));
    const meanRms =
      note.frames.reduce((acc, f) => acc + f.rms, 0) / note.frames.length;

    const tracked: TrackedNote = {
      midi: finalMidi,
      cents: finalCents,
      startSec: note.startSec,
      durSec,
      rms: meanRms,
    };
    this.finalized.push(tracked);
    for (const cb of this.listeners) cb(tracked);
  }
}
