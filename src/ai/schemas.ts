/* ============================================================
 * schemas.ts — the structured contract between the AI co-writer
 * and the app. The model MUST return CowriterTurn-shaped JSON via
 * a forced tool call; these types + JSON schemas define it.
 * ============================================================ */
import type { NoteEvent } from "../engine/noteEvents";

/** The session frame parsed from free-form intent (the KEYSTONE). */
export interface SessionFrame {
  have: {
    kind: "progression" | "riff" | "melody" | "lyric" | "reference" | "vibe" | "blank";
    /** chord names when kind=progression, e.g. ["C","Am","F","G"] */
    chords?: string[];
    text?: string;
  };
  want: string;               // the goal in plain words
  vibe: {
    genre?: string;
    bpm?: number;
    key?: string;             // e.g. "A minor"
    feel?: "straight" | "swung" | "behind-the-beat";
    density?: "sparse" | "medium" | "busy";
    chromaticism?: "inside" | "some-color" | "outside";
  };
  /** what mode of collaboration fits: guided build, call-response, sculpt */
  suggestedMode: "guided" | "call-response" | "sculpt";
}

export interface MelodyOption {
  /** short character word shown to the user: "sparse", "hopeful", "bluesy" */
  character: string;
  /** the melodic lens/method used, e.g. "guide-tone line", "Lydian color" */
  method: string;
  /** one-line teaching label, expandable in UI */
  teaching: string;
  events: NoteEvent[];
}

/** One turn of the co-writer conversation. */
export interface CowriterTurn {
  /** conversational reply — the bandmate reasoning out loud (concise) */
  say: string;
  /** 1–3 playable options; empty when the turn is pure conversation */
  options: MelodyOption[];
  /** an optional next-step nudge to keep momentum */
  nudge?: string;
  /** progression edit suggestion (chord names) when relevant */
  progressionSuggestion?: string[];
}

/* ---------- JSON Schemas (for forced tool-use output) ---------- */

export const NOTE_EVENT_SCHEMA = {
  type: "object",
  properties: {
    midi: { type: "integer", minimum: 36, maximum: 88 },
    startBeat: { type: "number", minimum: 0 },
    durBeat: { type: "number", exclusiveMinimum: 0 },
    role: { type: "string", enum: ["target", "bridge", "color"] },
    art: { type: "string", enum: ["slide", "bend", "hammer", "pull"] },
    vel: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["midi", "startBeat", "durBeat", "role"],
} as const;

export const COWRITER_TURN_SCHEMA = {
  type: "object",
  properties: {
    say: { type: "string" },
    options: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          character: { type: "string" },
          method: { type: "string" },
          teaching: { type: "string" },
          events: { type: "array", items: NOTE_EVENT_SCHEMA },
        },
        required: ["character", "method", "teaching", "events"],
      },
    },
    nudge: { type: "string" },
    progressionSuggestion: { type: "array", items: { type: "string" } },
  },
  required: ["say", "options"],
} as const;

export const SESSION_FRAME_SCHEMA = {
  type: "object",
  properties: {
    have: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["progression", "riff", "melody", "lyric", "reference", "vibe", "blank"] },
        chords: { type: "array", items: { type: "string" } },
        text: { type: "string" },
      },
      required: ["kind"],
    },
    want: { type: "string" },
    vibe: {
      type: "object",
      properties: {
        genre: { type: "string" },
        bpm: { type: "number" },
        key: { type: "string" },
        feel: { type: "string", enum: ["straight", "swung", "behind-the-beat"] },
        density: { type: "string", enum: ["sparse", "medium", "busy"] },
        chromaticism: { type: "string", enum: ["inside", "some-color", "outside"] },
      },
    },
    suggestedMode: { type: "string", enum: ["guided", "call-response", "sculpt"] },
  },
  required: ["have", "want", "vibe", "suggestedMode"],
} as const;
