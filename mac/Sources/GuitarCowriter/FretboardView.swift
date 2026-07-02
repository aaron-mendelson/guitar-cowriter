// ============================================================
// FretboardView.swift — horizontal neck on a SwiftUI Canvas.
// Role-colored dots (target/bridge/color), two overlaid voices
// (AI ring vs. user-take ring), playhead-synced highlighting.
// ============================================================
import SwiftUI
import CoWriterKit

struct BoardDot: Identifiable {
    let id = UUID()
    var stringNum: Int
    var fret: Int
    var label: String
    var fill: Color
    var ring: Color?
    var active: Bool = false
    var dim: Bool = false
}

enum Palette {
    static let target = Color(red: 0.54, green: 1.0, blue: 0.50)   // #8aff80
    static let bridge = Color(red: 0.50, green: 1.0, blue: 0.92)   // #80ffea
    static let color  = Color(red: 1.0, green: 0.50, blue: 0.75)   // #ff80bf
    static let aiRing = Color(red: 0.58, green: 0.50, blue: 1.0)   // #9580ff
    static let userRing = Color(red: 1.0, green: 0.79, blue: 0.50) // #ffca80
    static let board = Color(red: 0.15, green: 0.14, blue: 0.19)
    static let faint = Color(red: 0.27, green: 0.26, blue: 0.35)
    static let text = Color(red: 0.97, green: 0.97, blue: 0.95)
    static let comment = Color(red: 0.47, green: 0.44, blue: 0.66)
    static let bg = Color(red: 0.13, green: 0.13, blue: 0.17)
}

private func roleColor(_ r: NoteRole) -> Color {
    switch r {
    case .target: return Palette.target
    case .bridge: return Palette.bridge
    case .color: return Palette.color
    }
}

private let noteNames = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]
private let stringLetters = [1: "e", 2: "B", 3: "G", 4: "D", 5: "A", 6: "E"]

func phraseDots(_ phrase: Phrase?, posBeat: Double, ring: Color, playing: Bool) -> [BoardDot] {
    guard let phrase, phrase.lengthBeats > 0 else { return [] }
    let p = posBeat.truncatingRemainder(dividingBy: phrase.lengthBeats)
    return phrase.events.compactMap { e in
        guard let s = e.stringNum, let f = e.fret else { return nil }
        let active = playing && p >= e.startBeat && p < e.startBeat + e.durBeat
        return BoardDot(stringNum: s, fret: f, label: noteNames[((e.midi % 12) + 12) % 12],
                        fill: roleColor(e.role), ring: ring, active: active)
    }
}

struct FretboardView: View {
    var chordDots: [BoardDot] = []
    var aiPhrase: Phrase?
    var userPhrase: Phrase?
    var posBeat: Double
    var playing: Bool
    var onPluck: ((Int) -> Void)? = nil   // midi

    private let frets = 15
    private let fw: CGFloat = 52, sh: CGFloat = 24
    private let padL: CGFloat = 40, padT: CGFloat = 18
    private let openMidi = [1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40]

    private var dots: [BoardDot] {
        chordDots.map { var d = $0; d.dim = true; return d }
            + phraseDots(aiPhrase, posBeat: posBeat, ring: Palette.aiRing, playing: playing)
            + phraseDots(userPhrase, posBeat: posBeat, ring: Palette.userRing, playing: playing)
    }

    private func x(_ fret: Int) -> CGFloat { fret == 0 ? padL - 13 : padL + (CGFloat(fret) - 0.5) * fw }
    private func y(_ stringNum: Int) -> CGFloat { padT + CGFloat(stringNum - 1) * sh }

    var body: some View {
        Canvas { ctx, _ in
            let w = CGFloat(frets) * fw
            // board
            ctx.fill(Path(roundedRect: CGRect(x: padL, y: padT - 8, width: w, height: 5 * sh + 16), cornerRadius: 7),
                     with: .color(Palette.board))
            // inlays
            for f in [3, 5, 7, 9, 15] {
                let cx = padL + (CGFloat(f) - 0.5) * fw
                ctx.fill(Path(ellipseIn: CGRect(x: cx - 4, y: padT + 2 * sh - 4, width: 8, height: 8)),
                         with: .color(Palette.faint))
            }
            for dy in [1.2, 2.8] {
                let cx = padL + 11.5 * fw
                ctx.fill(Path(ellipseIn: CGRect(x: cx - 4, y: padT + CGFloat(dy) * sh - 4, width: 8, height: 8)),
                         with: .color(Palette.faint))
            }
            // frets
            for f in 0...frets {
                var p = Path()
                p.move(to: CGPoint(x: padL + CGFloat(f) * fw, y: padT - 8))
                p.addLine(to: CGPoint(x: padL + CGFloat(f) * fw, y: padT + 5 * sh + 8))
                ctx.stroke(p, with: .color(f == 0 ? Palette.text : Palette.comment.opacity(0.45)),
                           lineWidth: f == 0 ? 4 : 1)
            }
            // fret numbers
            for f in [3, 5, 7, 9, 12, 15] {
                ctx.draw(Text("\(f)").font(.system(size: 9)).foregroundStyle(Palette.comment),
                         at: CGPoint(x: padL + (CGFloat(f) - 0.5) * fw, y: padT + 5 * sh + 14))
            }
            // strings + letters
            for s in 1...6 {
                var p = Path()
                p.move(to: CGPoint(x: padL, y: y(s)))
                p.addLine(to: CGPoint(x: padL + w, y: y(s)))
                ctx.stroke(p, with: .color(Palette.text.opacity(0.7)), lineWidth: 0.6 + CGFloat(s) * 0.25)
                ctx.draw(Text(stringLetters[s]!).font(.system(size: 10, weight: .heavy)).foregroundStyle(Palette.comment),
                         at: CGPoint(x: padL - 22, y: y(s)))
            }
            // dots
            for d in dots {
                let c = CGPoint(x: x(d.fret), y: y(d.stringNum))
                let r: CGFloat = d.active ? 12 : 9.5
                let opacity = d.dim ? 0.35 : 1.0
                if d.active, let ring = d.ring {
                    ctx.stroke(Path(ellipseIn: CGRect(x: c.x - r - 4, y: c.y - r - 4, width: (r + 4) * 2, height: (r + 4) * 2)),
                               with: .color(ring), lineWidth: 2)
                }
                ctx.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)),
                         with: .color(d.fill.opacity(opacity)))
                if let ring = d.ring, !d.dim {
                    ctx.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)),
                               with: .color(ring), lineWidth: 2)
                }
                ctx.draw(Text(d.label).font(.system(size: d.label.count > 1 ? 8 : 9.5, weight: .heavy))
                    .foregroundStyle(Palette.bg.opacity(opacity)), at: c)
            }
        }
        .frame(width: padL + CGFloat(frets) * fw + 16, height: padT + 5 * sh + 26)
        .contentShape(Rectangle())
        .onTapGesture { loc in
            // map tap → nearest string/fret → pluck
            let s = Int(((loc.y - padT) / sh).rounded()) + 1
            let f = Int(((loc.x - padL) / fw).rounded(.up))
            guard (1...6).contains(s), (0...frets).contains(f), let open = openMidi[s] else { return }
            onPluck?(open + f)
        }
    }
}
