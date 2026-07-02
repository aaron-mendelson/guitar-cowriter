/* ============================================================
 * cowriterPrompt.ts — the bandmate system prompt builder.
 * The MUSICAL CONTEXT section is computed with the theory ENGINE
 * (chord tones, romans, chord-scale colors) — real data the model
 * must respect, never guessed.
 * ============================================================ */
import {
  ROOTS, chordTones, chordScaleChoices, romanInKey,
} from "../engine/theory";
import {
  type Song, songTimeline, songLengthBeats, slotRoot, slotLabel,
} from "../engine/progression";
import type { SessionFrame } from "./schemas";

export interface PromptContext {
  song: Song | null;
  frame: SessionFrame | null;
  tasteNotes: string[];
  phraseExamples: string[];
}

function pcName(pc: number): string {
  const norm = ((pc % 12) + 12) % 12;
  return ROOTS.find((r) => r.pc === norm)?.name ?? String(norm);
}

const PERSONA = `You are a warm, momentum-keeping bandmate co-writing with an intermediate guitarist. You are in the room with them, guitar in hand.

How you behave:
- Think out loud, concisely — a sentence or two of musical reasoning, never an essay.
- ALWAYS tie your reasoning to chord tones and scale degrees ("landing the 3rd of Am", "the ♯11 over F"), never vague adjectives alone.
- Name the method you're using as a short teaching label the guitarist can learn from ("guide-tone line", "chord-tone targeting", "Lydian color").
- Offer 2–3 concrete options, each with a ONE-WORD character ("sparse", "hopeful", "bluesy") so they can pick by feel.
- Never overwhelm. One idea per sentence. Always end with a nudge forward — the next small step that keeps momentum.
- If the guitarist plays you something, treat what they played as creative intent, not error.`;

const OUTPUT_RULES = `OUTPUT RULES for note events (non-negotiable):
- Melody is MONOPHONIC: events must never overlap in time. Each event's startBeat must be >= the previous event's startBeat + durBeat.
- startBeat is in [0, lengthBeats). durBeat must be > 0.
- Keep midi in the 52–80 sweet spot (guitar melody register).
- role must reflect the chord governing the event's startBeat:
  "target" = chord tone of that chord; "bridge" = diatonic non-chord-tone; "color" = outside the key.
- Strong beats (the integer beats 0,1,2,3 of each bar) should favor "target" notes — land chord tones where the ear checks in.
- Leave SPACE. Do not fill every beat; rests are musical. A phrase that breathes beats a phrase that runs.
- 1–3 options max, each with character (one word), method (the lens), teaching (one line), and events.`;

function musicalContext(song: Song): string {
  const tonic = ROOTS[song.tonicIdx];
  const lengthBeats = songLengthBeats(song);
  const tl = songTimeline(song);

  const lines: string[] = [];
  lines.push(`MUSICAL CONTEXT (computed by the theory engine — respect it exactly):`);
  lines.push(
    `Key: ${tonic.name} ${song.mode} · bpm: ${song.bpm} · loop length: ${lengthBeats} beats.`,
  );
  lines.push(`Progression (each slot with absolute startBeat):`);

  for (const { slot, startBeat } of tl) {
    const root = slotRoot(slot);
    const label = slotLabel(slot);
    const roman = romanInKey(root, slot.typeKey, tonic, song.mode) ?? "non-diatonic";
    const tones = chordTones(root, slot.typeKey).tones;
    const toneStr = tones.map((t) => `${t.deg}=${t.name}(pc${t.pc})`).join(", ");
    const guide = tones[1];

    lines.push(`- ${label} [${roman}] @ beat ${startBeat}, ${slot.beats} beats`);
    lines.push(`    chord tones: ${toneStr} · guide tone (3rd): ${guide.name}`);

    const choices = chordScaleChoices({ root, typeKey: slot.typeKey }, tonic, song.mode);
    for (const c of choices) {
      const colors = c.colorPcs.length
        ? ` color notes: ${c.colorPcs.map(pcName).join(", ")} ·`
        : "";
      lines.push(
        `    scale: ${c.label} —${colors} ${c.outside ? "OUTSIDE the key" : "inside the key"} — ${c.why}`,
      );
    }
  }
  return lines.join("\n");
}

function frameContext(frame: SessionFrame): string {
  const lines: string[] = ["SESSION FRAME (what the guitarist brought):"];
  lines.push(`- have: ${frame.have.kind}${frame.have.chords ? ` (${frame.have.chords.join(" ")})` : ""}`);
  if (frame.have.text) lines.push(`- their words: "${frame.have.text}"`);
  lines.push(`- want: ${frame.want}`);
  const v = frame.vibe;
  const vibeBits = [
    v.genre && `genre ${v.genre}`,
    v.bpm && `${v.bpm} bpm`,
    v.key && `key ${v.key}`,
    v.feel && `feel ${v.feel}`,
    v.density && `density ${v.density}`,
    v.chromaticism && `chromaticism ${v.chromaticism}`,
  ].filter(Boolean);
  if (vibeBits.length) lines.push(`- vibe: ${vibeBits.join(" · ")}`);
  lines.push(`- collaboration mode: ${frame.suggestedMode}`);
  return lines.join("\n");
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const parts: string[] = [PERSONA];

  if (ctx.song) {
    parts.push(musicalContext(ctx.song));
  } else {
    parts.push(
      "MUSICAL CONTEXT: no progression is set yet. Help the guitarist land on one; when you suggest chords, use progressionSuggestion with plain chord names.",
    );
  }

  if (ctx.frame) parts.push(frameContext(ctx.frame));

  parts.push(OUTPUT_RULES);

  if (ctx.tasteNotes.length) {
    parts.push(`TASTE NOTES (learned from this guitarist's verdicts — lean into these):\n${ctx.tasteNotes.map((n) => `- ${n}`).join("\n")}`);
  }

  if (ctx.phraseExamples.length) {
    parts.push(`PHRASE-SHAPE VOCABULARY (idioms to draw on when they fit the vibe):\n${ctx.phraseExamples.map((p) => `- ${p}`).join("\n")}`);
  }

  return parts.join("\n\n");
}
