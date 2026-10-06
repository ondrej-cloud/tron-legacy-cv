// Finger-level analysis of the 21 MediaPipe hand landmarks, and a small
// procedural hand that produces the same landmarks for the demo and mouse
// modes, so every gesture can be exercised without a camera.
//
// Analysis runs in "hand space": mirrored like the screen (selfie view),
// y down, and x/z scaled so that all three axes share one unit. Results are
// relative to palm size, so they don't depend on distance from the camera.
//
// Landmark indices: 0 wrist; thumb 1-4; index 5-8; middle 9-12; ring 13-16;
// pinky 17-20 (each finger: knuckle, middle joint, last joint, tip).

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const CHAINS = {
  thumb: [1, 2, 3, 4],
  index: [0, 5, 6, 7, 8],
  middle: [0, 9, 10, 11, 12],
  ring: [0, 13, 14, 15, 16],
  pinky: [0, 17, 18, 19, 20],
};
const TIPS = { index: 8, middle: 12, ring: 16, pinky: 20 };

// Every tunable threshold of the recognition, in one mutable object so the
// tuning panel (src/tuning.js, key G) can adjust them live.
export const THRESHOLDS = {
  // a finger counts as extended when its bones are this aligned (mean cosine)
  extendedStraightness: 0.55,
  thumbStraightness: 0.6,
  // thumb tip this far from the index knuckle (in palm sizes) = thumb sticks out
  thumbOutDistance: 0.55,
  // thumbs up: thumb tip this far above its knuckle (in palm sizes)
  thumbUpLift: 0.4,
  // thumb tip to fingertip, in palm sizes: touching below ON, released above OFF
  touchOn: 0.3,
  touchOff: 0.45,
  // pinch openness: thumb-index gap in palm sizes mapped from closed..open to 0..1
  pinchRatioClosed: 0.25,
  pinchRatioOpen: 1.2,
  // a new gesture must hold this long before it replaces the current one
  gestureHoldMs: 90,
};
export const DEFAULT_THRESHOLDS = { ...THRESHOLDS };

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const length = (v) => Math.hypot(v.x, v.y, v.z);
const distance = (a, b) => length(sub(a, b));
function cosine(a, b) {
  const lengths = length(a) * length(b);
  return lengths > 1e-9 ? (a.x * b.x + a.y * b.y + a.z * b.z) / lengths : 1;
}

// Mean cosine between consecutive bones: 1 = straight, ~0 = curled.
function straightness(points, chain) {
  let total = 0;
  for (let k = 0; k < chain.length - 2; k++) {
    total += cosine(sub(points[chain[k + 1]], points[chain[k]]),
      sub(points[chain[k + 2]], points[chain[k + 1]]));
  }
  return total / (chain.length - 2);
}

// points: 21 landmarks in hand space; physical: 'left' | 'right' (the real hand)
export function analyzeHand(points, physical) {
  const palmSize = distance(points[0], points[9]) || 1e-6;
  const extended = {};
  const curl = {};
  const straight = {};
  const thumbOut = distance(points[4], points[5]) / palmSize;
  for (const finger of FINGERS) {
    straight[finger] = straightness(points, CHAINS[finger]);
    curl[finger] = Math.min(1, Math.max(0, (1 - straight[finger]) / 1.2));
    extended[finger] = finger === 'thumb'
      ? straight.thumb > THRESHOLDS.thumbStraightness && thumbOut > THRESHOLDS.thumbOutDistance
      : straight[finger] > THRESHOLDS.extendedStraightness && distance(points[0], points[CHAINS[finger][4]]) >
        distance(points[0], points[CHAINS[finger][2]]);
  }
  const touch = {};
  for (const [finger, tip] of Object.entries(TIPS)) touch[finger] = distance(points[4], points[tip]) / palmSize;

  // Palm normal from the wrist->index and wrist->pinky knuckle vectors. In the
  // mirrored view a right hand shows its palm when the normal points out of
  // the screen (positive z of this cross product), a left hand the opposite.
  const toIndex = sub(points[5], points[0]);
  const toPinky = sub(points[17], points[0]);
  const palmNormalZ = (toIndex.x * toPinky.y - toIndex.y * toPinky.x) / (palmSize * palmSize);
  const palmFacing = palmFacingFor(physical, palmNormalZ);

  const up = sub(points[9], points[0]);
  const roll = Math.atan2(up.x, -up.y);   // 0 = fingers up, positive = tilted right
  const thumbUp = extended.thumb && points[4].y < points[2].y - THRESHOLDS.thumbUpLift * palmSize;
  // In a fist the thumb rests against the index finger just like in a pinch;
  // the difference is that a fist folds the index tip back towards the wrist.
  const indexFolded = distance(points[8], points[0]) < distance(points[6], points[0]);

  return {
    extended, curl, straight, thumbOut, touch, palmFacing, palmNormalZ, roll, palmSize, indexFolded,
    count: FINGERS.filter((finger) => extended[finger]).length,
    gesture: classify(extended, touch, thumbUp, indexFolded),
  };
}

// A left palm and a right back of the hand look alike in 2D (they're mirror
// images), so which side faces the camera depends on which hand it is.
export function palmFacingFor(physical, palmNormalZ) {
  return physical === 'right' ? palmNormalZ > 0 : palmNormalZ < 0;
}

function classify(extended, touch, thumbUp, indexFolded) {
  const { index, middle, ring, pinky } = extended;
  const raised = [index, middle, ring, pinky].filter(Boolean).length;
  if (touch.index < THRESHOLDS.touchOn && !indexFolded) return middle && ring && pinky ? 'ok' : 'pinch';
  if (raised === 0) return thumbUp ? 'thumbsUp' : 'fist';
  if (raised === 1 && index) return 'point';
  // pinky alone, usually with the thumb out: the "hang loose" sign
  if (raised === 1 && pinky) return 'shaka';
  if (raised === 2 && index && middle) return 'peace';
  if (raised === 2 && index && pinky) return 'rock';
  if (raised === 4) return 'open';
  if (raised === 3 && !pinky) return 'three';
  return 'other';
}

// The two-hand photo frame: each hand makes an "L" with thumb and index, and
// the two Ls sit at opposite corners of a rectangle, opening towards each
// other (like a director framing a shot). Measured in the image plane only
// (x, y; the depth estimate is too noisy for angles), lengths in palm sizes.
// Pointing with both hands fails it in several ways: the thumbs are usually
// tucked in, the index fingers point the same way, and an L that is there by
// chance rarely opens towards the other hand.
export const FRAME = {
  thumbLength: 0.3,     // the thumb (base joint to tip) reaches at least this far across the image ...
  indexLength: 0.5,     // ... and the index finger (knuckle to tip) this far
  rightAngle: 0.5,      // |cos| between thumb and index below this: 60-120°
  opposite: -0.6,       // cos between the two index fingers below this: pointing opposite ways
  opening: 0.25,        // cos between each arm and the way to the other corner above this
  minDiagonal: 2.0,     // the corners at least this far apart
};

// One hand's L, or null: thumb and index straight and roughly at a right
// angle, the other three fingers folded, the thumb not touching the index.
// Returns the corner where the arms meet and their directions (unit, 2D).
export function frameCorner(points, analysis) {
  const { extended } = analysis;
  if (!extended.thumb || !extended.index || extended.middle || extended.ring || extended.pinky) return null;
  if (analysis.touch.index < THRESHOLDS.touchOff) return null;
  const palm = analysis.palmSize;
  const thumb = flatDirection(points[2], points[4]);
  const index = flatDirection(points[5], points[8]);
  if (thumb.length < FRAME.thumbLength * palm || index.length < FRAME.indexLength * palm) return null;
  if (Math.abs(thumb.x * index.x + thumb.y * index.y) > FRAME.rightAngle) return null;
  return {
    corner: { x: (points[2].x + points[5].x) / 2, y: (points[2].y + points[5].y) / 2 },
    thumb,
    index,
  };
}

// a: { points, analysis } for one hand, b for the other; points in hand
// space (or any space with equal x and y units). Returns { corners: [a, b],
// diagonal } (diagonal in palm sizes) when the two hands frame a picture.
export function detectFrame(a, b) {
  const first = frameCorner(a.points, a.analysis);
  const second = frameCorner(b.points, b.analysis);
  if (!first || !second) return null;
  const palm = (a.analysis.palmSize + b.analysis.palmSize) / 2;
  const across = { x: second.corner.x - first.corner.x, y: second.corner.y - first.corner.y };
  const span = Math.hypot(across.x, across.y);
  if (span < FRAME.minDiagonal * palm) return null;
  if (first.index.x * second.index.x + first.index.y * second.index.y > FRAME.opposite) return null;
  // both arms of each L lean towards the other corner: the hands sit
  // diagonally, each L opening into the picture
  const towards = { x: across.x / span, y: across.y / span };
  const opens = (corner, sign) => [corner.thumb, corner.index]
    .every((arm) => sign * (arm.x * towards.x + arm.y * towards.y) > FRAME.opening);
  if (!opens(first, 1) || !opens(second, -1)) return null;
  return { corners: [first.corner, second.corner], diagonal: span / palm };
}

function flatDirection(from, to) {
  const x = to.x - from.x;
  const y = to.y - from.y;
  const length = Math.hypot(x, y) || 1e-9;
  return { x: x / length, y: y / length, length };
}

// Procedural hand for demo/mouse modes.

// Pose presets: curl 0 = straight, 1 = fully curled; touch = how far the
// thumb tip has travelled to that fingertip (1 = touching).
export const POSES = {
  open:   { curl: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 }, touch: {} },
  fist:   { curl: { thumb: 0.85, index: 1, middle: 1, ring: 1, pinky: 1 }, touch: {} },
  point:  { curl: { thumb: 0.85, index: 0, middle: 1, ring: 1, pinky: 1 }, touch: {} },
  peace:  { curl: { thumb: 0.85, index: 0, middle: 0, ring: 1, pinky: 1 }, touch: {} },
  shaka:  { curl: { thumb: -0.3, index: 1, middle: 1, ring: 1, pinky: 0 }, touch: {} },
  ok:     { curl: { thumb: 0.3, index: 0.45, middle: 0, ring: 0, pinky: 0 }, touch: { index: 1 } },
  pinch:  { curl: { thumb: 0.3, index: 0.4, middle: 0.55, ring: 0.7, pinky: 0.8 }, touch: { index: 1 } },
  tapMiddle: { curl: { thumb: 0.3, index: 0, middle: 0.45, ring: 0, pinky: 0 }, touch: { middle: 1 } },
  tapRing:   { curl: { thumb: 0.35, index: 0, middle: 0, ring: 0.5, pinky: 0 }, touch: { ring: 1 } },
  tapPinky:  { curl: { thumb: 0.4, index: 0, middle: 0, ring: 0, pinky: 0.55 }, touch: { pinky: 1 } },
  three:  { curl: { thumb: 0.85, index: 0, middle: 0, ring: 0, pinky: 1 }, touch: {} },
  // one hand of the two-hand photo frame (detectFrame): thumb and index in an
  // "L". On its own it classifies as a point; the thumb doesn't count there.
  frame:  { curl: { thumb: -0.6, index: 0, middle: 1, ring: 1, pinky: 1 }, touch: {} },
};

export function blendPoses(from, to, amount) {
  const pose = { curl: {}, touch: {} };
  for (const finger of FINGERS) {
    pose.curl[finger] = from.curl[finger] + (to.curl[finger] - from.curl[finger]) * amount;
  }
  for (const finger of ['index', 'middle', 'ring', 'pinky']) {
    const a = from.touch[finger] ?? 0;
    const b = to.touch[finger] ?? 0;
    pose.touch[finger] = a + (b - a) * amount;
  }
  return pose;
}

// Hand-local layout in palm units: u = across the palm (towards the thumb),
// v = along the fingers. Bones are listed knuckle to tip.
const KNUCKLES = { index: [0.3, 0.95], middle: [0.08, 1.0], ring: [-0.13, 0.95], pinky: [-0.32, 0.85] };
const BONES = { index: [0.42, 0.25, 0.2], middle: [0.47, 0.28, 0.22], ring: [0.43, 0.26, 0.2], pinky: [0.33, 0.2, 0.18] };
const SPLAY = { index: 0.14, middle: 0, ring: -0.1, pinky: -0.24 };   // radians from straight up
const BEND = [80, 100, 70].map((degrees) => degrees * Math.PI / 180); // per joint at curl = 1

// Builds 21 landmarks in hand space. `x, y` = palm centre, `size` = palm
// length (wrist to middle knuckle), `roll` = tilt, `physical` = which hand.
export function poseToLandmarks({ x, y, size, roll = 0, physical = 'right', palmFacing = true }, pose) {
  // in the mirrored view a right hand showing its palm has the thumb on the left
  const thumbSide = (physical === 'right') === palmFacing ? -1 : 1;
  const local = new Array(21);
  local[0] = { u: 0, v: 0, w: 0 };

  for (const [finger, [knuckleU, knuckleV]] of Object.entries(KNUCKLES)) {
    const chain = CHAINS[finger].slice(1);
    let point = { u: knuckleU, v: knuckleV, w: 0 };
    local[chain[0]] = point;
    let angle = 0;
    for (let bone = 0; bone < 3; bone++) {
      angle += BEND[bone] * pose.curl[finger];
      // bend towards the camera (negative w), fingers fan out by SPLAY
      const along = Math.cos(angle);
      point = {
        u: point.u + BONES[finger][bone] * along * Math.sin(SPLAY[finger]),
        v: point.v + BONES[finger][bone] * along * Math.cos(SPLAY[finger]),
        w: point.w - BONES[finger][bone] * Math.sin(angle),
      };
      local[chain[bone + 1]] = point;
    }
  }

  // thumb: swings across the palm as it curls
  const thumbCurl = pose.curl.thumb;
  let thumb = { u: 0.22, v: 0.18, w: 0 };
  local[1] = thumb;
  const thumbBones = [0.32, 0.27, 0.24];
  let thumbAngle = 0.62 - 1.25 * thumbCurl;   // from the palm's v axis towards the thumb side
  for (let bone = 0; bone < 3; bone++) {
    const lift = thumbCurl * 0.5 * (bone + 1);
    thumb = {
      u: thumb.u + thumbBones[bone] * Math.sin(thumbAngle) * Math.cos(lift),
      v: thumb.v + thumbBones[bone] * Math.cos(thumbAngle) * Math.cos(lift),
      w: thumb.w - thumbBones[bone] * Math.sin(lift),
    };
    local[2 + bone] = thumb;
    thumbAngle -= 0.25 * thumbCurl;
  }
  // thumb tip (and partly its last joint) reach for the touched fingertip
  for (const [finger, amount] of Object.entries(pose.touch)) {
    if (!amount) continue;
    const target = local[TIPS[finger]];
    for (const [joint, weight] of [[4, 1], [3, 0.55]]) {
      const from = local[joint];
      const reach = weight * amount;
      local[joint] = {
        u: from.u + (target.u - from.u) * reach,
        v: from.v + (target.v - from.v) * reach - (joint === 4 ? 0.02 * amount : 0),
        w: from.w + (target.w - from.w) * reach,
      };
    }
  }

  // local -> hand space: rotate by roll, palm centre at (x, y), y down
  const cos = Math.cos(roll);
  const sin = Math.sin(roll);
  const palmCentre = { u: 0, v: 0.5 };
  return local.map(({ u, v, w }) => {
    const across = (u - palmCentre.u) * thumbSide * size;
    const along = (v - palmCentre.v) * size;
    return {
      x: x + across * cos + along * sin,
      y: y + across * sin - along * cos,
      z: w * size,
    };
  });
}
