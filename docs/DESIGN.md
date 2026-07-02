# Guitar Co-Writer — Songwriting Tool Plan

> ★ **Authoritative execution plan = the "FINAL BUILD PLAN" section at the bottom of this file.** Everything between here and there is the design record (vision, competitive analysis, the co-writing experience) that the build plan draws on.

## Context

Aaron is an intermediate guitarist actively leveling up via online lessons (Donut Doctor "Back to Basics" — the source of the triad focus). He wants an AI-assisted **co-writing** tool: pick chord progressions, then have AI help craft phrasing — melodies, harmonies, and progression ideas — with an eventual backing-track generator and the ability to feed in YouTube/MP4 links or a recorded lick as inspiration.

He plays through an **audio interface with amp-sim plugins / standalone programs** for his tone, and wants a **small mixer** in the app to blend that guitar signal with the app's playback.

The existing **Fretboard Explorer** (`~/fretboard-explorer/index.html`) already contains a rigorous, correct music engine and working audio. **It stays exactly as-is** — this is a brand-new, standalone app that *copies* the proven engine functions (no refactor of, or dependency back into, Fretboard Explorer).

### Confirmed decisions
- **Keep Fretboard Explorer untouched.** New standalone app (`~/guitar-cowriter`).
- **Web app** (with a native Mac version kept as an open later fork — see Audio I/O).
- **Milestone 1 = Jam Playground** (key → progression → looped playback), no AI yet; it's the canvas the AI later writes into.
- **AI backend = Opal gateway `/cowrite` route** calling Claude (tailnet-reachable; fine for home practice).
- **Mixer v1 = blend & monitor**: capture the interface via Web Audio, blend guitar vs. backing vs. click. **No in-app plugin hosting** (browsers can't host VST/AU) — Aaron keeps his standalone amp sim and hardware direct-monitoring.
- **Backing tracks v1 = looping strummed guitar**; drums/bass and Suno are later phases.

### Positioning (refined 2026-07-01)

**The wedge = the empty quadrant:** the intermediate guitarist who authors a *performance* (a riff, a progression) and wants it arranged + developed, with the **guitar as the anchor track**. None of the incumbents keep the player's performance central:
- **Suno** — text → finished produced song (black box). For people who *can't play*. No chord/tab/MIDI seed input; replaces the player, drifts from the idea. No official API (only risky 3rd-party wrappers).
- **ACE Studio** — MIDI/hummed melody + lyrics → realistic *vocals*. For players who *need a voice*. Vocal-to-MIDI on-ramp is notable. Instrumental backing is generic; no open API (VST/AU/ARA DAW bridge only).
- **Moises** — existing audio → *stems + chords/key/BPM + one-tap sectional looping + practice*. For practicing to *others'* songs. Closed API (successor: Music.ai).

**Two target workflows** (Aaron's framing):
1. **Description → backing → co-write melody** (`neo-R&B, 85 BPM, Am`) — Suno's on-ramp but kept editable and locked to key/tempo.
2. **Progression-in → backing around it → co-write** (play `C–Am–F–G`) — the underserved case; the user's progression is the spine, AI arranges around it.

### Strategic call — the backing track is the heart, and it should be an *editable arrangement*, not a black box

- **Recommended core:** a **programmatic MIDI arrangement engine** — generate drums/bass/keys from the user's actual progression (sampled/synth instruments), deterministic, editable, **locked to their exact chords**. This is the differentiator none of the three offer.
- **Suno** = optional "bounce a produced full-band demo" escape hatch only (unofficial API = ToS/stability risk; not the core).
- **Stem separation** (Music.ai / LALAL.AI API — *buy, don't build*) only for the YouTube/MP4 inspiration path, and only when that feature lands.

### Borrow list (ranked leverage ÷ cost)

**Now (cheap, high value, we're uniquely positioned):**
- **One-tap, downbeat-snapped sectional looping** (Moises) — *easier for us* because we author the arrangement, so section boundaries are known (no detection). Loop chorus at 70% with click in two taps. Pairs with slow-down-without-pitch-shift + beat-synced metronome/count-in.
- **Section regeneration** (Suno) — re-roll just the chorus / 4-bar turnaround while the rest stays. The core co-writing iteration loop.
- **Chord-over-timeline → playable fretboard shapes + Capo mode** (Moises) — trivial for us; we already render fretboards.
- **Per-stem multitrack mixer** (Suno stems + Moises mute/solo) — extends the planned mixer: Guitar-in / Drums / Bass / Keys, mute/solo/meters.

**Later (the "onto paper" magic, more effort):**
- **Hum/play-a-lick → MIDI transcription** (ACE Vocal-to-MIDI) — literally "get the idea onto paper"; feasible for monophonic guitar lines (pYIN/CREPE or Web Audio autocorrelation) → notes/tab that seed the co-writer.
- **MIDI + lyrics → sung topline** (ACE) — optional vocal demo; ACE has no API, so this would be a separate later integration or a Suno topline.
- **Persona / "my sound" profile + metatag structural steering** (`[verse]`,`[solo]`) — cheap, high-value UX patterns.

### Co-writing experience (design — the product's soul)

**Core principle:** the AI thinks *with* the user, in the open, and every idea arrives as three coupled things at once — **words** (the reasoning), **sound** (auditionable via transport), **shape** (lit on the fretboard). That trinity is the collaboration and the moat vs. Suno's black box. Reasoning is always tied to a chord-tone degree (from `chordTones`), so co-writing *teaches* — the "get better" payload for an intermediate player.

**Default spine (recommended): guided lever-by-lever build** — walk the song's levers in order, bounded options + reasoning at each step. Chosen because it matches Aaron's own framing ("chords, inversions and space to create melody lines"), is buildable now (no pitch-detection needed; works from a typed/played progression on the existing engine), and foregrounds the guitar-native differentiators.
- Lever order: **progression → inversions/top-line → space/phrasing → melody notes → sections/arrangement.**
- **Sculpt-by-ear** is the *feel once a first draft exists* (AI lays a pass, user + AI reshape by nudging notes / opening space / re-rolling a bar).
- **Call-and-response** ("trade fours") is the aspirational real-time layer, unlocked once the hum/lick-in on-ramp (pitch detection) lands.

**Interaction primitives:**
1. **Inversions = the melody lever** (guitar-native, unique). Top note of each voicing = a melody note; choosing inversions across the changes *is* writing the top-line/voice-leading. Show the top-note contour as an editable line; offer named contour options (smooth / rising / held).
2. **Space as a first-class choice** — propose *where the melody breathes* (rests, entrances, ring-vs-fill), not just which notes.
3. **Options by ear, not theory** — always 2–3 concrete, playable directions each with a one-word character ("sparse / hopeful / bluesy"); user decides by listening.
4. **Reason out loud, tied to a degree** — "land on E over Am, that's the 5th, stable and warm."
5. **Motivic callback** — develop the user's own lick (invert / displace / stretch) and hand it back for later sections; what makes a song feel *written*.
6. **Momentum** — when the user stalls, offer the next handhold; when they land something, acknowledge and push forward. Constraints over infinity.

**Who-holds-the-pen modes** (session can flex between): user-leads/AI-reacts · AI-leads/user-curates · true ping-pong. Guided-build is the default; the others are toggles.

**Melodic toolkit (multiple "sonic lenses" — the AI reasons over *which lens, and why here*).** Grounded on `C–Am–F–G` (key C, I‑vi‑IV‑V):
- **Top-note voice-leading** (inversion lever) — melody rides top of voicing; chord tones = strong landings.
- **Parent scale / pentatonic bed** — C major pentatonic (= A minor pentatonic, C‑D‑E‑G‑A); singable, never fights the changes.
- **Chord-tone targeting + bridge notes** — land chord tones on strong beats, connect with passing/chromatic approach tones on weak beats; the bridge notes = the "excitement"/forward lean across bar lines.
- **Guide-tone line (3rds)** — `E(C)→C(Am)→A(F)→B(G)`; a melody skeleton on each chord's emotional center.
- **Modal color per chord** — C Lydian (raise F→**F♯**) sparkles on the I; **F Lydian is *free*** (F‑G‑A‑B‑C‑D‑E = C major, so **B is the ♯11 shimmer on IV with no outside note**); **F♯ = the recurring 'outside' excitement note** (Lydian on C, Dorian color on Am).
- **Blue notes** — ♭3 (E♭) / ♭7 (B♭) for grit.
- **Motif + diatonic sequence** — one cell walked through the changes (feeds motivic callback).
The reasoning ("save F♯ for the C, let F glow on B, answer with the guide-tone line") *is* the teaching + the co-writing.

**The heart — propose → play-back-a-variant loop.** AI pulls a line from its reasoning (plays it + shows on neck); user plays it back **by ear, slightly different**; the app **diffs the variation against the proposal** (flatted 3rd, delayed entrance, added/stretched note) and **reacts to the difference as creative intent** ("you flatted that E — bluesier, want me to re-voice under it?"). Perfect transcription NOT required — a **monophonic pitch + onset tracker** (contour, approx pitch, timing) is enough to hold the musical conversation.
- **Scope implication:** this makes monophonic **pitch-tracking (hum/lick-in) close to CORE, not a late stretch** — the back-and-forth *requires* the app to hear the user's variation. If this loop is the heart, pull pitch-detection earlier in the build.

**New engine pieces this implies** (both extend the existing pitch-class machinery):
1. **Scale/mode engine** — parent scales, pentatonics, **chord-scale map** per progression, color-note logic (F♯ Lydian spice, B free ♯11, blue notes).
2. **Fretboard highlighting by role** — extend `buildNeck` dot coloring to distinguish *target* (chord tones) / *bridge* (passing-approach) / *color* (Lydian ♯4, blues) notes, so the method is *seen*, not only heard.

### Identity, AI voice, style/taste, and inspiration (design)

**Product identity: learning tool AND inspiration tool** (not just a generator). Theory is surfaced as **teaching labels** the AI names as it works ("this is the Lydian ♯11") — expandable/collapsible so it teaches without breaking flow. Confirmed by Aaron. The **propose → play-back-a-variant back-and-forth is the heart.**

**The AI's MIDI voice.** The AI plays its ideas through a **MIDI module / soft-synth in a timbre distinct from the user's guitar** (e.g., Rhodes / synth-vox), so call-and-response is *legible* (you vs. it). Same note events drive **sound + neck-dot animation in lockstep** (hear+see fused). Implications:
- **Two overlaid voices on the board** — AI's proposed line (one color/animation) vs. the user's played-back variant (another), overlaid so the *divergence is visible* → the propose-and-vary loop made tangible.
- **MIDI out (Web MIDI)** — AI line can drive an in-browser soft-synth *or* be sent to the user's DAW / a plugin instrument (ties into the audio-interface/mixer world; AI can play *through his tone*).
- Tech: in-browser sample-based GM/SoundFont player (e.g. smplr / WebAudioFont / Tone.js instruments) for the AI voice; keep the user's guitar on Karplus-Strong.

**How the AI gets taste (condition + reference + learn — NOT fine-tuning early):**
1. **Style as steerable, teachable knobs** — density (busy↔spacious), chromaticism (inside↔outside), feel (straight↔swung↔behind-beat), register, **guitar articulation** (slides/bends/hammer-ons). "Neo-R&B" = spacious + laid-back + outside color + bends. Knobs are visible → serves the learning goal.
2. **Reference phrase bank (retrieval, not training)** — small tagged library of licks/motifs/phrase-shapes by style, pulled as in-context examples so suggestions *sound* like the target. Seedable from Donut Doctor material + Aaron's own licks.
3. **Learn *you* from accept/reject** — every kept/tweaked/tossed idea is a preference signal → a growing **taste profile**. The personalization moat the incumbents structurally lack (they don't watch you choose).
4. **Reference tracks as style target** — YouTube/track analyzed for feel ("live near *this*"); reuses the inspiration-input analysis path.
5. **Fine-tuning later, if ever** — style corpus or Aaron's catalog; distant option, not a dependency.

**Inspiration solicitation (both directions).** AI proactively asks for seeds ("play 30s of something you love", "name 3 artists", "hum the feeling", "drop a vibe link"); each seed does triple duty — style conditioning, motivic seed, reference target. When the user is dry, AI *offers* sparks (e.g. three 2-bar seeds in-key to react to). Defeats the blank page; core to the "inspiration tool" identity.

**Convergent scope signal:** the propose-and-vary loop, "play me something you love," "play back an extension," and "hum the feeling" **all route through the same monophonic pitch/onset listening on-ramp** → it is now load-bearing and belongs near the CORE, not a late phase.

### KEYSTONE — Intent-first session kernel (the true spine)

Every session opens with the bandmate's question — *"what've you got, and where do you wanna take it?"* — and the whole session configures from the answer. Free-form intent → structured **session frame**:
- **HAVE** (any input, or none): progression · riff · melody fragment · lyric · reference track · just a vibe · blank page.
- **WANT** (goal): full song · solo over it · find the topline · reharmonize · add a bridge · "make it a prog-rock anthem" / "neo-soul" …
- **VIBE** (style target): drives the genre/rhythm/feel/articulation knobs.

Interpreting loose human intent into this frame is **LLM-native = low-risk.** The app is **input-agnostic and goal-oriented** — one flexible co-writer pointed by intent, NOT N hardcoded flows. This is the truest expression of "bandmate."

**Reconciles the earlier "spine" debate:** *intent is the top-level spine.* Guided lever-by-lever build, call-and-response, and sculpt-by-ear are **modes the intent router selects/blends** per session (solo-from-riff → call-response + motivic dev; progression→song → guided-build; reshape-melody → sculpt-by-ear). Taste = the whole gestalt: **genre + rhythm + feel + articulation + note choice** (confirmed).

**MVP = intent front door + ONE fully-wired "hero" intent path**, with other intents gracefully acknowledged ("love that — let's explore it") until wired. Hero-path candidates (fork below): progression→co-write-melody · riff→solo · vibe→seed-to-react-to. All three now depend on the monophonic listening on-ramp, which is confirmed **core, not late**.

**Phase re-sequencing needed at finalization:** the original Phase plan (Jam Playground → Mixer → AI → backing) predates intent-first + listening-as-core. Final plan must (a) make the intent front door + session frame the entry point, (b) pull monophonic pitch/onset tracking into the core, (c) treat the melodic toolkit + AI MIDI voice + taste profile as first-class, (d) keep backing-track generation (editable, progression-locked) and stem/YouTube inspiration as later phases.

### Open forks (Aaron was away for the clarifying rounds — revisit before build)
1. **Web vs. native**: chose web-first, native-later. Native (JUCE/AudioKit AU host) is the *only* path if he later wants the app itself to load his amp plugin with plugin inserts. Web can blend/monitor/record but not host plugins.
2. Modes/scales beyond major/minor in v1? Alternate tunings / left-handed?
3. Backing ambition (guitar loop assumed / +drums&bass / Suno).

---

## What already exists and is directly reusable (copy from `~/fretboard-explorer/index.html`)

- **Theory engine** (lines 209–309): `CHORDS`, `ROOTS`, `chordTones(root,typeKey)` (correct enharmonic spelling), `buildVoicings(root,typeKey)` (triads + drop-2 sevenths), `shape(strings,pcs)` (frets, min-span), `setsFor(typeKey)`. Pure, side-effect-free.
- **Audio primitives** (311–342): `playMidi(midi, when, gain)` — **already schedules against `actx.currentTime` via `when`**, the transport hook a sequencer needs. `strum(midis, gain)`. Karplus-Strong, cached buffers.
- **Rendering** (356–418): `buildNeck(activeStrings, dots, maxFret)` (SVG), `computeSets(...)` → per-set `{dots, midis, color}`. `midis` arrays feed playback.
- **Theme**: Dracula/Alucard (CSS vars + parallel JS `THEME` object).

**Gaps to build:** diatonic/key logic, progression/song model, transport clock (tempo/loop/duration), audio-input capture + mixer, and the AI co-writer.

**AI/infra available** (`/Users/oh2kool4u/opal`):
- Gateway `gateway/` — Node/TS (ESM, `tsx`), Claude Agent SDK auth via `~/.hermes/.env`, tailnet HTTP-server-with-bearer-token pattern in `gateway/src/captureServer.ts` (:3737) to mirror; model aliases in `gateway/src/models.ts`.
- Local LLM Ornith `cortex:8000` (OpenAI-compatible) — text-only fallback.
- YouTube: TranscriptAPI MCP (`get_youtube_video_info`, `get_youtube_transcript`) — text/captions only.
- Songwriting knowledge: `state/omlx-hermes-home/skills/creative/songwriting-and-ai-music/SKILL.md` (structure, Suno prompt formula).
- Music-gen (later): AudioCraft/MusicGen guide (not deployed); Suno (external).

---

## Phase 0 — New repo + engine copy (small)

Create `~/guitar-cowriter` (public, MIT, commit email `aaron@modernhorizons.com` per convention). Files: `index.html`, `engine.js` (copied theory+audio), `transport.js`, `mixer.js`, `README.md`, `LICENSE`, `.gitignore`. Port Dracula/Alucard theme verbatim. Fretboard Explorer is **not modified**.

## Phase 1 — Jam Playground (client-side, deployable to GitHub Pages)

1. **Diatonic key model** (`engine.js`): from key + mode (major/minor first), derive the 7 diatonic chords (with 7th variants) → roman-numeral → `{root, typeKey}` feeding existing `buildVoicings`/`computeSets`.
2. **Progression model**: ordered slots `[{root, typeKey, bars, voicingSetIdx, invIdx}]`; persist to `localStorage` + shareable URL hash.
3. **Builder UI**: pick key → diatonic palette → click/drag chords onto a bar timeline; each renders its voicing via `buildNeck`/`computeSets`.
4. **Transport/sequencer** (`transport.js`): lookahead scheduler over `actx.currentTime` (25 ms tick, ~100 ms schedule-ahead — standard Web Audio pattern). Tempo (BPM), loop, count-in, per-slot chord trigger via `strum(midis)`. No change needed to audio primitives (`when` already supports absolute scheduling). Highlight the active chord during playback.

Deliverable: pick a key, build I–V–vi–IV, loop with tempo, jam over it.

## Phase 2 — Audio I/O + Mixer (the interface-blend feature)

1. **Input capture** (`mixer.js`): `getUserMedia({audio:{echoCancellation:false, autoGainControl:false, noiseSuppression:false}})` on the chosen audio-interface device → `MediaStreamAudioSourceNode`. Enumerate devices (`enumerateDevices`) so Aaron picks his interface. Assume he still monitors his guitar via the interface's **hardware direct monitoring** (zero-latency), so app latency only affects the backing track.
2. **Mixer graph**: per-channel `GainNode`s — **Guitar in**, **Backing**, **Click** — summed to a master gain → destination. UI = 3–4 vertical faders + mute/solo + master; simple meters (`AnalyserNode` RMS). This is the "small mixer to blend in the plugin" without hosting the plugin.
3. **Record/bounce** (optional in this phase): `MediaRecorder` on the master (or a sub-mix) to capture a jam take as WebM/WAV for review or as a lick to feed the co-writer.
4. **Native-later note**: true plugin *hosting* (load his amp AU/VST as an insert) is out of scope for web; documented as the trigger to build a native Mac app (JUCE/AudioKit AU host) if the standalone-amp workflow proves limiting.

## Phase 3 — AI Co-Writer (adds gateway backend)

1. **Gateway `/cowrite` route** (`gateway/src/cowrite.ts`, mirror `captureServer.ts`: `0.0.0.0`, bearer token). Accepts `{key, progression, vibe, inspiration}`; calls Claude (Agent SDK, model from `models.ts`) with a theory system prompt seeded from the songwriting SKILL. Returns structured JSON.
2. **Structured contract**: melody as per-bar note events (scale degree or string/fret + octave), harmony ideas, 2–3 next-chord suggestions with rationale. JSON-constrained so the app renders + plays it.
3. **Render + play**: melody events → `buildNeck` dots + sequenced `playMidi` over the loop. Accept / regenerate / tweak-vibe controls.
4. **Inspiration inputs**: YouTube link → TranscriptAPI title/description/transcript as text context. Lick/phrase → MVP is manual entry (click notes on the fretboard) passed as a motif; recorded-lick transcription (Phase 2 `MediaRecorder` + Whisper/pitch-detection) is a stretch.
5. **Local-LLM fallback**: same route can target `cortex:8000` (lower musical quality — flag in UI).

## Phase 4 — Backing tracks & richer inspiration (later)

- v1 backing = looping strummed guitar (Phase 1). Add optional client-side programmed drums + root-note bassline synced to transport. External full-band via **Suno** (songwriting SKILL prompt formula) behind an explicit action. Stretch: audio-in lick transcription.

---

## Critical files

- **New:** `~/guitar-cowriter/{index.html, engine.js, transport.js, mixer.js, README.md, LICENSE}`
- **Copy from (unchanged):** `~/fretboard-explorer/index.html` — `chordTones` (250), `buildVoicings` (289), `shape` (266), `computeSets` (400), `buildNeck` (364), `playMidi` (332), `strum` (340), `THEME` (345).
- **Phase 3 backend:** `gateway/src/cowrite.ts` (new, mirrors `gateway/src/captureServer.ts`), wired in `gateway/src/index.ts`; secrets `~/.hermes/.env`; models `gateway/src/models.ts`.
- **Prompt seed:** `state/omlx-hermes-home/skills/creative/songwriting-and-ai-music/SKILL.md`.

## Verification

- **Phase 1:** Open `index.html`. (a) C major → diatonic palette shows C, Dm, Em, F, G, Am, Bdim with correct voicings (spot-check vs. Fretboard Explorer for the same chords). (b) Build I–V–vi–IV at 90 BPM, loop → chords trigger on beat, seamless loop, active chord highlights. (c) Reload → restored from localStorage; share hash reproduces it.
- **Phase 2:** Select the audio interface → confirm input meter responds to playing; move Guitar/Backing/Click faders → confirm independent level control; play backing while playing guitar (hardware-monitored) → confirm blend sounds balanced; record a take → confirm the file plays back. Verify capture uses `echoCancellation:false` etc. (no processing on the guitar signal).
- **Phase 3:** `curl` the `/cowrite` route with a sample progression + bearer token → valid structured JSON. In-app: request a melody over a looping progression → notes render on the fretboard and play in time; regenerate yields a different, in-key result. YouTube link → its metadata reaches the prompt (log the context).
- **Musical correctness:** every AI/derived note's pitch class is in-key (or a labeled chromatic passing tone) — validate a sample against `chordTones`.
- Confirm cortex IP before wiring the local-LLM fallback (`local-llm-cortex.md` says `100.64.65.28`; `TOOLS.md` says `100.88.233.104`).

---

# ★★ PIVOT (2026-07-01 late): Native Mac app — approved by Aaron

Web MVP proved the BRAIN (intent → theory-grounded co-writing → taste). The web BODY hit its documented wall: no AU/VST hosting, device-permission friction, synth-sketch sounds ("hard to write with monophonic midi notes and dry guitar tones" — Aaron). Aaron chose: **Native Swift Mac app** + sound = **hosted AU instrument plugins** (editable, chord-locked) + **generative backing (Suno/MusicGen)** as the produced layer.

**Architecture:**
- `mac/` in the same repo — Swift Package (SPM; NO Xcode installed — CLT-only build + `make-app.sh` assembles .app with NSMicrophoneUsageDescription + ad-hoc codesign).
- **CoWriterKit** (Swift): ported theory/progression/noteEvents (pure math, guarded by ported tests) — Swift owns UI+audio; Node keeps owning AI turns.
- **Audio**: AVAudioEngine — input device selection via kAudioOutputUnitProperty_CurrentDevice (AudioBox direct), AU discovery via AVAudioUnitComponentManager, instrument AUs play the AI's lines via MIDI events, effect AUs (amp sim) as inserts; lookahead transport (proven design from web); vDSP pitch tracker on input tap; AVAudioFile recording.
- **Brain bridge**: local Node `/cowrite` server (existing server.mjs, subscription OAuth) spawned/connected by the app; VPS relay as fallback URL. Codable mirrors of schemas.ts.
- **Generative backing**: adapter interface; MusicGen-on-cortex (audiocraft) or Suno-wrapper later; bounce-style, not note-editable.
- Web app stays as-is (demo + phone use); no further web investment.

# ★ FINAL BUILD PLAN — Full Bandmate (overnight aggressive build)

**Goal:** a runnable web app delivering the full co-writing *bandmate* experience end-to-end, built now → ~11:00 tomorrow. Sequenced so the **magic moment lands first** and the app is genuinely usable even if later stretch features land only partially. Runnable at every checkpoint (no big-bang).

**The magic moment (must work first):** user states intent (e.g. `C–Am–F–G`, "make it a prog-rock anthem") → co-writer proposes a melody in **its own MIDI voice** with the **reasoning + method label shown on the neck** (role-colored dots) → user **plays back a variant** → app **hears it, diffs it, and reacts to the specific change.**

## Repo & stack
- **New repo `~/guitar-cowriter`** (public, MIT, commit email `aaron@modernhorizons.com`). **Fretboard Explorer stays untouched** — copy/port its engine.
- **Stack:** Vite + React + TypeScript. **Web Audio** throughout; **Tone.js** (transport/instruments/click); a **SoundFont player** (`smplr` or WebAudioFont) for the AI's distinct MIDI voice; user-guitar timbre = ported **Karplus-Strong**; **monophonic pitch/onset detection** (`pitchy` + `pitchfinder`) for listening; **Anthropic TypeScript SDK** for the co-writer; **Zustand** for state. Deploy to **GitHub Pages**.
- **AI access (self-contained + testable tonight):** pluggable AI layer, default **BYO-key in browser** — Anthropic key in `localStorage`, SDK with `dangerouslyAllowBrowser: true` + `anthropic-dangerous-direct-browser-access` (personal single-user tool; key stays local, documented caveat). Adapter interface leaves a **gateway `/cowrite` route** as the proper server path for later. Model selectable (Sonnet/Opus for codegen reliability; **Fable-5** available for cost).

## Module architecture
- `src/engine/` — `theory.ts` (ported `CHORDS/ROOTS/chordTones/buildVoicings/shape/spell` + NEW scales/modes, pentatonics, diatonic-chords-for-key, chord-scale map, color-note logic), `melody.ts` (the toolkit: top-note voice-leading, pentatonic bed, chord-tone-target+bridge notes, guide-tone line, modal-color, blue notes, motif transforms invert/sequence/augment → note-event sequences), `progression.ts` (song/section model + serialize), `noteEvents.ts` (`{midi,startBeat,durBeat,role:target|bridge|color,string?,fret?}`).
- `src/audio/` — `context.ts`, `guitar.ts` (Karplus-Strong), `midiVoice.ts` (SoundFont AI voice + optional Web MIDI out), `transport.ts` (lookahead scheduler, tempo, loop, sections, count-in, click), `mixer.ts` (`getUserMedia` capture with `echoCancellation/agc/noiseSuppression:false`, per-channel gains Guitar-in/AI/Backing/Click, meters via `AnalyserNode`, mute/solo, `MediaRecorder`), `backing.ts` (programmatic MIDI arrangement — drums/bass/keys, editable, progression-locked).
- `src/listen/` — `pitchTrack.ts` (mono pitch+onset → note events), `diff.ts` (variant vs. proposal → intent signals: flatted-3rd, delayed-entrance, added/stretched note).
- `src/ai/` — `client.ts` (SDK wrapper, BYO-key + gateway adapter), `intent.ts` (free-form → session frame HAVE/WANT/VIBE), `cowriter.ts` (prompt from frame+progression+taste+phrase-bank → **structured JSON**: melody note events + reasoning + method label + 2–3 options), `taste.ts` (style knobs + accept/reject learning, persisted), `phraseBank.ts` (tagged lick/motif library for retrieval/few-shot), `schemas.ts` (JSON schemas for structured output).
- `src/ui/` — `SessionOpener`, `Chat` (reasoning, options-by-ear, expandable teaching labels), `Fretboard` (ported neck, role-colored dots, playback animation, **two overlaid voices** AI vs. user-variant), `Timeline` (chords/sections, per-chord voicing/inversion, **one-tap section loops**), `Transport`, `Mixer`, `StyleKnobs`, `MelodyLenses`, `App`.
- `src/state/` — Zustand store (session frame, progression, current proposal, user variant, taste profile, transport).

## Build sequence (core loop ASAP, then layer)
1. **Foundation:** scaffold Vite/React/TS + deps; port+extend `engine/`; `audio/` transport+guitar+midiVoice; `ai/` client+intent+cowriter+schemas.
2. **Core UI:** Fretboard + Timeline + Chat + Transport wired to engine/audio.
3. **★ Core-loop integration:** intent → propose (note events+reasoning+method+options) → render role-colored dots + play in AI voice (dot-synced) → user variant → pitch-track + diff → AI reacts. **Make this work first.**
4. **Listening + mixer + taste:** full pitch-tracking; input capture + mixer/record; taste-profile learning from accept/reject.
5. **Expression:** melodic-lenses UI + style knobs; sectional looping; motivic callback; wire multiple intent paths (progression→song, riff→solo, vibe→seed).
6. **Backing + inspiration:** editable progression-locked arrangement (drums/bass/keys); YouTube/reference inspiration via TranscriptAPI; stem-separation stub (Music.ai/LALAL.AI adapter, not wired).
7. **Polish:** Dracula/Alucard theme, persistence, README, GitHub Pages deploy.

**Scope honesty:** Steps 1–4 = the "done and usable" target (core bandmate loop + listening + mixer + taste). Steps 5–6 layer as time/tokens allow; step 6 may land partially. App stays runnable at every checkpoint.

## Execution approach
Drive with **parallel background subagents per workstream** (Engine / Audio / Listening / AI / UI), integrating continuously; verify the running app via `/run` and `/verify` at each checkpoint; leave a status summary at each milestone. Aggressive overnight pace given the token budget.

## Verification (end-to-end)
- **Engine unit tests:** C-major diatonic = C, Dm, Em, F, G, Am, B°; C Lydian = C D E F♯ G A B; F-Lydian notes ⊂ C major; C pentatonic = C D E G A; voicings match Fretboard Explorer for shared chords.
- **★ Core loop (drive the app):** enter "C–Am–F–G, make it a prog-rock anthem" → AI returns melody + reasoning + method label; dots render role-colored; playback in the AI voice is audible and dot-synced; play a variant into the mic → the specific change is detected and the AI reacts to it.
- **Mixer:** select interface, meters respond, faders/mute/solo work, record + play back a take; confirm no input processing (`echoCancellation:false`).
- **Persistence/deploy:** taste profile + session survive reload; GitHub Pages build serves.

## Resolved for this build
web app (BYO-key now, gateway `/cowrite` later) · full scale/mode engine · **listening = core** · intent-first front door with multiple paths · backing = editable/progression-locked (Suno later) · Fretboard Explorer untouched.
