// Speech capture, wrapped for unattended, long-running operation, with two
// backends behind one interface ({ supported, start(), stop() }):
//
//  1. SpeechBridge (native/SpeechBridge) — a local macOS helper doing
//     continuous on-device recognition, streamed in over Server-Sent
//     Events on http://127.0.0.1:8765/. Fully offline. Tried first.
//  2. The browser's own Web Speech API (webkitSpeechRecognition) — Chrome
//     only, and actually cloud-backed (it sends audio to Google's speech
//     servers), so it needs internet despite living in the browser. Used
//     only when the native bridge isn't reachable.
//
// Either way, main.js just gets (word, isFinal) callbacks and never knows
// which backend produced them.

const NATIVE_BRIDGE_URL = 'http://127.0.0.1:8765/';
const NATIVE_CONNECT_TIMEOUT_MS = 1000;

function sendNativeGate(gate) {
  if (!gate) return;
  const url = `${NATIVE_BRIDGE_URL}gate?open=${gate.openDb}&close=${gate.closeDb}&end=${gate.utteranceEndMs}`;
  fetch(url, { mode: 'no-cors' }).catch(() => { /* resent on the next (re)connect */ });
}

// Resolves to a { stop() } once connected, or null if the helper isn't
// reachable within the timeout — the caller falls back to the browser
// recognizer in that case.
function tryNativeBridge({ onResult, onStateChange, onLevel, getGate }) {
  return new Promise((resolve) => {
    let settled = false;
    const es = new EventSource(NATIVE_BRIDGE_URL);

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      es.close();
      resolve(null);
    }, NATIVE_CONNECT_TIMEOUT_MS);

    es.onopen = () => {
      // Every (re)connect, not just the first: if SpeechBridge restarts
      // mid-show it comes back with its built-in defaults.
      sendNativeGate(getGate());
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      onStateChange(true);
      resolve({
        stop() {
          es.close();
          onStateChange(false);
        },
      });
    };
    // EventSource retries transient drops on its own; but if the connection
    // was never established in the first place, onerror fires without ever
    // reaching onopen — that's "the helper isn't running," not a retry-able hiccup.
    es.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      es.close();
      resolve(null);
    };
    es.onmessage = (e) => {
      try {
        const { transcript, isFinal } = JSON.parse(e.data);
        onResult(transcript, isFinal);
      } catch (err) { /* malformed message, drop it */ }
    };
    es.addEventListener('state', (e) => {
      try {
        onStateChange(JSON.parse(e.data).state === 'listening');
      } catch (err) { /* ignore */ }
    });
    es.addEventListener('level', (e) => {
      try {
        const { db, gateOpen } = JSON.parse(e.data);
        onLevel?.(db, gateOpen);
      } catch (err) { /* ignore */ }
    });
  });
}

function createBrowserSpeechRecognizer({ onResult, onStateChange, onError }) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    return { start: () => {}, stop: () => {}, supported: false };
  }

  let recognition = null;
  let intentionalStop = false;
  // Set right before a restart triggered by a real error (not 'no-speech')
  // so onend can slow down instead of immediately retrying — without this,
  // an error that fires on every single start() attempt (e.g. no internet,
  // since this backend is actually cloud-backed) becomes a tight synchronous
  // restart loop that pins the tab.
  let backoffMs = 0;

  function attach() {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      backoffMs = 0;
      onStateChange(true);
    };
    recognition.onend = () => {
      onStateChange(false);
      if (intentionalStop) return;
      setTimeout(() => {
        try { recognition.start(); } catch (e) { /* already starting */ }
      }, backoffMs);
    };
    recognition.onerror = (e) => {
      // 'no-speech' fires constantly in quiet rooms and is not a real error —
      // onend follows and the restart above takes care of it, immediately.
      if (e.error === 'no-speech') return;
      backoffMs = 2000;
      onError('Mic error: ' + e.error);
    };
    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      onResult(result[0].transcript, result.isFinal);
    };
  }

  return {
    supported: true,
    start() {
      intentionalStop = false;
      backoffMs = 0;
      attach();
      recognition.start();
    },
    stop() {
      intentionalStop = true;
      if (recognition) recognition.stop();
    },
  };
}

export function createSpeechRecognizer({ onResult, onStateChange, onError, onLevel }) {
  let active = null;
  let backend = null;
  let intentionalStop = false;
  let gate = null;

  async function begin() {
    intentionalStop = false;
    const native = await tryNativeBridge({ onResult, onStateChange, onLevel, getGate: () => gate });
    if (intentionalStop) {
      if (native) native.stop();
      return;
    }
    if (native) {
      active = native;
      backend = 'native';
      return;
    }
    const browser = createBrowserSpeechRecognizer({ onResult, onStateChange, onError });
    if (!browser.supported) {
      onError('Speech recognition unavailable — no local SpeechBridge helper running, and this browser has no built-in speech recognition (use Chrome, or start native/SpeechBridge).');
      return;
    }
    active = browser;
    backend = 'browser';
    browser.start();
  }

  return {
    // Whether *something* can be tried is only knowable once start() has
    // actually attempted the native bridge — so this stays true, and a
    // real failure surfaces via onError instead of gating the button.
    supported: true,
    // null until start() has picked one; 'native' (SpeechBridge) or 'browser'.
    get backend() { return backend; },
    // Proximity gate thresholds and the pause that ends an utterance — only
    // SpeechBridge can apply them; the browser recognizer captures its own
    // mic audio internally.
    setGate({ gateOpenDb, gateCloseDb, utteranceEndMs }) {
      gate = { openDb: gateOpenDb, closeDb: gateCloseDb, utteranceEndMs };
      if (backend === 'native') sendNativeGate(gate);
    },
    start() { begin(); },
    stop() {
      intentionalStop = true;
      if (active) active.stop();
    },
  };
}
