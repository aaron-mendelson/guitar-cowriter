/* ============================================================
 * Fretboard.tsx — horizontal neck, role-colored dots, two voices.
 *  - chord voicing dots (current chord, subdued)
 *  - AI phrase (voice-ai color ring), user variant (voice-user ring)
 *  - notes light up in sync with the playhead beat
 * ============================================================ */
import { useMemo } from "react";
import { OPEN, STRING_LETTER } from "../engine/theory";
import type { NoteEvent, Phrase } from "../engine/noteEvents";

const NS = "http://www.w3.org/2000/svg";
void NS;

const FRETS = 15;
const FW = 56;          // fret width
const SH = 26;          // string height
const PADL = 46, PADT = 26, PADR = 18, PADB = 20;
const INLAY = [3, 5, 7, 9, 12, 15];

export interface BoardDot {
  stringNum: number;
  fret: number;
  label: string;
  fill: string;
  ring?: string;
  active?: boolean;
  dim?: boolean;
}

function noteName(midi: number): string {
  return ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][((midi % 12) + 12) % 12];
}

const ROLE_VAR: Record<string, string> = {
  target: "var(--role-target)",
  bridge: "var(--role-bridge)",
  color: "var(--role-color)",
};

function eventActive(e: NoteEvent, posBeat: number, len: number): boolean {
  if (len <= 0) return false;
  const p = ((posBeat % len) + len) % len;
  return p >= e.startBeat && p < e.startBeat + e.durBeat;
}

export function phraseDots(phrase: Phrase | null, posBeat: number, ring: string, playing: boolean): BoardDot[] {
  if (!phrase) return [];
  return phrase.events
    .filter((e) => e.stringNum != null && e.fret != null)
    .map((e) => ({
      stringNum: e.stringNum!,
      fret: e.fret!,
      label: noteName(e.midi),
      fill: ROLE_VAR[e.role] ?? "var(--purple)",
      ring,
      active: playing && eventActive(e, posBeat, phrase.lengthBeats),
    }));
}

interface Props {
  chordDots?: BoardDot[];
  aiPhrase?: Phrase | null;
  userPhrase?: Phrase | null;
  posBeat: number;
  playing: boolean;
  onPluck?: (midi: number) => void;
}

export default function Fretboard({ chordDots = [], aiPhrase, userPhrase, posBeat, playing, onPluck }: Props) {
  const w = PADL + FRETS * FW + PADR;
  const h = PADT + 5 * SH + PADB;

  const dots: BoardDot[] = useMemo(() => {
    const ai = phraseDots(aiPhrase ?? null, posBeat, "var(--voice-ai)", playing);
    const user = phraseDots(userPhrase ?? null, posBeat, "var(--voice-user)", playing);
    return [...chordDots.map((d) => ({ ...d, dim: true })), ...ai, ...user];
  }, [chordDots, aiPhrase, userPhrase, posBeat, playing]);

  const sx = (fret: number) => (fret === 0 ? PADL - 14 : PADL + (fret - 0.5) * FW);
  const sy = (stringNum: number) => PADT + (stringNum - 1) * SH; // string 1 (high e) on top

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="fretboard">
      {/* board */}
      <rect x={PADL} y={PADT - 9} width={FRETS * FW} height={5 * SH + 18} rx={7}
        fill="color-mix(in srgb, var(--selection) 55%, transparent)" stroke="var(--border)" />
      {/* inlays */}
      {INLAY.map((f) =>
        f === 12 ? (
          <g key={f}>
            <circle cx={PADL + (f - 0.5) * FW} cy={PADT + 1.2 * SH} r={5} fill="var(--selection)" />
            <circle cx={PADL + (f - 0.5) * FW} cy={PADT + 2.8 * SH} r={5} fill="var(--selection)" />
          </g>
        ) : (
          <circle key={f} cx={PADL + (f - 0.5) * FW} cy={PADT + 2 * SH} r={5} fill="var(--selection)" />
        )
      )}
      {/* frets */}
      {Array.from({ length: FRETS + 1 }, (_, f) => (
        <line key={f} x1={PADL + f * FW} y1={PADT - 9} x2={PADL + f * FW} y2={PADT + 5 * SH + 9}
          stroke={f === 0 ? "var(--fg)" : "var(--comment)"} strokeWidth={f === 0 ? 5 : 1.2} opacity={f === 0 ? 0.9 : 0.45} />
      ))}
      {/* fret numbers */}
      {[3, 5, 7, 9, 12, 15].map((f) => (
        <text key={f} x={PADL + (f - 0.5) * FW} y={PADT + 5 * SH + 17} fontSize={10}
          fill="var(--comment)" textAnchor="middle">{f}</text>
      ))}
      {/* strings */}
      {[1, 2, 3, 4, 5, 6].map((s) => (
        <g key={s}>
          <line x1={PADL} y1={sy(s)} x2={PADL + FRETS * FW} y2={sy(s)}
            stroke="var(--fg)" strokeWidth={0.7 + s * 0.28} opacity={0.7} />
          <text x={PADL - 28} y={sy(s) + 4} fontSize={11.5} fontWeight={800} fill="var(--comment)" textAnchor="middle">
            {STRING_LETTER[s]}
          </text>
        </g>
      ))}
      {/* dots */}
      {dots.map((d, i) => {
        const x = sx(d.fret), y = sy(d.stringNum);
        const r = d.active ? 13.5 : 10.5;
        return (
          <g key={i} opacity={d.dim ? 0.4 : 1} style={{ transition: "opacity .15s" }}>
            {d.active && <circle cx={x} cy={y} r={r + 5} fill="none" stroke={d.ring ?? "var(--purple)"} strokeWidth={2} opacity={0.85} />}
            <circle
              className="dot" cx={x} cy={y} r={r}
              fill={d.fill}
              stroke={d.ring ?? "var(--bg-deep)"} strokeWidth={d.ring ? 2.2 : 1.4}
              onClick={() => onPluck?.(OPEN[d.stringNum] + d.fret)}
            />
            <text x={x} y={y + 0.5} fontSize={d.label.length > 1 ? 8.5 : 10} textAnchor="middle"
              dominantBaseline="central" fontWeight={800} fill="var(--bg-deep)" pointerEvents="none">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
