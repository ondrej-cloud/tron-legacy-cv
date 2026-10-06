// Scripted hands for demo mode: a 60 s loop that runs through every gesture,
// with a light cycle ride in the middle (about 25 s, while the loop holds).
// The hands are procedural (gestures.js) and go through the same analysis as
// camera hands, so this exercises the real gesture rules. Like a real hand,
// the palm stays put while the fingers change pose: keyframes place the palm
// where an open hand's pinch point would be (or place the index fingertip,
// for drawing; see key() below). While riding, the hands are two fists on
// the handlebars, steered by an autopilot (see GRIP below). ?demoat=<s>
// starts the loop that far in.
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
//   23.6 - 24.0  right hand rock: back to TRON cyan (so the ride is TRON's)
//   24.9 - 25.9  right hand draws a wall
//         25.5   left hand makes "ok": a cyan disc
//         26.6   right hand shaka: a cyan baton rezzes with light traces
//   27.3 - 27.6  it swings left through the wall and cuts a gap in it
//         28.2   left hand flicks: the baton bats the disc away (~28.6)
//         ~31.3  the disc can't come home (the hand is gone) and fades out
//   31.7 - 32.2  left hand comes to the baton's free end: GRAB (~32.4)
//   32.6 - 33.1  the hands pull apart: the bar fills, the baton splits into its
//                two handles and a light cycle rezzes between the hands, its
//                back to the camera
//         33.1   RIDE (ride/index.js): the loop holds here while it lasts. In
//                seconds from the split (the match plays out the same way
//                every time, at 60 fps; slower below that):
//                 +0.0  the hands close into fists on the handlebars while the
//                       cycle rezzes
//                 +0.9  hop on: the arena takes over around the half-built
//                       cycle and the camera pushes in behind it, into the
//                       seat; the camera picture shrinks into a corner
//                 +2.1  round 1: 3, 2, 1 (CLU rezzes at the far end), GO (+4.5);
//                       the fists tilt to steer, push forward to speed up,
//                       pull back to brake (the rear-view mirror comes up).
//                       CLU opens with a jump off the kicker ahead of it,
//                       hunts, then boxes the player in; the radar and the
//                       arrow at the screen's edge follow it
//                +14.7  CLU is cut off by the player's jetwall: CLU DEREZZED,
//                       then the kill-cam replays it in slow motion
//                +20.1  TRON WINS: the score, the match's numbers, and the
//                       rematch / END OF LINE prompts; demo mode carries on
//                +23.6  the arena breaks up into voxels, the camera picture
//                       grows back and the Grid boots (+25.0); on from 34.3
//         34.9   right hand rock: CLU orange
//   35.6 - 37.4  both hands draw one more wall each, beside the person
//   37.6 - 39.3  left hand makes "ok" (a cyan disc, ready ~38.3) and flicks it
//                (~39.15) at the right hand, which waits pinching in its way:
//                PINCH, it snatches the disc out of the air (~39.5)
//   39.75- 41.05 left hand pinches its own wall: GRAB (~40.0), the wall glows,
//                and the whole wall is dragged down and let go (~41.2)
//         41.45  left hand, three fingers: the RECOGNIZER (~41.8) flies in from
//                the left, slows down over the middle, sweeps its cone of light
//                over the floor and flies off to the right (~47.4). The wall
//                that was dragged down derezzes in its cone (~44.3)
//   43.75- 45.3  both hands frame a picture, an L at the top left (upside down,
//                back of the hand) and one at the bottom right: the viewfinder
//                charges, SNAPSHOT (~44.55): a flash and a thumbnail sliding into
//                the corner (demo mode saves nothing). The cone derezzes the
//                disc in the right hand (~44.8)
//   47.25- 48.0  both fists come together and hold: END OF LINE (~48.0)
//   48.0 - 51.2  the Grid powers down: a derezz wave around the fists, then
//                the walls go out run by run (~48.5 - 49.9), the HUD pieces
//                switch off one by one (~48.6 - 49.4), the floor goes dark
//                row by row (48.8 - 50.2), the horizon shrinks to a dot
//                (50.2 - 51.15)
//   51.35- 53.45 END OF LINE is typed in the dark, holds, collapses to a dot
//         54.0   (in the app: back to the intro.) In demo mode, after half a
//                second of darkness the Grid boots in place (54.5 - 56.1)
//   56.4 - 59.6  both palms open again: portal (continues into the next loop)
import { POSES, blendPoses, poseToLandmarks } from '../../gestures.js';

export const DEMO_LOOP = 59.6;
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

// Keyframes place the hand by one of its points: `key` by where an open
// hand's pinch point would be (so the palm stays put while the fingers
// change), `tip` by the index fingertip, `grip` by this pose's own pinch
// point (thumb and index tips) and `palm` by the palm centre.
const key = (t, x, y, pose, options = {}) => ({ t, x, y, pose, anchor: 'pinch', ease: 'smooth', ...options });
const tip = (t, x, y, pose, options = {}) => key(t, x, y, pose, { anchor: 'tip', ...options });
const grip = (t, x, y, pose, options = {}) => key(t, x, y, pose, { anchor: 'grip', ...options });
const palm = (t, x, y, pose, options = {}) => key(t, x, y, pose, { anchor: 'palm', ...options });
const hidden = (t) => ({ t, hidden: true });
// the photo frame's Ls: the right hand's at the bottom right, palm out,
// index up and thumb pointing left; the left hand's at the top left, upside
// down and showing its back, index down and thumb pointing right
const FRAME_LEFT = { roll: Math.PI, palmFacing: false };
const FRAME_RIGHT = { roll: 0 };

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
  key(23.4, 0.78, 0.58, 'open'),
  key(23.6, 0.78, 0.58, 'rock'),          // back to TRON cyan: its baton's cycle will be cyan
  key(24.0, 0.78, 0.58, 'rock'),
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
  tip(37.55, 0.62, 0.45, 'open'),
  grip(37.95, 0.75, 0.68, 'open'),        // waits in the way of the left hand's disc ...
  grip(38.85, 0.75, 0.68, 'open'),
  grip(39.0, 0.75, 0.68, 'pinch'),        // ... pinching: snatches it as it flies by (~39.6)
  grip(43.6, 0.75, 0.68, 'pinch'),        // and keeps it
  palm(44.0, 0.7, 0.74, 'frame', FRAME_RIGHT),   // the bottom right corner of a frame
  palm(45.3, 0.7, 0.74, 'frame', FRAME_RIGHT),   // (the cone derezzes the disc in it, ~45.0)
  grip(45.7, 0.75, 0.68, 'pinch'),
  grip(46.9, 0.75, 0.68, 'pinch'),
  key(47.25, 0.56, 0.55, 'fist'),         // the two fists come together ...
  key(47.55, 0.505, 0.58, 'fist'),
  key(49.5, 0.505, 0.58, 'fist'),         // ... and hold: END OF LINE, while the HUD switches off
  hidden(49.6),
  key(56.4, 0.66, 0.64, 'open'),
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
  tip(37.6, 0.38, 0.45, 'ok'),            // never open here, or the open right hand makes a portal
  key(37.9, 0.3, 0.62, 'ok'),             // an identity disc (ready ~38.6)
  key(38.95, 0.3, 0.62, 'ok'),
  key(39.05, 0.28, 0.62, 'ok'),           // wind-up ...
  key(39.3, 0.42, 0.62, 'ok', { ease: 'linear' }),   // ... and a flick at the right hand
  key(39.45, 0.4, 0.62, 'open'),
  grip(39.75, 0.33, 0.43, 'open'),        // to its wall ...
  grip(39.9, 0.33, 0.43, 'pinch'),        // ... pinches it: GRAB (~40.1)
  grip(40.2, 0.33, 0.43, 'pinch'),
  grip(40.9, 0.4, 0.6, 'pinch'),          // drags the whole wall down
  grip(41.05, 0.4, 0.6, 'open'),          // and lets go
  key(41.3, 0.3, 0.6, 'open'),
  key(41.45, 0.3, 0.6, 'three'),          // three fingers: the Recognizer (~41.85)
  key(43.5, 0.3, 0.6, 'three'),
  key(43.75, 0.31, 0.46, 'three', { roll: 1.6, palmFacing: false }),   // turns the hand over ...
  palm(44.0, 0.31, 0.3, 'frame', FRAME_LEFT),    // ... into the top left corner: SNAPSHOT (~44.7)
  palm(45.3, 0.31, 0.3, 'frame', FRAME_LEFT),
  key(45.7, 0.27, 0.62, 'open'),
  key(46.9, 0.27, 0.62, 'open'),
  key(47.25, 0.44, 0.55, 'fist'),
  key(47.55, 0.495, 0.58, 'fist'),
  key(49.5, 0.495, 0.58, 'fist'),
  hidden(49.6),
  key(56.4, 0.34, 0.66, 'open'),
  key(DEMO_LOOP, 0.365, 0.62, 'open'),
];

// While riding, the demo's hands hold the handlebars: two fists side by
// side, the line between them tilted to steer and pushed towards the camera
// (bigger palms) to speed up. They go through hands.js and handlebars.js
// like camera hands would.
const GRIP = {
  x: 0.5, y: 0.6,          // the middle of the bars, viewport
  gap: 0.46,               // between the palms, in frame heights (about 3.5 palm lengths)
  reach: 0.9,              // s the hands take to reach the bars
  roll: { left: 0.35, right: -0.35 },
};
// the timeline goes on here after a ride (just after the baton split)
const RIDE_RESUME = 34.3;

// ride: the ride mode (ride/index.js), whose demoInput() says what the
// hands on the handlebars should do
export function createDemo({ ride = null } = {}) {
  let currentTime = 0;
  // ?demoat=<s>: start the loop that far in (screenshots of a later part)
  const startAt = Number(new URLSearchParams(location.search).get('demoat')) || 0;
  let offset = -startAt;     // demo clock time minus timeline time
  let paused = null;         // { at: timeline time, since: clock time } while riding

  // Viewport offsets from the pinch midpoint (what hands.js positions) to the
  // index fingertip and to the palm centre, for a pose.
  function offsets(pose, physical, roll, aspect, size = PALM, palmFacing = true) {
    const points = poseToLandmarks({ x: 0, y: 0, size, roll, physical, palmFacing }, pose);
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
  const facingOf = (frame) => frame.palmFacing ?? true;

  // where a keyframe puts the palm centre
  function palmPoint(frame, physical, aspect) {
    if (frame.anchor === 'palm') return { x: frame.x, y: frame.y };
    const own = offsets(DEMO_POSES[frame.pose], physical, rollOf(frame, physical), aspect, PALM, facingOf(frame));
    if (frame.anchor === 'tip') {
      return { x: frame.x - own.tip.x + own.palm.x, y: frame.y - own.tip.y + own.palm.y };
    }
    if (frame.anchor === 'grip') return { x: frame.x + own.palm.x, y: frame.y + own.palm.y };
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
    // a hand turning its palm away flips over halfway
    const palmFacing = facingOf(smooth < 0.5 ? from : target);
    const pose = blendPoses(DEMO_POSES[from.pose], DEMO_POSES[target.pose], smooth);
    const palm = offsets(pose, physical, roll, aspect, PALM, palmFacing).palm;
    return {
      x: a.x + (b.x - a.x) * moveAmount - palm.x + tremorX,
      y: a.y + (b.y - a.y) * moveAmount - palm.y + tremorY,
      physical,
      roll,
      palmFacing,
      pose,
    };
  }

  // A fist on the handlebars. steer -1..1 and throttle 0..1 as handlebars.js
  // reads them back; reach 0..1 blends from where the hand was (`from`).
  function onBars(physical, input, reach, from, aspect) {
    const tilt = Math.abs(input.steer) < 0.02 ? 0 : Math.sign(input.steer) * (4.5 + Math.abs(input.steer) * 24);
    const angle = (tilt * Math.PI) / 180;
    const side = physical === 'left' ? -1 : 1;
    // palm size: 1 at neutral, bigger pushed forward, smaller pulled back
    const ratio = input.brake ? 0.8 : 1 + (input.throttle - 0.5) * 0.9;
    const size = PALM * ratio;
    const roll = GRIP.roll[physical];
    const palm = offsets(POSES.fist, physical, roll, aspect, size).palm;
    const palmX = GRIP.x + (side * GRIP.gap / 2) * Math.cos(angle) / aspect;
    const palmY = GRIP.y + (side * GRIP.gap / 2) * Math.sin(angle);
    const target = { x: palmX - palm.x, y: palmY - palm.y, physical, roll, palmFacing: true, pose: POSES.fist, size };
    if (!from || reach >= 1) return target;
    const t = reach * reach * (3 - 2 * reach);
    return {
      ...target,
      x: from.x + (target.x - from.x) * t,
      y: from.y + (target.y - from.y) * t,
      roll: from.roll + (roll - from.roll) * t,
      pose: blendPoses(from.pose, POSES.fist, t),
    };
  }

  function rideHands(input, t, aspect) {
    if (input.away) return [];   // let go: the match is over
    const reach = Math.min(1, (t - paused.since) / GRIP.reach);
    return ['left', 'right'].map((physical) => {
      const from = sample(physical === 'left' ? LEFT : RIGHT, paused.at, physical, aspect);
      return onBars(physical, input, reach, from, aspect);
    });
  }

  return {
    get time() {
      return currentTime;
    },
    script(t) {
      const aspect = window.innerWidth / Math.max(1, window.innerHeight);
      // a ride holds the timeline where it is, however long it takes
      const input = ride?.demoInput();
      if (input) {
        paused ??= { at: (t - offset) % DEMO_LOOP, since: t };
        currentTime = paused.at;
        return rideHands(input, t, aspect);
      }
      if (paused) {
        // after a baton ride, on from just after the split
        offset = t - (paused.at > 31 ? RIDE_RESUME : paused.at);
        paused = null;
      }
      currentTime = (t - offset) % DEMO_LOOP;
      return [sample(LEFT, currentTime, 'left', aspect), sample(RIGHT, currentTime, 'right', aspect)]
        .filter(Boolean);
    },
  };
}
