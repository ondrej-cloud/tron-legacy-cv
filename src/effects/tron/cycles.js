// Light cycles. A thumbs-up launches one from the hand; pulling a light
// baton apart rezzes a big one between the hands (controls.js). Either way
// it rezzes in mid-air like in the film: concentric rings bloom where the
// front wheel will be, then the rear one; a holographic construction sweeps
// from front to back (wire lines, glitchy cubes, a scan line); the full
// wireframe flickers with its wheels spinning; then it solidifies into a
// dark body with white-hot rims, drops onto the Grid and rides off in
// smooth curves, leaving a glass wall (ribbon.js) in its hand's colour.
// After a few seconds, or when a derezz wave reaches it, it breaks into
// voxels and its wall fades. When the Grid powers down, cycles stop and go
// dark, and their walls go out stretch by stretch (powerDown()).
//
// Everything lives in the floor's grid space (x across, z into the frame,
// h up; see stage.js) and is projected to the view every frame. The layer
// can only add light, so the "dark" body is a black shape drawn over the
// Grid: it hides the floor lines and walls behind the bike, which reads as
// a solid, glossy black machine.
import * as THREE from 'three';
import { createRibbon } from './ribbon.js';
import { createLines } from './lines.js';
import { clamp, easeTowards, smoothstep } from './filters.js';
import { lightPower } from './endofline.js';

export const CYCLE = {
  speed: 1.3,              // floor units/s (bigger bikes ride a little faster)
  rideTime: [4.0, 4.8],    // s on the floor before it derezzes
  dropTime: 0.35,          // s from where it rezzed to the floor
  startDepth: { left: 2.0, right: 2.7, both: 2.25 },   // the two hands' cycles ride at different depths
  depthRange: [1.6, 3.8],
  sideMargin: 0.12,        // view units kept clear at the sides of the frame
  laneGap: 0.04,           // each hand's cycles keep to their half of the floor, this far from the middle
  turnRate: [0.8, 2.0],    // rad/s of a chosen curve ...
  straightChance: 0.3,     // ... or it rides straight for a while
  choiceEvery: [0.5, 1.1], // s between choices
  steerBack: 2.6,          // rad/s when heading out of its stretch of floor
  lookAhead: 0.35,         // floor units checked ahead for the edges of the arena
  wallHeight: 0.085,       // floor units, about as tall as the wheels
  sampleSpacing: 0.025,
  wallFade: 1.6,           // s after the cycle is gone
  hotTime: 0.35,
  maxCycles: 4,
  nearClip: 0.9,           // things fade out between this depth and half a unit further
};

// The rezz, in seconds since launch: [start, end] of each phase.
const REZZ = {
  frontRings: [0, 0.45],
  rearRings: [0.15, 0.6],
  build: [0.35, 1.05],
  wire: [1.05, 1.35],
  solid: [1.35, 1.7],
};

// The bike in its own frame: u forward from the back wheel's contact point,
// h up, s to the side. Floor units at scale 1.
const S = 1.4;
const WHEEL_RADIUS = 0.045 * S;
const WHEELS = [0.05 * S, 0.19 * S];   // rear, front
const TIRE = 0.017 * S;                // half the width of a tyre
const BODY_SIDE = 0.016 * S;
const BODY = [[-0.01, 0.035], [0.0, 0.062], [0.05, 0.088], [0.12, 0.09], [0.175, 0.078],
  [0.225, 0.058], [0.25, 0.034], [0.215, 0.02], [0.15, 0.024], [0.09, 0.024], [0.03, 0.02], [-0.01, 0.035]]
  .map(([u, h]) => [u * S, h * S]);
const BODY_TOP = BODY.slice(0, 6);
const BODY_BOTTOM = BODY.slice(6);
const FRONT = 0.25 * S;
const BACK = -0.015 * S;
export const BIKE_LENGTH = FRONT - BACK + 0.01 * S;
const RING_FRACTIONS = [0.35, 0.65, 1];

// Wireframe for the rezz: segments between [u, h, s] points, each with the
// u at which the construction sweep reveals it.
const WIRE = buildWire();

function buildWire() {
  const wire = [];
  const add = (a, b, kind) => wire.push({ a, b, kind, u: Math.max(a[0], b[0]) });
  const circle = (center, radius, s, count, kind) => {
    for (let k = 0; k < count; k++) {
      const a0 = (k / count) * Math.PI * 2;
      const a1 = ((k + 1) / count) * Math.PI * 2;
      add([center + Math.cos(a0) * radius, WHEEL_RADIUS + Math.sin(a0) * radius, s],
        [center + Math.cos(a1) * radius, WHEEL_RADIUS + Math.sin(a1) * radius, s], kind);
    }
  };
  for (const center of WHEELS) {
    for (const s of [-TIRE, TIRE]) {
      circle(center, WHEEL_RADIUS, s, 22, 'wheel');
      circle(center, WHEEL_RADIUS * 0.62, s, 14, 'wheel');
    }
    circle(center, WHEEL_RADIUS * 0.25, 0, 8, 'wheel');
    // the tread across the tyre
    for (let k = 0; k < 8; k++) {
      const angle = (k / 8) * Math.PI * 2;
      const u = center + Math.cos(angle) * WHEEL_RADIUS;
      const h = WHEEL_RADIUS + Math.sin(angle) * WHEEL_RADIUS;
      add([u, h, -TIRE], [u, h, TIRE], 'wheel');
    }
  }
  for (const s of [-BODY_SIDE, BODY_SIDE]) {
    const inset = 1;
    const centerU = 0.12 * S;
    const centerH = 0.055 * S;
    for (let k = 1; k < BODY.length; k++) {
      const point = (p) => [centerU + (p[0] - centerU) * inset, centerH + (p[1] - centerH) * inset, s];
      add(point(BODY[k - 1]), point(BODY[k]), 'body');
    }
  }
  for (const [u, h] of BODY) add([u, h, -BODY_SIDE], [u, h, BODY_SIDE], 'body');
  // forks from the hubs up into the body
  add([WHEELS[1], WHEEL_RADIUS, 0], BODY[5].concat(0), 'body');
  add([WHEELS[0], WHEEL_RADIUS, 0], BODY[1].concat(0), 'body');
  return wire;
}

const MAX_QUADS = 1600;
const FILL_TRIANGLES = (BODY.length + 2 * 20) * CYCLE.maxCycles;

const fillVertex = /* glsl */`
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fillFragment = /* glsl */`
  varying float vAlpha;
  uniform vec3 uTint;
  void main() {
    gl_FragColor = vec4(uTint, vAlpha);
  }
`;

export function createCycles({ view, teams, stage, voxels, flashes, log }) {
  const time = { value: 0 };
  const ribbon = createRibbon(MAX_QUADS, teams.colors, time, { body: 2.2 });
  ribbon.mesh.renderOrder = 0;
  const lines = createLines(view, 1600);
  lines.mesh.renderOrder = 2;

  // the dark body: drawn black over everything behind the bike
  const fillPositions = new Float32Array(FILL_TRIANGLES * 3 * 3);
  const fillAlpha = new Float32Array(FILL_TRIANGLES * 3);
  const fillGeometry = new THREE.BufferGeometry();
  fillGeometry.setAttribute('position', new THREE.BufferAttribute(fillPositions, 3).setUsage(THREE.DynamicDrawUsage));
  fillGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(fillAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  const fill = new THREE.Mesh(fillGeometry, new THREE.ShaderMaterial({
    vertexShader: fillVertex,
    fragmentShader: fillFragment,
    uniforms: { uTint: { value: new THREE.Color(0.012, 0.02, 0.026) } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  }));
  fill.frustumCulled = false;
  fill.renderOrder = 1;

  const group = new THREE.Group();
  group.add(ribbon.mesh, fill, lines.mesh);

  const cycles = [];
  const counts = { launched: 0, derezzed: 0 };
  const white = new THREE.Color(1, 1, 1);
  const glow = new THREE.Color();
  let now = 0;
  let fillCount = 0;
  let power = 1;   // the cycle being drawn: how lit it still is (the Grid powering down)

  const random = (range) => range[0] + Math.random() * (range[1] - range[0]);
  const window01 = (age, [start, end]) => clamp((age - start) / (end - start), 0, 1);

  // owner: the launching hand, or 'both' for a cycle rezzed from a baton
  // pulled apart (it rides the whole floor); at: where it rezzes, in view
  // units; team: the owner's team. options.length: the bike's length on
  // screen (view units) while it rezzes; options.accent colours its wheels.
  function launch(owner, at, team, { length = null, accent = null } = {}) {
    while (cycles.filter((cycle) => cycle.state !== 'gone').length >= CYCLE.maxCycles) {
      derezz(cycles.find((cycle) => cycle.state !== 'gone'));
    }
    const depth = CYCLE.startDepth[owner];
    const scale = length ? clamp(length * depth / BIKE_LENGTH, 0.8, 3.2) : 1;
    // facing across the frame, towards the middle of its lane
    const heading = owner === 'left' || (owner === 'both' && at.x < 0) ? 0 : Math.PI;
    const forward = Math.cos(heading);
    // centred on `at`: the middle of the bike, half its height up
    const x = stage.gridX(at.x, depth) - forward * ((FRONT + BACK) / 2) * scale;
    const height = Math.max(0, heightAt(at.y, depth) - 0.05 * S * scale);
    const cycle = {
      owner,
      scale,
      teamIndex: team.index,
      color: team.color.clone(),
      accent: (accent ?? team.color).clone(),
      state: 'rezz',
      start: now,
      x, z: stage.gridZ(depth), h: height, dropFrom: height, dropStart: 0,
      heading,
      turnRate: 0,
      turnTarget: 0,
      nextChoice: 0,
      spin: 0,
      rideUntil: Infinity,
      path: [],
      goneAt: Infinity,
      light: 0,
    };
    cycles.push(cycle);
    counts.launched++;
    log(`cycle ${owner[0].toUpperCase()}`);
    return cycle;
  }

  // the height above the floor at which a point at `depth` shows at view y
  function heightAt(viewY, depth) {
    const projected = stage.project(0, 0, stage.gridZ(depth));
    return (viewY - projected.y) * depth;
  }

  function pushPoint(cycle) {
    const last = cycle.path[cycle.path.length - 1];
    const along = last ? last.along + Math.hypot(cycle.x - last.x, cycle.z - last.z) : 0;
    cycle.path.push({ x: cycle.x, z: cycle.z, born: now, gone: false, along });
  }

  // the stretch of floor (view x) a hand's cycles ride in
  function lane(cycle) {
    const edge = view.aspect / 2 - CYCLE.sideMargin;
    if (cycle.owner === 'both') return [-edge, edge];
    return cycle.owner === 'left' ? [-edge, -CYCLE.laneGap] : [CYCLE.laneGap, edge];
  }

  function inArena(cycle, x, z) {
    const point = stage.project(x, 0, z);
    const [nearest, farthest] = CYCLE.depthRange;
    const [left, right] = lane(cycle);
    return point.depth > nearest && point.depth < farthest && point.x > left && point.x < right;
  }

  // Smooth curves: every so often it picks a turn rate (or none), and eases
  // into it; heading out of its stretch of floor it turns back towards the
  // middle of it.
  function ride(cycle, dt) {
    if (now >= cycle.rideUntil) {
      derezz(cycle);
      return;
    }
    if (now >= cycle.nextChoice) {
      cycle.turnTarget = Math.random() < CYCLE.straightChance ? 0
        : (Math.random() < 0.5 ? -1 : 1) * random(CYCLE.turnRate);
      cycle.nextChoice = now + random(CYCLE.choiceEvery);
    }
    const reach = CYCLE.lookAhead * cycle.scale;
    const aheadX = cycle.x + Math.cos(cycle.heading) * reach;
    const aheadZ = cycle.z + Math.sin(cycle.heading) * reach;
    if (!inArena(cycle, aheadX, aheadZ)) {
      const [left, right] = lane(cycle);
      const middleDepth = (CYCLE.depthRange[0] + CYCLE.depthRange[1]) / 2;
      const targetX = stage.gridX((left + right) / 2, middleDepth);
      const targetZ = stage.gridZ(middleDepth);
      const wanted = Math.atan2(targetZ - cycle.z, targetX - cycle.x);
      const difference = Math.atan2(Math.sin(wanted - cycle.heading), Math.cos(wanted - cycle.heading));
      cycle.turnTarget = Math.sign(difference) * CYCLE.steerBack;
      cycle.nextChoice = now + 0.35;
    }
    cycle.turnRate = easeTowards(cycle.turnRate, cycle.turnTarget, dt, 0.18);
    cycle.heading += cycle.turnRate * dt;
    const speed = CYCLE.speed * Math.sqrt(cycle.scale);
    const steps = Math.max(1, Math.ceil((speed * dt) / CYCLE.sampleSpacing));
    for (let step = 0; step < steps; step++) {
      cycle.x += Math.cos(cycle.heading) * speed * dt / steps;
      cycle.z += Math.sin(cycle.heading) * speed * dt / steps;
      const last = cycle.path[cycle.path.length - 1];
      if (Math.hypot(cycle.x - last.x, cycle.z - last.z) >= CYCLE.sampleSpacing) pushPoint(cycle);
    }
  }

  // bike frame [u, h, s] -> view units, for this cycle right now
  function projector(cycle) {
    const forwardX = Math.cos(cycle.heading);
    const forwardZ = Math.sin(cycle.heading);
    const size = cycle.scale;
    return (u, h, s) => stage.project(
      cycle.x + (forwardX * u - forwardZ * s) * size,
      cycle.h + h * size,
      cycle.z + (forwardZ * u + forwardX * s) * size);
  }

  function derezz(cycle) {
    if (!cycle || cycle.state === 'gone') return;
    if (cycle.state === 'ride') pushPoint(cycle);
    const point = projector(cycle);
    for (const segment of WIRE) {
      if (Math.random() < 0.7) continue;
      const a = point(...segment.a);
      const b = point(...segment.b);
      voxels.spawn({
        x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
        vx: (Math.random() - 0.5) * 0.3, vy: Math.random() * 0.25,
        size: (0.012 * cycle.scale) / Math.max(a.depth, CYCLE.nearClip) + Math.random() * 0.004,
        life: 0.9 + Math.random() * 0.9,
        heat: 0.7,
        color: segment.kind === 'wheel' ? cycle.accent : cycle.color,
        delay: Math.random() * 0.08,
      });
    }
    const center = point(0.12 * S, 0.05 * S, 0);
    flashes.spawn({ x: center.x, y: center.y, size: 0.1 * Math.sqrt(cycle.scale), duration: 0.5, color: cycle.color, glint: 0.7 });
    cycle.state = 'gone';
    cycle.goneAt = now;
    counts.derezzed++;
    log(`cycle derezz ${cycle.owner[0].toUpperCase()}`);
  }

  // where a cycle shows, for derezz waves
  function centerOf(cycle) {
    return projector(cycle)(0.12 * S, 0.05 * S, 0);
  }

  // a derezz wave: cycles and stretches of their walls within `radius` of `origin` (view units)
  function shatter(origin, radius, bornBefore) {
    const radiusSquared = radius * radius;
    const within = (point) => (point.x - origin.x) ** 2 + (point.y - origin.y) ** 2 < radiusSquared;
    for (const cycle of cycles) {
      if (cycle.state !== 'gone' && cycle.start < bornBefore && within(centerOf(cycle))) derezz(cycle);
      for (const sample of cycle.path) {
        if (sample.gone || sample.born > bornBefore) continue;
        const base = stage.project(sample.x, 0, sample.z);
        if (base.depth < CYCLE.nearClip || !within(base)) continue;
        sample.gone = true;
        if (Math.round(sample.along / CYCLE.sampleSpacing) % 2) continue;
        const top = stage.project(sample.x, CYCLE.wallHeight * cycle.scale, sample.z);
        voxels.spawn({
          x: (base.x + top.x) / 2, y: (base.y + top.y) / 2,
          vx: (base.x - origin.x) * 0.4 + (Math.random() - 0.5) * 0.1, vy: 0.05 + Math.random() * 0.15,
          size: Math.max(0.005, (top.y - base.y) * 0.4),
          life: 1.0 + Math.random() * 0.8,
          heat: 0.6,
          color: teams.colors[cycle.teamIndex],
        });
      }
    }
  }

  function update(seconds, dt) {
    now = seconds;
    time.value = seconds;
    for (const cycle of cycles) {
      const age = now - cycle.start;
      // powered down: it stops where it is and goes dark
      if (cycle.offAt !== undefined) continue;
      cycle.spin += dt * (cycle.state === 'ride' ? 30 : 9);
      if (cycle.state === 'rezz') {
        if (age >= REZZ.build[0] && age < REZZ.build[1]) glitchCubes(cycle, window01(age, REZZ.build));
        if (age >= REZZ.solid[1]) {
          cycle.state = 'drop';
          cycle.dropStart = now;
        }
      } else if (cycle.state === 'drop') {
        const progress = Math.min(1, (now - cycle.dropStart) / CYCLE.dropTime);
        cycle.h = cycle.dropFrom * (1 - progress * progress);
        if (progress >= 1) {
          cycle.h = 0;
          cycle.state = 'ride';
          cycle.rideUntil = now + random(CYCLE.rideTime);
          cycle.nextChoice = now + 0.3;
          pushPoint(cycle);
          const landing = projector(cycle)(0.05 * S, 0, 0);
          flashes.spawn({ x: landing.x, y: landing.y, size: 0.08 * Math.sqrt(cycle.scale), duration: 0.4, color: cycle.color, glint: 1 });
        }
      } else if (cycle.state === 'ride') {
        ride(cycle, dt);
      }
      const target = cycle.state === 'ride' ? 1 : cycle.state === 'drop' ? 0.4 : 0;
      cycle.light += (target - cycle.light) * (1 - Math.exp(-dt / 0.25));
    }
    for (let index = cycles.length - 1; index >= 0; index--) {
      const cycle = cycles[index];
      if (cycle.state === 'gone' && now - cycle.goneAt > CYCLE.wallFade) cycles.splice(index, 1);
      else if (cycle.offAt !== undefined && now > cycle.allOffAt) cycles.splice(index, 1);
    }
  }

  // glitchy cubes at the construction sweep
  function glitchCubes(cycle, progress) {
    const point = projector(cycle);
    const u = FRONT - (FRONT - BACK) * progress;
    for (let k = 0; k < 4; k++) {
      const at = point(u + (Math.random() - 0.5) * 0.02 * S, Math.random() * 0.1 * S, (Math.random() - 0.5) * 2 * TIRE);
      if (at.depth < CYCLE.nearClip) continue;
      voxels.spawn({
        x: at.x, y: at.y,
        vx: (Math.random() - 0.5) * 0.05, vy: (Math.random() - 0.5) * 0.05,
        size: (0.006 + Math.random() * 0.008) * cycle.scale / at.depth,
        life: 0.25 + Math.random() * 0.35,
        heat: 0.9,
        color: Math.random() < 0.5 ? cycle.color : cycle.accent,
      });
    }
  }

  function addLine(a, b, color, bright, width) {
    if (Math.min(a.depth, b.depth) < CYCLE.nearClip || power <= 0) return;
    lines.add(a, b, color, bright * power, width);
  }

  function circle(point, center, radius, s, color, bright, width, count = 28) {
    let previous = null;
    for (let k = 0; k <= count; k++) {
      const angle = (k / count) * Math.PI * 2;
      const current = point(center + Math.cos(angle) * radius, WHEEL_RADIUS + Math.sin(angle) * radius, s);
      if (previous) addLine(previous, current, color, bright, width);
      previous = current;
    }
  }

  // rings blooming where a wheel will be, one after another from the middle out
  function rings(cycle, point, center, progress, bright) {
    const near = nearSide(point);
    RING_FRACTIONS.forEach((fraction, index) => {
      const local = clamp(progress * 1.6 - index * 0.3, 0, 1);
      if (local <= 0) return;
      const radius = WHEEL_RADIUS * fraction * (1 - (1 - local) ** 3);
      glow.copy(cycle.accent).lerp(white, 0.5 * (1 - local) + 0.2);
      circle(point, center, radius, near * TIRE, glow, bright * (0.5 + 0.8 * (1 - local)), 1.2);
      circle(point, center, radius, -near * TIRE, glow, bright * 0.25, 0.9);
    });
  }

  // which side of the bike faces the camera: +1 or -1 (sign of s)
  function nearSide(point) {
    const plus = point(0.12 * S, 0.05 * S, TIRE);
    const minus = point(0.12 * S, 0.05 * S, -TIRE);
    return plus.depth <= minus.depth ? 1 : -1;
  }

  // the wireframe, revealed front to back up to `sweepU`
  function wireframe(cycle, point, sweepU, bright) {
    const flicker = 0.8 + 0.2 * Math.random();
    for (const segment of WIRE) {
      if (segment.u < sweepU) continue;
      const fresh = Math.exp(-(segment.u - sweepU) / (0.03 * S));
      if (fresh > 0.3 && Math.random() < 0.35) continue;   // glitching at the sweep
      const color = segment.kind === 'wheel' ? cycle.accent : cycle.color;
      glow.copy(color).lerp(white, 0.35 + 0.5 * fresh);
      addLine(point(...segment.a), point(...segment.b), glow, bright * flicker * (0.22 + 0.9 * fresh), 0.9);
    }
  }

  // spokes spinning inside the wheels
  function spokes(cycle, point, bright) {
    for (const center of WHEELS) {
      for (let k = 0; k < 5; k++) {
        const angle = cycle.spin + (k / 5) * Math.PI * 2;
        const inner = WHEEL_RADIUS * 0.25;
        const outer = WHEEL_RADIUS * 0.62;
        addLine(point(center + Math.cos(angle) * inner, WHEEL_RADIUS + Math.sin(angle) * inner, 0),
          point(center + Math.cos(angle) * outer, WHEEL_RADIUS + Math.sin(angle) * outer, 0),
          cycle.accent, bright * 0.7, 1.0);
      }
    }
  }

  // the finished bike: white-hot rims, glossy highlights along the body
  function solid(cycle, point, bright) {
    const near = nearSide(point);
    const scale = cycle.scale;
    const rimWidth = clamp(1 + 0.6 * scale, 1.5, 2.8);
    for (const center of WHEELS) {
      glow.copy(cycle.accent).lerp(white, 0.25);
      circle(point, center, WHEEL_RADIUS * 0.97, near * TIRE, glow, 0.85 * bright, rimWidth);
      circle(point, center, WHEEL_RADIUS * 0.8, near * TIRE, cycle.accent, 0.55 * bright, 1.2);
      circle(point, center, WHEEL_RADIUS * 0.97, -near * TIRE, cycle.accent, 0.3 * bright, 1.1);
    }
    // highlights: a white streak along the top, the team colour underneath
    for (let k = 1; k < BODY_TOP.length; k++) {
      addLine(point(BODY_TOP[k - 1][0], BODY_TOP[k - 1][1] - 0.003 * S, near * BODY_SIDE),
        point(BODY_TOP[k][0], BODY_TOP[k][1] - 0.003 * S, near * BODY_SIDE), white, 0.9 * bright, 1.3);
    }
    for (let k = 1; k < BODY_BOTTOM.length; k++) {
      addLine(point(BODY_BOTTOM[k - 1][0], BODY_BOTTOM[k - 1][1], near * BODY_SIDE),
        point(BODY_BOTTOM[k][0], BODY_BOTTOM[k][1], near * BODY_SIDE), cycle.color, 0.9 * bright, 1.3);
    }
    // a light line along the flank, like the film's
    addLine(point(0.02 * S, 0.05 * S, near * BODY_SIDE * 1.05), point(0.2 * S, 0.045 * S, near * BODY_SIDE * 1.05),
      cycle.color, 1.1 * bright, 1.6);
    // the tail light, where the wall comes out
    addLine(point(BACK, 0.03 * S, 0), point(BACK, 0.065 * S, 0), white, 1.6 * bright, 1.8);
  }

  // the black shape of the body and the wheels
  function dark(cycle, point, opacity) {
    const alpha = opacity * power;
    if (alpha <= 0.01) return;
    const triangle = (a, b, c) => {
      if (fillCount >= FILL_TRIANGLES || Math.min(a.depth, b.depth, c.depth) < CYCLE.nearClip) return;
      [a, b, c].forEach((vertex, corner) => {
        const index = fillCount * 3 + corner;
        fillPositions.set([vertex.x, vertex.y, 0], index * 3);
        fillAlpha[index] = alpha;
      });
      fillCount++;
    };
    const centroid = point(0.12 * S, 0.055 * S, 0);
    for (let k = 1; k < BODY.length; k++) {
      triangle(centroid, point(BODY[k - 1][0], BODY[k - 1][1], 0), point(BODY[k][0], BODY[k][1], 0));
    }
    for (const center of WHEELS) {
      const hub = point(center, WHEEL_RADIUS, 0);
      let previous = null;
      for (let k = 0; k <= 20; k++) {
        const angle = (k / 20) * Math.PI * 2;
        const rim = point(center + Math.cos(angle) * WHEEL_RADIUS, WHEEL_RADIUS + Math.sin(angle) * WHEEL_RADIUS, 0);
        if (previous) triangle(hub, previous, rim);
        previous = rim;
      }
    }
  }

  function drawBike(cycle) {
    const point = projector(cycle);
    const age = now - cycle.start;
    if (cycle.state !== 'rezz') {
      dark(cycle, point, 0.92);
      solid(cycle, point, 1);
      return;
    }
    const front = window01(age, REZZ.frontRings);
    const rear = window01(age, REZZ.rearRings);
    const build = window01(age, REZZ.build);
    const solidity = window01(age, REZZ.solid);
    const wireFade = 1 - solidity;
    if (front > 0) rings(cycle, point, WHEELS[1], front, wireFade);
    if (rear > 0) rings(cycle, point, WHEELS[0], rear, wireFade);
    if (build > 0 && wireFade > 0) {
      const sweepU = FRONT - (FRONT - BACK + 0.02 * S) * build;
      wireframe(cycle, point, sweepU, wireFade);
      if (build < 1) {
        // the scan line at the sweep
        addLine(point(sweepU, -0.005 * S, 0), point(sweepU, 0.11 * S, 0), white, 1.0, 1.2);
      }
    }
    if (age >= REZZ.wire[0] && wireFade > 0) spokes(cycle, point, 1.2 * wireFade);
    if (solidity > 0) {
      dark(cycle, point, 0.92 * solidity);
      solid(cycle, point, solidity);
    }
  }

  function draw() {
    ribbon.begin();
    lines.begin();
    fillCount = 0;
    for (const cycle of cycles) {
      const fade = cycle.state === 'gone' ? 1 - smoothstep(0, CYCLE.wallFade, now - cycle.goneAt) : 1;
      const end = (point) => {
        const base = stage.project(point.x, 0, point.z);
        const top = stage.project(point.x, CYCLE.wallHeight * cycle.scale, point.z);
        const heat = 1 - smoothstep(0, CYCLE.hotTime, now - point.born);
        const near = smoothstep(CYCLE.nearClip, CYCLE.nearClip + 0.5, base.depth);
        const lit = lightPower(point.offAt, now, point.offSeed);
        return { base, top, alpha: fade * near * lit, heat, team: cycle.teamIndex, along: point.along };
      };
      const path = cycle.path;
      const last = path[path.length - 1];
      const points = cycle.state === 'ride' && last
        ? [...path, { x: cycle.x, z: cycle.z, born: now, gone: false, offAt: cycle.offAt, offSeed: cycle.offSeed,
          along: last.along + Math.hypot(cycle.x - last.x, cycle.z - last.z) }]
        : path;
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1];
        const b = points[index];
        if (a.gone || b.gone) continue;
        const endA = end(a);
        const endB = end(b);
        if (endA.base.depth < CYCLE.nearClip || endB.base.depth < CYCLE.nearClip) continue;
        ribbon.quad(endA, endB);
      }
      power = lightPower(cycle.offAt, now, cycle.offSeed);
      if (cycle.state !== 'gone') drawBike(cycle);
      power = 1;
    }
    ribbon.end();
    lines.end();
    fillGeometry.setDrawRange(0, fillCount * 3);
    fillGeometry.getAttribute('position').needsUpdate = true;
    fillGeometry.getAttribute('aAlpha').needsUpdate = true;
  }

  // The Grid powers down: every cycle stops and goes out at the time
  // `offTime(point)` gives, and its wall goes out stretch by stretch.
  function powerDown(offTime) {
    const stretch = 0.15;   // floor units of wall that go out together
    for (const cycle of cycles) {
      if (cycle.state === 'gone') continue;
      cycle.offAt = offTime(centerOf(cycle));
      cycle.offSeed = Math.random() * 100;
      cycle.allOffAt = cycle.offAt;
      let chunk = null;
      for (const point of cycle.path) {
        const index = Math.floor(point.along / stretch);
        if (!chunk || chunk.index !== index) {
          chunk = { index, offAt: offTime(stage.project(point.x, 0, point.z)), seed: Math.random() * 100 };
        }
        point.offAt = chunk.offAt;
        point.offSeed = chunk.seed;
        cycle.allOffAt = Math.max(cycle.allOffAt, chunk.offAt);
      }
    }
  }

  return {
    group,
    counts,
    launch,
    shatter,
    powerDown,
    // a fresh Grid: no cycles
    clear() {
      cycles.length = 0;
    },
    update,
    draw,
    get active() {
      return cycles.filter((cycle) => cycle.state !== 'gone').length;
    },
    // where the cycles light up the floor, for the stage
    lights() {
      return cycles.filter((cycle) => cycle.light > 0.01).slice(0, 4).map((cycle) => {
        const point = stage.project(cycle.x, 0, cycle.z);
        const lit = lightPower(cycle.offAt, now, cycle.offSeed);
        return { x: point.x, y: point.y, strength: cycle.light * lit, size: (0.5 * Math.sqrt(cycle.scale)) / point.depth, color: cycle.color };
      });
    },
  };
}
