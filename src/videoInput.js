// Video source used purely as a texture for shading the corpus text.
// Nothing is ever recorded or sent anywhere — frames only exist as a
// WebGL texture for the current draw.
//
// Sources: the live camera, or one of a handful of pre-loaded mirror
// clips (served from public/videos/ so Vite copies them as-is rather
// than trying to bundle them). The mirror clips reuse the same <video>
// element as the camera (just pointed at a file instead of a live
// stream), so `ready`/`aspect`/`frameSource` need no per-source
// branching for them.

// Looping stock clips available as video-fill sources, in addition to
// the live camera. Labels are generic since the clips' content isn't
// meaningful to the code — just distinct selectable options.
export const MIRROR_VIDEOS = [
  { id: 'mirror1', label: 'Mirror clip 1', path: '/videos/8724310-uhd_2160_4096_25fps.mp4' },
  { id: 'mirror2', label: 'Mirror clip 2', path: '/videos/12908966-uhd_2160_3840_24fps.mp4' },
  { id: 'mirror3', label: 'Mirror clip 3', path: '/videos/15559259_2160_3840_50fps.mp4' },
  { id: 'mirror4', label: 'Mirror clip 4', path: '/videos/14652363_1080_1920_30fps.mp4' },
];

// Devices only get real labels once the page has been granted camera
// permission at least once — before that they come back blank, which
// callers should fall back to a generic "Camera N" label for.
export async function listCameraDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'videoinput');
}

export class VideoInput {
  constructor({ source = 'camera' } = {}) {
    this.source = source;
    this.cameraDeviceId = null; // null = browser's own default choice

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

    this.stream = null;
    this.state = 'off'; // off | starting | live | error
    this.error = null;
  }

  setSource(source) {
    this.source = source;
  }

  // deviceId: a MediaDeviceInfo.deviceId from listCameraDevices(), or
  // null/'' for the browser's default. Only takes effect on the next
  // start() — call it again to switch live if the camera is already running.
  setCameraDevice(deviceId) {
    this.cameraDeviceId = deviceId || null;
  }

  // The object handed to texImage2D.
  get frameSource() {
    return this.video;
  }

  // True only once there's an actual decoded frame with real dimensions —
  // uploading before that throws or yields a garbage texture.
  get ready() {
    return this.video.readyState >= 2 && this.video.videoWidth > 0;
  }

  get aspect() {
    return this.ready ? this.video.videoWidth / this.video.videoHeight : 1;
  }

  async start() {
    this.state = 'starting';
    this.error = null;
    try {
      const mirror = MIRROR_VIDEOS.find((v) => v.id === this.source);
      if (mirror) {
        // A file source needs no permission, but it does need the camera
        // stream (if any) released and `src`/`srcObject` are mutually
        // exclusive on a <video> element.
        if (this.stream) {
          this.stream.getTracks().forEach((t) => t.stop());
          this.stream = null;
        }
        this.video.srcObject = null;
        this.video.loop = true;
        this.video.src = mirror.path;
        await this.video.play();
        this.state = 'live';
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('getUserMedia unavailable (page must be on localhost or https)');
      }
      this.video.removeAttribute('src');
      const videoConstraint = this.cameraDeviceId ? { deviceId: { exact: this.cameraDeviceId } } : true;
      this.stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: false });
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
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.srcObject = null;
    this.state = 'off';
  }
}
