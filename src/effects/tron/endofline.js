// End of line: two fists held together shut the Grid down. A derezz wave
// runs out from the fists over the whole frame (controls.js sends it), the
// Grid's lights fade to black, the camera dims, and END OF LINE is typed in
// the middle of the screen (hud.js draws it). Then the Grid reboots: the
// horizon line draws out from the middle and the floor fades back in.
//
// Times are seconds since the fists fired.
import { GRADE } from './grade.js';
import { smoothstep } from './filters.js';

export const END_OF_LINE = {
  powerDown: [0.15, 0.9],   // the Grid's lights fade out
  text: [0.55, 2.9],        // the words on screen
  reboot: 2.7,              // the horizon line draws out from the middle ...
  horizonTime: 0.5,
  floorDelay: 0.35,         // ... and the floor fades in after it
  floorTime: 1.0,
  dimmed: 0.15,             // camera brightness while the Grid is down
};

const TOTAL = END_OF_LINE.reboot + END_OF_LINE.floorDelay + END_OF_LINE.floorTime;

export function createEndOfLine({ log }) {
  let started = -Infinity;
  let origin = { x: 0, y: 0 };
  let now = 0;
  let count = 0;
  const elapsed = () => now - started;

  return {
    start(at) {
      started = now;
      origin = { ...at };
      count++;
      log('end of line');
    },
    update(seconds) {
      now = seconds;
    },
    get active() {
      return elapsed() < TOTAL;
    },
    get count() {
      return count;
    },
    get origin() {
      return origin;
    },
    // how much of the Grid is lit: { floor, horizon, reveal }, where reveal
    // is how far out from the middle the horizon line reaches (0..1)
    light() {
      const t = elapsed();
      if (t >= TOTAL) return { floor: 1, horizon: 1, reveal: 1 };
      const { powerDown, reboot, horizonTime, floorDelay, floorTime } = END_OF_LINE;
      if (t < reboot) {
        const left = 1 - smoothstep(powerDown[0], powerDown[1], t);
        return { floor: left, horizon: left, reveal: 1 };
      }
      return {
        floor: smoothstep(reboot + floorDelay, reboot + floorDelay + floorTime, t),
        horizon: 1 + 1.5 * (1 - smoothstep(reboot, reboot + horizonTime * 1.5, t)),
        reveal: smoothstep(reboot, reboot + horizonTime, t),
      };
    },
    // the words: null, or { text, typed (0..1), alpha }
    caption() {
      const t = elapsed();
      const [from, to] = END_OF_LINE.text;
      if (t < from || t > to) return null;
      return {
        text: 'END OF LINE',
        typed: Math.min(1, (t - from) / 0.6),
        alpha: 1 - smoothstep(to - 0.3, to, t),
      };
    },
    // camera brightness for the CSS filter
    brightness() {
      const t = elapsed();
      return t < END_OF_LINE.reboot + 0.2 ? END_OF_LINE.dimmed : GRADE.brightness;
    },
  };
}
