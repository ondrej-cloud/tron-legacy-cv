// Scripted hands for demo mode: a 50 s loop that runs through every gesture.
// The hands are procedural (gestures.js) and go through the same analysis as
// camera hands, so this exercises the real gesture rules. Like a real hand,
// the palm stays put while the fingers change pose: keyframes place the palm
// where an open hand's pinch point would be (or place the index fingertip,
// for drawing).
//
// Timeline (seconds into the loop; the effect needs ~0.25 s to react):
//    0.0 -  2.6  both palms open, moving apart: portal, Grid floor lights up
//    3.4 -  6.9  both index fingers draw glass walls with 90° turns
//          4.7   right hand makes rock mid-wall: it turns CLU orange, the rest
//                of its wall comes out orange while the left one stays cyan
//          7.8   right hand makes "ok": an orange identity disc (~8.3 ready)
//          8.8   right hand flicks left: the disc ricochets off the walls
//    9.75-10.35  left fist, held: a charging ring, then a local derezz (~10.4):
//                the part of the left wall near it shatters, the rest stays
//         10.9   left hand makes "ok": a cyan disc; two hands, two colours
//         12.2   both hands open their ok while moving inwards, letting the
//                discs go: they collide mid-air (~12.4) and come back
//   14.8 - 15.4  both fists held, far apart: each derezzes the disc in it
//   15.7 - 15.8  thumbs up, right then left: two light cycles rezz in the air
//                (rings, holographic sweep, solid, rims: ~1.7 s), drop and
//                ride off in 90° turns with jetwalls behind them (~18.0 - 22.8)
//         20.3   right hand peace: the digitizing laser (20.8 - 24.6)
//   24.9 - 25.9  right hand draws a wall
//         25.5   left hand makes "ok": a cyan disc
//         26.6   right hand shaka: an orange baton rezzes with light traces
//   27.3 - 27.6  it swings left through the wall and cuts a gap in it
//         28.2   left hand flicks: the baton bats the disc away (~28.6)
//         ~31.3  the disc can't come home (the hand is gone) and fades out
//   31.7 - 32.2  left hand comes to the baton's free end: GRAB (~32.4)
//   32.6 - 33.6  the hands pull apart: the bar fills, the baton splits into its
//                two handles and a big light cycle rezzes between the hands
//                (~33.1 - 34.8), then drops and rides until END OF LINE
//         34.9   right hand rock: back to TRON cyan
//   35.6 - 37.4  both hands draw one more wall each, beside the person
//   37.65- 38.5  both fists come together and hold: END OF LINE (~38.5)
//   38.5 - 41.6  the Grid powers down: a derezz wave around the fists, then
//                the walls go out run by run (~38.9 - 40.3), the HUD pieces
//                switch off one by one (~39.0 - 39.8), the floor goes dark
//                row by row (39.2 - 40.6), the horizon shrinks to a dot
//                (40.6 - 41.55)
//   41.75- 43.85 END OF LINE is typed in the dark, holds, collapses to a dot
//         44.4   (in the app: back to the intro.) In demo mode, after half a
//                second of darkness the Grid boots in place (44.9 - 46.5)
//   46.8 - 50.0  both palms open again: portal (continues into the next loop)
import { POSES, blendPoses, poseToLandmarks } from '../../gestures.js';

export const DEMO_LOOP = 50;
const PALM = 0.13;   // palm length, as hands.js uses for procedural hands
const PALM_POINTS = [0, 5, 9, 13, 17];
const ROLL = { left: -0.08, right: 0.08 };
// a baton held level: the hand turned outwards so thumb and pinky line up
const BATON_ROLL = { left: -0.8, right: 0.8 };
// a thumbs-up needs the thumb spread out and the hand turned so the thumb points up
const THUMBS_UP_ROLL = { left: -0.8, right: 0.8 };

const DEMO_POSES = {
  ...POSES,
  rock: { curl: { thumb: 0.85, index: 0, middle: 1, ring: 1, pinky: 0 }, touch: {} },
  thumbsUp: { curl: { thumb: -0.2, index: 1, middle: 1, ring: 1, pinky: 1 }, touch: {} },
};

const key = (t, x, y, pose, options = {}) => ({ t, x, y, pose, anchor: 'pinch', ease: 'smooth', ...options });
const tip = (t, x, y, pose, options = {}) => key(t, x, y, pose, { anchor: 'tip', ...options });
const hidden = (t) => ({ t, hidden: true });

// Fingertip keyframes along a polyline at constant speed (view units/s).
function path(startTime, speed, points, aspect = 16 / 9) {
  const keys = [];
  let time = startTime;
  points.forEach(([x, y], index) => {
    if (index > 0) {
      const [previousX, previousY] = points[index - 1];
      time += Math.hypot((x - previousX) * aspect, y - previousY) / speed;
    }
    keys.push(tip(time, x, y, 'point', { ease: 'linear' }));
  });
  return keys;
}

const RIGHT = [
  key(0, 0.635, 0.62, 'open'),
  key(2.4, 0.77, 0.58, 'open'),
  tip(2.9, 0.66, 0.8, 'open'),
  tip(3.15, 0.66, 0.8, 'point'),
  ...path(3.4, 0.5, [[0.66, 0.8], [0.78, 0.8], [0.78, 0.62], [0.88, 0.62]]),
  tip(4.6, 0.88, 0.62, 'point'),
  tip(4.75, 0.88, 0.62, 'rock'),          // switch to CLU in the middle of the wall
  tip(5.15, 0.88, 0.62, 'rock'),
  tip(5.3, 0.88, 0.62, 'point'),
  ...path(5.45, 0.5, [[0.88, 0.62], [0.88, 0.28], [0.74, 0.28], [0.74, 0.17]]),
  tip(7.05, 0.74, 0.17, 'open'),
  key(7.35, 0.77, 0.58, 'open'),
  key(7.6, 0.76, 0.6, 'ok'),
  key(8.55, 0.76, 0.6, 'ok'),
  key(8.75, 0.79, 0.6, 'ok'),             // a small wind-up ...
  key(9.0, 0.65, 0.6, 'ok', { ease: 'linear' }),   // ... and an ordinary flick, about 1 view unit/s
  key(9.3, 0.66, 0.6, 'open'),
  key(9.8, 0.72, 0.6, 'open'),            // waits, open, for the disc
  key(11.5, 0.72, 0.62, 'open'),
  key(11.75, 0.72, 0.62, 'ok'),           // closes the ok around the disc ...
  key(11.95, 0.72, 0.62, 'ok'),
  key(12.35, 0.64, 0.62, 'open', { ease: 'linear' }),   // ... and opens it while moving in: released
  key(12.8, 0.66, 0.62, 'open'),
  key(13.4, 0.72, 0.6, 'open'),           // open, waiting for the disc to come back
  key(14.6, 0.72, 0.6, 'open'),
  key(14.8, 0.72, 0.6, 'fist'),           // held: the disc in it derezzes
  key(15.45, 0.72, 0.6, 'fist'),
  key(15.7, 0.74, 0.56, 'thumbsUp', { roll: THUMBS_UP_ROLL.right }),
  key(16.4, 0.74, 0.56, 'thumbsUp', { roll: THUMBS_UP_ROLL.right }),
  hidden(16.5),
  key(19.8, 0.76, 0.52, 'open'),
  key(20.05, 0.76, 0.5, 'peace'),
  key(20.6, 0.76, 0.5, 'peace'),
  key(20.9, 0.78, 0.56, 'open'),          // rests at the side while the laser scans
  key(24.3, 0.78, 0.58, 'open'),
  tip(24.6, 0.64, 0.3, 'open'),
  tip(24.85, 0.64, 0.3, 'point'),
  ...path(25.05, 0.5, [[0.64, 0.3], [0.64, 0.72]]),
  tip(26.1, 0.64, 0.72, 'point'),
  key(26.35, 0.8, 0.5, 'open'),
  key(26.6, 0.8, 0.5, 'shaka'),           // a baton
  key(27.3, 0.8, 0.5, 'shaka'),
  key(27.6, 0.52, 0.5, 'shaka', { ease: 'linear' }),   // the swing: cuts the wall
  key(28.0, 0.76, 0.5, 'shaka'),          // holds it out for the disc
  key(30.4, 0.76, 0.5, 'shaka'),
  key(31.1, 0.8, 0.52, 'shaka', { roll: BATON_ROLL.right }),   // level, its free end to the left
  key(32.6, 0.8, 0.52, 'shaka', { roll: BATON_ROLL.right }),
  key(33.6, 0.86, 0.52, 'shaka', { roll: BATON_ROLL.right }),  // pulled apart: a light cycle
  key(34.1, 0.86, 0.52, 'shaka', { roll: BATON_ROLL.right }),  // (still a shaka: no portal with the other hand)
  key(34.35, 0.84, 0.54, 'open'),
  key(34.6, 0.8, 0.56, 'open'),
  key(34.8, 0.8, 0.56, 'rock'),
  key(35.2, 0.8, 0.56, 'rock'),
  tip(35.6, 0.86, 0.25, 'point'),
  tip(35.85, 0.86, 0.25, 'point'),
  ...path(36.05, 0.5, [[0.86, 0.25], [0.72, 0.25], [0.72, 0.45], [0.62, 0.45]]),
  tip(37.4, 0.62, 0.45, 'point'),
  key(37.65, 0.56, 0.55, 'fist'),         // the two fists come together ...
  key(37.95, 0.505, 0.58, 'fist'),
  key(39.9, 0.505, 0.58, 'fist'),         // ... and hold: END OF LINE, while the HUD switches off
  hidden(40.0),
  key(46.8, 0.66, 0.64, 'open'),
  key(DEMO_LOOP, 0.635, 0.62, 'open'),
];

const LEFT = [
  key(0, 0.365, 0.62, 'open'),
  key(2.4, 0.23, 0.58, 'open'),
  tip(2.9, 0.36, 0.2, 'open'),
  tip(3.15, 0.36, 0.2, 'point'),
  ...path(3.4, 0.48, [[0.36, 0.2], [0.2, 0.2], [0.2, 0.42], [0.08, 0.42], [0.08, 0.7], [0.24, 0.7]]),
  ...path(6.07, 0.6, [[0.24, 0.7], [0.24, 0.84], [0.37, 0.84]]).slice(1),
  hidden(6.95),                           // leaves, so the open right hand doesn't open a portal
  key(9.75, 0.27, 0.64, 'fist'),          // comes back as a fist and holds it: derezz
  key(10.6, 0.27, 0.64, 'fist'),
  key(10.9, 0.27, 0.62, 'ok'),
  key(11.95, 0.27, 0.62, 'ok'),
  key(12.35, 0.35, 0.62, 'open', { ease: 'linear' }),
  key(12.8, 0.34, 0.62, 'open'),
  key(13.4, 0.28, 0.6, 'open'),
  key(14.6, 0.28, 0.6, 'open'),
  key(14.8, 0.28, 0.6, 'fist'),
  key(15.45, 0.28, 0.6, 'fist'),
  key(15.8, 0.26, 0.56, 'thumbsUp', { roll: THUMBS_UP_ROLL.left }),
  key(16.7, 0.26, 0.56, 'thumbsUp', { roll: THUMBS_UP_ROLL.left }),
  hidden(16.8),
  key(25.2, 0.3, 0.52, 'open'),
  key(25.45, 0.3, 0.52, 'ok'),
  key(27.95, 0.3, 0.52, 'ok'),
  key(28.1, 0.28, 0.52, 'ok'),            // wind-up ...
  key(28.35, 0.42, 0.52, 'ok', { ease: 'linear' }),   // ... and a flick through the gap
  key(28.55, 0.4, 0.52, 'open'),
  hidden(28.8),                           // gone: its disc can't come home and fades out
  key(31.7, 0.62, 0.56, 'open'),
  key(32.2, 0.7375, 0.508, 'open'),       // at the baton's free end: grabs it
  key(32.6, 0.7375, 0.508, 'open'),
  key(33.6, 0.56, 0.52, 'open'),          // pulls
  hidden(33.7),
  tip(35.6, 0.14, 0.25, 'point'),
  tip(35.85, 0.14, 0.25, 'point'),
  ...path(36.05, 0.5, [[0.14, 0.25], [0.28, 0.25], [0.28, 0.45], [0.38, 0.45]]),
  tip(37.4, 0.38, 0.45, 'point'),
  key(37.65, 0.44, 0.55, 'fist'),
  key(37.95, 0.495, 0.58, 'fist'),
  key(39.9, 0.495, 0.58, 'fist'),
  hidden(40.0),
  key(46.8, 0.34, 0.66, 'open'),
  key(DEMO_LOOP, 0.365, 0.62, 'open'),
];

export function createDemo() {
  let currentTime = 0;

  // Viewport offsets from the pinch midpoint (what hands.js positions) to the
  // index fingertip and to the palm centre, for a pose.
  function offsets(pose, physical, roll, aspect) {
    const points = poseToLandmarks({ x: 0, y: 0, size: PALM, roll, physical }, pose);
    const midX = (points[4].x + points[8].x) / 2;
    const midY = (points[4].y + points[8].y) / 2;
    let palmX = 0;
    let palmY = 0;
    for (const index of PALM_POINTS) {
      palmX += points[index].x / PALM_POINTS.length;
      palmY += points[index].y / PALM_POINTS.length;
    }
    return {
      tip: { x: (points[8].x - midX) / aspect, y: points[8].y - midY },
      palm: { x: (palmX - midX) / aspect, y: palmY - midY },
    };
  }

  const rollOf = (frame, physical) => frame.roll ?? ROLL[physical];

  // where a keyframe puts the palm centre
  function palmPoint(frame, physical, aspect) {
    const own = offsets(DEMO_POSES[frame.pose], physical, rollOf(frame, physical), aspect);
    if (frame.anchor === 'tip') {
      return { x: frame.x - own.tip.x + own.palm.x, y: frame.y - own.tip.y + own.palm.y };
    }
    const open = offsets(POSES.open, physical, ROLL[physical], aspect);
    return { x: frame.x + open.palm.x, y: frame.y + open.palm.y };
  }

  function sample(track, time, physical, aspect) {
    let index = 0;
    while (index < track.length - 1 && track[index + 1].t <= time) index++;
    const from = track[index];
    if (from.hidden) return null;
    const to = track[Math.min(index + 1, track.length - 1)];
    const target = to.hidden ? from : to;
    const span = target.t - from.t;
    const linear = span > 0 ? Math.min(1, Math.max(0, (time - from.t) / span)) : 0;
    const smooth = linear * linear * (3 - 2 * linear);
    const moveAmount = target.ease === 'linear' ? linear : smooth;
    const a = palmPoint(from, physical, aspect);
    const b = palmPoint(target, physical, aspect);
    // a little tremor, like a real hand held in the air
    const phase = physical === 'left' ? 0 : 2.1;
    const tremorX = 0.0022 * Math.sin(time * 7.3 + phase) + 0.0012 * Math.sin(time * 12.7 + phase * 2);
    const tremorY = 0.0022 * Math.sin(time * 6.1 + phase * 3) + 0.0012 * Math.sin(time * 14.3 + phase);
    const rollFrom = rollOf(from, physical);
    const roll = rollFrom + (rollOf(target, physical) - rollFrom) * smooth;
    const pose = blendPoses(DEMO_POSES[from.pose], DEMO_POSES[target.pose], smooth);
    const palm = offsets(pose, physical, roll, aspect).palm;
    return {
      x: a.x + (b.x - a.x) * moveAmount - palm.x + tremorX,
      y: a.y + (b.y - a.y) * moveAmount - palm.y + tremorY,
      physical,
      roll,
      palmFacing: true,
      pose,
    };
  }

  return {
    get time() {
      return currentTime;
    },
    script(t) {
      currentTime = t % DEMO_LOOP;
      const aspect = window.innerWidth / Math.max(1, window.innerHeight);
      return [sample(LEFT, currentTime, 'left', aspect), sample(RIGHT, currentTime, 'right', aspect)]
        .filter(Boolean);
    },
  };
}
