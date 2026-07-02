/* ============================================================
 * LensBar.tsx — one-tap melodic lenses: generate a line from the
 * engine directly (no AI needed), hear it over the loop.
 * ============================================================ */
import { LENSES, type LensKey } from "../engine/melody";
import { useStore } from "../state/store";
import { applyPhrases, play } from "./audioFacade";

export default function LensBar() {
  const song = useStore((s) => s.song);
  const playing = useStore((s) => s.playing);
  const setActivePhrase = useStore((s) => s.setActivePhrase);
  const addMsg = useStore((s) => s.addMsg);

  if (!song) return null;

  const fire = async (key: LensKey) => {
    const lens = LENSES[key];
    const phrase = lens.gen(song);
    setActivePhrase(phrase);
    applyPhrases([phrase]);
    addMsg({ who: "system", text: `Lens: ${lens.label} — ${lens.teach}` });
    if (!playing) await play(0);
  };

  const clear = () => {
    setActivePhrase(null);
    applyPhrases([]);
  };

  return (
    <div style={{ display: "flex", gap: 7, alignItems: "center", padding: "0 14px 12px", flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, color: "var(--comment)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>
        Lenses
      </span>
      {(Object.keys(LENSES) as LensKey[]).map((k) => (
        <button key={k} className="btn small ghost" title={LENSES[k].teach} onClick={() => void fire(k)}>
          {LENSES[k].label}
        </button>
      ))}
      <button className="btn small ghost" style={{ color: "var(--comment)" }} onClick={clear}>clear line</button>
    </div>
  );
}
