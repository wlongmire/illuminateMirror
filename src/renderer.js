// Minimal WebGL1 pipeline: composite the two history layers and the
// current phrase onto the screen (alpha-blended, history first). The
// user-text history layer can be filled with a live video/pattern source
// instead of flat white — see VIDEO_FRAG_SRC; user text is drawn as a
// white highlight box with solid black knockout text on top
// (historyLayer.js), so the fill shows through the box while the black
// text stays black regardless (anything multiplied by black is still
// black). Corpus text's video fill is disabled for now (always plain) —
// _drawVideoShaded still works on it too, so re-enabling it later is just
// swapping its render() call back to _drawHistoryLayer.

const VERT_SRC = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COPY_FRAG_SRC = `
precision highp float;
uniform sampler2D uTex;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uTex, vUv);
}`;

// Fills the glyphs with the video instead of flat white. uInfluence mixes
// between the two: 0 = plain white (identical to COPY), 1 = raw video
// fill. Because it's a mix toward white, the fill's brightness can never
// fall below (1 - uInfluence) — that floor is what keeps the letterforms
// readable when the video goes dark, rather than dropping out entirely.
// The text's own alpha is untouched, so glyph shape/coverage is preserved.
const VIDEO_FRAG_SRC = `
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uVideo;
uniform float uInfluence;
uniform float uGain;
uniform vec2 uVideoScale; // cover-fit, so the frame isn't stretched to the canvas
varying vec2 vUv;

void main() {
  vec4 text = texture2D(uTex, vUv);
  vec2 videoUv = (vUv - 0.5) * uVideoScale + 0.5;
  vec3 video = clamp(texture2D(uVideo, videoUv).rgb * uGain, 0.0, 1.0);
  vec3 fill = mix(vec3(1.0), video, uInfluence);
  gl_FragColor = vec4(text.rgb * fill, text.a);
}`;

function compileShader(gl, type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error('Shader compile error: ' + info);
  }
  return shader;
}

function linkProgram(gl, vertSrc, fragSrc) {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error('Program link error: ' + info);
  }
  return program;
}

function uniformLocations(gl, program, names) {
  const locs = {};
  for (const name of names) locs[name] = gl.getUniformLocation(program, name);
  return locs;
}

function createTexture(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

export class Renderer {
  constructor(canvas, { current, historyUser, historyCorpus }) {
    this.canvas = canvas;
    this.currentCanvas = current;
    this.historyUserCanvas = historyUser;
    this.historyCorpusCanvas = historyCorpus;

    const gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL is not supported in this browser.');
    this.gl = gl;

    this.copyProg = linkProgram(gl, VERT_SRC, COPY_FRAG_SRC);
    this.copyUniforms = uniformLocations(gl, this.copyProg, ['uTex']);

    this.videoProg = linkProgram(gl, VERT_SRC, VIDEO_FRAG_SRC);
    this.videoUniforms = uniformLocations(gl, this.videoProg, [
      'uTex', 'uVideo', 'uInfluence', 'uGain', 'uVideoScale',
    ]);

    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    this.currentTex = createTexture(gl);
    this.historyUserTex = createTexture(gl);
    this.historyCorpusTex = createTexture(gl);
    this.videoTex = createTexture(gl);

    this.width = 0;
    this.height = 0;
  }

  resize(w, h) {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (w === this.width && h === this.height) return;

    this.canvas.width = w;
    this.canvas.height = h;
    this.width = w;
    this.height = h;
  }

  _drawQuad(program, aPosName = 'aPos') {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    const loc = gl.getAttribLocation(program, aPosName);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  _upload(tex, source, unit = 0) {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  _drawPlain(tex, srcCanvas) {
    const gl = this.gl;
    gl.useProgram(this.copyProg);
    this._upload(tex, srcCanvas, 0);
    gl.uniform1i(this.copyUniforms.uTex, 0);
    this._drawQuad(this.copyProg);
  }

  // Scales the video's UVs so it covers the canvas without distortion —
  // the overflowing axis gets cropped rather than squashed.
  _videoCoverScale(videoAspect) {
    const canvasAspect = this.width / this.height;
    return videoAspect > canvasAspect
      ? [canvasAspect / videoAspect, 1]
      : [1, videoAspect / canvasAspect];
  }

  _drawVideoShaded(tex, srcCanvas, video, { influence, gain }) {
    const gl = this.gl;
    gl.useProgram(this.videoProg);
    this._upload(tex, srcCanvas, 0);
    gl.uniform1i(this.videoUniforms.uTex, 0);
    this._upload(this.videoTex, video.frameSource, 1);
    gl.uniform1i(this.videoUniforms.uVideo, 1);
    gl.uniform1f(this.videoUniforms.uInfluence, influence);
    gl.uniform1f(this.videoUniforms.uGain, gain);
    const [sx, sy] = this._videoCoverScale(video.aspect);
    gl.uniform2f(this.videoUniforms.uVideoScale, sx, sy);
    this._drawQuad(this.videoProg);
  }

  // Draws whichever pass is appropriate given whether video is actually
  // available right now — falls back to plain so the layer still renders
  // (just without the fill) if the camera/test source isn't ready yet.
  _drawHistoryLayer(tex, srcCanvas, video, influence, gain) {
    if (video && video.ready && influence > 0) {
      this._drawVideoShaded(tex, srcCanvas, video, { influence, gain });
    } else {
      this._drawPlain(tex, srcCanvas);
    }
  }

  // `video` is a VideoInput (or null), shared by both history layers.
  // The current phrase stays plain.
  render({ video = null, influence = 0, gain = 1 } = {}) {
    const gl = this.gl;
    if (!this.width || !this.height) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // The two history layers never overlap (each word owns its own run of
    // the line), so their relative order doesn't matter visually.
    // Corpus text's video fill is off for now — always plain — while the
    // user-text highlight box keeps it.
    this._drawPlain(this.historyCorpusTex, this.historyCorpusCanvas);
    this._drawHistoryLayer(this.historyUserTex, this.historyUserCanvas, video, influence, gain);
    this._drawPlain(this.currentTex, this.currentCanvas);

    gl.disable(gl.BLEND);
  }
}
