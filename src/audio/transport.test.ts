/* Smoke tests for the transport's pure beat math.
 * No AudioContext is constructed — only the pure helpers are exercised. */
import { describe, expect, it } from "vitest";
import { beatDurSec, wrapBeat } from "./transport";

describe("beatDurSec", () => {
  it("converts bpm to seconds per beat", () => {
    expect(beatDurSec(60)).toBe(1);
    expect(beatDurSec(120)).toBe(0.5);
    expect(beatDurSec(90)).toBeCloseTo(2 / 3, 10);
    expect(beatDurSec(240)).toBe(0.25);
  });

  it("scales linearly: n beats at bpm take n * beatDurSec seconds", () => {
    const spb = beatDurSec(100);
    expect(8 * spb).toBeCloseTo(4.8, 10);
  });
});

describe("wrapBeat", () => {
  it("leaves in-range beats untouched", () => {
    expect(wrapBeat(0, 0, 8)).toBe(0);
    expect(wrapBeat(3.5, 0, 8)).toBe(3.5);
    expect(wrapBeat(4, 2, 6)).toBe(4);
  });

  it("wraps the end of the region back to the start", () => {
    expect(wrapBeat(8, 0, 8)).toBe(0);
    expect(wrapBeat(6, 2, 6)).toBe(2);
  });

  it("wraps beats beyond the region, including multiple laps", () => {
    expect(wrapBeat(9, 0, 8)).toBe(1);
    expect(wrapBeat(17, 0, 8)).toBe(1);
    expect(wrapBeat(10, 2, 6)).toBe(2); // 10 - 2 = 8 → 8 % 4 = 0 → 2
    expect(wrapBeat(11.5, 2, 6)).toBeCloseTo(3.5, 10);
  });

  it("wraps beats before the region start", () => {
    expect(wrapBeat(-1, 0, 8)).toBe(7);
    expect(wrapBeat(1, 2, 6)).toBe(5); // 1 - 2 = -1 → 3 → 5
  });

  it("handles fractional loop boundaries", () => {
    expect(wrapBeat(5.75, 1.5, 5.5)).toBeCloseTo(1.75, 10);
  });

  it("clamps degenerate (zero/negative length) regions to loopStart", () => {
    expect(wrapBeat(3, 4, 4)).toBe(4);
    expect(wrapBeat(10, 6, 2)).toBe(6);
  });
});
