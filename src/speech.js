// Web Speech API capture, wrapped for unattended, long-running operation.
// Chrome (and Chromium-based browsers) stop the recognizer periodically even
// in `continuous` mode — this restarts it automatically so a show can run
// for hours without a human in the loop.

export function createSpeechRecognizer({ onResult, onStateChange, onError }) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    onError('Speech recognition isn\'t supported in this browser — use Chrome.');
    return { start: () => {}, stop: () => {}, supported: false };
  }

  let recognition = null;
  let intentionalStop = false;

  function attach() {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => onStateChange(true);
    recognition.onend = () => {
      onStateChange(false);
      if (!intentionalStop) {
        try { recognition.start(); } catch (e) { /* already starting */ }
      }
    };
    recognition.onerror = (e) => {
      // 'no-speech' fires constantly in quiet rooms and is not a real error —
      // onend follows and the restart above takes care of it.
      if (e.error !== 'no-speech') onError('Mic error: ' + e.error);
    };
    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      if (result.isFinal) onResult(result[0].transcript);
    };
  }

  return {
    supported: true,
    start() {
      intentionalStop = false;
      attach();
      recognition.start();
    },
    stop() {
      intentionalStop = true;
      if (recognition) recognition.stop();
    },
  };
}
