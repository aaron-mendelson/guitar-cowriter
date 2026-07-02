// ============================================================
// PureTiming.swift — pure beat/time/pitch math, no audio deps.
// Direct ports of the proven helpers in src/audio/transport.ts,
// src/listen/quantize.ts and src/engine/theory.ts (freqToMidi).
// Everything here is deterministic and unit-testable headlessly.
// ============================================================
import Foundation

public enum PureTiming {

    /// Seconds per beat at a given tempo. (transport.ts beatDurSec)
    public static func beatDurSec(bpm: Double) -> Double {
        60.0 / bpm
    }

    /// Wrap a beat position into [loopStart, loopEnd).
    /// Degenerate regions (len <= 0) clamp to loopStart. (transport.ts wrapBeat)
    public static func wrapBeat(_ beat: Double, _ loopStart: Double, _ loopEnd: Double) -> Double {
        let len = loopEnd - loopStart
        if len <= 0 { return loopStart }
        let m = (beat - loopStart).truncatingRemainder(dividingBy: len)
        return loopStart + (m + len).truncatingRemainder(dividingBy: len)
    }

    /// Snap x to the nearest multiple of grid. (quantize.ts snap)
    public static func snap(_ x: Double, _ grid: Double) -> Double {
        (x / grid).rounded() * grid
    }

    /// Quantize a wall-clock note (start/duration in seconds, relative to t0Sec)
    /// onto a beat grid. Returns nil for notes starting before t0Sec.
    /// durBeat is floored at 0.25. (quantize.ts tracksToEvents semantics)
    public static func quantize(startSec: Double, durSec: Double, bpm: Double,
                                t0Sec: Double, grid: Double = 0.25)
        -> (startBeat: Double, durBeat: Double)? {
        guard startSec >= t0Sec else { return nil }
        let beatsPerSec = bpm / 60.0
        let startBeat = snap((startSec - t0Sec) * beatsPerSec, grid)
        let durBeat = max(0.25, snap(durSec * beatsPerSec, grid))
        return (startBeat, durBeat)
    }

    /// Frequency (Hz) → nearest MIDI note + cents offset. (theory.ts freqToMidi)
    public static func freqToMidiCents(_ freq: Double) -> (midi: Int, cents: Int) {
        let m = 69.0 + 12.0 * log2(freq / 440.0)
        let midi = Int(m.rounded())
        let cents = Int(((m - Double(midi)) * 100.0).rounded())
        return (midi, cents)
    }

    /// Median of a list (even count → mean of the two middles). (pitchTrack.ts median)
    public static func median(_ xs: [Double]) -> Double {
        guard !xs.isEmpty else { return 0 }
        let s = xs.sorted()
        let mid = s.count / 2
        return s.count % 2 == 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2.0
    }

    #if DEBUG
    /// Compile-checked sanity suite for the pure math. Not called at runtime;
    /// exists so a future Checks target (or lldb) can exercise it directly.
    public static func selfTest() {
        // beatDurSec
        assert(abs(beatDurSec(bpm: 120) - 0.5) < 1e-12)
        assert(abs(beatDurSec(bpm: 60) - 1.0) < 1e-12)

        // wrapBeat — normal wrap, negative wrap, degenerate region
        assert(wrapBeat(5, 0, 4) == 1)
        assert(wrapBeat(-1, 0, 4) == 3)
        assert(wrapBeat(2, 0, 4) == 2)
        assert(wrapBeat(9, 4, 8) == 5)
        assert(wrapBeat(3, 4, 4) == 4)   // len == 0 clamps to loopStart

        // snap
        assert(snap(1.13, 0.25) == 1.25)
        assert(snap(0.1, 0.25) == 0.0)
        assert(snap(0.99, 0.5) == 1.0)

        // quantize — floor at 0.25, drop pre-t0 notes
        let q = quantize(startSec: 0.26, durSec: 0.05, bpm: 120, t0Sec: 0)
        assert(q != nil && q!.startBeat == 0.5 && q!.durBeat == 0.25)
        assert(quantize(startSec: -0.1, durSec: 1, bpm: 120, t0Sec: 0) == nil)

        // freqToMidiCents
        let a4 = freqToMidiCents(440)
        assert(a4.midi == 69 && a4.cents == 0)
        let e2 = freqToMidiCents(82.41)
        assert(e2.midi == 40)

        // median
        assert(median([3, 1, 2]) == 2)
        assert(median([1, 2, 3, 4]) == 2.5)
    }
    #endif
}
