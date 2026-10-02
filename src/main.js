import { createSpeechRecognizer } from './speech.js';
import { TextLayer } from './textLayer.js';
import { HistoryLayer } from './historyLayer.js';
import { Renderer } from './renderer.js';
import { Monologue } from './monologue.js';
import { VideoInput, MIRROR_VIDEOS, listCameraDevices } from './videoInput.js';
import { MidiOutput } from './midiOutput.js';
import { sendWordCC } from './textToCC.js';
import { MicVolumeMeter } from './micVolume.js';
import { MicPassthrough, listAudioOutputDevices } from './micPassthrough.js';

// ---- DOM --------------------------------------------------------------
const glCanvas = document.getElementById('gl');
const frameRingEl = document.getElementById('frameRing');
const frameInnerLineEl = document.getElementById('frameInnerLine');
const frameGhostEls = [...document.querySelectorAll('.frameGhost')];
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
const corpusAmplitudeControlEl = document.getElementById('corpusAmplitudeControl');
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
const styleCcCorpusEl = document.getElementById('styleCcCorpus');
const stylePassthroughEnabledEl = document.getElementById('stylePassthroughEnabled');
const stylePassthroughGatedEl = document.getElementById('stylePassthroughGated');
const stylePassthroughGainEl = document.getElementById('stylePassthroughGain');
const stylePassthroughGainVal = document.getElementById('stylePassthroughGainVal');
const stylePassthroughDeviceEl = document.getElementById('stylePassthroughDevice');

// Mirror clip options aren't hardcoded in index.html — added here from the
// single manifest in videoInput.js so there's one place that knows about them.
// Also doubles as the number-key shortcut order below (index 0 -> '1').
const VIDEO_SOURCE_ORDER = ['camera', ...MIRROR_VIDEOS.map((v) => v.id)];
for (const v of MIRROR_VIDEOS) {
  const opt = document.createElement('option');
  opt.value = v.id;
  opt.textContent = v.label;
  styleVideoSourceEl.appendChild(opt);
}

// Auto-rotates the video source (camera + mirror clips) on its own, so the
// piece keeps changing unattended. A random 30-60s timer doesn't switch
// immediately — it only arms a pending switch, carried out at the next
// utterance boundary (speech or corpus, wherever that falls) via
// checkAutoRotate() rather than cutting mid-sentence. Every 3rd switch is
// the camera; the other two of three pick a random mirror clip different
// from the one currently showing, so the change is always visible.
const AUTO_ROTATE_MIN_MS = 20000;
const AUTO_ROTATE_MAX_MS = 45000;
let autoRotateCount = 0;
let autoRotatePending = false;
let autoRotateTimer = null;

function scheduleAutoRotate() {
  clearTimeout(autoRotateTimer);
  const delay = AUTO_ROTATE_MIN_MS + Math.random() * (AUTO_ROTATE_MAX_MS - AUTO_ROTATE_MIN_MS);
  autoRotateTimer = setTimeout(() => { autoRotatePending = true; }, delay);
}

function checkAutoRotate() {
  if (!autoRotatePending) return;
  autoRotatePending = false;
  autoRotateCount++;
  let nextId;
  if (autoRotateCount % 3 === 0) {
    nextId = 'camera';
  } else {
    const others = MIRROR_VIDEOS.map((v) => v.id).filter((id) => id !== styleVideoSourceEl.value);
    nextId = others[Math.floor(Math.random() * others.length)];
  }
  styleVideoSourceEl.value = nextId;
  styleVideoSourceEl.dispatchEvent(new Event('input', { bubbles: true }));
  scheduleAutoRotate();
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
  ccCorpus: true,
  // SpeechBridge proximity gate: audio quieter than this never reaches the
  // recognizer, so only speech close to the mic gets transcribed. A pause
  // of utteranceEndMs after gated speech ends the utterance.
  gateOpenDb: -30, gateCloseDb: -40, utteranceEndMs: 800,
  // Live mic -> speaker passthrough, audible only while the proximity gate
  // above is open — see micPassthrough.js.
  passthroughEnabled: false, passthroughGated: false, passthroughGain: 1, passthroughDeviceId: '',
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
const micPassthrough = new MicPassthrough();
micPassthrough.setGated(initialStyle.passthroughGated);
micPassthrough.setVolume(initialStyle.passthroughGain);
let started = false; // true once the start overlay has been clicked

// Only (re)applies once the show has actually started — mic/camera/MIDI
// access is deliberately deferred to the Start click everywhere else in
// this file, and passthrough follows the same rule rather than opening a
// mic stream the moment the panel checkbox is toggled pre-start.
function setPassthroughEnabled(enabled) {
  if (!started) return;
  if (enabled) {
    if (micPassthrough.state === 'off') {
      micPassthrough.start()
        .then(() => {
          // Labels are blank until a getUserMedia permission has been
          // granted — this start is the first chance to show real ones.
          refreshPassthroughDevices();
          micPassthrough.setOutputDevice(stylePassthroughDeviceEl.value);
        })
        .catch((e) => logError('Passthrough unavailable: ' + e.message));
    }
  } else {
    micPassthrough.stop();
  }
}

// Mirrors refreshCameraDevices below — device labels are blank until some
// getUserMedia permission has been granted, so the first real population
// happens after Start.
async function refreshPassthroughDevices(preferredValue = stylePassthroughDeviceEl.value) {
  const outputs = await listAudioOutputDevices();
  stylePassthroughDeviceEl.innerHTML = '<option value="">Default</option>';
  outputs.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Output ${i + 1}`;
    stylePassthroughDeviceEl.appendChild(opt);
  });
  const stillExists = [...stylePassthroughDeviceEl.options].some((o) => o.value === preferredValue);
  stylePassthroughDeviceEl.value = stillExists ? preferredValue : '';
}
refreshPassthroughDevices(initialStyle.passthroughDeviceId);
navigator.mediaDevices?.addEventListener?.('devicechange', () => refreshPassthroughDevices());
let corpusVelocity = initialStyle.corpusVelocity;
let micFloorDb = initialStyle.micFloorDb;
let micCeilDb = initialStyle.micCeilDb;
let maxUtteranceWords = initialStyle.maxUtteranceWords;
let ccCorpus = initialStyle.ccCorpus;

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
  corpusAmplitudeControlEl.hidden = style.corpusMode === 'linear';
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
  stylePassthroughEnabledEl.checked = style.passthroughEnabled;
  styleCcCorpusEl.checked = style.ccCorpus;
  stylePassthroughGatedEl.checked = style.passthroughGated;
  stylePassthroughGainEl.value = style.passthroughGain;
  stylePassthroughGainVal.textContent = `${style.passthroughGain.toFixed(1)}x`;
  stylePassthroughDeviceEl.value = style.passthroughDeviceId;
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
    passthroughEnabled: stylePassthroughEnabledEl.checked,
    passthroughGated: stylePassthroughGatedEl.checked,
    passthroughGain: Number(stylePassthroughGainEl.value),
    passthroughDeviceId: stylePassthroughDeviceEl.value,
    ccCorpus: styleCcCorpusEl.checked,
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
  corpusAmplitudeControlEl.hidden = style.corpusMode === 'linear';
  styleVideoInfluenceVal.textContent = `${Math.round(style.videoInfluence * 100)}%`;
  styleVideoGainVal.textContent = `${style.videoGain.toFixed(1)}x`;
  videoInfluence = style.videoInfluence;
  videoGain = style.videoGain;
  styleCorpusVelocityVal.textContent = style.corpusVelocity;
  styleMicFloorVal.textContent = `${style.micFloorDb}dB`;
  styleMicCeilVal.textContent = `${style.micCeilDb}dB`;
  corpusVelocity = style.corpusVelocity;
  micFloorDb = style.micFloorDb;
  ccCorpus = style.ccCorpus;
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
  stylePassthroughGainVal.textContent = `${style.passthroughGain.toFixed(1)}x`;
  setPassthroughEnabled(style.passthroughEnabled);
  micPassthrough.setGated(style.passthroughGated);
  micPassthrough.setVolume(style.passthroughGain);
  if (micPassthrough.state === 'live') micPassthrough.setOutputDevice(style.passthroughDeviceId);
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
  stylePassthroughEnabledEl, stylePassthroughGatedEl, stylePassthroughGainEl, stylePassthroughDeviceEl,
  styleCcCorpusEl,
].forEach((el) => {
  el.addEventListener('input', onStyleInput);
});

// ---- Resize -------------------------------------------------------------
// Frame crop: when on, the canvas (text + history layers, the whole piece)
// is cropped to an adjustable rectangle instead of filling the viewport,
// replacing what used to be a static picture-frame image — this is the
// same crop-and-react behavior the oval version used, just rectangular.
// The box is sized to fit the viewport at frameAspect (width / height),
// then scaled/nudged from there. Persisted across reloads (unlike
// frameEnabled itself, or the 'd'/'p' toggles) since dialing this in is
// real physical setup work for a specific room/projector; reset with
// Backspace/Delete.
//
// Outline: a thin, crisp ring hugging the crop that, as the overall mic
// level rises (all sound in the room, not just speech past the proximity
// gate), gets more saturated and thicker, then eases back down. Widths are
// in px. The level uses the mic ceiling shared with MIDI velocity, but
// starts RING_FLOOR_OFFSET_DB above the shared mic floor, so room noise
// below that leaves the ring untouched and only real sound moves it.
//
// Its resting color is the average color of the background video (whichever
// source is playing — a mirror clip or the camera), or white when there's no
// video. When loud it heads to a vivid, saturated version of that same hue.
const RING_REST = { width: 5 };
const RING_LOUD = { sat: 100, light: 54, width: 16 };
const RING_FALLBACK_HUE = 205; // hue to saturate toward when the base color is white/gray
const RING_MIN_LIGHT = 55;     // a dark video's average is lifted to this, or the ring would vanish on black
const RING_GRAY_SAT = 6;       // below this saturation the base has no meaningful hue
const RING_COLOR_TAU_MS = 700; // how slowly the base color follows the video
const RING_SAMPLE_MS = 120;
const RING_FLOOR_OFFSET_DB = 10;
// The effect is scaled by who's currently "speaking" on the display: while a
// user utterance is in progress it never drops below RING_USER_BASELINE (so
// the ring is visibly alive during speech even if the room is quiet), and
// while the corpus monologue is running it's scaled down by
// RING_CORPUS_GAIN so the piece's own output stirs it less.
const RING_USER_BASELINE = 0.35;
const RING_CORPUS_GAIN = 0.85;
const RING_ATTACK_MS = 60;
const RING_RELEASE_MS = 500;
let ringLevel = 0;

// Inset of the thin inner line from the main ring's own box, in px.
const FRAME_INNER_LINE_GAP_PX = 12;

// Ghost rings: fainter, thinner copies of the outline, each jumping to its own
// new random offset every few tenths of a second (a fresh random direction,
// eased into), further off-center and more visible the louder it gets, and
// invisible at rest. Each ghost has its own reach and peak opacity, so the
// second sits farther out and fainter than the first (one entry per element
// in the page).
const GHOSTS = [
  { maxOffsetPx: 42, maxAlpha: 0.8 },
  { maxOffsetPx: 68, maxAlpha: 0.6 },
].map((g, i) => ({ ...g, el: frameGhostEls[i], dirX: 0, dirY: 0, nextJumpT: 0, x: 0, y: 0 }));
const GHOST_WIDTH_PX = 3;
const GHOST_JUMP_MIN_MS = 70;
const GHOST_JUMP_MAX_MS = 210;
const GHOST_FOLLOW_MS = 60;
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

const FRAME_FILL = 0.92; // fraction of the best-fit box the crop occupies at scale 1
let frameEnabled = false;

const FRAME_CROP_STORAGE_KEY = 'illuminate:frameCrop';
// frameAspect default matches the old bitmap frame's own content window
// (the fraction of the frame image the canvas actually showed through, not
// the frame image's own outer aspect) — 0.304/0.655 of a 1366x768 image.
const DEFAULT_FRAME_CROP = { frameOffsetX: 0, frameOffsetY: 0, frameScale: 1, frameAspect: (0.304 / 0.655) * (1366 / 768) };

function loadFrameCrop() {
  try {
    const saved = JSON.parse(localStorage.getItem(FRAME_CROP_STORAGE_KEY));
    return { ...DEFAULT_FRAME_CROP, ...saved };
  } catch (e) {
    return { ...DEFAULT_FRAME_CROP };
  }
}

function saveFrameCrop() {
  try {
    localStorage.setItem(FRAME_CROP_STORAGE_KEY, JSON.stringify({ frameOffsetX, frameOffsetY, frameScale, frameAspect }));
  } catch (e) { /* storage unavailable */ }
}

let { frameOffsetX, frameOffsetY, frameScale, frameAspect } = loadFrameCrop();

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let boxW = window.innerWidth;
  let boxH = window.innerHeight;

  if (frameEnabled) {
    // Largest box of frameAspect that fits the viewport, shrunk a little,
    // then scaled from its center before the offset shifts it — so scaling
    // and nudging compose the same way regardless of order.
    const fit = Math.min(window.innerHeight, window.innerWidth / frameAspect) * FRAME_FILL * frameScale;
    boxH = fit;
    boxW = fit * frameAspect;
    const left = (window.innerWidth - boxW) / 2 + frameOffsetX;
    const top = (window.innerHeight - boxH) / 2 + frameOffsetY;
    glCanvas.style.left = `${left}px`;
    glCanvas.style.top = `${top}px`;
    glCanvas.style.right = 'auto';
    glCanvas.style.bottom = 'auto';
    frameRingEl.style.left = `${left}px`;
    frameRingEl.style.top = `${top}px`;
    frameRingEl.style.width = `${boxW}px`;
    frameRingEl.style.height = `${boxH}px`;
    frameRingEl.hidden = false;
    frameInnerLineEl.style.left = `${left + FRAME_INNER_LINE_GAP_PX}px`;
    frameInnerLineEl.style.top = `${top + FRAME_INNER_LINE_GAP_PX}px`;
    frameInnerLineEl.style.width = `${Math.max(0, boxW - FRAME_INNER_LINE_GAP_PX * 2)}px`;
    frameInnerLineEl.style.height = `${Math.max(0, boxH - FRAME_INNER_LINE_GAP_PX * 2)}px`;
    frameInnerLineEl.hidden = false;
    for (const ghost of GHOSTS) {
      ghost.el.style.left = `${left}px`;
      ghost.el.style.top = `${top}px`;
      ghost.el.style.width = `${boxW}px`;
      ghost.el.style.height = `${boxH}px`;
      ghost.el.hidden = false;
    }
  } else {
    // Falls back to the plain inset:0 rule in index.html — full viewport,
    // exactly the pre-frame-feature behavior.
    glCanvas.style.left = '';
    glCanvas.style.top = '';
    glCanvas.style.right = '';
    glCanvas.style.bottom = '';
    frameRingEl.hidden = true;
    frameInnerLineEl.hidden = true;
    for (const ghost of GHOSTS) ghost.el.hidden = true;
  }

  const w = Math.round(boxW * dpr);
  const h = Math.round(boxH * dpr);
  glCanvas.style.width = boxW + 'px';
  glCanvas.style.height = boxH + 'px';
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
  if (frameEnabled) {
    const micLevel = micVolume.getNormalized(Math.min(micFloorDb + RING_FLOOR_OFFSET_DB, micCeilDb - 3), micCeilDb);
    const target = userSpeaking ? Math.max(micLevel, RING_USER_BASELINE) : micLevel * RING_CORPUS_GAIN;
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
    const ringColorCss = `hsl(${hue.toFixed(1)} ${sat.toFixed(1)}% ${light.toFixed(1)}%)`;
    frameRingEl.style.setProperty('--ring-color', ringColorCss);
    frameInnerLineEl.style.setProperty('--ring-color', ringColorCss);
    const width = RING_REST.width + (RING_LOUD.width - RING_REST.width) * ringLevel;
    frameRingEl.style.setProperty('--ring-spread', `${width.toFixed(2)}px`);

    const ghostFollow = 1 - Math.exp(-dtMs / GHOST_FOLLOW_MS);
    for (const ghost of GHOSTS) {
      if (t >= ghost.nextJumpT) {
        const angle = Math.random() * Math.PI * 2;
        const reach = 0.4 + Math.random() * 0.6;
        ghost.dirX = Math.cos(angle) * reach;
        ghost.dirY = Math.sin(angle) * reach;
        ghost.nextJumpT = t + GHOST_JUMP_MIN_MS + Math.random() * (GHOST_JUMP_MAX_MS - GHOST_JUMP_MIN_MS);
      }
      ghost.x += (ghost.dirX * ghost.maxOffsetPx * ringLevel - ghost.x) * ghostFollow;
      ghost.y += (ghost.dirY * ghost.maxOffsetPx * ringLevel - ghost.y) * ghostFollow;
      ghost.el.style.transform = `translate(${ghost.x.toFixed(2)}px, ${ghost.y.toFixed(2)}px)`;
      ghost.el.style.opacity = (ghost.maxAlpha * ringLevel).toFixed(3);
      ghost.el.style.setProperty('--ring-color', ringColorCss);
      ghost.el.style.setProperty('--ghost-width', `${GHOST_WIDTH_PX}px`);
    }
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
      `frame ${frameEnabled ? 'on' : 'off'} (f to toggle)  offset ${frameOffsetX}, ${frameOffsetY} (arrows)  scale ${Math.round(frameScale * 100)}% (+/-)  aspect ${frameAspect.toFixed(2)} w/h (shift +/-)  [backspace to reset]`;
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
    frameEnabled = !frameEnabled;
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
  } else if (frameEnabled && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    // Fine position nudge — only live while the frame is actually showing,
    // so plain arrow keys stay free otherwise.
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    const step = 1;
    frameOffsetX += e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    frameOffsetY += e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    resize();
    saveFrameCrop();
    e.preventDefault();
  } else if (frameEnabled && (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_')) {
    // '=' is included alongside '+' since that's the unshifted key that
    // types '+' on a standard layout, likewise '_' alongside '-'. Shift
    // (checked via e.shiftKey, so numpad '+' works too) changes the frame's
    // shape (width relative to height) instead of its size.
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    const grow = e.key === '+' || e.key === '=';
    if (e.shiftKey) {
      frameAspect = Math.max(0.2, Math.min(5, frameAspect + (grow ? 0.02 : -0.02)));
    } else {
      frameScale = Math.max(0.1, Math.min(5, frameScale + (grow ? 0.02 : -0.02)));
    }
    resize();
    saveFrameCrop();
    e.preventDefault();
  } else if (frameEnabled && (e.key === 'Backspace' || e.key === 'Delete')) {
    frameOffsetX = DEFAULT_FRAME_CROP.frameOffsetX;
    frameOffsetY = DEFAULT_FRAME_CROP.frameOffsetY;
    frameScale = DEFAULT_FRAME_CROP.frameScale;
    frameAspect = DEFAULT_FRAME_CROP.frameAspect;
    resize();
    saveFrameCrop();
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
      sendWordCC(midiOutput, word);
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
    if (cut) {
      textLayer.finishUtterance();
      checkAutoRotate();
    }
    textLayer.setPhrase(words.slice(chunkStart).join(' '), { dim: false, volume });
  }
  if (isFinal) {
    flushUserNotes();
    historyLayer.endUtterance();
    textLayer.finishUtterance();
    checkAutoRotate();
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
    if (ccCorpus) sendWordCC(midiOutput, word);
  },
  onFinal: () => {
    historyLayer.endUtterance();
    textLayer.finishUtterance();
    checkAutoRotate();
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
    // The exact same signal driving the readout above also feeds the
    // passthrough gate — only applied when "Gated" is checked (see
    // micPassthrough.setGated), otherwise passthrough ignores it and plays
    // continuously.
    micPassthrough.setGateOpen(gateOpen);
  },
});
recognizer.setGate(initialStyle);

if (!recognizer.supported) {
  startBtn.disabled = true;
}

startBtn.addEventListener('click', () => {
  startOverlay.hidden = true;
  started = true;
  recognizer.start();
  monologue.start();
  scheduleAutoRotate();
  // Camera is optional — if it's denied or absent, the video fill just
  // never kicks in and everything else runs exactly as before.
  startVideoInput();
  // Same for MIDI/mic-volume: if the IAC bus isn't there or the mic is
  // denied, word notes just stop firing rather than breaking anything else.
  midiOutput.connect('IAC').catch((e) => logError('MIDI unavailable: ' + e.message));
  micVolume.start().catch((e) => logError('Mic volume unavailable: ' + e.message));
  setPassthroughEnabled(stylePassthroughEnabledEl.checked);
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
  micPassthrough,
  textLayer,
  historyLayer,
  // Lets a rehearsal force the next auto video-rotation right now instead
  // of waiting out the random 30-60s timer: __illuminate.autoRotate.forcePending()
  // arms it, same as the real timer would, for checkAutoRotate() to pick up
  // at the next utterance boundary.
  autoRotate: {
    get count() { return autoRotateCount; },
    forcePending: () => { autoRotatePending = true; },
    check: checkAutoRotate,
  },
};
