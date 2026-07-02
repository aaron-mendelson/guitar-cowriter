/* ============================================================
 * useCowriter.ts — the controller for the core bandmate loop:
 *   intent → propose → audition → accept/reject →
 *   capture variant → diff → react.
 * ============================================================ */
import { useCallback } from "react";
import { useStore } from "../state/store";
import { ROOTS, classifyPc } from "../engine/theory";
import { songFromChordNames, chordAtBeat, slotRoot, songLengthBeats, newId, type Song } from "../engine/progression";
import { normalizePhrase, type Phrase } from "../engine/noteEvents";
import type { MelodyOption, SessionFrame } from "../ai/schemas";
import { parseIntent, fallbackFrame } from "../ai/intent";
import { cowriterTurn, offlineTurn, reactToVariant, type CowriterSession } from "../ai/cowriter";
import { hasKey } from "../ai/client";
import { getTaste, recordVerdict, tasteNotes } from "../ai/taste";
import { relevantPhrases } from "../ai/phraseBank";
import { diffPhrases, describeDiffs } from "../listen/diff";
import { applySong, applyPhrases, auditionPhrase, startCapture, stopCapture, play } from "./audioFacade";

const session: CowriterSession = { history: [], frame: null };

/** Vibe references pulled from pasted links (YouTube etc.) — merged into every prompt. */
const inspirations: string[] = [];

const YT_RE = /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?[^\s]+|youtu\.be\/[^\s]+|youtube\.com\/shorts\/[^\s]+))/i;

async function pullInspiration(text: string): Promise<string | null> {
  const m = text.match(YT_RE);
  if (!m) return null;
  try {
    const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(m[1])}`);
    const j = (await res.json()) as { title?: string; author_name?: string };
    if (!j.title) return null;
    const line = `Reference track for the vibe: "${j.title}"${j.author_name ? ` by ${j.author_name}` : ""} — aim the feel/energy near this.`;
    inspirations.push(line);
    return `${j.title}${j.author_name ? ` — ${j.author_name}` : ""}`;
  } catch {
    return null;
  }
}

function withInspiration(examples: string[]): string[] {
  return [...inspirations.slice(-3), ...examples];
}

function frameToSong(frame: SessionFrame, prev: Song | null): Song | null {
  if (frame.have.kind === "progression" && frame.have.chords?.length) {
    // pick tonic: explicit key in vibe, else first chord
    let tonicIdx = 0;
    let mode: "major" | "minor" = "major";
    const key = frame.vibe.key;
    if (key) {
      const m = key.trim().match(/^([A-G](?:♯|#|♭|b)?)\s*(m|min|minor)?/i);
      if (m) {
        const name = m[1].replace("#", "♯").replace(/([A-G])b/, "$1♭");
        const idx = ROOTS.findIndex((r) => r.name.toLowerCase() === name.toLowerCase());
        if (idx >= 0) tonicIdx = idx;
        if (m[2]) mode = "minor";
      }
    } else {
      const first = frame.have.chords[0].trim();
      const name = first.replace(/(m|maj7|m7|7|dim|aug).*$/i, "").replace("#", "♯").replace(/([A-G])b/, "$1♭");
      const idx = ROOTS.findIndex((r) => r.name === name);
      if (idx >= 0) tonicIdx = idx;
      if (/^[A-G](♯|#|♭|b)?m(?!aj)/.test(first)) mode = "minor";
    }
    return songFromChordNames(frame.have.chords, tonicIdx, mode, frame.vibe.bpm ?? 90);
  }
  return prev;
}

function optionToPhrase(opt: MelodyOption, song: Song | null): Phrase {
  const lengthBeats = song ? songLengthBeats(song) : Math.max(4, ...opt.events.map((e) => e.startBeat + e.durBeat));
  return normalizePhrase({
    id: newId("opt"),
    label: `${opt.character} · ${opt.method}`,
    lengthBeats,
    events: opt.events,
    voice: "ai",
    method: opt.method,
  });
}

export function useCowriter() {
  const st = useStore;

  const submit = useCallback(async (text: string) => {
    const s = st.getState();
    s.addMsg({ who: "user", text });
    s.setBusy(true);
    try {
      // pasted YouTube link → pull title/author as a vibe reference
      const ref = await pullInspiration(text);
      if (ref) s.addMsg({ who: "system", text: `🎬 Pulled reference: ${ref}` });
      // 1) frame the intent (first message or when it looks like a re-frame)
      let frame = session.frame;
      if (!frame || /[A-G](♯|#|♭|b)?(m|maj7|m7|7)?(\s+[A-G](♯|#|♭|b)?(m|maj7|m7|7)?){1,}/.test(text)) {
        frame = hasKey() ? await parseIntent(text).catch(() => fallbackFrame(text)) : fallbackFrame(text);
        session.frame = frame;
        s.setFrame(frame);
        const song = frameToSong(frame, s.song);
        if (song && song !== s.song) {
          s.setSong(song);
          applySong(song);
        }
      }
      // 2) co-writer turn
      const ctx = {
        song: st.getState().song,
        tasteNotes: tasteNotes(),
        phraseExamples: withInspiration(relevantPhrases(frame)),
      };
      const turn = hasKey()
        ? await cowriterTurn(session, text, ctx).catch((e: Error) => {
            st.getState().addMsg({ who: "system", text: `⚠ ${e.message} — using the built-in lenses instead.` });
            return offlineTurn(text, ctx);
          })
        : offlineTurn(text, ctx);
      st.getState().addTurn(turn);
    } finally {
      st.getState().setBusy(false);
    }
  }, [st]);

  const audition = useCallback(async (opt: MelodyOption) => {
    const s = st.getState();
    const phrase = optionToPhrase(opt, s.song);
    s.setActivePhrase(phrase);
    if (s.song) {
      applyPhrases([phrase]);
      if (!s.playing) await play(0);
    } else {
      await auditionPhrase(phrase, s.bpm);
    }
  }, [st]);

  const verdict = useCallback((opt: MelodyOption, v: "accepted" | "tweaked" | "rejected") => {
    recordVerdict({ method: opt.method, character: opt.character }, v);
    const s = st.getState();
    if (v === "accepted") {
      const phrase = optionToPhrase(opt, s.song);
      s.setActivePhrase(phrase);
      applyPhrases([phrase]);
      s.addMsg({ who: "system", text: `Kept: ${opt.character} (${opt.method})` });
    }
    if (v === "rejected" && s.activePhrase?.method === opt.method) {
      s.setActivePhrase(null);
      applyPhrases([]);
    }
  }, [st]);

  const captureToggle = useCallback(async () => {
    const s = st.getState();
    if (!s.listening) {
      await startCapture(s.inputDeviceId);
      s.addMsg({ who: "system", text: "Listening — play your take, then tap again." });
      return;
    }
    // finalize capture
    const events = stopCapture(s.bpm);
    if (!events.length) {
      s.addMsg({ who: "system", text: "Didn't catch any notes — check the input device in Settings and try again." });
      return;
    }
    const song = s.song;
    // re-classify roles against the governing chords
    const classified = events.map((e) => {
      if (!song) return e;
      const at = chordAtBeat(song, e.startBeat);
      return { ...e, role: classifyPc(e.midi % 12, { root: slotRoot(at.slot), typeKey: at.slot.typeKey }, ROOTS[song.tonicIdx], song.mode) };
    });
    const userPhrase = normalizePhrase({
      id: newId("take"),
      label: "your take",
      lengthBeats: song ? songLengthBeats(song) : Math.max(4, ...classified.map((e) => e.startBeat + e.durBeat)),
      events: classified,
      voice: "user",
    });
    s.setUserPhrase(userPhrase);
    s.addMsg({ who: "system", text: `Heard ${userPhrase.events.length} notes.` });

    // the propose→vary heart: diff against the active proposal and react
    if (s.activePhrase && userPhrase.events.length) {
      const diffs = diffPhrases(s.activePhrase.events, userPhrase.events);
      const summary = diffs.length ? describeDiffs(diffs) : "played it essentially as proposed";
      s.setBusy(true);
      try {
        const ctx = { song, tasteNotes: tasteNotes(), phraseExamples: withInspiration(relevantPhrases(session.frame)) };
        const turn = hasKey()
          ? await reactToVariant(session, summary, ctx).catch((e: Error) => {
              st.getState().addMsg({ who: "system", text: `⚠ ${e.message}` });
              return offlineTurn(summary, ctx);
            })
          : offlineTurn(`react to: ${summary}`, ctx);
        st.getState().addTurn(turn);
      } finally {
        st.getState().setBusy(false);
      }
    }
  }, [st]);

  return { submit, audition, verdict, captureToggle, taste: getTaste };
}
