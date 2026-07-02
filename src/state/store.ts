/* ============================================================
 * store.ts — central Zustand store: session, song, phrases, chat.
 * ============================================================ */
import { create } from "zustand";
import type { Song } from "../engine/progression";
import type { Phrase } from "../engine/noteEvents";
import type { SessionFrame, MelodyOption, CowriterTurn } from "../ai/schemas";

export interface ChatMsg {
  id: string;
  who: "user" | "ai" | "system";
  text: string;
  /** options attached to an AI turn (playable) */
  options?: MelodyOption[];
  nudge?: string;
  at: number;
}

export type OptionVerdict = "accepted" | "tweaked" | "rejected";

interface UiState {
  themeMode: "dark" | "light";
  song: Song | null;
  frame: SessionFrame | null;
  chat: ChatMsg[];
  /** the currently auditioned/accepted AI phrase */
  activePhrase: Phrase | null;
  /** the user's captured variant (from listening) */
  userPhrase: Phrase | null;
  /** live transport mirror for UI */
  playing: boolean;
  posBeat: number;
  bpm: number;
  loopOn: boolean;
  /** capture state */
  listening: boolean;
  inputDeviceId: string | null;
  /** current option being auditioned (index into last turn's options) */
  auditionIdx: number | null;
  busy: boolean;

  setTheme(m: "dark" | "light"): void;
  setSong(s: Song | null): void;
  setFrame(f: SessionFrame | null): void;
  addMsg(m: Omit<ChatMsg, "id" | "at">): void;
  addTurn(turn: CowriterTurn): void;
  setActivePhrase(p: Phrase | null): void;
  setUserPhrase(p: Phrase | null): void;
  setPlaying(v: boolean): void;
  setPosBeat(b: number): void;
  setBpm(n: number): void;
  setLoopOn(v: boolean): void;
  setListening(v: boolean): void;
  setInputDeviceId(id: string | null): void;
  setAuditionIdx(i: number | null): void;
  setBusy(v: boolean): void;
}

let n = 0;
const mid = () => `m${Date.now().toString(36)}${(n++).toString(36)}`;

export const useStore = create<UiState>((set) => ({
  themeMode: (typeof localStorage !== "undefined" && (localStorage.getItem("cowriter-theme") as "dark" | "light")) || "dark",
  song: null,
  frame: null,
  chat: [],
  activePhrase: null,
  userPhrase: null,
  playing: false,
  posBeat: 0,
  bpm: 90,
  loopOn: true,
  listening: false,
  inputDeviceId: null,
  auditionIdx: null,
  busy: false,

  setTheme: (m) => {
    if (typeof localStorage !== "undefined") localStorage.setItem("cowriter-theme", m);
    set({ themeMode: m });
  },
  setSong: (song) => set({ song }),
  setFrame: (frame) => set({ frame }),
  addMsg: (m) => set((s) => ({ chat: [...s.chat, { ...m, id: mid(), at: Date.now() }] })),
  addTurn: (turn) =>
    set((s) => ({
      chat: [
        ...s.chat,
        { id: mid(), who: "ai" as const, text: turn.say, options: turn.options, nudge: turn.nudge, at: Date.now() },
      ],
    })),
  setActivePhrase: (activePhrase) => set({ activePhrase }),
  setUserPhrase: (userPhrase) => set({ userPhrase }),
  setPlaying: (playing) => set({ playing }),
  setPosBeat: (posBeat) => set({ posBeat }),
  setBpm: (bpm) => set({ bpm }),
  setLoopOn: (loopOn) => set({ loopOn }),
  setListening: (listening) => set({ listening }),
  setInputDeviceId: (inputDeviceId) => set({ inputDeviceId }),
  setAuditionIdx: (auditionIdx) => set({ auditionIdx }),
  setBusy: (busy) => set({ busy }),
}));
