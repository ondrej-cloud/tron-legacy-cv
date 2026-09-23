// Hand input for Stardust.
//
// The webcam always runs (it is the full-screen background). Hands come from
// one of three sources:
//   camera — MediaPipe HandLandmarker on the webcam (default)
//   mouse  — the pointer is the right hand, mouse button held = pinch
//   demo   — scripted hands (an effect can supply its own script)
//
// Positions are in VIEWPORT space as the user sees it: x 0..1 left -> right,
// y 0..1 top -> bottom, mirrored like a selfie and corrected for the
// object-fit: cover crop of the full-screen video. Hands live in two fixed
// slots, `left` and `right`, assigned by which side of the screen they are on.
// Every hand also carries finger-level analysis from gestures.js.

import { analyzeHand, palmFacingFor, poseToLandmarks, blendPoses, POSES, THRESHOLDS } from './gestures.js';

const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// hysteresis so `closed` doesn't flicker around a single threshold
const CLOSE_BELOW = 0.18;
const OPEN_ABOVE = 0.32;
// keep a hand alive briefly through tracking dropouts
const LOST_AFTER_MS = 250;
// smoothing time constants (seconds)
const POSITION_SMOOTHING = 0.045;
const PINCH_SMOOTHING = 0.05;
const VELOCITY_SMOOTHING = 0.08;
// procedural hands: palm length as a fraction of the viewport height
const SYNTHETIC_PALM_SIZE = 0.13;
// two hands at least this far apart (viewport x) teach us how MediaPipe labels them
const CALIBRATION_MIN_GAP = 0.15;
const CALIBRATION_LIMIT = 60;

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const TIP_INDICES = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };

function createHand(id) {
  return {
    id,                 // 'left' | 'right' (screen side)
    visible: false,
    x: id === 'left' ? 0.3 : 0.7,  // pinch midpoint (between thumb and index tips)
    y: 0.5,
    vx: 0, vy: 0,       // velocity in viewport units per second
    pinch: 1,           // 0 = thumb and index touching, 1 = spread wide
    pinchVelocity: 0,   // d(pinch)/dt, large positive = fingers flicked open
    closed: false,      // pinch < threshold (with hysteresis)
    closedMs: 0,        // how long it has been closed so far
    justClosed: false,  // true for exactly one update() after closing
    justOpened: false,  // true for exactly one update() after opening
    releasedChargeMs: 0,// on justOpened: how long it was held closed
    thumb: { x: 0, y: 0 },
    index: { x: 0, y: 0 },
    palm: { x: 0, y: 0 },
    tips: null,         // { thumb, index, middle, ring, pinky } in viewport space
    landmarks: null,    // 21 x {x, y, z} in viewport space
    physical: id,       // which real hand this is: 'left' | 'right'
    fingers: null,      // analyzeHand() result: extended, curl, touch, count, ...
    palmFacing: false,
    roll: 0,            // 0 = fingers up, positive = tilted right
    size: 0,            // palm length as a fraction of the viewport height
    gesture: 'none',    // debounced: open, fist, point, peace, rock, shaka, ok, pinch, thumbsUp, three, other
    previousGesture: 'none',
    gestureSince: 0,
    gestureChanged: false, // true for one update() when `gesture` changes
    touching: { index: false, middle: false, ring: false, pinky: false },
    taps: [],           // fingers the thumb started touching this update()
    lastSeenMs: -Infinity,
  };
}

function expSmooth(current, target, dt, timeConstant) {
  return current + (target - current) * (1 - Math.exp(-dt / timeConstant));
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function pinchOpenness(ratio) {
  return clamp01((ratio - THRESHOLDS.pinchRatioClosed) / (THRESHOLDS.pinchRatioOpen - THRESHOLDS.pinchRatioClosed));
}

// Default demo: both hands drift on Lissajous paths and run a 7 s pinch
// cycle (open 3 s -> close 0.5 s -> hold 2.7 s -> flick open 0.3 s). The right
// hand stays open for its first 3.5 s, so it is closed 7.0-9.7 s while the
// left hand is closed 3.5-6.2 s.
export function pinchDemo(t) {
  const cyclePinch = (phase) => {
    if (phase < 0) return 1;
    const local = phase % 7;
    if (local < 3) return 1;
    if (local < 3.5) return 1 - (local - 3) / 0.5;
    if (local < 6.2) return 0;
    if (local < 6.5) return (local - 6.2) / 0.3;
    return 1;
  };
  const leftPinch = cyclePinch(t);
  const rightPinch = cyclePinch(t - 3.5);
  return [
    { x: 0.3 + 0.1 * Math.sin(t * 0.5), y: 0.5 + 0.14 * Math.sin(t * 0.7), physical: 'left',
      pinch: leftPinch, pose: blendPoses(POSES.pinch, POSES.open, leftPinch) },
    { x: 0.7 + 0.1 * Math.sin(t * 0.43 + 1), y: 0.5 + 0.14 * Math.cos(t * 0.6), physical: 'right',
      pinch: rightPinch, pose: blendPoses(POSES.pinch, POSES.open, rightPinch) },
  ];
}

export class Hands {
  constructor({ mode } = {}) {
    const params = new URLSearchParams(location.search);
    this.mode = mode
      || (params.has('demo') ? 'demo' : params.has('mouse') ? 'mouse' : 'camera');
    this.status = 'camera off';
    this.started = false;
    this.left = createHand('left');
    this.right = createHand('right');
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.hasCamera = false;
    this.landmarker = null;      // main-thread fallback
    this.trackerWorker = null;   // preferred: tracking runs in src/tracker-worker.js
    this.trackerMode = null;     // 'worker' | 'main thread', once loaded
    this.workerBusy = false;
    this.workerResult = null;
    this.trackerLoading = null;
    this.lastVideoTime = -1;
    this.lastUpdateMs = performance.now();
    this.demoStartMs = performance.now();
    this.demoScript = pinchDemo;
    // > 0: MediaPipe's handedness labels need swapping, < 0: they don't
    // (they matched the real hand when tested on unmirrored webcam frames).
    // Re-learned from every frame with two hands side by side.
    this.labelSwapScore = -1;
    this.mouse = { x: 0.7, y: 0.5, down: false, seen: false };
    this._bindMouse();
  }

  get list() {
    return [this.left, this.right].filter((hand) => hand.visible);
  }

  // Asks for the camera. Call it from a user action (a button) so the
  // browser's permission prompt shows up when the user expects it. Returns
  // immediately: `cameraReady` resolves to true/false once the user answers,
  // `ready` when the hand tracker has loaded as well.
  start() {
    if (this.started) return this;
    this.started = true;
    this.cameraReady = this._openCamera();
    this.ready = this.cameraReady.then((granted) => {
      if (granted && this.mode === 'camera') return this._loadTracker();
      this._refreshStatus();
      return undefined;
    });
    return this;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'demo') this.demoStartMs = performance.now();
    if (mode === 'camera') {
      if (!this.started) this.start();   // e.g. demo first, camera later
      else this._loadTracker();
    }
    this._refreshStatus();
  }

  // An effect can script its own demo: script(tSeconds) returns hands as
  // { x, y, physical, pose, pinch?, roll?, size? } with x, y = pinch midpoint
  // in viewport space. Restarts the demo clock.
  setDemoScript(script) {
    this.demoScript = script ?? pinchDemo;
    this.demoStartMs = performance.now();
  }

  _refreshStatus() {
    if (this.mode !== 'camera') this.status = this.mode;
    else if (this.landmarker || this.trackerWorker) this.status = 'ready';
  }

  async _openCamera() {
    this.status = 'requesting camera';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' } });
      this.video.srcObject = stream;
      await this.video.play().catch(() => {});
      this.hasCamera = true;
      return true;
    } catch (cameraError) {
      console.warn('camera unavailable, falling back to mouse', cameraError);
      if (this.mode === 'camera') this.mode = 'mouse';
      this.status = 'no camera, using mouse';
      return false;
    }
  }

  // MediaPipe is only downloaded the first time tracking is actually needed.
  // It runs in a worker when the browser allows it, so model loading and
  // detection never block the page; otherwise on the main thread.
  _loadTracker() {
    if (!this.hasCamera || this.landmarker || this.trackerWorker) return Promise.resolve();
    this.trackerLoading ??= (async () => {
      this.status = 'loading hand tracker';
      try {
        await this._startWorker();
        this.trackerMode = 'worker';
        this._refreshStatus();
        return;
      } catch (workerError) {
        console.warn('hand tracking worker unavailable, tracking on the main thread', workerError);
      }
      try {
        const { HandLandmarker, FilesetResolver } = await import(VISION_URL);
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        const options = {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          numHands: 2,
          runningMode: 'VIDEO',
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        };
        try {
          this.landmarker = await HandLandmarker.createFromOptions(fileset, options);
        } catch (gpuError) {
          console.warn('GPU delegate failed, retrying on CPU', gpuError);
          options.baseOptions.delegate = 'CPU';
          this.landmarker = await HandLandmarker.createFromOptions(fileset, options);
        }
        this.trackerMode = 'main thread';
        this._refreshStatus();
      } catch (trackerError) {
        console.error('hand tracker failed, falling back to mouse', trackerError);
        this.mode = 'mouse';
        this.status = 'tracker failed, using mouse';
      }
    })();
    return this.trackerLoading;
  }

  _startWorker() {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./tracker-worker.js', import.meta.url), { type: 'module' });
      const fail = (error) => {
        worker.terminate();
        reject(error);
      };
      const timeout = setTimeout(() => fail(new Error('worker did not start in time')), 30000);
      worker.onerror = (event) => {
        clearTimeout(timeout);
        fail(new Error(event.message || 'worker error'));
      };
      worker.onmessage = ({ data }) => {
        if (data.type === 'error') {
          clearTimeout(timeout);
          fail(new Error(data.message));
        } else if (data.type === 'ready') {
          clearTimeout(timeout);
          worker.onmessage = ({ data: message }) => this._onWorkerMessage(message);
          worker.onerror = (event) => console.error('hand tracking worker failed', event.message);
          this.trackerWorker = worker;
          resolve();
        }
      };
      worker.postMessage({ type: 'init', visionUrl: VISION_URL, wasmUrl: WASM_URL, modelUrl: MODEL_URL });
    });
  }

  _onWorkerMessage(message) {
    if (message.type === 'result') this.workerResult = message;
    else if (message.type === 'frameError') console.warn('hand tracking frame failed', message.message);
    this.workerBusy = false;
  }

  // One frame in flight at a time: a new frame goes out only once the
  // previous result is back, which keeps the latency at about one frame.
  _sendFrameToWorker(nowMs) {
    const video = this.video;
    if (this.workerBusy || video.readyState < 2 || video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;
    this.workerBusy = true;
    createImageBitmap(video)
      .then((frame) => this.trackerWorker.postMessage({ type: 'frame', frame, timestamp: nowMs }, [frame]))
      .catch(() => { this.workerBusy = false; });
  }

  _bindMouse() {
    const toViewport = (event) => {
      this.mouse.x = event.clientX / window.innerWidth;
      this.mouse.y = event.clientY / window.innerHeight;
      this.mouse.seen = true;
    };
    window.addEventListener('pointermove', toViewport);
    window.addEventListener('pointerdown', (event) => { toViewport(event); this.mouse.down = true; });
    window.addEventListener('pointerup', () => { this.mouse.down = false; });
  }

  // Call once per animation frame. Returns this (read .left / .right / .list).
  update(nowMs = performance.now()) {
    const dt = Math.min(0.1, Math.max(1e-3, (nowMs - this.lastUpdateMs) / 1000));
    this.lastUpdateMs = nowMs;
    let observations = [];
    if (this.mode === 'camera') observations = this._observeCamera(nowMs);
    else if (this.mode === 'mouse') observations = this._observeMouse();
    else if (this.mode === 'demo') observations = this._observeDemo(nowMs);
    if (observations !== null) this._assign(observations, nowMs);
    for (const hand of [this.left, this.right]) this._settle(hand, nowMs, dt);
    return this;
  }

  // Video-frame coords (0..1, unmirrored) -> viewport coords, matching a
  // mirrored video shown full-screen with object-fit: cover.
  _videoToViewport(point) {
    const video = this.video;
    const scale = Math.max(window.innerWidth / video.videoWidth, window.innerHeight / video.videoHeight);
    const shownWidth = video.videoWidth * scale;
    const shownHeight = video.videoHeight * scale;
    return {
      x: ((1 - point.x) * shownWidth - (shownWidth - window.innerWidth) / 2) / window.innerWidth,
      y: (point.y * shownHeight - (shownHeight - window.innerHeight) / 2) / window.innerHeight,
      z: point.z,
    };
  }

  // null = no new tracking result this tick (keep last assignment)
  _observeCamera(nowMs) {
    if (this.trackerWorker) {
      this._sendFrameToWorker(nowMs);
      const result = this.workerResult;
      this.workerResult = null;
      return result ? this._toObservations(result.landmarks, result.handedness) : null;
    }
    const video = this.video;
    if (!this.landmarker || video.readyState < 2 || video.currentTime === this.lastVideoTime) {
      return null;
    }
    this.lastVideoTime = video.currentTime;
    const result = this.landmarker.detectForVideo(video, nowMs);
    return this._toObservations(result.landmarks ?? [], result.handedness ?? result.handednesses ?? []);
  }

  _toObservations(landmarkSets, handedness) {
    const video = this.video;
    const aspect = video.videoWidth / video.videoHeight;
    return landmarkSets.map((raw, handIndex) => {
      // hand space: mirrored, all axes in units of the frame height
      const points = raw.map((point) => ({ x: (1 - point.x) * aspect, y: point.y, z: point.z * aspect }));
      // raw label; whether it needs swapping for our unmirrored input is learned in _assign
      const label = handedness[handIndex]?.[0]?.categoryName === 'Left' ? 'left' : 'right';
      const analysis = analyzeHand(points, 'right');
      const pinchRatio = analysis.touch.index;
      const landmarks = raw.map((point) => this._videoToViewport(point));
      return {
        landmarks,
        label,
        physical: null,
        analysis,
        size: analysis.palmSize * this._viewportScale(),
        pinch: pinchOpenness(pinchRatio),
      };
    });
  }

  // frame-height units -> viewport-height units under the cover crop
  _viewportScale() {
    const video = this.video;
    const scale = Math.max(window.innerWidth / video.videoWidth, window.innerHeight / video.videoHeight);
    return video.videoHeight * scale / window.innerHeight;
  }

  _observeMouse() {
    if (!this.mouse.seen) return [];
    const pinch = this.mouse.down ? 0 : 1;
    return [this._synthetic({ x: this.mouse.x, y: this.mouse.y, physical: 'right', pinch,
      pose: this.mouse.down ? POSES.pinch : POSES.open })];
  }

  _observeDemo(nowMs) {
    const t = (nowMs - this.demoStartMs) / 1000;
    return this.demoScript(t).map((spec) => this._synthetic(spec));
  }

  // Procedural hand whose pinch midpoint lands on (x, y) in viewport space.
  _synthetic({ x, y, physical = 'right', pose = POSES.open, pinch, roll = 0, size = SYNTHETIC_PALM_SIZE,
    palmFacing = true }) {
    const aspect = window.innerWidth / window.innerHeight;
    let points = poseToLandmarks({ x: x * aspect, y, size, roll, physical, palmFacing }, pose);
    const midX = (points[4].x + points[8].x) / 2;
    const midY = (points[4].y + points[8].y) / 2;
    points = points.map((point) => ({ x: point.x + x * aspect - midX, y: point.y + y - midY, z: point.z }));
    const analysis = analyzeHand(points, physical);
    const pinchRatio = analysis.touch.index;
    return {
      landmarks: points.map((point) => ({ x: point.x / aspect, y: point.y, z: point.z })),
      physical,
      analysis,
      size,
      pinch: pinch ?? pinchOpenness(pinchRatio),
    };
  }

  // Map observations to the left/right slots by screen side; a single hand
  // stays in the slot it already occupies if that slot was just seen nearby.
  _assign(observations, nowMs) {
    const sorted = [...observations].sort((a, b) => midX(a) - midX(b));
    const targets = new Map();
    if (sorted.length >= 2) {
      targets.set(this.left, sorted[0]);
      targets.set(this.right, sorted[sorted.length - 1]);
      // two hands side by side: the one on the left of the mirrored view is the
      // real left hand (unless the arms are crossed), which also tells us
      // whether MediaPipe's labels are swapped
      const pair = [sorted[0], sorted[sorted.length - 1]];
      if (pair.every((observation) => observation.label) &&
          midX(pair[1]) - midX(pair[0]) > CALIBRATION_MIN_GAP) {
        const swapped = pair[0].label === 'right' && pair[1].label === 'left';
        const straight = pair[0].label === 'left' && pair[1].label === 'right';
        if (swapped || straight) {
          this.labelSwapScore = Math.max(-CALIBRATION_LIMIT,
            Math.min(CALIBRATION_LIMIT, this.labelSwapScore + (swapped ? 1 : -1)));
        }
      }
      pair[0].physical ??= 'left';
      pair[1].physical ??= 'right';
    } else if (sorted.length === 1) {
      const observation = sorted[0];
      const recent = [this.left, this.right]
        .filter((hand) => hand.visible && nowMs - hand.lastSeenMs < LOST_AFTER_MS)
        .sort((a, b) => distanceTo(a, observation) - distanceTo(b, observation));
      const slot = recent.length ? recent[0] : (midX(observation) < 0.5 ? this.left : this.right);
      targets.set(slot, observation);
    }
    for (const [hand, observation] of targets) {
      if (!observation.physical) {
        const swap = this.labelSwapScore > 0;
        observation.physical = swap === (observation.label === 'left') ? 'right' : 'left';
      }
      observation.analysis.palmFacing = palmFacingFor(observation.physical, observation.analysis.palmNormalZ);
      hand.target = observation;
      hand.lastSeenMs = nowMs;
    }
  }

  _settle(hand, nowMs, dt) {
    hand.justClosed = false;
    hand.justOpened = false;
    hand.gestureChanged = false;
    hand.taps = [];
    const alive = nowMs - hand.lastSeenMs < LOST_AFTER_MS && hand.target;
    if (!alive) {
      if (hand.visible) {
        hand.visible = false;
        if (hand.closed) {           // losing a closed hand counts as releasing it
          hand.closed = false;
          hand.justOpened = true;
          hand.releasedChargeMs = hand.closedMs;
        }
        hand.closedMs = 0;
        hand.vx = hand.vy = hand.pinchVelocity = 0;
        this._setGesture(hand, 'none', nowMs);
        for (const finger of Object.keys(hand.touching)) hand.touching[finger] = false;
      }
      return;
    }
    const observation = hand.target;
    const landmarks = observation.landmarks;
    const targetX = (landmarks[4].x + landmarks[8].x) / 2;
    const targetY = (landmarks[4].y + landmarks[8].y) / 2;
    if (!hand.visible) {             // fresh hand: snap instead of sliding in
      hand.visible = true;
      hand.x = targetX;
      hand.y = targetY;
      hand.pinch = observation.pinch;
      hand.vx = hand.vy = hand.pinchVelocity = 0;
    }
    const previousX = hand.x;
    const previousY = hand.y;
    const previousPinch = hand.pinch;
    hand.x = expSmooth(hand.x, targetX, dt, POSITION_SMOOTHING);
    hand.y = expSmooth(hand.y, targetY, dt, POSITION_SMOOTHING);
    hand.pinch = expSmooth(hand.pinch, observation.pinch, dt, PINCH_SMOOTHING);
    hand.vx = expSmooth(hand.vx, (hand.x - previousX) / dt, dt, VELOCITY_SMOOTHING);
    hand.vy = expSmooth(hand.vy, (hand.y - previousY) / dt, dt, VELOCITY_SMOOTHING);
    hand.pinchVelocity = expSmooth(hand.pinchVelocity, (hand.pinch - previousPinch) / dt,
      dt, VELOCITY_SMOOTHING);
    hand.landmarks = landmarks;
    hand.thumb = landmarks[4];
    hand.index = landmarks[8];
    hand.palm = landmarks[9];
    hand.tips = {};
    for (const [finger, index] of Object.entries(TIP_INDICES)) hand.tips[finger] = landmarks[index];
    hand.physical = observation.physical;
    hand.label = observation.label ?? null;
    hand.fingers = observation.analysis;
    hand.palmFacing = observation.analysis.palmFacing;
    hand.roll = observation.analysis.roll;
    hand.size = observation.size;

    if (!hand.closed && hand.pinch < CLOSE_BELOW) {
      hand.closed = true;
      hand.justClosed = true;
      hand.closedMs = 0;
    } else if (hand.closed && hand.pinch > OPEN_ABOVE) {
      hand.closed = false;
      hand.justOpened = true;
      hand.releasedChargeMs = hand.closedMs;
      hand.closedMs = 0;
    }
    if (hand.closed) hand.closedMs += dt * 1000;

    for (const [finger, ratio] of Object.entries(observation.analysis.touch)) {
      if (!hand.touching[finger] && ratio < THRESHOLDS.touchOn) {
        hand.touching[finger] = true;
        hand.taps.push(finger);
      } else if (hand.touching[finger] && ratio > THRESHOLDS.touchOff) {
        hand.touching[finger] = false;
      }
    }

    // debounce: the raw gesture has to persist before it takes over
    const raw = observation.analysis.gesture;
    if (raw !== hand.pendingGesture) {
      hand.pendingGesture = raw;
      hand.pendingSince = nowMs;
    }
    if (raw !== hand.gesture && nowMs - hand.pendingSince >= THRESHOLDS.gestureHoldMs) {
      this._setGesture(hand, raw, nowMs);
    }
  }

  _setGesture(hand, gesture, nowMs) {
    if (gesture === hand.gesture) return;
    hand.previousGesture = hand.gesture;
    hand.gesture = gesture;
    hand.gestureSince = nowMs;
    hand.gestureChanged = true;
  }
}

function midX(observation) {
  return (observation.landmarks[4].x + observation.landmarks[8].x) / 2;
}

function distanceTo(hand, observation) {
  const landmarks = observation.landmarks;
  return Math.hypot(hand.x - midX(observation), hand.y - (landmarks[4].y + landmarks[8].y) / 2);
}
