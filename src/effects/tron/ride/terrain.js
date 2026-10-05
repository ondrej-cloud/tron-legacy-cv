// The arena's ground: a flat Grid at y = 0 with a few shapes raised out of
// it or sunk into it, laid out so a duel has room to race and places to
// jump. Everything is a smooth function of the floor position (no steps),
// so a cycle can ride over any of it; a steep edge just throws it into
// the air.
//
//   bowl     a sunken oval in the middle, ringed by a low raised berm
//   deck     a raised platform: a long ramp up at one end, steep banks on
//            the other sides (ride off them at speed and you fly)
//   kicker   a short ramp that steepens to a lip: a jump
//
// The layout is point-symmetric about the centre, like the start
// positions, so neither side has the better floor.
//
// Each feature is placed by its centre (x, z) and a heading: the
// direction you ride to use it (up the ramp, off the lip). In its own
// frame, u runs along the heading and v across it.
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
// a smooth bump: 1 at 0, falling to 0 at |x| = 1
const bump = (x) => (Math.abs(x) >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * x));

const KICKER = { back: 7, side: 3.5 };       // m: the slope down behind the lip, the falloff at its sides
const BOWL = { gap: 8, ringWidth: 6 };       // m: the berm's crest beyond the bowl's edge, its half width

const PLAN = [
  // the pit in the middle, between the two starts
  { type: 'bowl', x: 0, z: 0, heading: Math.PI / 2, length: 56, width: 44, height: -3.2, rim: 0.7 },
  // two decks each side, ramps facing the open floor
  { type: 'deck', x: -104, z: 64, heading: Math.PI / 2, length: 64, width: 36, height: 4.5, ramp: 26, bank: 8 },
  { type: 'deck', x: 64, z: 112, heading: Math.PI, length: 56, width: 30, height: 4.5, ramp: 24, bank: 8 },
  // kickers out on the floor ...
  { type: 'kicker', x: -46, z: 0, heading: Math.PI / 2, length: 18, width: 10, height: 2.2 },
  { type: 'kicker', x: 20, z: -130, heading: 0, length: 18, width: 10, height: 2.2 },
  { type: 'kicker', x: -140, z: -20, heading: -Math.PI / 2, length: 18, width: 10, height: 2.2 },
  // ... and one on a deck, off its inner edge (towards open floor, not the
  // boundary): a long drop
  { type: 'kicker', x: -93, z: 80, heading: 0, length: 14, width: 12, height: 1.8 },
];

// the plan and its mirror image through the centre
function layout(plan) {
  const list = [];
  for (const feature of plan) {
    list.push(feature);
    if (feature.x === 0 && feature.z === 0) continue;   // symmetric already
    list.push({ ...feature, x: -feature.x, z: -feature.z, heading: feature.heading + Math.PI });
  }
  return list.map((feature, index) => prepare(feature, index));
}

// cached frame and a bounding radius for the quick "not near it" test
function prepare(plan, index) {
  const feature = plan.type === 'kicker' ? { ...KICKER, ...plan } : plan.type === 'bowl' ? { ...BOWL, ...plan } : plan;
  const halfLength = feature.length / 2;
  const halfWidth = feature.width / 2;
  // how far it reaches in its own frame: u from back to front, v either side
  let bounds;
  if (feature.type === 'deck') {
    bounds = { back: -halfLength - feature.ramp, front: halfLength + feature.bank, side: halfWidth + feature.bank };
  } else if (feature.type === 'kicker') {
    bounds = { back: -halfLength, front: halfLength, side: halfWidth + feature.side };
  } else {
    const grow = 1 + (feature.gap + feature.ringWidth) / Math.min(halfLength, halfWidth);
    bounds = { back: -halfLength * grow, front: halfLength * grow, side: halfWidth * grow };
  }
  const cos = Math.cos(feature.heading);
  const sin = Math.sin(feature.heading);
  const out = {
    ...feature,
    index,
    cos,
    sin,
    halfLength,
    halfWidth,
    bounds,
    reach: Math.hypot(Math.max(-bounds.back, bounds.front), bounds.side),
  };
  if (feature.type === 'kicker') {
    // where the lip is, and where the ramp starts: for planning a jump
    const lip = halfLength - feature.back;
    out.lip = { x: feature.x + cos * lip, z: feature.z + sin * lip, height: 0 };   // set below
    out.foot = { x: feature.x - cos * halfLength, z: feature.z - sin * halfLength };
  }
  return out;
}

// Every feature, for planning (brain.js) and drawing (arena.js): { type,
// index, x, z, heading, cos, sin, length, width, height (negative: a
// bowl's depth), halfLength, halfWidth, bounds { back, front, side } (how
// far the ground is raised or sunk along u, and either side in v), reach
// (bounding radius) }; decks
// with ramp and bank (m); bowls with rim (the berm's height), gap (from
// the bowl's edge to the berm's crest) and ringWidth (the berm's half
// width); kickers with back (the slope behind the lip), side (falloff),
// lip { x, z, height } and foot { x, z } (where the ramp starts).
export const features = layout(PLAN);

function deckHeight(feature, u, v) {
  const { halfLength, halfWidth, ramp, bank } = feature;
  let along = 1;
  if (u < -halfLength) along = smoothstep(-halfLength - ramp, -halfLength, u);
  else if (u > halfLength) along = 1 - smoothstep(halfLength, halfLength + bank, u);
  const across = 1 - smoothstep(halfWidth, halfWidth + bank, Math.abs(v));
  return feature.height * along * across;
}

function kickerHeight(feature, u, v) {
  const { halfLength, halfWidth } = feature;
  if (u <= -halfLength || u >= halfLength) return 0;
  const lip = halfLength - feature.back;
  let along;
  if (u < lip) {
    // steepening all the way to the lip, so it throws the cycle upwards
    const t = (u + halfLength) / (lip + halfLength);
    along = t * t;
  } else {
    along = 1 - smoothstep(lip, halfLength, u);
  }
  const across = 1 - smoothstep(halfWidth, halfWidth + feature.side, Math.abs(v));
  return feature.height * along * across;
}

function bowlHeight(feature, u, v) {
  const radius = Math.min(feature.halfLength, feature.halfWidth);
  const r = Math.hypot(u / feature.halfLength, v / feature.halfWidth);
  const pit = feature.height * bump(Math.min(r, 1));
  // the berm follows the oval, a little way out from its edge
  const ring = feature.rim * bump(((r - 1) * radius - feature.gap) / feature.ringWidth);
  return pit + ring;
}

const SHAPES = { deck: deckHeight, kicker: kickerHeight, bowl: bowlHeight };

// The ground's height at floor position (x, z). Features don't overlap
// except kickers on decks, which add up.
export function heightAt(x, z) {
  let height = 0;
  for (const feature of features) {
    const dx = x - feature.x;
    const dz = z - feature.z;
    if (dx * dx + dz * dz > feature.reach * feature.reach) continue;
    const u = dx * feature.cos + dz * feature.sin;
    const v = -dx * feature.sin + dz * feature.cos;
    height += SHAPES[feature.type](feature, u, v);
  }
  return height;
}

const EPSILON = 0.25;

// The ground's unit normal at (x, z), into `out` ({ x, y, z }).
export function normalAt(x, z, out = { x: 0, y: 1, z: 0 }) {
  const gx = (heightAt(x + EPSILON, z) - heightAt(x - EPSILON, z)) / (2 * EPSILON);
  const gz = (heightAt(x, z + EPSILON) - heightAt(x, z - EPSILON)) / (2 * EPSILON);
  const length = Math.hypot(gx, 1, gz);
  out.x = -gx / length;
  out.y = 1 / length;
  out.z = -gz / length;
  return out;
}

// How steeply the ground rises along the unit direction (dx, dz) at
// (x, z): height gained per unit ridden (negative downhill).
export function slopeAlong(x, z, dx, dz) {
  return (heightAt(x + dx * EPSILON, z + dz * EPSILON) - heightAt(x - dx * EPSILON, z - dz * EPSILON)) / (2 * EPSILON);
}

// a kicker can stand on a deck: its lip is that much higher
for (const feature of features) {
  if (feature.lip) feature.lip.height = heightAt(feature.lip.x, feature.lip.z);
}
