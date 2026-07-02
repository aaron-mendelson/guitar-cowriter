// ============================================================
// Transport.swift — the beat clock. A faithful port of the proven
// web transport (src/audio/transport.ts): 25ms tick, 120ms
// lookahead window, per-beat segment scheduling, loop wrapping,
// count-in, click. Deadlines are wall-clock (Date) based —
// jitter of a few ms is acceptable for v1.
// ============================================================
import CoWriterKit
import Foundation

@MainActor
public final class Transport {

    public struct State: Sendable {
        public var playing = false
        public var bpm: Double = 120
        public var loop = false
        public var loopStartBeat: Double = 0
        public var loopEndBeat: Double = 4
        public var posBeat: Double = 0
        public var countIn = false
        public var clickOn = true
    }

    public private(set) var state = State()

    /// Fired (on the main actor) near each integer beat with the song-position beat.
    public var onBeat: ((Double) -> Void)?

    private struct ChordHit {
        let startBeat: Double
        let midis: [Int]
        let beats: Double
    }

    private static let tickInterval = 0.025      // 25 ms scheduler tick
    private static let lookaheadSec = 0.12       // 120 ms schedule-ahead window
    private static let strumStaggerSec = 0.025   // 25 ms per-string strum feel
    private static let eps = 1e-9

    private let engine: CoWriterEngine
    private var chordHits: [ChordHit] = []
    private var phrases: [Phrase] = []
    private var songLen: Double = 0

    private var ticker: DispatchSourceTimer?
    private var pending: [UUID: DispatchWorkItem] = [:]
    private var cursorBeat: Double = 0   // next unscheduled song position (beats)
    private var cursorTime: Double = 0   // wall-clock time of cursorBeat (seconds)

    public init(engine: CoWriterEngine) {
        self.engine = engine
    }

    /// Transport over the shared engine.
    public convenience init() {
        self.init(engine: .shared)
    }

    // MARK: Content

    /// Set the progression as chord hits for the backing voice: at each hit
    /// the midis are arpeggiated with a 25ms stagger (strum feel) and held
    /// for the slot duration.
    public func setSong(chordHits: [(startBeat: Double, midis: [Int], beats: Double)]) {
        self.chordHits = chordHits.map {
            ChordHit(startBeat: $0.startBeat, midis: $0.midis, beats: $0.beats)
        }
        songLen = chordHits.reduce(0) { max($0, $1.startBeat + $1.beats) }
    }

    /// Set melodic phrases. voice .ai → ai instrument; everything else
    /// (user echoes, "drums"-labeled phrases) → backing instrument.
    public func setPhrases(_ phrases: [Phrase]) {
        self.phrases = phrases
    }

    public func setBpm(_ bpm: Double) {
        // The scheduler advances incrementally from cursorTime, so a bpm
        // change simply applies to every segment scheduled from here on.
        guard bpm > 0, bpm.isFinite else { return }
        state.bpm = bpm
    }

    public func setLoop(startBeat: Double, endBeat: Double, on: Bool) {
        state.loopStartBeat = startBeat
        state.loopEndBeat = endBeat
        state.loop = on
    }

    public func setCountIn(_ on: Bool) { state.countIn = on }
    public func setClick(_ on: Bool) { state.clickOn = on }

    // MARK: Play / stop

    public func play(fromBeat: Double? = nil) {
        if state.playing { stop() }
        try? engine.start()

        let (wrapStart, wrapEnd) = wrapRegion()
        var from = fromBeat ?? state.posBeat
        from = PureTiming.wrapBeat(from, wrapStart, wrapEnd)
        cursorBeat = from
        state.posBeat = from

        let spb = PureTiming.beatDurSec(bpm: state.bpm)
        var start = Self.now() + 0.1
        if state.countIn {
            for i in 0..<4 {
                scheduleClick(at: start + Double(i) * spb, downbeat: i == 0)
            }
            start += 4 * spb
        }
        cursorTime = start
        state.playing = true

        let t = DispatchSource.makeTimerSource(queue: .main)
        t.schedule(deadline: .now(), repeating: Self.tickInterval, leeway: .milliseconds(5))
        t.setEventHandler { [weak self] in
            MainActor.assumeIsolated { self?.tick() }
        }
        t.resume()
        ticker = t
        tick()
    }

    /// Stop scheduling; cancels not-yet-fired deadlines and silences held notes.
    public func stop() {
        state.playing = false
        ticker?.cancel()
        ticker = nil
        for (_, item) in pending { item.cancel() }
        pending.removeAll()
        state.posBeat = cursorBeat
        engine.allNotesOff()
    }

    // MARK: Internals

    private static func now() -> Double {
        Date().timeIntervalSinceReferenceDate
    }

    private func wrapRegion() -> (Double, Double) {
        if state.loop && state.loopEndBeat > state.loopStartBeat {
            return (state.loopStartBeat, state.loopEndBeat)
        }
        var end = songLen
        if end <= 0 {
            for p in phrases { end = max(end, p.lengthBeats) }
        }
        return (0, end > 0 ? end : 4)
    }

    private func tick() {
        guard state.playing else { return }
        let horizon = Self.now() + Self.lookaheadSec
        var guardCount = 0
        while cursorTime < horizon && guardCount < 1024 {
            guardCount += 1
            let spb = PureTiming.beatDurSec(bpm: state.bpm)
            let (wrapStart, wrapEnd) = wrapRegion()
            if cursorBeat < wrapStart - Self.eps || cursorBeat >= wrapEnd - Self.eps {
                cursorBeat = wrapStart
            }
            let segStart = cursorBeat
            let segEnd = min((segStart + Self.eps).rounded(.down) + 1, wrapEnd)
            let segLen = segEnd - segStart
            if segLen <= Self.eps { break }  // degenerate region; nothing schedulable

            // Playhead + click on integer beats.
            if abs(segStart - segStart.rounded()) < 1e-6 {
                let beat = segStart.rounded()
                if state.clickOn {
                    scheduleClick(at: cursorTime, downbeat: Int(beat) % 4 == 0)
                }
                fireBeat(beat, at: cursorTime)
            }

            // Chord strums at slot starts (backing voice).
            for hit in chordHits
            where hit.startBeat >= segStart - Self.eps && hit.startBeat < segEnd - Self.eps {
                scheduleStrum(hit, at: cursorTime + (hit.startBeat - segStart) * spb, spb: spb)
            }

            // Phrase notes (phrases loop against the progression by their own length).
            for p in phrases {
                schedulePhraseSegment(p, segStart: segStart, segEnd: segEnd, spb: spb)
            }

            cursorTime += segLen * spb
            cursorBeat = segEnd
            if cursorBeat >= wrapEnd - Self.eps { cursorBeat = wrapStart }
        }
    }

    private func scheduleStrum(_ hit: ChordHit, at time: Double, spb: Double) {
        let holdSec = max(0.05, hit.beats * spb)
        for (i, m) in hit.midis.enumerated() {
            let midi = UInt8(clamping: m)
            let onTime = time + Double(i) * Self.strumStaggerSec
            schedule(at: onTime) { [engine] in
                engine.send(noteOn: midi, vel: 88, to: .backing)
            }
            schedule(at: max(time + holdSec, onTime + 0.05)) { [engine] in
                engine.send(noteOff: midi, to: .backing)
            }
        }
    }

    private func schedulePhraseSegment(_ p: Phrase, segStart: Double, segEnd: Double, spb: Double) {
        let L = p.lengthBeats
        guard L > 0 else { return }
        let voice: Voice = (p.voice == .ai && p.label != "drums") ? .ai : .backing
        for ev in p.events {
            // Occurrences live at k*L + ev.startBeat; find the one inside the segment.
            let k = ((segStart - ev.startBeat) / L - Self.eps).rounded(.up)
            let occ = k * L + ev.startBeat
            if occ < segStart - Self.eps || occ >= segEnd - Self.eps { continue }
            let when = cursorTime + (occ - segStart) * spb
            let durSec = max(0.05, ev.durBeat * spb)
            let midi = UInt8(clamping: ev.midi)
            let vel = UInt8(clamping: Int(((ev.vel ?? 0.8) * 127).rounded()))
            schedule(at: when) { [engine] in
                engine.send(noteOn: midi, vel: vel, to: voice)
            }
            schedule(at: when + durSec) { [engine] in
                engine.send(noteOff: midi, to: voice)
            }
        }
    }

    private func fireBeat(_ beat: Double, at time: Double) {
        schedule(at: time) { [weak self] in
            guard let self, self.state.playing else { return }
            self.state.posBeat = beat
            self.onBeat?(beat)
        }
    }

    private func scheduleClick(at time: Double, downbeat: Bool) {
        schedule(at: time) { [engine] in
            engine.sendClick(downbeat: downbeat)
        }
    }

    /// Run `body` on the main actor at wall-clock `time`; cancellable via stop().
    private func schedule(at time: Double, _ body: @escaping @MainActor () -> Void) {
        let id = UUID()
        let item = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated {
                self?.pending.removeValue(forKey: id)
                body()
            }
        }
        pending[id] = item
        let delay = max(0, time - Self.now())
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }
}
