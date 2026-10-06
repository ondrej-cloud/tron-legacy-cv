// Checks the handlebar reading against procedural hands: grip detection,
// steering from the tilt between the hands, and throttle from their distance
// to the camera.
//   node tools/test-handlebars.mjs
import { POSES, poseToLandmarks, analyzeHand } from '../src/gestures.js';
import { createGripCheck, createHandlebars, measureHandlebars, GRIP_CHECK, HANDLEBARS } from '../src/handlebars.js';

const ASPECT = 16 / 9;
let failures = 0;
let checks = 0;
function check(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.log(`FAIL ${message}`);
  }
}

// A hand as hands.js would report it: landmarks in viewport space (x 0..1 of
// the width), palm size as a fraction of the viewport height.
function hand(physical, x, y, { pose = POSES.fist, size = 0.13, roll = 0 } = {}) {
  const points = poseToLandmarks({ x: x * ASPECT, y, size, roll, physical }, pose);
  return {
    visible: true,
    physical,
    size,
    fingers: analyzeHand(points, physical),
    landmarks: points.map((point) => ({ x: point.x / ASPECT, y: point.y, z: point.z })),
  };
}

// Tilt of the line between the hands: right hand `drop` lower than the left.
function pair(drop, options = {}) {
  return { left: hand('left', 0.3, 0.55 - drop / 2, options), right: hand('right', 0.7, 0.55 + drop / 2, options) };
}

function settle(handlebars, hands, seconds = 1) {
  for (let t = 0; t < seconds; t += 1 / 60) handlebars.update(hands, 1 / 60, ASPECT);
  return handlebars.state;
}

// grip detection
check(measureHandlebars(...Object.values(pair(0)), ASPECT).valid, 'level fists a handlebar apart grip');
check(!measureHandlebars(...Object.values(pair(0, { pose: POSES.open })), ASPECT).valid, 'open hands do not grip');
const close = { left: hand('left', 0.47, 0.55), right: hand('right', 0.53, 0.55) };
check(!measureHandlebars(close.left, close.right, ASPECT).valid, 'fists together (END OF LINE) do not grip');
check(!measureHandlebars(hand('left', 0.3, 0.5), { visible: false }, ASPECT).valid, 'one hand does not grip');

// steering
{
  const level = settle(createHandlebars(), pair(0));
  check(level.gripping && Math.abs(level.steer) < 0.05, `level grip steers straight (steer ${level.steer.toFixed(2)})`);
  // a 0.35 drop across the hands' spread is a ~26° tilt, 0.18 is ~14°
  const right = settle(createHandlebars(), pair(0.35));
  check(right.steer > 0.75, `right hand lower turns right (steer ${right.steer.toFixed(2)})`);
  const left = settle(createHandlebars(), pair(-0.35));
  check(left.steer < -0.75, `left hand lower turns left (steer ${left.steer.toFixed(2)})`);
  const gentle = settle(createHandlebars(), pair(0.18));
  check(gentle.steer > 0.25 && gentle.steer < 0.6, `a gentle tilt turns gently (steer ${gentle.steer.toFixed(2)})`);
  const slight = settle(createHandlebars(), pair(0.03));
  check(Math.abs(slight.steer) < 0.1, `a slight tilt stays in the dead zone (steer ${slight.steer.toFixed(2)})`);
}

// throttle and brake: grip at a neutral distance, then push forward or pull back
{
  const handlebars = createHandlebars();
  settle(handlebars, pair(0), HANDLEBARS.baselineTime + 0.2);
  const neutral = handlebars.state.throttle;
  check(Math.abs(neutral - 0.5) < 0.05, `neutral grip cruises (throttle ${neutral.toFixed(2)})`);
  const pushed = settle(handlebars, pair(0, { size: 0.13 * 1.35 }));
  check(pushed.throttle > 0.85 && !pushed.brake, `pushing towards the camera speeds up (throttle ${pushed.throttle.toFixed(2)})`);
  const pulled = settle(handlebars, pair(0, { size: 0.13 * 0.8 }));
  check(pulled.brake && pulled.throttle < 0.3, `pulling back brakes (throttle ${pulled.throttle.toFixed(2)})`);
}

// letting go: a short dropout is bridged, a longer one releases the grip
{
  const handlebars = createHandlebars();
  settle(handlebars, pair(0.18));
  const gone = { left: { visible: false }, right: { visible: false } };
  settle(handlebars, gone, HANDLEBARS.releaseAfter * 0.5);
  check(handlebars.state.gripping, 'a short dropout keeps the grip');
  settle(handlebars, gone, 1);
  check(!handlebars.state.gripping && Math.abs(handlebars.state.steer) < 0.1, 'a long dropout lets go and straightens');
}

// waiting for a steady grip before a ride
{
  const run = (check, frames, seconds) => {
    for (let t = 0; t < seconds; t += 1 / 60) check.update(typeof frames === 'function' ? frames(t) : frames, 1 / 60, ASPECT);
    return check.state;
  };
  const steady = run(createGripCheck(), pair(0), GRIP_CHECK.hold + 0.1);
  check(steady.steady && steady.progress === 1 && steady.hint === '', 'a level grip held still is steady');
  const early = run(createGripCheck(), pair(0), GRIP_CHECK.hold * 0.5);
  check(!early.steady && early.progress > 0.3 && early.progress < 0.7, `it takes the whole hold (progress ${early.progress.toFixed(2)})`);
  const open = run(createGripCheck(), pair(0, { pose: POSES.open }), 1);
  check(!open.steady && open.hint === 'close your hands', `open hands are not a grip (${open.hint})`);
  const tilted = run(createGripCheck(), pair(0.35), 1);
  check(!tilted.steady && tilted.hint === 'level your hands', `a tilted grip is steering, not holding still (${tilted.hint})`);
  // pushing towards the camera and back, about once a second
  const pumping = run(createGripCheck(), (t) => pair(0, { size: 0.13 * (1 + 0.3 * Math.sin(t * 6)) }), 1.5);
  check(!pumping.steady && pumping.progress < 1, `hands moving towards the camera are not still (${pumping.hint})`);
  // a one-frame dropout halfway is bridged; a long one starts over
  const gone = { left: { visible: false }, right: { visible: false } };
  const blink = run(createGripCheck(), (t) => (Math.abs(t - 0.4) < 0.01 ? gone : pair(0)), GRIP_CHECK.hold + 0.1);
  check(blink.steady, 'a tracker blink does not start the hold over');
  const away = createGripCheck();
  run(away, pair(0), GRIP_CHECK.hold * 0.8);
  run(away, gone, 1);
  check(away.state.progress === 0 && away.state.hint === 'need both hands', 'letting go starts the hold over');
}

console.log(`${checks - failures}/${checks} handlebar checks passed`);
process.exit(failures ? 1 : 0);
