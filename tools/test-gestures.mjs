// Checks the gesture classifier against the procedural hand: every pose must
// be recognised for both hands, palm in or out, and with the hand tilted.
//   node tools/test-gestures.mjs
import { POSES, poseToLandmarks, analyzeHand, blendPoses, detectFrame } from '../src/gestures.js';

const EXPECTED = {
  open: 'open', fist: 'fist', point: 'point', peace: 'peace', ok: 'ok', pinch: 'pinch', shaka: 'shaka',
  // touching a fingertip bends that finger, so the hand stops counting as open
  tapMiddle: 'open', tapRing: 'open', tapPinky: 'three',
  // one hand of the photo frame is a point with the thumb out; the frame takes both hands
  three: 'three', frame: 'point',
};
const TAPPED = { tapMiddle: 'middle', tapRing: 'ring', tapPinky: 'pinky', ok: 'index', pinch: 'index' };

let failures = 0;
let checks = 0;
function check(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.log(`FAIL ${message}`);
  }
}

for (const physical of ['left', 'right']) {
  for (const palmFacing of [true, false]) {
    for (const roll of [0, 0.5, -0.6]) {
      for (const [name, pose] of Object.entries(POSES)) {
        const where = `${name} (${physical}, palm ${palmFacing ? 'in' : 'out'}, roll ${roll})`;
        const result = analyzeHand(poseToLandmarks({ x: 1, y: 0.5, size: 0.13, roll, physical, palmFacing }, pose), physical);
        check(result.gesture === EXPECTED[name], `${where}: got ${result.gesture}, expected ${EXPECTED[name]}`);
        check(result.palmFacing === palmFacing, `${where}: palmFacing ${result.palmFacing}`);
        for (const finger of ['index', 'middle', 'ring', 'pinky']) {
          const touching = result.touch[finger] < 0.3;
          check(touching === (TAPPED[name] === finger), `${where}: ${finger} touch ${result.touch[finger].toFixed(2)}`);
        }
      }
    }
  }
}

// a fist with the thumb pressed against the index finger is still a fist, not a pinch
for (const physical of ['left', 'right']) {
  for (const reach of [0.6, 0.8, 1]) {
    const pose = { curl: POSES.fist.curl, touch: { index: reach } };
    const result = analyzeHand(poseToLandmarks({ x: 1, y: 0.5, size: 0.13, physical }, pose), physical);
    check(result.gesture === 'fist',
      `fist with thumb on index (${physical}, reach ${reach}): got ${result.gesture}, touch ${result.touch.index.toFixed(2)}`);
  }
}

// opening a pinch should pass through pinch -> open without other gestures in between
const sweep = [0, 0.25, 0.5, 0.75, 1].map((amount) => analyzeHand(
  poseToLandmarks({ x: 1, y: 0.5, size: 0.13, physical: 'right' }, blendPoses(POSES.pinch, POSES.open, amount)),
  'right').gesture);
check(sweep.every((gesture) => gesture === 'pinch' || gesture === 'open'), `pinch -> open sweep: ${sweep.join(' ')}`);

// The two-hand photo frame: two Ls at opposite corners, opening towards each
// other. Hands are placed by palm centre in hand space (x, y; y down).
const hand = (physical, x, y, pose, { roll = 0, palmFacing = true, size = 0.13 } = {}) => {
  const points = poseToLandmarks({ x, y, size, roll, physical, palmFacing }, pose);
  return { points, analysis: analyzeHand(points, physical) };
};
const HALF_TURN = Math.PI;
const QUARTER = Math.PI / 2;
const FRAMES = {
  // index fingers vertical: left palm in at the bottom left, right hand upside down, back out, top right
  'vertical': [['left', 0.7, 0.75, { roll: 0 }], ['right', 1.3, 0.3, { roll: HALF_TURN, palmFacing: false }]],
  // index fingers horizontal: the director's frame
  'horizontal': [['left', 0.7, 0.75, { roll: QUARTER, palmFacing: false }], ['right', 1.3, 0.3, { roll: -QUARTER }]],
  // the other diagonal: top left and bottom right
  'other diagonal': [['left', 0.7, 0.3, { roll: QUARTER }], ['right', 1.3, 0.75, { roll: -QUARTER, palmFacing: false }]],
  'wide (16:9)': [['left', 0.58, 0.72, { roll: 0 }], ['right', 1.42, 0.28, { roll: HALF_TURN, palmFacing: false }]],
};
for (const [name, hands] of Object.entries(FRAMES)) {
  for (const tilt of [0, 0.15, -0.15]) {
    for (const size of [0.1, 0.13, 0.16]) {
      const [a, b] = hands.map(([physical, x, y, options]) =>
        hand(physical, x, y, POSES.frame, { ...options, roll: options.roll + tilt, size }));
      check(detectFrame(a, b) !== null, `frame ${name} (tilt ${tilt}, palm ${size}): not detected`);
      check(detectFrame(b, a) !== null, `frame ${name} (tilt ${tilt}, palm ${size}, hands swapped): not detected`);
    }
  }
}

const NOT_FRAMES = {
  // pointing with both hands, thumbs in
  'two points': [['left', 0.7, 0.75, POSES.point, {}], ['right', 1.3, 0.3, POSES.point, { roll: HALF_TURN, palmFacing: false }]],
  // two Ls side by side, both index fingers up
  'two Ls up': [['left', 0.7, 0.5, POSES.frame, {}], ['right', 1.3, 0.5, POSES.frame, {}]],
  'two Ls up, staggered': [['left', 0.7, 0.75, POSES.frame, {}], ['right', 1.3, 0.3, POSES.frame, {}]],
  // finger guns pointing at each other, thumbs up
  'finger guns': [['left', 0.7, 0.5, POSES.frame, { roll: QUARTER, palmFacing: false }],
    ['right', 1.3, 0.5, POSES.frame, { roll: -QUARTER, palmFacing: false }]],
  'finger guns, staggered': [['left', 0.7, 0.7, POSES.frame, { roll: QUARTER, palmFacing: false }],
    ['right', 1.3, 0.35, POSES.frame, { roll: -QUARTER, palmFacing: false }]],
  // the right corners in the wrong places: the Ls open away from each other
  'corners swapped': [['left', 1.3, 0.3, POSES.frame, {}], ['right', 0.7, 0.75, POSES.frame, { roll: HALF_TURN, palmFacing: false }]],
  // a frame too small to be one: the hands nearly touch
  'hands together': [['left', 0.93, 0.56, POSES.frame, {}], ['right', 1.07, 0.44, POSES.frame, { roll: HALF_TURN, palmFacing: false }]],
  // only one hand makes an L
  'one L': [['left', 0.7, 0.75, POSES.frame, {}], ['right', 1.3, 0.3, POSES.open, { roll: HALF_TURN, palmFacing: false }]],
};
for (const [name, hands] of Object.entries(NOT_FRAMES)) {
  for (const tilt of [0, 0.2, -0.2]) {
    const [a, b] = hands.map(([physical, x, y, pose, options]) =>
      hand(physical, x, y, pose, { ...options, roll: (options.roll ?? 0) + tilt }));
    check(detectFrame(a, b) === null && detectFrame(b, a) === null, `not a frame: ${name} (tilt ${tilt}) was detected`);
  }
}

console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
