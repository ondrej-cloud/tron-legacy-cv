// The match: the player's cycle against CLU's, round after round, first to
// `winScore`. A round: a 3-2-1 countdown with both cycles at their start,
// then the race; hitting any jetwall or the boundary derezzes a cycle and
// the other side scores (both at once, or a head-on crash: nobody does, and
// the round is ridden again). The simulation runs in fixed steps, so it
// plays out the same at any frame rate.
//
// After the deciding derezz the duel stays on its result until the caller
// asks for a rematch() (at a new difficulty, if it likes) or is done with
// it (finish()). Before the first countdown it can also hold() the riders
// at their starts (phase 'ready', the grip tutorial) until go().
//
// No graphics here: the caller reads the riders and the phase, and takes
// what happened from `events` each frame ({ type: 'tick' | 'go' | 'crash' |
// 'round' | 'result' | 'mode' | 'jump', ... }). It also keeps the match's
// numbers (stats) and records the last seconds of each round for a replay
// of the crash (replay.js).
import { ARENA, BIKE, MATCH, STARTS } from './rules.js';
import { bikeDistance, castRay, createRider, crossesWall, ownTail, pace, wallSegments } from './rider.js';
import { createBrain, cluPersona, PERSONAS, seededRandom } from './brain.js';
import { createRecorder } from './replay.js';

const STEP = 1 / 120;
// closest call: sampled this often, within reach, counted once survived for
// `settle` s; its own wall within `ownWall` m behind it doesn't count
const CLOSE = { every: 1 / 30, reach: 8, settle: 0.5, ownWall: 16 };
const JUMP_AIR = 0.3;      // s in the air that makes it a jump
const SPIN_WINDOW = 6;     // s over which the most turning in one direction is measured
// a survivor rolling to a stop: how far ahead it looks for something to
// stop short of, how hard it brakes (m/s²) and the gap it leaves
const COAST = { look: 14, brake: 14, gap: 1.5 };

export function createDuel({ random, winScore = MATCH.winScore, playerTeam = 0, difficulty = MATCH.difficulty }) {
  const player = createRider(playerTeam);
  const clu = createRider(1 - playerTeam);
  const riders = [player, clu];
  // each brain has its own stream, so when one thinks doesn't change the other
  let cluBrain = createBrain(cluPersona(difficulty), seededRandom(random() * 2 ** 32));
  const autopilot = createBrain(PERSONAS.autopilot, seededRandom(random() * 2 ** 32));
  const recorder = createRecorder();
  const stats = createStats();
  let crash = null;          // the last derezz: { time, loser, final, x, z }
  let cluMode = null;
  let nextClose = 0;
  const near = [];           // the player's recent closest distances, not yet survived
  const air = [0, 0];        // s each rider has been in the air on this flight
  const spin = [null, null]; // each rider's turning history, for stats.spin
  const segments = [];
  const events = [];
  const score = [0, 0];      // player, CLU
  let phase = 'idle';
  let phaseTime = 0;
  let roundTime = 0;
  let round = 0;
  let accumulator = 0;
  let ticks = 0;
  let lastLoser = null;      // 'player' | 'clu' | 'both'
  const coast = { steer: 0, throttle: 0.2, brake: false, idle: true };

  function setPhase(name) {
    phase = name;
    phaseTime = 0;
  }

  function startRound() {
    round++;
    player.place(STARTS[0]);
    clu.place(STARTS[1]);
    cluBrain.reset(clu);
    autopilot.reset(player);
    recorder.clear();
    cluMode = null;
    near.length = 0;
    air[0] = air[1] = 0;
    spin[0] = spinTracker(player);
    spin[1] = spinTracker(clu);
    roundTime = 0;
    ticks = 0;
    accumulator = 0;
    setPhase('countdown');
    events.push({ type: 'round', round });
  }

  // did this rider's nose, moving from (x0, z0), run into anything? The
  // boundary at any height; a jetwall only below its top (it can be jumped)
  function crashed(rider, x0, z0) {
    const half = ARENA.half;
    if (Math.abs(rider.noseX) > half || Math.abs(rider.noseZ) > half) return true;
    if (Math.hypot(rider.noseX - x0, rider.noseZ - z0) < 1e-9) return false;
    return crossesWall(x0, z0, rider.previousNoseY, rider.noseX, rider.noseZ, rider.noseY, segments, ownTail(rider));
  }

  function derezz(rider) {
    rider.alive = false;
    rider.crashedAt = roundTime;
    events.push({ type: 'crash', rider, x: rider.noseX, z: rider.noseZ, heading: rider.heading, speed: rider.speed });
  }

  // The match's numbers, after each step of a race: the top speed, jumps,
  // and the closest the player came to a wall or CLU and lived.
  function measure() {
    stats.time += STEP;
    stats.topSpeed = Math.max(stats.topSpeed, player.speed);
    riders.forEach((rider, index) => {
      spin[index].step(roundTime);
      if (rider.airborne) {
        air[index] += STEP;
        if (air[index] >= JUMP_AIR && air[index] - STEP < JUMP_AIR) {
          if (index === 0) stats.jumps++;
          else stats.cluJumps++;
          events.push({ type: 'jump', rider });
        }
      } else air[index] = 0;
    });
    if (roundTime < nextClose) return;
    nextClose = roundTime + CLOSE.every;
    // flying over a wall doesn't count as brushing past it
    const distance = player.airborne ? Infinity : clearance(player, clu, segments, CLOSE.reach);
    if (distance < CLOSE.reach) near.push({ time: roundTime, distance });
    while (near.length && roundTime - near[0].time > CLOSE.settle) {
      stats.closest = Math.min(stats.closest, near.shift().distance);
    }
  }

  function raceStep(playerInput) {
    wallSegments(riders, segments);
    const cluInput = cluBrain.update(clu, player, segments, roundTime);
    if (cluBrain.mode !== cluMode) {
      cluMode = cluBrain.mode;
      events.push({ type: 'mode', mode: cluMode, time: roundTime });
    }
    const noses = riders.map((rider) => [rider.noseX, rider.noseZ]);
    const speedUp = pace(roundTime);
    player.step(STEP, playerInput, speedUp);
    clu.step(STEP, cluInput, speedUp);
    roundTime += STEP;
    wallSegments(riders, segments);
    recorder.capture(roundTime, riders);
    const hits = riders.map((rider, index) => crashed(rider, ...noses[index]));
    if (bikeDistance(player, clu) < BIKE.collideRadius) hits[0] = hits[1] = true;
    if (!hits[0] && !hits[1]) {
      measure();
      return;
    }
    riders.forEach((rider, index) => hits[index] && derezz(rider));
    if (hits[0] && hits[1]) lastLoser = 'both';
    else if (hits[0]) {
      lastLoser = 'player';
      score[1]++;
    } else {
      lastLoser = 'clu';
      score[0]++;
    }
    // the player's last brushes with the wall don't count if it got them
    if (hits[0]) near.length = 0;
    for (const sample of near) stats.closest = Math.min(stats.closest, sample.distance);
    near.length = 0;
    stats.rounds.push({ loser: lastLoser, time: roundTime });
    riders.forEach((rider, index) => {
      stats.spin[index] = Math.max(stats.spin[index], spin[index].most);
      stats.turns[index] = spin[index].turns;
    });
    const down = riders.find((rider, index) => hits[index]);
    crash = { time: roundTime, loser: lastLoser, final: Boolean(winnerOf(score, winScore)),
      x: down.noseX, z: down.noseZ, rider: down };
    setPhase('crash');
  }

  // After a crash the survivor rolls on, slowing down; it comes to a stop
  // short of the boundary or a jetwall, and on the result. (Riding, a
  // cycle never drops below a crawl, rider.js: the stop is done here.)
  function coastStep() {
    wallSegments(riders, segments);
    for (const rider of riders) {
      if (!rider.alive) continue;
      const free = castRay(rider.noseX, rider.noseZ, rider.forwardX, rider.forwardZ, segments, COAST.look, ownTail(rider));
      if (phase !== 'result' && free > COAST.look - 1) {
        rider.step(STEP, coast, 0.5);
        continue;
      }
      rider.speed = Math.max(0, rider.speed - COAST.brake * STEP);
      const move = Math.min(rider.speed * STEP, Math.max(0, free - COAST.gap));
      rider.x += rider.forwardX * move;
      rider.z += rider.forwardZ * move;
      rider.along += move;
      rider.spin += move / (0.33 * BIKE.length);
      rider.lean *= 1 - STEP / 0.3;
      rider.steer *= 1 - STEP / 0.3;
    }
    roundTime += STEP;
    recorder.capture(roundTime, riders);
  }

  return {
    riders,
    player,
    clu,
    events,
    score,
    get phase() {
      return phase;
    },
    get phaseTime() {
      return phaseTime;
    },
    get roundTime() {
      return roundTime;
    },
    get round() {
      return round;
    },
    get lastLoser() {
      return lastLoser;
    },
    get winScore() {
      return winScore;
    },
    // 3, 2, 1 during the countdown, 0 for GO, null otherwise
    get count() {
      if (phase !== 'countdown') return null;
      const step = MATCH.countdown / 4;
      return Math.max(0, 3 - Math.floor(phaseTime / step));
    },
    get winner() {
      return winnerOf(score, winScore);
    },
    get segments() {
      return segments;
    },
    // the match so far: { time, topSpeed, jumps, closest, rounds, spin, turns, ... }
    stats,
    // the last derezz: { time (round time), loser, final, x, z, rider }
    get crash() {
      return crash;
    },
    // the last seconds of the round, frame by frame (replay.js)
    recorder,
    get cluMode() {
      return cluBrain.mode;
    },
    // CLU's sharpness, 0..1 (cluPersona)
    get difficulty() {
      return difficulty;
    },
    get brains() {
      return { clu: cluBrain, autopilot };
    },
    start() {
      score[0] = 0;
      score[1] = 0;
      round = 0;
      lastLoser = null;
      crash = null;
      Object.assign(stats, createStats());
      startRound();
    },
    // the same again from 0 : 0, CLU riding at `level` (0..1) from now on
    rematch(level = difficulty) {
      if (level !== difficulty) {
        difficulty = level;
        cluBrain = createBrain(cluPersona(difficulty), seededRandom(random() * 2 ** 32));
      }
      this.start();
    },
    // waits at the start before the countdown, until go()
    hold() {
      if (phase === 'countdown' && phaseTime === 0) setPhase('ready');
    },
    go() {
      if (phase === 'ready') setPhase('countdown');
    },
    // done with the result
    finish() {
      setPhase('over');
    },
    stop() {
      setPhase('idle');
    },
    // What the demo's scripted hands should do: the autopilot's steering
    // for the player's cycle right now.
    autopilot() {
      return autopilot.update(player, clu, segments, roundTime);
    },
    // dt: frame time; playerInput: { steer, throttle, brake, idle }
    update(dt, playerInput) {
      phaseTime += dt;
      if (phase === 'countdown') {
        const step = MATCH.countdown / 4;
        while (ticks < 4 && phaseTime >= ticks * step) {
          events.push({ type: 'tick', count: 3 - ticks });
          ticks++;
        }
        if (phaseTime >= MATCH.countdown - step) {
          player.launch();
          clu.launch();
          setPhase('race');
          events.push({ type: 'go' });
        }
        return;
      }
      if (phase === 'race' || phase === 'crash') {
        accumulator += dt;
        while (accumulator >= STEP) {
          accumulator -= STEP;
          if (phase === 'race') raceStep(playerInput);
          else coastStep();
        }
      }
      if (phase === 'result') {
        // the survivor rolls to a stop
        accumulator += dt;
        while (accumulator >= STEP) {
          accumulator -= STEP;
          coastStep();
        }
      }
      if (phase === 'crash' && phaseTime >= (crash?.final ? MATCH.finalHold : MATCH.crashHold)) {
        if (this.winner) {
          setPhase('result');
          events.push({ type: 'result', winner: this.winner });
        } else {
          startRound();
        }
      }
    },
  };
}

function winnerOf(score, winScore) {
  if (score[0] >= winScore) return 'player';
  if (score[1] >= winScore) return 'clu';
  return null;
}

function createStats() {
  return {
    time: 0,                // s raced, all rounds
    topSpeed: 0,            // the player's, units/s
    jumps: 0,               // the player's jumps (CLU's: cluJumps)
    cluJumps: 0,
    closest: Infinity,      // m, the nearest the player came to a wall or CLU and survived
    rounds: [],             // { loser, time } per round
    spin: [0, 0],           // the most each rider turned one way within SPIN_WINDOW s (radians)
    turns: [{ left: 0, right: 0 }, { left: 0, right: 0 }],   // this round's turns (sharper than 45°)
  };
}

// How far round a rider has turned: its heading unwrapped, sampled, and
// the largest net turn within any SPIN_WINDOW s (a rider riding circles
// gets far past a full turn), plus its turns either way.
function spinTracker(rider) {
  const samples = [];
  let total = 0;
  let last = rider.heading;
  let turnStart = 0;      // the unwrapped heading when the current turn began
  let turning = 0;        // its direction, 0 riding straight
  const turns = { left: 0, right: 0 };
  let most = 0;
  let nextSample = 0;
  return {
    step(time) {
      total += Math.atan2(Math.sin(rider.heading - last), Math.cos(rider.heading - last));
      last = rider.heading;
      if (time < nextSample) return;
      nextSample = time + 0.1;
      samples.push({ time, total });
      while (samples.length && time - samples[0].time > SPIN_WINDOW) samples.shift();
      for (const sample of samples) most = Math.max(most, Math.abs(total - sample.total));
      // a turn: the heading keeps moving one way; it ends when it stops
      const rate = samples.length > 1 ? total - samples[samples.length - 2].total : 0;
      const direction = Math.abs(rate) > 0.02 ? Math.sign(rate) : 0;
      if (direction !== turning) {
        if (turning && Math.abs(total - turnStart) > Math.PI / 4) turns[turning > 0 ? 'right' : 'left']++;
        turning = direction;
        turnStart = total;
      }
    },
    get most() {
      return most;
    },
    get turns() {
      return { ...turns };
    },
  };
}

// The nearest the player's bike (nose and middle) is to any jetwall but
// the stretch it has just laid behind it, or to CLU's bike, looking
// `reach` m around.
function clearance(player, clu, segments, reach) {
  const recent = player.along - CLOSE.ownWall;
  const skip = (segment) => segment.rider === player && segment.along > recent;
  const middleX = player.x + player.forwardX * BIKE.length * 0.5;
  const middleZ = player.z + player.forwardZ * BIKE.length * 0.5;
  let nearest = clu.alive ? bikeDistance(player, clu) : reach;
  for (const segment of segments) {
    if (Math.abs(segment.ax - middleX) > reach || Math.abs(segment.az - middleZ) > reach || skip(segment)) continue;
    nearest = Math.min(nearest,
      pointToSegment(player.noseX, player.noseZ, segment), pointToSegment(middleX, middleZ, segment));
  }
  return Math.min(nearest, reach);
}

function pointToSegment(x, z, segment) {
  const ex = segment.bx - segment.ax;
  const ez = segment.bz - segment.az;
  const t = Math.min(1, Math.max(0, ((x - segment.ax) * ex + (z - segment.az) * ez) / Math.max(1e-9, ex * ex + ez * ez)));
  return Math.hypot(x - segment.ax - ex * t, z - segment.az - ez * t);
}
