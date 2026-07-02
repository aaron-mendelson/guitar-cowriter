// ============================================================
// RigPanel.swift — your rig: input device (AudioBox), instrument
// AUs for the AI + backing voices, faders, and style knobs.
// ============================================================
import SwiftUI
import CoWriterKit
import CoWriterAudio
import CoreAudio

struct RigPanel: View {
    @Bindable var state: AppState
    let controller: Controller

    @State private var inputs: [AudioInputDevice] = []
    @State private var instruments: [InstrumentInfo] = []
    @State private var selectedInput: AudioDeviceID? = nil
    @State private var aiInstrument: String = ""
    @State private var backingInstrument: String = ""
    @State private var loadError: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 20) {
                // Input device
                VStack(alignment: .leading, spacing: 3) {
                    label("GUITAR IN")
                    Picker("", selection: $selectedInput) {
                        Text("System default").tag(AudioDeviceID?.none)
                        ForEach(inputs, id: \.id) { d in
                            Text(d.name).tag(AudioDeviceID?.some(d.id))
                        }
                    }
                    .labelsHidden().frame(width: 190)
                    .onChange(of: selectedInput) {
                        let dev = inputs.first { $0.id == selectedInput }
                        do { try AudioFacade.shared.selectInput(dev) } catch {
                            loadError = "Input: \(error.localizedDescription)"
                        }
                    }
                }
                instrumentPicker("AI VOICE", selection: $aiInstrument, voice: .ai)
                instrumentPicker("BACKING / KEYS", selection: $backingInstrument, voice: .backing)
                Spacer()
                // Faders
                fader("AI", .ai)
                fader("Band", .backing)
                fader("Click", .click)
                fader("Master", .master)
            }
            // Style knobs
            HStack(spacing: 18) {
                label("STYLE")
                knob("Density", $state.knobs.density, "spacious", "busy")
                knob("Color", $state.knobs.chromaticism, "inside", "outside")
                knob("Feel", $state.knobs.feel, "straight", "laid-back")
                knob("Register", $state.knobs.register, "low", "high")
                Spacer()
                Text("Knobs shape lens lines instantly and steer every AI suggestion.")
                    .font(.system(size: 9.5)).foregroundStyle(.secondary).frame(maxWidth: 200)
            }
            if let err = loadError {
                Text("⚠ \(err)").font(.system(size: 10)).foregroundStyle(.orange)
            }
        }
        .padding(12)
        .task {
            inputs = AudioFacade.shared.inputDevices()
            instruments = AudioFacade.shared.instruments()
        }
    }

    private func label(_ t: String) -> some View {
        Text(t).font(.system(size: 9, weight: .bold)).foregroundStyle(.secondary)
    }

    private func instrumentPicker(_ title: String, selection: Binding<String>, voice: Voice) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            label(title)
            Picker("", selection: selection) {
                Text("Built-in sampler").tag("")
                ForEach(instruments, id: \.name) { i in
                    Text("\(i.name) (\(i.manufacturer))").tag(i.name)
                }
            }
            .labelsHidden().frame(width: 210)
            .onChange(of: selection.wrappedValue) {
                let info = instruments.first { $0.name == selection.wrappedValue }
                Task {
                    do {
                        try await AudioFacade.shared.loadInstrument(info, for: voice)
                        loadError = nil
                    } catch {
                        loadError = "\(title): \(error.localizedDescription)"
                    }
                }
            }
        }
    }

    private func fader(_ title: String, _ channel: AudioChannel) -> some View {
        VStack(spacing: 3) {
            Slider(value: Binding(
                get: { Double(AudioFacade.shared.volumeCache[channel] ?? 0.8) },
                set: { v in AudioFacade.shared.setVolume(channel, Float(v)) }
            ), in: 0...1)
            .frame(width: 70)
            label(title)
        }
    }

    private func knob(_ title: String, _ value: Binding<Double>, _ lo: String, _ hi: String) -> some View {
        VStack(spacing: 2) {
            Slider(value: value, in: 0...1).frame(width: 90)
            HStack {
                Text(lo); Spacer(); Text(title).bold(); Spacer(); Text(hi)
            }
            .font(.system(size: 8)).foregroundStyle(.secondary).frame(width: 100)
        }
    }
}
