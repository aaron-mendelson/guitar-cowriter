/* ============================================================
 * context.ts — lazy shared AudioContext + memoized mixer bus.
 * Nothing here touches the Web Audio API until first use, so
 * importing this module before a user gesture is always safe.
 * ============================================================ */

export type ChannelName = "guitar" | "ai" | "backing" | "click" | "input" | "master";

export interface MasterBus {
  guitar: GainNode;
  ai: GainNode;
  backing: GainNode;
  click: GainNode;
  input: GainNode;
  master: GainNode;
}

let ctx: AudioContext | null = null;
let bus: MasterBus | null = null;

/** Lazy shared AudioContext. Created on first call; resumed if suspended. */
export function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Memoized mixer graph: each channel GainNode → master GainNode → destination. */
export function masterBus(): MasterBus {
  if (bus) return bus;
  const c = getCtx();
  const master = c.createGain();
  master.connect(c.destination);
  const mk = (): GainNode => {
    const g = c.createGain();
    g.connect(master);
    return g;
  };
  bus = { guitar: mk(), ai: mk(), backing: mk(), click: mk(), input: mk(), master };
  // Input monitoring defaults to silent — the player monitors on their own
  // hardware; we capture for listening/recording without creating echo.
  bus.input.gain.value = 0;
  return bus;
}

/** Current audio-clock time in seconds. */
export function now(): number {
  return getCtx().currentTime;
}
