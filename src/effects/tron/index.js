// Tron: the Grid over your webcam. Hand gestures draw glass light walls,
// switch each hand between TRON and CLU colours, summon and throw identity
// discs that ricochet off the walls and each other, launch light cycles onto
// the Grid floor, swing a light baton that cuts walls and bats discs (pulled
// apart, it rezzes a light cycle), derezz what is around a fist, open a
// portal between the hands, digitize the person on camera with a laser
// (person segmentation), and shut the whole Grid down with END OF LINE; a
// holographic HUD shows what the hand tracker sees (the rules are in
// controls.js).
//
// The scene is flat, in "view units": the frame is 1 unit tall, x runs from
// -aspect/2 to +aspect/2, y points up, (0, 0) is the centre of the screen.
// Everything is additive light on black (the host screen-blends the layer
// over the camera), and bloom haloes the thin bright lines. The HUD is a 2D
// canvas on top, so its text and hairlines stay crisp.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createTeams } from './palette.js';
import { createStage } from './stage.js';
import { createLightWalls } from './walls.js';
import { createVoxels } from './voxels.js';
import { createFlashes } from './flashes.js';
import { createDiscs } from './disc.js';
import { createCycles } from './cycles.js';
import { createBatons } from './baton.js';
import { createDigitizer } from './digitize.js';
import { createEndOfLine, POWER_DOWN_LENGTH } from './endofline.js';
import { cssFilter } from './grade.js';
import { createControls } from './controls.js';
import { createHud } from './hud.js';
import { createDemo } from './demo.js';

export const meta = {
  title: 'Tron',
  hint: 'point: light wall · rock: switch colour · ok: identity disc, flick to throw · '
    + 'thumbs up: light cycle · peace: digitize · shaka: light baton · fist (hold): derezz · '
    + 'two fists together: end of line · both palms open: portal',
};

// s of darkness after END OF LINE before the Grid boots again in demo mode
const DEMO_DARKNESS = 0.5;

const RENDER = {
  bloom: { strength: 0.8, radius: 0.3, threshold: 0.6 },
  maxPixelRatio: 2,
  minPixelRatio: 1,
  targetFps: 50,          // median fps below this for 2 s -> lower pixel ratio
};

export function createEffect({ container, hands, host }) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, RENDER.maxPixelRatio);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 1);
  container.appendChild(renderer.domElement);

  const view = {
    width: window.innerWidth,
    height: window.innerHeight,
    aspect: window.innerWidth / Math.max(1, window.innerHeight),
    pixelRatio,
  };
  const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -10, 10);
  const scene = new THREE.Scene();

  let seconds = 0;
  const events = [];   // recent actions, for the stats
  const log = (name) => {
    events.push(`${seconds.toFixed(2)} ${name}`);
    if (events.length > 40) events.shift();
  };

  const teams = createTeams();
  const stage = createStage(view, teams);
  const walls = createLightWalls(view, teams);
  const voxels = createVoxels();
  const flashes = createFlashes(view);
  const batons = createBatons({ view, walls, voxels, flashes, log });
  const discs = createDiscs({ view, teams, walls, batons, stage, voxels, flashes, log });
  const cycles = createCycles({ view, teams, stage, voxels, flashes, log });
  const digitizer = createDigitizer({ hands, view, voxels, flashes, log });
  // the music dies with the lights (the host starts the Grid track again on
  // entering), the words are typed with key clicks and switch off with a click
  const endOfLine = createEndOfLine({
    log,
    onStart: () => host?.music?.fadeOut(POWER_DOWN_LENGTH),
    onKey: () => host?.sfx?.key(),
    onCollapse: () => host?.sfx?.crtOff(),
  });
  scene.add(stage.group, digitizer.group, cycles.group, walls.object, discs.group, batons.group, voxels.mesh, flashes.group);
  const controls = createControls({ hands, view, teams, walls, discs, cycles, batons, digitizer, endOfLine,
    voxels, flashes, stage, log });
  const hud = createHud(container, { hands, view, teams, controls, endOfLine });
  const demo = createDemo();

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const { strength, radius, threshold } = RENDER.bloom;
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), strength, radius, threshold));
  composer.addPass(new OutputPass());

  function resize(width, height) {
    view.width = Math.max(1, width);
    view.height = Math.max(1, height);
    view.aspect = view.width / view.height;
    view.pixelRatio = pixelRatio;
    camera.left = -view.aspect / 2;
    camera.right = view.aspect / 2;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pixelRatio);
    composer.setPixelRatio(pixelRatio);
    renderer.setSize(view.width, view.height, false);
    composer.setSize(view.width, view.height);
    hud.resize(view.width, view.height);
  }

  // Sustained low frame rate -> lower pixel ratio. Judged on the median
  // frame time, so one-off stalls don't count.
  const frameTimes = [];
  let windowStart = 0;
  let slowWindows = 0;
  let measuredFps = 0;
  function adaptResolution(nowMs, frameMs) {
    frameTimes.push(frameMs);
    if (nowMs - windowStart < 1000) return;
    windowStart = nowMs;
    const sorted = frameTimes.splice(0).sort((a, b) => a - b);
    if (sorted.length < 10) return;
    measuredFps = Math.round(1000 / sorted[sorted.length >> 1]);
    slowWindows = measuredFps < RENDER.targetFps ? slowWindows + 1 : 0;
    if (slowWindows < 2 || pixelRatio <= RENDER.minPixelRatio) return;
    pixelRatio = Math.max(RENDER.minPixelRatio, pixelRatio - 0.25);
    resize(view.width, view.height);
    slowWindows = 0;
  }

  const startMs = performance.now();
  let lastMs = startMs;

  // A fresh Grid, as when the user enters from the intro: nothing left from
  // before, both hands TRON, and the Grid lights up.
  function enter() {
    walls.clear();
    discs.clear();
    batons.clear();
    cycles.clear();
    voxels.clear();
    flashes.clear();
    stage.reset();
    digitizer.cancel();
    controls.reset();
    teams.reset();
    hud.reset();
    endOfLine.boot();
    log('grid boot');
  }

  // After END OF LINE the screen is dark: back to the intro. In demo mode
  // there is no intro (and the scripted loop has to go on), so the Grid
  // boots again in place after a moment of darkness.
  let darkSince = null;
  function afterEndOfLine() {
    if (!endOfLine.finished) {
      darkSince = null;
      return;
    }
    if (darkSince === null) {
      darkSince = seconds;
      if (hands.mode !== 'demo' && host) host.returnToIntro();
    }
    if (hands.mode === 'demo' && seconds - darkSince > DEMO_DARKNESS) enter();
  }

  return {
    // inside the Grid (grade.js); the host reads it every frame. The
    // digitizing laser dims it while the person is digitized, and so does
    // END OF LINE while the Grid is down.
    get cameraFilter() {
      return cssFilter(Math.min(digitizer.brightness, endOfLine.brightness()));
    },
    demoScript: (t) => demo.script(t),
    onEnter: enter,

    update(nowMs, hostDt) {
      adaptResolution(nowMs, nowMs - lastMs);
      lastMs = nowMs;
      const dt = Math.min(1 / 20, Math.max(1 / 240, hostDt));
      seconds = (nowMs - startMs) / 1000;
      endOfLine.update(seconds);
      afterEndOfLine();
      teams.left.update(dt);
      teams.right.update(dt);
      controls.update(nowMs, seconds, dt);
      cycles.update(seconds, dt);
      digitizer.update(seconds, dt, nowMs);
      walls.update(seconds);
      voxels.update(seconds);
      flashes.update(seconds);
      stage.update(seconds, controls.portal, controls.tethers, cycles.lights(), endOfLine.light());
      // after the stage, so the cycles are projected with this frame's floor
      cycles.draw();
    },

    render() {
      composer.render();
      hud.draw(lastMs, seconds);
    },

    resize,

    stats() {
      return {
        clock: Number(seconds.toFixed(2)),
        demoTime: Number(demo.time.toFixed(2)),
        teams: `${teams.left.name}/${teams.right.name}`,
        wallLength: Number(walls.length.toFixed(2)),
        trails: walls.trailCount,
        turns: walls.turnCount,
        voxels: voxels.alive,
        discs: discs.list.map((disc) => `${disc.owner}:${disc.state}`).join(' '),
        discCounts: { ...discs.counts },
        cycles: cycles.active,
        cycleCounts: { ...cycles.counts },
        batons: { ...batons.counts, cycles: controls.counts.batonCycles },
        digitize: { active: digitizer.active, count: digitizer.count, segmenter: digitizer.segmenterStatus,
          runs: digitizer.segmenterRuns, masks: digitizer.maskFrames },
        portal: Number(controls.portal.strength.toFixed(2)),
        derezz: controls.counts.derezz,
        endOfLine: endOfLine.count,
        teamSwitches: controls.counts.teamSwitches,
        events: events.join(', '),
        effectFps: measuredFps,
        pixelRatio,
      };
    },
  };
}
