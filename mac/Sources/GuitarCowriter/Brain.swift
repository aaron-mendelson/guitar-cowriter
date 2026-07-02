// ============================================================
// Brain.swift — bridge to the co-writer server (/cowrite).
// The server (server/server.mjs) runs on the tailnet VPS "relay"
// (subscription OAuth — no API key) or locally via `node server/server.mjs`.
// Wire format mirrors src/ai/schemas.ts / client.ts exactly.
// ============================================================
import Foundation
import CoWriterKit

// MARK: - Config

struct BrainConfig: Codable {
    var url: String = "https://relay.tail57b23d.ts.net/cowrite"
    var token: String = ""                    // optional bearer
    var model: String = "claude-fable-5"      // Aaron prefers Fable for musical reasoning

    static func load() -> BrainConfig {
        guard let data = UserDefaults.standard.data(forKey: "brain-config"),
              let cfg = try? JSONDecoder().decode(BrainConfig.self, from: data) else { return BrainConfig() }
        return cfg
    }
    func save() {
        if let data = try? JSONEncoder().encode(self) {
            UserDefaults.standard.set(data, forKey: "brain-config")
        }
    }
}

// MARK: - Schemas (mirror of src/ai/schemas.ts, as raw JSON)

private let noteEventSchema = """
{"type":"object","properties":{"midi":{"type":"integer","minimum":36,"maximum":88},"startBeat":{"type":"number","minimum":0},"durBeat":{"type":"number","exclusiveMinimum":0},"role":{"type":"string","enum":["target","bridge","color"]},"art":{"type":"string","enum":["slide","bend","hammer","pull"]},"vel":{"type":"number","minimum":0,"maximum":1}},"required":["midi","startBeat","durBeat","role"]}
"""

let cowriterTurnSchemaJSON = """
{"type":"object","properties":{"say":{"type":"string"},"options":{"type":"array","maxItems":3,"items":{"type":"object","properties":{"character":{"type":"string"},"method":{"type":"string"},"teaching":{"type":"string"},"events":{"type":"array","items":\(noteEventSchema)}},"required":["character","method","teaching","events"]}},"nudge":{"type":"string"},"progressionSuggestion":{"type":"array","items":{"type":"string"}}},"required":["say","options"]}
"""

// MARK: - Client

enum BrainError: LocalizedError {
    case badURL, http(Int, String), decode(String)
    var errorDescription: String? {
        switch self {
        case .badURL: return "Brain URL is invalid — check Settings."
        case .http(let code, let msg): return "Brain error (\(code)): \(msg)"
        case .decode(let msg): return "Couldn't read the brain's reply: \(msg)"
        }
    }
}

actor BrainClient {
    var config: BrainConfig

    init(config: BrainConfig = .load()) { self.config = config }

    func update(config: BrainConfig) { self.config = config }

    /// One co-writer turn: system prompt + chat history → CowriterTurn.
    func cowriterTurn(system: String, messages: [ChatMessage]) async throws -> CowriterTurn {
        guard let url = URL(string: config.url) else { throw BrainError.badURL }
        var req = URLRequest(url: url, timeoutInterval: 180)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !config.token.isEmpty {
            req.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
        }

        let schema = try JSONSerialization.jsonObject(with: Data(cowriterTurnSchemaJSON.utf8))
        let body: [String: Any] = [
            "system": system,
            "messages": messages.map { ["role": $0.role, "content": $0.content] },
            "schema": schema,
            "toolName": "cowriter_turn",
            "toolDescription": "One turn of guitar co-writing: reasoning + playable melody options.",
            "model": config.model,
            "maxTokens": 4096,
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 200 else {
            let msg = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
                ?? String(data: data.prefix(200), encoding: .utf8) ?? "unknown"
            throw BrainError.http(code, msg)
        }
        do {
            return try JSONDecoder().decode(CowriterTurn.self, from: data)
        } catch {
            throw BrainError.decode(error.localizedDescription)
        }
    }

    func health() async -> Bool {
        guard var comps = URLComponents(string: config.url) else { return false }
        comps.path = "/healthz"
        guard let url = comps.url else { return false }
        var req = URLRequest(url: url, timeoutInterval: 8)
        req.httpMethod = "GET"
        guard let (_, resp) = try? await URLSession.shared.data(for: req) else { return false }
        return (resp as? HTTPURLResponse)?.statusCode == 200
    }
}

// MARK: - Intent fallback (port of src/ai/intent.ts fallbackFrame)

struct ParsedIntent {
    var chords: [String]
    var bpm: Double?
    var minorKey: Bool
    var vibeText: String
}

func parseIntentFallback(_ text: String) -> ParsedIntent {
    // chord tokens: C, Am, F#m7, Bb, Ddim …  require ≥2 to call it a progression
    let pattern = #"\b([A-G](?:♯|#|b|♭)?(?:maj7|m7b5|min7|dim7|m7|aug|dim|min|m|7)?)\b"#
    let regex = try! NSRegularExpression(pattern: pattern)
    let ns = text as NSString
    var chords: [String] = []
    for m in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
        let tok = ns.substring(with: m.range(at: 1))
        // avoid words like "A" alone at sentence start being over-matched: require
        // either a suffix or that the token is part of a run of ≥2 chord-like tokens
        chords.append(tok)
    }
    if chords.count < 2 { chords = [] }

    var bpm: Double? = nil
    if let m = text.range(of: #"(\d{2,3})\s*bpm"#, options: [.regularExpression, .caseInsensitive]) {
        bpm = Double(text[m].replacingOccurrences(of: #"[^\d]"#, with: "", options: .regularExpression))
    }
    let minorKey = text.range(of: #"\b[A-G](♯|#|b|♭)?\s*(m|min|minor)\b"#, options: .regularExpression) != nil
        && chords.isEmpty == false && (chords.first?.contains("m") ?? false)
    return ParsedIntent(chords: chords, bpm: bpm, minorKey: minorKey, vibeText: text)
}
