// Renders the accumulated log of finalized utterances to an offscreen 2D
// canvas — a background layer drawn behind the current bold phrase. All
// utterances accumulate into one continuous flow of text anchored to the
// upper-left corner (newest appended to the end, no per-utterance line
// break) and never removed. The flow word-wraps and justifies across the
// available width as it grows; once it grows past the bottom of the
// canvas it simply clips (still retained in `words`, just not drawn).
// Newly added words fade + rise into place one at a time, staggered
// across each utterance, rather than the whole utterance popping in.

const FADE_MS = 450;
const RISE_PX = 6;
const TARGET_ALPHA = 0.3;
const STAGGER_MS = 90; // delay between each word's animation start, within an utterance

function punctuate(text) {
  text = text.trim();
  if (!text) return text;
  text = text.charAt(0).toUpperCase() + text.slice(1);
  if (!/[.!?]$/.test(text)) text += '.';
  return text;
}

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
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.words = []; // { text, t }, oldest first, never trimmed
  }

  resize(w, h) {
    this.canvas.width = Math.max(1, w);
    this.canvas.height = Math.max(1, h);
  }

  setFontFamily(fontFamily) {
    this.fontFamily = fontFamily;
  }

  addPhrase(text) {
    text = punctuate(text);
    if (!text) return;
    const baseT = performance.now();
    text.split(/\s+/).filter(Boolean).forEach((w, i) => {
      this.words.push({ text: w, t: baseT + i * STAGGER_MS });
    });
  }

  update() {
    this._draw();
  }

  _wordStyle(t, now) {
    const progress = Math.min(1, Math.max(0, (now - t) / FADE_MS));
    const eased = easeOutCubic(progress);
    return { alpha: TARGET_ALPHA * eased, riseY: (1 - eased) * RISE_PX };
  }

  _drawLine(lineWords, x, y, maxWidth, justify, now) {
    const ctx = this.ctx;
    const widths = lineWords.map((w) => w.width);
    const wordsWidth = widths.reduce((a, b) => a + b, 0);
    const gap = justify && lineWords.length > 1
      ? (maxWidth - wordsWidth) / (lineWords.length - 1)
      : ctx.measureText(' ').width;

    let cx = x;
    for (let i = 0; i < lineWords.length; i++) {
      const { alpha, riseY } = this._wordStyle(lineWords[i].t, now);
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.fillText(lineWords[i].text, cx, y + riseY);
      cx += widths[i] + gap;
    }
  }

  _draw() {
    const { canvas, ctx } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.words.length) return;

    const fontSize = Math.max(14, Math.min(canvas.width, canvas.height) * 0.022);
    const lineHeight = fontSize * 1.35;
    const marginTop = canvas.height * 0.05;
    const marginLeft = canvas.width * 0.04;
    const maxWidth = canvas.width - marginLeft * 2;
    const maxY = canvas.height - marginTop;

    ctx.font = `400 ${fontSize}px ${this.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const words = this.words.map((w) => ({ ...w, width: ctx.measureText(w.text).width }));
    const spaceWidth = ctx.measureText(' ').width;
    const lines = wrapWords(ctx, words, maxWidth, spaceWidth);

    const now = performance.now();
    let y = marginTop;
    for (let i = 0; i < lines.length; i++) {
      if (y + lineHeight > maxY) break;
      const isLastLine = i === lines.length - 1;
      this._drawLine(lines[i], marginLeft, y, maxWidth, !isLastLine, now);
      y += lineHeight;
    }
  }
}
