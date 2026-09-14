// A synthetic "ongoing monologue" of stored placeholder text, fed into the
// same live-transcript pipeline as real speech — word by word, chunked
// into utterances of random length — so the piece never sits on a fully
// blank screen during silence. This module only knows how to walk the
// stored text and schedule words; main.js owns pausing/resuming it
// whenever real speech is detected.

export const LOREM_IPSUM = `
Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod
tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim
veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea
commodo consequat. Duis aute irure dolor in reprehenderit in voluptate
velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint
occaecat cupidatat non proident, sunt in culpa qui officia deserunt
mollit anim id est laborum.

Sed ut perspiciatis unde omnis iste natus error sit voluptatem
accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab
illo inventore veritatis et quasi architecto beatae vitae dicta sunt
explicabo. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut
odit aut fugit, sed quia consequuntur magni dolores eos qui ratione
voluptatem sequi nesciunt. Neque porro quisquam est, qui dolorem ipsum
quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam
eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat
voluptatem.

Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis
suscipit laboriosam, nisi ut aliquid ex ea commodi consequatur. Quis
autem vel eum iure reprehenderit qui in ea voluptate velit esse quam
nihil molestiae consequatur, vel illum qui dolorem eum fugiat quo
voluptas nulla pariatur. At vero eos et accusamus et iusto odio
dignissimos ducimus qui blanditiis praesentium voluptatum deleniti
atque corrupti quos dolores et quas molestias excepturi sint occaecati
cupiditate non provident.

Similique sunt in culpa qui officia deserunt mollitia animi, id est
laborum et dolorum fuga. Et harum quidem rerum facilis est et expedita
distinctio. Nam libero tempore, cum soluta nobis est eligendi optio
cumque nihil impedit quo minus id quod maxime placeat facere possimus,
omnis voluptas assumenda est, omnis dolor repellendus. Temporibus autem
quibusdam et aut officiis debitis aut rerum necessitatibus saepe
eveniet ut et voluptates repudiandae sint et molestiae non recusandae.

Itaque earum rerum hic tenetur a sapiente delectus, ut aut reiciendis
voluptatibus maiores alias consequatur aut perferendis doloribus
asperiores repellat. Curabitur pretium tincidunt lacus, nulla gravida
orci a odio. Nullam varius, turpis et commodo pharetra, est eros
bibendum elit, nec luctus magna felis sollicitudin mauris. Integer in
mauris eu nibh euismod gravida quis pretium quis lectus.
`.trim();

function tokenize(text) {
  return text.split(/\s+/).filter(Boolean);
}

export class Monologue {
  constructor({
    onWord, onFinal, minBurstWords = 4, maxBurstWords = 12,
    mode = 'sine', baseDelayMs = 300, minDelayMs = 20, amplitudeMs = 150, frequencyHz = 0.2,
  }) {
    // Fires once per word, immediately — this module never hands out more
    // than one word at a time; callers that want a growing phrase (rather
    // than each word replacing the last) build that up themselves.
    this.onWord = onWord;
    // Fires once an utterance's random word-burst completes.
    this.onFinal = onFinal;
    this.minBurstWords = minBurstWords;
    this.maxBurstWords = maxBurstWords;

    // 'sine': the per-word delay rides a wave around baseDelayMs, so the
    // pace continuously speeds up and slows down (animates by default).
    // 'linear': a flat, constant baseDelayMs — no variation.
    this.mode = mode;
    this.baseDelayMs = baseDelayMs;
    this.minDelayMs = minDelayMs; // floor, so a large amplitude can't reach zero/negative
    this.amplitudeMs = amplitudeMs;
    this.frequencyHz = frequencyHz;
    // Accumulated "active" time (ms) driving the sine phase — only
    // advances while actually running and unpaused, so pausing freezes
    // the wave in place instead of it jumping ahead on resume.
    this.phaseMs = 0;

    this.words = tokenize(LOREM_IPSUM);
    this.wordIndex = 0;

    this.running = false;
    this.paused = false;
    this.timeoutId = null;
    this._resetChunk();
  }

  _resetChunk() {
    this.chunkWordCount = 0;
    const span = this.maxBurstWords - this.minBurstWords + 1;
    this.chunkTarget = this.minBurstWords + Math.floor(Math.random() * span);
  }

  _nextWord() {
    const word = this.words[this.wordIndex];
    this.wordIndex = (this.wordIndex + 1) % this.words.length; // loop forever
    return word;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this._scheduleNext();
  }

  stop() {
    this.running = false;
    this.paused = false;
    clearTimeout(this.timeoutId);
    this.timeoutId = null;
  }

  pause() {
    if (!this.running || this.paused) return;
    this.paused = true;
    clearTimeout(this.timeoutId);
    this.timeoutId = null;
  }

  // Reschedule the pending word immediately at the newly-computed pace,
  // rather than waiting for the current (possibly much longer) wait to
  // finish first — so a live slider feels responsive right away.
  _reschedule() {
    if (this.running && !this.paused) {
      clearTimeout(this.timeoutId);
      this._scheduleNext();
    }
  }

  setMode(mode) {
    this.mode = mode;
    this._reschedule();
  }

  setBaseDelayMs(ms) {
    this.baseDelayMs = ms;
    this._reschedule();
  }

  setAmplitudeMs(ms) {
    this.amplitudeMs = ms;
    this._reschedule();
  }

  setFrequencyHz(hz) {
    this.frequencyHz = hz;
    this._reschedule();
  }

  resume() {
    if (!this.running || !this.paused) return;
    this.paused = false;
    // Always begin a fresh utterance on resume rather than picking a
    // half-spoken one back up where it left off.
    this._resetChunk();
    this._scheduleNext();
  }

  // 'linear': flat baseDelayMs. 'sine': baseDelayMs + a wave of
  // amplitudeMs, frequencyHz cycles/sec. Always clamped so it can never
  // dip to zero/negative regardless of amplitude.
  _currentDelayMs() {
    if (this.mode === 'linear') {
      return Math.max(this.minDelayMs, this.baseDelayMs);
    }
    const phaseSec = this.phaseMs / 1000;
    const wave = this.amplitudeMs * Math.sin(2 * Math.PI * this.frequencyHz * phaseSec);
    return Math.max(this.minDelayMs, this.baseDelayMs + wave);
  }

  _scheduleNext() {
    const delay = this._currentDelayMs();
    this.timeoutId = setTimeout(() => {
      this.phaseMs += delay;
      this._tick();
    }, delay);
  }

  _tick() {
    if (!this.running || this.paused) return;

    const firstOfUtterance = this.chunkWordCount === 0;
    const word = this._nextWord();
    this.chunkWordCount++;

    this.onWord(word, { firstOfUtterance });

    if (this.chunkWordCount >= this.chunkTarget) {
      this.onFinal();
      this._resetChunk();
    }

    this._scheduleNext();
  }
}
