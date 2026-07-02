// ============================================================
// App.swift — main window + layout shell.
// ============================================================
import SwiftUI
import CoWriterKit

@main
struct GuitarCowriterApp: App {
    @State private var state = AppState()

    var body: some Scene {
        WindowGroup("Guitar Co-Writer") {
            MainView(state: state)
                .frame(minWidth: 1150, minHeight: 720)
                .preferredColorScheme(.dark)
        }
    }
}

struct MainView: View {
    @Bindable var state: AppState
    @State private var controller: Controller

    init(state: AppState) {
        self.state = state
        _controller = State(initialValue: Controller(state: state))
    }

    var body: some View {
        HSplitView {
            ChatPane(state: state,
                     onSubmit: { controller.submit($0) },
                     onAudition: { controller.audition($0) },
                     onKeep: { controller.keep($0) })
                .frame(minWidth: 330, idealWidth: 380, maxWidth: 460)

            VStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("The neck").font(.system(size: 12.5, weight: .bold))
                        Text(state.activePhrase.map { "AI line: \($0.label)" } ?? "propose something to see it here")
                            .font(.system(size: 11)).foregroundStyle(.secondary)
                        Spacer()
                        Button { state.showSettings = true } label: { Image(systemName: "gearshape") }
                            .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 12).padding(.top, 10)
                    ScrollView(.horizontal, showsIndicators: false) {
                        FretboardView(chordDots: controller.chordDots(),
                                      aiPhrase: state.activePhrase,
                                      userPhrase: state.userPhrase,
                                      posBeat: state.posBeat,
                                      playing: state.playing,
                                      onPluck: { AudioFacade.shared.pluck(midi: $0) })
                            .padding(.horizontal, 8)
                    }
                    HStack(spacing: 6) {
                        Text("LENSES").font(.system(size: 9, weight: .bold)).foregroundStyle(.secondary)
                        ForEach(LENSES, id: \.key) { lens in
                            Button(lens.label) { controller.fireLens(lens) }
                                .buttonStyle(.bordered).controlSize(.small).font(.system(size: 10.5))
                                .help(lens.teach)
                        }
                        Button("clear line") {
                            state.activePhrase = nil
                            AudioFacade.shared.setPhrases([])
                        }
                        .buttonStyle(.plain).controlSize(.small).font(.system(size: 10.5)).foregroundStyle(.secondary)
                        Spacer()
                    }
                    .padding(.horizontal, 12)
                    .disabled(state.song == nil)
                    legend.padding(.bottom, 8)
                }
                .background(Color.primary.opacity(0.04))
                .clipShape(RoundedRectangle(cornerRadius: 12))

                TransportBar(state: state,
                             onPlayStop: { controller.playStop() },
                             onCapture: { controller.captureToggle() })
                    .background(Color.primary.opacity(0.04))
                    .clipShape(RoundedRectangle(cornerRadius: 12))

                if let song = state.song {
                    TimelineStrip(state: state, song: song, controller: controller)
                        .background(Color.primary.opacity(0.04))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }

                RigPanel(state: state, controller: controller)
                    .background(Color.primary.opacity(0.04))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                Spacer(minLength: 0)
            }
            .padding(10)
        }
        .sheet(isPresented: $state.showSettings) { SettingsSheet(state: state) }
        .task { await controller.boot() }
    }

    private var legend: some View {
        HStack(spacing: 14) {
            legendChip(Palette.target, "chord tone (land here)")
            legendChip(Palette.bridge, "bridge / passing")
            legendChip(Palette.color, "color (outside)")
            legendChip(Palette.aiRing, "AI voice ring")
            legendChip(Palette.userRing, "your take ring")
        }
        .font(.system(size: 10)).foregroundStyle(.secondary)
        .frame(maxWidth: .infinity)
    }
    private func legendChip(_ c: Color, _ label: String) -> some View {
        HStack(spacing: 5) { Circle().fill(c).frame(width: 8, height: 8); Text(label) }
    }
}

// MARK: - Timeline strip (chord chips w/ inversion pickers)

struct TimelineStrip: View {
    @Bindable var state: AppState
    let song: Song
    let controller: Controller

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(song.sections.enumerated()), id: \.offset) { si, sec in
                    ForEach(Array(sec.slots.enumerated()), id: \.offset) { i, slot in
                        VStack(spacing: 3) {
                            Text(controller.slotName(slot)).font(.system(size: 13, weight: .heavy))
                            Text("top note · inv").font(.system(size: 8.5)).foregroundStyle(.secondary)
                            HStack(spacing: 3) {
                                ForEach(0..<controller.inversionCount(slot), id: \.self) { v in
                                    Button(["R", "1", "2", "3"][v]) { controller.setInversion(section: si, slot: i, inv: v) }
                                        .buttonStyle(.plain)
                                        .font(.system(size: 9, weight: .bold))
                                        .padding(.horizontal, 5).padding(.vertical, 2)
                                        .background(slot.invIdx == v ? Palette.aiRing : Color.primary.opacity(0.12))
                                        .foregroundStyle(slot.invIdx == v ? Color.black : Color.primary)
                                        .clipShape(RoundedRectangle(cornerRadius: 4))
                                }
                            }
                        }
                        .padding(8)
                        .background(Color.primary.opacity(0.06))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
            .padding(10)
        }
    }
}
