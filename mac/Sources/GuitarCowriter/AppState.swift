// ============================================================
// AppState.swift — observable app state + chat model.
// ============================================================
import Foundation
import SwiftUI
import CoWriterKit

struct ChatEntry: Identifiable {
    enum Who { case user, ai, system }
    let id = UUID()
    let who: Who
    var text: String
    var options: [MelodyOption] = []
    var nudge: String? = nil
}

@MainActor
@Observable
final class AppState {
    var song: Song? = nil
    var chat: [ChatEntry] = []
    var activePhrase: Phrase? = nil
    var userPhrase: Phrase? = nil
    var busy = false

    // transport mirror
    var playing = false
    var posBeat: Double = 0
    var bpm: Double = 90
    var listening = false

    // settings
    var brainConfig = BrainConfig.load()
    var showSettings = false

    func add(_ who: ChatEntry.Who, _ text: String, options: [MelodyOption] = [], nudge: String? = nil) {
        chat.append(ChatEntry(who: who, text: text, options: options, nudge: nudge))
    }
}
