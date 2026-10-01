// End of line: two fists held together power the Grid down. A derezz wave
// runs out from the fists, and behind it the lights go out one after
// another: walls run by run with a last flicker, discs and cycles, the HUD
// piece by piece (each collapses like an old screen switching off), the
// floor row by row from the horizon towards the viewer, then the horizon
// shrinks to a point and blinks out, while the camera dims to near black.
// In the dark, END OF LINE is typed, holds, then collapses to a line and a
// dot and goes out. Then the effect hands the screen back to the intro
// (index.js), and when the user enters again the Grid boots: the horizon
// draws out from the middle and the floor lights up row by row.
//
// Times are seconds since the fists fired (or since the boot began).
import { GRADE } from './grade.js';
import { clamp, smoothstep } from './filters.js';

export const END_OF_LINE = {
  lightsOut: 0.35,          // a light goes out this long after the wave passes it ...
  perUnit: 0.9,             // ... the wave takes this long per view unit ...
  jitter: 0.35,             // ... give or take this much
  flicker: 0.22,            // s of flicker before a light dies
  hud: { start: 0.5, step: 0.17, handOffset: 0.09, collapse: 0.22 },
  floor: [0.7, 2.1],        // the floor goes dark row by row, horizon first
  horizon: [2.1, 2.65],     // the horizon line shrinks to a point ...
  dot: [2.65, 3.05],        // ... which blinks out
  camera: [[0, GRADE.brightness], [0.3, 0.26], [1.1, 0.13], [2.0, 0.04], [2.8, 0.015]],
  text: { start: 3.25, typing: 0.6, hold: 1.2, squash: 0.13, shrink: 0.17, dot: 0.16 },
  end: 5.9,                 // dark from here on: back to the intro
  boot: { horizon: 0.55, floor: [0.3, 1.4], length: 1.6 },
};

const FAR = 60;     // floor depth beyond which nothing is lit anyway
const NEAR = 0.6;   // ... and nearer than anything on screen

// A cheap repeatable hash in 0..1.
export function hash(value) {
  const s = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// How lit a light is that goes out at `offAt` (seconds; undefined = never):
// fully on, then flickering for a moment, then off.
export function lightPower(offAt, now, seed = 0) {
  if (offAt === undefined) return 1;
  const left = offAt - now;
  if (left > END_OF_LINE.flicker) return 1;
  if (left <= 0) return 0;
  return hash(Math.floor(now * 30) + seed * 13.7) < 0.45 ? 0.12 : 1;
}

// s from the fists to the last of the words: the music fades out over this
export const POWER_DOWN_LENGTH = END_OF_LINE.text.start + END_OF_LINE.text.typing + END_OF_LINE.text.hold
  + END_OF_LINE.text.squash + END_OF_LINE.text.shrink + END_OF_LINE.text.dot;

// `onStart()` is called as the Grid starts to power down.
export function createEndOfLine({ log, onStart = () => {} }) {
  let started = null;      // when the fists fired, while the Grid is down
  let booted = -Infinity;  // when the Grid last booted
  let origin = { x: 0, y: 0 };
  let now = 0;
  let count = 0;
  const elapsed = () => now - started;
  const down = () => started !== null;

  function floorCut(progress) {
    return FAR * (NEAR / FAR) ** clamp(progress, 0, 1);
  }

  return {
    start(at) {
      started = now;
      origin = { x: at.x, y: at.y };
      count++;
      log('end of line');
      onStart();
    },
    // the Grid comes back: clean, and lighting up
    boot() {
      started = null;
      booted = now;
    },
    update(seconds) {
      now = seconds;
    },
    // the Grid is down (from the fists until it boots again)
    get active() {
      return down();
    },
    get finished() {
      return down() && elapsed() >= END_OF_LINE.end;
    },
    get count() {
      return count;
    },
    get origin() {
      return origin;
    },
    // when a light at `point` (view units) goes out
    offTime(point) {
      const distance = Math.hypot(point.x - origin.x, point.y - origin.y);
      return started + END_OF_LINE.lightsOut + distance * END_OF_LINE.perUnit + Math.random() * END_OF_LINE.jitter;
    },
    // The stage's lights: { floor, floorCut, horizon, reveal, dot }. `floor`
    // dims the beam and the floor's glow, `floorCut` is the floor depth
    // beyond which rows are dark, `reveal` how far the horizon line reaches
    // out from the middle (0..1) and `dot` the point it shrinks to.
    light() {
      if (down()) {
        const t = elapsed();
        const [floorFrom, floorTo] = END_OF_LINE.floor;
        const [horizonFrom, horizonTo] = END_OF_LINE.horizon;
        const [dotFrom, dotTo] = END_OF_LINE.dot;
        const shrink = smoothstep(horizonFrom, horizonTo, t);
        const dotTime = (t - dotFrom) / (dotTo - dotFrom);
        // the dot blinks twice and goes out
        const blink = dotTime < 0 || dotTime > 1 ? 0 : [1, 0.15, 1, 0.1, 0.6, 0][Math.floor(dotTime * 6)];
        return {
          floor: 1 - smoothstep(0.2, floorTo, t),
          floorCut: floorCut((t - floorFrom) / (floorTo - floorFrom)),
          horizon: t < horizonFrom ? 1 : t < horizonTo ? 1 + 1.4 * shrink : 0,
          reveal: 1 - shrink,
          dot: t >= horizonTo ? blink : 0,
        };
      }
      const t = now - booted;
      const { horizon, floor, length } = END_OF_LINE.boot;
      if (t < length) {
        return {
          floor: smoothstep(floor[0], floor[1], t),
          floorCut: floorCut(1 - (t - floor[0]) / (floor[1] - floor[0])),
          horizon: 1 + 1.5 * (1 - smoothstep(0, horizon * 1.5, t)),
          reveal: smoothstep(0, horizon, t),
          dot: t < 0.12 ? 1 - t / 0.12 : 0,
        };
      }
      return { floor: 1, floorCut: 1e4, horizon: 1, reveal: 1, dot: 0 };
    },
    // One HUD element (0, 1, ... in the order they switch off) of a hand:
    // { alpha, collapse }, collapse running 0..1 as it switches off.
    hudPower(element, handId) {
      if (!down()) return { alpha: 1, collapse: 0 };
      const { start, step, handOffset, collapse } = END_OF_LINE.hud;
      const off = start + element * step + (handId === 'right' ? handOffset : 0);
      const t = elapsed();
      if (t < off - END_OF_LINE.flicker * 0.6) return { alpha: 1, collapse: 0 };
      if (t < off) return { alpha: hash(Math.floor(now * 30) + element * 7 + (handId === 'right' ? 3 : 0)) < 0.4 ? 0.2 : 1, collapse: 0 };
      if (t < off + collapse) return { alpha: 1, collapse: (t - off) / collapse };
      return { alpha: 0, collapse: 1 };
    },
    // anything else on the HUD (charge rings, labels): on until the fists fire
    get hudOn() {
      return !down();
    },
    // The words: null, or { text, typed (0..1), squash, shrink, dot } where
    // the last three run 0..1 as the words collapse like an old TV.
    caption() {
      if (!down()) return null;
      const { start, typing, hold, squash, shrink, dot } = END_OF_LINE.text;
      const t = elapsed() - start;
      const collapseAt = typing + hold;
      if (t < 0 || t > collapseAt + squash + shrink + dot) return null;
      return {
        text: 'END OF LINE',
        typed: clamp(t / typing, 0, 1),
        squash: clamp((t - collapseAt) / squash, 0, 1),
        shrink: clamp((t - collapseAt - squash) / shrink, 0, 1),
        dot: clamp((t - collapseAt - squash - shrink) / dot, 0, 1),
      };
    },
    // camera brightness for the CSS filter (it eases between the steps)
    brightness() {
      if (!down()) return GRADE.brightness;
      const t = elapsed();
      let value = GRADE.brightness;
      for (const [at, brightness] of END_OF_LINE.camera) if (t >= at) value = brightness;
      return value;
    },
  };
}
