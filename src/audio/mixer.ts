/* ============================================================
 * mixer.ts — input capture, channel gains/mutes, level meters,
 * and master-bus recording.
 * ============================================================ */
import { type ChannelName, getCtx, masterBus } from "./context";

/* ---------- Input capture ---------- */

let stream: MediaStream | null = null;
let srcNode: MediaStreamAudioSourceNode | null = null;

export async function listAudioInputs(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "audioinput");
}

/**
 * Open a raw (unprocessed) audio input and route it into the `input` bus channel.
 * NOTE: the input channel gain defaults to 0 — we capture for listening/recording
 * without monitoring echo; the player monitors on their own hardware.
 */
export async function openInput(deviceId?: string): Promise<void> {
  closeInput();
  const constraints = {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    echoCancellation: false,
    autoGainControl: false,
    noiseSuppression: false,
    latency: 0,
  } as MediaTrackConstraints;
  stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
  const ctx = getCtx();
  srcNode = ctx.createMediaStreamSource(stream);
  srcNode.connect(masterBus().input);
}

export function closeInput(): void {
  if (srcNode) {
    srcNode.disconnect();
    srcNode = null;
  }
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
}

/** The live input stream, for the listening layer. Null when no input is open. */
export function inputStream(): MediaStream | null {
  return stream;
}

/* ---------- Gains & mutes ---------- */

const preMuteGain = new Map<ChannelName, number>();

export function setChannelGain(ch: ChannelName, v: number): void {
  const g = Math.max(0, v);
  if (preMuteGain.has(ch)) {
    preMuteGain.set(ch, g); // channel is muted: remember the new level for unmute
  } else {
    masterBus()[ch].gain.value = g;
  }
}

export function muteChannel(ch: ChannelName, muted: boolean): void {
  const gain = masterBus()[ch].gain;
  if (muted) {
    if (!preMuteGain.has(ch)) preMuteGain.set(ch, gain.value);
    gain.value = 0;
  } else if (preMuteGain.has(ch)) {
    gain.value = preMuteGain.get(ch)!;
    preMuteGain.delete(ch);
  }
}

/* ---------- Meters ---------- */

interface MeterTap {
  analyser: AnalyserNode;
  data: Float32Array<ArrayBuffer>;
}

const meters = new Map<ChannelName, MeterTap>();

/** Returns a reader function producing the channel's current RMS level 0..1. */
export function channelMeter(ch: ChannelName): () => number {
  let tap = meters.get(ch);
  if (!tap) {
    const analyser = getCtx().createAnalyser();
    analyser.fftSize = 1024;
    masterBus()[ch].connect(analyser); // tap only; analyser has no output connection
    tap = { analyser, data: new Float32Array(analyser.fftSize) };
    meters.set(ch, tap);
  }
  const { analyser, data } = tap;
  return () => {
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    return Math.min(1, Math.sqrt(sum / data.length));
  };
}

/* ---------- Recording ---------- */

let recDest: MediaStreamAudioDestinationNode | null = null;
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];

/** Start recording the master bus. No-op if already recording. */
export function startRecording(): void {
  if (recorder && recorder.state === "recording") return;
  const ctx = getCtx();
  if (!recDest) {
    recDest = ctx.createMediaStreamDestination();
    masterBus().master.connect(recDest);
  }
  chunks = [];
  recorder = new MediaRecorder(recDest.stream);
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start();
}

/** Stop recording and resolve with the captured audio blob. */
export function stopRecording(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const r = recorder;
    if (!r || r.state === "inactive") {
      reject(new Error("Not recording"));
      return;
    }
    r.onstop = () => {
      recorder = null;
      resolve(new Blob(chunks, { type: r.mimeType || "audio/webm" }));
    };
    r.stop();
  });
}
