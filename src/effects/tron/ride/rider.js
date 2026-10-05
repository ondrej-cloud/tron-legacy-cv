// One light cycle in the arena: how it moves, the jetwall it leaves, and
// what it can run into. The Legacy cycles carve smooth curves: the bars
// turn the heading at a rate that drops as the speed rises, so a boosted
// cycle needs more room to turn.
//
// Positions are the rear wheel's contact point (where the jetwall comes
// out): x, z on the floor and y, its height; heading is the angle of the
// forward direction (cos, sin) in the x-z plane, growing to the right.
// Speed is measured across the floor.
//
// The cycle rides on the ground of terrain.js: it slows climbing and
// gathers speed going down, and where the ground falls away faster than
// gravity pulls it down (a kicker's lip, a deck's edge) it flies, until
// it lands again. Its jetwall always stands on the ground under it.
import { ARENA, BIKE } from './rules.js';
import { heightAt, slopeAlong } from './terrain.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const ease = (dt, timeConstant) => 1 - Math.exp(-dt / timeConstant);
const AIR_STEER = 0.4;        // how much the bars still turn it in the air
const AIR_PITCH = 0.55;       // in the air the nose follows this much of the flight path

export function createRider(team) {
  const rider = {
    team,                 // 0 TRON, 1 CLU
    x: 0,
    z: 0,
    y: 0,                 // height of the rear wheel's contact point
    vy: 0,                // vertical speed
    ground: 0,            // height of the ground under it
    airborne: false,      // flying: well clear of the ground
    pitch: 0,             // rad, nose up
    bank: 0,              // rad, the ground's tilt across it (positive: leaning right)
    heading: 0,
    speed: 0,
    steer: 0,             // current lock, -1 left .. 1 right
    lean: 0,
    spin: 0,              // wheel rotation
    alive: false,
    riding: false,        // on the move (not waiting at the start or derezzed)
    path: [],             // the jetwall: { x, z, y, along } from its oldest end (y: the ground)
    along: 0,             // distance ridden this round
    crashedAt: -Infinity,
    airTime: 0,           // s off the ground on this jump (0 on the ground)
    landings: 0,          // how many times it has come down from a jump this round
    impact: 0,            // m/s it came down at, the last time
    squash: 0,            // 1 right after a hard landing, easing back to 0
    previousNoseY: 0,     // noseY before the last step

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
    // height of the front wheel's contact point
    get noseY() {
      return this.y + Math.sin(this.pitch) * BIKE.length;
    },

    // at the start of a round: standing at `start`, no wall yet
    place(start) {
      this.x = start.x;
      this.z = start.z;
      this.heading = start.heading;
      this.ground = this.y = heightAt(start.x, start.z);
      this.vy = 0;
      this.airborne = false;
      this.pitch = Math.atan(slopeAlong(this.x, this.z, this.forwardX, this.forwardZ));
      this.bank = 0;
      this.speed = 0;
      this.steer = 0;
      this.lean = 0;
      this.alive = true;
      this.riding = false;
      this.path = [];
      this.along = 0;
      this.crashedAt = -Infinity;
      this.airTime = 0;
      this.landings = 0;
      this.impact = 0;
      this.squash = 0;
      this.previousNoseY = this.noseY;
    },

    launch() {
      this.riding = true;
      this.speed = BIKE.cruise * 0.6;
      this.path = [{ x: this.x, z: this.z, y: this.ground, along: 0 }];
    },

    // One simulation step. input: { steer (-1..1), throttle (0..1, 0.5
    // cruise), brake, idle (nobody holding the bars) }; pace: how much the
    // Grid has sped up this round (pace() below).
    step(dt, input, pace = 1) {
      if (!this.riding) return;
      this.previousNoseY = this.noseY;
      const flying = this.airborne;
      if (!flying) {
        const wanted = pace * (input.brake ? BIKE.brake
          : input.idle ? BIKE.idle
            : input.throttle >= 0.5 ? BIKE.cruise + (BIKE.boost - BIKE.cruise) * (input.throttle - 0.5) * 2
              : BIKE.brake + (BIKE.cruise - BIKE.brake) * input.throttle * 2);
        this.speed += (wanted - this.speed) * ease(dt, BIKE.accel);
        // climbing costs speed, going down gives it back
        const slope = clamp(slopeAlong(this.x, this.z, this.forwardX, this.forwardZ), -1, 1);
        this.speed = Math.max(BIKE.brake * 0.5, this.speed - BIKE.hillPull * slope * dt);
      }
      this.steer += (clamp(input.steer, -1, 1) - this.steer) * ease(dt, BIKE.steerEase);
      this.heading += this.steer * turnRate(this.speed) * (flying ? AIR_STEER : 1) * dt;
      this.x += Math.cos(this.heading) * this.speed * dt;
      this.z += Math.sin(this.heading) * this.speed * dt;
      this.along += this.speed * dt;
      this.fall(dt);
      const last = this.path[this.path.length - 1];
      if (Math.hypot(this.x - last.x, this.z - last.z) >= BIKE.sampleSpacing) {
        this.path.push({ x: this.x, z: this.z, y: this.ground, along: this.along });
      }
      this.tilt(dt);
      // into the turn, more at speed
      const leanTarget = this.steer * BIKE.maxLean * clamp(this.speed / BIKE.cruise, 0.4, 1.2) * (this.airborne ? 0.5 : 1);
      this.lean += (leanTarget - this.lean) * ease(dt, 0.12);
      this.spin += (this.speed / (0.33 * BIKE.length)) * dt;
    },

    // Up and down: gravity pulls it towards the ground, and the ground
    // carries it up where it rises. Where the ground drops away faster
    // than it falls, it leaves the ground.
    fall(dt) {
      const ground = heightAt(this.x, this.z);
      const groundRate = (ground - this.ground) / dt;
      this.ground = ground;
      this.vy -= BIKE.gravity * dt;
      this.y += this.vy * dt;
      if (this.y <= ground) {
        if (this.airTime > 0.15) {
          // coming down: the harder, the more speed it loses
          this.impact = Math.max(0, groundRate - this.vy);
          this.landings++;
          this.squash = Math.min(1, this.impact / (BIKE.hardLanding * 1.6));
          this.speed *= 1 - 0.12 * clamp(this.impact / BIKE.hardLanding - 0.5, 0, 1);
        }
        this.y = ground;
        this.vy = Math.min(groundRate, BIKE.maxLift);
        this.airTime = 0;
      } else {
        this.airTime += dt;
      }
      this.airborne = this.y - ground > BIKE.airborneAbove;
      this.squash *= 1 - ease(dt, 0.14);
    },

    // The nose follows the ground (never dipping into it) or, in the air,
    // a little of the flight path; the ground's slope across tilts it.
    tilt(dt) {
      const fx = this.forwardX;
      const fz = this.forwardZ;
      let pitchTarget;
      let bankTarget = 0;
      if (this.y - this.ground < 0.05) {
        pitchTarget = Math.atan(slopeAlong(this.x, this.z, fx, fz));
        const middleX = this.x + fx * BIKE.length * 0.5;
        const middleZ = this.z + fz * BIKE.length * 0.5;
        // the bike's right is (-sin, cos)
        bankTarget = -Math.atan(slopeAlong(middleX, middleZ, -fz, fx));
      } else {
        pitchTarget = AIR_PITCH * Math.atan2(this.vy, Math.max(1, this.speed));
      }
      this.pitch += (pitchTarget - this.pitch) * ease(dt, this.airborne ? 0.25 : 0.05);
      // the front wheel stays on top of the ground
      const front = heightAt(this.noseX, this.noseZ);
      const lowest = Math.asin(clamp((front - this.y) / BIKE.length, -1, 1));
      if (this.pitch < lowest) this.pitch = lowest;
      this.bank += (bankTarget - this.bank) * ease(dt, 0.08);
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

// Every stretch of standing jetwall, as segments { ax, az, ay, bx, bz, by,
// rider, along } (ay, by: the ground the wall stands on at each end; along:
// how far into the rider's round its far end is), the live stretch from
// the last stored point to the bike included. Reuses the objects already
// in `out`.
export function wallSegments(riders, out = []) {
  let count = 0;
  const put = (a, bx, bz, by, rider, along) => {
    const segment = out[count] ?? (out[count] = {});
    segment.ax = a.x;
    segment.az = a.z;
    segment.ay = a.y;
    segment.bx = bx;
    segment.bz = bz;
    segment.by = by;
    segment.rider = rider;
    segment.along = along;
    count++;
  };
  for (const rider of riders) {
    const path = rider.path;
    for (let index = 1; index < path.length; index++) {
      const b = path[index];
      put(path[index - 1], b.x, b.z, b.y, rider, b.along);
    }
    const last = path[path.length - 1];
    if (last && rider.riding) put(last, rider.x, rider.z, rider.ground, rider, rider.along);
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

// Does a move from (x0, z0) at height y0 to (x1, z1) at y1 cross a jetwall
// below its top? A cycle high enough in the air flies over one.
// `skip(segment)` leaves segments out, as for castRay.
export function crossesWall(x0, z0, y0, x1, z1, y1, segments, skip = null) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  for (const segment of segments) {
    if (skip && skip(segment)) continue;
    const ex = segment.bx - segment.ax;
    const ez = segment.bz - segment.az;
    const denominator = dx * ez - dz * ex;
    if (Math.abs(denominator) < 1e-12) continue;
    const wx = segment.ax - x0;
    const wz = segment.az - z0;
    const t = (wx * ez - wz * ex) / denominator;   // along the move, 0..1
    const u = (wx * dz - wz * dx) / denominator;   // along the segment, 0..1
    if (t < 0 || t >= 1 || u < 0 || u > 1) continue;
    const top = (segment.ay ?? 0) + ((segment.by ?? 0) - (segment.ay ?? 0)) * u + BIKE.wallHeight;
    if (y0 + (y1 - y0) * t < top) return true;
  }
  return false;
}

// its own wall right behind it can't be hit
export function ownTail(rider) {
  const recent = rider.along - BIKE.ownTailGap;
  return (segment) => segment.rider === rider && segment.along > recent;
}

// Shortest distance between the bodies (tail to nose) of two bikes; one
// flying over the other is that much further away.
export function bikeDistance(a, b) {
  const across = segmentDistance(a.x, a.z, a.noseX, a.noseZ, b.x, b.z, b.noseX, b.noseZ);
  return Math.hypot(across, a.y - b.y);
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
