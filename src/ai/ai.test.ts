/* AI layer tests — no network. */
import { describe, it, expect, beforeEach } from "vitest";
import { fallbackFrame } from "./intent";
import { offlineTurn, sanitizeTurn } from "./cowriter";
import { getTaste, recordVerdict, tasteNotes, setKnob } from "./taste";
import { relevantPhrases } from "./phraseBank";
import { buildSystemPrompt } from "./cowriterPrompt";
import { songFromChordNames, songLengthBeats } from "../engine/progression";
import type { CowriterTurn } from "./schemas";

/* Simple localStorage shim so taste/client modules work in the node env. */
const store: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem(k: string) {
    return k in store ? store[k] : null;
  },
  setItem(k: string, v: string) {
    store[k] = String(v);
  },
  removeItem(k: string) {
    delete store[k];
  },
  clear() {
    for (const k of Object.keys(store)) delete store[k];
  },
} as any;

function makeSong() {
  // C Am F G in C major, 4 beats each → 16-beat loop
  return songFromChordNames(["C", "Am", "F", "G"], 0, "major", 90);
}

describe("fallbackFrame (no-AI intent parsing)", () => {
  it("parses 'C Am F G make it a prog rock anthem' as a progression", () => {
    const frame = fallbackFrame("C Am F G make it a prog rock anthem");
    expect(frame.have.kind).toBe("progression");
    expect(frame.have.chords).toEqual(["C", "Am", "F", "G"]);
    expect(frame.suggestedMode).toBe("guided");
    expect(frame.vibe.genre).toBeDefined();
  });

  it("parses 'neo soul 85bpm in Am' as a vibe with bpm 85", () => {
    const frame = fallbackFrame("neo soul 85bpm in Am");
    expect(frame.have.kind).toBe("vibe");
    expect(frame.vibe.bpm).toBe(85);
    expect(frame.vibe.key).toBe("A minor");
    expect(frame.vibe.genre).toBe("neo-soul");
  });

  it("detects 'key of C' and single-chord text as non-progression", () => {
    const frame = fallbackFrame("something dreamy in the key of C");
    expect(frame.have.kind).toBe("vibe");
    expect(frame.vibe.key).toBe("C major");
  });

  it("handles sharps and 7th chords", () => {
    const frame = fallbackFrame("F#m7 B7 Emaj7 loop please");
    expect(frame.have.kind).toBe("progression");
    expect(frame.have.chords?.length).toBeGreaterThanOrEqual(3);
  });
});

describe("offlineTurn (no-AI cowriter)", () => {
  it("returns 3 options with non-empty sanitized events", () => {
    const song = makeSong();
    const turn = offlineTurn("give me something", {
      song,
      tasteNotes: [],
      phraseExamples: [],
    });
    expect(turn.options).toHaveLength(3);
    expect(turn.say.length).toBeGreaterThan(0);
    const L = songLengthBeats(song);
    for (const opt of turn.options) {
      expect(opt.events.length).toBeGreaterThan(0);
      expect(opt.method.length).toBeGreaterThan(0);
      expect(opt.teaching.length).toBeGreaterThan(0);
      expect(opt.character.length).toBeGreaterThan(0);
      // sanitized: in-range, monophonic, placed on the neck
      let prevEnd = -Infinity;
      for (const e of opt.events) {
        expect(e.startBeat).toBeGreaterThanOrEqual(0);
        expect(e.startBeat).toBeLessThan(L);
        expect(e.durBeat).toBeGreaterThan(0);
        expect(e.startBeat).toBeGreaterThanOrEqual(prevEnd);
        prevEnd = e.startBeat + e.durBeat;
        expect(e.midi).toBeGreaterThanOrEqual(36);
        expect(e.midi).toBeLessThanOrEqual(88);
        expect(["target", "bridge", "color"]).toContain(e.role);
        expect(e.stringNum).toBeDefined();
        expect(e.fret).toBeDefined();
      }
    }
  });

  it("asks for chords when no song is set", () => {
    const turn = offlineTurn("hi", { song: null, tasteNotes: [], phraseExamples: [] });
    expect(turn.options).toHaveLength(0);
    expect(turn.say.length).toBeGreaterThan(0);
  });
});

describe("sanitizeTurn (the correctness moat)", () => {
  it("fixes overlaps, out-of-range events, and wrong roles", () => {
    const song = makeSong();
    const dirty: CowriterTurn = {
      say: "here you go",
      options: [
        {
          character: "test",
          method: "test",
          teaching: "test",
          events: [
            // E over C major — model mislabeled as "color"; overlaps the next note
            { midi: 64, startBeat: 0, durBeat: 4, role: "color" },
            // C over C major — mislabeled as "bridge"
            { midi: 60, startBeat: 2, durBeat: 1, role: "bridge" },
            // D over C major — diatonic non-chord tone, mislabeled "target"
            { midi: 62, startBeat: 3, durBeat: 1, role: "target" },
            // invalid: negative start
            { midi: 65, startBeat: -2, durBeat: 1, role: "target" },
            // invalid: zero duration
            { midi: 67, startBeat: 5, durBeat: 0, role: "target" },
            // out of MIDI range: folded down by octaves, F# over Am (beat 6) = color
            { midi: 102, startBeat: 6, durBeat: 1, role: "target" },
            // beyond loop end: wrapped into [0, 16)
            { midi: 64, startBeat: 17, durBeat: 1, role: "color" },
          ],
        },
      ],
    };

    const clean = sanitizeTurn(dirty, song);
    expect(clean.options).toHaveLength(1);
    const events = clean.options[0].events;

    // invalid events dropped: 7 in → 5 out
    expect(events).toHaveLength(5);

    // sorted + monophonic
    let prevEnd = -Infinity;
    for (const e of events) {
      expect(e.startBeat).toBeGreaterThanOrEqual(prevEnd);
      prevEnd = e.startBeat + e.durBeat;
    }

    // wrapped event landed at beat 1 (17 mod 16)
    const wrapped = events.find((e) => e.startBeat === 1);
    expect(wrapped).toBeDefined();

    // overlap: first note truncated to end where the wrapped note (beat 1) starts
    expect(events[0].startBeat).toBe(0);
    expect(events[0].durBeat).toBe(1);

    // roles re-classified against the governing chord, not the model's labels
    const at0 = events[0]; // E over C major → target
    expect(at0.midi % 12).toBe(4);
    expect(at0.role).toBe("target");
    const at2 = events.find((e) => e.startBeat === 2)!; // C over C → target
    expect(at2.role).toBe("target");
    const at3 = events.find((e) => e.startBeat === 3)!; // D over C → bridge
    expect(at3.role).toBe("bridge");
    const at6 = events.find((e) => e.startBeat === 6)!; // F# over Am → color
    expect(at6.midi).toBe(78); // 102 folded into range
    expect(at6.role).toBe("color");

    // placed on the neck
    for (const e of events) {
      expect(e.stringNum).toBeDefined();
      expect(e.fret).toBeDefined();
    }
  });

  it("caps options at 3 and tolerates a null song", () => {
    const opt = {
      character: "x",
      method: "y",
      teaching: "z",
      events: [{ midi: 60, startBeat: 0, durBeat: 1, role: "target" as const }],
    };
    const turn = sanitizeTurn(
      { say: "s", options: [opt, opt, opt, opt] },
      null,
    );
    expect(turn.options).toHaveLength(3);
    expect(turn.options[0].events).toHaveLength(1);
  });
});

describe("taste profile", () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
  });

  it("defaults to 0.5 knobs and empty likes", () => {
    const t = getTaste();
    expect(t.knobs).toEqual({ density: 0.5, chromaticism: 0.5, feel: 0.5, register: 0.5 });
    expect(t.likes).toEqual([]);
    expect(t.dislikes).toEqual([]);
    expect(t.log).toEqual([]);
  });

  it("recordVerdict → likes after 2 accepts, and tasteNotes reflects it", () => {
    recordVerdict({ method: "guide-tone line", character: "soulful" }, "accepted");
    expect(getTaste().likes).toEqual([]);
    recordVerdict({ method: "guide-tone line", character: "hopeful" }, "accepted");
    expect(getTaste().likes).toContain("guide-tone line");
    expect(getTaste().log).toHaveLength(2);

    const notes = tasteNotes();
    expect(notes.some((n) => n.includes("guide-tone line"))).toBe(true);
  });

  it("recordVerdict → dislikes after 3 rejects", () => {
    for (let i = 0; i < 3; i++) {
      recordVerdict({ method: "pentatonic bed", character: "safe" }, "rejected");
    }
    expect(getTaste().dislikes).toContain("pentatonic bed");
  });

  it("setKnob clamps and shows up in tasteNotes", () => {
    setKnob("density", -1);
    expect(getTaste().knobs.density).toBe(0);
    setKnob("density", 0.3);
    expect(getTaste().knobs.density).toBe(0.3);
    const notes = tasteNotes();
    expect(notes.some((n) => n.includes("sparse"))).toBe(true);
  });
});

describe("phrase bank", () => {
  it("filters by genre", () => {
    const frame = fallbackFrame("neo soul 85bpm in Am");
    const phrases = relevantPhrases(frame);
    expect(phrases.length).toBeGreaterThan(0);
    expect(phrases.some((p) => p.includes("neo-soul"))).toBe(true);
  });

  it("falls back to generic phrases", () => {
    const phrases = relevantPhrases(null);
    expect(phrases.length).toBeGreaterThan(0);
  });

  it("respects max", () => {
    expect(relevantPhrases(null, 2)).toHaveLength(2);
  });
});

describe("buildSystemPrompt", () => {
  it("computes real musical context from the engine", () => {
    const song = makeSong();
    const prompt = buildSystemPrompt({
      song,
      frame: fallbackFrame("C Am F G make it a prog rock anthem"),
      tasteNotes: ["Aaron tends to accept guide-tone lines"],
      phraseExamples: ["prog: displace the motif by a beat each repetition"],
    });
    // romans + guide tones computed, not guessed
    expect(prompt).toContain("[I]");
    expect(prompt).toContain("[vi]");
    expect(prompt).toContain("[IV]");
    expect(prompt).toContain("[V]");
    expect(prompt).toContain("guide tone (3rd): E"); // 3rd of C
    expect(prompt).toContain("loop length: 16 beats");
    expect(prompt).toContain("MONOPHONIC");
    expect(prompt).toContain("Aaron tends to accept guide-tone lines");
    expect(prompt).toContain("displace the motif");
  });

  it("handles a null song", () => {
    const prompt = buildSystemPrompt({
      song: null,
      frame: null,
      tasteNotes: [],
      phraseExamples: [],
    });
    expect(prompt).toContain("no progression is set yet");
  });
});
