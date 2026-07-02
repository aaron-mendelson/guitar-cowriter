/* ============================================================
 * TransportBar.tsx — play/stop, BPM, loop, count-in, click,
 * plus the capture (listen) button for the propose→vary loop.
 * ============================================================ */
import { useStore } from "../state/store";
import { play, stop, setBpm } from "./audioFacade";
import { getTransport } from "../audio/transport";

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
