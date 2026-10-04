// Ride mode: a light cycle duel against CLU, steered with both hands held
// like handlebars (src/handlebars.js).
//
//   mount     a light baton pulled apart rezzes a cycle between the hands
//             (controls.js); it hangs there until it is built ...
//   swoop     ... then the user hops on: the camera dives down behind it
//             into the arena while the webcam shrinks into a corner
//   duel      rounds of 3-2-1, race, derezz (duel.js) until one side has
//             won; the TRON WINS / CLU WINS screen
//   exit      the arena derezzes and the camera image grows back: the AR
//             Grid boots again
//
// END OF LINE (two fists together) still works while riding: the arena
// powers down with the rest of the Grid and the app returns to the intro.
// Arrow keys steer too (up: throttle, down: brake), and R (or ?ride in the
// URL) starts a ride without the baton: mouse mode, screenshots.
//
// The parts: rules.js (tuning), arena.js and stadium.js (the scene),
// rider.js (a cycle's motion and walls), brain.js (CLU, and the demo's
// autopilot), duel.js (rounds and scoring), scene.js (bikes, jetwalls,
// voxels), camera.js, finish.js (speed lines, flashes, the exit's derezz),
// hud.js, pip.js (the webcam in a corner) and sound.js.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createHandlebars } from '../../../handlebars.js';
import { REZZ } from '../lightcycle-model.js';
import { GRADE, cssFilter } from '../grade.js';
import { END_OF_LINE, lightPower } from '../endofline.js';
import { createRideScene } from './scene.js';
import { createRideCamera } from './camera.js';
import { createFinishPass } from './finish.js';
import { createRideHud } from './hud.js';
import { createPip } from './pip.js';
import { createRideSound } from './sound.js';
import { createDuel } from './duel.js';
import { seededRandom } from './brain.js';
import { BIKE, MATCH } from './rules.js';

const PIP = { width: 0.19, minWidth: 220, maxWidth: 340, margin: 24 };
const DEMO_SEED = 9;
const DEMO_STEP = 1 / 60;
const PIP_BRIGHTNESS = 0.75;     // the camera picture is graded like the Grid, a bit brighter
const BLOOM = { strength: 0.85, radius: 0.35, threshold: 0.55 };
// END OF LINE while riding: the bikes go out about here (s after the fists),
// the HUD switches off, and the arena hands over to the dark AR layer once
// its horizon would have gone out too
const POWER_DOWN = { bikes: [0.3, 0.9], hud: 0.45, hudCollapse: 0.3, handOver: END_OF_LINE.dot[1] };

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smooth = (t) => t * t * (3 - 2 * t);

// log(name) records what happened for the stats.
export function createRide({ renderer, container, hands, host, teams, endOfLine, view, envMap, onExit, log = () => {} }) {
  const rideScene = createRideScene({ renderer, envMap, teamColors: teams.colors });
  const rideCamera = createRideCamera();
  const camera = rideCamera.camera;
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(rideScene.scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  composer.addPass(bloom);
  const finish = createFinishPass();
  composer.addPass(finish.pass);
  composer.addPass(new OutputPass());

  const hud = createRideHud(container);
  const pip = createPip(hands.video);
  const sound = createRideSound(host?.music);
  const handlebars = createHandlebars();
  const keys = { left: false, right: false, up: false, down: false, lastMs: -Infinity };
  const demoMode = () => hands.mode === 'demo';

  let state = 'off';
  let stateTime = 0;
  let seconds = 0;
  let duel = null;
  let playerTeam = 0;
  const colors = [new THREE.Color(), new THREE.Color()];
  const rgb = ['', ''];
  let mounted = null;          // { cycle, pose, dismount, since }
  let flash = 0;
  let noGrip = 0;              // s without a grip
  let usingKeys = false;       // the arrow keys are steering
  const rezzStart = [0, 0];    // when each bike started to rezz (seconds)
  const fades = [null, null];
  let crashPoint = null;
  let roundSwoop = false;      // the camera dives in behind the bike during a countdown
  let pipShown = 0;            // 1 once the camera picture is in its corner
  let demoClock = 0;
  const counts = { rides: 0, rounds: 0, crashes: 0 };
  const input = { steer: 0, throttle: 0.5, brake: false, idle: false };
  const demoSteer = { steer: 0, throttle: 0.5, brake: false, away: false };

  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[event.key];
    if (key) {
      event.preventDefault();
      if (state === 'duel') keys[key] = true;
    } else if (event.key.toLowerCase() === 'r' && state === 'off') {
      api.startNow(teams.right.index);
    }
  });
  window.addEventListener('keyup', (event) => {
    const key = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[event.key];
    if (!key) return;
    keys[key] = false;
    keys.lastMs = performance.now();
  });

  // Shaders and render targets are made on first use, which stalls the
  // frame: compile the arena in the background once it's loaded, then
  // render one frame of it unseen (the AR frame is drawn over it).
  let warm = 'loading';
  Promise.all([rideScene.ready, rideScene.arena.stadiumReady])
    .then(() => {
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      const compiled = renderer.compileAsync(rideScene.scene, camera);
      renderer.setRenderTarget(previous);
      return compiled.finally(() => target.dispose());
    })
    .then(() => {
      warm = 'compiled';
    });

  function setState(name) {
    state = name;
    stateTime = 0;
    if (name !== 'duel' && name !== 'off') log(`ride ${name}`);
  }

  function setTeams(team) {
    playerTeam = team;
    colors[0].copy(teams.colors[team]);
    colors[1].copy(teams.colors[1 - team]);
    colors.forEach((color, index) => {
      const srgb = color.clone().convertLinearToSRGB();
      rgb[index] = `${Math.round(srgb.r * 255)}, ${Math.round(srgb.g * 255)}, ${Math.round(srgb.b * 255)}`;
    });
    rideScene.setColors(0, colors[0]);
    rideScene.setColors(1, colors[1]);
  }

  // where the camera picture sits in the corner, and how far along the way
  // from full screen it is (0 full .. 1 in the corner)
  function pipRect(progress) {
    const width = clamp(view.width * PIP.width, PIP.minWidth, PIP.maxWidth);
    const height = width * (view.height / view.width);
    const corner = { x: PIP.margin, y: view.height - height - PIP.margin - 20, w: width, h: height };
    const t = smooth(clamp(progress, 0, 1));
    return {
      x: corner.x * t,
      y: corner.y * t,
      w: view.width + (corner.w - view.width) * t,
      h: view.height + (corner.h - view.height) * t,
    };
  }

  // The user hops on: the arena takes over from the AR view.
  function beginSwoop(pose) {
    duel = createDuel({
      // the demo plays the same match every time (one its rider wins)
      random: seededRandom(demoMode() ? DEMO_SEED : (Math.random() * 1e9) >>> 0),
      winScore: demoMode() ? MATCH.demoWinScore : MATCH.winScore,
      playerTeam,
    });
    duel.start();
    rezzStart[0] = -Infinity;          // the player's bike is already built
    rezzStart[1] = Infinity;           // CLU's rezzes with the countdown
    fades[0] = fades[1] = null;
    rideScene.voxels.clear();
    rideCamera.setAspect(view.aspect);
    // a camera that sees the arena bike where the AR one was on screen
    const fov = 50;
    const tanV = Math.tan((fov / 2) * Math.PI / 180);
    const player = duel.player;
    const length = clamp(pose?.length ?? 0.3, 0.05, 1.2);
    const distance = clamp(BIKE.length / (2 * tanV * length), 3, 30);
    const facing = pose?.facing ?? 1;
    // the bike's right is (-sin, cos): on that side the nose points screen-right
    const sideX = -Math.sin(player.heading) * facing;
    const sideZ = Math.cos(player.heading) * facing;
    const middle = new THREE.Vector3(player.x + player.forwardX * BIKE.length / 2, 0.75,
      player.z + player.forwardZ * BIKE.length / 2);
    const from = middle.clone().add(new THREE.Vector3(sideX * distance, 0.5 + distance * 0.12, sideZ * distance));
    const screenRight = new THREE.Vector3(player.forwardX * facing, 0, player.forwardZ * facing);
    const ndcX = (pose?.x ?? 0) / (view.aspect / 2);
    const ndcY = (pose?.y ?? 0) / 0.5;
    const at = middle.clone()
      .addScaledVector(screenRight, -ndcX * distance * tanV * view.aspect)
      .add(new THREE.Vector3(0, -ndcY * distance * tanV, 0));
    rideCamera.startSwoop(from, at, fov);
    demoClock = 0;
    flash = 0.15;
    roundSwoop = false;
    host?.sfx?.enterGrid();
    counts.rides++;
    setState('swoop');
  }

  function readInput(dt) {
    const reading = handlebars.update(hands, dt, view.aspect);
    usingKeys = keys.left || keys.right || keys.up || keys.down || performance.now() - keys.lastMs < 300;
    if (usingKeys) {
      input.steer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      input.throttle = keys.up ? 1 : 0.5;
      input.brake = keys.down;
      input.idle = false;
      noGrip = 0;
      return;
    }
    noGrip = reading.gripping ? 0 : noGrip + dt;
    input.steer = reading.steer;
    input.throttle = reading.throttle;
    input.brake = reading.brake;
    // nobody holding on for a while: straight on, a little slower
    input.idle = noGrip > MATCH.idleAfter;
    if (input.idle) input.steer = 0;
  }

  // what happened in the duel this frame: sounds, voxels, the camera
  function handleEvents() {
    for (const event of duel.events.splice(0)) {
      if (event.type === 'round') {
        log(`ride round ${event.round}`);
        handlebars.recalibrate();
        counts.rounds++;
        fades[0] = fades[1] = null;
        crashPoint = null;
        // round 1: CLU rezzes now; later rounds both bikes rezz
        rezzStart[1] = seconds;
        if (event.round > 1) {
          // watch the bike rezz from beside it, then dive in behind it
          rezzStart[0] = seconds;
          const player = duel.player;
          const middle = new THREE.Vector3(player.x + player.forwardX * BIKE.length / 2, 0.6,
            player.z + player.forwardZ * BIKE.length / 2);
          const from = middle.clone().add(new THREE.Vector3(
            -player.forwardZ * 5.5 + player.forwardX * 3, 0.9, player.forwardX * 5.5 + player.forwardZ * 3));
          rideCamera.startSwoop(from, middle, 50);
          roundSwoop = true;
          flash = 0.2;
        }
      } else if (event.type === 'tick') {
        sound.tick(event.count);
      } else if (event.type === 'go') {
        flash = 0.06;
      } else if (event.type === 'crash') {
        const index = event.rider === duel.player ? 0 : 1;
        log(`ride crash ${index === 0 ? 'player' : 'clu'}`);
        rideScene.derezzBike(index, event.rider, colors[index]);
        rideScene.derezzWall(event.rider, colors[index]);
        fades[index] = 0;
        crashPoint = new THREE.Vector3(event.x, 0.6, event.z);
        // our own crash happens right in front of the camera; CLU's gets a cut
        if (index === 1) rideCamera.cutTo(crashPoint, event.heading);
        rideCamera.kick(index === 0 ? 0.6 : 0.25);
        flash = Math.max(flash, index === 0 ? 0.3 : 0.18);
        sound.crash();
        counts.crashes++;
      } else if (event.type === 'result') {
        log(`ride result ${event.winner}`);
        sound.win(event.winner === 'player');
      }
    }
  }

  function updateCamera(dt) {
    const player = duel.player;
    const phase = duel.phase;
    if (phase === 'result' || phase === 'over') {
      rideCamera.orbit(seconds, dt);
    } else if (phase === 'crash' && crashPoint) {
      rideCamera.watch(crashPoint, dt);
    } else if (phase === 'countdown' && roundSwoop) {
      rideCamera.swoop(player, duel.phaseTime / (MATCH.countdown * 0.7));
    } else {
      roundSwoop = false;
      const speedFactor = (player.speed - BIKE.cruise) / (BIKE.boost - BIKE.cruise);
      rideCamera.follow(player, dt, phase === 'race' ? speedFactor : -0.15);
    }
  }

  const TEAM_NAMES = ['TRON', 'CLU'];
  const palmOf = (hand) => {
    const wrist = hand.landmarks[0];
    const knuckle = hand.landmarks[9];
    return { x: (wrist.x + knuckle.x) / 2, y: (wrist.y + knuckle.y) / 2 };
  };

  // the big words in the middle: the countdown, GO, a derezz, the winner
  function banner() {
    const phase = duel.phase;
    const time = duel.phaseTime;
    const cluName = TEAM_NAMES[1 - playerTeam];
    const playerName = TEAM_NAMES[playerTeam];
    if (phase === 'countdown') {
      const count = duel.count;
      const step = MATCH.countdown / 4;
      const local = (time % step) / step;
      return { words: count > 0 ? String(count) : 'GO', sub: `ROUND ${duel.round}`, color: rgb[0],
        scale: 1.25 - 0.25 * smooth(Math.min(1, local * 3)), alpha: Math.min(1, local * 6) * (1 - 0.5 * local) };
    }
    if (phase === 'race' && time < 0.7) {
      return { words: 'GO', sub: `ROUND ${duel.round}`, color: rgb[0], scale: 1 + time * 0.3, alpha: 1 - time / 0.7 };
    }
    if (phase === 'crash' && time > 0.35) {
      const alpha = Math.min(1, (time - 0.35) * 4);
      const loser = duel.lastLoser;
      if (loser === 'both') return { words: 'DEREZZED', sub: 'BOTH DOWN // RIDE AGAIN', color: rgb[0], scale: 0.55, alpha };
      const winnerIndex = loser === 'player' ? 1 : 0;
      return { words: `${loser === 'player' ? playerName : cluName} DEREZZED`,
        sub: `+1 ${TEAM_NAMES[winnerIndex === 0 ? playerTeam : 1 - playerTeam]}`, color: rgb[winnerIndex], scale: 0.5, alpha };
    }
    if (phase === 'result' || phase === 'over' || state === 'exit') {
      const won = duel.winner === 'player';
      const name = won ? playerName : cluName;
      return { words: `${name} WINS`, sub: `${TEAM_NAMES[0]} ${duel.score[playerTeam === 0 ? 0 : 1]} : ${duel.score[playerTeam === 0 ? 1 : 0]} ${TEAM_NAMES[1]}`,
        color: rgb[won ? 0 : 1], scale: 0.62, alpha: Math.min(1, time * 3) };
    }
    return null;
  }

  function hudInfo(rect, pipProgress, swoop, exit) {
    const reading = handlebars.state;
    const player = duel.player;
    const accent = rgb[0];
    const shown = hands.list.filter((hand) => hand.landmarks);
    const both = hands.left.visible && hands.right.visible && hands.left.landmarks && hands.right.landmarks;
    const phase = duel.phase;
    const info = {
      alpha: state === 'swoop' ? smooth(clamp((swoop - 0.5) * 2, 0, 1)) : state === 'exit' ? Math.max(0, 1 - exit * 2.5) : 1,
      pip: {
        rect,
        cover: smooth(clamp((pipProgress - 0.55) / 0.45, 0, 1)),
        frame: smooth(clamp((pipProgress - 0.7) / 0.3, 0, 1)),
        accent,
        hands: shown.map((hand) => hand.landmarks),
        grip: both ? {
          palms: [palmOf(hands.left), palmOf(hands.right)],
          gripping: reading.gripping,
          tilt: reading.tilt ?? 0,
          throttle: reading.throttle,
          brake: reading.brake,
        } : null,
      },
      score: {
        round: duel.round,
        winScore: duel.winScore,
        teams: [0, 1].map((team) => {
          const mine = team === playerTeam;
          return { name: TEAM_NAMES[team], rgb: rgb[mine ? 0 : 1], score: duel.score[mine ? 0 : 1], you: mine };
        }),
      },
      gauges: phase === 'result' || phase === 'over' ? null : {
        speed: player.alive ? player.speed : 0,
        speedFraction: (player.alive ? player.speed : 0) / (BIKE.boost * 1.25),
        boosting: phase === 'race' && input.throttle > 0.7 && !input.brake,
        braking: phase === 'race' && input.brake,
        steer: player.steer,
        gripping: reading.gripping,
        keys: usingKeys,
        accent,
      },
      // after a moment without a grip, so tracker dropouts don't make it flicker
      hint: (phase === 'countdown' || phase === 'race') && noGrip > 0.5 && !usingKeys
        ? { reason: reading.hint, accent } : null,
      banner: banner(),
    };
    if (state === 'powerdown') {
      // a flicker, then the whole HUD switches off
      const t = stateTime - POWER_DOWN.hud;
      info.collapse = clamp(t / POWER_DOWN.hudCollapse, 0, 1);
      if (t < 0 && t > -0.2) info.alpha = Math.sin(seconds * 90) > 0 ? 1 : 0.2;
      info.hint = null;
      info.pip.frame = Math.min(info.pip.frame, info.collapse > 0 ? 1 - info.collapse : 1);
    }
    return info;
  }

  // END OF LINE: when each bike goes out, and the seed of its flicker
  const offAt = [0, 0];
  function powerDown() {
    sound.engine(0);
    for (let index = 0; index < 2; index++) {
      const [from, to] = POWER_DOWN.bikes;
      offAt[index] = seconds + from + Math.random() * (to - from);
    }
    setState('powerdown');
  }

  function updateScene(dt, power, riderPower) {
    const rezz = [0, 1].map((index) => Math.max(0, seconds - rezzStart[index]));
    for (let index = 0; index < 2; index++) if (fades[index] !== null) fades[index] += dt;
    rideScene.update({ riders: duel.riders, rezz, fades, colors, power, riderPower, seconds, dt });
  }

  const api = {
    // the arena is on screen (the AR layer isn't drawn)
    get covering() {
      return state === 'swoop' || state === 'duel' || state === 'exit' || state === 'powerdown';
    },
    // a ride is under way, from the mount on: the AR gestures are off
    get busy() {
      return state !== 'off';
    },
    get state() {
      return state;
    },
    get model() {
      return rideScene.model;
    },
    counts,

    // A cycle rezzed from a baton; team: its team index; pose(): where it
    // shows on screen now (cycles.screenPose()); dismount(): takes the AR
    // cycle away once the arena has taken over.
    mount(cycle, team, { pose = null, dismount = null } = {}) {
      if (state !== 'off' || endOfLine.active) return false;
      setTeams(team);
      mounted = { cycle, pose, dismount, since: seconds };
      setState('mount');
      return true;
    },
    // the unseen warm-up frame; call before drawing the AR frame
    warmup() {
      if (warm !== 'compiled' || state !== 'off') return;
      warm = 'done';
      duel = createDuel({ random: seededRandom(1) });
      duel.start();
      rideCamera.setAspect(view.aspect);
      rideCamera.snapBehind(duel.player);
      // mid-rezz, so the hologram's shaders are made too, and a voxel
      rezzStart[0] = rezzStart[1] = seconds - 0.8;
      rideScene.voxels.spawn(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), colors[0], { life: 0.05 });
      updateScene(1 / 60, 1, [1, 1]);
      finish.set({ time: seconds, speed: 0.5, flash: 0, dissolve: 0, power: 1 });
      composer.render();
      duel = null;
      rideScene.voxels.clear();
    },
    // straight in, without a baton (R, ?ride)
    startNow(team = 0) {
      if (state !== 'off' || endOfLine.active) return false;
      setTeams(team);
      mounted = null;
      beginSwoop(null);
      return true;
    },
    // back to nothing, at once (a fresh Grid)
    reset() {
      state = 'off';
      duel = null;
      mounted = null;
      pip.set(null);
      hud.clear();
      sound.engine(0);
      rideScene.voxels.clear();
    },

    update(time, dt) {
      seconds = time;
      stateTime += dt;
      flash = Math.max(0, flash - dt * 2.2);
      if (state === 'off') return;
      // END OF LINE: the Grid powers down, the arena with it
      if (endOfLine.active && state !== 'powerdown') {
        if (state === 'mount') {
          this.reset();
          return;
        }
        powerDown();
      }
      if (state === 'powerdown') {
        if (stateTime >= POWER_DOWN.handOver) {
          this.reset();
          return;
        }
        rideCamera.drift(dt);
        const light = endOfLine.light();
        updateScene(dt, light.floor, offAt.map((at, index) => lightPower(at, seconds, index * 3.1)));
        return;
      }
      if (state === 'mount') {
        // hop on once the bike is built (or if it's gone)
        const cycle = mounted?.cycle;
        const age = cycle ? time - mounted.since : Infinity;
        if (!cycle || cycle.state === 'gone' || age >= REZZ.length) {
          const pose = mounted?.pose?.() ?? null;
          beginSwoop(pose);
          mounted?.dismount?.();
        }
        return;
      }
      if (state === 'swoop') {
        rideCamera.swoop(duel.player, stateTime / MATCH.swoop);
        if (stateTime >= MATCH.swoop) setState('duel');
      } else if (state === 'duel') {
        if (demoMode()) {
          // The demo plays back one fixed 60 Hz step per frame at most: its
          // scripted hands follow the duel, so they and CLU meet the same
          // way every time. Below 60 fps the ride runs slower instead.
          demoClock = Math.min(DEMO_STEP, demoClock + dt);
          if (demoClock >= DEMO_STEP * 0.75) {
            demoClock -= DEMO_STEP;
            readInput(DEMO_STEP);
            duel.update(DEMO_STEP, input);
          }
        } else {
          readInput(dt);
          duel.update(dt, input);
        }
        handleEvents();
        updateCamera(dt);
        sound.engine(duel.phase === 'race' && duel.player.alive ? duel.player.speed : 0);
        if (duel.phase === 'over') {
          sound.engine(0);
          setState('exit');
        }
      } else if (state === 'exit') {
        rideCamera.orbit(seconds, dt);
        if (stateTime >= MATCH.exit) {
          this.reset();
          onExit?.();
          return;
        }
      }
      updateScene(dt, 1, [1, 1]);
    },

    render() {
      const exit = state === 'exit' ? clamp(stateTime / MATCH.exit, 0, 1) : 0;
      const player = duel.player;
      const speedFactor = duel.phase === 'race' && player.alive
        ? clamp((player.speed - BIKE.cruise * 1.02) / (BIKE.boost - BIKE.cruise), 0, 1) : 0;
      const power = state === 'powerdown' ? Math.max(0, 1 - stateTime / POWER_DOWN.handOver) ** 0.5 : 1;
      finish.set({ time: seconds, speed: state === 'powerdown' ? 0 : speedFactor, flash, dissolve: exit, power });
      composer.render();
      this.drawHud(exit);
    },

    drawHud(exit) {
      const swoop = state === 'swoop' ? clamp(stateTime / MATCH.swoop, 0, 1) : 1;
      const pipProgress = state === 'exit' ? 1 - exit : swoop;
      pipShown = pipProgress > 0.8 ? 1 : 0;
      const rect = pipRect(pipProgress);
      pip.set(pipProgress >= 1e-3 ? rect : null, view.width);
      hud.draw(hudInfo(rect, pipProgress, swoop, exit), seconds);
    },

    resize(width, height, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
      finish.setSize(width * pixelRatio, height * pixelRatio);
      rideCamera.setAspect(width / Math.max(1, height));
      hud.resize(width, height);
    },

    // the camera behind the arena: graded like the Grid, a little brighter
    // for the picture in the corner; dimmed with the Grid by END OF LINE
    get cameraFilter() {
      if (endOfLine.active) return cssFilter(endOfLine.brightness());
      // as in the AR view while the picture is big, brighter once it is in the corner
      return cssFilter(GRADE.brightness + (PIP_BRIGHTNESS - GRADE.brightness) * pipShown);
    },

    // What the demo's hands on the handlebars should do (demo.js): null
    // when not riding; away: they have let go (the match is over).
    demoInput() {
      if (state === 'off') return null;
      const phase = duel?.phase;
      const away = state === 'exit' || phase === 'result' || phase === 'over';
      demoSteer.steer = 0;
      demoSteer.throttle = 0.5;
      demoSteer.brake = false;
      demoSteer.away = away;
      if (state === 'duel' && phase === 'race' && duel.player.alive) {
        const suggestion = duel.autopilot();
        demoSteer.steer = suggestion.steer;
        demoSteer.throttle = suggestion.throttle;
        demoSteer.brake = suggestion.brake;
      }
      return demoSteer;
    },

    stats() {
      return {
        ride: state,
        ridePhase: duel?.phase ?? null,
        rideScore: duel ? duel.score.join(':') : null,
        rideRound: duel?.round ?? 0,
        rideWarm: warm,
        rideCounts: { ...counts },
        rideGrip: state === 'off' ? null
          : `${handlebars.state.gripping ? 'grip' : handlebars.state.hint} steer ${input.steer.toFixed(2)} thr ${input.throttle.toFixed(2)}`,
      };
    },
  };
  return api;
}
