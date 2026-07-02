// ============================================================
// Devices.swift — input-device enumeration + selection via the
// CoreAudio HAL. Selection sets kAudioOutputUnitProperty_CurrentDevice
// on the engine's input AUHAL unit (engine stopped around the change).
// ============================================================
import AVFoundation
import AudioToolbox
import CoreAudio
import Foundation

public struct AudioInputDevice: Sendable, Identifiable, Hashable {
    public let id: AudioDeviceID
    public let name: String
    public init(id: AudioDeviceID, name: String) {
        self.id = id
        self.name = name
    }
}

public enum AudioDevices {

    /// All HAL devices that expose at least one input stream.
    public static func listInputDevices() -> [AudioInputDevice] {
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        let sys = AudioObjectID(kAudioObjectSystemObject)
        guard AudioObjectGetPropertyDataSize(sys, &addr, 0, nil, &size) == noErr, size > 0 else {
            return []
        }
        let count = Int(size) / MemoryLayout<AudioDeviceID>.size
        var ids = [AudioDeviceID](repeating: 0, count: count)
        guard AudioObjectGetPropertyData(sys, &addr, 0, nil, &size, &ids) == noErr else {
            return []
        }
        return ids.compactMap { id in
            guard inputStreamCount(id) > 0 else { return nil }
            return AudioInputDevice(id: id, name: deviceName(id) ?? "Device \(id)")
        }
    }

    /// The system default input device.
    public static func defaultInputDeviceID() throws -> AudioDeviceID {
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var id: AudioDeviceID = 0
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        let sys = AudioObjectID(kAudioObjectSystemObject)
        let err = AudioObjectGetPropertyData(sys, &addr, 0, nil, &size, &id)
        guard err == noErr, id != kAudioObjectUnknown else {
            throw CoWriterAudioError.osStatus(err == noErr ? -1 : err)
        }
        return id
    }

    // MARK: internals

    static func inputStreamCount(_ id: AudioDeviceID) -> Int {
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreams,
            mScope: kAudioObjectPropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(id, &addr, 0, nil, &size) == noErr else { return 0 }
        return Int(size) / MemoryLayout<AudioStreamID>.size
    }

    static func deviceName(_ id: AudioDeviceID) -> String? {
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioObjectPropertyName,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var name: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        let err = withUnsafeMutablePointer(to: &name) { ptr in
            AudioObjectGetPropertyData(id, &addr, 0, nil, &size, ptr)
        }
        guard err == noErr, let cf = name?.takeRetainedValue() else { return nil }
        return cf as String
    }
}

extension CoWriterEngine {

    /// Switch the engine's input to `device` (nil → system default input).
    /// Must be done with the engine stopped; if the engine was running it is
    /// stopped, retargeted, and restarted (taps are reinstalled for the new
    /// input format).
    public func selectInput(_ device: AudioInputDevice?) throws {
        buildGraphIfNeeded()
        var deviceID: AudioDeviceID
        if let device {
            deviceID = device.id
        } else {
            deviceID = try AudioDevices.defaultInputDeviceID()
        }
        try restartAround {
            if avEngine.inputNode.audioUnit == nil {
                // The AUHAL unit is allocated at prepare time.
                avEngine.prepare()
            }
            guard let au = avEngine.inputNode.audioUnit else {
                throw CoWriterAudioError.inputUnitUnavailable
            }
            let err = AudioUnitSetProperty(
                au,
                kAudioOutputUnitProperty_CurrentDevice,
                kAudioUnitScope_Global,
                0,
                &deviceID,
                UInt32(MemoryLayout<AudioDeviceID>.size))
            guard err == noErr else { throw CoWriterAudioError.osStatus(err) }
        }
    }
}
