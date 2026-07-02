// ============================================================
// Core.swift — the shared musical data contract.
// Codable mirrors of the proven TS models (src/engine/noteEvents.ts,
// src/engine/progression.ts, src/ai/schemas.ts). Every layer —
// audio, UI, brain bridge — speaks these types.
// ============================================================
import Foundation

// MARK: - Notes & phrases

public enum NoteRole: String, Codable, Sendable {
    case target   // chord tone of the governing chord — land here
    case bridge   // diatonic passing/approach tone
    case color    // outside the key — deliberate spice
}

public struct NoteEvent: Codable, Sendable, Equatable, Identifiable {
    public var id = UUID()
    public var midi: Int
    public var startBeat: Double
    public var durBeat: Double
    public var role: NoteRole
    public var stringNum: Int?
    public var fret: Int?
    public var art: String?      // slide | bend | hammer | pull
    public var vel: Double?

    enum CodingKeys: String, CodingKey { case midi, startBeat, durBeat, role, stringNum, fret, art, vel }

    public init(midi: Int, startBeat: Double, durBeat: Double, role: NoteRole,
                stringNum: Int? = nil, fret: Int? = nil, art: String? = nil, vel: Double? = nil) {
        self.midi = midi; self.startBeat = startBeat; self.durBeat = durBeat; self.role = role
        self.stringNum = stringNum; self.fret = fret; self.art = art; self.vel = vel
    }
}

public enum PhraseVoice: String, Codable, Sendable { case ai, user }

public struct Phrase: Codable, Sendable, Identifiable {
    public var id: String
    public var label: String
    public var lengthBeats: Double
    public var events: [NoteEvent]
    public var voice: PhraseVoice
    public var method: String?

    public init(id: String = UUID().uuidString, label: String, lengthBeats: Double,
                events: [NoteEvent], voice: PhraseVoice, method: String? = nil) {
        self.id = id; self.label = label; self.lengthBeats = lengthBeats
        self.events = events; self.voice = voice; self.method = method
    }
}

// MARK: - Progression / song

public struct ChordSlot: Codable, Sendable, Equatable, Identifiable {
    public var id = UUID()
    public var rootIdx: Int      // index into Theory.roots
    public var typeKey: String   // key into Theory.chords
    public var beats: Double
    public var setIdx: Int
    public var invIdx: Int

    enum CodingKeys: String, CodingKey { case rootIdx, typeKey, beats, setIdx, invIdx }

    public init(rootIdx: Int, typeKey: String, beats: Double = 4, setIdx: Int = 1, invIdx: Int = 0) {
        self.rootIdx = rootIdx; self.typeKey = typeKey; self.beats = beats
        self.setIdx = setIdx; self.invIdx = invIdx
    }
}

public struct SongSection: Codable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var slots: [ChordSlot]
    public init(id: String = UUID().uuidString, name: String, slots: [ChordSlot]) {
        self.id = id; self.name = name; self.slots = slots
    }
}

public enum KeyMode: String, Codable, Sendable { case major, minor }

public struct Song: Codable, Sendable {
    public var title: String
    public var tonicIdx: Int
    public var mode: KeyMode
    public var bpm: Double
    public var sections: [SongSection]
    public init(title: String = "Untitled", tonicIdx: Int, mode: KeyMode, bpm: Double, sections: [SongSection]) {
        self.title = title; self.tonicIdx = tonicIdx; self.mode = mode; self.bpm = bpm; self.sections = sections
    }
}

// MARK: - Co-writer wire format (mirrors src/ai/schemas.ts — the Node
// server's /cowrite contract; NoteEvent JSON is identical on both sides)

public struct MelodyOption: Codable, Sendable {
    public var character: String
    public var method: String
    public var teaching: String
    public var events: [NoteEvent]
}

public struct CowriterTurn: Codable, Sendable {
    public var say: String
    public var options: [MelodyOption]
    public var nudge: String?
    public var progressionSuggestion: [String]?
}

public struct ChatMessage: Codable, Sendable {
    public var role: String     // "user" | "assistant"
    public var content: String
    public init(role: String, content: String) { self.role = role; self.content = content }
}
