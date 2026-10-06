// The grip tutorial. Before the first GO of a session (riding with the
// camera), the cycle waits at its start while an overlay shows how to hold
// the handlebars, and the countdown only begins once both hands have held
// a steady grip for a moment (createGripCheck, handlebars.js). The moment
// the grip settles is also when the neutral throttle distance is measured.
// The arrow keys skip it.
import { createGripCheck } from '../../../handlebars.js';

const LOCKED = 0.6;        // s the overlay shows the grip locked in before the countdown

// what is in the way of a grip, in the words the overlay uses
const HINTS = {
  'need both hands': 'SHOW BOTH HANDS TO THE CAMERA',
  'close your hands': 'CLOSE YOUR HANDS INTO FISTS',
  'hands too close': 'HANDS TOO CLOSE: A HANDLEBAR APART',
  'hands too far apart': 'HANDS TOO FAR APART',
  'level your hands': 'LEVEL YOUR HANDS',
  'hold still': 'HOLD STILL',
};

export function createTutorial() {
  const check = createGripCheck();
  let active = false;
  let done = false;          // passed once this session: not again
  let time = 0;
  let lockedAt = null;       // when the grip settled

  return {
    get active() {
      return active;
    },
    // whether a ride starting now should show it
    get wanted() {
      return !done;
    },
    start() {
      active = true;
      time = 0;
      lockedAt = null;
      check.reset();
    },
    // done with it without a grip (the keys, another input mode)
    skip() {
      active = false;
      done = true;
    },
    // Call every frame while active. Returns 'locked' on the frame the grip
    // settles, 'go' once the countdown can start, else null.
    update(hands, dt, aspect) {
      if (!active) return null;
      time += dt;
      if (lockedAt !== null) {
        if (time - lockedAt < LOCKED) return null;
        active = false;
        done = true;
        return 'go';
      }
      if (!check.update(hands, dt, aspect).steady) return null;
      lockedAt = time;
      return 'locked';
    },
    // for the HUD: s shown, how far the grip has got (0..1), what is in the
    // way ('' if nothing), and s since it locked in (null before)
    get info() {
      const state = check.state;
      return {
        time,
        progress: lockedAt === null ? state.progress : 1,
        hint: lockedAt === null ? HINTS[state.hint] ?? state.hint.toUpperCase() : '',
        locked: lockedAt === null ? null : time - lockedAt,
        fade: lockedAt === null ? 1 : Math.max(0, 1 - (time - lockedAt) / LOCKED),
      };
    },
  };
}
