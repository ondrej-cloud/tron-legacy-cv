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

// A light wall as a ribbon of glass hanging below `points`: a bright top
// edge, a translucent body that fades towards a faint bottom edge. The body
// is stacked thin strokes of the same path, so it follows any curve.
// `body` sets how much light the glass holds; `lean` shifts the body left by
// that fraction of its drop, so a vertical run still shows a strip of glass;
// `tail` = { from, to } fades the ribbon in horizontally from x = from to x = to.
function drawRibbon(context, points, { height, alpha = 1, body = 0.26, lean = 0, s, tail = null }) {
  if (points.length < 2 || alpha <= 0) return;
  const paint = (color, amount) => {
    if (!tail) return `rgba(${color}, ${amount})`;
    const gradient = context.createLinearGradient(tail.from, 0, tail.to, 0);
    gradient.addColorStop(0, `rgba(${color}, 0)`);
    gradient.addColorStop(1, `rgba(${color}, ${amount})`);
    return gradient;
  };
  const trace = (dy) => {
    const dx = -dy * lean;
    context.beginPath();
    context.moveTo(points[0].x + dx, points[0].y + dy);
    for (const point of points.slice(1)) context.lineTo(point.x + dx, point.y + dy);
  };
  context.save();
  context.globalCompositeOperation = 'lighter';
  context.lineJoin = 'round';
  context.lineCap = 'butt';
  const layers = 8;
  const step = height / layers;
  context.lineWidth = step;
  for (let layer = 0; layer < layers; layer++) {
    trace(step * (layer + 0.5));
    context.strokeStyle = paint(BLUE, alpha * body * (1 - layer / layers) ** 1.4);
    context.stroke();
  }
  trace(height);
  context.strokeStyle = paint(CYAN, 0.22 * alpha);
  context.lineWidth = 0.7 * s;
  context.stroke();
  trace(0);
  context.strokeStyle = paint(BLUE, 0.3 * alpha);
  context.lineWidth = 4 * s;
  context.stroke();
  context.strokeStyle = paint(CYAN, 0.9 * alpha);
  context.lineWidth = 1.5 * s;
  context.stroke();
  context.strokeStyle = paint(WHITE, alpha);
  context.lineWidth = 0.7 * s;
  context.stroke();
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
  // the fingertip draws a wall in straight runs with right-angle turns
  const route = [
    { x: w * 0.16, y: h * 0.5 }, { x: w * 0.46, y: h * 0.5 },
    { x: w * 0.46, y: h * 0.24 }, { x: w * 0.88, y: h * 0.24 },
  ];
  const drawing = ramp(t, 0.55, 2.55);
  const fade = 1 - ramp(t, 2.9, 3.45);
  const pose = blendPoses(POSES.open, POSES.point, ramp(t, 0.05, 0.45));
  const drawn = partialPath(route, drawing);
  const tipTarget = drawn.at(-1);
  // place the hand so that its index fingertip sits on the route
  const probe = handPoints(pose, { x: 0, y: 0, size, roll: 0.1 });
  const points = probe.map((point) => ({
    x: point.x + tipTarget.x - probe[8].x, y: point.y + tipTarget.y - probe[8].y, z: point.z }));
  if (drawing > 0) drawRibbon(context, drawn, { height: h * 0.15, alpha: fade, lean: 0.45, s });
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

// Bounces a coordinate between lo and hi, like a disc off two walls.
function reflect(value, lo, hi) {
  const span = hi - lo;
  const u = (((value - lo) % (2 * span)) + 2 * span) % (2 * span);
  return lo + (u < span ? u : 2 * span - u);
}

function okScene(context, t, w, h, s) {
  const size = h * 0.26;
  const throwAt = 1.45;
  const catchAt = 3.0;
  // the OK sign summons the disc, then a flick of the hand throws it
  const toOk = ramp(t, 0.1, 0.45) * (1 - ramp(t, throwAt, throwAt + 0.1)) + ramp(t, catchAt, catchAt + 0.15);
  const pose = blendPoses(POSES.open, POSES.ok, Math.min(1, toOk) * (1 - ramp(t, 3.35, 3.6)));
  const windUp = ramp(t, 1.15, throwAt) * (1 - ramp(t, throwAt, throwAt + 0.08));
  const whip = ramp(t, throwAt, throwAt + 0.12) * (1 - ramp(t, 2.4, catchAt));
  const handX = w * (0.26 - 0.04 * windUp + 0.12 * whip);
  const handY = h * 0.64;
  const points = hand(context, pose, { x: handX, y: handY, size, roll: 0.1 - 0.25 * windUp + 0.45 * whip },
    { scale: s });
  if (t < throwAt && toOk > 0.8) {
    // the "O" between thumb and index
    const ring = { x: (points[4].x + points[8].x) / 2, y: (points[4].y + points[8].y) / 2 };
    glowDot(context, ring.x, ring.y, 6 * s, CYAN, 0.7 * (toOk - 0.8) / 0.2);
  }

  const radius = h * 0.085;
  const rest = discRest(handX, handY, size);
  const rez = ramp(t, 0.45, 0.95);
  const alpha = rez * (1 - ramp(t, 3.3, 3.55));
  if (alpha <= 0) return;
  if (t < throwAt || t > catchAt + 0.05) {
    if (t < 0.85) glowDot(context, rest.x, rest.y, 12 * s, WHITE, Math.sin(Math.PI * ramp(t, 0.4, 0.85)));
    drawDisc(context, rest.x, rest.y, radius * (0.3 + 0.7 * rez), alpha, s, t * 4);
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

// Stable pseudo-random 0..1 for integer inputs.
function hash(a, b) {
  const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function twoFistsScene(context, t, w, h, s) {
  const size = h * 0.27;
  const meetAt = 0.95;
  // two fists come together, knuckles first, and part again at the end
  const close = ramp(t, 0.2, meetAt) * (1 - ramp(t, 2.9, 3.4));
  const fist = ramp(t, 0.05, 0.4) * (1 - ramp(t, 3.2, 3.55));
  const pose = blendPoses(POSES.open, POSES.fist, fist);
  const gap = mix(w * 0.3, size * 0.62, close);
  const y = h * 0.66;
  const shutdown = ramp(t, meetAt, meetAt + 0.35) * (1 - ramp(t, 2.6, 2.9));
  const handAlpha = 1 - 0.6 * shutdown;
  const tilt = 0.12 + 0.25 * close;   // knuckles lean in towards each other
  hand(context, pose, { x: w * 0.5 - gap, y, size, roll: tilt, physical: 'left' }, { scale: s, alpha: handAlpha });
  hand(context, pose, { x: w * 0.5 + gap, y, size, roll: -tilt, physical: 'right' }, { scale: s, alpha: handAlpha });

  // the bump: a flash and a flat ring
  const bump = t - meetAt;
  if (bump > 0 && bump < 0.5) {
    const fade = 1 - bump / 0.5;
    glowDot(context, w * 0.5, y - size * 0.2, 14 * s, WHITE, fade);
    context.save();
    context.globalCompositeOperation = 'lighter';
    context.strokeStyle = `rgba(${CYAN}, ${0.8 * fade})`;
    context.lineWidth = 1 * s;
    context.beginPath();
    context.ellipse(w * 0.5, y - size * 0.2, w * 0.32 * (1 - fade) + 4 * s, h * 0.08 * (1 - fade) + 2 * s, 0, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }
  // END OF LINE, typed and flickering like a dying terminal
  if (shutdown <= 0) return;
  const text = 'END OF LINE';
  const shown = text.slice(0, Math.ceil(text.length * ramp(t, meetAt + 0.15, meetAt + 0.6)));
  const frame = Math.floor(t * 24);
  const flicker = t < meetAt + 0.9 || t > 2.45 ? (hash(frame, 5) > 0.35 ? 1 : 0.25) : 1;
  context.save();
  context.globalCompositeOperation = 'lighter';
  context.font = `500 ${Math.round(h * 0.11)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.shadowColor = `rgba(${CYAN}, 0.9)`;
  context.shadowBlur = 6 * s;
  context.fillStyle = `rgba(${WHITE}, ${shutdown * flicker})`;
  context.fillText(shown, w * 0.5, h * 0.2);
  context.restore();
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
  // its wall: a ribbon of glass standing on the lane, fading out towards the tail
  const wall = h * 0.11;
  const wallEnd = Math.min(headX - 12 * s, w + 20 * s);
  if (wallEnd > tailX) {
    drawRibbon(context, [{ x: tailX, y: laneY - wall }, { x: wallEnd, y: laneY - wall }],
      { height: wall, alpha: fade, body: 0.5, s, tail: { from: tailX - (wallEnd - tailX) * 0.15, to: wallEnd } });
  }
  if (headX > w + 10 * s) return;
  drawCycle(context, headX, laneY, fade, s);
  glowDot(context, headX, laneY, 11 * s, CYAN, 0.8 * fade);
}

// A light cycle, nose at (x, y) on its lane: a low white-hot body over two
// wheel rings.
function drawCycle(context, x, y, alpha, s) {
  context.save();
  context.globalCompositeOperation = 'lighter';
  context.strokeStyle = `rgba(${WHITE}, ${alpha})`;
  context.lineWidth = 1.2 * s;
  const length = 15 * s;
  context.beginPath();
  context.moveTo(x - length, y - 3.2 * s);
  context.lineTo(x + 1.5 * s, y - 3.2 * s);
  context.lineTo(x + 4.5 * s, y);
  context.stroke();
  for (const wheel of [x - length + 3 * s, x - 1.5 * s]) {
    context.beginPath();
    context.arc(wheel, y, 2.6 * s, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
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
  const size = h * 0.22;
  const y = h * 0.62;
  const show = ramp(t, 0.05, 0.35) * (1 - ramp(t, 3.25, 3.55));
  const shaka = blendPoses(POSES.open, POSES.shaka, show);
  const grip = blendPoses(POSES.open, POSES.fist, ramp(t, 1.0, 1.3) * (1 - ramp(t, 3.2, 3.5)));
  const lit = ramp(t, 0.35, 0.6) * (1 - ramp(t, 3.0, 3.3));
  const arrive = ramp(t, 0.6, 1.1) * (1 - ramp(t, 3.0, 3.4));
  const pull = ramp(t, 1.45, 2.05) * (1 - ramp(t, 2.95, 3.35));
  const spread = w * 0.11 * pull;

  // the baton hand on the left; the baton runs along its thumb-to-pinky line
  const left = hand(context, shaka, { x: w * 0.25 - spread, y, size, roll: 0.45, physical: 'right' }, { scale: s });
  const anchor = { x: (left[4].x + left[20].x) / 2, y: (left[4].y + left[20].y) / 2 };
  const angle = Math.atan2(left[20].y - left[4].y, left[20].x - left[4].x);
  const length = w * 0.42;
  const along = (distance) => ({ x: anchor.x + Math.cos(angle) * distance, y: anchor.y + Math.sin(angle) * distance });
  const far = along(length);

  // the other hand closes round the far end, then both pull apart
  if (arrive > 0) {
    const grab = { x: far.x + w * 0.25 * (1 - arrive) + spread * 2, y: far.y };
    hand(context, grip, { x: grab.x + size * 0.15, y: grab.y + size * 0.55, size, roll: -0.4, physical: 'left' },
      { scale: s, alpha: arrive });
  }
  if (lit <= 0) return;
  if (pull <= 0) {
    drawLightLine(context, [anchor, far], CYAN, lit, s * 1.2);
    glowDot(context, far.x, far.y, 6 * s, CYAN, 0.6 * lit);
    return;
  }
  // two halves, one in each hand, with the gap between them growing
  const half = length / 2;
  const leftEnd = along(half);
  const rightStart = { x: leftEnd.x + spread * 2, y: leftEnd.y };
  const rightEnd = { x: far.x + spread * 2, y: far.y };
  drawLightLine(context, [anchor, leftEnd], CYAN, lit, s * 1.2);
  drawLightLine(context, [rightStart, rightEnd], CYAN, lit, s * 1.2);
  for (const end of [leftEnd, rightStart]) glowDot(context, end.x, end.y, 6 * s, WHITE, 0.8 * lit * pull);
  // a light cycle rezzes in the gap
  const rez = ramp(t, 1.85, 2.3) * (1 - ramp(t, 2.95, 3.25));
  if (rez <= 0) return;
  const cycle = { x: (leftEnd.x + rightStart.x) / 2 + 7 * s, y: h * 0.86 };
  if (t < 2.25) glowDot(context, cycle.x - 5 * s, cycle.y, 14 * s, WHITE, Math.sin(Math.PI * ramp(t, 1.85, 2.25)));
  drawCycle(context, cycle.x, cycle.y, rez, s);
}

// A Recognizer seen from the front, as one outline (x across, y down, about
// one unit wide, the tip of its head at 0, 0): the crossbeam, the head
// hanging under it and two legs with knees and hooked feet. The same shape
// as the 3D one in effects/tron/recognizer.js.
const RECOGNIZER_HALF = [[0, -0.34], [0.33, -0.34], [0.43, -0.28], [0.5, 0.05], [0.5, 0.34], [0.47, 0.44],
  [0.41, 0.46], [0.39, 0.37], [0.37, 0.05], [0.27, -0.18], [0.12, -0.18], [0.06, -0.03], [0, 0]];
const RECOGNIZER_OUTLINE = [...RECOGNIZER_HALF, ...RECOGNIZER_HALF.slice(1, -1).reverse().map(([x, y]) => [-x, y])];

function recognizerPath(cx, cy, size) {
  const path = new Path2D();
  RECOGNIZER_OUTLINE.forEach(([x, y], index) => {
    if (index === 0) path.moveTo(cx + x * size, cy + y * size);
    else path.lineTo(cx + x * size, cy + y * size);
  });
  path.closePath();
  return path;
}

// Where the wall in the Recognizer glyph breaks up: fixed points along it.
const WALL_BITS = Array.from({ length: 22 }, (_, index) => ({ along: (index + 0.5) / 22, drift: hash(index, 3) }));

function recognizerScene(context, t, w, h, s) {
  const pose = blendPoses(POSES.open, POSES.three, ramp(t, 0.1, 0.4) * (1 - ramp(t, 3.2, 3.5)));
  hand(context, pose, { x: w * 0.13, y: h * 0.74, size: h * 0.24, roll: 0.1, physical: 'left' }, { scale: s });

  // it flies in from the hand's side, slows over the middle and flies off
  const flight = clamp01((t - 0.35) / 3.1);
  const eased = flight - (0.8 / (2 * Math.PI)) * Math.sin(2 * Math.PI * flight);
  const size = w * 0.5;
  const cx = mix(-0.32 * w, 1.32 * w, eased);
  const headY = h * 0.3;
  const floorY = h * 0.92;
  // a light wall on the floor: the cone breaks it into voxels as it passes
  const wall = { x0: w * 0.42, x1: w * 0.88, y: h * 0.74, height: h * 0.12 };
  const halfWidth = (y) => mix(w * 0.012, w * 0.1, (y - headY) / (floorY - headY));
  // everything left of the cone's far edge has been scanned
  let cut = cx + halfWidth(wall.y);
  if (flight <= 0) cut = -Infinity;
  else if (flight >= 1) cut = Infinity;
  const fadeIn = ramp(t, 0.05, 0.35);
  if (cut < wall.x1) {
    const from = Math.max(wall.x0, cut);
    drawRibbon(context, [{ x: from, y: wall.y - wall.height }, { x: wall.x1, y: wall.y - wall.height }],
      { height: wall.height, alpha: fadeIn, body: 0.4, s });
  }
  context.save();
  context.globalCompositeOperation = 'lighter';
  for (const bit of WALL_BITS) {
    const x = mix(wall.x0, wall.x1, bit.along);
    const age = (Math.min(cut, w * 2) - x) / (w * 0.45);
    if (age <= 0 || age > 1) continue;
    const voxel = (1.3 + bit.drift * 1.4) * s;
    const vx = x + (bit.drift - 0.5) * age * w * 0.25;
    const vy = wall.y - wall.height * (0.2 + 0.6 * bit.drift) + age * h * 0.18 * (0.5 + bit.drift);
    context.fillStyle = age < 0.08 ? `rgba(${WHITE}, ${1 - age})` : `rgba(${CYAN}, ${0.9 * (1 - age)})`;
    context.fillRect(vx - voxel / 2, vy - voxel / 2, voxel, voxel);
  }
  context.restore();
  if (flight <= 0 || flight >= 1) return;

  // the cone of light from under its head down to the floor
  context.save();
  context.globalCompositeOperation = 'lighter';
  const cone = new Path2D();
  cone.moveTo(cx - halfWidth(headY), headY);
  cone.lineTo(cx + halfWidth(headY), headY);
  cone.lineTo(cx + halfWidth(floorY), floorY);
  cone.lineTo(cx - halfWidth(floorY), floorY);
  cone.closePath();
  const beam = context.createLinearGradient(0, headY, 0, floorY);
  beam.addColorStop(0, `rgba(${ORANGE}, 0.32)`);
  beam.addColorStop(1, `rgba(${ORANGE}, 0.1)`);
  context.fillStyle = beam;
  context.fill(cone);
  context.strokeStyle = `rgba(${ORANGE}, 0.55)`;
  context.lineWidth = 0.8 * s;
  context.stroke(cone);
  context.strokeStyle = `rgba(${WHITE}, 0.8)`;
  context.lineWidth = 1 * s;
  context.beginPath();
  context.ellipse(cx, floorY, halfWidth(floorY), h * 0.035, 0, 0, Math.PI * 2);
  context.stroke();
  // the Recognizer: a dim body inside a glowing orange outline
  const body = recognizerPath(cx, headY, size);
  context.fillStyle = `rgba(${ORANGE}, 0.1)`;
  context.fill(body);
  context.lineJoin = 'miter';
  context.strokeStyle = `rgba(${ORANGE}, 0.25)`;
  context.lineWidth = 4 * s;
  context.stroke(body);
  context.strokeStyle = `rgba(${ORANGE}, 0.95)`;
  context.lineWidth = 1.2 * s;
  context.stroke(body);
  // the visor across its head
  context.strokeStyle = `rgba(${WHITE}, 0.9)`;
  context.lineWidth = 1 * s;
  context.beginPath();
  context.moveTo(cx - size * 0.07, headY - size * 0.12);
  context.lineTo(cx + size * 0.07, headY - size * 0.12);
  context.stroke();
  context.restore();
}

// The viewfinder between two corners: brackets, a hairline, and a bar
// under it that fills as the shot charges.
function drawViewfinder(context, a, b, charge, alpha, s) {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const arm = Math.min(9 * s, (x1 - x0) / 4, (y1 - y0) / 4);
  context.save();
  context.globalCompositeOperation = 'lighter';
  context.strokeStyle = `rgba(${CYAN}, ${0.3 * alpha})`;
  context.lineWidth = 0.8 * s;
  context.setLineDash([2 * s, 3 * s]);
  context.strokeRect(x0, y0, x1 - x0, y1 - y0);
  context.setLineDash([]);
  context.strokeStyle = `rgba(${WHITE}, ${0.95 * alpha})`;
  context.lineWidth = 1.3 * s;
  context.beginPath();
  for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x1, y1, -1, -1], [x0, y1, 1, -1]]) {
    context.moveTo(x + dx * arm, y);
    context.lineTo(x, y);
    context.lineTo(x, y + dy * arm);
  }
  context.stroke();
  context.fillStyle = `rgba(${CYAN}, ${0.9 * alpha})`;
  context.fillRect(x0, y1 + 3 * s, (x1 - x0) * charge, 1.2 * s);
  context.restore();
  return { x0, y0, x1, y1 };
}

// the corner of an L hand: between the thumb's base and the index knuckle
const cornerOf = (points) => ({ x: (points[2].x + points[5].x) / 2, y: (points[2].y + points[5].y) / 2 });

function snapshotScene(context, t, w, h, s) {
  const size = h * 0.25;
  const form = ramp(t, 0.1, 0.5) * (1 - ramp(t, 3.15, 3.5));
  const pose = blendPoses(POSES.open, POSES.frame, form);
  // left hand upside down at the top left, right hand at the bottom right
  const inward = 1 - ramp(t, 0, 0.45);
  const left = hand(context, pose, { x: w * (0.27 - 0.06 * inward), y: h * 0.26, size, roll: Math.PI,
    physical: 'left', palmFacing: false }, { scale: s });
  const right = hand(context, pose, { x: w * (0.73 + 0.06 * inward), y: h * 0.74, size, roll: 0,
    physical: 'right' }, { scale: s });
  const a = cornerOf(left);
  const b = cornerOf(right);
  const shotAt = 1.55;
  const charge = ramp(t, 0.55, shotAt);
  const finder = form > 0.6 && t < 2.9;
  const rect = finder ? drawViewfinder(context, a, b, charge, Math.min(1, (form - 0.6) / 0.3) * (1 - ramp(t, 2.6, 2.9)), s) : null;
  // the shutter: a flash over the frame
  const flash = t > shotAt ? 1 - ramp(t, shotAt, shotAt + 0.35) : 0;
  if (flash > 0 && rect) {
    context.save();
    context.globalCompositeOperation = 'lighter';
    context.fillStyle = `rgba(${WHITE}, ${0.55 * flash})`;
    context.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
    context.restore();
  }
  // the picture shrinks from the frame into the corner and stays a moment
  const slide = ramp(t, shotAt + 0.1, shotAt + 0.75);
  const thumbAlpha = ramp(t, shotAt + 0.05, shotAt + 0.2) * (1 - ramp(t, 3.1, 3.45));
  if (thumbAlpha <= 0 || !rect) return;
  const target = { x0: w * 0.66, y0: h * 0.05, x1: w * 0.95, y1: h * 0.05 + w * 0.29 * 0.75 };
  const box = {
    x0: mix(rect.x0, target.x0, slide), y0: mix(rect.y0, target.y0, slide),
    x1: mix(rect.x1, target.x1, slide), y1: mix(rect.y1, target.y1, slide),
  };
  context.save();
  context.globalCompositeOperation = 'lighter';
  const inside = context.createLinearGradient(0, box.y0, 0, box.y1);
  inside.addColorStop(0, `rgba(${BLUE}, ${0.1 * thumbAlpha})`);
  inside.addColorStop(1, `rgba(${BLUE}, ${0.28 * thumbAlpha})`);
  context.fillStyle = inside;
  context.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
  // a tiny horizon and a wall in the picture
  const midY = mix(box.y0, box.y1, 0.7);
  context.strokeStyle = `rgba(${CYAN}, ${0.6 * thumbAlpha})`;
  context.lineWidth = 0.8 * s;
  context.beginPath();
  context.moveTo(box.x0, midY);
  context.lineTo(box.x1, midY);
  context.moveTo(mix(box.x0, box.x1, 0.2), mix(box.y0, box.y1, 0.45));
  context.lineTo(mix(box.x0, box.x1, 0.55), mix(box.y0, box.y1, 0.45));
  context.stroke();
  context.strokeStyle = `rgba(${WHITE}, ${0.95 * thumbAlpha})`;
  context.lineWidth = 1 * s;
  context.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
  context.restore();
}

function grabScene(context, t, w, h, s) {
  const size = h * 0.25;
  // a light wall: picked up at its first run, dragged down and right, let go
  const drag = ramp(t, 1.0, 1.95);
  const offset = { x: w * 0.16 * drag, y: h * 0.26 * drag };
  const wallHeight = h * 0.13;
  const route = [[0.08, 0.3], [0.36, 0.3], [0.36, 0.17], [0.6, 0.17]]
    .map(([x, y]) => ({ x: w * x + offset.x, y: h * y + offset.y }));
  const held = ramp(t, 0.75, 0.85) * (1 - ramp(t, 2.1, 2.2));
  const wallAlpha = ramp(t, 0.05, 0.3) * (1 - ramp(t, 3.0, 3.4));
  drawRibbon(context, route, { height: wallHeight, alpha: wallAlpha, body: 0.26 + 0.25 * held, lean: 0.45, s });
  if (held > 0) drawLightLine(context, route, CYAN, 0.6 * held, s);

  // the pinch point: on the wall while it is held, then off to catch a disc
  const grip = { x: w * 0.22 + offset.x, y: h * 0.3 + wallHeight * 0.5 + offset.y };
  const start = { x: w * 0.8, y: h * 0.8 };
  const catchAt = { x: w * 0.72, y: h * 0.74 };
  const toWall = ramp(t, 0.1, 0.6);
  const away = ramp(t, 2.25, 2.6);
  const at = {
    x: mix(mix(start.x, grip.x, toWall), catchAt.x, away),
    y: mix(mix(start.y, grip.y, toWall), catchAt.y, away),
  };
  const pinched = ramp(t, 0.6, 0.75) * (1 - ramp(t, 2.05, 2.25)) + ramp(t, 2.95, 3.05) * (1 - ramp(t, 3.3, 3.55));
  const pose = blendPoses(POSES.open, POSES.pinch, pinched);
  // place the hand by its pinch point
  const probe = handPoints(pose, { x: 0, y: 0, size, roll: -0.15 });
  const pinchX = (probe[4].x + probe[8].x) / 2;
  const pinchY = (probe[4].y + probe[8].y) / 2;
  drawHand(context, probe.map((point) => ({ x: point.x + at.x - pinchX, y: point.y + at.y - pinchY, z: point.z })),
    { pose, scale: s });
  if (held > 0.5 && t < 2.1) glowDot(context, at.x, at.y, 7 * s, CYAN, 0.8);
  // a disc flies in from the left and the pinch snatches it out of the air
  const discT = ramp(t, 2.45, 3.0);
  const discAlpha = ramp(t, 2.45, 2.55) * (1 - ramp(t, 3.3, 3.55));
  if (discAlpha <= 0) return;
  const radius = h * 0.07;
  const discX = mix(-radius, catchAt.x, discT);
  const discY = catchAt.y - Math.sin(discT * Math.PI) * h * 0.08;
  drawDisc(context, discX, discY, radius, discAlpha, s, t * (discT < 1 ? 14 : 3));
  if (t > 3.0 && t < 3.3) glowDot(context, catchAt.x, catchAt.y, 12 * s, WHITE, 1 - (t - 3.0) / 0.3);
}

export const CONTROLS = [
  { id: 'point', name: 'Point', action: 'Draw a light wall', detail: 'Index finger only', scene: pointScene },
  { id: 'rock', name: 'Rock', action: 'Switch colour', detail: 'Index and pinky · cyan / orange, per hand',
    scene: rockScene },
  { id: 'ok', name: 'OK sign', action: 'Identity disc',
    detail: 'Flick to throw it; it bounces off walls and discs', scene: okScene },
  { id: 'pinch', name: 'Pinch', action: 'Grab walls and discs',
    detail: 'Drag a light wall, or snatch a thrown disc', scene: grabScene },
  { id: 'twoFists', name: 'Two fists', action: 'End of line', detail: 'Shuts the whole Grid down and reboots it',
    scene: twoFistsScene },
  { id: 'thumbsUp', name: 'Thumbs up', action: 'Launch a light cycle', detail: 'It rides out from your hand',
    scene: thumbsUpScene },
  { id: 'fist', name: 'Hold a fist', action: 'Derezz',
    detail: 'Hold it to break everything around your hand', scene: fistScene },
  { id: 'three', name: 'Three fingers', action: 'Call the Recognizer',
    detail: 'Its light cone derezzes what it flies over', scene: recognizerScene },
  { id: 'peace', name: 'Peace sign', action: 'Digitize yourself', detail: 'A laser sweep turns your outline into light',
    scene: peaceScene },
  { id: 'shaka', name: 'Shaka', action: 'Light baton',
    detail: 'Pull it apart and race CLU on a light cycle', scene: shakaScene },
  { id: 'palms', name: 'Both palms open', action: 'Open a portal', detail: 'Palms toward the camera',
    scene: portalScene },
  { id: 'frame', name: 'Frame it', action: 'Take a TRON photo',
    detail: 'Two Ls at opposite corners, held still', scene: snapshotScene },
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
