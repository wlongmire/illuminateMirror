// WebGL1 pipeline: text texture -> radial-mirror kaleidoscope -> ping-pong
// feedback (scale + rotate + decay each pass) -> screen.
//
// Pass 1 (kaleidoscope): folds the text texture's angle into N wedges and
// mirrors each one (polar-coordinate radial mirror), same math as the
// TouchDesigner GLSL TOP reference in illuminate_philly_kaleidoscope_network.md.
//
// Pass 2 (feedback composite): reads the previous frame's feedback buffer,
// applies a small scale-down + rotate + decay, and screen-blends this
// frame's kaleidoscope over it. Because that transform is applied fresh
// every frame to output that already contains all prior frames, it
// compounds into the receding/spiraling depth on its own — no manual
// accumulation needed.
//
// Pass 3 (copy): blits the feedback buffer to the visible canvas.

const VERT_SRC = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const KALEIDO_FRAG_SRC = `
precision highp float;
uniform sampler2D uText;
uniform float uSegments;
uniform float uRotate;
uniform float uZoom;
uniform vec2 uResolution;
varying vec2 vUv;

void main() {
  vec2 uv = (vUv - 0.5) * uResolution / min(uResolution.x, uResolution.y);

  float r = length(uv) / uZoom;
  float a = atan(uv.y, uv.x) + uRotate;

  float segAngle = 6.28318530718 / uSegments;
  a = mod(a, segAngle);
  a = abs(a - segAngle * 0.5);

  vec2 kUv = vec2(cos(a), sin(a)) * r + 0.5;

  if (kUv.x < 0.0 || kUv.x > 1.0 || kUv.y < 0.0 || kUv.y > 1.0) {
    gl_FragColor = vec4(0.0);
  } else {
    gl_FragColor = texture2D(uText, kUv);
  }
}`;

const FEEDBACK_FRAG_SRC = `
precision highp float;
uniform sampler2D uKaleido;
uniform sampler2D uPrevFeedback;
uniform float uDecay;
uniform float uFeedbackScale;
uniform float uFeedbackRotate;
varying vec2 vUv;

void main() {
  vec2 uv = vUv - 0.5;
  float s = sin(uFeedbackRotate);
  float c = cos(uFeedbackRotate);
  uv = mat2(c, -s, s, c) * uv;
  uv = uv / uFeedbackScale;
  uv += 0.5;

  vec4 prev = vec4(0.0);
  if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
    prev = texture2D(uPrevFeedback, uv) * uDecay;
  }

  vec4 cur = texture2D(uKaleido, vUv);
  // Screen blend keeps accumulation from clipping straight to white.
  gl_FragColor = 1.0 - (1.0 - cur) * (1.0 - prev);
}`;

const COPY_FRAG_SRC = `
precision highp float;
uniform sampler2D uTex;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uTex, vUv);
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

export class Renderer {
  constructor(canvas, textCanvas) {
    this.canvas = canvas;
    this.textCanvas = textCanvas;

    const gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL is not supported in this browser.');
    this.gl = gl;

    this.kaleidoProg = linkProgram(gl, VERT_SRC, KALEIDO_FRAG_SRC);
    this.feedbackProg = linkProgram(gl, VERT_SRC, FEEDBACK_FRAG_SRC);
    this.copyProg = linkProgram(gl, VERT_SRC, COPY_FRAG_SRC);

    this.kaleidoUniforms = uniformLocations(gl, this.kaleidoProg, ['uText', 'uSegments', 'uRotate', 'uZoom', 'uResolution']);
    this.feedbackUniforms = uniformLocations(gl, this.feedbackProg, ['uKaleido', 'uPrevFeedback', 'uDecay', 'uFeedbackScale', 'uFeedbackRotate']);
    this.copyUniforms = uniformLocations(gl, this.copyProg, ['uTex']);

    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    this.textTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.textTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.width = 0;
    this.height = 0;
  }

  _createFBO(w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return { fb, tex };
  }

  resize(w, h) {
    const gl = this.gl;
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (w === this.width && h === this.height) return;

    this.canvas.width = w;
    this.canvas.height = h;
    this.width = w;
    this.height = h;

    this.kaleidoFBO = this._createFBO(w, h);
    this.feedbackFront = this._createFBO(w, h);
    this.feedbackBack = this._createFBO(w, h);
  }

  _drawQuad(program, aPosName = 'aPos') {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    const loc = gl.getAttribLocation(program, aPosName);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  render(params) {
    const gl = this.gl;
    if (!this.kaleidoFBO) return;

    gl.bindTexture(gl.TEXTURE_2D, this.textTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.textCanvas);

    // Pass 1: kaleidoscope mirror of the text texture.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.kaleidoFBO.fb);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.kaleidoProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textTex);
    gl.uniform1i(this.kaleidoUniforms.uText, 0);
    gl.uniform1f(this.kaleidoUniforms.uSegments, params.segments);
    gl.uniform1f(this.kaleidoUniforms.uRotate, params.rotate);
    gl.uniform1f(this.kaleidoUniforms.uZoom, params.zoom);
    gl.uniform2f(this.kaleidoUniforms.uResolution, this.width, this.height);
    this._drawQuad(this.kaleidoProg);

    // Pass 2: composite over the transformed, decayed previous feedback frame.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.feedbackBack.fb);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.feedbackProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.kaleidoFBO.tex);
    gl.uniform1i(this.feedbackUniforms.uKaleido, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.feedbackFront.tex);
    gl.uniform1i(this.feedbackUniforms.uPrevFeedback, 1);
    gl.uniform1f(this.feedbackUniforms.uDecay, params.decay);
    gl.uniform1f(this.feedbackUniforms.uFeedbackScale, params.feedbackScale);
    gl.uniform1f(this.feedbackUniforms.uFeedbackRotate, params.feedbackRotate);
    this._drawQuad(this.feedbackProg);

    // Pass 3: blit to screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.copyProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.feedbackBack.tex);
    gl.uniform1i(this.copyUniforms.uTex, 0);
    this._drawQuad(this.copyProg);

    const tmp = this.feedbackFront;
    this.feedbackFront = this.feedbackBack;
    this.feedbackBack = tmp;
  }
}
