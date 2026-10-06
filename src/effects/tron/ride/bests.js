// Personal bests for the duel, kept in the browser: wins and losses at each
// difficulty, the fastest win at each, the top speed ever ridden, and the
// difficulty last chosen. Storage can be blocked (a private window, cookies
// off): then they only last as long as the page.
import { LEVELS } from './rules.js';

const KEY = 'tron-legacy-cv:ride-bests';

const count = (value) => (Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);
const time = (value) => (Number.isFinite(value) && value > 0 ? value : null);

function load() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY));
  } catch {
    // blocked or not JSON: start afresh
  }
  // only what looks right is taken over
  return {
    levels: LEVELS.map((_, index) => {
      const level = saved?.levels?.[index];
      return { wins: count(level?.wins), losses: count(level?.losses), fastest: time(level?.fastest) };
    }),
    topSpeed: Number.isFinite(saved?.topSpeed) ? Math.max(0, saved.topSpeed) : 0,
    level: Number.isInteger(saved?.level) && saved.level >= 0 && saved.level < LEVELS.length ? saved.level : 1,
  };
}

export function createBests() {
  const bests = load();

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(bests));
    } catch {
      // not fatal: they last as long as the page
    }
  }

  return {
    // { levels: [{ wins, losses, fastest (s) }], topSpeed (m/s), level }
    get all() {
      return bests;
    },
    // the difficulty last chosen (an index into LEVELS)
    get level() {
      return bests.level;
    },
    set level(index) {
      bests.level = index;
      save();
    },
    // A match is over: level (index), won, time (s raced), topSpeed (m/s).
    // Returns which bests it beat: { fastest, topSpeed }.
    record({ level, won, time: raced, topSpeed }) {
      const entry = bests.levels[level];
      const beat = { fastest: false, topSpeed: false };
      if (!entry) return beat;
      if (won) {
        entry.wins++;
        beat.fastest = entry.fastest === null || raced < entry.fastest;
        if (beat.fastest) entry.fastest = raced;
      } else {
        entry.losses++;
      }
      // the very first ride sets it rather than beating it
      beat.topSpeed = topSpeed > bests.topSpeed && bests.topSpeed > 0;
      bests.topSpeed = Math.max(bests.topSpeed, topSpeed);
      save();
      return beat;
    },
  };
}
