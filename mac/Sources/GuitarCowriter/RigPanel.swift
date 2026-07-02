// ============================================================
// RigPanel.swift — your rig: input device (AudioBox), instrument
// AUs for the AI + backing voices, the guitar insert chain
// (amp-sim / effect AUs + app monitoring), faders, style knobs.
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
    @State private var effects: [InstrumentInfo] = []
    @State private var selectedInput: AudioDeviceID? = nil
    @State private var aiInstrument: String = ""
    @State private var backingInstrument: String = ""
    // Scalar @State per Picker: array-subscript bindings ($arr[i]) into
    // menu-style Pickers crash SwiftUI on selection (dangling menu actions).
    @State private var ampSel: String = ""                 // InstrumentInfo.id
    @State private var fxSel: String = ""
    @State private var insertLoaded: [Bool] = [false, false]
    @State private var monitor = false
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
                fader("Guitar", .input)
                fader("AI", .ai)
                fader("Band", .backing)
                fader("Click", .click)
                fader("Master", .master)
            }
            // Guitar insert chain: input → amp sim → fx → Guitar fader
            HStack(spacing: 20) {
                insertPicker("AMP SIM", slot: 0, selection: $ampSel)
                insertPicker("FX", slot: 1, selection: $fxSel)
                VStack(alignment: .leading, spacing: 3) {
                    label("MONITOR")
                    Toggle("through app", isOn: $monitor)
                        .toggleStyle(.switch).controlSize(.mini)
                        .font(.system(size: 10))
                        .onChange(of: monitor) { AudioFacade.shared.setMonitor(monitor) }
                }
                Spacer()
                Text("Guitar runs input → inserts → Guitar fader. Takes always record the wet signal; monitor here or on the interface — not both.")
                    .font(.system(size: 9.5)).foregroundStyle(.secondary).frame(maxWidth: 260)
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
            effects = AudioFacade.shared.effects()
        }
    }

    private func label(_ t: String) -> some View {
        Text(t).font(.system(size: 9, weight: .bold)).foregroundStyle(.secondary)
    }

    private func instrumentPicker(_ title: String, selection: Binding<String>, voice: Voice) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            label(title)
            HStack(spacing: 4) {
                Picker("", selection: selection) {
                    Text("Built-in sampler").tag("")
                    ForEach(instruments) { i in
                        Text("\(i.name) (\(i.manufacturer))").tag(i.id)
                    }
                }
                .labelsHidden().frame(width: 210)
                .onChange(of: selection.wrappedValue) {
                    let info = instruments.first { $0.id == selection.wrappedValue }
                    Task {
                        PluginWindows.shared.close(key: "inst-\(voice.rawValue)")
                        do {
                            try await AudioFacade.shared.loadInstrument(info, for: voice)
                            loadError = nil
                        } catch {
                            loadError = "\(title): \(error.localizedDescription)"
                        }
                    }
                }
                editButton(disabled: selection.wrappedValue.isEmpty) {
                    if let unit = AudioFacade.shared.instrumentUnit(for: voice) {
                        let name = instruments.first { $0.id == selection.wrappedValue }?.name ?? "Plugin"
                        PluginWindows.shared.open(unit, title: name,
                                                  key: "inst-\(voice.rawValue)")
                    }
                }
            }
        }
    }

    private func insertPicker(_ title: String, slot: Int, selection: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            label(title)
            HStack(spacing: 4) {
                Picker("", selection: selection) {
                    Text("— empty —").tag("")
                    ForEach(effects) { e in
                        Text("\(e.name) (\(e.manufacturer))").tag(e.id)
                    }
                }
                .labelsHidden().frame(width: 210)
                .onChange(of: selection.wrappedValue) {
                    let info = effects.first { $0.id == selection.wrappedValue }
                    Task {
                        // Window teardown + engine rewire deferred out of the
                        // menu-dismissal dispatch (AppKit reentrancy).
                        PluginWindows.shared.close(key: "insert\(slot)")
                        do {
                            try await AudioFacade.shared.loadInputEffect(info, at: slot)
                            insertLoaded[slot] = info != nil
                            loadError = nil
                        } catch {
                            insertLoaded[slot] = false
                            loadError = "\(title): \(error.localizedDescription)"
                        }
                    }
                }
                editButton(disabled: !insertLoaded[slot]) {
                    if let unit = AudioFacade.shared.inputEffectUnit(at: slot) {
                        let name = effects.first { $0.id == selection.wrappedValue }?.name ?? "Plugin"
                        PluginWindows.shared.open(unit, title: name, key: "insert\(slot)")
                    }
                }
            }
        }
    }

    private func editButton(disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: "slider.horizontal.3").font(.system(size: 10))
        }
        .buttonStyle(.borderless)
        .disabled(disabled)
        .help("Open the plugin's editor")
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
