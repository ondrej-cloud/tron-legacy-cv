// One light cycle in the arena: how it moves, the jetwall it leaves, and
// what it can run into. The Legacy cycles carve smooth curves: the bars
// turn the heading at a rate that drops as the speed rises, so a boosted
// cycle needs more room to turn.
//
// Positions are the rear wheel's contact point (where the jetwall comes
// out) on the floor plane: x, z in world units; heading is the angle of
// the forward direction (cos, sin) in the x-z plane, growing to the right.
import { ARENA, BIKE } from './rules.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const ease = (dt, timeConstant) => 1 - Math.exp(-dt / timeConstant);

export function createRider(team) {
  const rider = {
    team,                 // 0 TRON, 1 CLU
    x: 0,
    z: 0,
    heading: 0,
    speed: 0,
    steer: 0,             // current lock, -1 left .. 1 right
    lean: 0,
    spin: 0,              // wheel rotation
    alive: false,
    riding: false,        // on the move (not waiting at the start or derezzed)
    path: [],             // the jetwall: { x, z, along } from its oldest end
    along: 0,             // distance ridden this round
    crashedAt: -Infinity,

    get forwardX() {
      return Math.cos(this.heading);
    },
    get forwardZ() {
      return Math.sin(this.heading);
    },
    get noseX() {
      return this.x + Math.cos(this.heading) * BIKE.length;
    },
    get noseZ() {
      return this.z + Math.sin(this.heading) * BIKE.length;
    },

    // at the start of a round: standing at `start`, no wall yet
    place(start) {
      this.x = start.x;
      this.z = start.z;
      this.heading = start.heading;
      this.speed = 0;
      this.steer = 0;
      this.lean = 0;
      this.alive = true;
      this.riding = false;
      this.path = [];
      this.along = 0;
      this.crashedAt = -Infinity;
    },

    launch() {
      this.riding = true;
      this.speed = BIKE.cruise * 0.6;
      this.path = [{ x: this.x, z: this.z, along: 0 }];
    },

    // One simulation step. input: { steer (-1..1), throttle (0..1, 0.5
    // cruise), brake, idle (nobody holding the bars) }; pace: how much the
    // Grid has sped up this round (pace() below).
    step(dt, input, pace = 1) {
      if (!this.riding) return;
      const wanted = pace * (input.brake ? BIKE.brake
        : input.idle ? BIKE.idle
          : input.throttle >= 0.5 ? BIKE.cruise + (BIKE.boost - BIKE.cruise) * (input.throttle - 0.5) * 2
            : BIKE.brake + (BIKE.cruise - BIKE.brake) * input.throttle * 2);
      this.speed += (wanted - this.speed) * ease(dt, BIKE.accel);
      this.steer += (clamp(input.steer, -1, 1) - this.steer) * ease(dt, BIKE.steerEase);
      this.heading += this.steer * turnRate(this.speed) * dt;
      this.x += Math.cos(this.heading) * this.speed * dt;
      this.z += Math.sin(this.heading) * this.speed * dt;
      this.along += this.speed * dt;
      const last = this.path[this.path.length - 1];
      if (Math.hypot(this.x - last.x, this.z - last.z) >= BIKE.sampleSpacing) {
        this.path.push({ x: this.x, z: this.z, along: this.along });
      }
      // into the turn, more at speed
      const leanTarget = this.steer * BIKE.maxLean * clamp(this.speed / BIKE.cruise, 0.4, 1.2);
      this.lean += (leanTarget - this.lean) * ease(dt, 0.12);
      this.spin += (this.speed / (0.33 * BIKE.length)) * dt;
    },
  };
  return rider;
}

// The longer a round goes on, the faster everyone rides: after a while
// the curves get wider and somebody runs out of room.
export function pace(roundTime) {
  return 1 + Math.min(0.6, Math.max(0, roundTime - BIKE.paceAfter) * BIKE.paceRate);
}

// rad/s at full lock: quickest when braking, slowest at boost
export function turnRate(speed) {
  if (speed <= BIKE.cruise) {
    const t = clamp((speed - BIKE.brake) / (BIKE.cruise - BIKE.brake), 0, 1);
    return BIKE.turnAtBrake + (BIKE.turnRate - BIKE.turnAtBrake) * t;
  }
  const t = clamp((speed - BIKE.cruise) / (BIKE.boost - BIKE.cruise), 0, 1);
  return BIKE.turnRate + (BIKE.turnAtBoost - BIKE.turnRate) * t;
}

// Every stretch of standing jetwall, as segments { ax, az, bx, bz, rider,
// along } (along: how far into the rider's round its far end is), the
// live stretch from the last stored point to the bike included. Reuses the
// objects already in `out`.
export function wallSegments(riders, out = []) {
  let count = 0;
  const put = (ax, az, bx, bz, rider, along) => {
    const segment = out[count] ?? (out[count] = {});
    segment.ax = ax;
    segment.az = az;
    segment.bx = bx;
    segment.bz = bz;
    segment.rider = rider;
    segment.along = along;
    count++;
  };
  for (const rider of riders) {
    const path = rider.path;
    for (let index = 1; index < path.length; index++) {
      const a = path[index - 1];
      const b = path[index];
      put(a.x, a.z, b.x, b.z, rider, b.along);
    }
    const last = path[path.length - 1];
    if (last && rider.riding) put(last.x, last.z, rider.x, rider.z, rider, rider.along);
  }
  out.length = count;
  return out;
}

// Distance along the ray from (x, z) in direction (dx, dz) (unit length)
// to the first wall segment or the arena boundary, up to `reach`.
// `skip(segment)` leaves segments out (a rider's own newest wall).
export function castRay(x, z, dx, dz, segments, reach, skip = null) {
  let nearest = reach;
  // the boundary: the square |x|, |z| <= half
  const half = ARENA.half;
  if (dx > 1e-6) nearest = Math.min(nearest, (half - x) / dx);
  if (dx < -1e-6) nearest = Math.min(nearest, (-half - x) / dx);
  if (dz > 1e-6) nearest = Math.min(nearest, (half - z) / dz);
  if (dz < -1e-6) nearest = Math.min(nearest, (-half - z) / dz);
  nearest = Math.max(0, nearest);
  for (const segment of segments) {
    if (skip && skip(segment)) continue;
    const ex = segment.bx - segment.ax;
    const ez = segment.bz - segment.az;
    const denominator = dx * ez - dz * ex;
    if (Math.abs(denominator) < 1e-9) continue;
    const wx = segment.ax - x;
    const wz = segment.az - z;
    const t = (wx * ez - wz * ex) / denominator;   // along the ray
    const u = (wx * dz - wz * dx) / denominator;   // along the segment
    if (t >= 0 && t < nearest && u >= 0 && u <= 1) nearest = t;
  }
  return nearest;
}

// its own wall right behind it can't be hit
export function ownTail(rider) {
  const recent = rider.along - BIKE.ownTailGap;
  return (segment) => segment.rider === rider && segment.along > recent;
}

// Shortest distance between the bodies (tail to nose) of two bikes.
export function bikeDistance(a, b) {
  return segmentDistance(a.x, a.z, a.noseX, a.noseZ, b.x, b.z, b.noseX, b.noseZ);
}

function segmentDistance(ax, az, bx, bz, cx, cz, dx, dz) {
  const point = (px, pz, sx, sz, ex, ez) => {
    const lx = ex - sx;
    const lz = ez - sz;
    const t = clamp(((px - sx) * lx + (pz - sz) * lz) / Math.max(1e-9, lx * lx + lz * lz), 0, 1);
    return Math.hypot(px - (sx + lx * t), pz - (sz + lz * t));
  };
  return Math.min(point(ax, az, cx, cz, dx, dz), point(bx, bz, cx, cz, dx, dz),
    point(cx, cz, ax, az, bx, bz), point(dx, dz, ax, az, bx, bz));
}
