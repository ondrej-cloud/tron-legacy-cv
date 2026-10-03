// The light cycle drawn in lines: the fallback for when the 3D model can't
// be loaded (cycles.js). It rezzes like the model does: concentric rings
// bloom where the front wheel will be, then the rear one; a holographic
// construction sweeps from front to back (wire lines, glitchy cubes, a scan
// line); the full wireframe flickers with its wheels spinning; then it
// solidifies into a dark body with white-hot rims. The layer can only add
// light, so the "dark" body is a black shape drawn over the Grid: it hides
// the floor lines and walls behind the bike, which reads as a solid machine.
//
// Bike frame: u forward from the tail, h up, s across, floor units at scale
// 1; draw() gets a function that maps that frame to view units.
import * as THREE from 'three';
import { createLines } from './lines.js';
import { clamp } from './filters.js';

// The rezz, in seconds since launch: [start, end] of each phase.
export const SKETCH_REZZ = {
  frontRings: [0, 0.45],
  rearRings: [0.15, 0.6],
  build: [0.35, 1.05],
  wire: [1.05, 1.35],
  solid: [1.35, 1.7],
};

// u forward from the back wheel's contact point in the shapes below
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
const RING_FRACTIONS = [0.35, 0.65, 1];
const NEAR_CLIP = 0.9;
const MAX_CYCLES = 4;

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
    for (let k = 1; k < BODY.length; k++) add([...BODY[k - 1], s], [...BODY[k], s], 'body');
  }
  for (const [u, h] of BODY) add([u, h, -BODY_SIDE], [u, h, BODY_SIDE], 'body');
  // forks from the hubs up into the body
  add([WHEELS[1], WHEEL_RADIUS, 0], BODY[5].concat(0), 'body');
  add([WHEELS[0], WHEEL_RADIUS, 0], BODY[1].concat(0), 'body');
  return wire;
}

const FILL_TRIANGLES = (BODY.length + 2 * 20) * MAX_CYCLES;

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

export function createCycleSketch(view, voxels) {
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
  group.add(fill, lines.mesh);

  const white = new THREE.Color(1, 1, 1);
  const glow = new THREE.Color();
  let fillCount = 0;
  let power = 1;
  const window01 = (age, [start, end]) => clamp((age - start) / (end - start), 0, 1);

  function addLine(a, b, color, bright, width) {
    if (Math.min(a.depth, b.depth) < NEAR_CLIP || power <= 0) return;
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

  // which side of the bike faces the camera: +1 or -1 (sign of s)
  function nearSide(point) {
    const plus = point(0.12 * S, 0.05 * S, TIRE);
    const minus = point(0.12 * S, 0.05 * S, -TIRE);
    return plus.depth <= minus.depth ? 1 : -1;
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

  // glitchy cubes at the construction sweep
  function glitchCubes(cycle, point, sweepU) {
    for (let k = 0; k < 4; k++) {
      const at = point(sweepU + (Math.random() - 0.5) * 0.02 * S, Math.random() * 0.1 * S, (Math.random() - 0.5) * 2 * TIRE);
      if (at.depth < NEAR_CLIP) continue;
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
    const rimWidth = clamp(1 + 0.6 * cycle.scale, 1.5, 2.8);
    for (const center of WHEELS) {
      glow.copy(cycle.accent).lerp(white, 0.25);
      circle(point, center, WHEEL_RADIUS * 0.97, near * TIRE, glow, 0.85 * bright, rimWidth);
      circle(point, center, WHEEL_RADIUS * 0.8, near * TIRE, cycle.accent, 0.55 * bright, 1.2);
      circle(point, center, WHEEL_RADIUS * 0.97, -near * TIRE, cycle.accent, 0.3 * bright, 1.1);
    }
    for (let k = 1; k < BODY_TOP.length; k++) {
      addLine(point(BODY_TOP[k - 1][0], BODY_TOP[k - 1][1] - 0.003 * S, near * BODY_SIDE),
        point(BODY_TOP[k][0], BODY_TOP[k][1] - 0.003 * S, near * BODY_SIDE), white, 0.9 * bright, 1.3);
    }
    for (let k = 1; k < BODY_BOTTOM.length; k++) {
      addLine(point(BODY_BOTTOM[k - 1][0], BODY_BOTTOM[k - 1][1], near * BODY_SIDE),
        point(BODY_BOTTOM[k][0], BODY_BOTTOM[k][1], near * BODY_SIDE), cycle.color, 0.9 * bright, 1.3);
    }
    addLine(point(0.02 * S, 0.05 * S, near * BODY_SIDE * 1.05), point(0.2 * S, 0.045 * S, near * BODY_SIDE * 1.05),
      cycle.color, 1.1 * bright, 1.6);
    addLine(point(BACK, 0.03 * S, 0), point(BACK, 0.065 * S, 0), white, 1.6 * bright, 1.8);
  }

  // the black shape of the body and the wheels
  function dark(point, opacity) {
    const alpha = opacity * power;
    if (alpha <= 0.01) return;
    const triangle = (a, b, c) => {
      if (fillCount >= FILL_TRIANGLES || Math.min(a.depth, b.depth, c.depth) < NEAR_CLIP) return;
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

  return {
    group,
    begin() {
      lines.begin();
      fillCount = 0;
    },
    // cycle: { color, accent, scale, spin }; fromTail(u, h, s) maps the bike
    // frame (from the tail) to view units; age: s since launch, or Infinity
    // for a finished bike; lit: how lit it still is (the Grid powering down)
    draw(cycle, fromTail, age, lit = 1) {
      const point = (u, h, s) => fromTail(u - BACK, h, s);
      power = lit;
      if (age >= SKETCH_REZZ.solid[1]) {
        dark(point, 0.92);
        solid(cycle, point, 1);
        power = 1;
        return;
      }
      const front = window01(age, SKETCH_REZZ.frontRings);
      const rear = window01(age, SKETCH_REZZ.rearRings);
      const build = window01(age, SKETCH_REZZ.build);
      const solidity = window01(age, SKETCH_REZZ.solid);
      const wireFade = 1 - solidity;
      if (front > 0) rings(cycle, point, WHEELS[1], front, wireFade);
      if (rear > 0) rings(cycle, point, WHEELS[0], rear, wireFade);
      if (build > 0 && wireFade > 0) {
        const sweepU = FRONT - (FRONT - BACK + 0.02 * S) * build;
        wireframe(cycle, point, sweepU, wireFade);
        if (build < 1) {
          addLine(point(sweepU, -0.005 * S, 0), point(sweepU, 0.11 * S, 0), white, 1.0, 1.2);
          glitchCubes(cycle, point, sweepU);
        }
      }
      if (age >= SKETCH_REZZ.wire[0] && wireFade > 0) spokes(cycle, point, 1.2 * wireFade);
      if (solidity > 0) {
        dark(point, 0.92 * solidity);
        solid(cycle, point, solidity);
      }
      power = 1;
    },
    // where to spawn derezz voxels: points of the wireframe, in view units
    derezzPoints(fromTail) {
      const points = [];
      for (const segment of WIRE) {
        if (Math.random() < 0.7) continue;
        const a = fromTail(segment.a[0] - BACK, segment.a[1], segment.a[2]);
        const b = fromTail(segment.b[0] - BACK, segment.b[1], segment.b[2]);
        points.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, depth: a.depth, wheel: segment.kind === 'wheel' });
      }
      return points;
    },
    end() {
      lines.end();
      fillGeometry.setDrawRange(0, fillCount * 3);
      fillGeometry.getAttribute('position').needsUpdate = true;
      fillGeometry.getAttribute('aAlpha').needsUpdate = true;
    },
  };
}
