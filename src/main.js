import { createSpeechRecognizer } from './speech.js';
import { TextLayer } from './textLayer.js';
import { Renderer } from './renderer.js';

// ---- Tunable ranges -------------------------------------------------------
// Each finalized phrase nudges these targets; the render loop smoothly
// glides toward them rather than snapping, so the piece keeps drifting
// even between phrases instead of sitting static.
const RANGES = {
  segments: { min: 4, max: 16 },           // kaleidoscope wedge count
  kaleidoRotateSpeed: { min: 0.03, max: 0.5 }, // rad/sec, mirror's own spin
  decay: { min: 0.90, max: 0.975 },        // feedback persistence per frame
};

const BASE = {
  zoom: 1.0,
  feedbackScale: 0.965,   // slight scale-down each feedback pass
  feedbackRotateSpeed: 0.18, // rad/sec, rotation compounding inside the loop
};

const SMOOTH_MS = 900; // time constant for gliding toward new targets

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function lerpRange(v, inLo, inHi, outLo, outHi) {
  const t = clamp((v - inLo) / (inHi - inLo), 0, 1);
  return outLo + t * (outHi - outLo);
}

function mapPhraseToTargets(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const charCount = text.length;

  return {
    // more words -> more mirrored wedges
    segments: clamp(4 + Math.round(wordCount / 1.5) * 2, RANGES.segments.min, RANGES.segments.max),
    // longer phrases spin the mirror slower/calmer; short bursts spin faster
    kaleidoRotateSpeed: lerpRange(charCount, 10, 120, RANGES.kaleidoRotateSpeed.max, RANGES.kaleidoRotateSpeed.min),
    // more words -> longer-lingering trails
    decay: clamp(0.90 + wordCount * 0.006, RANGES.decay.min, RANGES.decay.max),
  };
}

// ---- DOM --------------------------------------------------------------
const glCanvas = document.getElementById('gl');
const dotEl = document.getElementById('dot');
const statusText = document.getElementById('statusText');
const startOverlay = document.getElementById('start');
const startBtn = document.getElementById('startBtn');
const errorEl = document.getElementById('error');
const debugEl = document.getElementById('debug');

function showError(msg) {
  errorEl.hidden = false;
  errorEl.textContent = msg;
}

function setLive(isLive) {
  dotEl.classList.toggle('live', isLive);
  statusText.textContent = isLive ? 'listening' : 'idle';
}

// ---- Render/param state -------------------------------------------------
const textLayer = new TextLayer({ fontFamily: "'UnifrakturCook', serif" });
document.fonts.load("700 64px 'UnifrakturCook'").catch(() => {});

let renderer;
try {
  renderer = new Renderer(glCanvas, textLayer.canvas);
} catch (e) {
  showError(e.message);
}

const state = {
  segments: 6,
  kaleidoRotateSpeed: 0.15,
  decay: 0.93,
};
const targets = mapPhraseToTargets('illuminate philly');
let kaleidoRotatePhase = 0;

function smooth(current, target, dtMs) {
  const t = 1 - Math.exp(-dtMs / SMOOTH_MS);
  return current + (target - current) * t;
}

function updateParams(dtMs) {
  state.segments = smooth(state.segments, targets.segments, dtMs);
  state.kaleidoRotateSpeed = smooth(state.kaleidoRotateSpeed, targets.kaleidoRotateSpeed, dtMs);
  state.decay = smooth(state.decay, targets.decay, dtMs);

  kaleidoRotatePhase += state.kaleidoRotateSpeed * (dtMs / 1000);
  kaleidoRotatePhase %= Math.PI * 2;

  const feedbackRotate = BASE.feedbackRotateSpeed * (dtMs / 1000);

  return {
    segments: state.segments,
    rotate: kaleidoRotatePhase,
    zoom: BASE.zoom,
    decay: state.decay,
    feedbackScale: BASE.feedbackScale,
    feedbackRotate,
  };
}

// ---- Resize -------------------------------------------------------------
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.round(window.innerWidth * dpr);
  const h = Math.round(window.innerHeight * dpr);
  glCanvas.style.width = window.innerWidth + 'px';
  glCanvas.style.height = window.innerHeight + 'px';
  textLayer.resize(w, h);
  if (renderer) renderer.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

// ---- Render loop ----------------------------------------------------------
let lastT = performance.now();
let debugOn = false;

function frame(t) {
  const dtMs = Math.min(100, t - lastT); // clamp to avoid huge jumps on tab-back
  lastT = t;

  textLayer.update(dtMs);
  const renderParams = updateParams(dtMs);
  if (renderer) {
    try {
      renderer.render(renderParams);
    } catch (e) {
      showError('Render error: ' + e.message);
    }
  }

  if (debugOn) {
    debugEl.textContent =
      `segments ${state.segments.toFixed(1)}  ` +
      `rotSpeed ${state.kaleidoRotateSpeed.toFixed(3)}  ` +
      `decay ${state.decay.toFixed(3)}  ` +
      `fbScale ${BASE.feedbackScale}  fbRotSpeed ${BASE.feedbackRotateSpeed}`;
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('keydown', (e) => {
  if (e.key === 'd') {
    debugOn = !debugOn;
    debugEl.hidden = !debugOn;
  }
});

// ---- WebGL context loss: unattended runs should recover, not hang -------
glCanvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  showError('Graphics context lost — reloading…');
  setTimeout(() => window.location.reload(), 1500);
});

// ---- Speech input -----------------------------------------------------
function onPhrase(text) {
  textLayer.setPhrase(text);
  Object.assign(targets, mapPhraseToTargets(text));
}

const recognizer = createSpeechRecognizer({
  onResult: onPhrase,
  onStateChange: setLive,
  onError: showError,
});

if (!recognizer.supported) {
  startBtn.disabled = true;
}

startBtn.addEventListener('click', () => {
  startOverlay.hidden = true;
  recognizer.start();
});

// Manual text injection for tech rehearsal / tuning without a live mic:
// open the console and call __illuminate.setPhrase("some words").
window.__illuminate = { setPhrase: onPhrase };
