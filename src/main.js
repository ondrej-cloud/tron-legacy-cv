// Host: full-screen mirrored webcam with the active effect drawn on top of it.
//
// Effect contract (src/effects/<id>/index.js):
//
//   export const meta = { title, hint };
//   export async function createEffect({ container, hands }) {
//     // create your own THREE.WebGLRenderer and append its canvas to `container`
//     return {
//       update(nowMs, dt),     // hands.update() has already run this frame
//       render(),              // draw one frame; clear to BLACK, black = see-through
//       resize(width, height), // CSS pixels; also called whenever the effect is shown
//       cameraFilter,          // optional CSS filter for the webcam behind this effect
//       demoScript(t),         // optional scripted hands for demo mode (see hands.js)
//       stats(),               // optional, merged into window.__stats
//     };
//   }
//
// The effect layer is composited with `mix-blend-mode: screen`, so light adds
// onto the camera image and dark areas leave it untouched. Only the active
// effect is updated and rendered.

import { Hands } from './hands.js';
import { createUI } from './ui.js';
import { createTuningPanel } from './tuning.js';
import { EFFECTS } from './effects/index.js';

const DEFAULT_CAMERA_FILTER = 'brightness(0.72) saturate(0.9)';

const params = new URLSearchParams(location.search);
const hands = new Hands().start();
const stage = document.getElementById('stage');
hands.video.className = 'camera';
stage.prepend(hands.video);
const effectLayers = document.getElementById('effects');

const loaded = new Map();
let active = null;
let activationToken = 0;

const ui = createUI(hands);
const tuning = createTuningPanel(hands);

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
      const effect = await module.createEffect({ container, hands });
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
  hands.video.style.filter = slot.effect.cameraFilter ?? DEFAULT_CAMERA_FILTER;
  hands.setDemoScript(slot.effect.demoScript);
}

window.addEventListener('resize', () => active?.effect.resize(window.innerWidth, window.innerHeight));

window.__stats = { frames: 0 };
let lastFrameMs = performance.now();
function frame(nowMs) {
  const dt = Math.min(0.1, (nowMs - lastFrameMs) / 1000);
  lastFrameMs = nowMs;
  hands.update(nowMs);
  if (active) {
    active.effect.update(nowMs, dt);
    active.effect.render();
  }
  ui.update();
  tuning.update();
  window.__stats.frames++;
  window.__stats.effect = active?.id ?? null;
  window.__stats.hands = hands.list
    .map((hand) => `${hand.id}:${hand.gesture}:${hand.pinch.toFixed(2)}${hand.closed ? '*' : ''}`).join(' ');
  if (active?.effect.stats) Object.assign(window.__stats, active.effect.stats());
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

activate(params.get('effect') ?? EFFECTS[0].id);
