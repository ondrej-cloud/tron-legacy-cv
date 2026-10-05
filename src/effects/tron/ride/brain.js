// CLU's riding. Like the cycles in the film it rides long straights and
// turns hard and decisively, and it always has a plan, one of:
//
//   hunt     ride alongside the player, a little faster, until it is ahead,
//            then cut across their path
//   box      shadow the player on the side where their open floor is, so
//            its wall closes that side off, and cut in when it can
//   escape   it is walled in itself: break out towards the most open floor,
//            over a kicker if one helps it clear a wall
//
// It switches between them with some randomness, and is forced into escape
// when its own room runs low. A plan is a heading to hold: every few tenths
// of a second it rides a handful of manoeuvres in its head (straight on, or
// a turn of 45, 90 or 135 degrees either way, then straight) and picks the
// one that lasts longest and serves the plan best. It doesn't orbit: turns
// of its own choosing need a straight before them, and a turn the same way
// as the ones it has just made costs more the further round it has already
// come.
//
// It is fair rather than perfect: it sees the player as they were a moment
// ago (its reaction time), misjudges distances a little, settles on
// headings a few degrees off, and only looks so far ahead. MATCH.difficulty
// tunes all of that. The same brain, more careful and less aggressive,
// rides the player's cycle in demo mode (demo.js turns its steering into
// scripted fists).
import { ARENA, BIKE, MATCH } from './rules.js';
import { castRay, ownTail, turnRate } from './rider.js';
import { features as terrainFeatures } from './terrain.js';

const DEGREES = Math.PI / 180;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

// the manoeuvres it considers: straight on, a turn either way, or a
// dog-leg (across and back again, to lay a wall across someone's path)
const MOVES = [
  ...[0, 45, -45, 90, -90, 135, -135].map((angle) => ({ turn: angle * DEGREES, hold: 0, back: false })),
  ...[90, -90].flatMap((angle) => [0.35, 0.9].map((hold) => ({ turn: angle * DEGREES, hold, back: true }))),
];
const SIM_STEP = 0.1;           // s per step of a manoeuvre ridden in its head
const FULL_LOCK_WITHIN = 0.3;   // rad from the wanted heading at which it eases off the bars
// turns that count towards going round in circles: tight ones over a few
// seconds, and laps of the arena over longer
const ORBITS = [{ window: 8, free: 200 * DEGREES, cost: 1.4 }, { window: 40, free: 300 * DEGREES, cost: 1.2 }];
const EDGE = 35;                // m from the boundary at which the floor starts to feel cramped
const PRESSURE = [8, 20];       // s into a round over which it grows impatient: more aggressive
const HISTORY = 48;             // the opponent's recent states, for the reaction delay
const KICKERS = terrainFeatures.filter((feature) => feature.type === 'kicker');

// How CLU rides at a difficulty from 0 (easy) to 1 (hard).
export function cluPersona(difficulty = MATCH.difficulty) {
  const d = clamp(difficulty, 0, 1);
  return {
    reaction: lerp(0.34, 0.13, d),       // s between looks at the world, and how old its picture of you is
    lookAhead: lerp(1.6, 2.6, d),        // s of each manoeuvre it rides in its head
    reach: lerp(70, 120, d),             // m it judges room over
    misjudge: lerp(0.22, 0.06, d),       // relative error in the distances it judges
    aim: lerp(6, 2, d) * DEGREES,        // error in the headings it settles on
    aggression: lerp(0.7, 1.4, d),       // how much it wants the cut-off over safety
    cutMargin: lerp(1.4, 0.8, d),        // s in front of you its cuts cross your path, at the least
    boost: lerp(0.7, 1, d),              // how hard it opens up down an open straight
    straight: [lerp(1.3, 0.8, d), lerp(2.6, 1.7, d)],   // s of straight before a turn of its own
    modes: { hunt: 1, box: lerp(0.5, 1, d) },
    jumps: d > 0.25,                     // whether it thinks of kickers at all
  };
}

export const PERSONAS = {
  clu: cluPersona(),
  // the demo's rider plays it safe, keeps its distance and waits for CLU's mistakes
  autopilot: {
    reaction: 0.12, lookAhead: 2.6, reach: 130, misjudge: 0.03, aim: 1 * DEGREES,
    aggression: 0.35, cutMargin: 1, boost: 0.6, straight: [1.4, 2.6], modes: { hunt: 1, box: 0.3 }, jumps: false,
  },
};

// The opponent's bike and where it will be in a moment, as walls: don't
// ride into it head-on, nor into the wall it is about to lay. It carries on
// turning the way it is turning (`opponent.turning`, rad/s).
const AHEAD_STEPS = 4;
function opponentAhead(opponent, seconds, out) {
  out.length = 0;
  if (!opponent) return out;
  let x = opponent.x;
  let z = opponent.z;
  let heading = opponent.heading;
  const step = seconds / AHEAD_STEPS;
  for (let index = 0; index < AHEAD_STEPS; index++) {
    const length = opponent.speed * step + (index === 0 ? BIKE.length : 0);
    const segment = out[index] ?? (out[index] = { rider: null, along: Infinity, ay: 0, by: 0 });
    segment.ax = x;
    segment.az = z;
    x += Math.cos(heading) * length;
    z += Math.sin(heading) * length;
    segment.bx = x;
    segment.bz = z;
    heading += (opponent.turning ?? 0) * step;
  }
  out.length = AHEAD_STEPS;
  return out;
}

// The walls that could matter within `radius` of (x, z).
function nearby(segments, x, z, radius, out) {
  out.length = 0;
  const limit = radius * radius;
  for (const segment of segments) {
    const ax = segment.ax - x;
    const az = segment.az - z;
    const bx = segment.bx - x;
    const bz = segment.bz - z;
    if (ax * ax + az * az < limit || bx * bx + bz * bz < limit) out.push(segment);
  }
  return out;
}

// Does a step from (ax, az) to (bx, bz) along `heading` ride off a
// kicker's lip, square enough to fly?
function offTheLip(kicker, ax, az, bx, bz, heading) {
  const { lip, cos, sin } = kicker;
  const before = (ax - lip.x) * cos + (az - lip.z) * sin;
  const after = (bx - lip.x) * cos + (bz - lip.z) * sin;
  if (before >= 0 || after < 0) return false;
  const across = -(bx - lip.x) * sin + (bz - lip.z) * cos;
  return Math.abs(across) < kicker.halfWidth * 0.8 && Math.cos(heading - kicker.heading) > 0.85;
}

const EMPTY = [];

// Rides a manoeuvre in its head: towards heading `move.first` at up to
// full lock, then straight on (or, a dog-leg: `move.hold` s on that
// heading, then round to `move.then`), for `horizon` s at about today's
// speed. Fills `out` with how long it lasts before hitting something, the
// points it passes (one per SIM_STEP), where it ends up, which way it faces
// then, and whether it flew off a kicker on the way. Off a kicker's lip it
// is high enough to clear a jetwall for a stretch (terrain.js, rider.js),
// so walls there don't count.
function rideInHead(self, move, horizon, obstacles, skip, kickers, out) {
  const speed = Math.max(self.speed, BIKE.cruise * 0.7);
  const rate = turnRate(speed);
  const length = speed * SIM_STEP;
  const settle = 1 - Math.exp(-SIM_STEP / BIKE.steerEase);
  // after the lip: from a few metres on, until it comes down again
  const flight = [3, speed * 0.6];
  let x = self.noseX;
  let z = self.noseZ;
  let heading = self.heading;
  let steer = self.steer;
  let sinceLip = Infinity;
  let target = move.first;
  let held = move.then === null ? -Infinity : 0;
  out.lasted = horizon;
  out.jumped = false;
  out.count = 0;
  for (let time = 0; time < horizon - 1e-6; time += SIM_STEP) {
    const error = wrap(target - heading);
    if (held >= 0 && Math.abs(error) < 0.05 && (held += SIM_STEP) >= move.hold) {
      target = move.then;
      held = -Infinity;
    }
    steer += (clamp(error / FULL_LOCK_WITHIN, -1, 1) - steer) * settle;
    heading += steer * rate * SIM_STEP;
    const dx = Math.cos(heading);
    const dz = Math.sin(heading);
    for (const kicker of kickers) {
      if (offTheLip(kicker, x, z, x + dx * length, z + dz * length, heading)) {
        sinceLip = 0;
        out.jumped = true;
      }
    }
    const flying = sinceLip > flight[0] && sinceLip < flight[1];
    const free = castRay(x, z, dx, dz, flying ? EMPTY : obstacles, length, skip);
    if (free < length) {
      out.lasted = time + SIM_STEP * (free / length);
      break;
    }
    x += dx * length;
    z += dz * length;
    sinceLip += length;
    const point = out.points[out.count] ?? (out.points[out.count] = { x: 0, z: 0 });
    point.x = x;
    point.z = z;
    out.count++;
  }
  // still in the air at the end: it needs to land clear of the walls too
  if (sinceLip < flight[1]) out.x = x + Math.cos(heading) * (flight[1] - sinceLip);
  else out.x = x;
  out.z = sinceLip < flight[1] ? z + Math.sin(heading) * (flight[1] - sinceLip) : z;
  out.heading = heading;
  return out;
}

// How good a cut-off the wall laid along a manoeuvre (`result`, ridden
// in its head from (x0, z0)) and on straight from its end would be: 0
// unless it crosses the opponent's path in front of them, firmly, before
// they get there and at least `margin` s ahead of them (so they have a
// fair chance to react); more the closer in front of them.
function cutOff(x0, z0, result, speed, opponent, margin) {
  const ox = opponent.forwardX;
  const oz = opponent.forwardZ;
  const theirSpeed = Math.max(5, opponent.speed);
  let ax = x0;
  let az = z0;
  for (let index = 0; index <= result.count; index++) {
    let bx;
    let bz;
    let time = index * SIM_STEP;
    if (index < result.count) {
      bx = result.points[index].x;
      bz = result.points[index].z;
    } else {
      // on from the end, as far as it could get in a second or so
      bx = ax + Math.cos(result.heading) * speed * 1.2;
      bz = az + Math.sin(result.heading) * speed * 1.2;
    }
    const ex = bx - ax;
    const ez = bz - az;
    const length = Math.hypot(ex, ez);
    const across = (ex * oz - ez * ox) / Math.max(1e-9, length);
    if (Math.abs(across) > 0.5) {
      // where their path (nose + s * forward) meets this stretch (a + u * e)
      const wx = ax - opponent.noseX;
      const wz = az - opponent.noseZ;
      const denominator = ox * ez - oz * ex;
      const theirs = (wx * ez - wz * ex) / denominator;
      const u = (wx * oz - wz * ox) / denominator;
      if (u >= 0 && u <= 1 && theirs > 2 && theirs < 80) {
        time += u * (index < result.count ? SIM_STEP : 1.2);
        const lead = theirs / theirSpeed - time;
        // the first crossing is the one that counts: they'd be through first,
        // or right on top of it, or they're cut off
        if (lead < 0.25 || theirs < theirSpeed * margin) return 0;
        return Math.exp(-theirs / 35) * Math.min(1, lead / 0.6);
      }
    }
    ax = bx;
    az = bz;
  }
  return 0;
}

// How well (x, z, heading) shadows the opponent: `ahead` m in front of
// them and `side` m to their right (negative: left), riding the same way.
function shadow(x, z, heading, opponent, ahead, side) {
  const rx = x - opponent.x;
  const rz = z - opponent.z;
  const along = rx * opponent.forwardX + rz * opponent.forwardZ;
  const across = -rx * opponent.forwardZ + rz * opponent.forwardX;   // their right is (-sin, cos)
  const align = Math.cos(wrap(heading - opponent.heading));
  const miss = ((along - ahead) / 45) ** 2 + ((across - side) / 25) ** 2;
  return 0.5 * Math.max(0, align) + Math.exp(-miss);
}

// Free distance from (x, z) along heading + each of `angles`, averaged
// and divided by `reach` (0 walled in .. 1 open).
function openness(x, z, heading, angles, obstacles, reach, skip) {
  let sum = 0;
  for (const angle of angles) {
    sum += castRay(x, z, Math.cos(heading + angle), Math.sin(heading + angle), obstacles, reach, skip);
  }
  return sum / (angles.length * reach);
}

const AROUND = [0, 45, 90, 135, 180, -135, -90, -45].map((angle) => angle * DEGREES);
const FAN = [0, 0, 40, -40, 80, -80].map((angle) => angle * DEGREES);   // straight on counts twice
const WIDE = [0, 25, -25, 55, -55].map((angle) => angle * DEGREES);

// random: a () => 0..1 source (seeded, so a demo plays out the same way)
export function createBrain(persona, random) {
  const output = { steer: 0, throttle: 0.5, brake: false, idle: false };
  const history = [];          // the opponent as it was: { time, x, z, heading, speed }
  const seen = makeView();     // ... as it registers, `reaction` s late
  const future = makeView();   // ... and where it will be at the end of a manoeuvre
  const local = [];
  const virtual = [];
  const kickers = [];
  const trial = { lasted: 0, x: 0, z: 0, heading: 0, jumped: false, count: 0, points: [] };
  const move = { first: 0, then: null, hold: 0 };
  const now = makeView();      // the opponent now, as far as it can guess
  const turns = [];            // { time, angle } of the turns it has decided on
  const counts = { hunt: 0, box: 0, escape: 0, left: 0, right: 0, jumps: 0 };
  let mode = 'hunt';
  let modeUntil = 0;
  let plan = 0;                // the heading it holds, or is turning to
  let queued = null;           // a dog-leg's way back: { heading, hold }
  let turning = false;
  let straightSince = 0;       // when it last came out of a turn
  let straightNeed = 1;        // s of straight it wants before turning of its own accord
  let side = 1;                // hunting: which side of the player it rides (1 their right)
  let cruise = 0.5;            // its throttle on an ordinary straight, varied a little
  let throttle = 0.5;
  let brake = false;
  let nextThink = 0;
  let nextReflex = 0;
  let speed = BIKE.cruise;
  let skip = null;
  let aggression = persona.aggression;
  let roundStart = 0;

  function remember(opponent, time) {
    if (!opponent?.alive || !opponent.riding) {
      history.length = 0;
      return;
    }
    const last = history[history.length - 1];
    if (last && time - last.time < 1 / 30) return;
    const entry = history.length >= HISTORY ? history.shift() : {};
    entry.time = time;
    entry.x = opponent.x;
    entry.z = opponent.z;
    entry.heading = opponent.heading;
    entry.speed = opponent.speed;
    history.push(entry);
  }

  // the opponent as it registers now: the newest state at least a reaction
  // old, and how fast it was turning then
  function perceive(time) {
    let found = -1;
    for (let index = history.length - 1; index >= 0; index--) {
      if (history[index].time <= time - persona.reaction) {
        found = index;
        break;
      }
    }
    if (found < 0) found = 0;
    const entry = history[found];
    if (!entry) return null;
    setView(seen, entry.x, entry.z, entry.heading, entry.speed);
    const before = history[Math.max(0, found - 3)];
    seen.turning = entry.time > before.time ? wrap(entry.heading - before.heading) / (entry.time - before.time) : 0;
    return seen;
  }

  function setMode(name, time, length) {
    if (name !== mode) counts[name]++;
    mode = name;
    modeUntil = time + length;
  }

  function chooseMode(self, room, time) {
    if (room < 0.3 && mode !== 'escape') {
      setMode('escape', time, 1.5 + random() * 1.5);
      return;
    }
    if (time < modeUntil) return;
    if (mode === 'escape' && room < 0.42) {
      modeUntil = time + 0.5;
      return;
    }
    const weights = { hunt: persona.modes.hunt, box: persona.modes.box };
    if (Math.hypot(seen.x - self.x, seen.z - self.z) > 110) weights.box *= 0.3;   // too far away to shadow
    if (mode in weights) weights[mode] *= 0.5;                                    // something new, more often than not
    const pick = random() * (weights.hunt + weights.box) < weights.hunt ? 'hunt' : 'box';
    if (pick === 'hunt') {
      // the side of the player it is on already, mostly
      const across = -(self.x - seen.x) * seen.forwardZ + (self.z - seen.z) * seen.forwardX;
      side = random() < 0.8 ? Math.sign(across) || 1 : -Math.sign(across) || 1;
    }
    setMode(pick, time, 2.5 + random() * 3.5);
  }

  // how many radians it has turned through in the last `window` s (signed,
  // right positive)
  function recentTurning(time, window) {
    while (turns.length && time - turns[0].time > ORBITS[ORBITS.length - 1].window) turns.shift();
    let sum = 0;
    for (const turn of turns) if (time - turn.time <= window) sum += turn.angle;
    return sum;
  }

  // what turning `angle` more would cost, given the turns it has made lately
  function circling(angle, time) {
    let cost = 0;
    for (const orbit of ORBITS) {
      const net = recentTurning(time, orbit.window);
      if (Math.sign(angle) !== Math.sign(net)) continue;
      cost += orbit.cost * clamp((Math.abs(net) + Math.abs(angle) - orbit.free) / Math.PI, 0, 1.5);
    }
    return cost;
  }

  // what a manoeuvre ending in `trial` does for the plan it is on
  function goal(self, result, openSide, isAhead) {
    if (mode === 'escape') {
      const far = openness(result.x, result.z, result.heading, WIDE, local, persona.reach * 1.6, skip);
      return 2 * far + (result.jumped ? 0.8 : 0);
    }
    if (!seen.valid) return 0;
    const distance = Math.hypot(future.x - result.x, future.z - result.z);
    if (distance > 100) {
      // far apart: close in on where they are going first
      const toward = Math.atan2(future.z - result.z, future.x - result.x);
      return 1.2 * Math.cos(wrap(result.heading - toward));
    }
    const cut = cutOff(self.noseX, self.noseZ, result, speed, now, persona.cutMargin);
    if (mode === 'hunt') {
      const alongside = shadow(result.x, result.z, result.heading, future, isAhead ? 30 : 22, side * 16);
      return aggression * Math.max(alongside, 1.8 * cut);
    }
    const alongside = shadow(result.x, result.z, result.heading, future, 6, openSide * 11);
    return aggression * Math.max(alongside, 1.2 * cut);
  }

  function think(self, opponent, segments, time) {
    const horizon = persona.lookAhead;
    speed = Math.max(self.speed, BIKE.cruise * 0.7);
    // a long round makes it impatient
    aggression = persona.aggression * (1 + 0.6 * clamp((time - roundStart - PRESSURE[0]) / (PRESSURE[1] - PRESSURE[0]), 0, 1));
    skip = ownTail(self);
    const view = perceive(time);
    seen.valid = Boolean(view);
    nearby(segments, self.x, self.z, speed * horizon + persona.reach + 10, local);
    if (view) {
      for (const segment of opponentAhead(view, 0.8, virtual)) local.push(segment);
      setView(future, view.x + view.forwardX * view.speed * horizon, view.z + view.forwardZ * view.speed * horizon,
        view.heading, view.speed);
      const late = persona.reaction;
      setView(now, view.x + view.forwardX * view.speed * late, view.z + view.forwardZ * view.speed * late,
        view.heading, view.speed);
    }
    kickers.length = 0;
    if (persona.jumps) {
      const reach = speed * horizon + 20;
      for (const kicker of KICKERS) if (Math.hypot(kicker.lip.x - self.x, kicker.lip.z - self.z) < reach) kickers.push(kicker);
    }
    const misjudged = () => 1 + (random() - 0.5) * 2 * persona.misjudge;
    const room = openness(self.noseX, self.noseZ, self.heading, AROUND, local, persona.reach, skip) * misjudged();
    if (view) chooseMode(self, room, time);
    else if (mode !== 'escape') setMode('escape', time, 1);

    // the player's open side (box), and whether it is ahead of them (hunt)
    let openSide = 1;
    let isAhead = false;
    if (view) {
      const right = castRay(view.noseX, view.noseZ, -view.forwardZ, view.forwardX, local, persona.reach);
      const left = castRay(view.noseX, view.noseZ, view.forwardZ, -view.forwardX, local, persona.reach);
      openSide = right >= left ? 1 : -1;
      isAhead = (self.x - view.x) * view.forwardX + (self.z - view.z) * view.forwardZ > 8;
    }

    // keep on with the plan, or one of the manoeuvres
    const sinceTurn = turning ? 0 : time - straightSince;
    let forced = false;
    let bestScore = -Infinity;
    let bestIndex = -1;
    let bestLasted = horizon;
    let bestJumped = false;
    for (let index = -1; index < MOVES.length; index++) {
      const option = MOVES[index];
      if (index < 0) {
        move.first = plan;
        move.then = queued?.heading ?? null;
        move.hold = queued?.hold ?? 0;
      } else {
        move.first = self.heading + option.turn;
        move.then = option.back ? self.heading : null;
        move.hold = option.hold;
        // that's the plan it is on already
        if (!option.back && !queued && Math.abs(wrap(move.first - plan)) < 8 * DEGREES) continue;
      }
      rideInHead(self, move, horizon, local, skip, kickers, trial);
      let score = 6 * trial.lasted / horizon;
      if (trial.lasted >= horizon - 1e-6) {
        score += 1.2 * openness(trial.x, trial.z, trial.heading, FAN, local, persona.reach, skip) * misjudged();
        score += goal(self, trial, openSide, isAhead);
        if (trial.jumped) score += 0.15;   // it likes the air
        // the open floor, not laps along the boundary
        const edge = ARENA.half - Math.max(Math.abs(trial.x), Math.abs(trial.z));
        if (edge < EDGE) score -= 1.2 * (1 - edge / EDGE);
      }
      if (index < 0) {
        forced = trial.lasted < horizon * 0.9;
        score += 0.2;                       // a plan is worth holding on to
      } else if (Math.abs(option.turn) > 0.2) {
        score -= (option.back ? 0.2 : 0.12) * Math.abs(option.turn) / (Math.PI / 2);
        // turns of its own choosing come after a proper straight
        if (!forced && sinceTurn < straightNeed) score -= 1.5;
        // round and round the same way: costlier the further round it has come
        score -= circling(option.turn, time) * (option.back ? 0.5 : 1);
      }
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
        bestLasted = trial.lasted;
        bestJumped = trial.jumped;
      }
    }

    if (bestIndex >= 0) {
      const option = MOVES[bestIndex];
      // it settles on the heading a few degrees off
      plan = self.heading + option.turn + (random() - 0.5) * 2 * persona.aim;
      queued = option.back ? { heading: self.heading, hold: option.hold } : null;
      if (Math.abs(option.turn) > 0.2) {
        turning = true;
        turns.push({ time, angle: option.turn });
        counts[option.turn > 0 ? 'right' : 'left']++;
        if (bestJumped) counts.jumps++;
        straightNeed = persona.straight[0] + random() * (persona.straight[1] - persona.straight[0]);
        cruise = 0.45 + random() * 0.2;
      }
    }

    // no way out at this speed: slow down to turn tighter
    const ahead = castRay(self.noseX, self.noseZ, self.forwardX, self.forwardZ, local, persona.reach, skip);
    const swing = Math.abs(wrap(plan - self.heading));
    // ... and into a sharp turn, so it turns hard, like the film's cycles
    brake = bestLasted < horizon * 0.75 || (swing > 1.2 && ahead < speed * 1.1) || (turning && swing > 1.4);
    const open = ahead > Math.min(persona.reach, speed * 2.2) && swing < 0.2;
    if (brake) throttle = 0;
    else if (open && mode === 'hunt' && seen.valid && !isAhead) throttle = 0.5 + 0.5 * persona.boost;
    else if (open && mode === 'escape') throttle = 0.5 + 0.35 * persona.boost;
    else if (open && mode === 'box' && seen.valid) throttle = isAhead ? 0.45 : 0.5 + 0.3 * persona.boost;
    else throttle = cruise;
  }

  // a wall coming up fast: think again now rather than at the next look
  function reflex(self, time) {
    if (time < nextReflex || !skip) return false;
    nextReflex = time + 1 / 30;
    const free = castRay(self.noseX, self.noseZ, self.forwardX, self.forwardZ, local, speed, skip);
    return free < self.speed * 0.5;
  }

  return {
    persona,
    counts,
    get mode() {
      return mode;
    },
    get plan() {
      return plan;
    },
    reset(self = null, time = 0) {
      nextThink = 0;
      nextReflex = 0;
      roundStart = time;
      history.length = 0;
      turns.length = 0;
      turning = false;
      queued = null;
      straightSince = time;
      straightNeed = persona.straight[0];
      plan = self ? self.heading : 0;
      skip = null;
      mode = random() < 0.5 ? 'hunt' : 'box';
      modeUntil = time + 1.5 + random() * 2;
      side = random() < 0.5 ? 1 : -1;
      output.steer = 0;
    },
    // self, opponent: riders; segments: wallSegments() this frame; time: s
    update(self, opponent, segments, time) {
      remember(opponent, time);
      if (time >= nextThink || reflex(self, time)) {
        think(self, opponent, segments, time);
        nextThink = time + persona.reaction * (0.7 + random() * 0.6);
      }
      let error = wrap(plan - self.heading);
      if (turning && Math.abs(error) < 0.05) {
        turning = false;
        straightSince = time;
      }
      // a dog-leg: back round once it has held the first leg long enough
      if (queued && !turning && time - straightSince >= queued.hold) {
        turns.push({ time, angle: wrap(queued.heading - plan) });
        plan = queued.heading;
        queued = null;
        turning = true;
        error = wrap(plan - self.heading);
      }
      output.steer = clamp(error / FULL_LOCK_WITHIN, -1, 1);
      output.throttle = throttle;
      output.brake = brake;
      return output;
    },
  };
}

function makeView() {
  return { valid: false, x: 0, z: 0, heading: 0, speed: 0, forwardX: 1, forwardZ: 0, noseX: 0, noseZ: 0, turning: 0 };
}

function setView(view, x, z, heading, speed) {
  view.valid = true;
  view.x = x;
  view.z = z;
  view.heading = heading;
  view.speed = speed;
  view.forwardX = Math.cos(heading);
  view.forwardZ = Math.sin(heading);
  view.noseX = x + view.forwardX * BIKE.length;
  view.noseZ = z + view.forwardZ * BIKE.length;
  return view;
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
