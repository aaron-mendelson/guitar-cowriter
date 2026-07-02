/* ============================================================
 * diff.ts — compare the user's played-back variant against the
 * AI's proposal. Powers the propose → vary → react loop: the
 * diff summary is fed back into the AI prompt.
 * ============================================================ */
import type { NoteEvent } from "../engine/noteEvents";

export type DiffKind =
  | "pitch-change"
  | "rhythm-shift"
  | "added-note"
  | "dropped-note"
  | "duration-change";

export interface MelodicDiff {
  kind: DiffKind;
  proposalIdx?: number;
  variantIdx?: number;
  detail: string;
  semitones?: number;
  beats?: number;
}

/** Mixed sharp/flat pc names matching the engine's ROOTS spellings. */
const PC_NAMES = [
  "C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B",
] as const;

function noteName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${PC_NAMES[pc]}${octave}`;
}

function fmt(x: number): string {
  return Number(x.toFixed(2)).toString();
}

function plural(n: number, unit: string): string {
  return `${fmt(n)} ${unit}${n === 1 ? "" : "s"}`;
}

/**
 * Align proposal → variant greedily by nearest startBeat within beatTol
 * (default 0.6 beat); each variant note is used at most once. Matched
 * pairs are compared for pitch, timing, and duration; unmatched proposal
 * notes are dropped-notes, unmatched variant notes are added-notes.
 */
export function diffPhrases(
  proposal: NoteEvent[],
  variant: NoteEvent[],
  opts?: { beatTol?: number },
): MelodicDiff[] {
  const beatTol = opts?.beatTol ?? 0.6;
  const usedVariant = new Set<number>();
  const matches: { pi: number; vi: number }[] = [];

  proposal.forEach((p, pi) => {
    let best = -1;
    let bestDist = Infinity;
    variant.forEach((v, vi) => {
      if (usedVariant.has(vi)) return;
      const d = Math.abs(v.startBeat - p.startBeat);
      if (d <= beatTol && d < bestDist) {
        bestDist = d;
        best = vi;
      }
    });
    if (best >= 0) {
      usedVariant.add(best);
      matches.push({ pi, vi: best });
    }
  });

  const diffs: MelodicDiff[] = [];

  for (const { pi, vi } of matches) {
    const p = proposal[pi];
    const v = variant[vi];
    const n = pi + 1; // human-readable 1-based note number

    const semis = v.midi - p.midi;
    if (Math.abs(semis) >= 1) {
      diffs.push({
        kind: "pitch-change",
        proposalIdx: pi,
        variantIdx: vi,
        semitones: semis,
        detail: `note ${n}: played ${noteName(v.midi)} instead of ${noteName(p.midi)} (${semis > 0 ? "+" : "−"}${plural(Math.abs(semis), "semitone")})`,
      });
    }

    const dStart = v.startBeat - p.startBeat;
    if (Math.abs(dStart) >= 0.25) {
      diffs.push({
        kind: "rhythm-shift",
        proposalIdx: pi,
        variantIdx: vi,
        beats: dStart,
        detail: `entrance of note ${n} ${dStart > 0 ? "delayed" : "rushed"} by ${plural(Math.abs(dStart), "beat")}`,
      });
    }

    const dDur = v.durBeat - p.durBeat;
    if (Math.abs(dDur) >= 0.5) {
      diffs.push({
        kind: "duration-change",
        proposalIdx: pi,
        variantIdx: vi,
        beats: dDur,
        detail: `note ${n} held ${dDur > 0 ? "longer" : "shorter"} by ${plural(Math.abs(dDur), "beat")}`,
      });
    }
  }

  const matchedProposal = new Set(matches.map((m) => m.pi));
  proposal.forEach((p, pi) => {
    if (matchedProposal.has(pi)) return;
    diffs.push({
      kind: "dropped-note",
      proposalIdx: pi,
      detail: `dropped note ${pi + 1} (${noteName(p.midi)} at beat ${fmt(p.startBeat)})`,
    });
  });

  variant.forEach((v, vi) => {
    if (usedVariant.has(vi)) return;
    diffs.push({
      kind: "added-note",
      variantIdx: vi,
      detail: `added a note (${noteName(v.midi)}) at beat ${fmt(v.startBeat)}`,
    });
  });

  return diffs;
}

/** Compact human-readable summary of the diffs, for the AI prompt. */
export function describeDiffs(diffs: MelodicDiff[]): string {
  if (diffs.length === 0) return "played exactly as proposed — no differences";
  return diffs.map((d) => d.detail).join("; ");
}
