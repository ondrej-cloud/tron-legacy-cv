// Checks the gesture classifier against the procedural hand: every pose must
// be recognised for both hands, palm in or out, and with the hand tilted.
//   node tools/test-gestures.mjs
import { POSES, poseToLandmarks, analyzeHand, blendPoses } from '../src/gestures.js';

const EXPECTED = {
  open: 'open', fist: 'fist', point: 'point', peace: 'peace', ok: 'ok', pinch: 'pinch',
  // touching a fingertip bends that finger, so the hand stops counting as open
  tapMiddle: 'open', tapRing: 'open', tapPinky: 'three',
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

// opening a pinch should pass through pinch -> open without other gestures in between
const sweep = [0, 0.25, 0.5, 0.75, 1].map((amount) => analyzeHand(
  poseToLandmarks({ x: 1, y: 0.5, size: 0.13, physical: 'right' }, blendPoses(POSES.pinch, POSES.open, amount)),
  'right').gesture);
check(sweep.every((gesture) => gesture === 'pinch' || gesture === 'open'), `pinch -> open sweep: ${sweep.join(' ')}`);

console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
