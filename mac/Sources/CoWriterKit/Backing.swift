// ============================================================
// Backing.swift — programmatic arrangement generator, ported from
// src/audio/backing.ts. Bass / keys / drums phrases locked to the
// progression. Drums use GM percussion numbers (35 kick / 38 snare /
// 42 hat) in a phrase labeled "drums".
// ============================================================
import Foundation

public struct Arrangement: Sendable, Equatable {
    public var drums: Bool
    public var bass: Bool
    public var keys: Bool
    public var style: Style
    public enum Style: String, CaseIterable, Sendable { case rock, pop, ballad, funk }
    public init(drums: Bool = true, bass: Bool = true, keys: Bool = true, style: Style = .pop) {
        self.drums = drums; self.bass = bass; self.keys = keys; self.style = style
    }
}

public let DRUM_KICK = 35, DRUM_SNARE = 38, DRUM_HAT = 42

private func bassRootMidi(_ slot: ChordSlot) -> Int {
    36 + slotRoot(slot).pc   // octave 2
}

private func bassEvents(_ slot: ChordSlot, _ start: Double, _ style: Arrangement.Style) -> [NoteEvent] {
    let root = bassRootMidi(slot)
    var out: [NoteEvent] = []
    func push(_ off: Double, _ midi: Int, _ dur: Double, _ vel: Double = 0.85) {
        guard off < slot.beats else { return }
        out.append(NoteEvent(midi: midi, startBeat: start + off, durBeat: dur, role: .target, vel: vel))
    }
    switch style {
    case .rock:
        var t = 0.0
        while t < slot.beats { push(t, root, 0.45, 0.8); t += 0.5 }
    case .pop:
        push(0, root, 1.8)
        push(2, root, 1.2)
        push(3.5, root + 7, 0.5, 0.7)   // fifth pickup
    case .ballad:
        push(0, root, slot.beats)
    case .funk:
        push(0, root, 0.3, 0.9)
        push(0.75, root, 0.2, 0.7)
        push(1.5, root + 12, 0.25, 0.8)
        push(2.5, root, 0.3, 0.85)
        push(3.25, root + 7, 0.2, 0.7)
        push(3.75, root, 0.2, 0.75)
    }
    return out
}

private func keysEvents(_ slot: ChordSlot, _ start: Double, _ style: Arrangement.Style) -> [NoteEvent] {
    let midis = slotVoicing(slot).midis
    var out: [NoteEvent] = []
    func hit(_ off: Double, _ dur: Double, _ vel: Double) {
        guard off < slot.beats else { return }
        for m in midis {
            out.append(NoteEvent(midi: m, startBeat: start + off, durBeat: dur, role: .target, vel: vel))
        }
    }
    switch style {
    case .ballad:
        for (i, m) in midis.enumerated() {   // broken-chord arpeggio, ring to bar line
            let off = Double(i) * 0.5
            guard off < slot.beats else { continue }
            out.append(NoteEvent(midi: m, startBeat: start + off, durBeat: max(0.5, slot.beats - off), role: .target, vel: 0.4))
        }
    case .funk:
        hit(1.5, 0.4, 0.5); hit(3, 0.4, 0.5)
    case .rock:
        hit(0, 1.8, 0.42); hit(2, 1.8, 0.42)
    case .pop:
        hit(0, 2.5, 0.42); hit(2.5, max(0.5, slot.beats - 2.5), 0.34)
    }
    return out
}

private func drumBar(_ barStart: Double, _ style: Arrangement.Style) -> [NoteEvent] {
    var out: [NoteEvent] = []
    func d(_ off: Double, _ midi: Int, _ vel: Double = 0.8) {
        out.append(NoteEvent(midi: midi, startBeat: barStart + off, durBeat: 0.25, role: .target, vel: vel))
    }
    switch style {
    case .rock:
        d(0, DRUM_KICK, 0.95); d(1, DRUM_SNARE); d(2, DRUM_KICK, 0.9); d(2.5, DRUM_KICK, 0.7); d(3, DRUM_SNARE)
        for i in 0..<8 { d(Double(i) * 0.5, DRUM_HAT, 0.45) }
    case .pop:
        d(0, DRUM_KICK, 0.9); d(1, DRUM_SNARE, 0.75); d(2, DRUM_KICK, 0.85); d(3, DRUM_SNARE, 0.75)
        for i in 0..<8 { d(Double(i) * 0.5, DRUM_HAT, 0.4) }
    case .ballad:
        d(0, DRUM_KICK, 0.8); d(2, DRUM_SNARE, 0.55)
        for i in 0..<4 { d(Double(i), DRUM_HAT, 0.3) }
    case .funk:
        d(0, DRUM_KICK, 0.95); d(0.75, DRUM_KICK, 0.6); d(1, DRUM_SNARE, 0.85); d(1.75, DRUM_KICK, 0.6)
        d(2.5, DRUM_KICK, 0.8); d(3, DRUM_SNARE, 0.85); d(3.75, DRUM_SNARE, 0.5)
        for i in 0..<16 where i % 2 == 0 { d(Double(i) * 0.25, DRUM_HAT, 0.35) }
        d(3.5, DRUM_HAT, 0.5)
    }
    return out
}

/// Bass / keys / drums phrases spanning the whole song, locked to the changes.
public func backingPhrases(_ song: Song, _ arr: Arrangement) -> [Phrase] {
    let tl = songTimeline(song)
    let len = songLengthBeats(song)
    var phrases: [Phrase] = []
    if arr.bass {
        let events = tl.flatMap { bassEvents($0.slot, $0.startBeat, arr.style) }
        phrases.append(Phrase(id: "backing-bass", label: "bass", lengthBeats: len, events: events, voice: .ai, method: "\(arr.style.rawValue) bass"))
    }
    if arr.keys {
        let events = tl.flatMap { keysEvents($0.slot, $0.startBeat, arr.style) }
        phrases.append(Phrase(id: "backing-keys", label: "keys", lengthBeats: len, events: events, voice: .ai, method: "\(arr.style.rawValue) keys"))
    }
    if arr.drums {
        var events: [NoteEvent] = []
        var bar = 0.0
        while bar < len { events.append(contentsOf: drumBar(bar, arr.style)); bar += 4 }
        phrases.append(Phrase(id: "backing-drums", label: "drums", lengthBeats: len, events: events, voice: .ai, method: "\(arr.style.rawValue) drums"))
    }
    return phrases
}
