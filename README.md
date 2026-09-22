# Illuminate Philly — Live Transcription Kaleidoscope

A standalone, offline, browser-based installation display for Illuminate
Philly. Live speech is transcribed in real time, each finalized phrase is
rendered in a blackletter typeface, run through an 8-way radial-mirror
(kaleidoscope) shader, and fed into a WebGL feedback loop that gives the
text a receding, fractal-like depth — spiraling into itself rather than
just sitting as a mirrored still.

No backend, genuinely zero network dependency once loaded — it's designed
to run unattended on one machine for the length of a show. (A field test
found two undocumented internet dependencies that used to hide behind that
claim: the blackletter font was loaded from Google Fonts, and — bigger —
Chrome's speech recognition is actually cloud-backed. Both are fixed: the
font is now self-hosted, and speech recognition prefers a local, fully
on-device helper — see below.)

## How it works

- **Speech capture** ([src/speech.js](src/speech.js)) — tries
  [native/SpeechBridge](native/SpeechBridge) first (a local macOS app doing
  continuous on-device recognition, streamed in over Server-Sent Events),
  and only falls back to the browser's own `webkitSpeechRecognition` if
  that helper isn't running. The browser path is Chrome-only *and* actually
  sends audio to Google's servers to transcribe it — despite living in the
  browser, it needs internet. Either way, both auto-restart on end/error so
  a show survives hours unattended.
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

**For offline speech recognition** (recommended for any show without
reliable internet — see "How it works" above), also build and launch the
native helper once beforehand:

```bash
cd native/SpeechBridge
./build.sh
open SpeechBridge.app
```

Launch it with `open` (or double-click it in Finder) — not by running the
binary inside `Contents/MacOS/` directly, which macOS's permission system
won't correctly attribute the Microphone/Speech Recognition prompts to. The
first run asks for both; grant them. It logs to `/tmp/speechbridge.log`
since `open` detaches it from any terminal you launched it from. Leave it
running in the background — the web app finds it automatically on
`http://127.0.0.1:8765/` and falls back to the browser's own recognizer
(needs internet) if it's ever not running.

**Proximity noise gate.** If the mic sits close against the speaker (e.g. a
lav/wireless capsule tucked inside a prop, phone receiver, etc.), SpeechBridge
gates out quieter audio rather than transcribing everyone within earshot —
buffers below a level threshold are never sent to the recognizer, so
bystander/ambient speech is treated as silence. Tune it live from the style
panel (`p`) under **Proximity gate**: the **Level** readout shows what
SpeechBridge is measuring right now (green while the gate is open). Speak
normally right at the mic, then from a few feet away, and set **Gate open**
a bit under the close-speech level and **Gate close** a bit above the
far-speech level. Settings persist with the rest of the style panel and are
re-sent to SpeechBridge whenever it (re)connects. This only applies to the
SpeechBridge path — the Chrome fallback recognizer captures its own mic
audio internally and can't be gated (the readout stays "not connected").

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

- Chrome on macOS (Darwin), desktop. Chrome is required for the browser
  fallback recognizer — Web Speech API continuous recognition is
  unreliable-to-absent in Firefox and Safari. SpeechBridge itself doesn't
  care which browser is showing the page, since its mic access happens
  outside the browser entirely.
- The kaleidoscope/feedback shader pipeline was verified rendering
  correctly (radial mirror + fractal feedback depth, live parameter
  remapping) using the built-in Vite dev server.
- SpeechBridge was verified end-to-end on real hardware: built, launched,
  granted permissions, and confirmed transcribing live speech on-device,
  streaming it into the running app over SSE, and rendering it through the
  full pipeline in the self-hosted blackletter font — all with no network
  request beyond `localhost`.

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
