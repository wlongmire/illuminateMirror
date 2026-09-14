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
  constructor({ onInterim, onFinal, wordDelayMs = 300, minBurstWords = 4, maxBurstWords = 12 }) {
    this.onInterim = onInterim;
    this.onFinal = onFinal;
    this.wordDelayMs = wordDelayMs;
    this.minBurstWords = minBurstWords;
    this.maxBurstWords = maxBurstWords;

    this.words = tokenize(LOREM_IPSUM);
    this.wordIndex = 0;

    this.running = false;
    this.paused = false;
    this.timeoutId = null;
    this._resetChunk();
  }

  _resetChunk() {
    this.chunkWords = [];
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

  resume() {
    if (!this.running || !this.paused) return;
    this.paused = false;
    // Always begin a fresh utterance on resume rather than picking a
    // half-spoken one back up where it left off.
    this._resetChunk();
    this._scheduleNext();
  }

  _scheduleNext() {
    this.timeoutId = setTimeout(() => this._tick(), this.wordDelayMs);
  }

  _tick() {
    if (!this.running || this.paused) return;

    this.chunkWords.push(this._nextWord());
    const text = this.chunkWords.join(' ');
    this.onInterim(text);

    if (this.chunkWords.length >= this.chunkTarget) {
      this.onFinal(text);
      this._resetChunk();
    }

    this._scheduleNext();
  }
}
