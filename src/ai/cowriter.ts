/* ============================================================
 * cowriter.ts — the conversation engine.
 * Sends turns to Claude, then SANITIZES every option with the
 * theory engine (the correctness moat): the model's note events
 * are clamped, made monophonic, re-classified against the real
 * chord under each beat, and placed on the neck.
 * ============================================================ */
import type { CowriterTurn, MelodyOption } from "./schemas";
import { COWRITER_TURN_SCHEMA } from "./schemas";
import { callClaude } from "./client";
import { buildSystemPrompt, type PromptContext } from "./cowriterPrompt";
import { ROOTS, classifyPc } from "../engine/theory";
import {
  type Song, chordAtBeat, songLengthBeats, slotRoot,
} from "../engine/progression";
import { type NoteEvent, placeOnNeck } from "../engine/noteEvents";
import { LENSES } from "../engine/melody";

export interface CowriterSession {
  history: { role: "user" | "assistant"; content: string }[];
  frame: PromptContext["frame"];
}

export interface CowriterContext {
  song: Song | null;
  tasteNotes: string[];
  phraseExamples: string[];
}

const HISTORY_CAP = 20;

/* ---------------- sanitization (the correctness moat) ---------------- */

const MIDI_MIN = 36;
const MIDI_MAX = 88;

function foldMidi(midi: number): number {
  let m = Math.round(midi);
  while (m < MIDI_MIN) m += 12;
  while (m > MIDI_MAX) m -= 12;
  return m;
}

function sanitizeEvents(raw: NoteEvent[], song: Song | null): NoteEvent[] {
  const lengthBeats = song ? songLengthBeats(song) : Infinity;

  // 1. clamp/drop invalid events
  const cleaned: NoteEvent[] = [];
  for (const e of raw ?? []) {
    if (!Number.isFinite(e?.midi) || !Number.isFinite(e?.startBeat) || !Number.isFinite(e?.durBeat)) continue;
    if (e.durBeat <= 0 || e.startBeat < 0) continue;
    let startBeat = e.startBeat;
    let durBeat = e.durBeat;
    if (song && lengthBeats > 0) {
      if (startBeat >= lengthBeats) startBeat = ((startBeat % lengthBeats) + lengthBeats) % lengthBeats;
      durBeat = Math.min(durBeat, lengthBeats - startBeat);
      if (durBeat <= 0) continue;
    }
    cleaned.push({ ...e, midi: foldMidi(e.midi), startBeat, durBeat });
  }

  // 2. sort + enforce monophony: truncate the earlier note on overlap
  cleaned.sort((a, b) => a.startBeat - b.startBeat);
  const mono: NoteEvent[] = [];
  for (const e of cleaned) {
    const last = mono[mono.length - 1];
    if (last && e.startBeat < last.startBeat + last.durBeat) {
      const truncated = e.startBeat - last.startBeat;
      if (truncated <= 0) continue; // same start — drop the duplicate
      last.durBeat = truncated;
    }
    mono.push(e);
  }

  // 3. RE-CLASSIFY every role against the chord governing its startBeat —
  //    never trust the model's labels.
  const classified = song
    ? mono.map((e) => {
        const { slot } = chordAtBeat(song, e.startBeat);
        const chord = { root: slotRoot(slot), typeKey: slot.typeKey };
        return { ...e, role: classifyPc(e.midi % 12, chord, ROOTS[song.tonicIdx], song.mode) };
      })
    : mono;

  // 4. make it playable
  return placeOnNeck(classified);
}

/** Pure sanitizer, exported for tests: fixes a whole CowriterTurn. */
export function sanitizeTurn(turn: CowriterTurn, song: Song | null): CowriterTurn {
  const options = (turn.options ?? []).slice(0, 3).map((opt): MelodyOption => ({
    character: opt.character ?? "",
    method: opt.method ?? "",
    teaching: opt.teaching ?? "",
    events: sanitizeEvents(opt.events ?? [], song),
  }));
  return {
    say: turn.say ?? "",
    options,
    ...(turn.nudge != null ? { nudge: turn.nudge } : {}),
    ...(turn.progressionSuggestion != null
      ? { progressionSuggestion: turn.progressionSuggestion }
      : {}),
  };
}

/* ---------------- the live conversation turn ---------------- */

export async function cowriterTurn(
  session: CowriterSession,
  userText: string,
  ctx: CowriterContext,
): Promise<CowriterTurn> {
  const system = buildSystemPrompt({
    song: ctx.song,
    frame: session.frame,
    tasteNotes: ctx.tasteNotes,
    phraseExamples: ctx.phraseExamples,
  });

  const messages = [...session.history, { role: "user" as const, content: userText }];

  const raw = await callClaude({
    system,
    messages,
    toolName: "cowriter_turn",
    toolDescription:
      "Respond as the bandmate: a concise conversational reply, 1-3 playable melody options with note events, and a next-step nudge.",
    schema: COWRITER_TURN_SCHEMA,
    maxTokens: 4096,
  });

  const turn = sanitizeTurn(raw as CowriterTurn, ctx.song);

  session.history.push({ role: "user", content: userText });
  session.history.push({ role: "assistant", content: JSON.stringify(turn) });
  if (session.history.length > HISTORY_CAP) {
    session.history = session.history.slice(-HISTORY_CAP);
  }

  return turn;
}

/** Specialized turn: react to the guitarist's played-back variation. */
export async function reactToVariant(
  session: CowriterSession,
  diffSummary: string,
  ctx: CowriterContext,
): Promise<CowriterTurn> {
  const userText =
    "I played your line back with these changes: " +
    diffSummary +
    " — react to my variation as creative intent; if you like a change, lean into it (adjust the line or harmony); propose ONE refined option.";
  return cowriterTurn(session, userText, ctx);
}

/* ---------------- no-AI fallback ---------------- */

const OFFLINE_CHARACTERS: Record<string, string> = {
  topNote: "anchored",
  guideTone: "soulful",
  pentatonic: "singable",
};

/** Fully offline turn: 3 real options from the deterministic lenses. */
export function offlineTurn(_userText: string, ctx: CowriterContext): CowriterTurn {
  const song = ctx.song;
  if (!song) {
    return {
      say:
        "I can work without a connection, but I need chords to play over. Give me a progression — even just \"C Am F G\" — and I'll bring you three lines.",
      options: [],
      nudge: "Type a few chord names to set the loop.",
    };
  }

  const lensKeys = ["topNote", "guideTone", "pentatonic"] as const;
  const options: MelodyOption[] = lensKeys.map((key) => {
    const lens = LENSES[key];
    const phrase = lens.gen(song);
    return {
      character: OFFLINE_CHARACTERS[key],
      method: phrase.method ?? lens.label,
      teaching: lens.teach,
      events: phrase.events,
    };
  });

  const turn: CowriterTurn = {
    say:
      "Working offline, so I'll lean on the fundamentals — three lines straight from the changes: the top notes your voicings already imply, the guide-tone line through the 3rds (the emotional center of each chord), and a pentatonic sketch that never fights the harmony.",
    options,
    nudge: "Play the guide-tone line once through, then bend one note and see what it asks for next.",
  };
  return sanitizeTurn(turn, song);
}
