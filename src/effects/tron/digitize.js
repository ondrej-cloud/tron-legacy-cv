// The digitizing laser (Flynn's arcade, TRON: Legacy): a peace sign charges
// a laser emitter at the hand, then a scan line sweeps down the frame and
// everything it passes over of the PERSON is digitized: their silhouette
// (from person segmentation) becomes a glowing contour in the hand's team
// colour, filled with scanlines, a grid and the edges of the camera image,
// while voxels peel off along the outline. After a moment the laser sweeps
// back up and rezzes the person back in.
//
// The layer can only add light, so the person "disappears" by dimming the
// camera's CSS filter; the shader puts the lost light back everywhere except
// on the digitized person, using the camera image and the same grade
// (grade.js), timed to the filter's CSS transition.
//
// Without a camera or a mask yet, the laser still sweeps and the tracked
// hands' skeletons are digitized instead.
import * as THREE from 'three';
import { HAND_CONNECTIONS } from '../../hands.js';
import { createSegmenter, coverTransform } from '../../segmentation.js';
import { additiveMaterial } from './gl.js';
import { createLines } from './lines.js';
import { GRADE, gradeMatrices, gradeChunk, cssEase } from './grade.js';
import { smoothstep } from './filters.js';

export const DIGITIZE = {
  charge: 0.5,            // s: the emitter powers up at the hand
  sweepIn: 1.3,           // s: the laser scans down, digitizing
  hold: 1.5,              // s: fully digitized
  sweepOut: 1.0,          // s: the laser scans back up, rezzing the person back in
  settle: 0.7,            // s: the camera filter eases back (its CSS transition is 0.6 s)
  dimBrightness: 0.1,     // camera brightness while digitizing (normal: GRADE.brightness)
  scanTop: 0.53,          // view y where the scan starts and ends, just off the frame
  peelPerSecond: 140,     // voxels peeling off the outline during the sweeps ...
  holdPeelPerSecond: 40,  // ... and while digitized
};

const PHASES = ['charge', 'sweepIn', 'hold', 'sweepOut', 'settle'];

const vertexShader = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  uniform sampler2D tVideo;
  uniform sampler2D tMask;
  uniform vec2 uCoverScale;
  uniform vec2 uCoverOffset;
  uniform vec2 uVideoTexel;
  uniform float uHasVideo;
  uniform float uHasMask;
  uniform float uAspect;
  uniform float uPixel;          // view units per pixel
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uScanY;          // view y of the scan line; above it is digitized
  uniform float uLaser;          // 0..1, the scan line and the emitter's beams
  uniform vec3 uEmitter;         // view x, y, strength
  uniform float uDigitized;      // 0..1, the digitized look
  uniform float uBrightnessNow;  // the camera filter's brightness right now ...
  uniform float uBrightness;     // ... and normally
  varying vec2 vUv;
  ${gradeChunk}

  float crispLine(float distance, float halfWidth) {
    return 1.0 - smoothstep(halfWidth, halfWidth + 1.2 * uPixel, distance);
  }

  float luminance(vec2 uv) {
    return dot(texture2D(tVideo, uv).rgb, vec3(0.299, 0.587, 0.114));
  }

  vec3 toLinear(vec3 color) {
    return pow(max(color, 0.0), vec3(2.2));
  }

  float segmentDistance(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    return length(p - (a + ab * t));
  }

  void main() {
    vec2 p = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5);
    // viewport (y down) -> video: mirrored, then the object-fit: cover crop
    vec2 video = vec2(1.0 - (vUv.x * uCoverScale.x + uCoverOffset.x), (1.0 - vUv.y) * uCoverScale.y + uCoverOffset.y);
    float mask = texture2D(tMask, video).r * uHasMask;
    vec2 videoUv = vec2(video.x, 1.0 - video.y);   // the video texture is stored bottom-up

    float digitized = smoothstep(uScanY - 0.003, uScanY + 0.003, p.y);
    float inside = smoothstep(0.42, 0.58, mask);
    float person = inside * digitized;

    // put back the light the dimmed camera filter takes away, except on the
    // digitized person (screen blending: out = 1 - (1 - camera)(1 - layer))
    vec3 restore = vec3(0.0);
    if (uHasVideo > 0.5 && uBrightnessNow < uBrightness - 0.001) {
      vec3 camera = texture2D(tVideo, videoUv).rgb;
      vec3 now = grade(camera, uBrightnessNow);
      vec3 normal = grade(camera, uBrightness);
      restore = toLinear(clamp((normal - now) / max(1.0 - now, 0.02), 0.0, 1.0)) * (1.0 - person);
    }

    // the outline: distance in pixels to the mask's 0.5 contour
    vec2 gradient = vec2(dFdx(mask), dFdy(mask));
    float edgePx = abs(mask - 0.5) / max(length(gradient), 1e-4);
    float contour = (1.0 - smoothstep(0.7, 1.9, edgePx)) * step(0.02, length(gradient));
    float halo = exp(-edgePx / 5.0) * step(0.004, length(gradient)) * 0.3;

    // inside: scanlines, a fine grid, and the edges of the camera image
    float scan = step(0.5, fract(p.y / (3.0 * uPixel)));
    vec2 cell = abs(fract(p / 0.022 - 0.5) - 0.5) * 0.022;
    float grid = max(crispLine(cell.x, 0.4 * uPixel), crispLine(cell.y, 0.4 * uPixel));
    float detail = 0.0;
    if (uHasVideo > 0.5 && person > 0.01) {
      vec2 o = uVideoTexel * 1.5;
      float tl = luminance(videoUv + vec2(-o.x, o.y)), tc = luminance(videoUv + vec2(0.0, o.y));
      float tr = luminance(videoUv + o), ml = luminance(videoUv - vec2(o.x, 0.0));
      float mr = luminance(videoUv + vec2(o.x, 0.0)), bl = luminance(videoUv - o);
      float bc = luminance(videoUv - vec2(0.0, o.y)), br = luminance(videoUv + vec2(o.x, -o.y));
      float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
      float gy = (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br);
      detail = smoothstep(0.08, 0.3, length(vec2(gx, gy)));
    }
    // a band of fresh, hot data just behind the scan line
    float fresh = exp(-max(p.y - uScanY, 0.0) / 0.04) * uLaser;
    // slow bands of data running down through the digitized body
    float flow = 0.6 + 0.4 * sin(p.y * 60.0 + uTime * 6.0);
    vec3 hot = mix(uColor, vec3(1.0), 0.6);
    vec3 body = uColor * (scan * 0.08 * flow + grid * 0.28 + detail * 0.7) + hot * fresh * 0.35;
    vec3 col = (hot * contour * 2.0 + uColor * halo) * digitized * uHasMask + body * person;
    col *= uDigitized;

    // the laser: a white-hot scan line across the frame, brighter on the person
    float lineDistance = abs(p.y - uScanY);
    float line = crispLine(lineDistance, 0.6 * uPixel) * (1.1 + 1.4 * inside) + exp(-lineDistance / 0.004) * 0.22;
    col += hot * line * uLaser;
    // the emitter and the edges of the laser sheet fanning out to the scan line
    vec2 emitter = uEmitter.xy;
    float fan = crispLine(segmentDistance(p, emitter, vec2(-uAspect * 0.5, uScanY)), 0.5 * uPixel)
      + crispLine(segmentDistance(p, emitter, vec2(uAspect * 0.5, uScanY)), 0.5 * uPixel);
    col += uColor * fan * 0.5 * uLaser;
    float r = length(p - emitter);
    float glint = exp(-abs(p.y - emitter.y) / (1.2 * uPixel)) * step(r, 0.08) + exp(-abs(p.x - emitter.x) / (1.2 * uPixel)) * step(r, 0.05);
    col += hot * (exp(-r * r / 0.00008) * 2.5 + exp(-r / 0.02) * 0.4 + glint * (1.0 - r / 0.08)) * uEmitter.z;

    gl_FragColor = vec4(col + restore, 1.0);
  }
`;

export function createDigitizer({ hands, view, voxels, flashes, log }) {
  const segmenter = createSegmenter(hands.video);
  segmenter.load();   // in the background; the first sequence may run without a mask

  const maskTexture = new THREE.DataTexture(new Uint8Array(4), 2, 2, THREE.RedFormat, THREE.UnsignedByteType);
  maskTexture.minFilter = THREE.LinearFilter;
  maskTexture.magFilter = THREE.LinearFilter;
  maskTexture.needsUpdate = true;
  let videoTexture = null;
  let maskFrame = 0;

  const uniforms = {
    tVideo: { value: maskTexture },
    tMask: { value: maskTexture },
    uCoverScale: { value: new THREE.Vector2(1, 1) },
    uCoverOffset: { value: new THREE.Vector2() },
    uVideoTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    uHasVideo: { value: 0 },
    uHasMask: { value: 0 },
    uAspect: { value: 1 },
    uPixel: { value: 1 / 720 },
    uTime: { value: 0 },
    uColor: { value: new THREE.Color() },
    uScanY: { value: 1 },
    uLaser: { value: 0 },
    uEmitter: { value: new THREE.Vector3() },
    uDigitized: { value: 0 },
    uBrightnessNow: { value: GRADE.brightness },
    uBrightness: { value: GRADE.brightness },
    uGrade: { value: gradeMatrices() },
    uContrast: { value: GRADE.contrast },
  };
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), additiveMaterial(vertexShader, fragmentShader, uniforms));
  quad.frustumCulled = false;
  quad.visible = false;
  const skeletons = createLines(view, 64);
  skeletons.mesh.renderOrder = 2;
  const group = new THREE.Group();
  group.add(quad, skeletons.mesh);

  // the camera filter's brightness, and its CSS transition
  const filter = { from: GRADE.brightness, to: GRADE.brightness, since: -Infinity };
  let sequence = null;
  let now = 0;
  let count = 0;

  function setBrightness(target) {
    if (target === filter.to) return;
    filter.from = brightnessNow();
    filter.to = target;
    filter.since = now;
  }

  function brightnessNow() {
    return filter.from + (filter.to - filter.from) * cssEase((now - filter.since) / GRADE.transition);
  }

  // owner: 'left' | 'right'; emitter: view units; color: THREE.Color
  function start(owner, emitter, color) {
    if (sequence) return false;
    sequence = { owner, emitter: { ...emitter }, color: color.clone(), start: now, peelDebt: 0 };
    uniforms.uColor.value.copy(color);
    count++;
    log(`digitize ${owner[0].toUpperCase()}`);
    flashes.spawn({ x: emitter.x, y: emitter.y, size: 0.08, duration: 0.5, color, glint: 1 });
    return true;
  }

  // which phase, and how far into it (0..1)
  function phaseAt(elapsed) {
    let begin = 0;
    for (const name of PHASES) {
      const length = DIGITIZE[name];
      if (elapsed < begin + length) return { name, progress: (elapsed - begin) / length };
      begin += length;
    }
    return null;
  }

  function uploadMask() {
    const mask = segmenter.mask;
    if (!mask.data || mask.frame === maskFrame) return;
    maskFrame = mask.frame;
    const image = maskTexture.image;
    if (image.width !== mask.width || image.height !== mask.height) {
      maskTexture.image = { data: mask.data, width: mask.width, height: mask.height };
      maskTexture.dispose();   // reallocate at the new size
    } else {
      image.data = mask.data;
    }
    maskTexture.needsUpdate = true;
  }

  // mask pixel -> view units (inverse of the cover transform)
  function maskToView(column, row, cover) {
    const mask = segmenter.mask;
    const videoX = (column + 0.5) / mask.width;
    const videoY = (row + 0.5) / mask.height;
    const viewportX = (1 - videoX - cover.offset.x) / cover.scale.x;
    const viewportY = (videoY - cover.offset.y) / cover.scale.y;
    return { x: (viewportX - 0.5) * view.aspect, y: 0.5 - viewportY };
  }

  function viewToMaskRow(viewY, cover) {
    const viewportY = 0.5 - viewY;
    return Math.round((viewportY * cover.scale.y + cover.offset.y) * segmenter.mask.height - 0.5);
  }

  function peel(point, color, speed) {
    voxels.spawn({
      x: point.x + (Math.random() - 0.5) * 0.03,
      y: point.y + (Math.random() - 0.5) * 0.01,
      vx: (Math.random() - 0.5) * 0.12 * speed,
      vy: (0.04 + Math.random() * 0.12) * speed,
      size: 0.005 + Math.random() * 0.006,
      life: 0.7 + Math.random() * 0.8,
      heat: 0.3,
      color,
    });
  }

  // Voxels peel off where the scan line crosses the outline, or (holding)
  // from random points along the outline.
  function peelOff(phase, dt, cover) {
    const mask = segmenter.mask;
    if (!mask.data || !uniforms.uHasMask.value) return;
    const sweeping = phase === 'sweepIn' || phase === 'sweepOut';
    sequence.peelDebt += dt * (sweeping ? DIGITIZE.peelPerSecond : DIGITIZE.holdPeelPerSecond);
    if (sequence.peelDebt < 1) return;
    const { data, width, height } = mask;
    const edges = [];
    if (sweeping) {
      const row = viewToMaskRow(uniforms.uScanY.value, cover);
      if (row < 0 || row >= height) return;
      for (let column = 1; column < width; column++) {
        const a = data[row * width + column - 1] > 127;
        const b = data[row * width + column] > 127;
        if (a !== b) edges.push([column, row]);
      }
    } else {
      for (let attempt = 0; attempt < 200 && edges.length < 24; attempt++) {
        const column = 1 + Math.floor(Math.random() * (width - 2));
        const row = 1 + Math.floor(Math.random() * (height - 2));
        const center = data[row * width + column] > 127;
        if (center && (data[row * width + column + 1] <= 127 || data[(row - 1) * width + column] <= 127)) {
          edges.push([column, row]);
        }
      }
    }
    if (!edges.length) return;
    // spread over the edges found, so voxels don't pile up into one bright spot
    const count = Math.min(Math.floor(sequence.peelDebt), sweeping ? edges.length * 2 : edges.length);
    sequence.peelDebt = 0;
    for (let index = 0; index < count; index++) {
      const [column, row] = edges[(index + Math.floor(Math.random() * edges.length)) % edges.length];
      peel(maskToView(column, row, cover), sequence.color, sweeping ? 1.6 : 1);
    }
  }

  function drawSkeletons(strength) {
    skeletons.begin();
    if (strength > 0.01) {
      for (const hand of hands.list) {
        if (!hand.landmarks) continue;
        const points = hand.landmarks.map((point) => ({ x: (point.x - 0.5) * view.aspect, y: 0.5 - point.y }));
        for (const [a, b] of HAND_CONNECTIONS) {
          const top = Math.min(points[a].y, points[b].y);
          const reached = smoothstep(uniforms.uScanY.value - 0.01, uniforms.uScanY.value + 0.01, top);
          if (reached > 0.01) skeletons.add(points[a], points[b], sequence.color, 1.4 * reached * strength, 1.4);
        }
      }
    }
    skeletons.end();
  }

  return {
    group,
    start,
    get active() {
      return Boolean(sequence);
    },
    get count() {
      return count;
    },
    get segmenterStatus() {
      return segmenter.status;
    },
    get maskFrames() {
      return segmenter.mask.frame;
    },
    get segmenterRuns() {
      return segmenter.runs;
    },
    // the camera brightness it asks for
    get brightness() {
      return filter.to;
    },
    // stop at once (the Grid shuts down): the camera is left to whoever dims it next
    cancel() {
      if (!sequence) return;
      sequence = null;
      filter.from = filter.to = GRADE.brightness;
      filter.since = -Infinity;
    },
    update(seconds, dt, nowMs) {
      now = seconds;
      const phase = sequence && phaseAt(now - sequence.start);
      if (sequence && !phase) sequence = null;
      quad.visible = Boolean(sequence) || brightnessNow() < GRADE.brightness - 0.001;
      if (!quad.visible) {
        drawSkeletons(0);
        return;
      }
      const video = hands.video;
      const hasVideo = hands.hasCamera && video.readyState >= 2 && video.videoWidth > 0;
      if (hasVideo && !videoTexture) {
        videoTexture = new THREE.VideoTexture(video);
        videoTexture.minFilter = THREE.LinearFilter;
        videoTexture.generateMipmaps = false;
        uniforms.tVideo.value = videoTexture;
      }
      if (sequence && hasVideo) segmenter.update(nowMs);
      uploadMask();
      const cover = coverTransform(video, view.width, view.height);
      uniforms.uCoverScale.value.set(cover.scale.x, cover.scale.y);
      uniforms.uCoverOffset.value.set(cover.offset.x, cover.offset.y);
      if (hasVideo) uniforms.uVideoTexel.value.set(1 / video.videoWidth, 1 / video.videoHeight);
      uniforms.uHasVideo.value = hasVideo ? 1 : 0;
      uniforms.uHasMask.value = hasVideo && segmenter.mask.frame > 0 ? 1 : 0;
      uniforms.uAspect.value = view.aspect;
      uniforms.uPixel.value = 1 / view.height;
      uniforms.uTime.value = now;

      const top = DIGITIZE.scanTop;
      let scanY = top + 0.1;
      let laser = 0;
      let digitized = 0;
      let emitter = 0;
      if (phase) {
        const { name, progress } = phase;
        if (name === 'charge') {
          emitter = smoothstep(0, 1, progress);
          laser = 0;
        } else if (name === 'sweepIn') {
          scanY = top - 2 * top * progress;
          laser = 1;
          digitized = 1;
          emitter = 1;
        } else if (name === 'hold') {
          scanY = -top - 0.1;
          laser = Math.max(0, 1 - progress * 6);
          digitized = 1;
          emitter = Math.max(0.25, 1 - progress * 3);
        } else if (name === 'sweepOut') {
          scanY = -top + 2 * top * progress;
          laser = 1;
          digitized = 1;
          emitter = 1;
        } else {
          emitter = Math.max(0, 1 - progress * 3);
        }
        // the camera dims from the start (the restore pass hides it where nothing
        // is digitized yet) and comes back once the person is rezzed back in
        setBrightness(name === 'settle' ? GRADE.brightness : DIGITIZE.dimBrightness);
        peelOff(name, dt, cover);
        uniforms.uEmitter.value.set(sequence.emitter.x, sequence.emitter.y, emitter);
      } else {
        uniforms.uEmitter.value.z = 0;
      }
      uniforms.uScanY.value = scanY;
      uniforms.uLaser.value = laser;
      uniforms.uDigitized.value = digitized;
      uniforms.uBrightnessNow.value = brightnessNow();
      drawSkeletons(digitized);
    },
  };
}
