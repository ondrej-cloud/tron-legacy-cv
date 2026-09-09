// Gestures -> actions. Reads the debounced gestures and finger analysis from
// hands.js and drives the walls, the discs, the light cycles, derezz and the
// portal. Each hand has its own team colour.
//
//   point                     draw a light wall from the index fingertip
//   rock (index + pinky)      switch this hand's team (TRON cyan <-> CLU orange)
//   ok                        summon an identity disc at that palm
//   flick, or open the ok     throw it; it comes back to an open hand
//   thumbs up                 launch a light cycle onto the Grid floor
//   peace                     the digitizing laser: the person turns into TRON lines
//   fist                      derezz wave from the fist: walls, cycles and your own disc
//   both palms open, facing   portal between the hands (not while you have a disc out)
//
// Real tracking jitters, so every action needs its pose to hold for a moment
// on top of the tracker's own debounce, and drawing survives short dropouts.
import { OneEuroFilter, PointFilter, VelocityWindow, clamp, easeTowards } from './filters.js';
import { WALL } from './walls.js';

export const CONTROLS = {
  pointHoldMs: 60,        // pointing must hold this long before it draws
  pointGraceMs: 220,      // a wall being drawn survives a gesture dropout this long
  tipJump: 0.15,          // view units; a fingertip jump this big is held off as a likely glitch
  okHoldMs: 150,
  throwWindow: 0.1,       // s, hand speed is measured over this much of the palm's path
  throwSpeed: 0.7,        // view units/s: a held disc is thrown at this palm speed ...
  throwSamples: 2,        // ... over this many tracker frames in a row, in one direction ...
  throwDeadZone: 0.04,    // ... once the palm has moved this far (view units) in the window
  throwArmTime: 0.4,      // s a disc must be in hand before a flick throws it
  releaseHoldMs: 80,      // opening an ok hand this long lets the disc go ...
  releaseSpeed: 0.25,     // ... along the hand's motion if it moves this fast (view units/s),
  releaseMemory: 1.0,     // ... else the way it moved within this many s, else to the centre
  lostThrowWindow: 0.4,   // s: a hand lost this soon after moving fast threw its disc
  fistHoldMs: 80,
  derezzSpeed: 1.25,      // view units/s, the derezz wave front
  derezzReach: 2.3,
  rockHoldMs: 150,
  rockCooldownMs: 600,
  thumbsUpHoldMs: 150,
  thumbsUpCooldownMs: 1200,
  peaceHoldMs: 200,
  peaceCooldownMs: 6000,  // from one digitize to the next (one lasts 5 s)
  portalHoldMs: 150,
  portalReleaseMs: 250,
  portalRise: 0.4,        // s
  portalFall: 0.3,
  portalWidth: 0.8,       // portal width relative to the distance between the palms
};

const PALM_POINTS = [0, 5, 9, 13, 17];

// `log(name)` records an action for the stats.
export function createControls({ hands, view, teams, walls, discs, cycles, digitizer, voxels, flashes, stage, log }) {
  const states = { left: createHandState('left'), right: createHandState('right') };
  const discHands = { left: discHand(), right: discHand() };
  const waves = [];
  const portal = {
    on: false, strength: 0, x: 0, halfWidth: 0.2, handsY: 0, age: 0,
    readySinceMs: 0, lastReadyMs: -Infinity, opened: 0,
  };
  const tethers = [{ x: 0, y: 0, strength: 0 }, { x: 0, y: 0, strength: 0 }];
  const counts = { derezz: 0, teamSwitches: 0 };
  const initial = (id) => id[0].toUpperCase();
  let time = 0;

  function toView(point, out) {
    out.x = (point.x - 0.5) * view.aspect;
    out.y = 0.5 - point.y;
    return out;
  }

  function track(state, hand, dt) {
    const landmarks = hand.landmarks;
    let palmX = 0;
    let palmY = 0;
    for (const index of PALM_POINTS) {
      palmX += landmarks[index].x;
      palmY += landmarks[index].y;
    }
    const palm = toView({ x: palmX / PALM_POINTS.length, y: palmY / PALM_POINTS.length }, {});
    const tip = toView(landmarks[8], {});
    // the camera delivers new landmarks less often than we render
    const fresh = landmarks !== state.landmarks;
    state.landmarks = landmarks;
    if (!state.visible) {
      state.palmX.reset(palm.x);
      state.palmY.reset(palm.y);
      state.tip.reset(tip);
      state.motion.reset();
    }
    state.visible = true;
    state.palm.x = state.palmX.filter(palm.x, dt);
    state.palm.y = state.palmY.filter(palm.y, dt);
    state.tip.update(tip, fresh, dt);
    if (fresh) trackMotion(state, palm);

    const info = discHands[hand.id];
    info.visible = true;
    info.palm.x = state.palm.x;
    info.palm.y = state.palm.y;
    info.size = hand.size;
    info.roll = hand.roll;
    info.open = hand.gesture === 'open' || hand.gesture === 'ok'
      || (hand.gesture !== 'fist' && hand.fingers?.count >= 4);
  }

  // The raw palm centre (five landmarks averaged, so it jitters little)
  // feeds a short velocity window. A flick is fast for a couple of frames in
  // a row and in one direction; a one-frame tracking glitch is neither.
  function trackMotion(state, palm) {
    const motion = state.motion.add(palm.x, palm.y, time);
    const { x: vx, y: vy } = motion.velocity;
    const fast = motion.speed > CONTROLS.throwSpeed && motion.displacement > CONTROLS.throwDeadZone;
    const sameWay = state.fastSamples === 0
      || (vx * state.fastDirection.x + vy * state.fastDirection.y) > 0.5 * motion.speed;
    state.fastSamples = fast && sameWay ? state.fastSamples + 1 : fast ? 1 : 0;
    if (fast) {
      state.fastDirection.x = vx / motion.speed;
      state.fastDirection.y = vy / motion.speed;
    }
    if (motion.speed > 0.2) state.lastMove = { time, x: vx / motion.speed, y: vy / motion.speed };
    if (motion.speed > CONTROLS.throwSpeed * 0.7) state.recentFast = { time, vx, vy };
  }

  function lose(state, hand) {
    if (state.visible) {
      // vanishing right after a fast move: the flick outran the tracker
      const disc = discs.ownedBy(hand.id);
      if (disc?.state === 'held' && time - state.recentFast.time < CONTROLS.lostThrowWindow) {
        discs.throwDisc(disc, state.recentFast.vx, state.recentFast.vy);
      }
    }
    state.visible = false;
    state.fastSamples = 0;
    state.motion.reset();
    discHands[hand.id].visible = false;
  }

  function updateDrawing(state, hand, nowMs, dt) {
    const disc = discs.ownedBy(hand.id);
    const holdsDisc = disc && (disc.state === 'held' || disc.state === 'summoning');
    const pointing = hand.visible && hand.gesture === 'point' && !holdsDisc;
    if (pointing) {
      state.lastPointMs = nowMs;
      if (!state.trail && nowMs - hand.gestureSince >= CONTROLS.pointHoldMs) {
        state.trail = walls.start(state.tip.position, time, teams[hand.id]);
        log(`wall ${initial(hand.id)}`);
      }
    }
    if (!state.trail) return;
    if (pointing) walls.steer(state.trail, state.tip.position, state.tip.velocity, time, dt);
    else if (nowMs - state.lastPointMs > CONTROLS.pointGraceMs) {
      walls.finish(state.trail, time);
      state.trail = null;
    }
  }

  function updateDisc(state, hand, nowMs) {
    if (!hand.visible) return;
    const disc = discs.ownedBy(hand.id);
    if (!disc && hand.gesture === 'ok' && nowMs - hand.gestureSince >= CONTROLS.okHoldMs) {
      discs.summon(hand.id, discHands[hand.id]);
      return;
    }
    if (!disc || (disc.state !== 'held' && disc.state !== 'summoning')) {
      state.okWithDisc = false;
      state.openSinceMs = 0;
      return;
    }
    // Release on intent: the hand that held the disc in an ok opens up (the
    // thumb leaves the index finger, the fingers stay up). Curling into a
    // fist doesn't count; that shatters the disc instead.
    if (hand.gesture === 'ok') state.okWithDisc = true;
    const fingers = hand.fingers;
    const raised = fingers ? ['index', 'middle', 'ring', 'pinky'].filter((finger) => fingers.extended[finger]).length : 0;
    const opened = !hand.touching.index && fingers?.extended.index && raised >= 3;
    if (!opened) state.openSinceMs = 0;
    else if (state.okWithDisc) state.openSinceMs ||= nowMs;
    if (disc.state !== 'held') return;   // still materialising: a release waits for it
    if (state.openSinceMs && nowMs - state.openSinceMs >= CONTROLS.releaseHoldMs) {
      release(state, disc);
    } else if (disc.stateTime > CONTROLS.throwArmTime && state.fastSamples >= CONTROLS.throwSamples) {
      discs.throwDisc(disc, state.motion.velocity.x, state.motion.velocity.y);
    }
  }

  // Thrown along the hand's motion, or tossed gently the way the hand last
  // moved, or towards the middle of the frame. The disc has a minimum speed.
  function release(state, disc) {
    state.okWithDisc = false;
    state.openSinceMs = 0;
    const motion = state.motion;
    if (motion.speed >= CONTROLS.releaseSpeed) {
      discs.throwDisc(disc, motion.velocity.x, motion.velocity.y);
      return;
    }
    let direction = state.lastMove;
    if (time - direction.time > CONTROLS.releaseMemory) {
      const length = Math.hypot(state.palm.x, state.palm.y);
      direction = length > 0.05 ? { x: -state.palm.x / length, y: -state.palm.y / length } : { x: 0, y: 1 };
    }
    discs.throwDisc(disc, direction.x * 0.01, direction.y * 0.01);
  }

  function updateFist(state, hand, nowMs) {
    if (!hand.visible || hand.gesture !== 'fist') {
      state.fistLatched = false;
      return;
    }
    if (state.fistLatched || nowMs - hand.gestureSince < CONTROLS.fistHoldMs) return;
    state.fistLatched = true;
    state.lastDerezz = time;
    counts.derezz++;
    log(`derezz ${initial(hand.id)}`);
    const color = teams[hand.id].color;
    waves.push({ x: state.palm.x, y: state.palm.y, start: time });
    stage.shock(state.palm.x, state.palm.y, color, CONTROLS.derezzSpeed, CONTROLS.derezzReach);
    const disc = discs.ownedBy(hand.id);
    if (disc && (disc.state === 'held' || disc.state === 'summoning')) discs.shatter(disc);
    else flashes.spawn({ x: state.palm.x, y: state.palm.y, size: 0.1, duration: 0.45, color });
  }

  // A one-shot gesture: fires once when `gesture` has been held for `holdMs`,
  // then waits until the hand does something else (and the cooldown is over).
  function heldOnce(state, hand, nowMs, gesture, holdMs, cooldownMs) {
    const latch = state.latched;
    if (!hand.visible || hand.gesture !== gesture) {
      latch[gesture] = false;
      return false;
    }
    if (latch[gesture] || nowMs - hand.gestureSince < holdMs) return false;
    if (nowMs - (state.lastFired[gesture] ?? -Infinity) < cooldownMs) return false;
    latch[gesture] = true;
    state.lastFired[gesture] = nowMs;
    return true;
  }

  function updateRock(state, hand, nowMs) {
    if (!heldOnce(state, hand, nowMs, 'rock', CONTROLS.rockHoldMs, CONTROLS.rockCooldownMs)) return;
    const team = teams[hand.id];
    team.toggle(time);
    counts.teamSwitches++;
    state.lastTeamSwitch = time;
    log(`team ${initial(hand.id)} ${team.name}`);
    const newColor = teams.colors[team.index];
    stage.sweep(hand.id, state.palm.x, state.palm.y, newColor);
    flashes.spawn({ x: state.palm.x, y: state.palm.y, size: 0.09, duration: 0.45, color: newColor, glint: 0.6 });
  }

  function updateThumbsUp(state, hand, nowMs) {
    if (!heldOnce(state, hand, nowMs, 'thumbsUp', CONTROLS.thumbsUpHoldMs, CONTROLS.thumbsUpCooldownMs)) return;
    state.lastLaunch = time;
    cycles.launch(hand.id, state.palm, teams[hand.id]);
  }

  // the laser emitter appears just above the raised index and middle fingers
  function updatePeace(state, hand, nowMs) {
    if (!heldOnce(state, hand, nowMs, 'peace', CONTROLS.peaceHoldMs, CONTROLS.peaceCooldownMs)) return;
    const index = toView(hand.tips.index, {});
    const middle = toView(hand.tips.middle, {});
    const emitter = { x: (index.x + middle.x) / 2, y: Math.max(index.y, middle.y) + 0.03 };
    if (digitizer.start(hand.id, emitter, teams[hand.id].color)) state.lastDigitize = time;
  }

  // catching a disc means opening your hands, which mustn't open the portal
  function portalReady(hand) {
    return hand.visible && hand.palmFacing && hand.gesture !== 'ok'
      && (hand.gesture === 'open' || hand.fingers?.count >= 4) && !discs.ownedBy(hand.id);
  }

  function updatePortal(nowMs, dt) {
    const ready = portalReady(hands.left) && portalReady(hands.right);
    if (ready) {
      portal.lastReadyMs = nowMs;
      portal.readySinceMs ||= nowMs;
      if (!portal.on && nowMs - portal.readySinceMs >= CONTROLS.portalHoldMs) {
        portal.on = true;
        portal.age = 0;
        portal.opened++;
        log('portal');
      }
      const left = states.left.palm;
      const right = states.right.palm;
      const distance = Math.hypot(right.x - left.x, right.y - left.y);
      const targetX = (left.x + right.x) / 2;
      const targetWidth = clamp(distance * 0.5 * CONTROLS.portalWidth, 0.04, 0.6);
      const targetY = (left.y + right.y) / 2;
      const fresh = portal.strength < 0.01;
      portal.x = fresh ? targetX : easeTowards(portal.x, targetX, dt, 0.06);
      portal.halfWidth = fresh ? targetWidth : easeTowards(portal.halfWidth, targetWidth, dt, 0.08);
      portal.handsY = fresh ? targetY : easeTowards(portal.handsY, targetY, dt, 0.08);
    } else {
      portal.readySinceMs = 0;
      if (portal.on && nowMs - portal.lastReadyMs > CONTROLS.portalReleaseMs) portal.on = false;
    }
    portal.strength = portal.on
      ? Math.min(1, portal.strength + dt / CONTROLS.portalRise)
      : Math.max(0, portal.strength - dt / CONTROLS.portalFall);
    portal.age += dt;
    ['left', 'right'].forEach((id, index) => {
      const tether = tethers[index];
      tether.x = states[id].palm.x;
      tether.y = states[id].palm.y;
      tether.strength = hands[id].visible ? portal.strength : 0;
    });
  }

  function spawnWallVoxels(sample, extrude, wave) {
    // every other sample, three cubes up the wall: the wall breaks into a voxel grid
    if (Math.round(sample.along / WALL.spacing) % 2) return;
    const color = teams.colors[sample.team];
    const cube = WALL.height / 3;
    for (let row = 0; row < 3; row++) {
      const lift = (row + 0.5) / 3;
      const x = sample.x + extrude.x * lift;
      const y = sample.y + extrude.y * lift;
      const awayX = x - wave.x;
      const awayY = y - wave.y;
      const away = Math.hypot(awayX, awayY) || 1;
      const push = 0.1 + Math.random() * 0.22;
      voxels.spawn({
        x, y,
        vx: (awayX / away) * push + (Math.random() - 0.5) * 0.12,
        vy: (awayY / away) * push + (Math.random() - 0.5) * 0.12 + 0.04,
        size: cube * (0.55 + Math.random() * 0.35),
        life: 1.3 + Math.random() * 1.1,
        heat: 0.6,
        color,
        delay: Math.random() * 0.12,
      });
    }
  }

  function updateWaves() {
    for (let index = waves.length - 1; index >= 0; index--) {
      const wave = waves[index];
      const radius = (time - wave.start) * CONTROLS.derezzSpeed;
      walls.shatter(wave, radius, wave.start, (sample, extrude) => spawnWallVoxels(sample, extrude, wave), time);
      cycles.shatter(wave, radius, wave.start);
      if (radius > CONTROLS.derezzReach) waves.splice(index, 1);
    }
  }

  function describe(state, hand) {
    if (!hand.visible) return '';
    const disc = discs.ownedBy(hand.id);
    if (digitizer.active && time - state.lastDigitize < 5) return 'DIGITIZING';
    if (time - state.lastTeamSwitch < 1.2) return `PROGRAM ${teams[hand.id].name}`;
    if (time - state.lastDerezz < 1.2) return 'DEREZZ';
    if (time - state.lastLaunch < 1.2) return 'LIGHT CYCLE';
    if (portal.on) return 'PORTAL OPEN';
    if (state.trail) return 'LIGHT WALL';
    if (disc?.state === 'summoning') return 'IDENTITY DISC';
    if (disc?.state === 'held') return 'DISC ARMED · FLICK';
    if (disc?.state === 'flying') return 'DISC THROWN';
    if (disc?.state === 'returning') return discHands[hand.id].open ? 'CATCH' : 'OPEN HAND TO CATCH';
    return '';
  }

  return {
    states,
    portal,
    tethers,
    counts,
    update(nowMs, seconds, dt) {
      time = seconds;
      for (const hand of [hands.left, hands.right]) {
        const state = states[hand.id];
        if (hand.visible && hand.landmarks) track(state, hand, dt);
        else lose(state, hand);
        updateDrawing(state, hand, nowMs, dt);
        updateDisc(state, hand, nowMs);
        updateFist(state, hand, nowMs);
        updateRock(state, hand, nowMs);
        updateThumbsUp(state, hand, nowMs);
        updatePeace(state, hand, nowMs);
      }
      updatePortal(nowMs, dt);
      updateWaves();
      discs.update(time, dt, discHands);
      for (const hand of [hands.left, hands.right]) states[hand.id].action = describe(states[hand.id], hand);
    },
  };
}

function createHandState(id) {
  return {
    id,
    visible: false,
    palm: { x: 0, y: 0 },
    palmX: new OneEuroFilter({ minCutoff: 2, beta: 2 }),
    palmY: new OneEuroFilter({ minCutoff: 2, beta: 2 }),
    landmarks: null,
    tip: new PointFilter({ minCutoff: 1.2, beta: 3, maxJump: CONTROLS.tipJump }),
    motion: new VelocityWindow(CONTROLS.throwWindow),
    fastSamples: 0,
    fastDirection: { x: 0, y: 0 },
    lastMove: { time: -Infinity, x: 0, y: 0 },
    recentFast: { time: -Infinity, vx: 0, vy: 0 },
    okWithDisc: false,
    openSinceMs: 0,
    trail: null,
    lastPointMs: -Infinity,
    fistLatched: false,
    lastDerezz: -Infinity,
    latched: {},
    lastFired: {},
    lastTeamSwitch: -Infinity,
    lastLaunch: -Infinity,
    lastDigitize: -Infinity,
    action: '',
  };
}

function discHand() {
  return { visible: false, palm: { x: 0, y: 0 }, size: 0.13, roll: 0, open: false };
}
