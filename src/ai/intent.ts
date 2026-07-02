/* ============================================================
 * intent.ts — the KEYSTONE front door.
 * Free-form user text → SessionFrame (what they HAVE, what they
 * WANT, the VIBE, and the suggested collaboration mode).
 * parseIntent uses Claude; fallbackFrame is a no-AI regex parse
 * so the app works fully without a key.
 * ============================================================ */
import type { SessionFrame } from "./schemas";
import { SESSION_FRAME_SCHEMA } from "./schemas";
import { callClaude } from "./client";

const INTENT_SYSTEM = `You are the intent parser for a guitar co-writing bandmate app. A guitarist just typed (or spoke) what they're bringing to the session. Extract a session frame:

- HAVE: what material they already bring. kind is one of:
  "progression" (chord names present — extract them into chords[]),
  "riff" (a guitar figure they play or describe),
  "melody" (a hummed/sung line),
  "lyric" (words first),
  "reference" (a song/artist they want to sound like),
  "vibe" (only a mood/genre/tempo, no concrete material),
  "blank" (nothing yet, wants a spark).
- WANT: their goal in plain words (verbatim intent, compressed).
- VIBE: genre, bpm (number), key (like "A minor" or "C major"), feel (straight/swung/behind-the-beat), density (sparse/medium/busy), chromaticism (inside/some-color/outside). Only fill fields the text supports — do not invent.
- suggestedMode: "guided" when they have a progression and want to build it into a song; "call-response" when they bring a riff or want a solo/lead ideas to react to; "sculpt" when they have material and want it reshaped/edited.

Normalize chord names to standard symbols (C, Am, F#m7, Bb, G7, Cmaj7, Dm7b5...). Keys as "<Root> major" / "<Root> minor".

Examples:

Input: "Here's C Am F G, make it a prog rock anthem"
Output: {"have":{"kind":"progression","chords":["C","Am","F","G"],"text":"Here's C Am F G, make it a prog rock anthem"},"want":"turn this progression into a prog rock anthem","vibe":{"genre":"prog rock","chromaticism":"some-color"},"suggestedMode":"guided"}

Input: "help me write a solo over this riff"
Output: {"have":{"kind":"riff","text":"help me write a solo over this riff"},"want":"write a solo over the riff","vibe":{},"suggestedMode":"call-response"}

Input: "neo-soul at 85bpm in Am, something to react to"
Output: {"have":{"kind":"vibe","text":"neo-soul at 85bpm in Am, something to react to"},"want":"an idea to react to","vibe":{"genre":"neo-soul","bpm":85,"key":"A minor","feel":"behind-the-beat","density":"sparse"},"suggestedMode":"call-response"}

Return ONLY the session frame via the tool.`;

export async function parseIntent(text: string): Promise<SessionFrame> {
  const result = await callClaude({
    system: INTENT_SYSTEM,
    messages: [{ role: "user", content: text }],
    toolName: "session_frame",
    toolDescription:
      "Report the parsed session frame: what the guitarist has, what they want, the vibe, and the suggested collaboration mode.",
    schema: SESSION_FRAME_SCHEMA,
    maxTokens: 1024,
  });
  return result as SessionFrame;
}

/* ---------------- no-AI regex fallback ---------------- */

const CHORD_RE = /\b[A-G](♯|#|b|♭)?(m|maj7|m7|7|dim|aug|m7b5)?\b/g;
const BPM_RE = /(\d{2,3})\s*bpm/i;
// root is case-SENSITIVE ([A-G]) so "in a minute" doesn't read as A major
const KEY_RE = /\b(?:in|key of)\s+([A-G])([♯#♭b]?)\s*(minor|min|major|maj|m)?\b/;

const GENRES = [
  "neo-soul", "neo soul", "prog rock", "prog", "blues", "jazz", "rock",
  "pop", "funk", "metal", "folk", "country", "r&b", "soul", "indie",
];

/** Regex-only SessionFrame used when no API key is present. */
export function fallbackFrame(text: string): SessionFrame {
  const chords = text.match(CHORD_RE) ?? [];
  const isProgression = chords.length >= 2;

  const vibe: SessionFrame["vibe"] = {};

  const bpmMatch = text.match(BPM_RE);
  if (bpmMatch) vibe.bpm = parseInt(bpmMatch[1], 10);

  const keyMatch = text.match(KEY_RE);
  if (keyMatch) {
    const root = keyMatch[1] + (keyMatch[2] === "#" ? "♯" : keyMatch[2] === "b" ? "♭" : keyMatch[2] ?? "");
    const q = (keyMatch[3] ?? "").toLowerCase();
    const quality = q === "m" || q === "min" || q === "minor" ? "minor" : "major";
    vibe.key = `${root} ${quality}`;
  }

  const lower = text.toLowerCase();
  const genre = GENRES.find((g) => lower.includes(g));
  if (genre) vibe.genre = genre === "neo soul" ? "neo-soul" : genre;

  if (isProgression) {
    return {
      have: { kind: "progression", chords: [...chords], text },
      want: text,
      vibe,
      suggestedMode: "guided",
    };
  }
  return {
    have: { kind: "vibe", text },
    want: text,
    vibe,
    suggestedMode: "call-response",
  };
}
