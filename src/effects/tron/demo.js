// Scripted hands for demo mode: a 38 s loop that runs through every gesture.
// The hands are procedural (gestures.js) and go through the same analysis as
// camera hands, so this exercises the real gesture rules. Like a real hand,
// the palm stays put while the fingers change pose: keyframes place the palm
// where an open hand's pinch point would be (or place the index fingertip,
// for drawing).
//
// Timeline (seconds into the loop; the effect needs ~0.25 s to react):
//    0.0 -  2.6  both palms open, moving apart: portal, Grid floor lights up
//    3.4 -  6.8  both index fingers draw light walls with 90° turns
//          5.0   right hand makes rock mid-wall: it turns CLU orange, the rest
//                of its wall comes out orange while the left one stays cyan
//          7.8   right hand makes "ok": an orange identity disc (~8.3 ready)
//          8.8   right hand flicks left at an ordinary speed: the disc
//                ricochets off the left (cyan) wall (~9.3), then the right wall
//          9.9   left fist: derezz wave, the walls shatter into voxels
//   10.3 - 11.0  the disc settles, homes back and is caught
//         10.8   left hand makes "ok": a cyan disc; two hands, two colours
//         11.8   both hands open their ok while moving inwards, letting the
//                discs go: they collide mid-air (~12.0), ricochet off the
//                edges and come back (~13.8)
//         14.9   both fists: the discs in them shatter
//   15.6 - 15.7  thumbs up, right then left: an orange and a cyan light cycle
//                drop onto the Grid and race, each in its half (until ~20)
//         20.3   right hand peace: the digitizing laser charges at the hand,
//                sweeps down (20.8 - 22.1) turning the person into orange
//                TRON lines, holds (22.1 - 23.6), sweeps back up (23.6 - 24.6)
//   24.9 - 25.9  right hand draws a vertical light wall
//         25.5   left hand makes "ok": a cyan disc
//         26.6   right hand shaka: an orange light baton rezzes (~26.9 - 27.2)
//   27.3 - 27.6  it swings left through the wall and cuts a gap in it
//         28.2   left hand flicks: the disc flies through the gap and the
//                baton bats it away (~28.6); it ricochets and comes home
//         31.6   left hand shaka: the disc is put away, a cyan baton rezzes
//   32.0 - 32.5  both hands bring their batons together end to end: linked
//                (~32.6); pulled apart (33.0 - 33.4) they rez a big light
//                cycle, orange with cyan wheels (~33.1)
//         34.3   right hand rock: back to TRON cyan
//   35.3 - 38.0  both palms open again: portal (continues into the next loop)
import { POSES, blendPoses, poseToLandmarks } from '../../gestures.js';

export const DEMO_LOOP = 38;
const PALM = 0.13;   // palm length, as hands.js uses for procedural hands
const PALM_POINTS = [0, 5, 9, 13, 17];
const ROLL = { left: -0.08, right: 0.08 };
// batons held level: hands turned outwards so thumb and pinky line up
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
  tip(7.0, 0.74, 0.17, 'open'),
  key(7.35, 0.77, 0.58, 'open'),
  key(7.6, 0.76, 0.6, 'ok'),
  key(8.55, 0.76, 0.6, 'ok'),
  key(8.75, 0.79, 0.6, 'ok'),             // a small wind-up ...
  key(9.0, 0.65, 0.6, 'ok', { ease: 'linear' }),   // ... and an ordinary flick, about 1 view unit/s
  key(9.3, 0.66, 0.6, 'open'),
  key(9.8, 0.72, 0.6, 'open'),            // waits, open, for the disc
  key(11.1, 0.72, 0.62, 'open'),
  key(11.35, 0.72, 0.62, 'ok'),           // closes the ok around the disc ...
  key(11.55, 0.72, 0.62, 'ok'),
  key(11.95, 0.64, 0.62, 'open', { ease: 'linear' }),   // ... and opens it while moving in: released
  key(12.4, 0.66, 0.62, 'open'),
  key(13.1, 0.72, 0.6, 'open'),           // open, waiting for the disc to come back
  key(14.6, 0.72, 0.6, 'open'),
  key(14.8, 0.72, 0.6, 'fist'),
  key(15.1, 0.72, 0.6, 'fist'),
  key(15.4, 0.74, 0.56, 'thumbsUp', { roll: THUMBS_UP_ROLL.right }),
  key(16.1, 0.74, 0.56, 'thumbsUp', { roll: THUMBS_UP_ROLL.right }),
  hidden(16.2),
  key(19.8, 0.76, 0.52, 'open'),
  key(20.05, 0.76, 0.5, 'peace'),
  key(20.6, 0.76, 0.5, 'peace'),
  key(20.9, 0.78, 0.56, 'open'),          // rests at the side while the laser scans
  key(24.3, 0.78, 0.58, 'open'),
  tip(24.6, 0.64, 0.3, 'open'),
  tip(24.85, 0.64, 0.3, 'point'),
  ...path(25.05, 0.5, [[0.64, 0.3], [0.64, 0.72]]),
  tip(26.05, 0.64, 0.72, 'point'),
  key(26.35, 0.8, 0.5, 'open'),
  key(26.6, 0.8, 0.5, 'shaka'),           // a baton
  key(27.3, 0.8, 0.5, 'shaka'),
  key(27.6, 0.52, 0.5, 'shaka', { ease: 'linear' }),   // the swing: cuts the wall
  key(28.0, 0.76, 0.5, 'shaka'),          // holds it out for the disc
  key(30.9, 0.76, 0.5, 'shaka'),
  key(31.5, 0.72, 0.55, 'shaka', { roll: BATON_ROLL.right }),
  key(32.0, 0.72, 0.55, 'shaka', { roll: BATON_ROLL.right }),
  key(32.5, 0.54, 0.55, 'shaka', { roll: BATON_ROLL.right }),   // end to end with the other baton
  key(33.0, 0.54, 0.55, 'shaka', { roll: BATON_ROLL.right }),
  key(33.4, 0.68, 0.55, 'shaka', { roll: BATON_ROLL.right }),   // pulled apart: a light cycle
  key(33.7, 0.7, 0.56, 'open'),
  key(34.0, 0.72, 0.56, 'open'),
  key(34.25, 0.72, 0.56, 'rock'),
  key(34.7, 0.72, 0.56, 'rock'),
  key(34.9, 0.7, 0.6, 'open'),
  key(35.5, 0.66, 0.64, 'open'),
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
  key(9.75, 0.27, 0.64, 'fist'),          // comes back as a fist: derezz
  key(10.2, 0.27, 0.64, 'fist'),
  key(10.55, 0.27, 0.62, 'ok'),
  key(11.55, 0.27, 0.62, 'ok'),
  key(11.95, 0.35, 0.62, 'open', { ease: 'linear' }),
  key(12.4, 0.34, 0.62, 'open'),
  key(13.1, 0.28, 0.6, 'open'),
  key(14.6, 0.28, 0.6, 'open'),
  key(14.8, 0.28, 0.6, 'fist'),
  key(15.1, 0.28, 0.6, 'fist'),
  key(15.5, 0.26, 0.56, 'thumbsUp', { roll: THUMBS_UP_ROLL.left }),
  key(16.4, 0.26, 0.56, 'thumbsUp', { roll: THUMBS_UP_ROLL.left }),
  hidden(16.5),
  key(25.2, 0.3, 0.52, 'open'),
  key(25.45, 0.3, 0.52, 'ok'),
  key(27.95, 0.3, 0.52, 'ok'),
  key(28.1, 0.28, 0.52, 'ok'),            // wind-up ...
  key(28.35, 0.42, 0.52, 'ok', { ease: 'linear' }),   // ... and a flick through the gap
  key(28.55, 0.4, 0.52, 'open'),
  key(29.2, 0.3, 0.52, 'open'),           // open, so the disc comes home to it
  key(31.3, 0.3, 0.55, 'open'),
  key(31.55, 0.3, 0.55, 'shaka', { roll: BATON_ROLL.left }),
  key(32.0, 0.28, 0.55, 'shaka', { roll: BATON_ROLL.left }),
  key(32.5, 0.46, 0.55, 'shaka', { roll: BATON_ROLL.left }),
  key(33.0, 0.46, 0.55, 'shaka', { roll: BATON_ROLL.left }),
  key(33.4, 0.32, 0.55, 'shaka', { roll: BATON_ROLL.left }),
  hidden(33.6),
  key(35.3, 0.34, 0.66, 'open'),
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
