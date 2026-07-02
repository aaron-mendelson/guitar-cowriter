/* ============================================================
 * Chat.tsx — the bandmate conversation: reasoning out loud,
 * option cards (audition / keep / toss), expandable teaching labels.
 * ============================================================ */
import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { MelodyOption } from "../ai/schemas";

interface Props {
  onSubmit: (text: string) => void;
  onAudition: (opt: MelodyOption) => void;
  onVerdict: (opt: MelodyOption, v: "accepted" | "tweaked" | "rejected") => void;
}

const EXAMPLES = [
  "C Am F G — make it a prog-rock anthem",
  "Em C G D at 72 bpm, wistful indie folk — find me a topline",
  "neo-soul in A minor at 85 bpm, give me something to react to",
];

function OptionCard({ opt, onAudition, onVerdict }: { opt: MelodyOption } & Omit<Props, "onSubmit">) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`optioncard${open ? " open" : ""}`}>
      <div className="oname">
        <span className="char">{opt.character}</span>
        <span style={{ color: "var(--comment)", fontWeight: 600 }}>·</span>
        <span style={{ color: "var(--muted)", fontWeight: 700 }}>{opt.method}</span>
      </div>
      <div className="method">{opt.events.length} notes</div>
      <div className="obtns">
        <button className="btn small primary" onClick={() => onAudition(opt)}>▶ Hear it</button>
        <button className="btn small" onClick={() => onVerdict(opt, "accepted")}>✓ Keep</button>
        <button className="btn small ghost" onClick={() => onVerdict(opt, "rejected")}>✗ Toss</button>
        <button className="btn small ghost" onClick={() => setOpen((o) => !o)} title="teaching note">
          {open ? "▾" : "▸"} why
        </button>
      </div>
      <div className="teach">{opt.teaching}</div>
    </div>
  );
}

export default function Chat({ onSubmit, onAudition, onVerdict }: Props) {
  const chat = useStore((s) => s.chat);
  const busy = useStore((s) => s.busy);
  const [text, setText] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.length, busy]);

  const send = () => {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    onSubmit(t);
  };

  return (
    <div className="chat panel">
      <div className="chatlog" ref={logRef}>
        {chat.length === 0 && (
          <div className="opener">
            <h2>🎸 What've you got?</h2>
            <p>
              I'm your co-writer. Bring me a progression, a riff, a vibe — and tell me where you
              want to take it. I'll think out loud, play my ideas, and we'll shape them together.
            </p>
            <div className="examples">
              {EXAMPLES.map((ex) => (
                <button key={ex} onClick={() => onSubmit(ex)}>{ex}</button>
              ))}
            </div>
          </div>
        )}
        {chat.map((m) => (
          <div key={m.id} className={`msg ${m.who}`}>
            {m.text}
            {m.options?.map((opt, i) => (
              <OptionCard key={i} opt={opt} onAudition={onAudition} onVerdict={onVerdict} />
            ))}
            {m.nudge && <div className="nudge">→ {m.nudge}</div>}
          </div>
        ))}
        {busy && (
          <div className="msg ai">
            <span className="spin" /> thinking…
          </div>
        )}
      </div>
      <div className="chatinput">
        <textarea
          value={text}
          placeholder='e.g. "C Am F G — make it a prog-rock anthem"'
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn primary" disabled={busy || !text.trim()} onClick={send}>
          Send
        </button>
      </div>
    </div>
  );
}
