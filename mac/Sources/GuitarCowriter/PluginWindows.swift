// ============================================================
// PluginWindows.swift — floating editor windows for hosted AUs.
// Shows the plugin's own view (requestViewController) when it has
// one, else CoreAudioKit's generic parameter editor. Without this
// an amp sim is stuck on its default preset.
// ============================================================
import AppKit
@preconcurrency import AVFoundation
import CoreAudioKit

@MainActor
final class PluginWindows {
    static let shared = PluginWindows()

    private var windows: [String: NSWindow] = [:]

    /// Open (or refocus) the editor window for a hosted AU. `key` identifies
    /// the slot (e.g. "insert0", "inst-ai") so a reopened slot reuses its window.
    func open(_ unit: AVAudioUnit, title: String, key: String) {
        if let w = windows[key] {
            w.makeKeyAndOrderFront(nil)
            return
        }
        unit.auAudioUnit.requestViewController { vc in
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    PluginWindows.shared.present(vc, unit: unit, title: title, key: key)
                }
            }
        }
    }

    /// Close and forget a slot's window (its plugin was replaced/cleared).
    func close(key: String) {
        windows[key]?.close()
        windows[key] = nil
    }

    private func present(_ vc: NSViewController?, unit: AVAudioUnit, title: String, key: String) {
        let window: NSWindow
        if let vc {
            window = NSWindow(contentViewController: vc)
        } else {
            // No custom UI — generic editor over the unit's v2 handle.
            let generic = AUGenericView(audioUnit: unit.audioUnit)
            generic.showsExpertParameters = true
            let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 540, height: 420))
            scroll.documentView = generic
            scroll.hasVerticalScroller = true
            window = NSWindow(contentRect: scroll.frame,
                              styleMask: [.titled, .closable, .resizable],
                              backing: .buffered, defer: false)
            window.contentView = scroll
        }
        window.title = title
        window.isReleasedWhenClosed = false  // we keep a reference for refocus
        window.makeKeyAndOrderFront(nil)
        windows[key] = window
    }
}
