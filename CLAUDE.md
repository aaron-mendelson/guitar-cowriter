# CLAUDE.md — Guitar Co-Writer

An AI-bandmate co-writing app for Aaron (intermediate guitarist): bring a progression/riff/vibe,
the co-writer reasons out loud, proposes melodies (words + sound + role-colored dots on the
fretboard), listens to Aaron play variants back, and reacts to the differences as creative intent.

**Read `docs/DESIGN.md` first** — it is the full design record: positioning (vs Suno/ACE/Moises),
the co-writing experience, the melodic-lens toolkit, the intent-first keystone, and the build plans.

## Layout — two bodies, one brain

- **`mac/` — the go-forward NATIVE Mac app** (Aaron's call after the web hit its limits):
  Swift Package, built with Command Line Tools only (`mac/make-app.sh` → GuitarCowriter.app;
  NO Xcode installed; NO XCTest — checks run via `swift run CoWriterKitChecks`).
  - `Sources/CoWriterKit` — theory engine ported from the web TS (55 checks), progression,
    melodic lenses + style knobs, backing arrangements. Pure, value-typed.
  - `Sources/CoWriterAudio` — AVAudioEngine body: AU instrument/effect hosting, AudioBox
    input selection (CoreAudio HAL), guitar insert chain (input → amp-sim/effect AU slots →
    wet tap → Guitar fader; app monitoring off by default, takes always record wet),
    lookahead transport, NSDF pitch tracker (±0.1 cent), GM percussion sampler, recorder.
  - `Sources/GuitarCowriter` — SwiftUI shell. `Facade.swift` is the ONLY seam UI→audio;
    `TheoryBridge.swift` is the ONLY seam app→engine; `Brain.swift` talks to the server.
- **Web app (root)** — Vite/React/TS, kept as demo; live at aaron-mendelson.github.io/guitar-cowriter
  and self-hosted on the VPS. `src/engine/*.ts` is the ORIGINAL validated theory engine —
  treat it as the reference when porting; its vitest suite (`npx vitest run`) must stay green.
- **`server/server.mjs` — the brain**. Serves the web dist AND `/cowrite`: proxies structured
  co-writer turns through the **Claude Agent SDK with CLAUDE_CODE_OAUTH_TOKEN** (Aaron's Max
  subscription — NEVER introduce an API-key requirement). Deployed on the tailnet VPS
  `relay` (100.99.53.118): `https://relay.tail57b23d.ts.net/cowrite` via `tailscale serve`.
  Redeploy: ssh root@100.99.53.118 → `cd /opt/opal/guitar-cowriter && git pull && docker compose up -d --build`.

## Machines

- **nomad** (MacBook) — Aaron's music machine: DAW, instrument/effect plugins, AudioBox 44VSL.
  The Mac app should be BUILT AND RUN HERE.
- **cortex** (Mac Mini) — where the project was originally built; Opal gateway lives here.
- **relay** (Hostinger VPS, tailnet-only) — the brain + web app hosting.

## Rules

- The AI's note events are NEVER trusted: always re-classify roles/clamp/monophony via the
  engine (`TheoryBridge.sanitize` / web `sanitizeTurn`) before rendering or playing.
- Every idea must arrive three ways at once: words (reasoning), sound, shape (neck dots).
  Theory surfaces as expandable teaching labels — this is a learning tool AND inspiration tool.
- Keep Fretboard Explorer (~/fretboard-explorer) untouched — it's a separate finished app.
- Commit email: aaron@modernhorizons.com. Verify builds before claiming done:
  `cd mac && swift build && swift run CoWriterKitChecks` (and web: `npx vitest run`).

## Status: PAUSED FOR RETHINK (2026-07-02)

Aaron owns Mixed In Key **Captain Plugins Epic** (installed on nomad as aumu AUs) — it covers
key-locked progressions + chord-following melody/bass/drums + MIDI/audio export, i.e. most of
the planned backing layer and composition-side structure. The gap it does NOT cover — and the
reason this project exists — is **co-writing guitar licks**: listening, fretboard-native ideas,
reacting to how Aaron plays a phrase back. Open question under rethink: the current build's
AI voice (quantized MIDI through an AU instrument, chat-turn cadence) may not fit lick
co-writing either. Candidate directions: articulation-aware note events (bends/slides),
phrase-bank vocabulary + motif transforms over raw LLM notes, jam-loop (trade fours) instead
of chat cadence.

## Next up (if resumed on the old track)

1. Generative backing layer — likely superseded by Captain Epic (see Status)
2. Native taste profile, session persistence, mixer meters (+ persist rig: inserts/instruments)
3. Capture start sync to loop boundary (press 🎤 mid-loop → snap to bar 1)
