/* ============================================================
 * SettingsModal.tsx — API key (BYO, stays in localStorage),
 * model picker, theme.
 * ============================================================ */
import { useState } from "react";
import { getAiConfig, setAiConfig, MODELS } from "../ai/client";
import { useStore } from "../state/store";

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const cfg = getAiConfig();
  const [key, setKey] = useState(cfg.apiKey ?? "");
  const [model, setModel] = useState(cfg.model);
  const themeMode = useStore((s) => s.themeMode);
  const setTheme = useStore((s) => s.setTheme);

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
