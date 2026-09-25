// Renders the current phrase to an offscreen 2D canvas that the WebGL
// renderer uses as a texture input. Owns the fade-in/fade-out timing and
// the word-wrap/auto-fit layout so the GL side stays purely visual.

// Fill behind each line of the overlay phrase and the text drawn on it, as
// "r, g, b" triples: real speech is black on white, corpus is white on black
// (the black box also masks the history text behind it).
const USER_BOX_RGB = '255, 255, 255';
const USER_TEXT_RGB = '0, 0, 0';
const CORPUS_BOX_RGB = '0, 0, 0';
const CORPUS_TEXT_RGB = '255, 255, 255';

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

// Ellipse mode: the phrase is a centered block of lines, each wrapped to
// the ellipse's width at that line's own height (narrower toward the top
// and bottom). The row positions depend on how many lines there are, so
// this tries 1, 2, 3... lines until the words fit, shrinking the font if
// none do. Falls back to the plain rectangular layout for text too long to
// fit at the minimum size.
const ELLIPSE_INSET = 0.9;

function computeEllipseLayout(ctx, text, canvasW, canvasH, fontFamily, fontWeight, sizeScale) {
  const words = text.split(/\s+/).filter(Boolean);
  const halfW = (canvasW / 2) * ELLIPSE_INSET;
  const halfH = (canvasH / 2) * ELLIPSE_INSET;
  const cy = canvasH / 2;
  const minFontSize = 24 * sizeScale;
  let fontSize = Math.min(canvasW, canvasH) * 0.16 * sizeScale;
  const chord = (y0, y1) => {
    const dy = Math.max(Math.abs(y0 - cy), Math.abs(y1 - cy));
    return dy >= halfH ? 0 : 2 * halfW * Math.sqrt(1 - (dy / halfH) ** 2);
  };

  for (;;) {
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    const lineHeight = fontSize * 1.15;
    const maxLines = Math.max(1, Math.floor((canvasH * 0.7) / lineHeight));
    for (let n = 1; n <= maxLines; n++) {
      const lines = [];
      const lineYs = [];
      let i = 0;
      for (let k = 0; k < n && i < words.length; k++) {
        const y0 = cy - (n * lineHeight) / 2 + k * lineHeight;
        const avail = chord(y0, y0 + lineHeight);
        let line = '';
        while (i < words.length) {
          const test = line ? line + ' ' + words[i] : words[i];
          if (ctx.measureText(test).width > avail) break;
          line = test;
          i++;
        }
        if (!line) break;
        lines.push(line);
        lineYs.push(y0 + lineHeight / 2);
      }
      if (i >= words.length) return { fontSize, lines, lineYs, lineHeight };
    }
    if (fontSize <= minFontSize) break;
    fontSize = Math.max(minFontSize, fontSize - 4);
  }
  return computeLayout(ctx, text, canvasW, canvasH, fontFamily, fontWeight, sizeScale);
}

export class TextLayer {
  constructor({
    fontFamily = 'system-ui, sans-serif', fontWeight = 700, sizeScale = 1, letterSpacing = 0,
    holdMs = 1200, transitionMs = 300, userSizeScale = 1, userVolumeBoost = 0.6,
  } = {}) {
    this.fontFamily = fontFamily;
    this.fontWeight = fontWeight;
    this.sizeScale = sizeScale;
    this.letterSpacing = letterSpacing;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');

    this.currentText = '';
    this.pendingText = null;
    this.layout = null;
    this.shape = 'rect'; // 'rect' | 'ellipse' — see computeEllipseLayout
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
    // Whether the utterance currently on screen came from the corpus
    // monologue rather than real speech — rendered smaller either way
    // (both render at full opacity), so real speech still reads as the
    // more dramatic arrival.
    this.dim = false;
    this.dimSizeScale = 0.8;
    // Extra multiplier on top of sizeScale, applied to real speech only
    // (corpus size is governed by dimSizeScale instead) — lets the user
    // text's peak size be tuned independently of the shared base size.
    this.userSizeScale = userSizeScale;
    // How much louder speech additionally grows real-speech text, on top
    // of userSizeScale — 0 at silence, this value at the loudest the mic
    // range is calibrated for. Corpus text has no live level to read, so
    // it's unaffected regardless of this.volume's value.
    this.userVolumeBoost = userVolumeBoost;
    this.volume = 0; // 0..1, set by setPhrase for the utterance now on screen
  }

  resize(w, h) {
    this.canvas.width = Math.max(1, w);
    this.canvas.height = Math.max(1, h);
    this.layout = null;
  }

  setShape(shape) {
    if (shape === this.shape) return;
    this.shape = shape;
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

  setUserSizeScale(scale) {
    this.userSizeScale = scale;
  }

  setUserVolumeBoost(boost) {
    this.userVolumeBoost = boost;
  }

  // Live/interim transcript for the utterance currently being spoken.
  // The finalized wording is never shown here — call finishUtterance()
  // when the utterance completes instead of another setPhrase(). Pass
  // dim: true for corpus/monologue text. A call whose dim differs from the
  // utterance in progress is never a continuation of it (corpus words must
  // not inherit real speech's styling, or vice versa, when the previous
  // utterance was never explicitly finished) — it starts a new one.
  // `volume` (0..1, real speech only) is the utterance's current loudness —
  // read live on every call (unlike history's per-word volume, which is
  // baked in once), so the block keeps growing/shrinking with it word to word.
  setPhrase(text, { dim = false, volume = 0 } = {}) {
    text = text.trim();
    if (!text) return;

    // New words landing resets the on-screen clock — the auto-fade only
    // starts counting once speech actually pauses.
    this.holdTimer = 0;
    this.volume = volume;

    if (this.utteranceActive && dim === this.dim) {
      // Same utterance as last call, just a longer interim transcript —
      // update in place rather than re-running the crossfade. Exception:
      // if speech paused long enough for the phrase to already auto-fade
      // out (phase 'empty') before this word arrived, there's nothing on
      // screen to update in place — bring it back with a fresh entrance
      // instead of silently writing into invisible text that would never
      // reappear for the rest of this utterance.
      if (this.phase === 'out') {
        this.pendingText = text;
      } else if (this.phase === 'empty') {
        this.pendingText = text;
        this._applyPending();
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
      this.dim = dim;
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
      const effectiveSizeScale = this.dim
        ? this.sizeScale * this.dimSizeScale
        : this.sizeScale * this.userSizeScale * (1 + this.volume * this.userVolumeBoost);
      const compute = this.shape === 'ellipse' ? computeEllipseLayout : computeLayout;
      this.layout = compute(
        ctx, this.currentText, canvas.width, canvas.height,
        this.fontFamily, this.fontWeight, effectiveSizeScale
      );
    }
    const { fontSize, lines, lineHeight, lineYs } = this.layout;

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
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${this.letterSpacing}px`;

    // Each line sits on a filled box (see the color constants above).
    const [boxRgb, textRgb] = this.dim ? [CORPUS_BOX_RGB, CORPUS_TEXT_RGB] : [USER_BOX_RGB, USER_TEXT_RGB];
    const padX = fontSize * 0.25;
    const totalHeight = lines.length * lineHeight;
    const startY = cy - totalHeight / 2 + lineHeight / 2;
    lines.forEach((line, i) => {
      const y = lineYs ? lineYs[i] : startY + i * lineHeight;
      const w = ctx.measureText(line).width + padX * 2;
      ctx.fillStyle = `rgba(${boxRgb}, ${this.alpha})`;
      ctx.fillRect(cx - w / 2, y - lineHeight / 2, w, lineHeight);
      ctx.fillStyle = `rgba(${textRgb}, ${this.alpha})`;
      ctx.fillText(line, cx, y);
    });
    ctx.restore();
  }
}
