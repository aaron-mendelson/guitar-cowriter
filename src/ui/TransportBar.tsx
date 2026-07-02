/* ============================================================
 * TransportBar.tsx — play/stop, BPM, loop, count-in, click,
 * plus the capture (listen) button for the propose→vary loop.
 * ============================================================ */
import { useState } from "react";
import { useStore } from "../state/store";
import { play, stop, setBpm, setBand } from "./audioFacade";
import { getTransport } from "../audio/transport";
import type { Arrangement } from "../audio/backing";

const STYLES: Arrangement["style"][] = ["rock", "pop", "ballad", "funk"];

interface Props {
  onCaptureToggle: () => void;
  captureDisabled?: boolean;
}

export default function TransportBar({ onCaptureToggle, captureDisabled }: Props) {
  const playing = useStore((s) => s.playing);
  const bpm = useStore((s) => s.bpm);
  const posBeat = useStore((s) => s.posBeat);
  const listening = useStore((s) => s.listening);
  const song = useStore((s) => s.song);
  const [bandOn, setBandOn] = useState(false);
  const [style, setStyle] = useState<Arrangement["style"]>("pop");

  const bar = Math.floor(posBeat / 4) + 1;
  const beat = Math.floor(posBeat % 4) + 1;

  return (
    <div className="transport panel">
      <button className="btn primary" disabled={!song} onClick={() => (playing ? stop() : void play(0))}>
        {playing ? "◼ Stop" : "▶ Play loop"}
      </button>
      <span className="pos">{playing ? `bar ${bar} · beat ${beat}` : "stopped"}</span>
      <div className="bpm">
        BPM
        <input type="range" min={50} max={180} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} />
        <b style={{ color: "var(--fg)", minWidth: 28 }}>{bpm}</b>
      </div>
      <label className="togglelbl">
        <input type="checkbox" defaultChecked onChange={(e) => { getTransport().state.clickOn = e.target.checked; }} />
        click
      </label>
      <label className="togglelbl">
        <input type="checkbox" defaultChecked onChange={(e) => { getTransport().state.countIn = e.target.checked; }} />
        count-in
      </label>
      <label className="togglelbl" title="Add drums, bass and keys locked to your chords">
        <input
          type="checkbox"
          checked={bandOn}
          onChange={(e) => {
            setBandOn(e.target.checked);
            setBand(e.target.checked ? { drums: true, bass: true, keys: true, style } : null);
          }}
        />
        🥁 band
      </label>
      {bandOn && (
        <select
          style={{ fontSize: 12, padding: "4px 7px", border: "1px solid var(--border)", borderRadius: 7, background: "var(--panel-strong)", color: "var(--fg)" }}
          value={style}
          onChange={(e) => {
            const st = e.target.value as Arrangement["style"];
            setStyle(st);
            setBand({ drums: true, bass: true, keys: true, style: st });
          }}
        >
          {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )}
      <div className="grow" />
      <button
        className={`btn${listening ? " primary" : ""}`}
        disabled={captureDisabled}
        onClick={onCaptureToggle}
        title="Capture your guitar/hum through the selected input"
      >
        {listening ? "◉ Listening… (tap when done)" : "🎤 Play it back to me"}
      </button>
    </div>
  );
}
