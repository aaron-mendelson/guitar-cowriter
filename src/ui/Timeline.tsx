/* ============================================================
 * Timeline.tsx — the progression as chord chips: roman numerals,
 * inversion picker per chord (the melody lever), active highlight.
 * ============================================================ */
import { useState } from "react";
import { ROOTS, INV_SHORT, CHORDS, romanInKey } from "../engine/theory";
import { type Song, slotLabel, songTimeline, chordAtBeat, songLengthBeats } from "../engine/progression";
import { useStore } from "../state/store";
import { applySong, setLoopRange } from "./audioFacade";

interface Props {
  song: Song;
}

export default function Timeline({ song }: Props) {
  const posBeat = useStore((s) => s.posBeat);
  const playing = useStore((s) => s.playing);
  const setSong = useStore((s) => s.setSong);

  const tl = songTimeline(song);
  const active = playing ? chordAtBeat(song, posBeat) : null;
  const tonic = ROOTS[song.tonicIdx];
  const [loopIdx, setLoopIdx] = useState<number | null>(null);

  const toggleLoop = (idx: number) => {
    const len = songLengthBeats(song);
    if (loopIdx === idx) {
      setLoopIdx(null);
      setLoopRange(null, len);
    } else {
      setLoopIdx(idx);
      const t = tl[idx];
      setLoopRange({ start: t.startBeat, end: t.startBeat + t.slot.beats }, len);
    }
  };

  const setInv = (secIdx: number, slotIdx: number, inv: number) => {
    const next: Song = structuredClone(song);
    next.sections[secIdx].slots[slotIdx].invIdx = inv;
    setSong(next);
    applySong(next);
  };

  return (
    <div className="timeline">
      <span className="keybadge" style={{ fontSize: 12, color: "var(--comment)", fontWeight: 700 }}>
        {tonic.name} {song.mode}
      </span>
      {song.sections.map((sec, si) =>
        sec.slots.map((slot, i) => {
          const isActive = !!active && active.slot === slot;
          const roman = romanInKey(ROOTS[slot.rootIdx], slot.typeKey, tonic, song.mode);
          const nInv = CHORDS[slot.typeKey].n;
          const flatIdx = tl.findIndex((x) => x.slot === slot);
          const isLooped = loopIdx === flatIdx;
          return (
            <div key={`${si}-${i}`} className={`chordchip${isActive ? " active" : ""}`}
              style={isLooped ? { outline: "2px dashed var(--orange)" } : undefined}
              title="Click name to loop just this chord"
            >
              <div className="roman">{roman ?? "·"}{isLooped ? " ⟳" : ""}</div>
              <div className="cname" onClick={() => toggleLoop(flatIdx)} style={{ cursor: "pointer" }}>{slotLabel(slot)}</div>
              <div className="inv">{INV_SHORT[slot.invIdx]} inv · top note</div>
              <div className="invbtns">
                {Array.from({ length: nInv }, (_, v) => (
                  <button key={v} className={slot.invIdx === v ? "on" : ""} title={`${INV_SHORT[v]} inversion`}
                    onClick={() => setInv(si, i, v)}>
                    {INV_SHORT[v]}
                  </button>
                ))}
              </div>
            </div>
          );
        })
      )}
      <span style={{ fontSize: 11, color: "var(--comment)" }}>
        {tl.length} chords · {tl.reduce((n, x) => n + x.slot.beats, 0)} beats
      </span>
    </div>
  );
}
