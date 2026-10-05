// Replays of a crash. The duel records both riders every frame of the
// last few seconds of a round (createRecorder); after a derezz the ride
// plays that stretch back in slow motion around the moment of the crash
// (replayTime), through ghost riders that look to the scene like real ones
// (createGhost): the same fields, and a jetwall cut off where it had got to.
import { BIKE } from './rules.js';

const RATE = 60;          // frames per second recorded
const KEEP = 6;           // s kept
const NUMBERS = ['x', 'y', 'z', 'heading', 'pitch', 'bank', 'lean', 'steer', 'spin', 'speed', 'along',
  'ground', 'vy', 'squash', 'airTime'];
const FLAGS = ['alive', 'riding', 'airborne'];

const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

export function createRecorder() {
  const frames = [];
  let lastTime = -Infinity;

  function stateOf(rider, out = {}) {
    for (const key of NUMBERS) if (typeof rider[key] === 'number') out[key] = rider[key];
    for (const key of FLAGS) out[key] = Boolean(rider[key]);
    out.path = rider.path;
    out.points = rider.path.length;
    return out;
  }

  return {
    // time: s into the round; riders: [player, clu]
    capture(time, riders) {
      if (time - lastTime < 1 / RATE - 1e-6) return;
      lastTime = time;
      // reuse the oldest frame once there are enough
      const frame = frames.length >= RATE * KEEP ? frames.shift() : { time: 0, riders: [{}, {}] };
      frame.time = time;
      riders.forEach((rider, index) => stateOf(rider, frame.riders[index]));
      frames.push(frame);
    },
    clear() {
      frames.length = 0;
      lastTime = -Infinity;
    },
    // the recorded frames either side of round time `time`, and how far between them it is
    at(time) {
      if (!frames.length) return null;
      let high = frames.findIndex((frame) => frame.time >= time);
      if (high < 0) high = frames.length - 1;
      const low = Math.max(0, high - 1);
      const a = frames[low];
      const b = frames[high];
      const span = b.time - a.time;
      return { a, b, t: span > 1e-6 ? Math.min(1, Math.max(0, (time - a.time) / span)) : 1 };
    },
    get start() {
      return frames.length ? frames[0].time : 0;
    },
    get end() {
      return frames.length ? frames[frames.length - 1].time : 0;
    },
  };
}

// A stand-in for a rider during a replay. show(a, b, t) puts it between two
// recorded states of the rider.
export function createGhost(team) {
  let source = null;
  const ghost = {
    team,
    path: [],
    alive: true,
    riding: true,
    airborne: false,
    get forwardX() {
      return Math.cos(this.heading);
    },
    get forwardZ() {
      return Math.sin(this.heading);
    },
    get noseX() {
      return this.x + Math.cos(this.heading) * BIKE.length;
    },
    get noseZ() {
      return this.z + Math.sin(this.heading) * BIKE.length;
    },
    get noseY() {
      return (this.y ?? 0) + Math.sin(this.pitch ?? 0) * BIKE.length;
    },
    show(a, b, t) {
      for (const key of NUMBERS) {
        if (typeof a[key] !== 'number') continue;
        this[key] = key === 'heading' ? a.heading + wrap(b.heading - a.heading) * t : a[key] + (b[key] - a[key]) * t;
      }
      const near = t < 0.5 ? a : b;
      for (const key of FLAGS) this[key] = near[key];
      // the jetwall as far as it had got: the recorded points of the real one
      if (source !== a.path) {
        source = a.path;
        this.path.length = 0;
      }
      const count = Math.min(a.points, source.length);
      for (let index = this.path.length; index < count; index++) this.path.push(source[index]);
      this.path.length = count;
    },
  };
  return ghost;
}

// Slow motion that slows down most around the crash: for `progress` 0..1
// through the replay, the round time to show, between `from` and `to`, with
// the crash at `crash`. `slow` is how much slower than the rest the moment
// of the crash runs.
export function replayTime(progress, from, to, crash, slow = 3) {
  const length = Math.max(1e-6, to - from);
  const centre = (crash - from) / length;
  const width = 0.08;
  const weight = (slow - 1) * width;
  // real time spent up to round fraction u: steeper (slower) near the crash
  const spent = (u) => u + weight * (Math.atan((u - centre) / width) + Math.atan(centre / width));
  const total = spent(1);
  const wanted = Math.min(1, Math.max(0, progress)) * total;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step++) {
    const middle = (low + high) / 2;
    if (spent(middle) < wanted) low = middle;
    else high = middle;
  }
  return from + length * (low + high) / 2;
}
