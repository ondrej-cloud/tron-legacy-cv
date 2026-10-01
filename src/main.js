// Host: full-screen mirrored webcam with the active effect drawn on top of it.
//
// Effect contract (src/effects/<id>/index.js):
//
//   export const meta = { title, hint };
//   export async function createEffect({ container, hands, host }) {
//     // create your own THREE.WebGLRenderer and append its canvas to `container`
//     return {
//       update(nowMs, dt),     // hands.update() has already run this frame
//       render(),              // draw one frame; clear to BLACK, black = see-through
//       resize(width, height), // CSS pixels; also called whenever the effect is shown
//       cameraFilter,          // optional CSS filter for the webcam behind this effect;
//                              // read every frame, so a getter can animate it
//       demoScript(t),         // optional scripted hands for demo mode (see hands.js)
//       onEnter(),             // optional, called each time the user enters from the intro
//       stats(),               // optional, merged into window.__stats
//     };
//   }
//
// `host.returnToIntro()` hands the screen back to the intro (it plays its
// "returning" version, without the camera gate); the effect is paused until
// the user enters again, then gets onEnter(). `host.music.fadeOut(seconds)`
// fades the background music, e.g. while the Grid powers down.
//
// The effect layer is composited with `mix-blend-mode: screen`, so light adds
// onto the camera image and dark areas leave it untouched. Only the active
// effect is updated and rendered.

import { Hands } from './hands.js';
import { createUI } from './ui.js';
import { createTuningPanel } from './tuning.js';
import { createMusic } from './music.js';
import { EFFECTS } from './effects/index.js';

const DEFAULT_CAMERA_FILTER = 'brightness(0.72) saturate(0.9)';

const params = new URLSearchParams(location.search);
// The intro asks for the camera itself (from a button), so the browser prompt
// doesn't appear over the boot animation. Without the intro, ask right away.
let introRunning = !params.has('skipintro') && (params.has('intro') || !params.has('demo'));
const hands = new Hands();
if (!introRunning) hands.start();
const stage = document.getElementById('stage');
hands.video.className = 'camera';
stage.prepend(hands.video);
const effectLayers = document.getElementById('effects');

const loaded = new Map();
let active = null;
let activationToken = 0;

const ui = createUI(hands);
const tuning = createTuningPanel(hands);
const music = createMusic();

// The intro covers the screen until the user enters (demo runs skip it unless ?intro).
function showIntro({ returning = false } = {}) {
  introRunning = true;
  music.play('intro');
  import('./intro.js')
    .then(({ runIntro }) => runIntro({
      hands,
      returning,
      onDone: () => {
        introRunning = false;
        music.play('grid');
        active?.effect.onEnter?.();
      },
    }))
    .catch((error) => {
      console.error('intro failed to load', error);
      introRunning = false;
      hands.start();
      music.play('grid');
    });
}
if (introRunning) showIntro();
else music.play('grid');

const host = {
  music,
  returnToIntro() {
    if (!introRunning) showIntro({ returning: true });
  },
};

async function activate(id) {
  const token = ++activationToken;
  const entry = EFFECTS.find((effect) => effect.id === id)
    ?? { id, title: id, load: () => import(`./effects/${id}/index.js`) };
  let slot = loaded.get(id);
  if (!slot) {
    const container = document.createElement('div');
    container.className = 'effect-layer';
    container.hidden = true;
    effectLayers.appendChild(container);
    try {
      const module = await entry.load();
      const effect = await module.createEffect({ container, hands, host });
      slot = { id, container, effect, meta: module.meta ?? {} };
      loaded.set(id, slot);
    } catch (loadError) {
      console.error(`effect "${id}" failed to load`, loadError);
      container.remove();
      return;
    }
  }
  if (token !== activationToken) return;   // another switch happened meanwhile
  for (const other of loaded.values()) other.container.hidden = other !== slot;
  active = slot;
  slot.effect.resize(window.innerWidth, window.innerHeight);
  hands.setDemoScript(slot.effect.demoScript);
}

window.addEventListener('resize', () => active?.effect.resize(window.innerWidth, window.innerHeight));

window.__stats = { frames: 0 };
let lastFrameMs = performance.now();
function frame(nowMs) {
  const dt = Math.min(0.1, (nowMs - lastFrameMs) / 1000);
  lastFrameMs = nowMs;
  hands.update(nowMs);
  if (active && !introRunning) {
    active.effect.update(nowMs, dt);
    active.effect.render();
    const filter = active.effect.cameraFilter ?? DEFAULT_CAMERA_FILTER;
    if (filter !== hands.video.style.filter) hands.video.style.filter = filter;
  }
  ui.update();
  tuning.update();
  window.__stats.frames++;
  window.__stats.effect = active?.id ?? null;
  window.__stats.tracker = hands.trackerMode;
  window.__stats.trackerStats = hands.trackerStats;
  window.__stats.hands = hands.list
    .map((hand) => `${hand.id}:${hand.gesture}:${hand.pinch.toFixed(2)}${hand.closed ? '*' : ''}`).join(' ');
  if (active?.effect.stats) Object.assign(window.__stats, active.effect.stats());
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

activate(params.get('effect') ?? EFFECTS[0].id);
