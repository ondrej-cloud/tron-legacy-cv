// The kill-cam: after a derezz, a moment of the crash as it happened, then
// the last seconds before it again, in slow motion, from a camera circling
// low around the cycle that crashed; the derezz plays out once more at the
// slowest point. Between rounds it is short; the deciding crash gets a
// longer, slower one. The duel records the riders (replay.js); this plays
// them back through ghost riders, which the scene draws like real ones.
import { createGhost, replayTime } from './replay.js';

const LIVE = 0.85;     // s of the crash as it happens before the replay
const TAIL = 0.3;      // s at the end of the hold after the replay (a flash, then on)
// s of the round replayed either side of the crash, and how much slower the
// crash itself runs than the rest (the rest runs at about half speed)
const WINDOW = {
  round: { before: 0.8, after: 0.35, slow: 2.5 },
  final: { before: 1.25, after: 0.5, slow: 3.5 },
};
const WALL_DEREZZ = 2;  // the wall's fade runs this much faster than the replay's time

export function createKillcam({ rideScene, rideCamera, sound }) {
  const ghosts = [createGhost(0), createGhost(1)];
  const fades = [null, null];
  const view = { riders: ghosts, fades, speed: 1, progress: 0, final: false, subject: null };
  let duel = null;
  let hold = 0;
  let elapsed = 0;
  let from = 0;
  let to = 0;
  let crash = null;
  let replayed = false;
  let previous = 0;      // the round time shown last frame
  let orbit = null;

  function begin() {
    const window = crash.final ? WINDOW.final : WINDOW.round;
    from = Math.max(duel.recorder.start, crash.time - window.before);
    to = Math.min(duel.recorder.end, crash.time + window.after);
    replayed = false;
    previous = from;
    rideScene.voxels.clear();
    // circle the one that crashed (the player, if both did), from the side
    // the other one is on, so both are in the picture
    const index = crash.rider === duel.clu && crash.loser !== 'both' ? 1 : 0;
    const subject = duel.riders[index];
    const other = duel.riders[1 - index];
    const across = -(other.x - subject.x) * Math.sin(subject.heading) + (other.z - subject.z) * Math.cos(subject.heading);
    const side = across >= 0 ? 1 : -1;
    orbit = {
      index,
      angle: subject.heading + side * (crash.final ? 2.2 : 1.9),
      sweep: -side * (crash.final ? 1.1 : 0.7),
      radius: crash.final ? [11, 6.5] : [9, 7],
      height: crash.final ? [3.2, 1.3] : [2.6, 1.6],
    };
    view.subject = ghosts[index];
  }

  return {
    // a derezz just happened in `duel`; the crash phase lasts `length` s
    start(currentDuel, length) {
      duel = currentDuel;
      crash = duel.crash;
      hold = length;
      elapsed = 0;
      orbit = null;
      view.final = crash.final;
      ghosts[0].team = duel.player.team;
      ghosts[1].team = duel.clu.team;
    },
    stop() {
      duel = null;
    },
    // is the replay on screen (rather than the crash as it happened)?
    get replaying() {
      return Boolean(duel && orbit && elapsed < hold - TAIL * 0.5);
    },
    // phaseTime: s into the crash phase (the duel's clock, which runs slower
    // than real time below 60 fps in demo mode); dt: real s, for the camera;
    // colors: the riders' colours. Returns what to draw while the replay is
    // on ({ riders, fades, speed, progress, final }), else null.
    update(phaseTime, dt, colors) {
      if (!duel) return null;
      const step = phaseTime - elapsed;
      elapsed = phaseTime;
      if (elapsed < LIVE || elapsed >= hold - TAIL * 0.5) return null;
      if (!orbit) begin();
      const window = crash.final ? WINDOW.final : WINDOW.round;
      const progress = (elapsed - LIVE) / Math.max(0.1, hold - LIVE - TAIL);
      const time = replayTime(progress, from, to, crash.time, window.slow);
      view.speed = step > 0 ? Math.max(0.02, (time - previous) / step) : view.speed;
      previous = time;
      view.progress = progress;
      const frames = duel.recorder.at(time);
      if (!frames) return null;
      ghosts.forEach((ghost, index) => {
        ghost.show(frames.a.riders[index], frames.b.riders[index], frames.t);
        const down = duel.riders[index].crashedAt;
        fades[index] = time >= down ? (time - down) * WALL_DEREZZ : null;
      });
      // the derezz again, at its slowest
      if (!replayed && time >= crash.time) {
        replayed = true;
        ghosts.forEach((ghost, index) => {
          if (fades[index] === null) return;
          rideScene.derezzBike(index, ghost, colors[index]);
          rideScene.derezzWall(ghost, colors[index]);
        });
        sound.crash(0.5);
        rideCamera.kick(0.3);
      }
      rideCamera.killcam(ghosts[orbit.index], progress, orbit, dt);
      return view;
    },
  };
}
