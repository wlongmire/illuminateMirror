import { createSpeechRecognizer } from './speech.js';
import { TextLayer } from './textLayer.js';
import { HistoryLayer } from './historyLayer.js';
import { Renderer } from './renderer.js';
import { Monologue } from './monologue.js';
import { VideoInput, MIRROR_VIDEOS, listCameraDevices } from './videoInput.js';
import { MidiOutput } from './midiOutput.js';
import { MicVolumeMeter } from './micVolume.js';

// ---- DOM --------------------------------------------------------------
const glCanvas = document.getElementById('gl');
const ovalRingEl = document.getElementById('ovalRing');
const dotEl = document.getElementById('dot');
const startOverlay = document.getElementById('start');
const startBtn = document.getElementById('startBtn');
const debugEl = document.getElementById('debug');
const stylePanel = document.getElementById('stylePanel');
const styleFontEl = document.getElementById('styleFont');
const styleWeightEl = document.getElementById('styleWeight');
const styleWeightVal = document.getElementById('styleWeightVal');
const styleSizeEl = document.getElementById('styleSize');
const styleSizeVal = document.getElementById('styleSizeVal');
const styleUserSizeEl = document.getElementById('styleUserSize');
const styleUserSizeVal = document.getElementById('styleUserSizeVal');
const styleUserVolumeBoostEl = document.getElementById('styleUserVolumeBoost');
const styleUserVolumeBoostVal = document.getElementById('styleUserVolumeBoostVal');
const styleSpacingEl = document.getElementById('styleSpacing');
const styleSpacingVal = document.getElementById('styleSpacingVal');
const styleTransitionEl = document.getElementById('styleTransition');
const styleTransitionVal = document.getElementById('styleTransitionVal');
const styleHoldEl = document.getElementById('styleHold');
const styleHoldVal = document.getElementById('styleHoldVal');
const styleMaxWordsEl = document.getElementById('styleMaxWords');
const styleMaxWordsVal = document.getElementById('styleMaxWordsVal');
const styleCorpusAlphaEl = document.getElementById('styleCorpusAlpha');
const styleCorpusAlphaVal = document.getElementById('styleCorpusAlphaVal');
const styleUserAlphaEl = document.getElementById('styleUserAlpha');
const styleUserAlphaVal = document.getElementById('styleUserAlphaVal');
const styleUserWordSizeEl = document.getElementById('styleUserWordSize');
const styleUserWordSizeVal = document.getElementById('styleUserWordSizeVal');
const styleVolumeBoostEl = document.getElementById('styleVolumeBoost');
const styleVolumeBoostVal = document.getElementById('styleVolumeBoostVal');
const styleCorpusModeEl = document.getElementById('styleCorpusMode');
const styleCorpusBaseEl = document.getElementById('styleCorpusBase');
const styleCorpusBaseVal = document.getElementById('styleCorpusBaseVal');
const styleCorpusAmplitudeEl = document.getElementById('styleCorpusAmplitude');
const styleCorpusAmplitudeVal = document.getElementById('styleCorpusAmplitudeVal');
const styleCorpusFrequencyEl = document.getElementById('styleCorpusFrequency');
const styleCorpusFrequencyVal = document.getElementById('styleCorpusFrequencyVal');
const corpusSineControlsEl = document.getElementById('corpusSineControls');
const styleVideoSourceEl = document.getElementById('styleVideoSource');
const styleCameraDeviceEl = document.getElementById('styleCameraDevice');
const styleVideoInfluenceEl = document.getElementById('styleVideoInfluence');
const styleVideoInfluenceVal = document.getElementById('styleVideoInfluenceVal');
const styleVideoGainEl = document.getElementById('styleVideoGain');
const styleVideoGainVal = document.getElementById('styleVideoGainVal');
const styleCorpusVelocityEl = document.getElementById('styleCorpusVelocity');
const styleCorpusVelocityVal = document.getElementById('styleCorpusVelocityVal');
const styleMicFloorEl = document.getElementById('styleMicFloor');
const styleMicFloorVal = document.getElementById('styleMicFloorVal');
const styleMicCeilEl = document.getElementById('styleMicCeil');
const styleMicCeilVal = document.getElementById('styleMicCeilVal');
const styleGateOpenEl = document.getElementById('styleGateOpen');
const styleGateOpenVal = document.getElementById('styleGateOpenVal');
const styleGateCloseEl = document.getElementById('styleGateClose');
const styleGateCloseVal = document.getElementById('styleGateCloseVal');
const styleUtteranceEndEl = document.getElementById('styleUtteranceEnd');
const styleUtteranceEndVal = document.getElementById('styleUtteranceEndVal');
const gateReadoutEl = document.getElementById('gateReadout');
const gateBypassToggleEl = document.getElementById('gateBypassToggle');

// Mirror clip options aren't hardcoded in index.html — added here from the
// single manifest in videoInput.js so there's one place that knows about them.
// Also doubles as the 1-5 number-key shortcut order below (index 0 -> '1').
const VIDEO_SOURCE_ORDER = ['camera', ...MIRROR_VIDEOS.map((v) => v.id)];
for (const v of MIRROR_VIDEOS) {
  const opt = document.createElement('option');
  opt.value = v.id;
  opt.textContent = v.label;
  styleVideoSourceEl.appendChild(opt);
}

// Errors don't render on screen (this runs unattended, projected) — just
// logged for whoever's at a laptop during tech rehearsal.
function logError(msg) {
  console.error(msg);
}

function setLive(isLive) {
  dotEl.classList.toggle('live', isLive);
}

// ---- Text style (persisted rehearsal tuning) -----------------------------
const STYLE_STORAGE_KEY = 'illuminate:textStyle';
const DEFAULT_STYLE = {
  fontFamily: "'UnifrakturCook', serif", fontWeight: 700, sizeScale: 1, userSizeScale: 1, userVolumeBoost: 0.6, letterSpacing: 0,
  transitionMs: 300, holdMs: 1200,
  // A spoken utterance longer than this many words is cut into chunks of
  // this size (the next word starts a fresh phrase). 0 = no limit.
  maxUtteranceWords: 6,
  corpusMode: 'sine', corpusBaseMs: 300, corpusAmplitudeMs: 150, corpusFrequencyHz: 0.2,
  videoSource: 'camera', cameraDeviceId: '', videoInfluence: 0, videoGain: 1,
  corpusAlpha: 1, userAlpha: 0.65,
  userWordSizeScale: 0.8, volumeSizeBoost: 2,
  // MIDI: user-note velocity comes from live mic level (calibrated by the
  // floor/ceiling dB range below); corpus notes use a fixed velocity.
  corpusVelocity: 90, micFloorDb: -50, micCeilDb: -12,
  // SpeechBridge proximity gate: audio quieter than this never reaches the
  // recognizer, so only speech close to the mic gets transcribed. A pause
  // of utteranceEndMs after gated speech ends the utterance.
  gateOpenDb: -30, gateCloseDb: -40, utteranceEndMs: 800,
};

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
const initialStyle = loadStyle();
const textLayer = new TextLayer(initialStyle);
const historyLayer = new HistoryLayer({
  fontFamily: textLayer.fontFamily,
  corpusAlpha: initialStyle.corpusAlpha,
  userAlpha: initialStyle.userAlpha,
  userWordSizeScale: initialStyle.userWordSizeScale,
  volumeSizeBoost: initialStyle.volumeSizeBoost,
});
// Live camera (or one of the mirror clips), used to fill both history
// layers — see renderer's video pass.
const videoInput = new VideoInput({ source: initialStyle.videoSource });
videoInput.setCameraDevice(initialStyle.cameraDeviceId);
let videoInfluence = initialStyle.videoInfluence;
let videoGain = initialStyle.videoGain;

// Starts/restarts videoInput and, on a successful camera start, refreshes
// the device list — device labels are blank until permission is granted,
// so the first real start is also the first chance to show real names.
function startVideoInput() {
  videoInput.start()
    .then(() => {
      if (videoInput.source === 'camera') refreshCameraDevices();
    })
    .catch((e) => logError('Video unavailable: ' + e.message));
}

// `preferredValue` defaults to whatever's currently selected (used when
// devices change mid-session); the very first call instead passes the
// saved style's choice, since at that point the panel hasn't applied it
// yet and the <select> only has the placeholder "Default" option.
async function refreshCameraDevices(preferredValue = styleCameraDeviceEl.value) {
  const cams = await listCameraDevices();
  styleCameraDeviceEl.innerHTML = '<option value="">Default</option>';
  cams.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Camera ${i + 1}`;
    styleCameraDeviceEl.appendChild(opt);
  });
  const stillExists = [...styleCameraDeviceEl.options].some((o) => o.value === preferredValue);
  styleCameraDeviceEl.value = stillExists ? preferredValue : '';
}
refreshCameraDevices(initialStyle.cameraDeviceId);
navigator.mediaDevices?.addEventListener?.('devicechange', refreshCameraDevices);

// MIDI out (one note per word, to an IAC bus) + a second, independent mic
// stream used only to read the live input level for user-note velocity —
// the Web Speech API itself carries no volume information.
const midiOutput = new MidiOutput();
const micVolume = new MicVolumeMeter();
let corpusVelocity = initialStyle.corpusVelocity;
let micFloorDb = initialStyle.micFloorDb;
let micCeilDb = initialStyle.micCeilDb;
let maxUtteranceWords = initialStyle.maxUtteranceWords;

let renderer;
try {
  renderer = new Renderer(glCanvas, {
    current: textLayer.canvas,
    historyUser: historyLayer.userCanvas,
    historyCorpus: historyLayer.corpusCanvas,
  });
} catch (e) {
  logError(e.message);
}

// ---- Style panel ----------------------------------------------------------
function formatFrequency(hz) {
  return `${hz.toFixed(2)}Hz (${(1 / hz).toFixed(1)}s)`;
}

function applyStyleToPanel(style) {
  styleFontEl.value = style.fontFamily;
  styleWeightEl.value = style.fontWeight;
  styleWeightVal.textContent = style.fontWeight;
  styleSizeEl.value = Math.round(style.sizeScale * 100);
  styleSizeVal.textContent = `${Math.round(style.sizeScale * 100)}%`;
  styleUserSizeEl.value = Math.round(style.userSizeScale * 100);
  styleUserSizeVal.textContent = `${Math.round(style.userSizeScale * 100)}%`;
  styleUserVolumeBoostEl.value = Math.round(style.userVolumeBoost * 100);
  styleUserVolumeBoostVal.textContent = `${Math.round(style.userVolumeBoost * 100)}%`;
  styleSpacingEl.value = style.letterSpacing;
  styleSpacingVal.textContent = `${style.letterSpacing}px`;
  styleTransitionEl.value = style.transitionMs;
  styleTransitionVal.textContent = `${(style.transitionMs / 1000).toFixed(1)}s`;
  styleHoldEl.value = style.holdMs;
  styleHoldVal.textContent = `${(style.holdMs / 1000).toFixed(1)}s`;
  styleMaxWordsEl.value = style.maxUtteranceWords;
  styleMaxWordsVal.textContent = style.maxUtteranceWords || 'off';
  styleCorpusAlphaEl.value = Math.round(style.corpusAlpha * 100);
  styleCorpusAlphaVal.textContent = `${Math.round(style.corpusAlpha * 100)}%`;
  styleUserAlphaEl.value = Math.round(style.userAlpha * 100);
  styleUserAlphaVal.textContent = `${Math.round(style.userAlpha * 100)}%`;
  styleUserWordSizeEl.value = Math.round(style.userWordSizeScale * 100);
  styleUserWordSizeVal.textContent = `${Math.round(style.userWordSizeScale * 100)}%`;
  styleVolumeBoostEl.value = Math.round(style.volumeSizeBoost * 100);
  styleVolumeBoostVal.textContent = `${Math.round(style.volumeSizeBoost * 100)}%`;
  styleCorpusModeEl.value = style.corpusMode;
  styleCorpusBaseEl.value = style.corpusBaseMs;
  styleCorpusBaseVal.textContent = `${style.corpusBaseMs}ms/word`;
  styleCorpusAmplitudeEl.value = style.corpusAmplitudeMs;
  styleCorpusAmplitudeVal.textContent = `${style.corpusAmplitudeMs}ms`;
  styleCorpusFrequencyEl.value = style.corpusFrequencyHz;
  styleCorpusFrequencyVal.textContent = formatFrequency(style.corpusFrequencyHz);
  corpusSineControlsEl.hidden = style.corpusMode !== 'sine';
  styleVideoSourceEl.value = style.videoSource;
  styleCameraDeviceEl.value = style.cameraDeviceId;
  styleVideoInfluenceEl.value = Math.round(style.videoInfluence * 100);
  styleVideoInfluenceVal.textContent = `${Math.round(style.videoInfluence * 100)}%`;
  styleVideoGainEl.value = style.videoGain;
  styleVideoGainVal.textContent = `${style.videoGain.toFixed(1)}x`;
  styleCorpusVelocityEl.value = style.corpusVelocity;
  styleCorpusVelocityVal.textContent = style.corpusVelocity;
  styleMicFloorEl.value = style.micFloorDb;
  styleMicFloorVal.textContent = `${style.micFloorDb}dB`;
  styleMicCeilEl.value = style.micCeilDb;
  styleMicCeilVal.textContent = `${style.micCeilDb}dB`;
  styleGateOpenEl.value = style.gateOpenDb;
  styleGateOpenVal.textContent = `${style.gateOpenDb}dB`;
  styleGateCloseEl.value = style.gateCloseDb;
  styleGateCloseVal.textContent = `${style.gateCloseDb}dB`;
  styleUtteranceEndEl.value = style.utteranceEndMs;
  styleUtteranceEndVal.textContent = `${(style.utteranceEndMs / 1000).toFixed(2)}s`;
}
applyStyleToPanel(initialStyle);

function onStyleInput() {
  const style = {
    fontFamily: styleFontEl.value,
    fontWeight: Number(styleWeightEl.value),
    sizeScale: Number(styleSizeEl.value) / 100,
    userSizeScale: Number(styleUserSizeEl.value) / 100,
    userVolumeBoost: Number(styleUserVolumeBoostEl.value) / 100,
    letterSpacing: Number(styleSpacingEl.value),
    transitionMs: Number(styleTransitionEl.value),
    holdMs: Number(styleHoldEl.value),
    maxUtteranceWords: Number(styleMaxWordsEl.value),
    corpusAlpha: Number(styleCorpusAlphaEl.value) / 100,
    userAlpha: Number(styleUserAlphaEl.value) / 100,
    userWordSizeScale: Number(styleUserWordSizeEl.value) / 100,
    volumeSizeBoost: Number(styleVolumeBoostEl.value) / 100,
    corpusMode: styleCorpusModeEl.value,
    corpusBaseMs: Number(styleCorpusBaseEl.value),
    corpusAmplitudeMs: Number(styleCorpusAmplitudeEl.value),
    corpusFrequencyHz: Number(styleCorpusFrequencyEl.value),
    videoSource: styleVideoSourceEl.value,
    cameraDeviceId: styleCameraDeviceEl.value,
    videoInfluence: Number(styleVideoInfluenceEl.value) / 100,
    videoGain: Number(styleVideoGainEl.value),
    corpusVelocity: Number(styleCorpusVelocityEl.value),
    micFloorDb: Number(styleMicFloorEl.value),
    micCeilDb: Number(styleMicCeilEl.value),
    gateOpenDb: Number(styleGateOpenEl.value),
    gateCloseDb: Number(styleGateCloseEl.value),
    utteranceEndMs: Number(styleUtteranceEndEl.value),
  };
  styleWeightVal.textContent = style.fontWeight;
  styleSizeVal.textContent = `${Math.round(style.sizeScale * 100)}%`;
  styleUserSizeVal.textContent = `${Math.round(style.userSizeScale * 100)}%`;
  styleUserVolumeBoostVal.textContent = `${Math.round(style.userVolumeBoost * 100)}%`;
  styleSpacingVal.textContent = `${style.letterSpacing}px`;
  styleTransitionVal.textContent = `${(style.transitionMs / 1000).toFixed(1)}s`;
  styleHoldVal.textContent = `${(style.holdMs / 1000).toFixed(1)}s`;
  styleMaxWordsVal.textContent = style.maxUtteranceWords || 'off';
  maxUtteranceWords = style.maxUtteranceWords;
  styleCorpusBaseVal.textContent = `${style.corpusBaseMs}ms/word`;
  styleCorpusAmplitudeVal.textContent = `${style.corpusAmplitudeMs}ms`;
  styleCorpusFrequencyVal.textContent = formatFrequency(style.corpusFrequencyHz);
  corpusSineControlsEl.hidden = style.corpusMode !== 'sine';
  styleVideoInfluenceVal.textContent = `${Math.round(style.videoInfluence * 100)}%`;
  styleVideoGainVal.textContent = `${style.videoGain.toFixed(1)}x`;
  videoInfluence = style.videoInfluence;
  videoGain = style.videoGain;
  styleCorpusVelocityVal.textContent = style.corpusVelocity;
  styleMicFloorVal.textContent = `${style.micFloorDb}dB`;
  styleMicCeilVal.textContent = `${style.micCeilDb}dB`;
  corpusVelocity = style.corpusVelocity;
  micFloorDb = style.micFloorDb;
  micCeilDb = style.micCeilDb;
  styleGateOpenVal.textContent = `${style.gateOpenDb}dB`;
  styleGateCloseVal.textContent = `${style.gateCloseDb}dB`;
  styleUtteranceEndVal.textContent = `${(style.utteranceEndMs / 1000).toFixed(2)}s`;
  recognizer.setGate(style);
  const sourceChanged = style.videoSource !== videoInput.source;
  const deviceChanged = (style.cameraDeviceId || '') !== (videoInput.cameraDeviceId || '');
  videoInput.setSource(style.videoSource);
  videoInput.setCameraDevice(style.cameraDeviceId);
  if (sourceChanged) {
    // Always (re)start on switch — every source (camera or a mirror clip)
    // points the shared <video> element at something different, even if
    // videoInput.state is already 'live' from whatever was playing before.
    startVideoInput();
  } else if (deviceChanged && videoInput.source === 'camera') {
    // Only restart for a device change if the camera is the thing actually
    // showing right now — otherwise the new device just gets remembered
    // for whenever the source is switched back to camera later.
    startVideoInput();
  }
  textLayer.setStyle(style);
  textLayer.setUserSizeScale(style.userSizeScale);
  textLayer.setUserVolumeBoost(style.userVolumeBoost);
  textLayer.setTransitionMs(style.transitionMs);
  textLayer.setHoldMs(style.holdMs);
  styleCorpusAlphaVal.textContent = `${Math.round(style.corpusAlpha * 100)}%`;
  styleUserAlphaVal.textContent = `${Math.round(style.userAlpha * 100)}%`;
  styleUserWordSizeVal.textContent = `${Math.round(style.userWordSizeScale * 100)}%`;
  styleVolumeBoostVal.textContent = `${Math.round(style.volumeSizeBoost * 100)}%`;
  historyLayer.setFontFamily(style.fontFamily);
  historyLayer.setBrightness({ corpusAlpha: style.corpusAlpha, userAlpha: style.userAlpha });
  historyLayer.setUserWordSizing({ sizeScale: style.userWordSizeScale, volumeBoost: style.volumeSizeBoost });
  monologue.setMode(style.corpusMode);
  monologue.setBaseDelayMs(style.corpusBaseMs);
  monologue.setAmplitudeMs(style.corpusAmplitudeMs);
  monologue.setFrequencyHz(style.corpusFrequencyHz);
  saveStyle(style);
}
[
  styleFontEl, styleWeightEl, styleSizeEl, styleUserSizeEl, styleUserVolumeBoostEl, styleSpacingEl,
  styleTransitionEl, styleHoldEl, styleMaxWordsEl, styleCorpusModeEl, styleCorpusBaseEl,
  styleCorpusAmplitudeEl, styleCorpusFrequencyEl,
  styleVideoSourceEl, styleCameraDeviceEl, styleVideoInfluenceEl, styleVideoGainEl,
  styleCorpusAlphaEl, styleUserAlphaEl, styleUserWordSizeEl, styleVolumeBoostEl,
  styleCorpusVelocityEl, styleMicFloorEl, styleMicCeilEl,
  styleGateOpenEl, styleGateCloseEl, styleUtteranceEndEl,
].forEach((el) => {
  el.addEventListener('input', onStyleInput);
});

// ---- Resize -------------------------------------------------------------
// Oval crop: when on, the canvas (text + history layers, i.e. the whole
// piece) is cropped to an ellipse instead of filling the viewport. The oval
// is sized to fit the viewport at ovalAspect (width / height; < 1 is tall,
// > 1 is wide), then scaled/nudged from there. Persisted across reloads
// (unlike ovalEnabled itself, or the 'd'/'p' toggles) since dialing this in
// is real physical setup work for a specific room/projector; reset with
// Backspace/Delete.
// Outline: a thin, crisp ring that, as the overall mic level rises (all sound
// in the room, not just speech past the proximity gate), gets more saturated
// and thicker, then eases back down. Widths are in px. The level uses the mic
// ceiling shared with MIDI velocity, but starts RING_FLOOR_OFFSET_DB above the
// shared mic floor, so room noise below that leaves the ring untouched and
// only real sound moves it.
//
// Its resting color is the average color of the background video (whichever
// source is playing — a mirror clip or the camera), or white when there's no
// video. When loud it heads to a vivid, saturated version of that same hue.
const RING_REST = { width: 3 };
const RING_LOUD = { sat: 100, light: 58, width: 9 };
const RING_FALLBACK_HUE = 205; // hue to saturate toward when the base color is white/gray
const RING_MIN_LIGHT = 55;     // a dark video's average is lifted to this, or the ring would vanish on black
const RING_GRAY_SAT = 6;       // below this saturation the base has no meaningful hue
const RING_COLOR_TAU_MS = 700; // how slowly the base color follows the video
const RING_SAMPLE_MS = 120;
const RING_FLOOR_OFFSET_DB = 10;
const RING_ATTACK_MS = 60;
const RING_RELEASE_MS = 500;
let ringLevel = 0;

const ringColor = { r: 255, g: 255, b: 255 }; // smoothed base color (starts white)
let ringTarget = { r: 255, g: 255, b: 255 };  // what it's easing toward: the video average, or white
let ringLastSampleT = 0;
const ringSampleCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
ringSampleCtx.canvas.width = 16;
ringSampleCtx.canvas.height = 9;

function sampleRingTarget(now) {
  if (now - ringLastSampleT < RING_SAMPLE_MS) return;
  ringLastSampleT = now;
  if (!videoInput.ready) {
    ringTarget = { r: 255, g: 255, b: 255 };
    return;
  }
  ringSampleCtx.drawImage(videoInput.video, 0, 0, 16, 9);
  const px = ringSampleCtx.getImageData(0, 0, 16, 9).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
  const n = px.length / 4;
  ringTarget = { r: r / n, g: g / n, b: b / n };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100 };
}

const OVAL_FILL = 0.92; // fraction of the best-fit box the oval occupies at scale 1
let ovalEnabled = false;

const OVAL_STORAGE_KEY = 'illuminate:oval';
const DEFAULT_OVAL = { ovalOffsetX: 0, ovalOffsetY: 0, ovalScale: 1, ovalAspect: 0.62 };

function loadOval() {
  try {
    const saved = JSON.parse(localStorage.getItem(OVAL_STORAGE_KEY));
    return { ...DEFAULT_OVAL, ...saved };
  } catch (e) {
    return { ...DEFAULT_OVAL };
  }
}

function saveOval() {
  try {
    localStorage.setItem(OVAL_STORAGE_KEY, JSON.stringify({ ovalOffsetX, ovalOffsetY, ovalScale, ovalAspect }));
  } catch (e) { /* storage unavailable */ }
}

let { ovalOffsetX, ovalOffsetY, ovalScale, ovalAspect } = loadOval();

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let boxW = window.innerWidth;
  let boxH = window.innerHeight;

  if (ovalEnabled) {
    // Largest box of the oval's aspect that fits the viewport, shrunk a
    // little, then scaled from its center before the offset shifts it — so
    // scaling and nudging compose the same way regardless of order.
    const fit = Math.min(window.innerHeight, window.innerWidth / ovalAspect) * OVAL_FILL * ovalScale;
    boxH = fit;
    boxW = fit * ovalAspect;
    const left = (window.innerWidth - boxW) / 2 + ovalOffsetX;
    const top = (window.innerHeight - boxH) / 2 + ovalOffsetY;
    glCanvas.style.left = `${left}px`;
    glCanvas.style.top = `${top}px`;
    glCanvas.style.right = 'auto';
    glCanvas.style.bottom = 'auto';
    glCanvas.style.borderRadius = '50%';
    ovalRingEl.style.left = `${left}px`;
    ovalRingEl.style.top = `${top}px`;
    ovalRingEl.style.width = `${boxW}px`;
    ovalRingEl.style.height = `${boxH}px`;
    ovalRingEl.hidden = false;
  } else {
    // Falls back to the plain inset:0 rule in index.html — full viewport.
    glCanvas.style.left = '';
    glCanvas.style.top = '';
    glCanvas.style.right = '';
    glCanvas.style.bottom = '';
    glCanvas.style.borderRadius = '';
    ovalRingEl.hidden = true;
  }

  const w = Math.round(boxW * dpr);
  const h = Math.round(boxH * dpr);
  glCanvas.style.width = boxW + 'px';
  glCanvas.style.height = boxH + 'px';
  const shape = ovalEnabled ? 'ellipse' : 'rect';
  textLayer.setShape(shape);
  historyLayer.setShape(shape);
  textLayer.resize(w, h);
  historyLayer.resize(w, h);
  if (renderer) renderer.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

// ---- Render loop ----------------------------------------------------------
let lastT = performance.now();
let debugOn = false;
// Testing only, session-only (not persisted): forwards every mic buffer to
// the recognizer regardless of level, to check what SpeechBridge would
// transcribe without the proximity gate in the way.
let gateBypass = false;
function setGateBypass(enabled) {
  gateBypass = enabled;
  gateBypassToggleEl.checked = enabled;
  recognizer.setGateBypass(enabled);
}
gateBypassToggleEl.addEventListener('change', () => setGateBypass(gateBypassToggleEl.checked));

function frame(t) {
  const dtMs = Math.min(100, t - lastT); // clamp to avoid huge jumps on tab-back
  lastT = t;

  textLayer.update(dtMs);
  historyLayer.update(dtMs);
  if (ovalEnabled) {
    const target = micVolume.getNormalized(Math.min(micFloorDb + RING_FLOOR_OFFSET_DB, micCeilDb - 3), micCeilDb);
    ringLevel += (target - ringLevel) * (1 - Math.exp(-dtMs / (target > ringLevel ? RING_ATTACK_MS : RING_RELEASE_MS)));
    sampleRingTarget(t);
    const follow = 1 - Math.exp(-dtMs / RING_COLOR_TAU_MS);
    ringColor.r += (ringTarget.r - ringColor.r) * follow;
    ringColor.g += (ringTarget.g - ringColor.g) * follow;
    ringColor.b += (ringTarget.b - ringColor.b) * follow;
    const base = rgbToHsl(ringColor.r, ringColor.g, ringColor.b);
    const hue = base.s < RING_GRAY_SAT ? RING_FALLBACK_HUE : base.h;
    const baseLight = Math.max(base.l, RING_MIN_LIGHT);
    const sat = base.s + (RING_LOUD.sat - base.s) * ringLevel;
    const light = baseLight + (RING_LOUD.light - baseLight) * ringLevel;
    ovalRingEl.style.setProperty('--ring-color', `hsl(${hue.toFixed(1)} ${sat.toFixed(1)}% ${light.toFixed(1)}%)`);
    const width = RING_REST.width + (RING_LOUD.width - RING_REST.width) * ringLevel;
    ovalRingEl.style.setProperty('--ring-spread', `${width.toFixed(2)}px`);
  }
  if (renderer) {
    try {
      renderer.render({
        video: videoInput,
        influence: videoInfluence,
        gain: videoGain,
      });
    } catch (e) {
      logError('Render error: ' + e.message);
    }
  }

  if (debugOn) {
    const mode = userSpeaking ? 'speech' : 'monologue';
    const cam = videoInput.error ? `error (${videoInput.error})` : videoInput.state;
    const shading = videoInput.ready && videoInfluence > 0;
    const midi = midiOutput.error ? `error (${midiOutput.error})` : midiOutput.state;
    const mic = micVolume.error ? `error (${micVolume.error})` : micVolume.state;
    debugEl.textContent =
      `mode ${mode}  phase ${textLayer.phase}  alpha ${textLayer.alpha.toFixed(2)}\n` +
      `src ${videoInput.source}  cam ${cam}  ready ${videoInput.ready}  ${videoInput.video.videoWidth}x${videoInput.video.videoHeight}\n` +
      `influence ${videoInfluence.toFixed(2)}  gain ${videoGain.toFixed(1)}  shading ${shading}\n` +
      `midi ${midi} (${midiOutput.portName ?? 'no port'})  mic ${mic}  level ${micVolume.db.toFixed(1)}dB  vel ${micVolume.getVelocity(micFloorDb, micCeilDb)}\n` +
      `oval ${ovalEnabled ? 'on' : 'off'} (f to toggle)  offset ${ovalOffsetX}, ${ovalOffsetY} (arrows)  scale ${Math.round(ovalScale * 100)}% (+/-)  aspect ${ovalAspect.toFixed(2)} w/h (shift +/-)  [backspace to reset]`;
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
  } else if (e.key === 'f') {
    ovalEnabled = !ovalEnabled;
    resize();
  } else if (e.key === 'g') {
    setGateBypass(!gateBypass);
  } else if (/^[1-9]$/.test(e.key)) {
    // Ignore while a form control has focus — a select's own type-ahead,
    // or just typing into a field, should win instead.
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    const idx = Number(e.key) - 1;
    if (idx < VIDEO_SOURCE_ORDER.length) {
      styleVideoSourceEl.value = VIDEO_SOURCE_ORDER[idx];
      styleVideoSourceEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } else if (ovalEnabled && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    // Fine position nudge — only live while the oval is showing, so plain
    // arrow keys stay free otherwise.
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    const step = 1;
    ovalOffsetX += e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    ovalOffsetY += e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    resize();
    saveOval();
    e.preventDefault();
  } else if (ovalEnabled && (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_')) {
    // '=' is included alongside '+' since that's the unshifted key that
    // types '+' on a standard layout, likewise '_' alongside '-'. Shift
    // (checked via e.shiftKey, so numpad '+' works too) changes the oval's
    // shape (width relative to height) instead of its size.
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    const grow = e.key === '+' || e.key === '=';
    if (e.shiftKey) {
      ovalAspect = Math.max(0.2, Math.min(5, ovalAspect + (grow ? 0.02 : -0.02)));
    } else {
      ovalScale = Math.max(0.1, Math.min(5, ovalScale + (grow ? 0.02 : -0.02)));
    }
    resize();
    saveOval();
    e.preventDefault();
  } else if (ovalEnabled && (e.key === 'Backspace' || e.key === 'Delete')) {
    ovalOffsetX = DEFAULT_OVAL.ovalOffsetX;
    ovalOffsetY = DEFAULT_OVAL.ovalOffsetY;
    ovalScale = DEFAULT_OVAL.ovalScale;
    ovalAspect = DEFAULT_OVAL.ovalAspect;
    resize();
    saveOval();
  }
});

// ---- WebGL context loss: unattended runs should recover, not hang -------
glCanvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  logError('Graphics context lost — reloading…');
  setTimeout(() => window.location.reload(), 1500);
});

// ---- Speech input -----------------------------------------------------
// Both the big center phrase and the history log only ever capture the
// live, in-progress transcript — never the finalized wording. History is
// streamed in per word as the interim transcript grows (only the words
// newly added since the last call are pushed); the final result itself
// adds nothing new, it just closes out whatever was already streamed.
// Real speech can occasionally revise or extend the wording right at
// finalization — that revision is deliberately not reflected here, since
// it was never shown live.
// The words already committed to history for the utterance in progress,
// and the volume each was captured at (same index). Diffed by
// longest-common-prefix against each new interim result rather than just
// a word count: Chrome's recognizer only ever appends to the transcript,
// but SpeechBridge's on-device recognizer revises its hypothesis as more
// audio arrives — the word count can shrink mid-utterance as earlier
// words get corrected. A count alone desyncs the moment that happens
// (every later slice() comes up empty against the new, shorter array)
// and silently drops the rest of the utterance's words until the
// transcript grows back past the old peak.
let spokenWords = [];
let spokenVolumes = [];
// Index into the current transcript where the phrase now on screen begins
// (see maxUtteranceWords) — 0 until a long utterance gets cut into chunks.
let chunkStart = 0;

// User MIDI notes fire as one settled sequence after the utterance ends,
// not live per word — since SpeechBridge's revising hypothesis means an
// interim word can still change, sending its note immediately risks
// playing notes for words that get corrected a moment later. History/text
// still update live; this only changes when the *notes* go out. Corpus
// notes are unaffected (monologue text can't revise itself, so there's
// nothing to wait out) — see the monologue onWord callback below.
//
// "After the utterance" is decided by the same speech-vs-silence grace
// timer that lets the corpus monologue resume (see RESUME_GRACE_MS below),
// not by isFinal: isFinal is reliable on the Chrome fallback (fires once
// per utterance) but SpeechBridge's on-device recognizer was observed
// over 20+ seconds of continuous speech, multiple sentences, never
// firing it even once — it just keeps revising one long-running
// hypothesis. flushUserNotes() is also still called on isFinal, so the
// Chrome path flushes promptly rather than waiting out the full grace
// window; calling it twice for the same utterance is harmless since the
// buffers are already empty the second time — in theory. In practice,
// SpeechBridge was observed delivering its last message for an utterance
// twice around finalization (likely the recognition task's completion
// handler firing again while being cancelled/torn down), so both the
// isFinal path and the grace-timer path really did each see a full,
// identical, non-empty buffer once. lastFlushed guards against firing
// the same word sequence twice in a short window; DUPLICATE_GUARD_MS is
// short enough that a genuine repeated sentence later still gets through.
const USER_NOTE_SPACING_MS = 120;
const DUPLICATE_GUARD_MS = 2000;
let lastFlushedKey = null;
let lastFlushedAt = 0;

function flushUserNotes() {
  const words = spokenWords;
  const volumes = spokenVolumes;
  spokenWords = [];
  spokenVolumes = [];
  chunkStart = 0;
  if (words.length === 0) return;

  const key = words.join('\n');
  const now = performance.now();
  if (key === lastFlushedKey && now - lastFlushedAt < DUPLICATE_GUARD_MS) return;
  lastFlushedKey = key;
  lastFlushedAt = now;

  words.forEach((word, i) => {
    setTimeout(() => {
      midiOutput.sendWordNote(word, 'user', Math.round(volumes[i] * 126) + 1);
    }, i * USER_NOTE_SPACING_MS);
  });
}

function onPhrase(text, isFinal) {
  const volume = micVolume.getNormalized(micFloorDb, micCeilDb);
  const words = text.trim().split(/\s+/).filter(Boolean);
  // A final result can carry a last word the partials never showed (e.g.
  // when SpeechBridge force-ends an utterance), so it's diffed like any
  // partial. An empty final must not wipe the words awaiting flush.
  if (words.length > 0) {
    if (chunkStart > words.length) chunkStart = words.length;
    // Words before chunkStart already belong to closed-out phrases, so a
    // late revision of them is ignored: only the current phrase's words are
    // compared against the previous transcript.
    let common = Math.min(chunkStart, spokenWords.length);
    while (common < spokenWords.length && common < words.length && spokenWords[common] === words[common]) {
      common++;
    }
    let cut = false;
    for (let idx = common; idx < words.length; idx++) {
      if (maxUtteranceWords > 0 && idx - chunkStart >= maxUtteranceWords) {
        // Word idx would be the phrase's (max+1)th — close out the current
        // phrase (period on its last word) and start a new one with it.
        historyLayer.endUtterance();
        chunkStart = idx;
        cut = true;
      }
      historyLayer.addWord(words[idx], { firstOfUtterance: idx === chunkStart, volume });
      spokenVolumes[idx] = volume;
    }
    spokenWords = words;
    if (cut) textLayer.finishUtterance();
    textLayer.setPhrase(words.slice(chunkStart).join(' '), { dim: false, volume });
  }
  if (isFinal) {
    flushUserNotes();
    historyLayer.endUtterance();
    textLayer.finishUtterance();
  }
}

// ---- Ongoing monologue (fills silence when no one is speaking) ----------
// Feeds stored placeholder text word by word, live: each word both streams
// into the history log (historyLayer.addWord) and, for now, replaces the
// big front phrase outright (textLayer.setPhrase(word) — just that one
// word, not the growing utterance) rather than building up a sentence
// there. Real speech always wins: any recognizer result pauses the
// monologue immediately, and it only resumes after a short grace period
// of continued silence.
const RESUME_GRACE_MS = 2500;
let userSpeaking = false;
let resumeTimer = null;

const monologue = new Monologue({
  mode: initialStyle.corpusMode,
  baseDelayMs: initialStyle.corpusBaseMs,
  amplitudeMs: initialStyle.corpusAmplitudeMs,
  frequencyHz: initialStyle.corpusFrequencyHz,
  onWord: (word, meta) => {
    historyLayer.addWord(word, { ...meta, source: 'corpus' });
    textLayer.setPhrase(word, { dim: true });
    midiOutput.sendWordNote(word, 'corpus', corpusVelocity);
  },
  onFinal: () => {
    historyLayer.endUtterance();
    textLayer.finishUtterance();
  },
});

function onSpeechResult(text, isFinal) {
  if (!userSpeaking) {
    userSpeaking = true;
    monologue.pause();
    // The monologue's words already streamed into history as they were
    // generated, so just punctuate the now-abandoned partial sentence
    // rather than leaving it trailing with no closing mark. The big
    // phrase, though, gets dismissed rather than shown as "finished" —
    // it was cut off, and the real transcript gets its own fresh
    // entrance instead of silently overwriting it in place.
    historyLayer.endUtterance();
    textLayer.finishUtterance();
  }
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => {
    userSpeaking = false;
    flushUserNotes();
    monologue.resume();
  }, RESUME_GRACE_MS);

  onPhrase(text, isFinal);
}

const recognizer = createSpeechRecognizer({
  onResult: onSpeechResult,
  onStateChange: setLive,
  onError: logError,
  onLevel: (db, gateOpen) => {
    gateReadoutEl.textContent = `${db.toFixed(1)}dB · ${gateOpen ? 'open' : 'closed'}`;
    gateReadoutEl.style.color = gateOpen ? '#6f6' : '';
  },
});
recognizer.setGate(initialStyle);

if (!recognizer.supported) {
  startBtn.disabled = true;
}

startBtn.addEventListener('click', () => {
  startOverlay.hidden = true;
  recognizer.start();
  monologue.start();
  // Camera is optional — if it's denied or absent, the video fill just
  // never kicks in and everything else runs exactly as before.
  startVideoInput();
  // Same for MIDI/mic-volume: if the IAC bus isn't there or the mic is
  // denied, word notes just stop firing rather than breaking anything else.
  midiOutput.connect('IAC').catch((e) => logError('MIDI unavailable: ' + e.message));
  micVolume.start().catch((e) => logError('Mic volume unavailable: ' + e.message));
});

// Manual text injection for tech rehearsal / tuning without a live mic:
// open the console and call __illuminate.setPhrase("some words") to show
// it as a live/in-progress transcript, then __illuminate.finish("some words")
// to finalize it (sends it to the history log, dismisses the big phrase).
// __illuminate.monologue is the running Monologue instance (.pause()/.resume()).
// __illuminate.midiOutput/.micVolume are the MIDI/mic-level instances —
// e.g. midiOutput.sendWordNote('hello', 'user', 100) to test a note by
// hand once an IAC bus is connected, without needing to actually speak.
window.__illuminate = {
  setPhrase: (text) => onPhrase(text, false),
  finish: (text) => onPhrase(text, true),
  monologue,
  midiOutput,
  micVolume,
  textLayer,
  historyLayer,
};
