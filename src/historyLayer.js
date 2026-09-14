// Renders the accumulated log of utterances to an offscreen 2D canvas — a
// background layer drawn behind the current bold phrase. All utterances
// (real speech and the corpus monologue alike) accumulate into one
// continuous flow of text anchored to the upper-left corner (newest
// appended to the end, no per-utterance line break) and never removed
// from `words` — once the flow's wrapped height exceeds the viewport, the
// whole block smoothly scrolls upward so the newest line stays visible at
// the bottom, with older lines sliding off the top and clipped. Words are
// streamed in one at a time as they're produced (addWord) rather than as
// a whole phrase at once, so the fade+rise-into-place timing is driven by
// real arrival time — genuinely one word at a time, not a simulated stagger.

const FADE_MS = 450;
const RISE_PX = 6;
const USER_ALPHA = 0.3;
const CORPUS_ALPHA = 0.15; // dimmer — monologue/corpus text reads as background, not spoken
const SCROLL_TAU_MS = 220; // time constant for easing scroll position toward its target

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function wrapWords(ctx, words, maxWidth, spaceWidth) {
  const lines = [];
  let line = [];
  let lineWidth = 0;
  for (const w of words) {
    const testWidth = line.length ? lineWidth + spaceWidth + w.width : w.width;
    if (line.length && testWidth > maxWidth) {
      lines.push(line);
      line = [w];
      lineWidth = w.width;
    } else {
      line.push(w);
      lineWidth = testWidth;
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

export class HistoryLayer {
  constructor({ fontFamily = 'system-ui, sans-serif' } = {}) {
    this.fontFamily = fontFamily;
    // Two canvases so the renderer can shade corpus text (with video)
    // without touching real speech. Layout is computed once and shared,
    // so the two layers stay in exact register — each word is simply
    // painted onto whichever layer matches its source.
    this.userCanvas = document.createElement('canvas');
    this.userCtx = this.userCanvas.getContext('2d');
    this.corpusCanvas = document.createElement('canvas');
    this.corpusCtx = this.corpusCanvas.getContext('2d');
    this.words = []; // { text, t, source: 'user' | 'corpus' }, oldest first, never trimmed
    this.scrollY = 0; // current scroll offset in px, eased toward the target each frame
  }

  get layerCtxs() {
    return [this.userCtx, this.corpusCtx];
  }

  resize(w, h) {
    for (const canvas of [this.userCanvas, this.corpusCanvas]) {
      canvas.width = Math.max(1, w);
      canvas.height = Math.max(1, h);
    }
  }

  setFontFamily(fontFamily) {
    this.fontFamily = fontFamily;
  }

  // Streams a single word in as it's produced — by real speech (source:
  // 'user', default) or the corpus monologue (source: 'corpus', dimmer).
  // Pass firstOfUtterance to capitalize the leading word.
  addWord(word, { firstOfUtterance = false, source = 'user' } = {}) {
    word = word.trim();
    if (!word) return;
    if (firstOfUtterance) word = word.charAt(0).toUpperCase() + word.slice(1);
    this.words.push({ text: word, t: performance.now(), source });
  }

  // Closes out a run of addWord() calls with trailing punctuation.
  endUtterance() {
    if (!this.words.length) return;
    const last = this.words[this.words.length - 1];
    if (!/[.!?]$/.test(last.text)) last.text += '.';
  }

  update(dtMs = 16) {
    this._draw(dtMs);
  }

  _wordStyle(t, now, source) {
    const target = source === 'corpus' ? CORPUS_ALPHA : USER_ALPHA;
    const progress = Math.min(1, Math.max(0, (now - t) / FADE_MS));
    const eased = easeOutCubic(progress);
    return { alpha: target * eased, riseY: (1 - eased) * RISE_PX };
  }

  _drawLine(lineWords, x, y, maxWidth, justify, now) {
    const widths = lineWords.map((w) => w.width);
    const wordsWidth = widths.reduce((a, b) => a + b, 0);
    const gap = justify && lineWords.length > 1
      ? (maxWidth - wordsWidth) / (lineWords.length - 1)
      : this.userCtx.measureText(' ').width;

    let cx = x;
    for (let i = 0; i < lineWords.length; i++) {
      const word = lineWords[i];
      // Position is identical either way — only the target layer differs.
      const ctx = word.source === 'corpus' ? this.corpusCtx : this.userCtx;
      const { alpha, riseY } = this._wordStyle(word.t, now, word.source);
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.fillText(word.text, cx, y + riseY);
      cx += widths[i] + gap;
    }
  }

  _draw(dtMs) {
    const canvas = this.userCanvas; // both layers share these dimensions
    for (const layerCtx of this.layerCtxs) {
      layerCtx.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (!this.words.length) return;

    const fontSize = Math.max(14, Math.min(canvas.width, canvas.height) * 0.022);
    const lineHeight = fontSize * 1.35;
    const marginTop = canvas.height * 0.05;
    const marginLeft = canvas.width * 0.04;
    const maxWidth = canvas.width - marginLeft * 2;
    const maxY = canvas.height - marginTop;
    const viewportHeight = maxY - marginTop;

    for (const layerCtx of this.layerCtxs) {
      layerCtx.font = `400 ${fontSize}px ${this.fontFamily}`;
      layerCtx.textAlign = 'left';
      layerCtx.textBaseline = 'top';
    }

    // Measured once on one layer — the font is identical on both, so the
    // layout below applies to each without drifting out of register.
    const ctx = this.userCtx;
    const words = this.words.map((w) => ({ ...w, width: ctx.measureText(w.text).width }));
    const spaceWidth = ctx.measureText(' ').width;
    const lines = wrapWords(ctx, words, maxWidth, spaceWidth);

    // Once the flow is taller than the viewport, the target scroll keeps
    // the newest line pinned to the bottom; ease toward it each frame so
    // new lines arriving slide the block up rather than snapping.
    const totalHeight = lines.length * lineHeight;
    const targetScroll = Math.max(0, totalHeight - viewportHeight);
    const t = 1 - Math.exp(-dtMs / SCROLL_TAU_MS);
    this.scrollY += (targetScroll - this.scrollY) * t;

    const now = performance.now();

    for (const layerCtx of this.layerCtxs) {
      layerCtx.save();
      layerCtx.beginPath();
      layerCtx.rect(0, marginTop, canvas.width, viewportHeight);
      layerCtx.clip();
    }

    let y = marginTop - this.scrollY;
    for (let i = 0; i < lines.length; i++) {
      if (y + lineHeight >= marginTop && y <= maxY) {
        const isLastLine = i === lines.length - 1;
        this._drawLine(lines[i], marginLeft, y, maxWidth, !isLastLine, now);
      }
      y += lineHeight;
    }

    for (const layerCtx of this.layerCtxs) layerCtx.restore();
  }
}
