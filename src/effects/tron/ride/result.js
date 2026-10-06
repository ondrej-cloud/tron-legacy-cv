// The end of a match: TRON WINS or CLU WINS, and then the player chooses
// rather than being thrown out. Both palms open, held for a moment: a
// rematch. Both fists together: END OF LINE (controls.js powers the Grid
// down; this only shows it charging). On the keyboard, R and Escape. In
// demo mode it carries on by itself after a few seconds; with nobody in
// view for a long while it goes back to the Grid.
//
// Meanwhile it picks the next match's difficulty: one, two or three
// fingers held up (EASY, NORMAL, HARD) for a moment, or the keys 1, 2, 3.
import { LEVELS, MATCH } from './rules.js';

// as controls.js judges two fists together: palm lengths apart, and how long
const FISTS = { together: 1.6, hold: 0.5 };
// the gestures that hold up one, two and three fingers, and how long
const COUNTS = { point: 0, peace: 1, three: 2 };
const LEVEL_HOLD = 0.6;

export function createResult(hands) {
  let time = 0;
  let palms = 0;          // s both palms have been open
  let fists = 0;          // s both fists have been together
  let unseen = 0;         // s with no hand in view
  let choice = null;
  let picked = null;      // the key that was pressed, if one was
  let level = 1;          // the next match's difficulty (LEVELS)
  let pending = null;     // the level a hand is holding up ...
  let pendingTime = 0;    // ... for this long
  let changedAt = -Infinity;

  // the middle of a hand's palm, in view units (frame heights)
  function palm(hand, aspect) {
    const wrist = hand.landmarks[0];
    const knuckle = hand.landmarks[9];
    return { x: ((wrist.x + knuckle.x) / 2) * aspect, y: (wrist.y + knuckle.y) / 2 };
  }

  // A hand holding up one, two or three fingers (the other hand showing
  // the same, or nothing of the kind) picks that level once held long enough.
  function holdUp(dt, list) {
    let shown = null;
    for (const hand of list) {
      const count = hand.visible ? COUNTS[hand.gesture] : undefined;
      if (count === undefined) continue;
      shown = shown === null || shown === count ? count : -1;
    }
    if (shown === -1) shown = null;
    if (shown !== pending) {
      pending = shown;
      pendingTime = 0;
      return;
    }
    if (pending === null) return;
    pendingTime += dt;
    if (pendingTime >= LEVEL_HOLD && pending !== level) {
      level = pending;
      changedAt = time;
    }
  }

  return {
    // level: the difficulty of the match that just ended
    start(current = level) {
      level = current;
      pending = null;
      pendingTime = 0;
      changedAt = -Infinity;
      time = 0;
      palms = 0;
      fists = 0;
      unseen = 0;
      choice = null;
      picked = null;
    },
    // R or Escape
    key(name) {
      if (!choice) picked = name;
    },
    // 1, 2 or 3
    pickLevel(index) {
      if (choice || index < 0 || index >= LEVELS.length) return;
      if (index !== level) changedAt = time;
      level = index;
    },
    get level() {
      return level;
    },
    // Returns 'rematch', 'exit' (END OF LINE, by key), 'leave' (back to the
    // Grid) once chosen, else null.
    update(dt, { demo, aspect }) {
      time += dt;
      if (choice) return choice;
      const left = hands.left;
      const right = hands.right;
      const both = left.visible && right.visible && left.landmarks && right.landmarks;
      unseen = left.visible || right.visible ? 0 : unseen + dt;
      palms = both && left.gesture === 'open' && right.gesture === 'open' ? palms + dt : 0;
      let together = false;
      if (both && left.gesture === 'fist' && right.gesture === 'fist') {
        const a = palm(left, aspect);
        const b = palm(right, aspect);
        together = Math.hypot(a.x - b.x, a.y - b.y) < FISTS.together * ((left.size ?? 0.13) + (right.size ?? 0.13)) / 2;
      }
      fists = together ? fists + dt : 0;
      if (!demo) holdUp(dt, [left, right]);
      if (picked) choice = picked;
      else if (demo) choice = time >= MATCH.demoResultHold ? 'leave' : null;
      else if (palms >= MATCH.choiceHold) choice = 'rematch';
      else if (unseen >= MATCH.resultIdle) choice = 'leave';
      return choice;
    },
    // for the HUD: how long it has been up, how far each choice has charged
    // (0..1), the level chosen (s since it changed) and one being held up
    get info() {
      return {
        time,
        rematch: choice === 'rematch' ? 1 : Math.min(1, palms / MATCH.choiceHold),
        endOfLine: Math.min(1, fists / FISTS.hold),
        level,
        levelChanged: time - changedAt,
        pending: pending !== null && pending !== level ? { level: pending, charge: Math.min(1, pendingTime / LEVEL_HOLD) } : null,
      };
    },
  };
}
