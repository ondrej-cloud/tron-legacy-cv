// Animated hand glyphs for the intro's controls card. Each glyph is a small
// canvas showing the procedural hand from gestures.js (the same model the demo
// mode feeds through the gesture classifier) acting out one control, drawn as
// thin neon lines over black.
import { POSES, blendPoses, poseToLandmarks } from './gestures.js';
import { HAND_CONNECTIONS } from './hands.js';

export const CYAN = '111, 243, 255';
export const BLUE = '0, 200, 255';
export const ORANGE = '255, 138, 31';
export const WHITE = '236, 253, 255';

// Poses gestures.js has no preset for. Both classify as intended for either
// hand: rock as 'rock', thumbs up as 'thumbsUp' once the hand is rolled
// sideways (THUMBS_UP_ROLL), which is how a thumbs up faces the camera.
export const ROCK = { curl: { thumb: 0.85, index: 0, middle: 1, ring: 1, pinky: 0 }, touch: {} };
export const THUMBS_UP = { curl: { thumb: -0.2, index: 1, middle: 1, ring: 1, pinky: 1 }, touch: {} };
export const THUMBS_UP_ROLL = 1.1;

const LOOP = 3.6;   // seconds, every glyph animation repeats at this period
const TIPS = [4, 8, 12, 16, 20];

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const smooth = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const ramp = (time, from, to) => smooth((time - from) / (to - from));
const mix = (a, b, amount) => a + (b - a) * amount;
const mixRgb = (a, b, amount) => {
  const pa = a.split(',').map(Number);
  const pb = b.split(',').map(Number);
  return pa.map((value, index) => Math.round(mix(value, pb[index], amount))).join(', ');
};

// Landmarks for a pose in canvas pixels. Curled fingers bend towards the
// camera (negative z); leaning z sideways turns the hand a little, so a
// curled finger shows as a hook instead of collapsing onto the palm.
export function handPoints(pose, { x, y, size, roll = 0, physical = 'right', palmFacing = true }) {
  return poseToLandmarks({ x, y, size, roll, physical, palmFacing }, pose)
    .map((point) => ({ x: point.x - point.z * 0.45, y: point.y + point.z * 0.2, z: point.z }));
}

const KNUCKLES = new Set([0, 1, 5, 9, 13, 17]);
const FINGER_OF = (index) => ['thumb', 'index', 'middle', 'ring', 'pinky'][Math.floor((index - 1) / 4)];
const PALM_OUTLINE = [0, 1, 5, 9, 13, 17];

// Neon skeleton: a soft wide stroke under a thin bright one, joints as points.
// With `pose`, curled fingers are dimmed so the raised ones carry the gesture.
export function drawHand(context, points, { pose = null, color = CYAN, alpha = 1, scale = 1 } = {}) {
  const fingerAlpha = (finger) => (pose ? 1 - 0.6 * clamp01(pose.curl[finger]) : 1);
  context.save();
  context.globalCompositeOperation = 'lighter';
  context.lineCap = 'round';
  context.lineJoin = 'round';

  context.beginPath();
  PALM_OUTLINE.forEach((index, order) => {
    if (order === 0) context.moveTo(points[index].x, points[index].y);
    else context.lineTo(points[index].x, points[index].y);
  });
  context.closePath();
  context.fillStyle = `rgba(${color}, ${0.07 * alpha})`;
  context.fill();

  for (const [a, b] of HAND_CONNECTIONS) {
    const palm = KNUCKLES.has(a) && KNUCKLES.has(b) && !(a === 0 && b === 1);
    const weight = alpha * (palm ? 1 : fingerAlpha(FINGER_OF(b)));
    context.beginPath();
    context.moveTo(points[a].x, points[a].y);
    context.lineTo(points[b].x, points[b].y);
    context.strokeStyle = `rgba(${color}, ${0.16 * weight})`;
    context.lineWidth = 4 * scale;
    context.stroke();
    context.strokeStyle = `rgba(${color}, ${0.92 * weight})`;
    context.lineWidth = 1.1 * scale;
    context.stroke();
  }
  const dot = 1.7 * scale;
  points.forEach((point, index) => {
    const weight = index === 0 ? 1 : fingerAlpha(FINGER_OF(index));
    context.fillStyle = `rgba(${WHITE}, ${0.8 * alpha * weight})`;
    context.fillRect(point.x - dot / 2, point.y - dot / 2, dot, dot);
  });
  context.lineWidth = 0.8 * scale;
  for (const index of TIPS) {
    const finger = FINGER_OF(index);
    if (pose && pose.curl[finger] > 0.5) continue;
    context.strokeStyle = `rgba(${WHITE}, ${0.6 * alpha})`;
    context.beginPath();
    context.arc(points[index].x, points[index].y, 2.3 * scale, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}

// Places a pose and draws it; returns the landmarks for effects to attach to.
function hand(context, pose, placement, style) {
  const points = handPoints(pose, placement);
  drawHand(context, points, { pose, ...style });
  return points;
}

// A polyline of light: wide glow, then a white-hot core.
function drawLightLine(context, points, color, alpha, scale) {
  if (points.length < 2) return;
  context.save();
  context.globalCompositeOperation = 'lighter';
  context.lineCap = 'butt';
  context.lineJoin = 'miter';
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.strokeStyle = `rgba(${color}, ${0.22 * alpha})`;
  context.lineWidth = 6 * scale;
  context.stroke();
  context.strokeStyle = `rgba(${color}, ${0.85 * alpha})`;
  context.lineWidth = 2 * scale;
  context.stroke();
  context.strokeStyle = `rgba(${WHITE}, ${0.9 * alpha})`;
  context.lineWidth = 0.8 * scale;
  context.stroke();
  context.restore();
}

function glowDot(context, x, y, radius, color, alpha) {
  context.save();
  context.globalCompositeOperation = 'lighter';
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(${WHITE}, ${alpha})`);
  gradient.addColorStop(0.25, `rgba(${color}, ${0.7 * alpha})`);
  gradient.addColorStop(1, `rgba(${color}, 0)`);
  context.fillStyle = gradient;
  context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  context.restore();
}

// Points along a polyline, up to a fraction of its total length.
function partialPath(points, fraction) {
  const lengths = [];
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    const length = Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    lengths.push(length);
    total += length;
  }
  let remaining = clamp01(fraction) * total;
  const result = [points[0]];
  for (let index = 1; index < points.length; index++) {
    const length = lengths[index - 1];
    if (remaining >= length) {
      result.push(points[index]);
      remaining -= length;
      continue;
    }
    const amount = length > 0 ? remaining / length : 0;
    result.push({
      x: mix(points[index - 1].x, points[index].x, amount),
      y: mix(points[index - 1].y, points[index].y, amount),
    });
    break;
  }
  return result;
}

// Each scene draws one frame of a control at loop time t (0..LOOP) on a
// w x h canvas (device pixels); `s` scales line widths with the pixel ratio.

function pointScene(context, t, w, h, s) {
  const size = h * 0.29;
  // the fingertip draws a wall with a right-angle turn, like a light cycle
  const route = [
    { x: w * 0.14, y: h * 0.46 }, { x: w * 0.52, y: h * 0.46 },
    { x: w * 0.52, y: h * 0.2 }, { x: w * 0.88, y: h * 0.2 },
  ];
  const drawing = ramp(t, 0.55, 2.55);
  const fade = 1 - ramp(t, 2.9, 3.45);
  const pose = blendPoses(POSES.open, POSES.point, ramp(t, 0.05, 0.45));
  const tipTarget = partialPath(route, drawing).at(-1);
  // place the hand so that its index fingertip sits on the route
  const probe = handPoints(pose, { x: 0, y: 0, size, roll: 0.1 });
  const points = probe.map((point) => ({
    x: point.x + tipTarget.x - probe[8].x, y: point.y + tipTarget.y - probe[8].y, z: point.z }));
  if (drawing > 0) drawLightLine(context, partialPath(route, drawing), BLUE, fade, s);
  drawHand(context, points, { pose, alpha: 0.4 + 0.6 * fade, scale: s });
  if (drawing > 0 && drawing < 1) glowDot(context, tipTarget.x, tipTarget.y, 8 * s, CYAN, 0.9);
}

function rockScene(context, t, w, h, s) {
  // switch colour and back once per loop
  const toOrange = ramp(t, 0.9, 1.1) * (1 - ramp(t, 2.6, 2.8));
  const color = mixRgb(CYAN, ORANGE, toOrange);
  const pose = blendPoses(POSES.open, ROCK, ramp(t, 0.1, 0.5));
  const points = hand(context, pose, { x: w * 0.5, y: h * 0.62, size: h * 0.3, roll: 0.1 }, { color, scale: s });
  for (const switchAt of [0.9, 2.6]) {
    const age = t - switchAt;
    if (age < 0 || age > 0.55) continue;
    const pulse = 1 - age / 0.55;
    for (const index of [8, 20]) {
      context.save();
      context.globalCompositeOperation = 'lighter';
      context.strokeStyle = `rgba(${color}, ${0.9 * pulse})`;
      context.lineWidth = 1 * s;
      context.beginPath();
      context.arc(points[index].x, points[index].y, (3 + 11 * (1 - pulse)) * s, 0, Math.PI * 2);
      context.stroke();
      context.restore();
      glowDot(context, points[index].x, points[index].y, 7 * s, color, pulse);
    }
  }
}

function drawDisc(context, x, y, radius, alpha, s, spin) {
  context.save();
  context.globalCompositeOperation = 'lighter';
  glowDot(context, x, y, radius * 2, BLUE, 0.3 * alpha);
  context.translate(x, y);
  context.lineWidth = 1.5 * s;
  context.strokeStyle = `rgba(${WHITE}, ${0.95 * alpha})`;
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.stroke();
  context.lineWidth = 1 * s;
  context.strokeStyle = `rgba(${CYAN}, ${0.85 * alpha})`;
  for (let segment = 0; segment < 4; segment++) {
    const start = spin + segment * Math.PI / 2;
    context.beginPath();
    context.arc(0, 0, radius * 0.6, start + 0.25, start + Math.PI / 2 - 0.25);
    context.stroke();
  }
  context.fillStyle = `rgba(${WHITE}, ${alpha})`;
  context.fillRect(-s, -s, 2 * s, 2 * s);
  context.restore();
}

// Where a disc held in the OK hand sits, for a hand placed at (x, y).
const discRest = (x, y, size) => ({ x: x + size * 1.2, y: y - size * 0.85 });

function okScene(context, t, w, h, s) {
  const size = h * 0.28;
  const toOk = ramp(t, 0.1, 0.5) * (1 - ramp(t, 3.15, 3.5));
  const pose = blendPoses(POSES.open, POSES.ok, toOk);
  const handX = w * 0.3;
  const handY = h * 0.64;
  const points = hand(context, pose, { x: handX, y: handY, size, roll: 0.1 }, { scale: s });
  if (toOk > 0.8) {
    // the "O" between thumb and index
    const ring = { x: (points[4].x + points[8].x) / 2, y: (points[4].y + points[8].y) / 2 };
    glowDot(context, ring.x, ring.y, 6 * s, CYAN, 0.7 * (toOk - 0.8) / 0.2);
  }
  // the disc rezzes in beside the hand: a flash, then the rings grow out of it
  const rest = discRest(handX, handY, size);
  const radius = h * 0.1;
  const rez = ramp(t, 0.55, 1.1);
  const gone = ramp(t, 2.9, 3.25);
  const alpha = rez * (1 - gone);
  if (alpha <= 0) return;
  const bob = Math.sin(t * 3) * h * 0.012;
  if (t < 0.9) glowDot(context, rest.x, rest.y, 12 * s, WHITE, Math.sin(Math.PI * ramp(t, 0.5, 0.9)));
  drawDisc(context, rest.x, rest.y + bob, radius * (0.3 + 0.7 * rez), alpha, s, t * 4);
}

// Bounces a coordinate between lo and hi, like a disc off two walls.
function reflect(value, lo, hi) {
  const span = hi - lo;
  const u = (((value - lo) % (2 * span)) + 2 * span) % (2 * span);
  return lo + (u < span ? u : 2 * span - u);
}

function flickScene(context, t, w, h, s) {
  const size = h * 0.26;
  const throwAt = 1.05;
  const catchAt = 2.75;
  // a wind-up, then the hand whips sideways and opens
  const windUp = ramp(t, 0.7, throwAt) * (1 - ramp(t, throwAt, throwAt + 0.08));
  const whip = ramp(t, throwAt, throwAt + 0.12) * (1 - ramp(t, 2.2, catchAt));
  const pose = blendPoses(POSES.ok, POSES.open, ramp(t, throwAt, throwAt + 0.1) * (1 - ramp(t, catchAt, catchAt + 0.25)));
  const handX = w * (0.26 - 0.04 * windUp + 0.12 * whip);
  const handY = h * 0.64;
  hand(context, pose, { x: handX, y: handY, size, roll: 0.1 - 0.25 * windUp + 0.45 * whip }, { scale: s });

  const radius = h * 0.085;
  const rest = discRest(handX, handY, size);
  if (t < throwAt || t > catchAt + 0.05) {
    drawDisc(context, rest.x, rest.y, radius, 1, s, t * 4);
    if (t > catchAt && t < catchAt + 0.3) glowDot(context, rest.x, rest.y, 12 * s, CYAN, 1 - (t - catchAt) / 0.3);
    return;
  }
  // in flight: bounces off the glyph's edges, then homes back to the hand
  const release = discRest(w * 0.38, handY, size);
  const at = (time) => {
    const flight = time - throwAt;
    const free = {
      x: reflect(release.x + w * 1.6 * flight, radius, w - radius),
      y: reflect(release.y - h * 0.7 * flight, radius, h - radius),
    };
    const home = smooth((time - (catchAt - 0.55)) / 0.55);
    return { x: mix(free.x, rest.x, home), y: mix(free.y, rest.y, home) };
  };
  const trail = [];
  for (let back = 0; back <= 8; back++) trail.push(at(Math.max(throwAt, t - back * 0.014)));
  drawLightLine(context, trail, BLUE, 0.5, s * 0.75);
  const disc = trail[0];
  drawDisc(context, disc.x, disc.y, radius, 1, s, t * 10);
  for (const edge of [disc.x - radius, w - disc.x - radius, disc.y - radius, h - disc.y - radius]) {
    if (edge < 1.5 * s) glowDot(context, disc.x, disc.y, radius * 2.2, CYAN, 0.5);
  }
}

function thumbsUpScene(context, t, w, h, s) {
  const turn = ramp(t, 0.1, 0.55) * (1 - ramp(t, 3.0, 3.45));
  const pose = blendPoses(POSES.fist, THUMBS_UP, turn);
  const size = h * 0.29;
  const handX = w * 0.26;
  const handY = h * 0.52;
  hand(context, pose, { x: handX, y: handY, size, roll: THUMBS_UP_ROLL * turn }, { scale: s });

  // the light cycle rides out from under the hand and races to the right
  const launch = 0.7;
  if (t < launch || t > 2.9) return;
  const age = t - launch;
  const laneY = h * 0.84;
  const startX = handX;
  const headX = startX + w * (age * age * 0.6 + age * 0.55);
  const tailX = Math.max(startX, headX - w * 0.55);
  const fade = 1 - ramp(t, 2.4, 2.9);
  drawLightLine(context, [{ x: tailX, y: laneY }, { x: Math.min(headX, w + 20 * s), y: laneY }], BLUE, fade, s);
  if (headX > w + 10 * s) return;
  // the cycle: a low white-hot body over two wheel rings
  context.save();
  context.globalCompositeOperation = 'lighter';
  context.strokeStyle = `rgba(${WHITE}, ${fade})`;
  context.lineWidth = 1.2 * s;
  const length = 15 * s;
  context.beginPath();
  context.moveTo(headX - length, laneY - 3.2 * s);
  context.lineTo(headX + 1.5 * s, laneY - 3.2 * s);
  context.lineTo(headX + 4.5 * s, laneY);
  context.stroke();
  for (const wheel of [headX - length + 3 * s, headX - 1.5 * s]) {
    context.beginPath();
    context.arc(wheel, laneY, 2.6 * s, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
  glowDot(context, headX, laneY, 11 * s, CYAN, 0.8 * fade);
}

// Voxels for the fist's derezz: fixed pseudo-random directions per joint.
const SHARDS = Array.from({ length: 42 }, (_, index) => {
  const angle = index * 2.399963;   // golden angle spreads them evenly
  const speed = 0.35 + ((index * 37) % 11) / 16;
  return { joint: index % 21, dx: Math.cos(angle) * speed, dy: Math.sin(angle) * speed - 0.15 };
});

function fistScene(context, t, w, h, s) {
  const size = h * 0.29;
  const place = { x: w * 0.5, y: h * 0.62, size, roll: 0.1 };
  const derezzAt = 0.85;
  const pose = blendPoses(POSES.open, POSES.fist, ramp(t, 0.25, 0.65));
  const points = handPoints(pose, place);
  const reform = ramp(t, 2.6, 3.3);
  if (t < derezzAt) drawHand(context, points, { pose, scale: s });
  else if (reform > 0) hand(context, POSES.open, place, { scale: s, alpha: reform });
  if (t < derezzAt || t > 2.6) return;

  const age = t - derezzAt;
  const fade = 1 - ramp(age, 0.6, 1.6);
  const centre = { x: (points[0].x + points[9].x) / 2, y: (points[0].y + points[9].y) / 2 };
  context.save();
  context.globalCompositeOperation = 'lighter';
  context.strokeStyle = `rgba(${CYAN}, ${0.75 * (1 - ramp(age, 0, 0.6))})`;
  context.lineWidth = 1 * s;
  context.beginPath();
  context.arc(centre.x, centre.y, 6 * s + age * w * 0.9, 0, Math.PI * 2);
  context.stroke();
  // shards fly out from the joints; white-hot for the first instant
  const travel = (1 - Math.exp(-age * 3.2)) * h * 0.5;
  for (const shard of SHARDS) {
    const from = points[shard.joint];
    const x = from.x + shard.dx * travel;
    const y = from.y + shard.dy * travel + age * age * h * 0.08;
    const voxel = (1.4 + (shard.joint % 3) * 0.6) * s;
    context.fillStyle = age < 0.08 ? `rgba(${WHITE}, ${fade})` : `rgba(${CYAN}, ${0.9 * fade})`;
    context.fillRect(x - voxel / 2, y - voxel / 2, voxel, voxel);
  }
  context.restore();
}

function portalScene(context, t, w, h, s) {
  const apart = ramp(t, 0.1, 0.6) * (1 - ramp(t, 3.0, 3.5));
  const size = h * 0.22;
  const gap = w * (0.25 + 0.07 * apart);
  const y = h * 0.6;
  hand(context, POSES.open, { x: w * 0.5 - gap, y, size, roll: -0.18, physical: 'left' }, { scale: s });
  hand(context, POSES.open, { x: w * 0.5 + gap, y, size, roll: 0.18, physical: 'right' }, { scale: s });

  const open = ramp(t, 0.5, 1.1) * (1 - ramp(t, 2.7, 3.15));
  if (open <= 0) return;
  const cx = w * 0.5;
  const cy = h * 0.48;
  const rx = w * 0.12 * open;
  const ry = h * 0.36 * Math.min(1, open * 1.4);
  context.save();
  context.globalCompositeOperation = 'lighter';
  const inner = context.createRadialGradient(cx, cy, 0, cx, cy, ry);
  inner.addColorStop(0, `rgba(${BLUE}, ${0.28 * open})`);
  inner.addColorStop(1, `rgba(${BLUE}, 0)`);
  context.fillStyle = inner;
  context.beginPath();
  context.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  context.fill();
  // lines drifting through the portal
  context.save();
  context.clip();
  context.strokeStyle = `rgba(${CYAN}, ${0.35 * open})`;
  context.lineWidth = 0.8 * s;
  for (let line = 0; line < 7; line++) {
    const ly = cy - ry + ((line / 7 + t * 0.35) % 1) * ry * 2;
    context.beginPath();
    context.moveTo(cx - rx, ly);
    context.lineTo(cx + rx, ly);
    context.stroke();
  }
  context.restore();
  context.lineWidth = 3.5 * s;
  context.strokeStyle = `rgba(${BLUE}, ${0.25 * open})`;
  context.beginPath();
  context.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  context.stroke();
  context.lineWidth = 1.1 * s;
  context.strokeStyle = `rgba(${WHITE}, ${0.95 * open})`;
  context.stroke();
  context.restore();
}

// A head-and-shoulders outline, as a path, for the digitize glyph.
function figurePath(cx, h) {
  const path = new Path2D();
  path.ellipse(cx, h * 0.37, h * 0.11, h * 0.14, 0, 0, Math.PI * 2);
  path.moveTo(cx - h * 0.32, h * 1.02);
  path.bezierCurveTo(cx - h * 0.32, h * 0.66, cx - h * 0.14, h * 0.6, cx, h * 0.6);
  path.bezierCurveTo(cx + h * 0.14, h * 0.6, cx + h * 0.32, h * 0.66, cx + h * 0.32, h * 1.02);
  return path;
}

// Voxels that peel off the digitized outline: fixed points along it.
const PEELS = Array.from({ length: 14 }, (_, index) => ({
  angle: index * 2.399963,
  drift: 0.5 + ((index * 53) % 7) / 10,
}));

function peaceScene(context, t, w, h, s) {
  const toPeace = ramp(t, 0.05, 0.4) * (1 - ramp(t, 3.2, 3.55));
  const pose = blendPoses(POSES.open, POSES.peace, toPeace);
  const points = hand(context, pose, { x: w * 0.24, y: h * 0.62, size: h * 0.27, roll: 0.06 }, { scale: s });

  // the emitter charges between the two raised fingertips
  const charge = ramp(t, 0.45, 0.85) * (1 - ramp(t, 3.0, 3.3));
  if (charge > 0) {
    const emitter = { x: (points[8].x + points[12].x) / 2, y: (points[8].y + points[12].y) / 2 - 3 * s };
    glowDot(context, emitter.x, emitter.y, (5 + 5 * charge) * s, CYAN, charge);
  }

  // the laser scans down (digitizing), holds, then scans back up
  const down = ramp(t, 0.85, 1.85);
  const up = ramp(t, 2.6, 3.2);
  const digitized = down * (1 - up);
  const laserY = h * (0.16 + 0.86 * (up > 0 ? 1 - up : down));
  const laserOn = (t > 0.85 && t < 1.95) || (t > 2.6 && t < 3.3);
  const cx = w * 0.68;
  const figure = figurePath(cx, h);

  context.save();
  context.globalCompositeOperation = 'lighter';
  context.lineWidth = 1 * s;
  // still flesh and blood below the laser (or above it, on the way back up)
  context.strokeStyle = `rgba(${WHITE}, 0.22)`;
  context.stroke(figure);
  if (digitized > 0) {
    context.save();
    context.beginPath();
    if (up > 0) context.rect(0, laserY, w, h - laserY);
    else context.rect(0, 0, w, laserY);
    context.clip();
    context.save();
    context.clip(figure);
    context.fillStyle = `rgba(${BLUE}, 0.12)`;
    context.fillRect(0, 0, w, h);
    context.strokeStyle = `rgba(${CYAN}, 0.4)`;
    context.lineWidth = 0.8 * s;
    for (let y = h * 0.2 + ((t * 18 * s) % (4 * s)); y < h; y += 4 * s) {
      context.beginPath();
      context.moveTo(cx - h * 0.34, y);
      context.lineTo(cx + h * 0.34, y);
      context.stroke();
    }
    context.restore();
    context.strokeStyle = `rgba(${BLUE}, 0.3)`;
    context.lineWidth = 4 * s;
    context.stroke(figure);
    context.strokeStyle = `rgba(${WHITE}, 0.95)`;
    context.lineWidth = 1.1 * s;
    context.stroke(figure);
    context.restore();
  }
  // voxels peel off while fully digitized
  const peel = ramp(t, 1.7, 2.6);
  if (peel > 0 && peel < 1) {
    context.fillStyle = `rgba(${CYAN}, ${0.9 * (1 - peel)})`;
    for (const voxel of PEELS) {
      const x = cx + Math.cos(voxel.angle) * h * 0.12 + Math.cos(voxel.angle) * peel * h * 0.25 * voxel.drift;
      const y = h * 0.37 + Math.sin(voxel.angle) * h * 0.15 - peel * h * 0.2 * voxel.drift;
      const size = 1.8 * s;
      context.fillRect(x - size / 2, y - size / 2, size, size);
    }
  }
  if (laserOn) {
    const half = h * 0.36;
    const beam = context.createLinearGradient(cx - half, 0, cx + half, 0);
    beam.addColorStop(0, `rgba(${WHITE}, 0)`);
    beam.addColorStop(0.5, `rgba(${WHITE}, 1)`);
    beam.addColorStop(1, `rgba(${WHITE}, 0)`);
    context.fillStyle = `rgba(${BLUE}, 0.3)`;
    context.fillRect(cx - half, laserY - 3 * s, half * 2, 6 * s);
    context.fillStyle = beam;
    context.fillRect(cx - half, laserY - 0.6 * s, half * 2, 1.2 * s);
  }
  context.restore();
}

function shakaScene(context, t, w, h, s) {
  const size = h * 0.27;
  const toShaka = ramp(t, 0.05, 0.4) * (1 - ramp(t, 3.25, 3.55));
  const pose = blendPoses(POSES.open, POSES.shaka, toShaka);
  const place = (time) => ({ x: w * 0.5, y: h * 0.66, size, roll: 0.2 + 0.6 * Math.sin((time - 0.7) * 3.4) * ramp(time, 0.6, 0.9) });
  // the baton runs through the hand, along the line from thumb tip to pinky tip
  const baton = (points, length) => {
    const dx = points[20].x - points[4].x;
    const dy = points[20].y - points[4].y;
    const norm = Math.hypot(dx, dy) || 1;
    const cx = (points[4].x + points[20].x) / 2;
    const cy = (points[4].y + points[20].y) / 2;
    return [
      { x: cx - (dx / norm) * length, y: cy - (dy / norm) * length },
      { x: cx + (dx / norm) * length, y: cy + (dy / norm) * length },
    ];
  };
  const lit = ramp(t, 0.4, 0.65) * (1 - ramp(t, 2.95, 3.2));
  const length = h * 0.5 * lit;
  if (lit > 0) {
    // the swing leaves a fading arc of earlier positions
    for (let back = 4; back >= 1; back--) {
      const earlier = handPoints(pose, place(t - back * 0.035));
      drawLightLine(context, baton(earlier, length), BLUE, 0.12 * (5 - back) * lit, s * 0.8);
    }
  }
  const points = hand(context, pose, place(t), { scale: s });
  if (lit > 0) {
    drawLightLine(context, baton(points, length), CYAN, lit, s * 1.3);
    for (const end of baton(points, length)) glowDot(context, end.x, end.y, 6 * s, CYAN, 0.6 * lit);
  }
}

export const CONTROLS = [
  { id: 'point', name: 'Point', action: 'Draw a light wall', detail: 'Index finger only', scene: pointScene },
  { id: 'rock', name: 'Rock', action: 'Switch colour', detail: 'Index and pinky · cyan / orange, per hand',
    scene: rockScene },
  { id: 'ok', name: 'OK sign', action: 'Identity disc', detail: 'The disc rezzes in that hand', scene: okScene },
  { id: 'flick', name: 'Flick', action: 'Throw the disc', detail: 'Flick the disc hand. It ricochets and comes back',
    scene: flickScene },
  { id: 'thumbsUp', name: 'Thumbs up', action: 'Launch a light cycle', detail: 'It rides out from your hand',
    scene: thumbsUpScene },
  { id: 'fist', name: 'Fist', action: 'Derezz', detail: 'A wave that breaks everything into voxels',
    scene: fistScene },
  { id: 'peace', name: 'Peace sign', action: 'Digitize yourself', detail: 'A laser sweep turns your outline into light',
    scene: peaceScene },
  { id: 'shaka', name: 'Shaka', action: 'Light baton',
    detail: 'Swing it to cut walls and bat discs; pull two apart for a light cycle', scene: shakaScene },
  { id: 'palms', name: 'Both palms open', action: 'Open a portal', detail: 'Palms toward the camera',
    scene: portalScene },
];

// One looping glyph on a canvas. `offset` staggers the loops so the card
// doesn't pulse in unison.
export function createGlyph(canvas, control, offset = 0) {
  const context = canvas.getContext('2d');
  let pixelRatio = 1;

  function resize() {
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * pixelRatio));
    const height = Math.max(1, Math.round(canvas.clientHeight * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function draw(seconds) {
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    const t = ((seconds + offset) % LOOP + LOOP) % LOOP;
    control.scene(context, t, width, height, pixelRatio * Math.max(0.8, height / (72 * pixelRatio)));
  }

  return { resize, draw };
}
