import { describe, it, expect } from "vitest";
import { diffPhrases, describeDiffs } from "./diff";
import { tracksToEvents, snap } from "./quantize";
// Import (type + class) to ensure pitchTrack.ts compiles; the tracker
// itself needs live audio and is not unit-testable here.
import { PitchTracker, type TrackedNote } from "./pitchTrack";
import type { NoteEvent } from "../engine/noteEvents";

const ev = (midi: number, startBeat: number, durBeat = 1): NoteEvent => ({
  midi,
  startBeat,
  durBeat,
  role: "target",
});

const tn = (midi: number, startSec: number, durSec: number): TrackedNote => ({
  midi,
  cents: 0,
  startSec,
  durSec,
  rms: 0.05,
});

describe("diffPhrases", () => {
  it("exact match produces no diffs", () => {
    const phrase = [ev(64, 0), ev(67, 1), ev(72, 2, 2)];
    expect(diffPhrases(phrase, phrase.map((e) => ({ ...e })))).toEqual([]);
    expect(describeDiffs([])).toContain("no differences");
  });

  it("flat 3rd: E4 played as E♭4 → one pitch-change of −1 semitone", () => {
    const diffs = diffPhrases([ev(64, 0)], [ev(63, 0)]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].kind).toBe("pitch-change");
    expect(diffs[0].semitones).toBe(-1);
    expect(diffs[0].proposalIdx).toBe(0);
    expect(diffs[0].variantIdx).toBe(0);
    expect(diffs[0].detail).toContain("E♭4");
    expect(diffs[0].detail).toContain("instead of E4");
  });

  it("pitch raised by 2 semitones reports +2", () => {
    const diffs = diffPhrases([ev(60, 0)], [ev(62, 0)]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].kind).toBe("pitch-change");
    expect(diffs[0].semitones).toBe(2);
  });

  it("delayed entrance → rhythm-shift with positive beats", () => {
    const diffs = diffPhrases([ev(64, 0)], [ev(64, 0.5)]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].kind).toBe("rhythm-shift");
    expect(diffs[0].beats).toBeCloseTo(0.5);
    expect(diffs[0].detail).toContain("delayed");
  });

  it("rushed entrance → rhythm-shift with negative beats", () => {
    const diffs = diffPhrases([ev(64, 1)], [ev(64, 0.5)]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].kind).toBe("rhythm-shift");
    expect(diffs[0].beats).toBeCloseTo(-0.5);
    expect(diffs[0].detail).toContain("rushed");
  });

  it("small timing wobble below 0.25 beat is ignored", () => {
    expect(diffPhrases([ev(64, 0)], [ev(64, 0.1)])).toEqual([]);
  });

  it("duration-change when |Δdur| >= 0.5 beat", () => {
    const diffs = diffPhrases([ev(64, 0, 1)], [ev(64, 0, 2)]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].kind).toBe("duration-change");
    expect(diffs[0].beats).toBeCloseTo(1);
    expect(diffs[0].detail).toContain("longer");
  });

  it("duration wobble below 0.5 beat is ignored", () => {
    expect(diffPhrases([ev(64, 0, 1)], [ev(64, 0, 1.25)])).toEqual([]);
  });

  it("added note: extra variant note between two matched ones", () => {
    const proposal = [ev(60, 0), ev(64, 2)];
    const variant = [ev(60, 0), ev(62, 1), ev(64, 2)];
    const diffs = diffPhrases(proposal, variant);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].kind).toBe("added-note");
    expect(diffs[0].variantIdx).toBe(1);
    expect(diffs[0].proposalIdx).toBeUndefined();
    expect(diffs[0].detail).toContain("D4");
  });

  it("dropped note: proposal note with no variant counterpart", () => {
    const proposal = [ev(60, 0), ev(62, 1), ev(64, 2)];
    const variant = [ev(60, 0), ev(64, 2)];
    const diffs = diffPhrases(proposal, variant);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].kind).toBe("dropped-note");
    expect(diffs[0].proposalIdx).toBe(1);
    expect(diffs[0].variantIdx).toBeUndefined();
  });

  it("notes farther apart than beatTol never match", () => {
    const diffs = diffPhrases([ev(64, 0)], [ev(64, 1)]);
    expect(diffs.map((d) => d.kind).sort()).toEqual(["added-note", "dropped-note"]);
  });

  it("beatTol option widens the matching window", () => {
    const diffs = diffPhrases([ev(64, 0)], [ev(64, 1)], { beatTol: 1.2 });
    expect(diffs).toHaveLength(1);
    expect(diffs[0].kind).toBe("rhythm-shift");
  });

  it("each variant note matches at most one proposal note", () => {
    // Two proposal notes near one variant note: only one can claim it.
    const diffs = diffPhrases([ev(60, 0), ev(60, 0.5)], [ev(60, 0.25)]);
    const kinds = diffs.map((d) => d.kind);
    expect(kinds).toContain("dropped-note");
    expect(kinds.filter((k) => k === "dropped-note")).toHaveLength(1);
  });

  it("combined case: pitch change + delay + added + dropped", () => {
    const proposal = [ev(64, 0), ev(67, 1), ev(72, 3)];
    const variant = [ev(63, 0), ev(67, 1.5), ev(65, 2, 0.5)];
    const diffs = diffPhrases(proposal, variant);
    const kinds = diffs.map((d) => d.kind).sort();
    expect(kinds).toEqual(["added-note", "dropped-note", "pitch-change", "rhythm-shift"]);

    const pitch = diffs.find((d) => d.kind === "pitch-change")!;
    expect(pitch.semitones).toBe(-1);
    const shift = diffs.find((d) => d.kind === "rhythm-shift")!;
    expect(shift.beats).toBeCloseTo(0.5);
    const dropped = diffs.find((d) => d.kind === "dropped-note")!;
    expect(dropped.proposalIdx).toBe(2);
    const added = diffs.find((d) => d.kind === "added-note")!;
    expect(added.variantIdx).toBe(2);

    const summary = describeDiffs(diffs);
    expect(summary).toContain("E♭4");
    expect(summary).toContain("delayed");
    expect(summary.split("; ")).toHaveLength(4);
  });
});

describe("quantize", () => {
  it("snap rounds to the nearest grid multiple", () => {
    expect(snap(0.13, 0.25)).toBeCloseTo(0.25);
    expect(snap(0.1, 0.25)).toBeCloseTo(0);
    expect(snap(0.87, 0.25)).toBeCloseTo(0.75);
    expect(snap(1.6, 0.5)).toBeCloseTo(1.5);
  });

  it("converts seconds to snapped beats at the given bpm", () => {
    // 120 bpm → 2 beats per second
    const notes = [tn(64, 10.0, 0.5), tn(67, 10.51, 0.24)];
    const events = tracksToEvents(notes, 120, 10.0);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ midi: 64, startBeat: 0, durBeat: 1, role: "target" });
    // 0.51s → 1.02 beats → snaps to 1; 0.24s → 0.48 beats → snaps to 0.5
    expect(events[1]).toMatchObject({ midi: 67, startBeat: 1, durBeat: 0.5 });
  });

  it("enforces the 0.25-beat minimum duration", () => {
    const events = tracksToEvents([tn(60, 5.0, 0.02)], 120, 5.0);
    expect(events[0].durBeat).toBe(0.25);
  });

  it("drops notes that start before t0Sec", () => {
    const notes = [tn(60, 4.5, 0.5), tn(62, 5.0, 0.5), tn(64, 5.5, 0.5)];
    const events = tracksToEvents(notes, 120, 5.0);
    expect(events.map((e) => e.midi)).toEqual([62, 64]);
    expect(events[0].startBeat).toBe(0);
    expect(events[1].startBeat).toBe(1);
  });

  it("respects a custom grid", () => {
    // 60 bpm → 1 beat per second; 0.4s onset with grid 0.5 → 0.5 beat
    const events = tracksToEvents([tn(60, 0.4, 1)], 60, 0, { grid: 0.5 });
    expect(events[0].startBeat).toBe(0.5);
  });

  it("marks every event role as the placeholder 'target'", () => {
    const events = tracksToEvents([tn(61, 0, 0.5), tn(66, 1, 0.5)], 120, 0);
    expect(events.every((e) => e.role === "target")).toBe(true);
  });
});

describe("pitchTrack module", () => {
  it("exports the PitchTracker class (audio-dependent; not unit-tested)", () => {
    expect(typeof PitchTracker).toBe("function");
    expect(typeof PitchTracker.prototype.start).toBe("function");
    expect(typeof PitchTracker.prototype.stop).toBe("function");
    expect(typeof PitchTracker.prototype.onNote).toBe("function");
    expect(typeof PitchTracker.prototype.current).toBe("function");
  });
});
