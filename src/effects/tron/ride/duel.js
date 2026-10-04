// The match: the player's cycle against CLU's, round after round, first to
// `winScore`. A round: a 3-2-1 countdown with both cycles at their start,
// then the race; hitting any jetwall or the boundary derezzes a cycle and
// the other side scores (both at once, or a head-on crash: nobody does, and
// the round is ridden again). The simulation runs in fixed steps, so it
// plays out the same at any frame rate.
//
// No graphics here: the caller reads the riders and the phase, and takes
// what happened from `events` each frame ({ type: 'tick' | 'go' | 'crash' |
// 'round' | 'result', ... }).
import { ARENA, BIKE, MATCH, STARTS } from './rules.js';
import { bikeDistance, castRay, createRider, ownTail, pace, wallSegments } from './rider.js';
import { createBrain, PERSONAS, seededRandom } from './brain.js';

const STEP = 1 / 120;

export function createDuel({ random, winScore = MATCH.winScore, playerTeam = 0 }) {
  const player = createRider(playerTeam);
  const clu = createRider(1 - playerTeam);
  const riders = [player, clu];
  // each brain has its own stream, so when one thinks doesn't change the other
  const cluBrain = createBrain(PERSONAS.clu, seededRandom(random() * 2 ** 32));
  const autopilot = createBrain(PERSONAS.autopilot, seededRandom(random() * 2 ** 32));
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
    cluBrain.reset();
    autopilot.reset();
    roundTime = 0;
    ticks = 0;
    accumulator = 0;
    setPhase('countdown');
    events.push({ type: 'round', round });
  }

  // did this rider's nose, moving from (x0, z0), run into anything?
  function crashed(rider, x0, z0) {
    const half = ARENA.half;
    if (Math.abs(rider.noseX) > half || Math.abs(rider.noseZ) > half) return true;
    const dx = rider.noseX - x0;
    const dz = rider.noseZ - z0;
    const length = Math.hypot(dx, dz);
    if (length < 1e-9) return false;
    return castRay(x0, z0, dx / length, dz / length, segments, length, ownTail(rider)) < length;
  }

  function derezz(rider) {
    rider.alive = false;
    rider.crashedAt = roundTime;
    events.push({ type: 'crash', rider, x: rider.noseX, z: rider.noseZ, heading: rider.heading, speed: rider.speed });
  }

  function raceStep(playerInput) {
    wallSegments(riders, segments);
    const cluInput = cluBrain.update(clu, player, segments, roundTime);
    const noses = riders.map((rider) => [rider.noseX, rider.noseZ]);
    const speedUp = pace(roundTime);
    player.step(STEP, playerInput, speedUp);
    clu.step(STEP, cluInput, speedUp);
    roundTime += STEP;
    wallSegments(riders, segments);
    const hits = riders.map((rider, index) => crashed(rider, ...noses[index]));
    if (bikeDistance(player, clu) < BIKE.collideRadius) hits[0] = hits[1] = true;
    if (!hits[0] && !hits[1]) return;
    riders.forEach((rider, index) => hits[index] && derezz(rider));
    if (hits[0] && hits[1]) lastLoser = 'both';
    else if (hits[0]) {
      lastLoser = 'player';
      score[1]++;
    } else {
      lastLoser = 'clu';
      score[0]++;
    }
    setPhase('crash');
  }

  // after a crash the survivor rolls on, slowing down, out of harm's way
  function coastStep() {
    for (const rider of riders) {
      if (!rider.alive) continue;
      rider.step(STEP, coast, 0.5);
      // stop short of the boundary
      const free = castRay(rider.noseX, rider.noseZ, rider.forwardX, rider.forwardZ, [], 20);
      if (free < 6) rider.speed *= 0.9;
    }
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
      if (score[0] >= winScore) return 'player';
      if (score[1] >= winScore) return 'clu';
      return null;
    },
    get segments() {
      return segments;
    },
    start() {
      score[0] = 0;
      score[1] = 0;
      round = 0;
      lastLoser = null;
      startRound();
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
      if (phase === 'crash' && phaseTime >= MATCH.crashHold) {
        if (this.winner) {
          setPhase('result');
          events.push({ type: 'result', winner: this.winner });
        } else {
          startRound();
        }
      } else if (phase === 'result' && phaseTime >= MATCH.resultHold) {
        setPhase('over');
      }
    },
  };
}
