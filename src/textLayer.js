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

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

function computeLayout(ctx, text, canvasW, canvasH, fontFamily, fontWeight, sizeScale) {
  const maxWidth = canvasW * 0.86;
  const maxHeight = canvasH * 0.7;
  const minFontSize = 24 * sizeScale;
  let fontSize = Math.min(canvasW, canvasH) * 0.16 * sizeScale;
  let lines = [text];

  while (fontSize > minFontSize) {
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
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
  constructor({ fontFamily = 'system-ui, sans-serif', fontWeight = 700, sizeScale = 1, letterSpacing = 0, holdMs = 1200, transitionMs = 300 } = {}) {
    this.fontFamily = fontFamily;
    this.fontWeight = fontWeight;
    this.sizeScale = sizeScale;
    this.letterSpacing = letterSpacing;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');

    this.currentText = '';
    this.pendingText = null;
    this.layout = null;
    this.alpha = 0;
    this.scale = 1;
    this.blur = 0;
    this.phase = 'empty'; // empty | out | in | hold
    this.timer = 0;
    // Entrance and exit share one duration so the phrase takes as long to
    // leave as it took to arrive.
    this.transitionMs = transitionMs;
    // Exit is the entrance played in reverse: grows in from enterScale to
    // 1.0 while sharpening, then shrinks back down to enterScale while
    // reblurring on the way out.
    this.enterScale = 0.88;
    this.enterBlurPx = 4;
    // How long the phrase stays fully visible before auto-fading out on
    // its own, once fade-in completes and no new words have arrived.
    // <= 0 disables the auto-fade — it then stays until replaced.
    this.holdMs = holdMs;
    this.holdTimer = 0;
    // True while the text on screen is a growing interim (non-final)
    // transcript of the utterance currently being recited — the next
    // setPhrase() call for that same utterance updates in place instead
    // of re-triggering the crossfade.
    this.utteranceActive = false;
  }

  resize(w, h) {
    this.canvas.width = Math.max(1, w);
    this.canvas.height = Math.max(1, h);
    this.layout = null;
  }

  setStyle({ fontFamily, fontWeight, sizeScale, letterSpacing } = {}) {
    if (fontFamily !== undefined) this.fontFamily = fontFamily;
    if (fontWeight !== undefined) this.fontWeight = fontWeight;
    if (sizeScale !== undefined) this.sizeScale = sizeScale;
    if (letterSpacing !== undefined) this.letterSpacing = letterSpacing;
    this.layout = null;
  }

  setHoldMs(ms) {
    this.holdMs = ms;
  }

  setTransitionMs(ms) {
    this.transitionMs = ms;
  }

  // Live/interim transcript for the utterance currently being spoken.
  // The finalized wording is never shown here — call finishUtterance()
  // when the utterance completes instead of another setPhrase().
  setPhrase(text) {
    text = text.trim();
    if (!text) return;

    // New words landing resets the on-screen clock — the auto-fade only
    // starts counting once speech actually pauses.
    this.holdTimer = 0;

    if (this.utteranceActive) {
      // Same utterance as last call, just a longer interim transcript —
      // update in place rather than re-running the crossfade.
      if (this.phase === 'out') {
        this.pendingText = text;
      } else {
        this.currentText = text;
        this.pendingText = null;
        this.layout = null;
      }
    } else {
      // A new utterance starting — clear whatever's on screen immediately
      // (skip any exit animation in progress) and jump straight into this
      // phrase's own entrance, rather than waiting out a fade first.
      this.pendingText = text;
      this._applyPending();
      this.utteranceActive = true;
    }
  }

  // The utterance being live-updated just finalized — dismiss whatever's
  // on screen (it was only ever an interim transcript) rather than
  // holding or displaying the completed wording. The finalized text
  // belongs in the history log, not here.
  finishUtterance() {
    this.utteranceActive = false;
    this.pendingText = null;
    if (this.phase === 'in' || this.phase === 'hold') {
      this.phase = 'out';
      this.timer = 0;
    }
  }

  _applyPending() {
    if (this.pendingText) {
      this.currentText = this.pendingText;
      this.pendingText = null;
      this.layout = null;
      this.phase = 'in';
      this.timer = 0;
    } else {
      // Fading out on its own (hold timeout), not into a new phrase.
      this.currentText = '';
      this.layout = null;
      this.phase = 'empty';
      this.timer = 0;
    }
  }

  // Shared shape for both transitions: eased 0 -> invisible/small/blurred,
  // eased 1 -> fully visible/full size/sharp. The exit phase just plays
  // this same curve with eased running 1 -> 0 instead of 0 -> 1.
  _applyEasedPose(eased) {
    this.alpha = eased;
    this.scale = this.enterScale + eased * (1 - this.enterScale);
    this.blur = (1 - eased) * this.enterBlurPx;
  }

  update(dtMs) {
    if (this.phase === 'out') {
      // Reverse-play the entrance curve (t=0 picks up exactly where hold
      // left off; t=1 lands exactly on the entrance's own starting point).
      this.timer += dtMs;
      const t = Math.min(1, this.timer / this.transitionMs);
      this._applyEasedPose(easeOutCubic(1 - t));
      if (this.timer >= this.transitionMs) this._applyPending();
    } else if (this.phase === 'in') {
      this.timer += dtMs;
      const t = Math.min(1, this.timer / this.transitionMs);
      this._applyEasedPose(easeOutCubic(t));
      if (this.timer >= this.transitionMs) {
        this.phase = 'hold';
        this.holdTimer = 0;
      }
    } else if (this.phase === 'hold') {
      this.alpha = 1;
      this.scale = 1;
      this.blur = 0;
      if (this.holdMs > 0) {
        this.holdTimer += dtMs;
        if (this.holdTimer >= this.holdMs) {
          this.phase = 'out';
          this.timer = 0;
        }
      }
    } else {
      this.alpha = 0;
      this.scale = 1;
      this.blur = 0;
    }
    this._draw();
  }

  _draw() {
    const { canvas, ctx } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.currentText || this.alpha <= 0) return;

    if (!this.layout) {
      this.layout = computeLayout(
        ctx, this.currentText, canvas.width, canvas.height,
        this.fontFamily, this.fontWeight, this.sizeScale
      );
    }
    const { fontSize, lines, lineHeight } = this.layout;

    ctx.save();
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    if (this.scale !== 1) {
      ctx.translate(cx, cy);
      ctx.scale(this.scale, this.scale);
      ctx.translate(-cx, -cy);
    }
    if (this.blur > 0.05) ctx.filter = `blur(${this.blur}px)`;

    ctx.font = `${this.fontWeight} ${fontSize}px ${this.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(255, 255, 255, ${this.alpha})`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${this.letterSpacing}px`;

    const totalHeight = lines.length * lineHeight;
    const startY = cy - totalHeight / 2 + lineHeight / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line, cx, startY + i * lineHeight);
    });
    ctx.restore();
  }
}
