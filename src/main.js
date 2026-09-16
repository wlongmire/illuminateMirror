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
const frameOverlayEl = document.getElementById('frameOverlay');
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
  corpusMode: 'sine', corpusBaseMs: 300, corpusAmplitudeMs: 150, corpusFrequencyHz: 0.2,
  videoSource: 'camera', cameraDeviceId: '', videoInfluence: 0, videoGain: 1,
  corpusAlpha: 1, userAlpha: 0.65,
  userWordSizeScale: 0.8, volumeSizeBoost: 2,
  // MIDI: user-note velocity comes from live mic level (calibrated by the
  // floor/ceiling dB range below); corpus notes use a fixed velocity.
  corpusVelocity: 90, micFloorDb: -50, micCeilDb: -12,
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
  };
  styleWeightVal.textContent = style.fontWeight;
  styleSizeVal.textContent = `${Math.round(style.sizeScale * 100)}%`;
  styleUserSizeVal.textContent = `${Math.round(style.userSizeScale * 100)}%`;
  styleUserVolumeBoostVal.textContent = `${Math.round(style.userVolumeBoost * 100)}%`;
  styleSpacingVal.textContent = `${style.letterSpacing}px`;
  styleTransitionVal.textContent = `${(style.transitionMs / 1000).toFixed(1)}s`;
  styleHoldVal.textContent = `${(style.holdMs / 1000).toFixed(1)}s`;
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
  styleTransitionEl, styleHoldEl, styleCorpusModeEl, styleCorpusBaseEl,
  styleCorpusAmplitudeEl, styleCorpusFrequencyEl,
  styleVideoSourceEl, styleCameraDeviceEl, styleVideoInfluenceEl, styleVideoGainEl,
  styleCorpusAlphaEl, styleUserAlphaEl, styleUserWordSizeEl, styleVolumeBoostEl,
  styleCorpusVelocityEl, styleMicFloorEl, styleMicCeilEl,
].forEach((el) => {
  el.addEventListener('input', onStyleInput);
});

// ---- Resize -------------------------------------------------------------
// Frame overlay: a decorative picture-frame image (public/images/frame.png)
// that can be toggled on to letterbox the whole piece inside its inner
// window. FRAME_WINDOW is that window's box as a fraction of the frame
// image's own 1366x768 canvas — measured directly off the PNG's alpha
// channel (where the hand-drawn inner border sits), with a small inward
// margin so content sits just inside the line rather than touching it.
const FRAME_ASPECT = 1366 / 768;
const FRAME_WINDOW = { left: 0.332, top: 0.190, width: 0.304, height: 0.655 };
let frameEnabled = false;

// Fine-tune nudge/scale for the whole framed composition (frame image +
// canvas together, so they stay in registration — arrow keys and +/-,
// frame mode only) and, separately, for just the canvas (text/history
// layers) relative to the frame image (shift+arrows/shift+plus-minus) —
// for aligning content inside the frame's window independently of the
// frame's own position/size. Persisted across reloads (unlike frameEnabled
// itself, or the 'd'/'p' toggles) since dialing these in is real physical
// setup work for a specific room/projector that shouldn't be lost on a
// refresh; reset with Backspace/Delete.
const FRAME_ADJUST_STORAGE_KEY = 'illuminate:frameAdjust';
const DEFAULT_FRAME_ADJUST = {
  frameOffsetX: 0, frameOffsetY: 0, frameScale: 1,
  contentOffsetX: 0, contentOffsetY: 0, contentScale: 1,
};

function loadFrameAdjust() {
  try {
    const saved = JSON.parse(localStorage.getItem(FRAME_ADJUST_STORAGE_KEY));
    return { ...DEFAULT_FRAME_ADJUST, ...saved };
  } catch (e) {
    return { ...DEFAULT_FRAME_ADJUST };
  }
}

function saveFrameAdjust() {
  try {
    localStorage.setItem(FRAME_ADJUST_STORAGE_KEY, JSON.stringify({
      frameOffsetX, frameOffsetY, frameScale, contentOffsetX, contentOffsetY, contentScale,
    }));
  } catch (e) { /* storage unavailable */ }
}

const initialFrameAdjust = loadFrameAdjust();
let { frameOffsetX, frameOffsetY, frameScale, contentOffsetX, contentOffsetY, contentScale } = initialFrameAdjust;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let boxW = window.innerWidth;
  let boxH = window.innerHeight;

  if (frameEnabled) {
    // Largest frame-image-shaped box that fits the viewport (same math as
    // CSS object-fit: contain), centered — the piece then only occupies
    // the window cut into that box, same fraction regardless of size.
    // frameScale then scales that best-fit box up or down from center,
    // before the offset shifts it — so scaling and nudging compose the
    // way you'd expect regardless of which was adjusted more recently.
    const viewportAspect = window.innerWidth / window.innerHeight;
    const stageW = (viewportAspect > FRAME_ASPECT ? window.innerHeight * FRAME_ASPECT : window.innerWidth) * frameScale;
    const stageH = (viewportAspect > FRAME_ASPECT ? window.innerHeight : window.innerWidth / FRAME_ASPECT) * frameScale;
    const stageLeft = (window.innerWidth - stageW) / 2 + frameOffsetX;
    const stageTop = (window.innerHeight - stageH) / 2 + frameOffsetY;

    frameOverlayEl.style.left = `${stageLeft}px`;
    frameOverlayEl.style.top = `${stageTop}px`;
    frameOverlayEl.style.width = `${stageW}px`;
    frameOverlayEl.style.height = `${stageH}px`;

    // contentScale scales the canvas from the center of the window (same
    // pattern as frameScale on the stage), so it grows/shrinks in place
    // before contentOffset shifts it.
    const windowW = FRAME_WINDOW.width * stageW;
    const windowH = FRAME_WINDOW.height * stageH;
    boxW = windowW * contentScale;
    boxH = windowH * contentScale;
    const windowLeft = stageLeft + FRAME_WINDOW.left * stageW;
    const windowTop = stageTop + FRAME_WINDOW.top * stageH;
    glCanvas.style.left = `${windowLeft - (boxW - windowW) / 2 + contentOffsetX}px`;
    glCanvas.style.top = `${windowTop - (boxH - windowH) / 2 + contentOffsetY}px`;
    glCanvas.style.right = 'auto';
    glCanvas.style.bottom = 'auto';
  } else {
    // Falls back to the plain inset:0 rule in index.html — full viewport,
    // exactly the pre-frame-feature behavior.
    glCanvas.style.left = '';
    glCanvas.style.top = '';
    glCanvas.style.right = '';
    glCanvas.style.bottom = '';
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

function frame(t) {
  const dtMs = Math.min(100, t - lastT); // clamp to avoid huge jumps on tab-back
  lastT = t;

  textLayer.update(dtMs);
  historyLayer.update(dtMs);
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
      `frame ${frameEnabled ? 'on' : 'off'} (f to toggle)  offset ${frameOffsetX}, ${frameOffsetY} (arrows)  scale ${Math.round(frameScale * 100)}% (+/-)\n` +
      `content offset ${contentOffsetX}, ${contentOffsetY} (shift+arrows)  scale ${Math.round(contentScale * 100)}% (shift +/-)  [backspace to reset all]`;
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
    frameOverlayEl.hidden = !frameEnabled;
    resize();
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
    // so plain arrow keys are free to do nothing (or whatever a focused
    // control wants) otherwise. Shift moves just the canvas (text/history
    // layers) relative to the frame image instead of the whole composition.
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    const step = 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    if (e.shiftKey) {
      contentOffsetX += dx;
      contentOffsetY += dy;
    } else {
      frameOffsetX += dx;
      frameOffsetY += dy;
    }
    resize();
    saveFrameAdjust();
    e.preventDefault();
  } else if (frameEnabled && (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_')) {
    // Fine scale nudge — '=' is included alongside '+' since that's the
    // unshifted key that types '+' on a standard layout, and likewise '_'
    // alongside '-'. Shift here picks the target the same way it does for
    // the arrow keys above: content (canvas) instead of the whole frame.
    // Checked via e.shiftKey rather than e.key so it still works if '+'
    // itself doesn't require shift on a given keyboard (e.g. numpad).
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    const scaleStep = 0.02;
    const grow = e.key === '+' || e.key === '=';
    const delta = grow ? scaleStep : -scaleStep;
    if (e.shiftKey) {
      contentScale = Math.max(0.1, Math.min(5, contentScale + delta));
    } else {
      frameScale = Math.max(0.1, Math.min(5, frameScale + delta));
    }
    resize();
    saveFrameAdjust();
    e.preventDefault();
  } else if (frameEnabled && (e.key === 'Backspace' || e.key === 'Delete')) {
    frameOffsetX = 0;
    frameOffsetY = 0;
    frameScale = 1;
    contentOffsetX = 0;
    contentOffsetY = 0;
    contentScale = 1;
    resize();
    saveFrameAdjust();
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
  if (isFinal) {
    flushUserNotes();
    historyLayer.endUtterance();
    textLayer.finishUtterance();
  } else {
    const volume = micVolume.getNormalized(micFloorDb, micCeilDb);
    const words = text.trim().split(/\s+/).filter(Boolean);
    let common = 0;
    while (common < spokenWords.length && common < words.length && spokenWords[common] === words[common]) {
      common++;
    }
    words.slice(common).forEach((word, i) => {
      historyLayer.addWord(word, { firstOfUtterance: common === 0 && i === 0, volume });
      spokenVolumes[common + i] = volume;
    });
    spokenWords = words;
    textLayer.setPhrase(text, { dim: false, volume });
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
});

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
};
