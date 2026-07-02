/* ============================================================
 * MixerPanel.tsx — small mixer: AI voice / backing / click /
 * guitar-in faders with meters, mute, input-device picker.
 * ============================================================ */
import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { listAudioInputs, setChannelGain, muteChannel, channelMeter } from "./audioFacade";
import { startRecording, stopRecording } from "../audio/mixer";

type Ch = "guitar" | "ai" | "backing" | "click" | "input" | "master";

const CHANNELS: { ch: Ch; label: string }[] = [
  { ch: "input", label: "Guitar in" },
  { ch: "ai", label: "AI voice" },
  { ch: "backing", label: "Backing" },
  { ch: "click", label: "Click" },
  { ch: "master", label: "Master" },
];

function Fader({ ch, label }: { ch: Ch; label: string }) {
  const [v, setV] = useState(ch === "input" ? 0 : 0.8);
  const [muted, setMuted] = useState(false);
  const meterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    let read: (() => number) | null = null;
    try { read = channelMeter(ch); } catch { /* audio not started yet */ }
    const tick = () => {
      if (read && meterRef.current) {
        const rms = Math.min(1, read() * 3);
        meterRef.current.style.width = `${Math.round(rms * 100)}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ch]);

  return (
    <div className="fader">
      <div className="meter"><div ref={meterRef} /></div>
      <input
        type="range" min={0} max={1} step={0.01} value={v}
        onChange={(e) => {
          const nv = Number(e.target.value);
          setV(nv);
          try { setChannelGain(ch, nv); } catch { /* not started */ }
        }}
      />
      <button className={`mute${muted ? " on" : ""}`} onClick={() => {
        const nm = !muted;
        setMuted(nm);
        try { muteChannel(ch, nm); } catch { /* not started */ }
      }}>M</button>
      {label}
    </div>
  );
}

export default function MixerPanel() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [recording, setRecording] = useState(false);
  const inputDeviceId = useStore((s) => s.inputDeviceId);
  const setInputDeviceId = useStore((s) => s.setInputDeviceId);

  useEffect(() => {
    listAudioInputs().then(setDevices).catch(() => setDevices([]));
  }, []);

  const toggleRecord = async () => {
    if (!recording) {
      try { startRecording(); setRecording(true); } catch { /* audio not started */ }
      return;
    }
    setRecording(false);
    const blob = await stopRecording();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cowriter-take-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mixer panel">
      {CHANNELS.map((c) => <Fader key={c.ch} ch={c.ch} label={c.label} />)}
      <button className={`btn small${recording ? " primary" : ""}`} style={{ alignSelf: "center" }} onClick={() => void toggleRecord()}>
        {recording ? "◼ Save take" : "⏺ Record"}
      </button>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginLeft: "auto" }}>
        <label style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--comment)", fontWeight: 700 }}>
          Input device
        </label>
        <select
          style={{ fontSize: 12.5, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--panel-strong)", color: "var(--fg)", maxWidth: 220 }}
          value={inputDeviceId ?? ""}
          onChange={(e) => setInputDeviceId(e.target.value || null)}
        >
          <option value="">System default</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label || `Input ${d.deviceId.slice(0, 6)}`}</option>
          ))}
        </select>
        <span style={{ fontSize: 10.5, color: "var(--comment)", maxWidth: 220 }}>
          Keep monitoring your guitar through your interface — "Guitar in" stays at 0 to avoid echo; it's captured for listening.
        </span>
      </div>
    </div>
  );
}
