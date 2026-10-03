// How a light cycle rides the Grid: straight runs and sharp 90° turns, like
// the arena games in the film. Every so often it turns left or right,
// towards the side with more room, and it turns early when the edge of its
// stretch of floor or a jetwall comes up ahead. The wall it leaves turns a
// sharp corner; the bike itself swings round in a fraction of a second and
// leans into the turn. Riding into a jetwall derezzes it (cycles.js).
//
// Floor coordinates: x across, z into the frame; heading 0 rides along +x,
// a positive turn is a left turn.
import { easeTowards } from './filters.js';

export const RIDE = {
  runTime: [0.7, 1.4],    // s between turns
  minRun: 0.25,           // s, shortest run (unless something is in the way)
  margin: 0.14,           // floor units (x sqrt of the bike's scale) kept clear ahead of the nose
  reach: 1.6,             // floor units it looks ahead at most
  probe: 0.04,            // floor units between the tests for the edge of the floor
  maxLean: 0.42,          // rad
  leanIn: 0.05,           // s, time constant of leaning into a turn ...
  leanOut: 0.22,          // ... and of straightening up again
  swing: 0.045,           // s, time constant of the bike swinging round a corner
};

const random = ([low, high]) => low + Math.random() * (high - low);

// Distance along a ray from (x, z) to the nearest wall segment it hits
// ({ ax, az, bx, bz }), or Infinity. skip(segment) leaves a segment out.
export function rayToWalls(x, z, dx, dz, segments, maxDistance, skip) {
  let best = Infinity;
  for (const segment of segments) {
    if (skip && skip(segment)) continue;
    const ex = segment.bx - segment.ax;
    const ez = segment.bz - segment.az;
    const denominator = dx * ez - dz * ex;
    if (Math.abs(denominator) < 1e-9) continue;   // parallel
    const ox = segment.ax - x;
    const oz = segment.az - z;
    const t = (ox * ez - oz * ex) / denominator;
    const s = (ox * dz - oz * dx) / denominator;
    if (t >= 0 && t <= maxDistance && s >= 0 && s <= 1 && t < best) best = t;
  }
  return best;
}

// How far a cycle can ride from (x, z) along `heading` before it leaves
// the floor (inside(x, z) false) or meets a wall.
export function freeDistance(x, z, heading, { inside, segments, skip }) {
  const dx = Math.cos(heading);
  const dz = Math.sin(heading);
  let edge = RIDE.reach;
  for (let distance = RIDE.probe; distance <= RIDE.reach; distance += RIDE.probe) {
    if (!inside(x + dx * distance, z + dz * distance)) {
      edge = distance - RIDE.probe;
      break;
    }
  }
  return Math.min(edge, rayToWalls(x, z, dx, dz, segments, RIDE.reach, skip));
}

// Room along `heading`, plus some credit for the room it would have to turn
// into further on, so it doesn't ride into a dead end.
function outlook(cycle, heading, need, world) {
  const room = freeDistance(cycle.x, cycle.z, heading, world);
  const ahead = Math.min(room, need);
  const x = cycle.x + Math.cos(heading) * ahead;
  const z = cycle.z + Math.sin(heading) * ahead;
  const then = Math.max(freeDistance(x, z, heading + Math.PI / 2, world),
    freeDistance(x, z, heading - Math.PI / 2, world));
  return { room, score: room + 0.5 * then };
}

// One frame of riding: picks turns and makes them (turn(cycle, sign) pushes
// the corner and changes the heading), and eases the bike's swing and lean.
// cycle: { x, z, heading, yaw, lean, leanKick, nextTurn, lastTurn, lastSign, length, scale }
// with length the bike's length in floor units.
export function steer(cycle, now, dt, world, turn) {
  const need = cycle.length + RIDE.margin * Math.sqrt(cycle.scale);
  const ahead = freeDistance(cycle.x, cycle.z, cycle.heading, world);
  const settled = now - cycle.lastTurn >= RIDE.minRun;
  // right after a turn it rides on a little before it turns again, unless
  // its nose is about to touch something
  const blocked = ahead < need && (settled || ahead < cycle.length + RIDE.margin * 0.3);
  const due = now >= cycle.nextTurn && settled;
  if (blocked || due) {
    const options = [1, -1]
      // two quick turns the same way would double back alongside its own wall
      .filter((sign) => settled || sign !== cycle.lastSign)
      .map((sign) => ({ sign, ...outlook(cycle, cycle.heading + sign * Math.PI / 2, need, world) }));
    let chosen = null;
    if (blocked) {
      // something is in the way: the better way out, if it is better than straight on
      const best = options.reduce((a, b) => (b.score > a.score ? b : a), options[0]);
      if (best && best.room > ahead) chosen = best;
    } else if (Math.random() < 0.85) {
      // a turn for its own sake: somewhere roomy, more likely the roomier
      const roomy = options.filter((option) => option.room > need);
      const weights = roomy.map((option) => option.score ** 2);
      let pick = Math.random() * weights.reduce((sum, weight) => sum + weight, 0);
      chosen = roomy.find((option, index) => (pick -= weights[index]) <= 0) ?? null;
    }
    if (chosen) {
      turn(cycle, chosen.sign);
      cycle.heading += chosen.sign * Math.PI / 2;
      cycle.leanKick = -chosen.sign;
      cycle.lastTurn = now;
      cycle.lastSign = chosen.sign;
    }
    cycle.nextTurn = now + (blocked ? 0.1 : random(RIDE.runTime));
  }

  // the bike swings round the corner and leans into it, then straightens up
  const difference = Math.atan2(Math.sin(cycle.heading - cycle.yaw), Math.cos(cycle.heading - cycle.yaw));
  cycle.yaw += difference * (1 - Math.exp(-dt / RIDE.swing));
  cycle.leanKick *= Math.exp(-dt / RIDE.leanOut);
  cycle.lean = easeTowards(cycle.lean, cycle.leanKick * RIDE.maxLean, dt, RIDE.leanIn);
}
