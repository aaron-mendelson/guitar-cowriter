/* ============================================================
 * taste.ts — the taste profile learned from verdicts.
 * Persisted in localStorage; turned into human-readable notes
 * that feed the co-writer system prompt.
 * ============================================================ */

export interface TasteProfile {
  knobs: { density: number; chromaticism: number; feel: number; register: number };
  likes: string[];
  dislikes: string[];
  log: {
    method: string;
    character: string;
    verdict: "accepted" | "tweaked" | "rejected";
    at: number;
  }[];
}

const STORAGE_KEY = "cowriter-taste";

const DEFAULT_TASTE: TasteProfile = {
  knobs: { density: 0.5, chromaticism: 0.5, feel: 0.5, register: 0.5 },
  likes: [],
  dislikes: [],
  log: [],
};

function hasStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function clone(t: TasteProfile): TasteProfile {
  return {
    knobs: { ...t.knobs },
    likes: [...t.likes],
    dislikes: [...t.dislikes],
    log: t.log.map((e) => ({ ...e })),
  };
}

export function getTaste(): TasteProfile {
  if (!hasStorage()) return clone(DEFAULT_TASTE);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(DEFAULT_TASTE);
    const parsed = JSON.parse(raw) as Partial<TasteProfile>;
    return {
      knobs: { ...DEFAULT_TASTE.knobs, ...(parsed.knobs ?? {}) },
      likes: parsed.likes ?? [],
      dislikes: parsed.dislikes ?? [],
      log: parsed.log ?? [],
    };
  } catch {
    return clone(DEFAULT_TASTE);
  }
}

function saveTaste(t: TasteProfile): void {
  if (hasStorage()) localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
}

/**
 * Record a verdict on an option and auto-derive likes/dislikes:
 * a method with >= 2 accepts joins likes; >= 3 rejects joins dislikes.
 */
export function recordVerdict(
  opt: { method: string; character: string },
  verdict: "accepted" | "tweaked" | "rejected",
): void {
  const taste = getTaste();
  taste.log.push({ method: opt.method, character: opt.character, verdict, at: Date.now() });

  const accepts = taste.log.filter(
    (e) => e.method === opt.method && e.verdict === "accepted",
  ).length;
  const rejects = taste.log.filter(
    (e) => e.method === opt.method && e.verdict === "rejected",
  ).length;

  if (accepts >= 2 && !taste.likes.includes(opt.method)) {
    taste.likes.push(opt.method);
    taste.dislikes = taste.dislikes.filter((m) => m !== opt.method);
  }
  if (rejects >= 3 && !taste.dislikes.includes(opt.method)) {
    taste.dislikes.push(opt.method);
    taste.likes = taste.likes.filter((m) => m !== opt.method);
  }

  saveTaste(taste);
}

export function setKnob(k: keyof TasteProfile["knobs"], v: number): void {
  const taste = getTaste();
  taste.knobs[k] = Math.min(1, Math.max(0, v));
  saveTaste(taste);
}

function knobWord(k: keyof TasteProfile["knobs"], v: number): string {
  // Always emit a concrete directive — the knobs are the user's explicit
  // dials and must audibly steer every suggestion, not just at extremes.
  const pct = v.toFixed(2);
  switch (k) {
    case "density":
      if (v < 0.4) return `DENSITY ${pct}: keep lines SPARSE — few notes, long holds, real rests; roughly 1–2 notes per bar`;
      if (v > 0.6) return `DENSITY ${pct}: keep lines BUSY — eighth-note motion, pickups into each chord, few rests`;
      return `DENSITY ${pct}: moderate motion — a phrase, then a breath`;
    case "chromaticism":
      if (v < 0.4) return `COLOR ${pct}: stay strictly INSIDE the key — chord tones and diatonic passing only`;
      if (v > 0.6) return `COLOR ${pct}: go OUTSIDE — chromatic approach tones, Lydian ♯4, blue notes (mark them role "color")`;
      return `COLOR ${pct}: mostly diatonic, an occasional chromatic approach`;
    case "feel":
      if (v < 0.4) return `FEEL ${pct}: straight, on-the-grid rhythm — integer and x.5 startBeats`;
      if (v > 0.6) return `FEEL ${pct}: swung / behind-the-beat — favor off-beat entrances (x.5 / x.75 startBeats), never square`;
      return `FEEL ${pct}: lightly relaxed timing`;
    case "register":
      if (v < 0.4) return `REGISTER ${pct}: keep the melody LOW (midi 52–62)`;
      if (v > 0.6) return `REGISTER ${pct}: keep the melody HIGH (midi 68–80)`;
      return `REGISTER ${pct}: mid register (midi 60–72)`;
  }
}

/** Human-readable lines for the system prompt. */
export function tasteNotes(): string[] {
  const taste = getTaste();
  const notes: string[] = [];
  for (const method of taste.likes) {
    notes.push(`Aaron tends to accept ${method} lines`);
  }
  for (const method of taste.dislikes) {
    notes.push(`Aaron tends to reject ${method} lines — avoid leading with them`);
  }
  notes.push("STYLE KNOBS (explicit user dials — obey these in every option):");
  for (const k of Object.keys(taste.knobs) as (keyof TasteProfile["knobs"])[]) {
    notes.push(`• ${knobWord(k, taste.knobs[k])}`);
  }
  return notes;
}
