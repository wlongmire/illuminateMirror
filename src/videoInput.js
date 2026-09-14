// Video source used purely as a texture for shading the corpus text.
// Nothing is ever recorded or sent anywhere — frames only exist as a
// WebGL texture for the current draw.
//
// Two sources: the live camera, and a synthetic animated test pattern.
// The test pattern needs no permissions or hardware, so it's the way to
// rehearse the look without a camera — and the way to tell a camera
// problem apart from a rendering one.

const TEST_W = 640;
const TEST_H = 360;

export class VideoInput {
  constructor({ source = 'camera' } = {}) {
    this.source = source;

    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    // Must actually be in the document: a detached (or display:none)
    // video can have frame delivery suspended, which yields a texture
    // that never updates. Parked off-screen rather than hidden.
    Object.assign(this.video.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      width: '2px',
      height: '2px',
      opacity: '0',
      pointerEvents: 'none',
    });
    document.body.appendChild(this.video);

    this.testCanvas = document.createElement('canvas');
    this.testCanvas.width = TEST_W;
    this.testCanvas.height = TEST_H;
    this.testCtx = this.testCanvas.getContext('2d');
    this.testPhase = 0;

    this.stream = null;
    this.state = 'off'; // off | starting | live | error
    this.error = null;
  }

  setSource(source) {
    this.source = source;
  }

  // The object handed to texImage2D — a <video> or the test <canvas>.
  get frameSource() {
    return this.source === 'test' ? this.testCanvas : this.video;
  }

  // True only once there's an actual decoded frame with real dimensions —
  // uploading before that throws or yields a garbage texture.
  get ready() {
    if (this.source === 'test') return true;
    return this.video.readyState >= 2 && this.video.videoWidth > 0;
  }

  get aspect() {
    if (this.source === 'test') return TEST_W / TEST_H;
    return this.ready ? this.video.videoWidth / this.video.videoHeight : 1;
  }

  // Animated so it's obvious at a glance that live frames are landing,
  // and high-contrast so the fill can't be mistaken for "nothing".
  update(dtMs) {
    if (this.source !== 'test') return;
    this.testPhase += dtMs / 1000;

    const ctx = this.testCtx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, TEST_W, TEST_H);

    const bandWidth = 60;
    const offset = (this.testPhase * 90) % (bandWidth * 2);
    for (let x = -bandWidth * 2; x < TEST_W + bandWidth * 2; x += bandWidth * 2) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(x + offset, 0);
      ctx.lineTo(x + offset + bandWidth, 0);
      ctx.lineTo(x + offset + bandWidth - TEST_H, TEST_H);
      ctx.lineTo(x + offset - TEST_H, TEST_H);
      ctx.closePath();
      ctx.fill();
    }

    // A pulsing blob, so there's a moving soft-edged region too.
    const cx = TEST_W * (0.5 + 0.35 * Math.sin(this.testPhase * 0.7));
    const cy = TEST_H * 0.5;
    const r = TEST_H * 0.45;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, TEST_W, TEST_H);
  }

  async start() {
    if (this.source === 'test') {
      this.state = 'live';
      return;
    }
    this.state = 'starting';
    this.error = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('getUserMedia unavailable (page must be on localhost or https)');
      }
      this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.state = 'live';
    } catch (e) {
      this.state = 'error';
      this.error = e.message;
      throw e;
    }
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
    this.state = 'off';
  }
}
