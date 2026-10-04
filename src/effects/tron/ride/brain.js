// CLU's riding: it looks ahead along a fan of rays for walls, picks the
// direction with the most room that also gets it where it wants to be, and
// steers into it. Where it wants to be: across the player's path, a little
// ahead of where the player is going, to cut them off. It is fair, not
// perfect: it re-thinks a few times a second rather than every frame, it
// misjudges distances a little, and its look-ahead is limited, so a player
// who boxes it in can catch it.
//
// The same brain, more careful and less aggressive, rides the player's
// cycle in demo mode (demo.js turns its steering into scripted fists).
import { BIKE } from './rules.js';
import { castRay, ownTail, turnRate } from './rider.js';

const DEGREES = Math.PI / 180;
const LOCKS = [-1, -0.6, -0.3, 0, 0.3, 0.6, 1];     // steering values it tries
const HORIZON = 1.4;                                  // s of each arc it rides in its head
const ARC_STEPS = 7;
const ROOM_ANGLES = [-50, 0, 50].map((angle) => angle * DEGREES);

export const PERSONAS = {
  // CLU cuts in hard and sees less far ahead than it should
  clu: { reaction: 0.16, reach: 55, misjudge: 0.12, aggression: 2.2 },
  // the demo's rider plays it safe and waits for CLU's mistakes
  autopilot: { reaction: 0.1, reach: 100, misjudge: 0.03, aggression: 1.0 },
};


// random: a () => 0..1 source (seeded, so a demo plays out the same way)
export function createBrain(persona, random) {
  let nextThink = 0;
  let wantedSteer = 0;
  let brake = false;
  let boost = 0.5;
  const output = { steer: 0, throttle: 0.5, brake: false, idle: false };

  // The opponent's bike and where it will be in a moment, as walls: don't
  // ride into it head-on.
  function opponentAhead(opponent, out) {
    out.length = 0;
    if (!opponent?.alive || !opponent.riding) return out;
    const reach = BIKE.length + opponent.speed * 0.7;
    out.push({ ax: opponent.x, az: opponent.z, rider: null, along: Infinity,
      bx: opponent.x + opponent.forwardX * reach, bz: opponent.z + opponent.forwardZ * reach });
    return out;
  }

  // How good a cut-off riding along `heading` would be: 0 if it doesn't
  // cross the opponent's path in front of them, getting there first;
  // more the closer in front of them it crosses.
  function cutOff(self, opponent, heading) {
    const dx = Math.cos(heading);
    const dz = Math.sin(heading);
    const ox = opponent.forwardX;
    const oz = opponent.forwardZ;
    // crossing in front of a cycle coming the other way is a head-on crash
    if (dx * ox + dz * oz < -0.4) return 0;
    const denominator = dx * oz - dz * ox;
    if (Math.abs(denominator) < 0.2) return 0;   // nearly parallel
    const wx = opponent.x - self.noseX;
    const wz = opponent.z - self.noseZ;
    const mine = (wx * oz - wz * ox) / denominator;      // along my ray
    const theirs = (wx * dz - wz * dx) / denominator;    // along their path
    if (mine <= 0 || theirs <= BIKE.length || mine > persona.reach) return 0;
    const lead = theirs / Math.max(5, opponent.speed) - mine / Math.max(5, self.speed);
    if (lead < 0.25) return 0;   // they'd be there first
    return Math.exp(-theirs / 35);
  }

  // Rides an arc at a fixed lock for `horizon` seconds (at today's speed)
  // and returns how long it lasts before hitting something, and the
  // position and heading at its end.
  function tryArc(self, steer, obstacles, skip, result) {
    const rate = steer * turnRate(self.speed);
    let x = self.noseX;
    let z = self.noseZ;
    let heading = self.heading;
    const step = HORIZON / ARC_STEPS;
    result.lasted = HORIZON;
    for (let index = 0; index < ARC_STEPS; index++) {
      heading += rate * step;
      const dx = Math.cos(heading);
      const dz = Math.sin(heading);
      const length = self.speed * step;
      const free = castRay(x, z, dx, dz, obstacles, length, skip);
      if (free < length) {
        result.lasted = step * (index + free / length);
        break;
      }
      x += dx * length;
      z += dz * length;
    }
    result.x = x;
    result.z = z;
    result.heading = heading;
    return result;
  }

  const virtual = [];
  const arc = { lasted: 0, x: 0, z: 0, heading: 0 };
  function think(self, opponent, segments) {
    const skip = ownTail(self);
    const obstacles = segments.concat(opponentAhead(opponent, virtual));
    const chasing = opponent?.alive && opponent.riding;
    let best = 0;
    let bestScore = -Infinity;
    let bestLasted = HORIZON;
    for (const steer of LOCKS) {
      tryArc(self, steer, obstacles, skip, arc);
      let score = 3 * arc.lasted / HORIZON;
      if (arc.lasted >= HORIZON) {
        // room left at the end of the arc, straight on and to the sides
        let room = 0;
        for (const angle of ROOM_ANGLES) {
          const heading = arc.heading + angle;
          room += castRay(arc.x, arc.z, Math.cos(heading), Math.sin(heading), obstacles, persona.reach, skip);
        }
        room = (room / ROOM_ANGLES.length) * (1 + (random() - 0.5) * 2 * persona.misjudge);
        score += room / persona.reach;
        if (chasing) score += persona.aggression * cutOff(self, opponent, arc.heading);
      }
      score -= Math.abs(steer) * 0.06 + Math.abs(steer - output.steer) * 0.04;   // no weaving for nothing
      if (score > bestScore) {
        bestScore = score;
        best = steer;
        bestLasted = arc.lasted;
      }
    }
    wantedSteer = best;
    // no way out at this speed: slow down to turn tighter
    brake = bestLasted < HORIZON * 0.8;
    const ahead = castRay(self.noseX, self.noseZ, self.forwardX, self.forwardZ, obstacles, persona.reach, skip);
    // boost down open straights when it has someone to cut off
    boost = !brake && ahead > persona.reach * 0.8 && chasing && Math.abs(best) < 0.4 ? 0.5 + 0.4 * persona.aggression : 0.5;
  }

  return {
    persona,
    reset() {
      nextThink = 0;
      wantedSteer = 0;
      output.steer = 0;
    },
    // self, opponent: riders; segments: wallSegments() this frame; time: s
    update(self, opponent, segments, time) {
      if (time >= nextThink) {
        think(self, opponent, segments);
        nextThink = time + persona.reaction * (0.7 + random() * 0.6);
      }
      output.steer = wantedSteer;
      output.throttle = boost;
      output.brake = brake;
      return output;
    },
  };
}

// A small seeded random source (mulberry32).
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
