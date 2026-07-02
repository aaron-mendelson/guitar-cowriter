// ============================================================
// Instruments.swift — Audio Unit discovery + hosting.
//
// Third-party instruments/effects are found via
// AVAudioUnitComponentManager and instantiated with
// AVAudioUnit.instantiate (which returns the proper subclass —
// AVAudioUnitMIDIInstrument for music devices). With no plugin
// selected we fall back to AVAudioUnitSampler + the system DLS
// bank so sound works on a clean machine.
// ============================================================
import AVFoundation
import AudioToolbox
import Foundation

public struct InstrumentInfo: Identifiable {
    public let name: String
    public let manufacturer: String
    public let component: AVAudioUnitComponent
    /// Unique per component (type/subtype/manufacturer codes included):
    /// display names alone can collide across variants of one plugin, and
    /// duplicate IDs crash SwiftUI pickers on selection.
    public var id: String {
        let d = component.audioComponentDescription
        return "\(manufacturer) — \(name) #\(d.componentType).\(d.componentSubType).\(d.componentManufacturer)"
    }

    public init(name: String, manufacturer: String, component: AVAudioUnitComponent) {
        self.name = name
        self.manufacturer = manufacturer
        self.component = component
    }
}

extension CoWriterEngine {

    /// System General MIDI sound bank — present on every macOS install.
    nonisolated static let dlsBankURL = URL(fileURLWithPath:
        "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls")

    nonisolated static func defaultProgram(for voice: Voice) -> UInt8 {
        switch voice {
        case .ai: return 4       // GM electric piano
        case .backing: return 0  // GM acoustic grand
        }
    }
    nonisolated static let clickProgram: UInt8 = 115  // GM woodblock

    // MARK: Discovery

    /// All installed instrument AUs (kAudioUnitType_MusicDevice).
    nonisolated public static func listInstruments() -> [InstrumentInfo] {
        components(ofType: kAudioUnitType_MusicDevice)
    }

    /// All installed effect AUs: plain effects (aufx) PLUS MIDI-controlled
    /// music effects (aumf) — most guitar amp suites register as the latter
    /// (Neural DSP Archetype, AmpliTube, BIAS, Genome).
    nonisolated public static func listEffects() -> [InstrumentInfo] {
        (components(ofType: kAudioUnitType_Effect)
            + components(ofType: kAudioUnitType_MusicEffect))
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    nonisolated private static func components(ofType type: OSType) -> [InstrumentInfo] {
        let desc = AudioComponentDescription(
            componentType: type, componentSubType: 0, componentManufacturer: 0,
            componentFlags: 0, componentFlagsMask: 0)
        return AVAudioUnitComponentManager.shared().components(matching: desc).map {
            InstrumentInfo(name: $0.name, manufacturer: $0.manufacturerName, component: $0)
        }
    }

    // MARK: Hosting

    /// Load an instrument AU into a voice slot. `nil` → built-in
    /// AVAudioUnitSampler with the system DLS bank (electric piano for .ai,
    /// piano for .backing), so the app makes sound with zero plugins installed.
    public func loadInstrument(_ info: InstrumentInfo?, for voice: Voice) async throws {
        buildGraphIfNeeded()
        let node: AVAudioUnit
        if let info {
            node = try await AVAudioUnit.instantiate(
                with: info.component.audioComponentDescription, options: [])
        } else {
            node = AVAudioUnitSampler()
        }
        if let old = instruments[voice] {
            avEngine.detach(old)
            instruments[voice] = nil
        }
        let mixer = mixer(for: voice)
        avEngine.attach(node)
        avEngine.connect(node, to: mixer, fromBus: 0,
                         toBus: mixer.nextAvailableInputBus, format: nil)
        if let sampler = node as? AVAudioUnitSampler {
            try sampler.loadSoundBankInstrument(
                at: Self.dlsBankURL,
                program: Self.defaultProgram(for: voice),
                bankMSB: UInt8(kAUSampler_DefaultMelodicBankMSB),
                bankLSB: UInt8(kAUSampler_DefaultBankLSB))
        }
        instruments[voice] = node
    }

    /// Load (or clear, with nil) the effect AU in insert `slot` of the guitar
    /// input chain: input → inserts in slot order → wet tap → Guitar fader.
    /// Amp sims and pedal effects go here. The engine is stopped and
    /// restarted around the rewire (same pattern as input-device selection).
    public func loadInputEffect(_ info: InstrumentInfo?, at slot: Int) async throws {
        buildGraphIfNeeded()
        while inputEffects.count <= slot { inputEffects.append(nil) }
        var node: AVAudioUnit?
        if let info {
            node = try await AVAudioUnit.instantiate(
                with: info.component.audioComponentDescription, options: [])
        }
        try restartAround {
            if let old = inputEffects[slot] {
                avEngine.disconnectNodeOutput(old)
                avEngine.detach(old)
                inputEffects[slot] = nil
            }
            if let node {
                avEngine.attach(node)
                inputEffects[slot] = node
            }
            rewireInputChain()
        }
    }

    /// The hosted AU in an insert slot — for opening its plugin editor.
    public func inputEffectUnit(at slot: Int) -> AVAudioUnit? {
        inputEffects.indices.contains(slot) ? inputEffects[slot] : nil
    }

    /// The hosted instrument AU behind a voice — for opening its plugin editor.
    public func instrumentUnit(for voice: Voice) -> AVAudioUnit? {
        instruments[voice]
    }

    /// Built-in samplers for any voice slot that has no instrument yet,
    /// plus the click sampler. Called from start().
    func ensureDefaultInstruments() {
        for voice in Voice.allCases where instruments[voice] == nil {
            let sampler = AVAudioUnitSampler()
            let mixer = mixer(for: voice)
            avEngine.attach(sampler)
            avEngine.connect(sampler, to: mixer, fromBus: 0,
                             toBus: mixer.nextAvailableInputBus, format: nil)
            try? sampler.loadSoundBankInstrument(
                at: Self.dlsBankURL,
                program: Self.defaultProgram(for: voice),
                bankMSB: UInt8(kAUSampler_DefaultMelodicBankMSB),
                bankLSB: UInt8(kAUSampler_DefaultBankLSB))
            instruments[voice] = sampler
        }
        if drumSampler == nil {
            let sampler = AVAudioUnitSampler()
            let mixer = mixer(for: Voice.backing)
            avEngine.attach(sampler)
            avEngine.connect(sampler, to: mixer, fromBus: 0,
                             toBus: mixer.nextAvailableInputBus, format: nil)
            try? sampler.loadSoundBankInstrument(
                at: Self.dlsBankURL,
                program: 0,
                bankMSB: UInt8(kAUSampler_DefaultPercussionBankMSB),
                bankLSB: UInt8(kAUSampler_DefaultBankLSB))
            drumSampler = sampler
        }
        if clickSampler == nil {
            let sampler = AVAudioUnitSampler()
            avEngine.attach(sampler)
            avEngine.connect(sampler, to: clickMixer, fromBus: 0,
                             toBus: clickMixer.nextAvailableInputBus, format: nil)
            try? sampler.loadSoundBankInstrument(
                at: Self.dlsBankURL,
                program: Self.clickProgram,
                bankMSB: UInt8(kAUSampler_DefaultMelodicBankMSB),
                bankLSB: UInt8(kAUSampler_DefaultBankLSB))
            clickSampler = sampler
        }
    }

    // MARK: Playing

    /// GM percussion hit (35 kick / 38 snare / 42 hat …) through the drum kit.
    public func sendDrum(noteOn midi: UInt8, vel: UInt8) {
        drumSampler?.startNote(midi, withVelocity: vel, onChannel: 9)
    }
    public func sendDrum(noteOff midi: UInt8) {
        drumSampler?.stopNote(midi, onChannel: 9)
    }

    public func send(noteOn midi: UInt8, vel: UInt8, to voice: Voice) {
        guard let inst = instruments[voice] as? AVAudioUnitMIDIInstrument else { return }
        inst.startNote(midi, withVelocity: vel, onChannel: 0)
    }

    public func send(noteOff midi: UInt8, to voice: Voice) {
        guard let inst = instruments[voice] as? AVAudioUnitMIDIInstrument else { return }
        inst.stopNote(midi, onChannel: 0)
    }

    /// Panic: all-notes-off + all-sound-off on every hosted instrument.
    public func allNotesOff() {
        for voice in Voice.allCases {
            guard let inst = instruments[voice] as? AVAudioUnitMIDIInstrument else { continue }
            inst.sendController(123, withValue: 0, onChannel: 0)  // all notes off
            inst.sendController(120, withValue: 0, onChannel: 0)  // all sound off
        }
    }

    /// Short metronome tick through the click channel (woodblock sampler):
    /// higher/louder on downbeats — the DLS analogue of the web transport's
    /// 1000/800 Hz square blips.
    public func sendClick(downbeat: Bool) {
        guard let sampler = clickSampler else { return }
        let note: UInt8 = downbeat ? 76 : 72
        sampler.startNote(note, withVelocity: downbeat ? 127 : 96, onChannel: 0)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            sampler.stopNote(note, onChannel: 0)
        }
    }
}
