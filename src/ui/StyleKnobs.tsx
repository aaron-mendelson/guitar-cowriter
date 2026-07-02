/* ============================================================
 * StyleKnobs.tsx — the steerable, teachable style knobs.
 * Wired to the taste profile; deviations from center flow into
 * every co-writer prompt via tasteNotes().
 * ============================================================ */
import { useState } from "react";
import { getTaste, setKnob, type TasteProfile } from "../ai/taste";

type KnobKey = keyof TasteProfile["knobs"];

const KNOBS: { k: KnobKey; label: string; lo: string; hi: string; teach: string }[] = [
  { k: "density", label: "Density", lo: "spacious", hi: "busy", teach: "How many notes per bar. Sparse lines breathe; busy lines drive." },
  { k: "chromaticism", label: "Color", lo: "inside", hi: "outside", teach: "How far outside the key. Inside = diatonic; outside = chromatic approach tones, Lydian ♯4s, blue notes." },
  { k: "feel", label: "Feel", lo: "straight", hi: "laid-back", teach: "Where notes sit against the beat. Straight = on the grid; laid-back = behind it, swung." },
  { k: "register", label: "Register", lo: "low", hi: "high", teach: "Where on the neck the line lives." },
];

export default function StyleKnobs() {
  const [vals, setVals] = useState(() => ({ ...getTaste().knobs }));
  const [open, setOpen] = useState<KnobKey | null>(null);

  return (
    <div className="panel" style={{ padding: "10px 16px" }}>
      <div style={{ display: "flex", gap: 22, alignItems: "flex-start", flexWrap: "wrap" }}>
        <b style={{ fontSize: 12.5, marginTop: 4 }}>Style knobs</b>
        {KNOBS.map(({ k, label, lo, hi, teach }) => (
          <div key={k} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 150 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--comment)", fontWeight: 700 }}>
              <span style={{ cursor: "pointer" }} onClick={() => setOpen(open === k ? null : k)}>
                {label} {open === k ? "▾" : "▸"}
              </span>
            </div>
            <input
              type="range" min={0} max={1} step={0.05} value={vals[k]}
              style={{ accentColor: "var(--purple)" }}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVals((p) => ({ ...p, [k]: v }));
                setKnob(k, v);
              }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, color: "var(--comment)" }}>
              <span>{lo}</span><span>{hi}</span>
            </div>
            {open === k && (
              <div style={{ fontSize: 11, color: "var(--muted)", borderLeft: "2px solid var(--purple)", paddingLeft: 7, maxWidth: 180 }}>
                {teach}
              </div>
            )}
          </div>
        ))}
        <span style={{ fontSize: 10.5, color: "var(--comment)", marginTop: 4, maxWidth: 170 }}>
          These steer every suggestion — and your Keep/Toss votes tune them over time.
        </span>
      </div>
    </div>
  );
}
