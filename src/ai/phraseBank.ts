/* ============================================================
 * phraseBank.ts — starter bank of tagged phrase-shape descriptions.
 * Text, not audio: idioms the co-writer can draw on, filtered by
 * the session frame's genre/vibe.
 * ============================================================ */
import type { SessionFrame } from "./schemas";

export interface PhraseShape {
  tags: string[];
  text: string;
}

export const PHRASE_BANK: PhraseShape[] = [
  {
    tags: ["blues", "rock", "generic"],
    text: "blues: approach the 3rd from a half-step below, bend up a quarter tone on the ♭3 — the note that lives between major and minor.",
  },
  {
    tags: ["blues"],
    text: "blues: answer a vocal-length phrase with silence — call on beats 1–2, leave beats 3–4 empty for the band to talk back.",
  },
  {
    tags: ["neo-soul", "r&b", "soul"],
    text: "neo-soul: land the 9th over minor chords, slide into chord tones from a whole step — arrive late and soft.",
  },
  {
    tags: ["neo-soul", "r&b", "jazz"],
    text: "neo-soul: end phrases on the 6th or 9th instead of the root — unresolved but warm, like a question left hanging.",
  },
  {
    tags: ["prog", "prog rock", "rock"],
    text: "prog: displace the motif by a beat each repetition over an odd meter feel — the same shape lands somewhere new every bar.",
  },
  {
    tags: ["prog", "prog rock", "metal"],
    text: "prog: state the motif, then augment it (double every duration) over the section climax — grandeur from arithmetic.",
  },
  {
    tags: ["rock", "pop", "generic"],
    text: "rock: hammer a single chord tone in eighth-note pulses, then release into a two-note melodic hook at the bar line.",
  },
  {
    tags: ["pop", "generic"],
    text: "pop: keep the hook inside five scale notes and repeat it exactly — change the chord under it instead of the melody over it.",
  },
  {
    tags: ["pop", "rock"],
    text: "pop: step the last note of each phrase up one scale degree per section pass — the melody 'lifts' without changing shape.",
  },
  {
    tags: ["jazz", "neo-soul"],
    text: "jazz: connect the 3rd of one chord to the 7th of the next with a chromatic passing tone — voice-leading as melody.",
  },
  {
    tags: ["funk", "r&b"],
    text: "funk: play the root only on the 'and' of beats — ghost the downbeats, let the rhythm section own beat 1.",
  },
  {
    tags: ["folk", "country", "generic"],
    text: "folk: outline the triad ascending on the strong beats, then walk down the scale to the next root — melody as gentle arpeggio.",
  },
];

/**
 * Phrases relevant to a frame's genre/vibe (fallback to generic).
 */
export function relevantPhrases(frame: SessionFrame | null, max = 4): string[] {
  const genre = frame?.vibe.genre?.toLowerCase() ?? "";

  let picked: PhraseShape[] = [];
  if (genre) {
    picked = PHRASE_BANK.filter((p) =>
      p.tags.some((t) => genre.includes(t) || t.includes(genre)),
    );
  }
  if (!picked.length) {
    picked = PHRASE_BANK.filter((p) => p.tags.includes("generic"));
  }

  // busy/outside vibes can borrow from jazz/prog idioms too
  if (frame?.vibe.chromaticism === "outside" || frame?.vibe.chromaticism === "some-color") {
    for (const p of PHRASE_BANK) {
      if (p.tags.includes("jazz") && !picked.includes(p)) picked.push(p);
    }
  }

  return picked.slice(0, max).map((p) => p.text);
}
