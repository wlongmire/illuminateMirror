# Illuminate Philly — Live-Transcription Kaleidoscope Network (TouchDesigner)

The look in your reference images is an 8-way radial mirror (kaleidoscope) of rendered text, likely pushed through a video-feedback loop to get that receding, fractal-like depth. Here's a signal chain that reproduces it and reacts to live transcription.

## 1. Live transcription in

Whatever's doing the speech-to-text (Web Speech API relay, Whisper streaming, a captioning service) should push each new phrase into TD over **OSC** (`oscin1` DAT) or **WebSocket** (`websocket1` DAT) as a simple JSON payload, e.g. `{"text": "drill dust rides concrete"}`.

- A `Script DAT` or `DAT Execute` callback on that input writes the latest phrase into a `Text DAT` (`current_phrase`) and appends it to a rolling `Table DAT` (`phrase_history`) so you can look back at recent lines if you want them to linger or recombine.
- The same callback can pulse a `CHOP Execute`/`Pulse CHOP` on every new phrase — that pulse is what you'll use to nudge the kaleidoscope and feedback parameters so the piece visibly reacts each time new words land, not just continuously drifts.

## 2. Render the text

`Text TOP` — pull the string via expression: `op('current_phrase')[0,0]`. Load your blackletter/gothic font on the Font page, white text, transparent or black background, word-wrap off to keep it tight like your reference. If you want depth/extrusion instead of flat type, swap in a `Text SOP` + `Render TOP`, but the flat `Text TOP` is the simpler match for that poster-flat look.

## 3. Kaleidoscope mirror — GLSL TOP

This is the piece that isn't a stock TD operator. A `GLSL TOP` with a polar-coordinate mirror does it cleanly and is resolution-independent:

```glsl
// Kaleidoscope Mirror — GLSL TOP pixel shader
// Input 0: the rendered text TOP

uniform float uSegments;   // number of mirrored wedges, e.g. 8.0
uniform float uRotate;     // extra rotation offset, radians
uniform float uZoom;       // radial zoom, 1.0 = neutral

out vec4 fragColor;

void main()
{
    vec2 res = uTDOutputInfo.res.zw;
    vec2 uv = (vUV.st - 0.5) * res / min(res.x, res.y);

    // cartesian -> polar
    float r = length(uv) / uZoom;
    float a = atan(uv.y, uv.x) + uRotate;

    // fold angle into one wedge, then mirror it (triangle wave)
    float segAngle = 6.28318530718 / uSegments;
    a = mod(a, segAngle);
    a = abs(a - segAngle * 0.5);

    // polar -> cartesian, back into 0-1 UV space
    vec2 kUV = vec2(cos(a), sin(a)) * r + 0.5;

    fragColor = TDOutputSwizzle(texture(sTD2DInputs[0], kUV));
}
```

Expose `uSegments`, `uRotate`, `uZoom` as custom parameters on the GLSL TOP. Tie `uSegments` or `uRotate` to your phrase-pulse (word length, syllable count, a keyword hit — whatever signal you want driving it) via a `CHOP to`/`Parameter CHOP` reference so each new line of transcription visibly reshapes the pattern rather than just retriggering the same look.

## 4. Feedback loop for the fractal/recursive depth

Wire a `Feedback TOP` around the kaleidoscope output:

- `Composite TOP` (Over) combines the current kaleidoscope frame with the previous feedback frame.
- Feed that into a `Feedback TOP`.
- Inside the loop, route the feedback output through a `Transform TOP` (scale ~0.95–0.98, rotate a couple degrees per frame) and a `Level TOP` (opacity/brightness ~0.9, so it decays instead of blowing out) before it re-enters the Composite.

That slight scale-down + rotate each frame is what produces the receding spiral/Droste-style depth — it's the classic video-feedback fractal trick, and layered under the 8-way mirror it reads as recursive rather than just a mirrored still.

## 5. Output

Final `Level`/`Composite TOP` → your `Window COMP` at the projector's native resolution.

---

**Signal chain, top to bottom:**
`live transcription → Text DAT → Text TOP → GLSL kaleidoscope TOP → Composite(Over) ⇄ Feedback TOP(Transform+Level) → Window COMP`

Want me to also draft the DAT Execute / Script DAT Python callbacks that parse the incoming transcription JSON and drive the pulse, or a build script you can paste into TD's textport to lay out these operators automatically? I'd want to know your TD build version before writing the auto-build script, since the `.create()` API has shifted slightly across versions.
