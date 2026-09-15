// Continuously tracks the live mic input level, purely to drive MIDI note
// velocity for user speech (see midiOutput.js) — the Web Speech API gives
// no volume/amplitude data of its own, so this opens a second, independent
// getUserMedia(audio) stream and runs it through an AnalyserNode. Nothing
// here is recorded or stored; it's just an instantaneous, smoothed
// loudness reading.

export class MicVolumeMeter {
  constructor() {
    this.audioCtx = null;
    this.analyser = null;
    this.dataArray = null;
    this.stream = null;
    this.level = 0; // smoothed RMS, roughly 0..1
    this.rafId = null;
    this.state = 'off'; // off | starting | live | error
    this.error = null;
  }

  async start() {
    this.state = 'starting';
    this.error = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('getUserMedia unavailable (page must be on localhost or https)');
      }
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtx();
      const source = this.audioCtx.createMediaStreamSource(this.stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      this.dataArray = new Float32Array(this.analyser.fftSize);
      source.connect(this.analyser);
      this.state = 'live';
      this._loop();
    } catch (e) {
      this.state = 'error';
      this.error = e.message;
      throw e;
    }
  }

  _loop() {
    this.rafId = requestAnimationFrame(() => this._loop());
    if (!this.analyser) return;

    this.analyser.getFloatTimeDomainData(this.dataArray);
    let sumSquares = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sumSquares += this.dataArray[i] * this.dataArray[i];
    }
    const rms = Math.sqrt(sumSquares / this.dataArray.length);
    // Fast attack, slower release — reads like a VU meter's needle, not a
    // jittery per-sample number, so a single word's velocity is stable.
    const t = rms > this.level ? 0.6 : 0.15;
    this.level = this.level + (rms - this.level) * t;
  }

  get db() {
    return this.level > 0 ? 20 * Math.log10(this.level) : -100;
  }

  // Maps the current level onto a 1-127 MIDI velocity, calibrated by a
  // floor/ceiling in dB — these depend entirely on the room/mic/gain, so
  // they're exposed as live-tunable rather than guessed at here.
  getVelocity(floorDb, ceilDb) {
    const t = (this.db - floorDb) / (ceilDb - floorDb);
    const clamped = Math.max(0, Math.min(1, t));
    return Math.round(clamped * 126) + 1;
  }

  stop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
    this.analyser = null;
    this.state = 'off';
  }
}
