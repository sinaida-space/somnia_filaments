// Tracking layer — MediaPipe Tasks head + hand, One-Euro smoothing, degradation.
// Feeds one per-frame snapshot: smoothed hand for the paddle, smoothed metric
// head for the camera, with an automatic hand-only fallback that eases the head
// toward the default eye position instead of snapping.

import { SCREEN } from './config.js';
import { OneEuroFilter } from './oneEuro.js';

const TASKS_VERSION = '0.10.14';
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}`;
const WASM_PATH = `${CDN_BASE}/wasm`;
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const PALM_IDS = [0, 5, 9, 13, 17];      // wrist + finger MCP joints -> palm centroid
const REAL_IPD_M = 0.063;                 // average human interpupillary distance
const PREDICT_S = 0.06;                    // 60ms velocity prediction for the hand
const HAND_LOST_S = 0.5;                   // hold last hand value this long before present=false
const EASE_S = 2.0;                        // head ease-to-default duration in hand-only mode
const PROC_WINDOW = 90;                    // rolling frames for procMs mean

export class Tracking {
  constructor() {
    this.mode = 'full';
    this.handRange = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    this.ready = false;

    this.video = null;
    this.handLandmarker = null;
    this.faceLandmarker = null;

    this.lastTs = 0;          // strictly-increasing timestamp guard
    this.frameCount = 0;      // face runs on even frames only

    // Hand One-Euro (normalized -1..1 space) + prediction state.
    this.handFx = new OneEuroFilter(1.2, 0.03, 1.0);
    this.handFy = new OneEuroFilter(1.2, 0.03, 1.0);
    this.hand = { x: 0, y: 0, present: false };
    this.handLastSeen = -Infinity;
    this.handPrevSmoothed = { x: 0, y: 0, t: 0 };

    // Head One-Euro (metric) + last valid detection.
    this.headFx = new OneEuroFilter(0.6, 0.02, 1.0);
    this.headFy = new OneEuroFilter(0.6, 0.02, 1.0);
    this.headFz = new OneEuroFilter(0.6, 0.02, 1.0);
    this.head = { ...SCREEN.defaultEyeM, present: false };
    this.headHadDetection = false;

    // Ease-to-default state for hand-only mode.
    this.easeActive = false;
    this.easeFrom = { ...SCREEN.defaultEyeM };
    this.easeStart = 0;

    // procMs rolling buffer.
    this.procSamples = [];
    this.procMs = 0;
  }

  async init(videoEl) {
    this.video = videoEl;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
    } catch (err) {
      // Boundary: no permission-denied UX here (Task 7) — reject with a typed error.
      const name = err && err.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') throw { code: 'denied' };
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
        throw { code: 'nodevice' };
      }
      throw { code: 'nodevice', cause: err };
    }

    this.video.srcObject = stream;
    await this.video.play();
    await new Promise((resolve) => {
      if (this.video.readyState >= 2 && this.video.videoWidth) resolve();
      else this.video.addEventListener('loadeddata', resolve, { once: true });
    });

    const { FilesetResolver, HandLandmarker, FaceLandmarker } =
      await import(`${CDN_BASE}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);

    [this.handLandmarker, this.faceLandmarker] = await Promise.all([
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 1,
      }),
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
      }),
    ]);

    // First detections take ~2s after model load — process frames until one lands.
    const start = performance.now();
    while (performance.now() - start < 6000) {
      const snap = this.poll();
      if (snap.hand.present || snap.head.present) break;
      await new Promise((r) => requestAnimationFrame(r));
    }
    this.ready = true;
  }

  setMode(m) {
    if (m === this.mode) return;
    if (m === 'hand-only') {
      // Begin easing the head from its current smoothed value toward the default.
      this.easeActive = true;
      this.easeFrom = { x: this.head.x, y: this.head.y, z: this.head.z };
      this.easeStart = performance.now();
    } else {
      this.easeActive = false;
    }
    this.mode = m;
  }

  setHandRange(r) {
    this.handRange = {
      minX: r.minX, maxX: r.maxX, minY: r.minY, maxY: r.maxY,
    };
  }

  poll() {
    const video = this.video;
    if (!video || !video.videoWidth) {
      return { hand: { ...this.hand }, head: { ...this.head }, mode: this.mode, procMs: this.procMs };
    }

    // Strictly-increasing timestamp; guard against duplicate frame times.
    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    const nowS = ts / 1000;
    const t0 = performance.now();

    // --- HAND (every frame) ---
    const handRes = this.handLandmarker.detectForVideo(video, ts);
    this._processHand(handRes, nowS);

    // --- HEAD ---
    // Face is the expensive model — run it on every 2nd frame from the start.
    this.frameCount++;
    const runFace = (this.frameCount % 2) === 0;
    if (this.mode === 'full') {
      if (runFace) {
        const faceRes = this.faceLandmarker.detectForVideo(video, ts);
        this._processHead(faceRes, nowS);
      }
    } else {
      // hand-only: no face inference; ease last smoothed value toward default.
      this._easeHead(ts);
    }

    // --- procMs rolling mean ---
    const dtProc = performance.now() - t0;
    this.procSamples.push(dtProc);
    if (this.procSamples.length > PROC_WINDOW) this.procSamples.shift();
    let sum = 0;
    for (let i = 0; i < this.procSamples.length; i++) sum += this.procSamples[i];
    this.procMs = sum / this.procSamples.length;

    return { hand: { ...this.hand }, head: { ...this.head }, mode: this.mode, procMs: this.procMs };
  }

  _processHand(res, nowS) {
    const lm = res && res.landmarks && res.landmarks[0];
    if (lm && lm.length) {
      // Palm centroid in normalized image space (0..1).
      let cx = 0, cy = 0;
      for (const id of PALM_IDS) { cx += lm[id].x; cy += lm[id].y; }
      cx /= PALM_IDS.length;
      cy /= PALM_IDS.length;

      // Mirror X — webcam is flipped relative to player intuition.
      cx = 1 - cx;

      // Map through calibrated hand range to -1..1, clamped.
      const r = this.handRange;
      const spanX = (r.maxX - r.minX) || 1;
      const spanY = (r.maxY - r.minY) || 1;
      let nx = ((cx - r.minX) / spanX) * 2 - 1;
      let ny = ((cy - r.minY) / spanY) * 2 - 1;
      nx = Math.max(-1, Math.min(1, nx));
      ny = Math.max(-1, Math.min(1, ny));

      const dt = this.hand.present ? Math.max(1e-3, nowS - this.handPrevSmoothed.t) : 1 / 30;
      const sx = this.handFx.filter(nx, dt);
      const sy = this.handFy.filter(ny, dt);

      // 60ms linear velocity prediction from smoothed positions.
      let px = sx, py = sy;
      if (this.hand.present) {
        const vx = (sx - this.handPrevSmoothed.x) / dt;
        const vy = (sy - this.handPrevSmoothed.y) / dt;
        px = Math.max(-1, Math.min(1, sx + vx * PREDICT_S));
        py = Math.max(-1, Math.min(1, sy + vy * PREDICT_S));
      }

      this.handPrevSmoothed = { x: sx, y: sy, t: nowS };
      // rawX/rawY: mirrored palm centroid in 0..1 image space, BEFORE range
      // mapping — calibration captures min/max of these to build handRange.
      this.hand = { x: px, y: py, present: true, rawX: cx, rawY: cy };
      this.handLastSeen = nowS;
    } else {
      // Lost: hold last value; drop present only after > 0.5s.
      if (nowS - this.handLastSeen > HAND_LOST_S) this.hand.present = false;
    }
  }

  _processHead(res, nowS) {
    const lm = res && res.faceLandmarks && res.faceLandmarks[0];
    if (!(lm && lm.length)) return;

    // Eye centers: prefer iris centers 468/473, fall back to outer eye corners 33/263.
    const left = lm[468] || lm[33];
    const right = lm[473] || lm[263];
    if (!left || !right) return;

    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;

    // Pixel coords.
    const lx = left.x * vw, ly = left.y * vh;
    const rx = right.x * vw, ry = right.y * vh;
    const eyeMidX = (lx + rx) / 2;
    const eyeMidY = (ly + ry) / 2;

    const ipdPx = Math.hypot(rx - lx, ry - ly) || 1;
    const focalPx = vw * 1.2;

    // Metric depth from interpupillary distance.
    const zM = (REAL_IPD_M * focalPx) / ipdPx;

    // Metric lateral offsets from image center, scaled by depth.
    const offX = eyeMidX - vw / 2;
    const offY = eyeMidY - vh / 2;
    let xM = (offX / focalPx) * zM;
    const yM = (offY / focalPx) * zM;

    // Mirror X — same flip as the hand.
    xM = -xM;

    const dt = this.headHadDetection ? Math.max(1e-3, nowS - this._headLastS) : 1 / 15;
    this.head = {
      x: this.headFx.filter(xM, dt),
      y: this.headFy.filter(yM, dt),
      z: this.headFz.filter(zM, dt),
      present: true,
    };
    this._headLastS = nowS;
    this.headHadDetection = true;
  }

  _easeHead(ts) {
    if (!this.easeActive) {
      this.head = { ...SCREEN.defaultEyeM, present: false };
      return;
    }
    const d = SCREEN.defaultEyeM;
    const t = Math.min(1, (ts - this.easeStart) / (EASE_S * 1000));
    // Smoothstep for a soft, snap-free landing.
    const e = t * t * (3 - 2 * t);
    this.head = {
      x: this.easeFrom.x + (d.x - this.easeFrom.x) * e,
      y: this.easeFrom.y + (d.y - this.easeFrom.y) * e,
      z: this.easeFrom.z + (d.z - this.easeFrom.z) * e,
      present: false,
    };
    if (t >= 1) this.easeActive = false;
  }
}
