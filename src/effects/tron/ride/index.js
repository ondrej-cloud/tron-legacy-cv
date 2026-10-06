// Ride mode: a light cycle duel against CLU, steered with both hands held
// like handlebars (src/handlebars.js).
//
//   mount     a light baton pulled apart rezzes a cycle between the hands,
//             its back to the camera (controls.js, cycles.js) ...
//   swoop     ... and while it is still rezzing the user hops on: the arena's
//             camera takes over exactly where the AR one was, then pushes
//             forwards and down into the seat while the room fades into the
//             arena and the webcam shrinks into a corner
//   ready     the first time with the camera: the grip tutorial, until both
//             hands hold the handlebars steadily (tutorial.js)
//   duel      rounds of 3-2-1, race, derezz (duel.js), each derezz replayed
//             in slow motion (killcam.js), until one side has won; then the
//             TRON WINS / CLU WINS screen, which waits for the player: both
//             palms open (or R) for a rematch, both fists together (or
//             Escape) for END OF LINE, 1, 2 or 3 fingers (or keys) for the
//             next match's difficulty (result.js); personal bests (bests.js)
//   exit      the arena derezzes and the camera image grows back: the AR
//             Grid boots again (demo mode, or nobody left in view)
//
// While riding, a radar and a marker on CLU (an arrow at the screen's edge
// when it is off screen) keep the player aware of where CLU is, and a
// rear-view mirror comes up while they brake or hold B.
//
// END OF LINE (two fists together) still works while riding: the arena
// powers down with the rest of the Grid and the app returns to the intro.
// Arrow keys steer too (up: throttle, down: brake), and R (or ?ride in the
// URL) starts a ride without the baton: mouse mode, screenshots.
//
// The parts: rules.js (tuning), arena.js, stadium.js and terrain.js (the
// scene and its ground), rider.js (a cycle's motion and walls), brain.js
// (CLU, and the demo's autopilot), duel.js (rounds, scoring, the match's
// numbers), replay.js and killcam.js (crash replays), result.js, scene.js
// (bikes, jetwalls, voxels), camera.js, finish.js (speed lines, flashes,
// the replay's look, the exit's derezz), hud.js, mirror.js, pip.js (the
// webcam in a corner), tutorial.js, bests.js and sound.js.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createHandlebars } from '../../../handlebars.js';
import { GRADE, cssFilter } from '../grade.js';
import { END_OF_LINE, lightPower } from '../endofline.js';
import { createRideScene } from './scene.js';
import { createRideCamera } from './camera.js';
import { createFinishPass } from './finish.js';
import { createRideHud } from './hud.js';
import { createPip } from './pip.js';
import { createRideSound } from './sound.js';
import { createDuel } from './duel.js';
import { createKillcam } from './killcam.js';
import { createResult } from './result.js';
import { createMirror, mirrorRect } from './mirror.js';
import { seededRandom } from './brain.js';
import { createTutorial } from './tutorial.js';
import { createBests } from './bests.js';
import { ARENA, BIKE, LEVELS, MATCH } from './rules.js';
import { features } from './terrain.js';

const PIP = { width: 0.19, minWidth: 220, maxWidth: 340, margin: 24 };
const DEMO_SEED = 1155;
const DEMO_STEP = 1 / 60;
// ?autopilot (or ?autopilot=<seed>): the demo's autopilot rides your cycle;
// ?rounds=<n>: first to n rounds wins (both for trying things out)
const QUERY = new URLSearchParams(location.search);
const AUTOPILOT = QUERY.get('autopilot');
const ROUNDS = Number.parseInt(QUERY.get('rounds'), 10);
const SETTLE = 1.4;              // s after GO over which the camera eases from the seat into the chase
// Without a baton the entry starts as if there had been one, held in the
// middle of the frame: the camera behind the bike and a little above it,
// in bike lengths in the bike's frame (x forward, y up), facing along it.
const DEFAULT_MOUNT = {
  position: new THREE.Vector3(-1.75, 0.55, 0),
  quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0))
    .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, 0, 0))),
  fov: 50,
  shift: { x: 0, y: 0 },
};
const PIP_BRIGHTNESS = 0.75;     // the camera picture is graded like the Grid, a bit brighter
const BLOOM = { strength: 0.85, radius: 0.35, threshold: 0.55 };
// END OF LINE while riding: the bikes go out about here (s after the fists),
// the HUD switches off, and the arena hands over to the dark AR layer once
// its horizon would have gone out too
const POWER_DOWN = { bikes: [0.3, 0.9], hud: 0.45, hudCollapse: 0.3, handOver: END_OF_LINE.dot[1] };

// the radar zooms out to keep CLU on it, within these ranges (m to its rim)
const RADAR_RANGE = { min: 70, max: 230, margin: 1.3, ease: 0.6 };
const CLOSE = 35;                // m: CLU this near pulses on the radar and the screen's edge
const LOOK_BACK = 0.35;          // s of braking before the rear-view mirror comes up
const WARM_AFTER = 2.5;          // s after the start before the warm-up: the page's own start-up keeps the GPU busy

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smooth = (t) => t * t * (3 - 2 * t);
// s as m:ss
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

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
  const sound = createRideSound(host?.sfx);
  const handlebars = createHandlebars();
  const killcam = createKillcam({ rideScene, rideCamera, sound });
  const result = createResult(hands);
  const tutorial = createTutorial();
  const bests = createBests();
  const mirror = createMirror(renderer);
  const keys = { left: false, right: false, up: false, down: false, back: false, lastMs: -Infinity };
  const demoMode = () => hands.mode === 'demo';
  // the autopilot rides: in demo mode (the scripted fists show what it does) or with ?autopilot
  const autopiloted = () => demoMode() || AUTOPILOT !== null;

  let state = 'off';
  let stateTime = 0;
  let seconds = 0;
  let duel = null;
  let playerTeam = 0;
  const colors = [new THREE.Color(), new THREE.Color()];
  const rgb = ['', ''];
  let mounted = null;          // { cycle, view, dismount, since }
  let entryHold = 0;           // s the entry waits before pushing in (a bike rezzing in the arena)
  let flash = 0;
  let noGrip = 0;              // s without a grip
  let usingKeys = false;       // the arrow keys are steering
  const rezzStart = [0, 0];    // when each bike started to rezz (seconds)
  const fades = [null, null];
  let crashPoint = null;
  let roundSwoop = false;      // the camera dives in behind the bike during a countdown
  let rematch = false;         // the next round 1 is a rematch (the bikes rezz as between rounds)
  let replay = null;           // the kill-cam's view while a crash is replayed (killcam.js)
  let choice = null;           // what the player chose on the result screen
  let level = bests.level;     // the difficulty the next match is ridden at (LEVELS)
  let matchLevel = level;      // ... and this one
  let beaten = null;           // the personal bests this match beat: { fastest, topSpeed }
  let warned = false;          // the proximity ping has sounded (until CLU is further off again)
  let replayLook = 0;          // how much the frame looks like a replay (finish.js)
  let showcaseCut = false;     // the result has just come up: cut to the winner
  let braking = 0;             // s the player has been braking
  let lookBack = 0;            // the rear-view mirror: 0 hidden .. 1 up
  let pipShown = 0;            // 1 once the camera picture is in its corner
  let demoClock = 0;
  const counts = { rides: 0, rounds: 0, crashes: 0 };
  const input = { steer: 0, throttle: 0.5, brake: false, idle: false };
  let radarRange = RADAR_RANGE.min;
  const probe = new THREE.Vector3();
  const demoSteer = { steer: 0, throttle: 0.5, brake: false, away: false };

  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[event.key];
    const atResult = state === 'duel' && duel?.phase === 'result';
    if (key) {
      event.preventDefault();
      if (state === 'duel') keys[key] = true;
    } else if (event.key.toLowerCase() === 'r' && state === 'off') {
      api.startNow(teams.right.index);
    } else if (event.key.toLowerCase() === 'r' && atResult) {
      result.key('rematch');
    } else if (event.key === 'Escape' && atResult) {
      result.key('exit');
    } else if (['1', '2', '3'].includes(event.key) && atResult) {
      result.pickLevel(Number(event.key) - 1);
    } else if (event.key.toLowerCase() === 'b' && state === 'duel') {
      keys.back = true;
    }
  });
  window.addEventListener('keyup', (event) => {
    if (event.key.toLowerCase() === 'b') keys.back = false;
    const key = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[event.key];
    if (!key) return;
    keys[key] = false;
    keys.lastMs = performance.now();
  });

  // Shaders, render targets and the GPU's pipelines are made on first use,
  // which stalls the frame. So while the AR Grid is still on screen, what
  // the ride draws is made ahead, unseen, a step per frame (warmup(); the
  // AR frame is drawn over whatever a step renders): the arena's shaders
  // compile in the background once it has loaded; then two cycles are set
  // out mid-rezz with a voxel, and theirs (and the finish pass's) compile
  // in the background too; then the composer's buffers are allocated; the
  // scene is drawn into them; the whole frame goes through the passes; and
  // last the rear-view mirror.
  let warm = 'loading';        // then 'warming' (a step at a time), then 'done'
  let warmStep = 0;
  let warmBusy = false;        // a step is waiting for the compiler
  let staged = null;           // the warm-up's duel
  let pendingStart = null;     // a ride asked for before the warm-up was done: its team
  // the finish pass's shader on a quad in the scene, to be compiled with it
  const finishQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), finish.pass.material);
  finishQuad.frustumCulled = false;
  let warmSteps = [];
  // the steps, once everything is in the scene
  const makeWarmSteps = () => [
    () => {
      staged = createDuel({ random: seededRandom(1) });
      staged.start();
      rideCamera.setAspect(view.aspect);
      rideCamera.snapBehind(staged.player);
      // mid-rezz, so the hologram's shaders are made too, and a voxel
      rideScene.voxels.spawn(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), colors[0], { life: 0.05 });
      rideScene.update({ riders: staged.riders, rezz: [0.8, 0.8], fades: [null, null], colors, power: 1,
        riderPower: [1, 1], seconds, dt: 1 / 60 });
      rideScene.scene.add(finishQuad);
      return compileUnseen().finally(() => rideScene.scene.remove(finishQuad));
    },
    () => {
      for (const target of [composer.renderTarget1, composer.renderTarget2, bloom.renderTargetBright,
        ...bloom.renderTargetsHorizontal, ...bloom.renderTargetsVertical]) renderer.initRenderTarget(target);
    },
    // the scene, a part of it per frame
    () => drawUnseen([]),
    ...rideScene.scene.children.map((part) => () => drawUnseen([part])),
    () => drawUnseen(),
    () => {
      finish.set({ time: seconds, speed: 0.5, flash: 0, dissolve: 0, power: 1 });
      composer.render();
    },
    () => {
      mirror.render(rideScene.scene, staged.player, mirrorRect(view.width), view.height, 1);
      staged = null;
      rideScene.voxels.clear();
    },
  ];
  // draws the scene into the composer's buffer: all of it, or only `parts` of it
  function drawUnseen(parts = null) {
    const hidden = parts ? rideScene.scene.children.filter((child) => !parts.includes(child) && child.visible) : [];
    for (const child of hidden) child.visible = false;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(composer.renderTarget1);
    renderer.render(rideScene.scene, camera);
    renderer.setRenderTarget(previous);
    for (const child of hidden) child.visible = true;
  }
  function compileUnseen() {
    // into a half-float target, as the composer renders: the same shader variants
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    const compiled = renderer.compileAsync(rideScene.scene, camera);
    renderer.setRenderTarget(previous);
    return compiled.finally(() => target.dispose());
  }
  Promise.all([rideScene.ready, rideScene.arena.stadiumReady])
    .then(compileUnseen)
    .then(() => {
      // (unless a ride has already begun, and warmed up as it went)
      if (warm !== 'loading') return;
      warmSteps = makeWarmSteps();
      warm = 'warming';
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

  // The user hops on: the arena takes over from the AR view. `mountView`
  // (cycles.mountView()) says where the AR camera was as seen from the
  // baton's cycle; the arena's camera starts in the same place relative to
  // the arena's bike, with the same lens, so the bike stays put on screen,
  // then pushes forwards and down into the seat while the room fades into
  // the arena around it. Without a baton (R, ?ride) the bike rezzes in the
  // arena first, seen from behind as if it had come from a baton.
  function beginSwoop(mountView) {
    const seed = Number.parseInt(AUTOPILOT, 10);
    duel = createDuel({
      // the demo plays the same match every time (one its rider wins)
      random: seededRandom(demoMode() ? DEMO_SEED : Number.isFinite(seed) ? seed : (Math.random() * 1e9) >>> 0),
      winScore: demoMode() ? MATCH.demoWinScore : ROUNDS > 0 ? ROUNDS : MATCH.winScore,
      difficulty: demoMode() ? MATCH.demoDifficulty : LEVELS[level].difficulty,
      playerTeam,
    });
    matchLevel = level;
    beaten = null;
    killcam.stop();
    replay = null;
    choice = null;
    rematch = false;
    duel.start();
    // Not warmed up yet (a ride straight after loading): what the ride will
    // only show later (the cycles mid-rezz, the voxels of a crash or a hard
    // landing, the finish pass) compiles in the background while the camera
    // swoops in. The next frame's update puts the scene back as it should be.
    if (warm !== 'done') {
      warm = 'done';
      staged = null;
      rideScene.voxels.clear();
      // a voxel out of sight under the floor, gone in a moment
      rideScene.voxels.spawn(new THREE.Vector3(0, -50, 0), new THREE.Vector3(0, -60, 0), colors[0], { life: 0.05 });
      rideScene.update({ riders: duel.riders, rezz: [0.8, 0.8], fades: [null, null], colors, power: 1,
        riderPower: [1, 1], seconds, dt: 0 });
      rideScene.scene.add(finishQuad);
      compileUnseen().finally(() => rideScene.scene.remove(finishQuad));
      mirror.compile();
    }
    // the first ride with the camera waits for a steady grip before the countdown
    if (hands.mode === 'camera' && !autopiloted() && tutorial.wanted) {
      duel.hold();
      tutorial.start();
    }
    // the player's bike goes on rezzing from where the AR one had got to
    rezzStart[0] = seconds - (mountView?.age ?? 0);
    rezzStart[1] = Infinity;           // CLU's rezzes with the countdown
    fades[0] = fades[1] = null;
    rideScene.voxels.clear();
    rideCamera.setAspect(view.aspect);
    const player = duel.player;
    const bike = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -player.heading, 0));
    const tail = new THREE.Vector3(player.x, player.y ?? 0, player.z);
    const local = mountView ?? DEFAULT_MOUNT;
    const position = local.position.clone().multiplyScalar(BIKE.length).applyQuaternion(bike).add(tail);
    position.y = Math.max(position.y, tail.y + 0.4);
    rideCamera.startEntry({ position, quaternion: bike.multiply(local.quaternion), fov: local.fov, shift: local.shift });
    entryHold = mountView ? 0 : MATCH.hopOn;
    demoClock = 0;
    roundSwoop = false;
    host?.sfx?.enterGrid();
    counts.rides++;
    setState('swoop');
  }

  // how far into the push from the AR view into the seat (0..1)
  const entryProgress = () => clamp((stateTime - entryHold) / MATCH.swoop, 0, 1);

  function readInput(dt) {
    const reading = handlebars.update(hands, dt, view.aspect);
    if (autopiloted()) {
      // the autopilot's own steering: the same every time, however the
      // scripted fists read back
      noGrip = 0;
      usingKeys = false;
      if (duel.phase === 'race' && duel.player.alive) Object.assign(input, duel.autopilot(), { idle: false });
      else Object.assign(input, { steer: 0, throttle: 0.5, brake: false, idle: false });
      return;
    }
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

  // Before the first countdown with the camera: the grip tutorial, until
  // both hands hold the handlebars steadily. The arrow keys (or leaving
  // camera mode) skip it.
  function readyUp(dt) {
    if (keys.left || keys.right || keys.up || keys.down || hands.mode !== 'camera') {
      tutorial.skip();
      duel.go();
      return;
    }
    const step = tutorial.update(hands, dt, view.aspect);
    // the moment the grip settles is where the throttle's neutral is
    if (step === 'locked') {
      handlebars.recalibrate();
      sound.tick(3);
    } else if (step === 'go') {
      duel.go();
    }
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
        killcam.stop();
        replay = null;
        // round 1: CLU rezzes now; later rounds (and a rematch) both bikes rezz
        rezzStart[1] = seconds;
        if (event.round > 1 || rematch) {
          rematch = false;
          rideScene.voxels.clear();
          // watch the bike rezz from beside it, then dive in behind it
          rezzStart[0] = seconds;
          const player = duel.player;
          const middle = new THREE.Vector3(player.x + player.forwardX * BIKE.length / 2, (player.y ?? 0) + 0.6,
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
        crashPoint = new THREE.Vector3(event.x, (event.rider.y ?? 0) + 0.6, event.z);
        killcam.start(duel, duel.crash?.final ? MATCH.finalHold : MATCH.crashHold);
        // our own crash happens right in front of the camera; CLU's gets a cut
        if (index === 1) rideCamera.cutTo(crashPoint, event.heading);
        rideCamera.kick(index === 0 ? 0.6 : 0.25);
        flash = Math.max(flash, index === 0 ? 0.3 : 0.18);
        sound.crash();
        counts.crashes++;
      } else if (event.type === 'result') {
        log(`ride result ${event.winner}`);
        sound.win(event.winner === 'player');
        killcam.stop();
        replay = null;
        result.start(matchLevel);
        showcaseCut = true;
        // the autopilot's matches aren't the player's
        if (!autopiloted()) {
          beaten = bests.record({ level: matchLevel, won: event.winner === 'player', time: duel.stats.time,
            topSpeed: duel.stats.topSpeed });
        }
      } else if (event.type === 'mode') {
        log(`ride clu ${event.mode}`);
      } else if (event.type === 'jump' && event.rider === duel.player) {
        sound.jump();
      }
    }
  }

  function updateCamera(dt) {
    const player = duel.player;
    const phase = duel.phase;
    if (phase === 'result' || phase === 'over') {
      const winner = duel.winner === 'clu' ? duel.clu : player;
      if (winner.alive) rideCamera.showcase(winner, seconds, dt, showcaseCut);
      else rideCamera.orbit(seconds, dt);
      showcaseCut = false;
    } else if (phase === 'crash' && replay) {
      // the kill-cam has placed the camera
    } else if (phase === 'crash' && crashPoint) {
      rideCamera.watch(crashPoint, dt);
    } else if (phase === 'countdown' && roundSwoop) {
      rideCamera.swoop(player, duel.phaseTime / (MATCH.countdown * 0.7));
    } else {
      roundSwoop = false;
      const speedFactor = (player.speed - BIKE.cruise) / (BIKE.boost - BIKE.cruise);
      // in the seat for the countdown, easing back into the chase once it's going
      const blend = phase === 'race' ? smooth(clamp(duel.phaseTime / SETTLE, 0, 1)) : 0;
      rideCamera.follow(player, dt, phase === 'race' ? speedFactor : -0.15, blend);
    }
  }

  // the result screen: rematch, END OF LINE or back to the Grid
  function updateResult(dt) {
    if (duel.phase !== 'result' || choice) return;
    choice = result.update(dt, { demo: demoMode(), aspect: view.aspect });
    if (!choice) return;
    log(`ride choice ${choice}`);
    // the difficulty chosen counts for the next match, now or later
    if (!demoMode() && result.level !== level) {
      level = result.level;
      bests.level = level;
      log(`ride level ${LEVELS[level].name.toLowerCase()}`);
    }
    if (choice === 'rematch') {
      choice = null;
      rematch = true;
      handlebars.recalibrate();
      duel.rematch(demoMode() ? MATCH.demoDifficulty : LEVELS[level].difficulty);
      matchLevel = level;
      beaten = null;
      sound.rematch();
    } else if (choice === 'exit') {
      endOfLine.start({ x: 0, y: 0 });
    } else {
      duel.finish();
    }
  }

  // The radar and the marker on CLU (hud.js): where CLU is, relative to
  // the player and on screen.
  function awareness(dt) {
    const player = duel.player;
    const clu = duel.clu;
    const distance = Math.hypot(clu.x - player.x, clu.z - player.z);
    const wanted = clamp(distance * RADAR_RANGE.margin, RADAR_RANGE.min, RADAR_RANGE.max);
    radarRange += (wanted - radarRange) * (1 - Math.exp(-dt / RADAR_RANGE.ease));
    // CLU's middle, a little above the floor, in the camera's view
    probe.set(clu.x + clu.forwardX * BIKE.length * 0.5, (clu.y ?? 0) + 0.9, clu.z + clu.forwardZ * BIKE.length * 0.5);
    probe.applyMatrix4(camera.matrixWorldInverse);
    const behind = probe.z > 0 || Math.atan2(Math.hypot(probe.x, probe.y), -probe.z) > 1.75;
    const inFront = probe.z < -0.5;
    let x = 0;
    let y = 0;
    let onScreen = false;
    if (inFront) {
      probe.applyMatrix4(camera.projectionMatrix);
      onScreen = Math.abs(probe.x) < 0.94 && Math.abs(probe.y) < 0.9;
      x = (probe.x + 1) / 2 * view.width;
      y = (1 - probe.y) / 2 * view.height;
    }
    if (!onScreen) {
      // towards it from the middle of the screen (behind: towards the bottom)
      probe.set(clu.x, (clu.y ?? 0) + 0.9, clu.z).applyMatrix4(camera.matrixWorldInverse);
      const length = Math.hypot(probe.x, probe.y) || 1;
      x = view.width / 2 + (probe.x / length) * view.width;
      y = view.height / 2 - (probe.y / length) * view.height;
    }
    const close = distance < CLOSE;
    return {
      radar: { player, clu, range: radarRange, half: ARENA.half, features, accent: rgb[0], enemy: rgb[1], close, distance },
      tracker: clu.alive ? { x, y, onScreen, distance, behind: behind && !onScreen, close, color: rgb[1] } : null,
    };
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
    if (phase === 'crash' && time > 0.35 && !replay) {
      const alpha = Math.min(1, (time - 0.35) * 4);
      const loser = duel.lastLoser;
      if (loser === 'both') return { words: 'DEREZZED', sub: 'BOTH DOWN // RIDE AGAIN', color: rgb[0], scale: 0.55, alpha };
      const winnerIndex = loser === 'player' ? 1 : 0;
      return { words: `${loser === 'player' ? playerName : cluName} DEREZZED`,
        sub: `+1 ${TEAM_NAMES[winnerIndex === 0 ? playerTeam : 1 - playerTeam]}`, color: rgb[winnerIndex], scale: 0.5, alpha };
    }
    return null;
  }

  // the result screen: who won, the score, the match's numbers and the choices
  function resultInfo() {
    const won = duel.winner === 'player';
    const stats = duel.stats;
    const charge = result.info;
    const fastest = bests.all.levels[matchLevel].fastest;
    return {
      time: charge.time,
      title: `${won ? TEAM_NAMES[playerTeam] : TEAM_NAMES[1 - playerTeam]} WINS`,
      sub: won ? 'THE GRID IS YOURS' : 'DEREZZED BY THE PROGRAM',
      color: rgb[won ? 0 : 1],
      accent: rgb[0],
      enemy: rgb[1],
      score: [duel.score[0], duel.score[1]],
      names: [TEAM_NAMES[playerTeam], TEAM_NAMES[1 - playerTeam]],
      stats: [
        ['TIME', clock(stats.time)],
        ['TOP SPEED', `${Math.round(stats.topSpeed * 3.6)} KM/H`],
        ['JUMPS', String(stats.jumps)],
        ['CLOSEST CALL', Number.isFinite(stats.closest) ? `${stats.closest.toFixed(1)} M` : '-'],
      ],
      rematch: charge.rematch,
      endOfLine: Math.max(charge.endOfLine, endOfLine.active ? 1 : 0),
      demo: demoMode() ? Math.max(0, MATCH.demoResultHold - charge.time) : null,
      // the next match's difficulty, and the player's own bests (not the autopilot's)
      levels: demoMode() ? null : {
        names: LEVELS.map((entry) => entry.name),
        records: bests.all.levels.map((entry) => `${entry.wins} W  ${entry.losses} L`),
        current: charge.level,
        changed: charge.levelChanged,
        pending: charge.pending,
      },
      bests: autopiloted() ? null : [
        { label: `FASTEST WIN  ·  ${LEVELS[matchLevel].name}`, value: fastest ? clock(fastest) : '-', fresh: Boolean(beaten?.fastest) },
        { label: 'TOP SPEED EVER', value: `${Math.round(bests.all.topSpeed * 3.6)} KM/H`, fresh: Boolean(beaten?.topSpeed) },
      ],
    };
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
      gauges: phase === 'result' || phase === 'over' || phase === 'ready' ? null : {
        speed: player.alive ? player.speed : 0,
        speedFraction: (player.alive ? player.speed : 0) / (BIKE.boost * 1.25),
        boosting: phase === 'race' && input.throttle > 0.7 && !input.brake,
        braking: phase === 'race' && input.brake,
        airborne: phase === 'race' && player.alive && Boolean(player.airborne),
        steer: player.steer,
        gripping: reading.gripping,
        keys: usingKeys,
        accent,
      },
      // after a moment without a grip, so tracker dropouts don't make it flicker
      hint: (phase === 'countdown' || phase === 'race') && noGrip > 0.5 && !usingKeys
        ? { reason: reading.hint, accent } : null,
      banner: banner(),
      tutorial: phase === 'ready' && tutorial.active ? {
        ...tutorial.info,
        // the hands can't be seen before the tracker is up
        hint: hands.status === 'ready' ? tutorial.info.hint : 'STARTING THE HAND TRACKER',
        accent,
      } : null,
      replay: replay ? { progress: replay.progress, final: replay.final, speed: replay.speed } : null,
      mirror: state === 'duel' && lookBack > 0.01 ? { rect: mirrorRect(view.width), alpha: lookBack, accent } : null,
      result: phase === 'result' || phase === 'over' || state === 'exit' ? resultInfo() : null,
    };
    if (phase === 'countdown' || phase === 'race') Object.assign(info, awareness(1 / 60));
    // the replay and the result have the screen to themselves
    if (info.replay || info.result) info.gauges = info.hint = null;
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
    for (let index = 0; index < 2; index++) if (fades[index] !== null) fades[index] += dt;
    if (replay) {
      // the replay's ghosts, built, and the voxels flying in slow motion too
      rideScene.update({ riders: replay.riders, rezz: [Infinity, Infinity], fades: replay.fades, colors, power, riderPower,
        seconds, dt: dt * Math.min(1, replay.speed) });
      return;
    }
    const rezz = [0, 1].map((index) => Math.max(0, seconds - rezzStart[index]));
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
    mount(cycle, team, { view = null, dismount = null } = {}) {
      if (state !== 'off' || endOfLine.active) return false;
      pendingStart = null;
      setTeams(team);
      mounted = { cycle, view, dismount, since: seconds };
      setState('mount');
      return true;
    },
    // the next step of the warm-up (see warmSteps); call before drawing the AR frame
    warmup() {
      if (state === 'off' && warm === 'done' && pendingStart !== null) this.startNow(pendingStart);
      // (a ride waiting for it doesn't wait for the page to settle)
      if (state !== 'off' || warm !== 'warming' || warmBusy || (seconds < WARM_AFTER && pendingStart === null)) return;
      const pending = warmSteps[warmStep++]();
      if (warmStep >= warmSteps.length) warm = 'done';
      if (pending) {
        warmBusy = true;
        pending.finally(() => {
          warmBusy = false;
        });
      }
    },
    // straight in, without a baton (R, ?ride)
    startNow(team = 0) {
      if (state !== 'off' || endOfLine.active) return false;
      // straight after loading: the warm-up first, at full speed (warmup())
      if (warm === 'loading' || warm === 'warming') {
        pendingStart = team;
        return true;
      }
      pendingStart = null;
      setTeams(team);
      mounted = null;
      beginSwoop(null);
      return true;
    },
    // back to nothing, at once (a fresh Grid)
    reset() {
      state = 'off';
      pendingStart = null;
      duel = null;
      mounted = null;
      killcam.stop();
      replay = null;
      lookBack = braking = replayLook = 0;
      keys.back = false;
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
        // hop on once the bike has mostly rezzed (or if it's gone)
        const cycle = mounted?.cycle;
        const age = cycle ? time - mounted.since : Infinity;
        if (!cycle || cycle.state === 'gone' || age >= MATCH.hopOn) {
          const gone = !cycle || cycle.state === 'gone';
          beginSwoop(gone ? null : mounted.view?.() ?? null);
          mounted?.dismount?.();
        }
        return;
      }
      if (state === 'swoop') {
        rideCamera.entry(duel.player, entryProgress(), dt);
        if (stateTime >= entryHold + MATCH.swoop) setState('duel');
      } else if (state === 'duel') {
        if (autopiloted()) {
          // The autopilot plays back one fixed 60 Hz step per frame at most,
          // so it and CLU meet the same way every time (the demo's scripted
          // hands follow what it does). Below 60 fps the ride runs slower.
          demoClock = Math.min(DEMO_STEP, demoClock + dt);
          if (demoClock >= DEMO_STEP * 0.75) {
            demoClock -= DEMO_STEP;
            readInput(DEMO_STEP);
            duel.update(DEMO_STEP, input);
          }
        } else {
          readInput(dt);
          duel.update(dt, input);
          if (duel.phase === 'ready') readyUp(dt);
        }
        handleEvents();
        replay = duel.phase === 'crash' ? killcam.update(duel.phaseTime, dt, colors) : null;
        // looking back: B, or braking for a moment
        const racing = duel.phase === 'race' && duel.player.alive;
        braking = racing && input.brake ? braking + dt : 0;
        const looking = racing && (keys.back || braking > LOOK_BACK);
        lookBack += ((looking ? 1 : 0) - lookBack) * (1 - Math.exp(-dt / 0.08));
        if (duel.phase === 'race' && duel.clu.alive) {
          const distance = Math.hypot(duel.clu.x - duel.player.x, duel.clu.z - duel.player.z);
          if (distance < CLOSE && !warned) sound.warn();
          warned = distance < CLOSE * 1.5 && (warned || distance < CLOSE);
        }
        updateCamera(dt);
        updateResult(dt);
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
      // the arena lights up around the bike as the camera pushes in
      updateScene(dt, state === 'swoop' ? smooth(entryProgress()) : 1, [1, 1]);
    },

    render() {
      const exit = state === 'exit' ? clamp(stateTime / MATCH.exit, 0, 1) : 0;
      const player = duel.player;
      const speedFactor = duel.phase === 'race' && player.alive
        ? clamp((player.speed - BIKE.cruise * 1.02) / (BIKE.boost - BIKE.cruise), 0, 1) : 0;
      const power = state === 'powerdown' ? Math.max(0, 1 - stateTime / POWER_DOWN.handOver) ** 0.5 : 1;
      replayLook += ((replay ? 1 : 0) - replayLook) * 0.15;
      finish.set({ time: seconds, speed: state === 'powerdown' ? 0 : speedFactor, flash, dissolve: exit, replay: replayLook, power });
      composer.render();
      if (state === 'duel' && lookBack > 0.01) mirror.render(rideScene.scene, player, mirrorRect(view.width), view.height, lookBack);
      this.drawHud(exit);
    },

    drawHud(exit) {
      const swoop = state === 'swoop' ? entryProgress() : 1;
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
        rideWarm: warm === 'warming' ? `warming ${warmStep}/${warmSteps.length}` : warm,
        rideCounts: { ...counts },
        rideClu: duel ? `${duel.cluMode} ${JSON.stringify(duel.brains.clu.counts)}` : null,
        rideLevel: LEVELS[matchLevel].name,
        rideTutorial: tutorial.active ? `${tutorial.info.hint || 'steady'} ${tutorial.info.progress.toFixed(2)} t ${tutorial.info.time.toFixed(1)}` : null,
        rideSpin: duel ? duel.stats.spin.map((angle) => Math.round(angle * 180 / Math.PI)).join('/') : null,
        rideStats: duel ? `t ${duel.stats.time.toFixed(1)} top ${Math.round(duel.stats.topSpeed * 3.6)} jumps ${duel.stats.jumps} closest ${duel.stats.closest.toFixed(2)}` : null,
        rideGrip: state === 'off' ? null
          : `${handlebars.state.gripping ? 'grip' : handlebars.state.hint} steer ${input.steer.toFixed(2)} thr ${input.throttle.toFixed(2)}`,
      };
    },
  };
  return api;
}
