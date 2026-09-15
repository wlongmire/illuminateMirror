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
  constructor({
    fontFamily = 'system-ui, sans-serif', userAlpha = 0.65, corpusAlpha = 0.4,
    userWordSizeScale = 0.8, volumeSizeBoost = 2,
  } = {}) {
    this.fontFamily = fontFamily;
    // Peak brightness each source settles at once its fade-in completes.
    // Tunable live because the right value depends entirely on the
    // projector and the room, not on anything knowable from here.
    this.userAlpha = userAlpha;
    this.corpusAlpha = corpusAlpha;
    // Spoken words render larger than the shared base size, and louder
    // ones larger still (see addWord's `volume`) — the corpus monologue
    // is scripted with no live level to read, so it always renders at
    // the plain base size.
    this.userWordSizeScale = userWordSizeScale;
    this.volumeSizeBoost = volumeSizeBoost;
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

  setBrightness({ userAlpha, corpusAlpha } = {}) {
    if (userAlpha !== undefined) this.userAlpha = userAlpha;
    if (corpusAlpha !== undefined) this.corpusAlpha = corpusAlpha;
  }

  setUserWordSizing({ sizeScale, volumeBoost } = {}) {
    if (sizeScale !== undefined) this.userWordSizeScale = sizeScale;
    if (volumeBoost !== undefined) this.volumeSizeBoost = volumeBoost;
  }

  // Streams a single word in as it's produced — by real speech (source:
  // 'user', default) or the corpus monologue (source: 'corpus', dimmer).
  // Pass firstOfUtterance to capitalize the leading word. `volume` (0..1,
  // user words only) is this word's live loudness at the moment it was
  // spoken — baked in now rather than read live later, since a word's
  // size shouldn't keep changing after it's already landed in the log.
  addWord(word, { firstOfUtterance = false, source = 'user', volume = 0 } = {}) {
    word = word.trim();
    if (!word) return;
    if (firstOfUtterance) word = word.charAt(0).toUpperCase() + word.slice(1);
    this.words.push({ text: word, t: performance.now(), source, volume: Math.max(0, Math.min(1, volume)) });
  }

  // Corpus words always render at the shared base size; user words run
  // bigger by default and bigger still the louder they were spoken.
  _effectiveFontSize(word, baseFontSize) {
    if (word.source !== 'user') return baseFontSize;
    return baseFontSize * this.userWordSizeScale * (1 + word.volume * this.volumeSizeBoost);
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
    const target = source === 'corpus' ? this.corpusAlpha : this.userAlpha;
    const progress = Math.min(1, Math.max(0, (now - t) / FADE_MS));
    const eased = easeOutCubic(progress);
    return { alpha: target * eased, riseY: (1 - eased) * RISE_PX };
  }

  _drawLine(lineWords, x, y, maxWidth, justify, now, spaceWidth) {
    const widths = lineWords.map((w) => w.width);
    const wordsWidth = widths.reduce((a, b) => a + b, 0);
    const gap = justify && lineWords.length > 1
      ? (maxWidth - wordsWidth) / (lineWords.length - 1)
      : spaceWidth;

    let cx = x;
    for (let i = 0; i < lineWords.length; i++) {
      const word = lineWords[i];
      const { alpha, riseY } = this._wordStyle(word.t, now, word.source);
      // Position is identical either way — only the target layer and look differ.
      // Each word carries its own font size, so the font must be switched
      // back to it right before drawing (measurement already used it too).
      if (word.source === 'corpus') {
        this.corpusCtx.font = `400 ${word.fontSize}px ${this.fontFamily}`;
        this.corpusCtx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        this.corpusCtx.fillText(word.text, cx, y + riseY);
      } else {
        const next = lineWords[i + 1];
        const joinNext = next !== undefined && next.source !== 'corpus';
        this.userCtx.font = `400 ${word.fontSize}px ${this.fontFamily}`;
        this._drawHighlightedWord(word.text, cx, y + riseY, widths[i], gap, joinNext, alpha, word.fontSize);
      }
      cx += widths[i] + gap;
    }
  }

  // Spoken words render as a highlight box (brightness slider + fade-in
  // both drive the box's alpha) with solid black text painted on top, so
  // the letters stay fully legible even while the box itself is still
  // fading in.
  _drawHighlightedWord(text, cx, y, width, gap, joinNext, alpha, fontSize) {
    const ctx = this.userCtx;
    // Horizontal padding never exceeds half the gap, so a box can't spill
    // onto a neighbouring corpus word.
    const padX = Math.min(fontSize * 0.25, gap / 2);
    const left = cx - padX;
    // Run straight into the next spoken word's box, so a phrase reads as one
    // continuous highlight rather than a row of separate chips.
    const right = joinNext ? cx + width + gap - padX : cx + width + padX;
    // Fits within lineHeight (1.35 × fontSize), so lines never overlap.
    const top = y - fontSize * 0.1;
    const height = fontSize * 1.3;

    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.fillRect(left, top, right - left, height);

    ctx.fillStyle = '#000';
    ctx.fillText(text, cx, y);
  }

  _draw(dtMs) {
    const canvas = this.userCanvas; // both layers share these dimensions
    for (const layerCtx of this.layerCtxs) {
      layerCtx.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (!this.words.length) return;

    const baseFontSize = Math.max(14, Math.min(canvas.width, canvas.height) * 0.022);
    const marginTop = canvas.height * 0.05;
    const marginLeft = canvas.width * 0.04;
    const maxWidth = canvas.width - marginLeft * 2;
    const maxY = canvas.height - marginTop;
    const viewportHeight = maxY - marginTop;

    for (const layerCtx of this.layerCtxs) {
      layerCtx.textAlign = 'left';
      layerCtx.textBaseline = 'top';
    }

    // Measured once on one layer — the font is identical on both, so the
    // layout below applies to each without drifting out of register. Each
    // word gets its own font size (see _effectiveFontSize) before being
    // measured, since a louder/user word's width depends on it.
    const ctx = this.userCtx;
    const words = this.words.map((w) => {
      const fontSize = this._effectiveFontSize(w, baseFontSize);
      ctx.font = `400 ${fontSize}px ${this.fontFamily}`;
      return { ...w, fontSize, width: ctx.measureText(w.text).width };
    });
    ctx.font = `400 ${baseFontSize}px ${this.fontFamily}`;
    const spaceWidth = ctx.measureText(' ').width;
    const lines = wrapWords(ctx, words, maxWidth, spaceWidth);
    // Each line's height follows its tallest word, so bigger words never
    // overlap the line below them.
    const lineHeights = lines.map((line) => Math.max(...line.map((w) => w.fontSize)) * 1.35);

    // Once the flow is taller than the viewport, the target scroll keeps
    // the newest line pinned to the bottom; ease toward it each frame so
    // new lines arriving slide the block up rather than snapping.
    const totalHeight = lineHeights.reduce((a, b) => a + b, 0);
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
      const lineHeight = lineHeights[i];
      if (y + lineHeight >= marginTop && y <= maxY) {
        const isLastLine = i === lines.length - 1;
        this._drawLine(lines[i], marginLeft, y, maxWidth, !isLastLine, now, spaceWidth);
      }
      y += lineHeight;
    }

    for (const layerCtx of this.layerCtxs) layerCtx.restore();
  }
}
