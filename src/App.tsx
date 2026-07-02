/* ============================================================
 * App.tsx — shell: chat column + stage (fretboard, transport,
 * timeline, mixer). Wires the core bandmate loop.
 * ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "./state/store";
import { slotVoicing, chordAtBeat, serializeSong, deserializeSong } from "./engine/progression";
import Fretboard, { type BoardDot } from "./ui/Fretboard";
import Timeline from "./ui/Timeline";
import TransportBar from "./ui/TransportBar";
import Chat from "./ui/Chat";
import MixerPanel from "./ui/MixerPanel";
import SettingsModal from "./ui/SettingsModal";
import { useCowriter } from "./ui/useCowriter";
import { pluck } from "./ui/audioFacade";
import "./theme.css";

export default function App() {
  const themeMode = useStore((s) => s.themeMode);
  const song = useStore((s) => s.song);
  const activePhrase = useStore((s) => s.activePhrase);
  const userPhrase = useStore((s) => s.userPhrase);
  const posBeat = useStore((s) => s.posBeat);
  const playing = useStore((s) => s.playing);
  const frame = useStore((s) => s.frame);
  const [showSettings, setShowSettings] = useState(false);

  const { submit, audition, verdict, captureToggle } = useCowriter();

  // restore last song once; persist on change
  useEffect(() => {
    const saved = localStorage.getItem("cowriter-song");
    if (saved && !useStore.getState().song) {
      try {
        const s = deserializeSong(saved);
        useStore.getState().setSong(s);
        useStore.getState().setBpm(s.bpm);
        useStore.getState().addMsg({ who: "system", text: `Restored your last progression (${s.sections[0]?.slots.length ?? 0} chords). Say where you want to take it.` });
      } catch { /* corrupt save — ignore */ }
    }
  }, []);
  useEffect(() => {
    if (song) localStorage.setItem("cowriter-song", serializeSong(song));
  }, [song]);

  // current chord's voicing as subdued dots
  const chordDots: BoardDot[] = useMemo(() => {
    if (!song) return [];
    const at = chordAtBeat(song, playing ? posBeat : 0);
    const v = slotVoicing(at.slot);
    return v.dots.map((d) => ({
      stringNum: d.stringNum,
      fret: d.fret,
      label: d.tone.name,
      fill: "var(--selection)",
    }));
  }, [song, playing, posBeat]);

  return (
    <div className={`app theme-${themeMode}`}>
      <header className="top">
        <h1><span className="glyph">◆</span> Guitar Co-Writer</h1>
        <span className="sub">your AI bandmate — ideas in, songs out</span>
        <div className="grow" />
        {frame && (
          <span className="sub">
            {frame.vibe.genre ?? ""} {frame.vibe.bpm ? `· ${frame.vibe.bpm} bpm` : ""} {frame.vibe.key ? `· ${frame.vibe.key}` : ""}
          </span>
        )}
        <button className="iconbtn" title="Settings" onClick={() => setShowSettings(true)}>⚙</button>
      </header>

      <main className="cols">
        <div className="chatcol">
          <Chat onSubmit={submit} onAudition={audition} onVerdict={verdict} />
        </div>

        <div className="stagecol">
          <div className="panel">
            <div className="stagehead">
              <b style={{ fontSize: 13.5 }}>The neck</b>
              <span className="keybadge">
                {activePhrase ? `AI line: ${activePhrase.label}` : "propose something to see it here"}
                {userPhrase ? ` · your take overlaid` : ""}
              </span>
            </div>
            <div className="boardwrap">
              <Fretboard
                chordDots={chordDots}
                aiPhrase={activePhrase}
                userPhrase={userPhrase}
                posBeat={posBeat}
                playing={playing}
                onPluck={pluck}
              />
            </div>
            <div className="legend">
              <span><i className="chip" style={{ background: "var(--role-target)" }} /> chord tone (land here)</span>
              <span><i className="chip" style={{ background: "var(--role-bridge)" }} /> bridge / passing</span>
              <span><i className="chip" style={{ background: "var(--role-color)" }} /> color (outside)</span>
              <span><i className="chip" style={{ background: "var(--voice-ai)" }} /> AI voice ring</span>
              <span><i className="chip" style={{ background: "var(--voice-user)" }} /> your take ring</span>
            </div>
          </div>

          <TransportBar onCaptureToggle={() => void captureToggle()} captureDisabled={false} />

          {song && <div className="panel"><Timeline song={song} /></div>}

          <MixerPanel />
        </div>
      </main>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
