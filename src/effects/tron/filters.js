// One Euro filter (Casiez, Roussel and Vogel, 2012): strong smoothing while a
// point is nearly still, which hides tracker jitter, and little lag once it
// moves fast. Used on the fingertip that draws the light walls.
export class OneEuroFilter {
  constructor({ minCutoff = 1.0, beta = 4, derivativeCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.derivativeCutoff = derivativeCutoff;
    this.value = null;
    this.derivative = 0;
  }

  reset(value) {
    this.value = value;
    this.derivative = 0;
  }

  filter(value, dt) {
    if (this.value === null) {
      this.reset(value);
      return value;
    }
    const rawDerivative = (value - this.value) / dt;
    this.derivative += (rawDerivative - this.derivative) * smoothingFactor(dt, this.derivativeCutoff);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.derivative);
    this.value += (value - this.value) * smoothingFactor(dt, cutoff);
    return this.value;
  }
}

// A tracked point for drawing with. The median of the last three tracker
// observations removes single-frame outliers of any size, the One Euro filter
// removes jitter, and a jump that survives the median is held off for a few
// frames in case it is a glitch. Positions and velocity in view units.
export class PointFilter {
  constructor({ minCutoff = 1.2, beta = 3, maxJump = 0.15, glitchFrames = 6 } = {}) {
    this.x = new OneEuroFilter({ minCutoff, beta });
    this.y = new OneEuroFilter({ minCutoff, beta });
    this.maxJump = maxJump;
    this.glitchFrames = glitchFrames;
    this.recent = [];
    this.position = { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };
    this.held = 0;
  }

  reset(point) {
    this.recent = [{ x: point.x, y: point.y }];
    this.x.reset(point.x);
    this.y.reset(point.y);
    this.position.x = point.x;
    this.position.y = point.y;
    this.velocity.x = this.velocity.y = 0;
    this.held = 0;
  }

  // `fresh`: the tracker delivered a new observation since the last call
  update(point, fresh, dt) {
    if (fresh) {
      this.recent.push({ x: point.x, y: point.y });
      if (this.recent.length > 3) this.recent.shift();
    }
    const target = {
      x: median(this.recent.map((sample) => sample.x)),
      y: median(this.recent.map((sample) => sample.y)),
    };
    const jump = Math.hypot(target.x - this.position.x, target.y - this.position.y);
    if (jump > this.maxJump && this.held < this.glitchFrames) {
      this.held++;
      return this.position;
    }
    if (this.held >= this.glitchFrames) this.reset(target);
    this.held = 0;
    const previousX = this.position.x;
    const previousY = this.position.y;
    this.position.x = this.x.filter(target.x, dt);
    this.position.y = this.y.filter(target.y, dt);
    this.velocity.x = easeTowards(this.velocity.x, (this.position.x - previousX) / dt, dt, 0.05);
    this.velocity.y = easeTowards(this.velocity.y, (this.position.y - previousY) / dt, dt, 0.05);
    return this.position;
  }
}

// Velocity of a tracked point over a short window of recent observations
// rather than a single frame: robust to the jitter of a 30 fps tracker, and
// quick enough to catch a flick. Positions in view units, times in seconds.
export class VelocityWindow {
  constructor(window = 0.1, keep = 0.3) {
    this.window = window;
    this.keep = keep;
    this.samples = [];
    this.velocity = { x: 0, y: 0 };
    this.speed = 0;
    this.displacement = 0;   // distance covered over the window
  }

  reset() {
    this.samples.length = 0;
    this.velocity.x = this.velocity.y = 0;
    this.speed = 0;
    this.displacement = 0;
  }

  // call only for new observations, not for repeated ones
  add(x, y, time) {
    const samples = this.samples;
    samples.push({ x, y, time });
    while (samples.length > 2 && time - samples[0].time > this.keep) samples.shift();
    // the newest sample at least `window` old, or the oldest one there is
    let reference = samples[0];
    for (let index = samples.length - 2; index >= 0; index--) {
      if (time - samples[index].time >= this.window) {
        reference = samples[index];
        break;
      }
    }
    const span = time - reference.time;
    if (span < 0.03) return this;
    this.velocity.x = (x - reference.x) / span;
    this.velocity.y = (y - reference.y) / span;
    this.speed = Math.hypot(this.velocity.x, this.velocity.y);
    this.displacement = this.speed * span;
    return this;
  }
}

function median(values) {
  if (values.length < 3) return values[values.length - 1];
  const [a, b, c] = values;
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

function smoothingFactor(dt, cutoff) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export function easeTowards(current, target, dt, timeConstant) {
  return current + (target - current) * (1 - Math.exp(-dt / timeConstant));
}

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
