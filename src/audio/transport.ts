/* ============================================================
 * transport.ts — lookahead sequencer over the raw AudioContext
 * clock (25ms tick, 120ms schedule-ahead window). No Tone.js.
 * ============================================================ */
import type { Phrase } from "../engine/noteEvents";
import { type Song, slotVoicing, songLengthBeats, songTimeline } from "../engine/progression";
import { getCtx, masterBus } from "./context";
import { playGuitarMidi, strumGuitar } from "./guitar";
import { playAiNote } from "./midiVoice";
import { scheduleDrumEvent } from "./backing";

const TICK_MS = 25;
const LOOKAHEAD_SEC = 0.12;
const EPS = 1e-9;

/* ---------- Pure helpers (unit-tested without an AudioContext) ---------- */

/** Seconds per beat at a given tempo. */
export function beatDurSec(bpm: number): number {
  return 60 / bpm;
}

/** Wrap a beat position into [loopStart, loopEnd). Degenerate regions clamp to loopStart. */
export function wrapBeat(beat: number, loopStart: number, loopEnd: number): number {
  const len = loopEnd - loopStart;
  if (len <= 0) return loopStart;
  return loopStart + ((((beat - loopStart) % len) + len) % len);
}

/* ---------- Transport ---------- */

export interface TransportState {
  playing: boolean;
  bpm: number;
  loop: boolean;
  loopStartBeat: number;
  loopEndBeat: number;
  posBeat: number;
  countIn: boolean;
  clickOn: boolean;
}

export interface NoteScheduledEvent {
  phraseId: string;
  eventIdx: number;
  voice: "ai" | "user";
  atCtxTime: number;
}

interface ChordEvent {
  startBeat: number;
  midis: number[];
}

export class Transport {
  state: TransportState = {
    playing: false,
    bpm: 120,
    loop: false,
    loopStartBeat: 0,
    loopEndBeat: 4,
    posBeat: 0,
    countIn: false,
    clickOn: true,
  };

  private songLen = 0;
  private chordEvents: ChordEvent[] = [];
  private phrases: Phrase[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private cursorBeat = 0; // song-position beats (next unscheduled position)
  private cursorTime = 0; // absolute ctx time of cursorBeat
  private beatCbs = new Set<(beat: number) => void>();
  private noteCbs = new Set<(ev: NoteScheduledEvent) => void>();

  /** Set the progression: one strum (guitar timbre → backing channel) at each slot start. */
  setSong(song: Song): void {
    this.songLen = songLengthBeats(song);
    this.state.bpm = song.bpm;
    this.chordEvents = songTimeline(song).map((e) => ({
      startBeat: e.startBeat,
      midis: slotVoicing(e.slot).midis,
    }));
  }

  /** Set melodic phrases: voice "ai" → AI voice, voice "user" → plucked guitar, label "drums" → drum synth. */
  setPhrases(phrases: Phrase[]): void {
    this.phrases = phrases;
  }

  play(fromBeat?: number): void {
    if (this.state.playing) this.stop();
    const ctx = getCtx();
    masterBus(); // ensure the mixer exists before anything is scheduled
    const [wrapStart, wrapEnd] = this.wrapRegion();
    let from = fromBeat ?? this.state.posBeat;
    from = wrapBeat(from, wrapStart, wrapEnd);
    this.cursorBeat = from;
    this.state.posBeat = from;

    const spb = beatDurSec(this.state.bpm);
    let start = ctx.currentTime + 0.1;
    if (this.state.countIn) {
      for (let i = 0; i < 4; i++) this.scheduleClick(start + i * spb, i === 0);
      start += 4 * spb;
    }
    this.cursorTime = start;
    this.state.playing = true;
    this.intervalId = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  /** Stop scheduling. Already-scheduled sources are left to ring out. */
  stop(): void {
    this.state.playing = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.state.posBeat = this.cursorBeat;
  }

  setBpm(n: number): void {
    if (n > 0 && Number.isFinite(n)) this.state.bpm = n;
    // The scheduler advances incrementally from cursorTime, so a bpm change
    // simply applies to every segment scheduled from here on.
  }

  setLoop(startBeat: number, endBeat: number, on: boolean): void {
    this.state.loopStartBeat = startBeat;
    this.state.loopEndBeat = endBeat;
    this.state.loop = on;
  }

  /** Subscribe to the playhead: fires (near) each beat with the song-position beat number. */
  onBeat(cb: (beat: number) => void): () => void {
    this.beatCbs.add(cb);
    return () => this.beatCbs.delete(cb);
  }

  /** Subscribe to note scheduling: fires when a phrase note is scheduled, with its absolute ctx time. */
  onNote(cb: (ev: NoteScheduledEvent) => void): () => void {
    this.noteCbs.add(cb);
    return () => this.noteCbs.delete(cb);
  }

  /* ---------- internals ---------- */

  private wrapRegion(): [number, number] {
    if (this.state.loop && this.state.loopEndBeat > this.state.loopStartBeat) {
      return [this.state.loopStartBeat, this.state.loopEndBeat];
    }
    let end = this.songLen;
    if (end <= 0) {
      for (const p of this.phrases) end = Math.max(end, p.lengthBeats);
    }
    return [0, end > 0 ? end : 4];
  }

  private tick(): void {
    if (!this.state.playing) return;
    const ctx = getCtx();
    const horizon = ctx.currentTime + LOOKAHEAD_SEC;
    let guard = 0;
    while (this.cursorTime < horizon && guard++ < 1024) {
      const spb = beatDurSec(this.state.bpm);
      const [wrapStart, wrapEnd] = this.wrapRegion();
      if (this.cursorBeat < wrapStart - EPS || this.cursorBeat >= wrapEnd - EPS) {
        this.cursorBeat = wrapStart;
      }
      const segStart = this.cursorBeat;
      const segEnd = Math.min(Math.floor(segStart + EPS) + 1, wrapEnd);
      const segLen = segEnd - segStart;
      if (segLen <= EPS) break; // degenerate region; nothing schedulable

      // Playhead + click on integer beats.
      if (Math.abs(segStart - Math.round(segStart)) < 1e-6) {
        const beat = Math.round(segStart);
        if (this.state.clickOn) this.scheduleClick(this.cursorTime, beat % 4 === 0);
        this.fireBeat(beat, this.cursorTime);
      }

      // Chord strums at slot starts (guitar timbre → backing channel).
      for (const ce of this.chordEvents) {
        if (ce.startBeat >= segStart - EPS && ce.startBeat < segEnd - EPS) {
          strumGuitar(ce.midis, this.cursorTime + (ce.startBeat - segStart) * spb, 0.4, masterBus().backing);
        }
      }

      // Phrase notes (phrases loop against the progression by their own length).
      for (const p of this.phrases) {
        this.schedulePhraseSegment(p, segStart, segEnd, spb);
      }

      this.cursorTime += segLen * spb;
      this.cursorBeat = segEnd;
      if (this.cursorBeat >= wrapEnd - EPS) this.cursorBeat = wrapStart;
    }
  }

  private schedulePhraseSegment(p: Phrase, segStart: number, segEnd: number, spb: number): void {
    const L = p.lengthBeats;
    if (L <= 0) return;
    const isDrums = p.label === "drums";
    p.events.forEach((ev, eventIdx) => {
      // Occurrences of this event live at k*L + ev.startBeat; find the one inside the segment.
      const k = Math.ceil((segStart - ev.startBeat) / L - EPS);
      const occ = k * L + ev.startBeat;
      if (occ < segStart - EPS || occ >= segEnd - EPS) return;
      const when = this.cursorTime + (occ - segStart) * spb;
      const durSec = ev.durBeat * spb;
      if (isDrums) {
        scheduleDrumEvent(ev, when);
      } else if (p.voice === "ai") {
        playAiNote(ev.midi, when, durSec, ev.vel ?? 0.8);
      } else {
        playGuitarMidi(ev.midi, when, 0.5 * (ev.vel ?? 1));
      }
      const info: NoteScheduledEvent = { phraseId: p.id, eventIdx, voice: p.voice, atCtxTime: when };
      for (const cb of this.noteCbs) cb(info);
    });
  }

  private fireBeat(beat: number, atCtxTime: number): void {
    const delayMs = Math.max(0, (atCtxTime - getCtx().currentTime) * 1000);
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (!this.state.playing) return;
      this.state.posBeat = beat;
      for (const cb of this.beatCbs) cb(beat);
    }, delayMs);
    this.timers.add(id);
  }

  /** Short synthesized metronome tick: 1000Hz downbeats / 800Hz others, ~20ms decay. */
  private scheduleClick(whenAbs: number, downbeat: boolean): void {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = downbeat ? 1000 : 800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, whenAbs);
    g.gain.exponentialRampToValueAtTime(0.001, whenAbs + 0.02);
    osc.connect(g);
    g.connect(masterBus().click);
    osc.start(whenAbs);
    osc.stop(whenAbs + 0.03);
  }
}

let transport: Transport | null = null;

/** Singleton transport. */
export function getTransport(): Transport {
  if (!transport) transport = new Transport();
  return transport;
}
