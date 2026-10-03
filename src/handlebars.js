// Both hands as the handlebars of a light cycle.
//
//   steer     tilt of the line between the two hands, like turning handlebars:
//             the right hand lower than the left turns right
//   throttle  how far the hands are pushed towards the camera, read from the
//             palm size relative to where they were when the grip started
//             (0.5 = cruising, 1 = pushed forward, 0 = pulled back)
//   brake     hands pulled clearly back towards the body
//
// A grip needs both hands in view, at least half closed, and a handlebar's
// width apart. Fists close together are left alone: that's END OF LINE.

export const HANDLEBARS = {
  minCurl: 0.35,          // mean curl of the four fingers that counts as holding on
  minGap: 2.2,            // hands at least this far apart (palm lengths)...
  maxGap: 9,              // ...and at most this far
  steerDeadZone: 4,       // degrees of tilt that still count as straight
  steerFullAt: 28,        // degrees of tilt for a full turn
  throttleRange: 0.45,    // palm size change (fraction) from neutral to full throttle
  brakeBelow: 0.86,       // palm size ratio under which the cycle brakes
  baselineTime: 0.45,     // s the grip is averaged to find the neutral distance
  smoothing: 0.08,        // s, time constant for steer and throttle
  releaseAfter: 0.3,      // s a broken grip is bridged before letting go
};

const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const DEGREES = 180 / Math.PI;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function meanCurl(hand) {
  const curl = hand.fingers?.curl;
  if (!curl) return 0;
  return FINGERS.reduce((sum, finger) => sum + curl[finger], 0) / FINGERS.length;
}

// Palm centre (wrist to middle knuckle midpoint) in an aspect-corrected
// space, so tilt angles are true angles on screen.
function palmCentre(hand, aspect) {
  const wrist = hand.landmarks?.[0];
  const knuckle = hand.landmarks?.[9];
  if (!wrist || !knuckle) return { x: hand.x * aspect, y: hand.y };
  return { x: (wrist.x + knuckle.x) / 2 * aspect, y: (wrist.y + knuckle.y) / 2 };
}

// Raw reading of one frame, without smoothing or memory.
export function measureHandlebars(left, right, aspect = 16 / 9) {
  if (!left?.visible || !right?.visible) return { valid: false, reason: 'need both hands' };
  const a = palmCentre(left, aspect);
  const b = palmCentre(right, aspect);
  const palm = Math.max(1e-4, (left.size + right.size) / 2);
  const gap = Math.hypot(b.x - a.x, b.y - a.y) / palm;
  const curl = Math.min(meanCurl(left), meanCurl(right));
  // y grows downwards, so a lower right hand gives a positive angle: a right turn
  const tilt = Math.atan2(b.y - a.y, b.x - a.x) * DEGREES;
  const valid = curl >= HANDLEBARS.minCurl && gap >= HANDLEBARS.minGap && gap <= HANDLEBARS.maxGap;
  const reason = valid ? '' : curl < HANDLEBARS.minCurl ? 'close your hands'
    : gap < HANDLEBARS.minGap ? 'hands too close' : 'hands too far apart';
  return { valid, reason, tilt, gap, curl, size: palm };
}

export function steerFromTilt(tilt) {
  const magnitude = Math.abs(tilt) - HANDLEBARS.steerDeadZone;
  if (magnitude <= 0) return 0;
  return Math.sign(tilt) * clamp(magnitude / (HANDLEBARS.steerFullAt - HANDLEBARS.steerDeadZone), 0, 1);
}

export function throttleFromSize(ratio) {
  return clamp(0.5 + (ratio - 1) / HANDLEBARS.throttleRange * 0.5, 0, 1);
}

export function createHandlebars() {
  const state = {
    gripping: false,
    steer: 0,
    throttle: 0.5,
    brake: false,
    confidence: 0,
    hint: 'hold both hands up like handlebars',
    baseline: 0,          // palm size at the neutral position
    baselineTime: 0,
    lostTime: 0,
  };
  let baselineSum = 0;
  let baselineCount = 0;

  function release() {
    state.gripping = false;
    state.baseline = 0;
    state.baselineTime = 0;
    baselineSum = 0;
    baselineCount = 0;
  }

  // Call once per frame after hands.update(). Returns the state object.
  function update(hands, dt, aspect = window.innerWidth / window.innerHeight) {
    const reading = measureHandlebars(hands.left, hands.right, aspect);
    const ease = 1 - Math.exp(-dt / HANDLEBARS.smoothing);

    if (!reading.valid) {
      state.lostTime += dt;
      state.hint = reading.reason;
      if (state.lostTime > HANDLEBARS.releaseAfter) release();
      // ease back towards straight and cruising while not holding on
      state.steer += (0 - state.steer) * ease;
      state.throttle += (0.5 - state.throttle) * ease;
      state.brake = false;
      state.confidence = Math.max(0, state.confidence - dt * 3);
      return state;
    }

    state.lostTime = 0;
    state.gripping = true;
    state.hint = '';
    state.confidence = Math.min(1, state.confidence + dt * 4);

    // the first moments of a grip define "neutral" for the throttle
    if (state.baselineTime < HANDLEBARS.baselineTime) {
      state.baselineTime += dt;
      baselineSum += reading.size;
      baselineCount++;
      state.baseline = baselineSum / baselineCount;
    }

    const ratio = reading.size / state.baseline;
    const settled = state.baselineTime >= HANDLEBARS.baselineTime;
    const targetThrottle = settled ? throttleFromSize(ratio) : 0.5;
    state.steer += (steerFromTilt(reading.tilt) - state.steer) * ease;
    state.throttle += (targetThrottle - state.throttle) * ease;
    state.brake = settled && ratio < HANDLEBARS.brakeBelow;
    state.tilt = reading.tilt;
    state.gap = reading.gap;
    return state;
  }

  // Forget the neutral distance, e.g. when a new round starts.
  function recalibrate() {
    state.baselineTime = 0;
    baselineSum = 0;
    baselineCount = 0;
  }

  return { state, update, recalibrate };
}
