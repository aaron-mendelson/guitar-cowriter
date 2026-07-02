/* ============================================================
 * SettingsModal.tsx — API key (BYO, stays in localStorage),
 * model picker, theme.
 * ============================================================ */
import { useState } from "react";
import { getAiConfig, setAiConfig, MODELS } from "../ai/client";
import { initWebMidi, listMidiOuts, selectMidiOut } from "../audio/midiVoice";
import { useStore } from "../state/store";

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const cfg = getAiConfig();
  const [key, setKey] = useState(cfg.apiKey ?? "");
  const [model, setModel] = useState(cfg.model);
  const themeMode = useStore((s) => s.themeMode);
  const setTheme = useStore((s) => s.setTheme);
  const [midiOuts, setMidiOuts] = useState<{ id: string; name: string }[] | null>(null);
  const [midiSel, setMidiSel] = useState<string>("");

  const enableMidi = async () => {
    const ok = await initWebMidi();
    setMidiOuts(ok ? listMidiOuts() : []);
  };

  const save = () => {
    setAiConfig({ apiKey: key.trim() || undefined, model });
    onClose();
  };

  return (
    <div className="modalback" onClick={onClose}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()}>
        <h3>Settings</h3>
        <div>
          <label>Anthropic API key (stays in this browser)</label>
          <input
            type="password" value={key} placeholder="sk-ant-…"
            onChange={(e) => setKey(e.target.value)}
          />
          <span style={{ fontSize: 11, color: "var(--comment)" }}>
            No key? The app still works with its built-in melodic lenses — the AI adds the conversation.
          </span>
        </div>
        <div>
          <label>Model</label>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label>Web MIDI out (AI plays through your DAW / synth)</label>
          {midiOuts === null ? (
            <button className="btn small" onClick={() => void enableMidi()}>Enable Web MIDI</button>
          ) : midiOuts.length === 0 ? (
            <span style={{ fontSize: 11.5, color: "var(--comment)" }}>No MIDI outputs found (or permission denied).</span>
          ) : (
            <select
              value={midiSel}
              onChange={(e) => {
                setMidiSel(e.target.value);
                selectMidiOut(e.target.value || null);
              }}
            >
              <option value="">In-app voice only</option>
              {midiOuts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <span style={{ fontSize: 11, color: "var(--comment)" }}>
            When an output is selected, the AI's lines are also sent as MIDI — route them into your amp sim or a synth.
          </span>
        </div>
        <div>
          <label>Theme</label>
          <select value={themeMode} onChange={(e) => setTheme(e.target.value as "dark" | "light")}>
            <option value="dark">Dracula (dark)</option>
            <option value="light">Alucard (light)</option>
          </select>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
