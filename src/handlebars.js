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

// Waiting for a steady grip before a ride starts: both hands holding on,
// roughly level and not moving towards or away from the camera, for `hold`
// seconds. A blink of the tracker is bridged rather than starting over.
export const GRIP_CHECK = {
  hold: 0.8,              // s of steady grip it waits for
  maxTilt: 12,            // degrees: tilted further, the hands are steering, not holding still
  maxDrift: 0.12,         // palm size change (fraction) between a quick and a slow average
  forgive: 0.15,          // s a broken reading is bridged
};

export function createGripCheck(options = {}) {
  const settings = { ...GRIP_CHECK, ...options };
  // progress: 0..1 of the hold; hint: what is in the way, '' when nothing is
  const result = { progress: 0, steady: false, hint: 'need both hands', reading: null };
  let held = 0;
  let lost = 0;
  let quick = 0;          // palm size, averaged over a short and a longer time
  let slow = 0;

  function reset() {
    held = 0;
    lost = 0;
    quick = 0;
    slow = 0;
    result.progress = 0;
    result.steady = false;
  }

  // Call once per frame after hands.update(); returns the result object.
  function update(hands, dt, aspect = window.innerWidth / window.innerHeight) {
    const reading = measureHandlebars(hands.left, hands.right, aspect);
    result.reading = reading;
    let still = reading.valid;
    let hint = reading.reason;
    if (reading.valid) {
      quick = quick ? quick + (reading.size - quick) * Math.min(1, dt / 0.1) : reading.size;
      slow = slow ? slow + (reading.size - slow) * Math.min(1, dt / 0.5) : reading.size;
      if (Math.abs(reading.tilt) > settings.maxTilt) {
        still = false;
        hint = 'level your hands';
      } else if (Math.abs(quick - slow) / slow > settings.maxDrift) {
        still = false;
        hint = 'hold still';
      }
    }
    if (still) {
      lost = 0;
      held += dt;
    } else if ((lost += dt) > settings.forgive) {
      held = Math.max(0, held - dt * 2);
      if (!reading.valid) quick = slow = 0;
    }
    result.progress = Math.min(1, held / settings.hold);
    result.steady = held >= settings.hold;
    result.hint = hint;
    return result;
  }

  return { update, reset, state: result };
}
