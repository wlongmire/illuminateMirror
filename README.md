# Illuminate Philly — Live Transcription Kaleidoscope

A standalone, offline, browser-based installation display for Illuminate
Philly. Live speech is transcribed in real time, each finalized phrase is
rendered in a blackletter typeface, run through an 8-way radial-mirror
(kaleidoscope) shader, and fed into a WebGL feedback loop that gives the
text a receding, fractal-like depth — spiraling into itself rather than
just sitting as a mirrored still.

No backend, no network dependency once loaded (aside from the Google Font
on first load) — it's designed to run unattended on one machine for the
length of a show.

## How it works

- **Speech capture** ([src/speech.js](src/speech.js)) — Web Speech API,
  continuous mode, auto-restarts the recognizer whenever the browser stops
  it (which Chrome does periodically even in continuous mode), so it
  survives long unattended runs.
- **Text layer** ([src/textLayer.js](src/textLayer.js)) — draws the current
  phrase to an offscreen 2D canvas (auto-sized, word-wrapped, fade
  in/out), which is used as a texture input for the shader pipeline below.
- **Renderer** ([src/renderer.js](src/renderer.js)) — WebGL1 pipeline:
  1. **Kaleidoscope pass** — polar-coordinate radial mirror, folds the
     text texture's angle into N wedges and mirrors each one.
  2. **Feedback pass** — ping-pong framebuffers. Each frame reads the
     previous feedback buffer, applies a slight scale-down + rotation +
     decay, and screen-blends this frame's kaleidoscope over it. Because
     that transform compounds every frame on output that already contains
     every prior frame, the receding/spiraling depth falls out of the loop
     itself — no manual accumulation needed. Decay keeps it from ever
     blowing out to white.
  3. **Copy pass** — blits the result to the visible canvas.
- **Live reactivity** ([src/main.js](src/main.js)) — each finalized phrase
  remaps wedge count (word count), mirror spin speed (phrase length), and
  feedback decay (word count) as smoothed *targets*; the render loop glides
  toward them continuously rather than snapping, so the piece keeps
  drifting between phrases instead of sitting static. See the `RANGES` /
  `BASE` constants and `mapPhraseToTargets()` at the top of `main.js` to
  retune.

The signal chain mirrors the TouchDesigner network sketched in
[illuminate_philly_kaleidoscope_network.md](illuminate_philly_kaleidoscope_network.md)
— same polar-mirror math, same feedback-loop structure — reimplemented
directly in WebGL so the whole piece runs as one dependency-light browser app.

## Running it locally

Requires [Node.js](https://nodejs.org/) (for the dev server only — the app
itself has zero runtime dependencies).

```bash
npm install
npm run dev
```

Open the printed `localhost` URL in **Chrome**, click "Click to start
listening," and allow microphone access.

### Running the show (unattended)

For an actual installation run, build first and serve the static output
rather than running the Vite dev server (`vite dev` keeps a websocket open
for hot-reload, which is unnecessary risk surface for something that has to
run untouched for hours):

```bash
npm run build
npm run preview
```

Then open the printed URL fullscreen (`Cmd+Ctrl+F` in Chrome on macOS) and
click to start.

**Fallback with no Node at all:** `npm run build` produces a plain
static `dist/` folder. If Node/Vite becomes unavailable on show day, any
static file server works, e.g. `cd dist && python3 -m http.server 8080`.

### Manual phrase injection (tech rehearsal / tuning)

You don't need to speak to test the visuals. In the browser console:

```js
__illuminate.setPhrase("drill dust rides concrete")
```

Press **`d`** to toggle an on-screen readout of the current live-tuned
shader parameters (wedge count, rotation speed, decay).

## Tested with

- Chrome on macOS (Darwin), desktop. Chrome is required — Web Speech API
  continuous recognition is unreliable-to-absent in Firefox and Safari.
- The kaleidoscope/feedback shader pipeline itself was verified rendering
  correctly (radial mirror + fractal feedback depth, live parameter
  remapping from injected phrases) using the built-in Vite dev server.
  Verify the microphone capture path yourself in an actual Chrome window —
  a sandboxed preview browser can't grant mic access, so that leg wasn't
  exercised end-to-end here.

## Projection-mapping / video-source integration

Open question, not yet decided: this needs to feed a projection-mapping
environment (TouchDesigner or similar) as a video source, not just be
looked at as a fullscreen browser window.

- **Simplest — window/screen capture.** Point the mapping software's
  native screen/window capture at the fullscreen Chrome window. Zero extra
  code, every mapping tool supports it, and it's what this app currently
  assumes. Downside: an extra composite/capture hop (color space, capture
  latency, a stray window chrome/cursor if not careful), and the capture
  source is coupled to a specific window still existing on screen.
- **Cleaner — NDI/Spout/Syphon output.** Push frames out as a named video
  source instead of screen-grabbing. Removes the capture hop and lets
  TouchDesigner pick the stream up as a first-class input. Cost: real
  added complexity for a browser-based piece — none of NDI/Spout/Syphon
  are natively reachable from a web page's WebGL canvas. You'd need
  either (a) an Electron/Node wrapper around this app that reads the
  canvas via `captureStream()`/`readPixels` and pushes it out over an NDI
  or Spout SDK, or (b) a small separate relay process doing that capture
  from the browser window. Either way it's a second moving part that can
  fail independently of the browser tab on show night.

Recommendation: start with window capture — it's what's wired up now, it's
one fewer thing to break unattended, and the visual difference vs. NDI/Spout
in a single-machine setup is usually not worth the added failure surface.
Revisit NDI/Spout only if the capture hop turns out to cost real latency,
frame drops, or color fidelity once you test it against your specific
mapping software.
