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
// Also doubles as the cycling order for the left/right-arrow shortcut below.
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

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let boxW = window.innerWidth;
  let boxH = window.innerHeight;

  if (frameEnabled) {
    // Largest frame-image-shaped box that fits the viewport (same math as
    // CSS object-fit: contain), centered — the piece then only occupies
    // the window cut into that box, same fraction regardless of size.
    const viewportAspect = window.innerWidth / window.innerHeight;
    const stageW = viewportAspect > FRAME_ASPECT ? window.innerHeight * FRAME_ASPECT : window.innerWidth;
    const stageH = viewportAspect > FRAME_ASPECT ? window.innerHeight : window.innerWidth / FRAME_ASPECT;
    const stageLeft = (window.innerWidth - stageW) / 2;
    const stageTop = (window.innerHeight - stageH) / 2;

    frameOverlayEl.style.left = `${stageLeft}px`;
    frameOverlayEl.style.top = `${stageTop}px`;
    frameOverlayEl.style.width = `${stageW}px`;
    frameOverlayEl.style.height = `${stageH}px`;

    boxW = FRAME_WINDOW.width * stageW;
    boxH = FRAME_WINDOW.height * stageH;
    glCanvas.style.left = `${stageLeft + FRAME_WINDOW.left * stageW}px`;
    glCanvas.style.top = `${stageTop + FRAME_WINDOW.top * stageH}px`;
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
      `frame ${frameEnabled ? 'on' : 'off'} (f to toggle)`;
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
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    // Ignore while a form control has focus — its own arrow-key behavior
    // (moving a select, nudging a range slider) should win instead.
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    const order = VIDEO_SOURCE_ORDER;
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    const idx = order.indexOf(styleVideoSourceEl.value);
    const next = order[(idx + delta + order.length) % order.length];
    styleVideoSourceEl.value = next;
    styleVideoSourceEl.dispatchEvent(new Event('input', { bubbles: true }));
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
let spokenWordCount = 0;

function onPhrase(text, isFinal) {
  if (isFinal) {
    historyLayer.endUtterance();
    textLayer.finishUtterance();
    spokenWordCount = 0;
  } else {
    const volume = micVolume.getNormalized(micFloorDb, micCeilDb);
    const words = text.trim().split(/\s+/).filter(Boolean);
    words.slice(spokenWordCount).forEach((word, i) => {
      historyLayer.addWord(word, { firstOfUtterance: spokenWordCount === 0 && i === 0, volume });
      midiOutput.sendWordNote(word, 'user', Math.round(volume * 126) + 1);
    });
    spokenWordCount = words.length;
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
