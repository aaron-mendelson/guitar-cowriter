// ============================================================
// Views.swift — chat pane, transport bar, timeline, settings.
// ============================================================
import SwiftUI
import CoWriterKit

// MARK: - Chat

struct ChatPane: View {
    @Bindable var state: AppState
    var onSubmit: (String) -> Void
    var onAudition: (MelodyOption) -> Void
    var onKeep: (MelodyOption) -> Void
    @State private var input = ""

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        if state.chat.isEmpty { opener }
                        ForEach(state.chat) { entry in
                            ChatBubble(entry: entry, onAudition: onAudition, onKeep: onKeep)
                                .id(entry.id)
                        }
                        if state.busy {
                            HStack(spacing: 6) { ProgressView().controlSize(.small); Text("thinking…").foregroundStyle(.secondary) }
                                .font(.system(size: 12))
                        }
                    }
                    .padding(12)
                }
                .onChange(of: state.chat.count) {
                    if let last = state.chat.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
            }
            Divider()
            HStack(spacing: 8) {
                TextField("C Am F G — make it a prog-rock anthem", text: $input, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...4)
                    .onSubmit { send() }
                Button("Send") { send() }
                    .buttonStyle(.borderedProminent)
                    .disabled(state.busy || input.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(10)
        }
    }

    private func send() {
        let t = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !state.busy else { return }
        input = ""
        onSubmit(t)
    }

    private var opener: some View {
        VStack(alignment: .center, spacing: 10) {
            Text("🎸 What've you got?").font(.title2.bold())
            Text("Bring a progression, a riff, a vibe — and where you want to take it. I'll think out loud, play my ideas through your instruments, and we'll shape them together.")
                .font(.system(size: 12.5)).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            ForEach(["C Am F G — make it a prog-rock anthem",
                     "Em C G D at 72 bpm, wistful indie folk — find me a topline",
                     "neo-soul in A minor at 85 bpm, something to react to"], id: \.self) { ex in
                Button(ex) { onSubmit(ex) }
                    .buttonStyle(.bordered).font(.system(size: 11))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
    }
}

struct ChatBubble: View {
    let entry: ChatEntry
    var onAudition: (MelodyOption) -> Void
    var onKeep: (MelodyOption) -> Void
    @State private var teachOpen: Set<Int> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(entry.text)
                .font(.system(size: 12.5))
                .padding(10)
                .background(entry.who == .user ? Color.accentColor.opacity(0.25)
                            : entry.who == .ai ? Color.primary.opacity(0.07) : .clear)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .foregroundStyle(entry.who == .system ? .secondary : .primary)
                .frame(maxWidth: .infinity, alignment: entry.who == .user ? .trailing : .leading)

            ForEach(Array(entry.options.enumerated()), id: \.offset) { i, opt in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Text(opt.character.capitalized).bold().foregroundStyle(Palette.aiRing)
                        Text("· \(opt.method)").foregroundStyle(.secondary)
                        Text("· \(opt.events.count) notes").foregroundStyle(.tertiary)
                    }
                    .font(.system(size: 11.5))
                    HStack(spacing: 6) {
                        Button("▶ Hear it") { onAudition(opt) }.buttonStyle(.borderedProminent).controlSize(.small)
                        Button("✓ Keep") { onKeep(opt) }.buttonStyle(.bordered).controlSize(.small)
                        Button(teachOpen.contains(i) ? "▾ why" : "▸ why") {
                            if teachOpen.contains(i) { teachOpen.remove(i) } else { teachOpen.insert(i) }
                        }.buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(.secondary)
                    }
                    if teachOpen.contains(i) {
                        Text(opt.teaching)
                            .font(.system(size: 11)).foregroundStyle(.secondary)
                            .padding(.leading, 8)
                            .overlay(alignment: .leading) { Rectangle().fill(Palette.aiRing).frame(width: 2) }
                    }
                }
                .padding(8)
                .background(Color.primary.opacity(0.05))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            if let nudge = entry.nudge {
                Text("→ \(nudge)").font(.system(size: 11).italic()).foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - Transport

struct TransportBar: View {
    @Bindable var state: AppState
    var onPlayStop: () -> Void
    var onCapture: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            Button(state.playing ? "◼ Stop" : "▶ Play loop") { onPlayStop() }
                .buttonStyle(.borderedProminent)
                .disabled(state.song == nil)
            Text(state.playing ? "bar \(Int(state.posBeat / 4) + 1) · beat \(Int(state.posBeat.truncatingRemainder(dividingBy: 4)) + 1)" : "stopped")
                .font(.system(size: 11).monospacedDigit()).foregroundStyle(.secondary)
                .frame(width: 110, alignment: .leading)
            HStack(spacing: 6) {
                Text("BPM").font(.system(size: 10.5, weight: .bold)).foregroundStyle(.secondary)
                Slider(value: $state.bpm, in: 50...180, step: 1) { editing in
                    if !editing { AudioFacade.shared.setBpm(state.bpm) }
                }.frame(width: 140)
                Text("\(Int(state.bpm))").font(.system(size: 12, weight: .bold)).frame(width: 30)
            }
            Spacer()
            if state.listening {
                Button("◉ Listening… (tap when done)") { onCapture() }.buttonStyle(.borderedProminent)
            } else {
                Button("🎤 Play it back to me") { onCapture() }.buttonStyle(.bordered)
            }
        }
        .padding(10)
    }
}

// MARK: - Settings

struct SettingsSheet: View {
    @Bindable var state: AppState
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Settings").font(.headline)
            VStack(alignment: .leading, spacing: 4) {
                Text("BRAIN URL").font(.system(size: 9.5, weight: .bold)).foregroundStyle(.secondary)
                TextField("https://relay.tail57b23d.ts.net/cowrite", text: $state.brainConfig.url)
                    .textFieldStyle(.roundedBorder)
                Text("The co-writer server — your tailnet VPS (subscription-billed) or a local `node server/server.mjs`.")
                    .font(.system(size: 10)).foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("MODEL").font(.system(size: 9.5, weight: .bold)).foregroundStyle(.secondary)
                Picker("", selection: $state.brainConfig.model) {
                    Text("Fable 5").tag("claude-fable-5")
                    Text("Opus 4.8").tag("claude-opus-4-8")
                    Text("Sonnet 4.6").tag("claude-sonnet-4-6")
                    Text("Haiku 4.5").tag("claude-haiku-4-5")
                }.labelsHidden().frame(width: 180)
            }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Save") {
                    state.brainConfig.save()
                    dismiss()
                }.buttonStyle(.borderedProminent)
            }
        }
        .padding(18)
        .frame(width: 460)
    }
}
