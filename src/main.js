import { createSpeechRecognizer } from './speech.js';
import { TextLayer } from './textLayer.js';
import { HistoryLayer } from './historyLayer.js';
import { Renderer } from './renderer.js';
import { Monologue } from './monologue.js';

// ---- DOM --------------------------------------------------------------
const glCanvas = document.getElementById('gl');
const dotEl = document.getElementById('dot');
const statusText = document.getElementById('statusText');
const startOverlay = document.getElementById('start');
const startBtn = document.getElementById('startBtn');
const errorEl = document.getElementById('error');
const debugEl = document.getElementById('debug');
const stylePanel = document.getElementById('stylePanel');
const styleFontEl = document.getElementById('styleFont');
const styleWeightEl = document.getElementById('styleWeight');
const styleWeightVal = document.getElementById('styleWeightVal');
const styleSizeEl = document.getElementById('styleSize');
const styleSizeVal = document.getElementById('styleSizeVal');
const styleSpacingEl = document.getElementById('styleSpacing');
const styleSpacingVal = document.getElementById('styleSpacingVal');
const styleTransitionEl = document.getElementById('styleTransition');
const styleTransitionVal = document.getElementById('styleTransitionVal');
const styleHoldEl = document.getElementById('styleHold');
const styleHoldVal = document.getElementById('styleHoldVal');

function showError(msg) {
  errorEl.hidden = false;
  errorEl.textContent = msg;
}

function setLive(isLive) {
  dotEl.classList.toggle('live', isLive);
  statusText.textContent = isLive ? 'listening' : 'idle';
}

// ---- Text style (persisted rehearsal tuning) -----------------------------
const STYLE_STORAGE_KEY = 'illuminate:textStyle';
const DEFAULT_STYLE = { fontFamily: 'system-ui, sans-serif', fontWeight: 700, sizeScale: 1, letterSpacing: 0, transitionMs: 300, holdMs: 1200 };

function loadStyle() {
  try {
    const saved = JSON.parse(localStorage.getItem(STYLE_STORAGE_KEY));
    return { ...DEFAULT_STYLE, ...saved };
  } catch (e) {
    return { ...DEFAULT_STYLE };
  }
}

function saveStyle(style) {
  try { localStorage.setItem(STYLE_STORAGE_KEY, JSON.stringify(style)); } catch (e) { /* storage unavailable */ }
}

// ---- Render state ---------------------------------------------------------
const textLayer = new TextLayer(loadStyle());
const historyLayer = new HistoryLayer({ fontFamily: textLayer.fontFamily });

let renderer;
try {
  renderer = new Renderer(glCanvas, textLayer.canvas, historyLayer.canvas);
} catch (e) {
  showError(e.message);
}

// ---- Style panel ----------------------------------------------------------
function applyStyleToPanel(style) {
  styleFontEl.value = style.fontFamily;
  styleWeightEl.value = style.fontWeight;
  styleWeightVal.textContent = style.fontWeight;
  styleSizeEl.value = Math.round(style.sizeScale * 100);
  styleSizeVal.textContent = `${Math.round(style.sizeScale * 100)}%`;
  styleSpacingEl.value = style.letterSpacing;
  styleSpacingVal.textContent = `${style.letterSpacing}px`;
  styleTransitionEl.value = style.transitionMs;
  styleTransitionVal.textContent = `${(style.transitionMs / 1000).toFixed(1)}s`;
  styleHoldEl.value = style.holdMs;
  styleHoldVal.textContent = `${(style.holdMs / 1000).toFixed(1)}s`;
}
applyStyleToPanel(textLayer);

function onStyleInput() {
  const style = {
    fontFamily: styleFontEl.value,
    fontWeight: Number(styleWeightEl.value),
    sizeScale: Number(styleSizeEl.value) / 100,
    letterSpacing: Number(styleSpacingEl.value),
    transitionMs: Number(styleTransitionEl.value),
    holdMs: Number(styleHoldEl.value),
  };
  styleWeightVal.textContent = style.fontWeight;
  styleSizeVal.textContent = `${Math.round(style.sizeScale * 100)}%`;
  styleSpacingVal.textContent = `${style.letterSpacing}px`;
  styleTransitionVal.textContent = `${(style.transitionMs / 1000).toFixed(1)}s`;
  styleHoldVal.textContent = `${(style.holdMs / 1000).toFixed(1)}s`;
  textLayer.setStyle(style);
  textLayer.setTransitionMs(style.transitionMs);
  textLayer.setHoldMs(style.holdMs);
  historyLayer.setFontFamily(style.fontFamily);
  saveStyle(style);
}
[styleFontEl, styleWeightEl, styleSizeEl, styleSpacingEl, styleTransitionEl, styleHoldEl].forEach((el) => {
  el.addEventListener('input', onStyleInput);
});

// ---- Resize -------------------------------------------------------------
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.round(window.innerWidth * dpr);
  const h = Math.round(window.innerHeight * dpr);
  glCanvas.style.width = window.innerWidth + 'px';
  glCanvas.style.height = window.innerHeight + 'px';
  textLayer.resize(w, h);
  historyLayer.resize(w, h);
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
  historyLayer.update();
  if (renderer) {
    try {
      renderer.render();
    } catch (e) {
      showError('Render error: ' + e.message);
    }
  }

  if (debugOn) {
    const mode = userSpeaking ? 'speech' : 'monologue';
    debugEl.textContent = `mode ${mode}  phase ${textLayer.phase}  alpha ${textLayer.alpha.toFixed(2)}`;
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('keydown', (e) => {
  if (e.key === 'd') {
    debugOn = !debugOn;
    debugEl.hidden = !debugOn;
  } else if (e.key === 'p') {
    stylePanel.hidden = !stylePanel.hidden;
  }
});

// ---- WebGL context loss: unattended runs should recover, not hang -------
glCanvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  showError('Graphics context lost — reloading…');
  setTimeout(() => window.location.reload(), 1500);
});

// ---- Speech input -----------------------------------------------------
// The big center phrase only ever shows the live, in-progress transcript
// of the utterance being spoken — never the finalized wording. Once an
// utterance finalizes, it goes to the history log and the big phrase
// dismisses instead of displaying (or holding on) the completed text.
function onPhrase(text, isFinal) {
  if (isFinal) {
    historyLayer.addPhrase(text);
    textLayer.finishUtterance();
  } else {
    textLayer.setPhrase(text);
  }
}

// ---- Ongoing monologue (fills silence when no one is speaking) ----------
// Feeds stored placeholder text into the exact same onPhrase() pipeline as
// real speech, word by word. Real speech always wins: any recognizer
// result pauses the monologue immediately, and it only resumes after a
// short grace period of continued silence.
const RESUME_GRACE_MS = 2500;
let userSpeaking = false;
let resumeTimer = null;

const monologue = new Monologue({
  onInterim: (text) => onPhrase(text, false),
  onFinal: (text) => onPhrase(text, true),
});

function onSpeechResult(text, isFinal) {
  if (!userSpeaking) {
    userSpeaking = true;
    monologue.pause();
    // Close out whatever the monologue had on screen as an aborted
    // utterance (not sent to history) so the real transcript gets its
    // own fresh entrance instead of silently overwriting it in place.
    textLayer.finishUtterance();
  }
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => {
    userSpeaking = false;
    monologue.resume();
  }, RESUME_GRACE_MS);

  onPhrase(text, isFinal);
}

const recognizer = createSpeechRecognizer({
  onResult: onSpeechResult,
  onStateChange: setLive,
  onError: showError,
});

if (!recognizer.supported) {
  startBtn.disabled = true;
}

startBtn.addEventListener('click', () => {
  startOverlay.hidden = true;
  recognizer.start();
  monologue.start();
});

// Manual text injection for tech rehearsal / tuning without a live mic:
// open the console and call __illuminate.setPhrase("some words") to show
// it as a live/in-progress transcript, then __illuminate.finish("some words")
// to finalize it (sends it to the history log, dismisses the big phrase).
// __illuminate.monologue is the running Monologue instance (.pause()/.resume()).
window.__illuminate = {
  setPhrase: (text) => onPhrase(text, false),
  finish: (text) => onPhrase(text, true),
  monologue,
};
