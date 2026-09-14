// Renders the current phrase to an offscreen 2D canvas that the WebGL
// renderer uses as a texture input. Owns the fade-in/fade-out timing and
// the word-wrap/auto-fit layout so the GL side stays purely visual.

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function computeLayout(ctx, text, canvasW, canvasH, fontFamily) {
  const maxWidth = canvasW * 0.86;
  const maxHeight = canvasH * 0.7;
  const minFontSize = 24;
  let fontSize = Math.min(canvasW, canvasH) * 0.16;
  let lines = [text];

  while (fontSize > minFontSize) {
    ctx.font = `700 ${fontSize}px ${fontFamily}`;
    lines = wrapText(ctx, text, maxWidth);
    const lineHeight = fontSize * 1.15;
    const blockHeight = lines.length * lineHeight;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (blockHeight <= maxHeight && widest <= maxWidth) break;
    fontSize -= 4;
  }

  return { fontSize, lines, lineHeight: fontSize * 1.15 };
}

export class TextLayer {
  constructor({ fontFamily = "'UnifrakturCook', serif" } = {}) {
    this.fontFamily = fontFamily;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');

    this.currentText = '';
    this.pendingText = null;
    this.layout = null;
    this.alpha = 0;
    this.phase = 'empty'; // empty | out | in | hold
    this.timer = 0;
    this.fadeOutMs = 250;
    this.fadeInMs = 600;
  }

  resize(w, h) {
    this.canvas.width = Math.max(1, w);
    this.canvas.height = Math.max(1, h);
    this.layout = null;
  }

  setPhrase(text) {
    text = text.trim();
    if (!text) return;
    this.pendingText = text;
    if (this.phase === 'empty') {
      this._applyPending();
    } else {
      this.phase = 'out';
      this.timer = 0;
    }
  }

  _applyPending() {
    this.currentText = this.pendingText;
    this.pendingText = null;
    this.layout = null;
    this.phase = 'in';
    this.timer = 0;
  }

  update(dtMs) {
    if (this.phase === 'out') {
      this.timer += dtMs;
      this.alpha = Math.max(0, 1 - this.timer / this.fadeOutMs);
      if (this.timer >= this.fadeOutMs) this._applyPending();
    } else if (this.phase === 'in') {
      this.timer += dtMs;
      this.alpha = Math.min(1, this.timer / this.fadeInMs);
      if (this.timer >= this.fadeInMs) this.phase = 'hold';
    } else if (this.phase === 'hold') {
      this.alpha = 1;
    } else {
      this.alpha = 0;
    }
    this._draw();
  }

  _draw() {
    const { canvas, ctx } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.currentText || this.alpha <= 0) return;

    if (!this.layout) {
      this.layout = computeLayout(ctx, this.currentText, canvas.width, canvas.height, this.fontFamily);
    }
    const { fontSize, lines, lineHeight } = this.layout;

    ctx.font = `700 ${fontSize}px ${this.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(255, 255, 255, ${this.alpha})`;

    const totalHeight = lines.length * lineHeight;
    const startY = canvas.height / 2 - totalHeight / 2 + lineHeight / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line, canvas.width / 2, startY + i * lineHeight);
    });
  }
}
