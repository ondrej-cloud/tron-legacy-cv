// The Recognizer, the flying sentinel from the film: a huge arch on two
// angular legs with a head hanging under its crossbeam, dark glossy panels
// and orange light along every edge. Three fingers call one (controls.js):
// it flies in from the side of the hand that called it, slows down over the
// middle of the frame and turns to face the camera, sweeps a cone of light
// over the Grid floor, then flies off the other side. Light walls, discs,
// batons and light cycles inside the cone derezz (beam.contains()).
//
// It lives in grid3d's scene, in the same perspective as the light cycles,
// and is built from extruded outlines: the body occludes the floor behind it
// (over the camera image its near-black panels are see-through, so it reads
// as a shape drawn in light), the edges are fat lines, and the cone and its
// pool of light on the floor are additive meshes.
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { STAGE } from './stage.js';
import { lightPower } from './endofline.js';
import { smoothstep } from './filters.js';

export const RECOGNIZER = {
  duration: 5.6,          // s from entering the frame on one side to leaving on the other
  scale: 1.1,             // world units per model unit (the model is 1.24 wide, 0.98 tall)
  depth: [2.6, 2.1],      // its distance at the edges of the frame .. over the middle
  viewY: 0.2,             // view y it flies at (the model's origin, at the tip of its head)
  linger: 0.8,            // 0..1: how much it slows down over the middle
  turn: 0.35,             // rad it is turned towards where it flies, at the edges
  bank: 0.06,             // rad of roll into the flight
  footDepth: 1.6,         // depth of the cone's pool of light on the floor
  footRadius: 0.24,       // floor units
  swing: 0.2,             // floor units the pool swings from side to side ...
  swingRate: 1.9,         // ... at this rate (rad/s)
  emitterRadius: 0.035,   // floor units, where the cone leaves the head
};

const ORANGE = new THREE.Color('#ff8a1f');
const EDGE_GLOW = 1.7;    // edge line brightness (above 1 blooms)

// The outline, front view, x across and y up. The crossbeam and the head
// are given as their right halves (mirrored), from the top middle round to
// the bottom middle; a leg angles out to a knee, drops straight down and
// ends in a foot hooked inwards.
const BEAM = [[0, 0.4], [0.4, 0.4], [0.52, 0.32], [0.5, 0.22], [0.33, 0.2], [0, 0.2]];
const LEG = [[0.52, 0.32], [0.61, -0.08], [0.61, -0.44], [0.57, -0.56], [0.5, -0.58], [0.48, -0.47], [0.45, -0.08],
  [0.33, 0.2]];
const HEAD = [[0, 0.3], [0.15, 0.3], [0.15, 0.2], [0.07, 0.02], [0, -0.02]];

const bodyVertex = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vView = -viewPosition.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

// Near-black lacquer: faces seen edge-on catch an orange rim, and a faint
// sheen slides down the panels, so the volume reads even without the edges.
const bodyFragment = /* glsl */`
  uniform vec3 uColor;
  uniform float uPower;
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float rim = pow(1.0 - facing, 2.5);
    float band = fract(vLocal.y * 0.9 + vLocal.x * 0.35 - uTime * 0.12) - 0.5;
    float sheen = exp(-band * band / 0.0025);
    vec3 col = vec3(0.004, 0.003, 0.002) + uColor * (0.012 + rim * 0.2 + sheen * 0.035);
    gl_FragColor = vec4(col * uPower, 1.0);
  }
`;

const coneVertex = /* glsl */`
  varying float vAlong;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vAlong = -position.y;   // 0 at the emitter, 1 on the floor
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vView = -viewPosition.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

// A cone of light seen through haze: brightest along its silhouette, with
// scan rings running down it to the floor.
const coneFragment = /* glsl */`
  uniform vec3 uColor;
  uniform float uPower;
  uniform float uTime;
  varying float vAlong;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float edge = pow(1.0 - facing, 3.0);
    float haze = 0.02 + edge * 0.38;
    float ring = fract(vAlong * 1.6 - uTime * 0.9);
    float rings = exp(-pow((ring - 0.5) / 0.012, 2.0)) * 0.35;
    float near = smoothstep(0.0, 0.08, vAlong) * mix(1.0, 0.55, vAlong);
    vec3 col = mix(uColor, vec3(1.0), 0.15) * (haze + rings) * near;
    gl_FragColor = vec4(col * uPower, 1.0);
  }
`;

const poolVertex = /* glsl */`
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The pool of light on the floor: a hard rim, scan lines across it and a
// sweep going round, like a searchlight reading the Grid.
const poolFragment = /* glsl */`
  uniform vec3 uColor;
  uniform float uPower;
  uniform float uTime;
  varying vec2 vLocal;
  void main() {
    float r = length(vLocal);
    float aa = fwidth(r);
    float rim = 1.0 - smoothstep(0.0, 2.0 * aa, abs(r - 0.97));
    float inside = 1.0 - smoothstep(0.97 - aa, 0.97 + aa, r);
    float lines = step(0.55, fract(vLocal.y * 9.0 - uTime * 2.0)) * 0.12;
    float angle = atan(vLocal.y, vLocal.x);
    float sweep = pow(fract((angle - uTime * 2.6) / 6.28318), 6.0) * 0.5;
    float pulse = 1.0 - smoothstep(0.0, 2.0 * aa, abs(r - fract(uTime * 0.7)));
    vec3 hot = mix(uColor, vec3(1.0), 0.45);
    vec3 col = hot * rim * 1.4 + uColor * inside * (0.12 + lines + sweep + pulse * 0.4);
    gl_FragColor = vec4(col * uPower, 1.0);
  }
`;

// One mirrored outline (right half given) or a plain one, extruded `depth`
// deep around z = `z`, with a small bevel so every edge catches light.
function extrudeOutline(half, depth, z, mirror = true) {
  const points = mirror
    ? [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y])]
    : half;
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const bevel = 0.012;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: depth - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8,
    bevelSegments: 1, curveSegments: 1,
  });
  geometry.translate(0, 0, z - depth / 2 + bevel);
  return geometry;
}

function buildModel() {
  const leg = (side) => extrudeOutline(LEG.map(([x, y]) => [x * side, y]), 0.2, 0, false);
  const parts = [
    extrudeOutline(BEAM, 0.26, 0),
    leg(1),
    leg(-1),
    // the head hangs under the crossbeam and juts out in front
    extrudeOutline(HEAD, 0.34, 0.05),
  ];
  const edges = [];
  for (const geometry of parts) {
    const lines = new THREE.EdgesGeometry(geometry, 20);
    edges.push(...lines.getAttribute('position').array);
    lines.dispose();
  }
  // light strips: the visor across the front of the head, a seam down
  // the face of each leg, and the slot the cone shines from
  const front = 0.05 + 0.17;
  const strip = (a, b) => edges.push(...a, ...b);
  strip([-0.1, 0.17, front + 0.002], [0.1, 0.17, front + 0.002]);
  strip([-0.075, 0.135, front + 0.002], [0.075, 0.135, front + 0.002]);
  for (const side of [1, -1]) {
    strip([0.425 * side, 0.26, 0.102], [0.53 * side, -0.08, 0.102]);
    strip([0.53 * side, -0.08, 0.102], [0.545 * side, -0.45, 0.102]);
  }
  return { parts, edges: new Float32Array(edges) };
}

// grid3d: the 3D layer (scene, camera, environment); stage: the floor's
// projection (stage.project()); view: the frame's size.
export function createRecognizer({ grid3d, stage, view }) {
  const uniforms = {
    uColor: { value: ORANGE },
    uPower: { value: 1 },
    uTime: { value: 0 },
  };
  const { parts, edges } = buildModel();
  // pushed back a little in depth, so the edge lines on it aren't half hidden
  const bodyMaterial = new THREE.ShaderMaterial({ vertexShader: bodyVertex, fragmentShader: bodyFragment, uniforms,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
  const model = new THREE.Group();
  for (const geometry of parts) model.add(new THREE.Mesh(geometry, bodyMaterial));
  const lineGeometry = new LineSegmentsGeometry().setPositions(edges);
  const lineMaterial = new LineMaterial({
    color: ORANGE.clone().multiplyScalar(EDGE_GLOW),
    linewidth: 1.6,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lines = new LineSegments2(lineGeometry, lineMaterial);
  lines.renderOrder = 1;
  model.add(lines);
  model.scale.setScalar(RECOGNIZER.scale);
  // unturned, the model's front (+z, where the head juts out) faces the camera
  const body = new THREE.Group();
  body.add(model);

  // the cone: apex at the origin, a unit circle at y = -1, sheared into
  // place every frame so its foot stays a circle on the floor
  const coneGeometry = new THREE.ConeGeometry(1, 1, 48, 1, true);
  coneGeometry.translate(0, -0.5, 0);   // apex at y = 0, base at y = -1
  const coneMaterial = new THREE.ShaderMaterial({
    vertexShader: coneVertex, fragmentShader: coneFragment, uniforms: { ...uniforms, uPower: { value: 0 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  const cone = new THREE.Mesh(coneGeometry, coneMaterial);
  cone.matrixAutoUpdate = false;
  cone.frustumCulled = false;
  cone.renderOrder = 2;
  const poolMaterial = new THREE.ShaderMaterial({
    vertexShader: poolVertex, fragmentShader: poolFragment, uniforms: { ...uniforms, uPower: coneMaterial.uniforms.uPower },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1, 64), poolMaterial);
  pool.rotation.x = -Math.PI / 2;
  pool.frustumCulled = false;
  pool.renderOrder = 2;
  cone.visible = false;
  pool.visible = false;

  const group = new THREE.Group();
  group.add(body, cone, pool);
  group.visible = false;

  // the flight: null, or { start, dir (+1 = flying right), offAt, offSeed }
  let flight = null;
  let now = 0;
  const counts = { called: 0 };
  // the cone on screen, for the derezz: apex, foot centre and size (view units)
  const beam = {
    strength: 0,
    apex: { x: 0, y: 0, halfWidth: 0 },
    foot: { x: 0, y: 0, halfWidth: 0, halfHeight: 0 },
    // is a point (view units) inside the cone as it shows on screen?
    contains(point) {
      if (this.strength < 0.5) return false;
      const { apex, foot } = this;
      if (point.y > apex.y) return false;
      if (point.y >= foot.y) {
        const t = (apex.y - point.y) / Math.max(1e-6, apex.y - foot.y);
        const x = apex.x + (foot.x - apex.x) * t;
        return Math.abs(point.x - x) < apex.halfWidth + (foot.halfWidth - apex.halfWidth) * t;
      }
      const dx = (point.x - foot.x) / foot.halfWidth;
      const dy = (point.y - foot.y) / foot.halfHeight;
      return dx * dx + dy * dy < 1;
    },
  };

  const emitter = new THREE.Vector3();
  const footWorld = new THREE.Vector3();
  const axis = new THREE.Vector3();

  function call(side) {
    if (flight) return false;
    flight = { start: now, dir: side === 'right' ? -1 : 1 };
    counts.called++;
    return true;
  }

  // where along the flight (0..1) -> view x: quick at the edges, slow in the middle
  function viewX(progress) {
    const reach = view.aspect / 2 + 0.75;
    const eased = progress - (RECOGNIZER.linger / (2 * Math.PI)) * Math.sin(2 * Math.PI * progress);
    return flight.dir * reach * (2 * eased - 1);
  }

  function update(seconds) {
    now = seconds;
    uniforms.uTime.value = seconds;
    if (!flight) {
      group.visible = false;
      beam.strength = 0;
      return;
    }
    const progress = (now - flight.start) / RECOGNIZER.duration;
    if (progress >= 1 || (flight.offAt !== undefined && now >= flight.offAt)) {
      flight = null;
      group.visible = false;
      beam.strength = 0;
      return;
    }
    group.visible = true;
    const power = lightPower(flight.offAt, now, flight.offSeed);
    uniforms.uPower.value = power;
    lineMaterial.opacity = power;

    // the body: across the frame, closer over the middle, turned towards
    // where it flies at the edges and facing the camera in between
    const middle = Math.sin(Math.PI * progress);
    const depth = RECOGNIZER.depth[0] + (RECOGNIZER.depth[1] - RECOGNIZER.depth[0]) * middle;
    const x = stage.gridX(viewX(progress), depth);
    const y = RECOGNIZER.viewY + 0.012 * Math.sin(now * 1.7);
    const height = STAGE.cameraHeight + (y - STAGE.horizon) * depth;
    const z = stage.gridZ(depth);
    body.position.copy(grid3d.toWorld(x, height, z));
    const speed = 1 + RECOGNIZER.linger * Math.cos(2 * Math.PI * progress);   // relative to the average
    body.rotation.set(0, flight.dir * RECOGNIZER.turn * (1 - middle), -flight.dir * RECOGNIZER.bank * speed);
    lineMaterial.resolution.set(view.width * view.pixelRatio, view.height * view.pixelRatio);

    // the cone: from the slot under the head to a pool of light on the
    // floor that swings from side to side, on while it is over the frame
    body.updateMatrixWorld(true);
    emitter.set(0, -0.01, 0.09).applyMatrix4(model.matrixWorld);
    const onScreen = 1 - smoothstep(view.aspect / 2 - 0.2, view.aspect / 2 + 0.3, Math.abs(viewX(progress)));
    const strength = onScreen * (flight.offAt === undefined ? 1 : power);
    coneMaterial.uniforms.uPower.value = strength;
    cone.visible = pool.visible = strength > 0.002;
    const footZ = stage.gridZ(RECOGNIZER.footDepth);
    const footX = x + RECOGNIZER.swing * Math.sin((now - flight.start) * RECOGNIZER.swingRate);
    grid3d.toWorld(footX, 0.002, footZ, footWorld);
    const radius = RECOGNIZER.footRadius;
    axis.subVectors(emitter, footWorld);
    // x and z scale the unit circle, y = -1 lands on the foot
    cone.matrix.set(
      radius, axis.x, 0, emitter.x,
      0, axis.y, 0, emitter.y,
      0, axis.z, radius, emitter.z,
      0, 0, 0, 1);
    cone.matrixWorldNeedsUpdate = true;
    pool.position.copy(footWorld);
    pool.scale.setScalar(radius);

    // the same cone on screen
    beam.strength = strength;
    const apex = stage.project(emitter.x, emitter.y, -emitter.z);
    const reach = RECOGNIZER.emitterRadius * RECOGNIZER.scale / apex.depth;
    Object.assign(beam.apex, { x: apex.x, y: apex.y, halfWidth: reach });
    const foot = stage.project(footX, 0, footZ);
    const near = stage.project(footX, 0, footZ - radius);
    const far = stage.project(footX, 0, footZ + radius);
    Object.assign(beam.foot, {
      x: foot.x, y: foot.y,
      halfWidth: radius / foot.depth,
      halfHeight: Math.max(1e-3, (far.y - near.y) / 2),
    });
  }

  // Its shaders are made ahead of time (in parallel where the browser can),
  // so the first flight doesn't stall the page. Called once by the effect.
  function precompile(renderer) {
    const previous = renderer.getRenderTarget();
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    renderer.setRenderTarget(target);
    const done = renderer.compileAsync(group, grid3d.camera, grid3d.scene);
    renderer.setRenderTarget(previous);
    return done.finally(() => target.dispose());
  }

  return {
    group,
    beam,
    counts,
    color: ORANGE,
    call,
    precompile,
    update,
    // one flies at a time
    get busy() {
      return flight !== null;
    },
    // the Grid powers down: it goes out with the lights around it
    powerDown(offTime) {
      if (!flight) return;
      flight.offAt = offTime({ x: beam.apex.x, y: beam.apex.y });
      flight.offSeed = Math.random() * 100;
    },
    clear() {
      flight = null;
      group.visible = false;
      beam.strength = 0;
    },
  };
}
