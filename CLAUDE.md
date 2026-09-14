# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A standalone, offline, browser-based installation display for "Illuminate Philly." Live speech is transcribed via the Web Speech API, each finalized phrase is rendered in a blackletter typeface, run through an 8-way radial-mirror (kaleidoscope) shader, and fed into a WebGL feedback loop that gives the text a receding, fractal-like depth. It's designed to run unattended on one machine for the length of a live show — no backend, no network dependency once loaded (aside from the Google Font on first load).

## Commands

```bash
npm install       # only external dependency is Vite, for local dev/build
npm run dev        # dev server with HMR, for iteration
npm run build       # static output to dist/
npm run preview      # serve the built dist/ — use this (not `dev`) for an actual show run
```

There is no test suite, linter, or type checker in this project. Verification is done by running the app in a real Chrome window (Web Speech API requires it) or by driving `window.__illuminate.setPhrase(...)` from devtools to exercise the shader pipeline without a live mic (see below).

No-Node fallback for show day: `npm run build`, then serve `dist/` with any static file server, e.g. `cd dist && python3 -m http.server 8080`.

## Architecture

The pipeline is speech → offscreen text canvas → WebGL kaleidoscope pass → WebGL feedback pass → screen, with each finalized phrase remapping shader parameters. Reading `src/main.js` end to end is the fastest way to understand how the pieces connect.

- **`src/speech.js`** — Web Speech API wrapper. Chrome stops the recognizer periodically even in `continuous` mode; this auto-restarts it on `onend` so a show survives hours unattended. `no-speech` errors are swallowed (they fire constantly in quiet rooms and are followed by a normal restart); other errors surface via the `onError` callback.
- **`src/textLayer.js`** — owns an offscreen 2D `<canvas>` that renders the current phrase (auto-fit font size, word-wrap, fade in/out state machine). This canvas is the texture source for the GL renderer — it has no knowledge of WebGL itself.
- **`src/renderer.js`** — the WebGL1 pipeline, three passes per frame:
  1. **Kaleidoscope pass**: polar-coordinate radial mirror shader folds the text texture's angle into N wedges and mirrors each one. Math mirrors the TouchDesigner GLSL TOP reference in `illuminate_philly_kaleidoscope_network.md`.
  2. **Feedback pass**: ping-pong framebuffers (`feedbackFront`/`feedbackBack`, swapped each frame). Each frame reads the previous feedback buffer, applies scale-down + rotate + decay, and screen-blends this frame's kaleidoscope output over it. The receding/spiraling depth falls out of the loop compounding on itself frame over frame — there's no manual accumulation logic to find.
  3. **Copy pass**: blits the feedback buffer to the visible canvas.
- **`src/main.js`** — orchestration and the *creative tuning surface*. `mapPhraseToTargets()` and the `RANGES`/`BASE` constants at the top of the file are what an artist would edit to change how the piece reacts (word count → wedge count, phrase length → mirror spin speed, word count → feedback decay). Targets are smoothed toward continuously (`SMOOTH_MS`) rather than snapped, so the piece keeps drifting between phrases. Also handles resize (DPR capped at 1.5 for feedback-loop performance), WebGL context-loss recovery (auto-reloads the page — a reliability requirement for unattended runs), and exposes `window.__illuminate.setPhrase(text)` for testing/rehearsal without a mic.

When changing shader behavior, `renderer.js`'s uniform names must stay in sync with what `main.js` passes into `render(params)` — there's no schema/type checking connecting them.

## Reference doc

`illuminate_philly_kaleidoscope_network.md` describes an equivalent signal chain built in TouchDesigner (for the projection-mapping environment side of this project, not this repo). Useful for cross-checking the shader math, but it's not part of the running app.
