// Gestures -> actions. Reads the debounced gestures and finger analysis from
// hands.js and drives the walls, the discs, the light cycles, the batons,
// derezz and the portal. Each hand has its own team colour.
//
//   point                     draw a light wall from the index fingertip
//   rock (index + pinky)      switch this hand's team (TRON cyan <-> CLU orange)
//   ok                        summon an identity disc at that palm
//   flick, or open the ok     throw it; it comes back to an open hand
//   thumbs up                 launch a light cycle onto the Grid floor
//   peace                     the digitizing laser: the person turns into TRON lines
//   shaka (thumb + pinky)     a light baton in the hand: swing it to cut walls and bat
//                             discs; take its free end with the other hand and pull
//                             the hands apart to rez a light cycle
//   fist, held                a charging ring, then a derezz wave around the fist:
//                             nearby walls, discs, batons and cycles break into voxels
//   both fists held together  END OF LINE: everything derezzes, the Grid shuts down
//                             and reboots
//   both palms open, facing   portal between the hands (not while you have a disc out)
//
// Real tracking jitters, so every action needs its pose to hold for a moment
// on top of the tracker's own debounce, and drawing survives short dropouts.
// A fist has to be held for half a second, so passing through one on the
// way between two other gestures does nothing.
import { OneEuroFilter, PointFilter, VelocityWindow, clamp, easeTowards } from './filters.js';
import { WALL } from './walls.js';
import { BATON } from './baton.js';

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
  fistHoldMs: 500,        // a fist charges this long before it derezzes ...
  derezzRadius: 2.6,      // ... everything within this many palm lengths of it
  derezzSpeed: 1.25,      // view units/s, the derezz wave front
  pairDistance: 1.6,      // palm lengths between two fists that count as together ...
  pairNear: 3.0,          // ... and closer than this, single fists wait for the pair
  pairHoldMs: 500,
  shutdownSpeed: 1.8,     // view units/s, the END OF LINE wave
  shutdownReach: 2.4,
  rockHoldMs: 150,
  rockCooldownMs: 600,
  thumbsUpHoldMs: 150,
  thumbsUpCooldownMs: 1200,
  shakaHoldMs: 150,
  shakaGraceMs: 150,      // a baton survives a gesture dropout this long
  grabReach: 1.1,         // palm lengths from the baton's free end that the other hand takes it ...
  grabHoldMs: 150,        // ... held there this long
  pullDistance: 1.4,      // palm lengths further apart the hands then pull to rez a cycle
  minPull: 0.16,          // view units
  cycleDrop: 0.08,        // view units below the palm where a thumbs-up cycle rezzes ...
  cycleLength: 0.3,       // ... at this length on screen (view units)
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
export function createControls({ hands, view, teams, walls, discs, cycles, batons, digitizer, endOfLine,
  voxels, flashes, stage, log }) {
  const states = { left: createHandState('left'), right: createHandState('right') };
  const discHands = { left: discHand(), right: discHand() };
  const waves = [];
  const portal = {
    on: false, strength: 0, x: 0, halfWidth: 0.2, handsY: 0, age: 0,
    readySinceMs: 0, lastReadyMs: -Infinity, opened: 0,
  };
  const tethers = [{ x: 0, y: 0, strength: 0 }, { x: 0, y: 0, strength: 0 }];
  const counts = { derezz: 0, teamSwitches: 0, batonCycles: 0 };
  // the other hand taking a baton: { holder, grabber, side, sinceMs, latched, startDistance, progress }
  let grab = null;
  // two fists together: { near, sinceMs, charge, x, y, radius }
  const pair = { near: false, sinceMs: 0, charge: 0, x: 0, y: 0, radius: 0 };
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
    state.size = hand.size;
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
    if (pointing) walls.steer(state.trail, state.tip.position, time, dt);
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

  // A fist charges for half a second (the HUD shows a ring filling up),
  // then sends a derezz wave out to a few palm lengths around it. While both
  // hands are fists close to each other, they charge END OF LINE instead.
  function updateFist(state, hand, nowMs) {
    if (!hand.visible || hand.gesture !== 'fist' || pair.near) {
      state.fistCharge = 0;
      if (hand.gesture !== 'fist') state.fistLatched = false;
      return;
    }
    if (state.fistLatched) return;
    state.fistCharge = clamp((nowMs - hand.gestureSince) / CONTROLS.fistHoldMs, 0, 1);
    if (state.fistCharge < 1) return;
    state.fistLatched = true;
    state.fistCharge = 0;
    state.lastDerezz = time;
    counts.derezz++;
    log(`derezz ${initial(hand.id)}`);
    const color = teams[hand.id].color;
    const reach = Math.max(0.2, CONTROLS.derezzRadius * hand.size);
    derezzWave(state.palm, reach, CONTROLS.derezzSpeed, color);
    flashes.spawn({ x: state.palm.x, y: state.palm.y, size: 0.1, duration: 0.45, color });
  }

  // `everything`: also what is made while the wave runs (END OF LINE);
  // otherwise only what was there when the fist fired
  function derezzWave(center, reach, speed, color, everything = false) {
    waves.push({ x: center.x, y: center.y, start: time, reach, speed, bornBefore: everything ? Infinity : time });
    stage.shock(center.x, center.y, color, speed, reach);
  }

  // Both fists, close together, held: END OF LINE.
  function updatePair(nowMs) {
    const left = hands.left;
    const right = hands.right;
    const fists = left.visible && right.visible && left.gesture === 'fist' && right.gesture === 'fist';
    const palm = (left.size + right.size) / 2;
    const distance = Math.hypot(states.right.palm.x - states.left.palm.x, states.right.palm.y - states.left.palm.y);
    pair.near = fists && distance < CONTROLS.pairNear * palm;
    const together = fists && distance < CONTROLS.pairDistance * palm;
    if (!together || endOfLine.active) {
      pair.sinceMs = 0;
      pair.charge = 0;
      return;
    }
    pair.sinceMs ||= nowMs;
    pair.x = (states.left.palm.x + states.right.palm.x) / 2;
    pair.y = (states.left.palm.y + states.right.palm.y) / 2;
    pair.radius = distance / 2 + palm * 0.6;
    pair.charge = clamp((nowMs - pair.sinceMs) / CONTROLS.pairHoldMs, 0, 1);
    if (pair.charge < 1) return;
    pair.charge = 0;
    pair.sinceMs = Infinity;   // once per pair of fists
    endOfLine.start(pair);
    digitizer.cancel();
    for (const id of ['left', 'right']) {
      if (states[id].trail) walls.finish(states[id].trail, time);
      states[id].trail = null;
      states[id].fistLatched = true;
    }
    grab = null;
    derezzWave(pair, CONTROLS.shutdownReach, CONTROLS.shutdownSpeed, teams.left.color, true);
    flashes.spawn({ x: pair.x, y: pair.y, size: 0.2, duration: 0.7, color: teams.left.color, glint: 1.4 });
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
    cycles.launch(hand.id, { x: state.palm.x, y: state.palm.y - CONTROLS.cycleDrop }, teams[hand.id],
      { length: CONTROLS.cycleLength });
  }

  // the laser emitter appears just above the raised index and middle fingers
  function updatePeace(state, hand, nowMs) {
    if (!heldOnce(state, hand, nowMs, 'peace', CONTROLS.peaceHoldMs, CONTROLS.peaceCooldownMs)) return;
    const index = toView(hand.tips.index, {});
    const middle = toView(hand.tips.middle, {});
    const emitter = { x: (index.x + middle.x) / 2, y: Math.max(index.y, middle.y) + 0.03 };
    if (digitizer.start(hand.id, emitter, teams[hand.id].color)) state.lastDigitize = time;
  }

  // A shaka holds a baton along the thumb-tip to pinky-tip axis, centred on
  // the palm and reaching a little past both tips; a disc in that hand is
  // put away. After a baton became a cycle, the shaka has to be released
  // before it rezzes a new one.
  function updateBaton(state, hand, nowMs) {
    const shaka = hand.visible && hand.gesture === 'shaka';
    if (!shaka) state.batonSpent = false;
    if (shaka) state.lastShakaMs = nowMs;
    const baton = batons.get(hand.id);
    const wanted = shaka && !state.batonSpent && (baton || nowMs - hand.gestureSince >= CONTROLS.shakaHoldMs);
    if (wanted) {
      const disc = discs.ownedBy(hand.id);
      if (disc?.state === 'held') discs.dismiss(disc);
      const thumb = toView(hand.tips.thumb, {});
      const pinky = toView(hand.tips.pinky, {});
      const axis = { x: pinky.x - thumb.x, y: pinky.y - thumb.y };
      const length = Math.hypot(axis.x, axis.y) || 1;
      const reach = (point) => Math.abs(((point.x - state.palm.x) * axis.x + (point.y - state.palm.y) * axis.y) / length);
      batons.hold(hand.id, state.palm, axis, Math.max(reach(thumb), reach(pinky)) + BATON.margin, teams[hand.id]);
    } else if (baton && nowMs - state.lastShakaMs > CONTROLS.shakaGraceMs) {
      batons.release(hand.id);
    }
  }

  // The other hand (any pose but a fist) at a baton's free end takes it;
  // pulling the hands apart then fills the bar along the baton, and at the
  // end the baton splits into its two handles and a light cycle rezzes
  // between the hands, about as long as they are apart. It is the colour of
  // the hand that held the baton, with the other hand's colour on its wheels.
  function updateGrab(nowMs) {
    if (grab && !grabStillValid()) {
      batons.setGrab(grab.holder, null);
      grab = null;
    }
    if (!grab) {
      grab = findGrab(nowMs);
      return;
    }
    const holder = states[grab.holder];
    const grabber = states[grab.grabber];
    const distance = Math.hypot(grabber.palm.x - holder.palm.x, grabber.palm.y - holder.palm.y);
    if (!grab.latched) {
      if (nearFreeEnd(grab.holder, grab.grabber) === null) {
        grab = null;
        return;
      }
      if (nowMs - grab.sinceMs < CONTROLS.grabHoldMs) return;
      grab.latched = true;
      grab.startDistance = distance;
      log(`grab ${initial(grab.grabber)}`);
    }
    const palm = (hands[grab.holder].size + hands[grab.grabber].size) / 2;
    const needed = Math.max(CONTROLS.minPull, CONTROLS.pullDistance * palm);
    grab.progress = clamp((distance - grab.startDistance) / needed, 0, 1);
    batons.setGrab(grab.holder, { side: grab.side, progress: grab.progress });
    if (grab.progress < 1) return;
    const holderTeam = teams[grab.holder];
    const grabberTeam = teams[grab.grabber];
    const middle = { x: (holder.palm.x + grabber.palm.x) / 2, y: (holder.palm.y + grabber.palm.y) / 2 };
    batons.split(grab.holder, grab.side, { holder: grab.holder, grabber: grab.grabber });
    cycles.launch('both', middle, holderTeam, {
      length: distance * 0.9,
      accent: grabberTeam.index !== holderTeam.index ? grabberTeam.color : null,
    });
    holder.batonSpent = true;
    holder.lastLaunch = time;
    grabber.lastLaunch = time;
    counts.batonCycles++;
    grab = null;
  }

  function grabStillValid() {
    const baton = batons.get(grab.holder);
    const grabber = hands[grab.grabber];
    return baton && baton.state === 'held' && grabber.visible && grabber.gesture !== 'fist';
  }

  // which end of the holder's baton the grabber's palm is at: +1 / -1, or null
  function nearFreeEnd(holderId, grabberId) {
    const baton = batons.get(holderId);
    const grabber = hands[grabberId];
    if (!baton || baton.state !== 'held' || !grabber.visible || grabber.gesture === 'fist') return null;
    const palm = states[grabberId].palm;
    const reach = CONTROLS.grabReach * grabber.size;
    for (const [side, end] of [[1, baton.current.b], [-1, baton.current.a]]) {
      if (Math.hypot(palm.x - end.x, palm.y - end.y) < reach) return side;
    }
    return null;
  }

  function findGrab(nowMs) {
    for (const [holder, grabber] of [['left', 'right'], ['right', 'left']]) {
      const side = nearFreeEnd(holder, grabber);
      if (side !== null) return { holder, grabber, side, sinceMs: nowMs, latched: false, startDistance: 0, progress: 0 };
    }
    return null;
  }

  // catching a disc means opening your hands, which mustn't open the portal
  function portalReady(hand) {
    return !endOfLine.active && hand.visible && hand.palmFacing && hand.gesture !== 'ok'
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
      const radius = Math.min(wave.reach, (time - wave.start) * wave.speed);
      walls.shatter(wave, radius, wave.bornBefore, (sample, extrude) => spawnWallVoxels(sample, extrude, wave), time);
      cycles.shatter(wave, radius, wave.bornBefore);
      discs.shatterWithin(wave, radius);
      batons.derezzWithin(wave, radius);
      if (radius >= wave.reach) waves.splice(index, 1);
    }
  }

  function describe(state, hand) {
    if (!hand.visible) return '';
    if (endOfLine.active) return 'END OF LINE';
    if (pair.charge > 0) return 'END OF LINE';
    if (state.fistCharge > 0) return 'DEREZZ';
    if (grab && grab.grabber === hand.id) return grab.latched ? 'PULL APART' : 'GRAB';
    if (grab?.latched && grab.holder === hand.id) return 'PULL APART';
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
    if (batons.get(hand.id)) return 'BATON';
    return '';
  }

  return {
    states,
    portal,
    tethers,
    counts,
    pair,
    get grab() {
      return grab;
    },
    update(nowMs, seconds, dt) {
      time = seconds;
      for (const hand of [hands.left, hands.right]) {
        const state = states[hand.id];
        if (hand.visible && hand.landmarks) track(state, hand, dt);
        else lose(state, hand);
      }
      updatePair(nowMs);
      // while the Grid is down, nothing new can be made
      if (!endOfLine.active) {
        for (const hand of [hands.left, hands.right]) {
          const state = states[hand.id];
          updateDrawing(state, hand, nowMs, dt);
          updateDisc(state, hand, nowMs);
          updateFist(state, hand, nowMs);
          updateRock(state, hand, nowMs);
          updateThumbsUp(state, hand, nowMs);
          updatePeace(state, hand, nowMs);
          updateBaton(state, hand, nowMs);
        }
        updateGrab(nowMs);
      } else {
        for (const id of ['left', 'right']) {
          states[id].fistCharge = 0;
          if (batons.get(id)) batons.release(id);
        }
      }
      batons.update(time, dt, {
        left: hands.left.visible ? states.left.palm : null,
        right: hands.right.visible ? states.right.palm : null,
      });
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
    size: 0.13,
    fistLatched: false,
    fistCharge: 0,
    lastDerezz: -Infinity,
    latched: {},
    lastFired: {},
    lastTeamSwitch: -Infinity,
    lastLaunch: -Infinity,
    lastDigitize: -Infinity,
    lastShakaMs: -Infinity,
    batonSpent: false,
    action: '',
  };
}

function discHand() {
  return { visible: false, palm: { x: 0, y: 0 }, size: 0.13, roll: 0, open: false };
}
