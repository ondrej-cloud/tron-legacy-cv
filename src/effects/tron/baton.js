// Light batons, the rods a light cycle rezzes from. A shaka (thumb and pinky
// out) rezzes one in the hand: a bright segmented rod along the thumb-tip to
// pinky-tip axis, centred on the palm, reaching a little past both tips. A
// swing leaves a fading arc of light, cuts the light walls the rod sweeps
// through, and deflects thrown discs (disc.js asks for sweeps()). Two batons
// brought together end to end and pulled apart rez a light cycle; that rule
// lives in controls.js.
//
// Collisions use the area the rod swept since the last frame, so a fast
// swing can't jump over a wall or a disc.
import * as THREE from 'three';
import { additiveMaterial, quadIndices, uploadPrefix } from './gl.js';
import { easeTowards, smoothstep } from './filters.js';
import { WALL } from './walls.js';

export const BATON = {
  radius: 0.0065,         // view units
  margin: 0.035,          // the rod reaches this far past the thumb and pinky tips
  segment: 0.042,         // spacing of the bright rings along the rod
  rezTime: 0.35,          // s to build up from the centre outwards
  collapseTime: 0.25,     // s to collapse into voxels when let go
  poseSmoothing: 0.04,    // s, the rod eases onto the hand (tracker jitter)
  lengthSmoothing: 0.15,
  trailTime: 0.4,         // s the swing arc lingers
  slices: 6,              // pieces along the rod for the arc and the swept tests
  cutReach: 0.004,        // view units around the rod that cut too
  sparkEvery: 0.06,       // s between sparks while cutting
};

const IDS = ['left', 'right'];
const TRAIL_FRAMES = 40;
const MAX_TRAIL_QUADS = IDS.length * TRAIL_FRAMES * BATON.slices;

const rodVertex = /* glsl */`
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// a capsule seen from the side: white-hot core, coloured body, bright rings
// and end caps, a soft glow; building up (or collapsing) from the centre
const rodFragment = /* glsl */`
  uniform vec3 uColor;
  uniform vec2 uQuadHalf;    // the quad's half size, view units
  uniform float uLength;     // half the rod's visible length
  uniform float uRadius;
  uniform float uSegment;
  uniform float uPixel;
  uniform float uBuild;      // 1 while building up: the tips spark
  uniform float uBoost;      // brighter while linked to the other baton
  uniform float uTime;
  varying vec2 vLocal;
  void main() {
    vec2 q = vLocal * uQuadHalf;
    float along = abs(q.x);
    float d = length(vec2(max(along - uLength, 0.0), q.y));
    float aa = uPixel;
    float body = 1.0 - smoothstep(uRadius - aa, uRadius + aa, d);
    float core = 1.0 - smoothstep(uRadius * 0.4 - aa, uRadius * 0.4 + aa, abs(q.y));
    core *= 1.0 - smoothstep(uLength - aa, uLength + aa, along);
    float glow = exp(-max(d - uRadius, 0.0) / (uRadius * 1.8));
    float ring = 1.0 - smoothstep(0.6 * aa, 1.8 * aa, abs(fract(q.x / uSegment + 0.5) - 0.5) * uSegment);
    float caps = smoothstep(uLength - 0.018, uLength - 0.012, along);
    float pulse = 0.85 + 0.15 * sin(q.x * 90.0 - uTime * 12.0);
    vec3 hot = mix(uColor, vec3(1.0), 0.6);
    vec3 col = uColor * body * (0.9 + 0.5 * ring) * pulse
      + hot * body * (caps * 0.9 + ring * 0.5)
      + vec3(1.0) * core * 1.5
      + uColor * glow * 0.35;
    float tips = exp(-pow((along - uLength) / 0.008, 2.0)) * exp(-abs(q.y) / 0.006);
    col += hot * tips * 2.5 * uBuild;
    gl_FragColor = vec4(col * uBoost, 1.0);
  }
`;

// the long-exposure arc of a swing: the area swept, faint, with bright
// lines along the paths of the two tips
const trailVertex = /* glsl */`
  attribute vec2 aTrail;   // along the rod (0..1), age (0 new .. 1 gone)
  attribute vec3 aColor;
  varying vec2 vTrail;
  varying vec3 vColor;
  void main() {
    vTrail = aTrail;
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const trailFragment = /* glsl */`
  varying vec2 vTrail;
  varying vec3 vColor;
  void main() {
    float u = vTrail.x;
    float fade = pow(1.0 - clamp(vTrail.y, 0.0, 1.0), 1.5);
    float px = fwidth(u);
    float tips = 1.0 - smoothstep(px, 3.0 * px, min(u, 1.0 - u));
    // brighter towards the outer end, which moves fastest in a swing
    float body = 0.22 + 0.3 * smoothstep(0.2, 1.0, abs(u - 0.5) * 2.0);
    float streaks = 0.75 + 0.25 * step(0.5, fract(u * 9.0));
    vec3 hot = mix(vColor, vec3(1.0), 0.5);
    gl_FragColor = vec4((vColor * body * streaks + hot * tips * 1.6) * fade, 1.0);
  }
`;

export function createBatons({ view, walls, voxels, flashes, log }) {
  const group = new THREE.Group();
  const plane = new THREE.PlaneGeometry(2, 2);
  const rods = {};
  for (const id of IDS) {
    const uniforms = {
      uColor: { value: new THREE.Color() },
      uQuadHalf: { value: new THREE.Vector2(1, 1) },
      uLength: { value: 0 },
      uRadius: { value: BATON.radius },
      uSegment: { value: BATON.segment },
      uPixel: { value: 1 / 720 },
      uBuild: { value: 0 },
      uBoost: { value: 1 },
      uTime: { value: 0 },
    };
    const mesh = new THREE.Mesh(plane, additiveMaterial(rodVertex, rodFragment, uniforms));
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 3;
    group.add(mesh);
    rods[id] = { mesh, uniforms };
  }

  const trailPositions = new Float32Array(MAX_TRAIL_QUADS * 4 * 3);
  const trailData = new Float32Array(MAX_TRAIL_QUADS * 4 * 2);
  const trailColors = new Float32Array(MAX_TRAIL_QUADS * 4 * 3);
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3).setUsage(THREE.DynamicDrawUsage));
  trailGeometry.setAttribute('aTrail', new THREE.BufferAttribute(trailData, 2).setUsage(THREE.DynamicDrawUsage));
  trailGeometry.setAttribute('aColor', new THREE.BufferAttribute(trailColors, 3).setUsage(THREE.DynamicDrawUsage));
  trailGeometry.setIndex(new THREE.BufferAttribute(quadIndices(MAX_TRAIL_QUADS), 1));
  const trailMesh = new THREE.Mesh(trailGeometry, additiveMaterial(trailVertex, trailFragment, {}));
  trailMesh.frustumCulled = false;
  trailMesh.renderOrder = 2;
  group.add(trailMesh);

  const batons = { left: null, right: null };
  const counts = { rezzed: 0, cuts: 0 };
  let now = 0;
  let linked = false;

  // owner's hand pose, in view units: center (the palm), axis (thumb tip ->
  // pinky tip, any length), half (half the rod's length); team: the owner's
  function hold(id, center, axis, half, team) {
    let baton = batons[id];
    const length = Math.hypot(axis.x, axis.y) || 1;
    let dir = { x: axis.x / length, y: axis.y / length };
    if (!baton || baton.state === 'collapsing') {
      baton = {
        id,
        born: now,
        state: 'rezzing',
        since: now,
        color: team.color.clone(),
        team,
        center: { ...center },
        dir,
        half,
        extent: 0,
        previous: null,
        current: null,
        slicesBefore: [],
        slicesNow: [],
        trail: [],
        lastSpark: -Infinity,
        velocity: { x: 0, y: 0 },
      };
      batons[id] = baton;
      counts.rezzed++;
      log(`baton ${id[0].toUpperCase()}`);
    }
    // the rod is symmetric: keep the axis pointing the way it already does
    if (dir.x * baton.dir.x + dir.y * baton.dir.y < 0) dir = { x: -dir.x, y: -dir.y };
    baton.target = { center: { ...center }, dir, half };
    baton.team = team;
  }

  function release(id) {
    const baton = batons[id];
    if (!baton || baton.state === 'collapsing') return;
    baton.state = 'collapsing';
    baton.since = now;
    const { a, b } = baton.current ?? endpoints(baton, 1);
    for (let k = 0; k < 16; k++) {
      const t = (k + 0.5) / 16;
      voxels.spawn({
        x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
        vx: (baton.center.x - (a.x + (b.x - a.x) * t)) * 1.5 + (Math.random() - 0.5) * 0.15,
        vy: (baton.center.y - (a.y + (b.y - a.y) * t)) * 1.5 + Math.random() * 0.12,
        size: 0.006 + Math.random() * 0.005,
        life: 0.5 + Math.random() * 0.5,
        heat: 0.5,
        color: baton.color,
        delay: Math.abs(t - 0.5) * 0.1,
      });
    }
  }

  // gone at once, in a flash (the two batons became a light cycle)
  function consume(id) {
    const baton = batons[id];
    if (!baton) return;
    flashes.spawn({ x: baton.center.x, y: baton.center.y, size: 0.05, duration: 0.3, color: baton.color, glint: 0.8, intensity: 0.6 });
    batons[id] = null;
  }

  function endpoints(baton, extent) {
    const reach = baton.half * extent;
    return {
      a: { x: baton.center.x - baton.dir.x * reach, y: baton.center.y - baton.dir.y * reach },
      b: { x: baton.center.x + baton.dir.x * reach, y: baton.center.y + baton.dir.y * reach },
    };
  }

  function slicePoints(ends, out) {
    out.length = 0;
    for (let k = 0; k <= BATON.slices; k++) {
      const t = k / BATON.slices;
      out.push({ x: ends.a.x + (ends.b.x - ends.a.x) * t, y: ends.a.y + (ends.b.y - ends.a.y) * t });
    }
    return out;
  }

  function step(baton, dt) {
    const { target } = baton;
    if (baton.state !== 'collapsing' && target) {
      const previousX = baton.center.x;
      const previousY = baton.center.y;
      baton.center.x = easeTowards(baton.center.x, target.center.x, dt, BATON.poseSmoothing);
      baton.center.y = easeTowards(baton.center.y, target.center.y, dt, BATON.poseSmoothing);
      baton.velocity.x = (baton.center.x - previousX) / dt;
      baton.velocity.y = (baton.center.y - previousY) / dt;
      const x = easeTowards(baton.dir.x, target.dir.x, dt, BATON.poseSmoothing);
      const y = easeTowards(baton.dir.y, target.dir.y, dt, BATON.poseSmoothing);
      const length = Math.hypot(x, y) || 1;
      baton.dir = { x: x / length, y: y / length };
      baton.half = easeTowards(baton.half, target.half, dt, BATON.lengthSmoothing);
    }
    const age = now - baton.since;
    if (baton.state === 'rezzing') {
      baton.extent = smoothstep(0, 1, age / BATON.rezTime);
      if (age >= BATON.rezTime) baton.state = 'held';
    } else if (baton.state === 'held') {
      baton.extent = 1;
    } else {
      baton.extent = 1 - smoothstep(0, 1, age / BATON.collapseTime);
      if (age >= BATON.collapseTime) {
        batons[baton.id] = null;
        return;
      }
    }
    baton.previous = baton.current;
    baton.current = endpoints(baton, baton.extent);
    slicePoints(baton.previous ?? baton.current, baton.slicesBefore);
    slicePoints(baton.current, baton.slicesNow);
    if (baton.state !== 'collapsing') baton.trail.push({ ...baton.current, time: now });
  }

  function cutWalls(baton) {
    if (baton.state === 'collapsing') return;
    const extrude = walls.extrude;
    let cutAny = false;
    let cutPoint = null;
    walls.shatterWhere((sample) => {
      // the middle of the wall's height, where it shows
      const point = { x: sample.x + extrude.x * 0.5, y: sample.y + extrude.y * 0.5 };
      return sweptContains(baton, point, BATON.radius + BATON.cutReach);
    }, (sample) => {
      cutAny = true;
      cutPoint = { x: sample.x + extrude.x * 0.5, y: sample.y + extrude.y * 0.5 };
      // every other sample sheds cubes up the wall, flung along the swing
      if (Math.round(sample.along / WALL.spacing) % 2) return;
      for (let row = 0; row < 3; row++) {
        const lift = (row + 0.5) / 3;
        voxels.spawn({
          x: sample.x + extrude.x * lift, y: sample.y + extrude.y * lift,
          vx: baton.velocity.x * 0.35 + (Math.random() - 0.5) * 0.2,
          vy: baton.velocity.y * 0.35 + (Math.random() - 0.5) * 0.2 + 0.05,
          size: 0.006 + Math.random() * 0.006,
          life: 0.8 + Math.random() * 0.8,
          heat: 0.8,
          color: walls.colorOf(sample),
        });
      }
    }, now);
    if (!cutAny) return;
    counts.cuts++;
    if (now - baton.lastSpark < BATON.sparkEvery) return;
    baton.lastSpark = now;
    flashes.spawn({ x: cutPoint.x, y: cutPoint.y, size: 0.07, duration: 0.3, color: baton.color, glint: 1.2 });
  }

  function writeTrails() {
    let quads = 0;
    for (const id of IDS) {
      const baton = batons[id];
      if (!baton) continue;
      const trail = baton.trail;
      while (trail.length && now - trail[0].time > BATON.trailTime) trail.shift();
      while (trail.length > TRAIL_FRAMES) trail.shift();
      const { r, g, b } = baton.color;
      for (let index = 1; index < trail.length; index++) {
        const older = trail[index - 1];
        const newer = trail[index];
        const ageOld = (now - older.time) / BATON.trailTime;
        const ageNew = (now - newer.time) / BATON.trailTime;
        for (let k = 0; k < BATON.slices; k++) {
          if (quads >= MAX_TRAIL_QUADS) break;
          const t0 = k / BATON.slices;
          const t1 = (k + 1) / BATON.slices;
          const at = (ends, t) => ({ x: ends.a.x + (ends.b.x - ends.a.x) * t, y: ends.a.y + (ends.b.y - ends.a.y) * t });
          const corners = [[at(older, t0), t0, ageOld], [at(older, t1), t1, ageOld],
            [at(newer, t1), t1, ageNew], [at(newer, t0), t0, ageNew]];
          corners.forEach(([point, u, age], corner) => {
            const vertex = quads * 4 + corner;
            trailPositions.set([point.x, point.y, 0], vertex * 3);
            trailData.set([u, age], vertex * 2);
            trailColors.set([r, g, b], vertex * 3);
          });
          quads++;
        }
      }
    }
    trailGeometry.setDrawRange(0, quads * 6);
    for (const name of ['position', 'aTrail', 'aColor']) uploadPrefix(trailGeometry.getAttribute(name), quads * 4);
  }

  function drawRods() {
    for (const id of IDS) {
      const { mesh, uniforms } = rods[id];
      const baton = batons[id];
      mesh.visible = Boolean(baton);
      if (!baton) continue;
      const length = baton.half * baton.extent;
      const halfWidth = BATON.radius * 5;
      mesh.position.set(baton.center.x, baton.center.y, 0);
      mesh.rotation.z = Math.atan2(baton.dir.y, baton.dir.x);
      mesh.scale.set(length + halfWidth, halfWidth, 1);
      uniforms.uQuadHalf.value.set(length + halfWidth, halfWidth);
      uniforms.uLength.value = length;
      uniforms.uColor.value.copy(baton.color);
      uniforms.uPixel.value = 1 / view.height;
      uniforms.uBuild.value = baton.state === 'held' ? 0 : 1;
      uniforms.uBoost.value = linked ? 1.35 + 0.25 * Math.sin(now * 25) : 1;
      uniforms.uTime.value = now;
    }
  }

  return {
    group,
    counts,
    hold,
    release,
    consume,
    // the baton a hand holds (not one that is collapsing)
    get(id) {
      const baton = batons[id];
      return baton && baton.state !== 'collapsing' ? baton : null;
    },
    set linked(value) {
      linked = value;
    },
    // rods that deflect discs, with where they were a frame ago
    sweeps() {
      return IDS.map((id) => batons[id]).filter((baton) => baton && baton.state === 'held');
    },
    update(time, dt) {
      now = time;
      for (const id of IDS) {
        if (batons[id]) step(batons[id], dt);
        if (batons[id]) {
          batons[id].color.lerp(batons[id].team.color, 1 - Math.exp(-dt / 0.2));
          cutWalls(batons[id]);
        }
      }
      writeTrails();
      drawRods();
    },
  };
}

export function distanceToSegment(point, a, b) {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const lengthSquared = abX * abX + abY * abY;
  const t = lengthSquared > 1e-12
    ? Math.min(1, Math.max(0, ((point.x - a.x) * abX + (point.y - a.y) * abY) / lengthSquared)) : 0;
  return Math.hypot(point.x - (a.x + abX * t), point.y - (a.y + abY * t));
}

function inTriangle(p, a, b, c) {
  // a rod that hasn't moved sweeps no area
  if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) < 1e-10) return false;
  const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
  const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
  const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

// Is `point` within `reach` of the rod now, or inside the area it swept
// since the last frame?
export function sweptContains(baton, point, reach) {
  const { current, slicesBefore: before, slicesNow: after } = baton;
  if (!current) return false;
  if (distanceToSegment(point, current.a, current.b) < reach) return true;
  // cheap rejection: outside the box around both positions
  const xs = [before[0].x, before[before.length - 1].x, after[0].x, after[after.length - 1].x];
  const ys = [before[0].y, before[before.length - 1].y, after[0].y, after[after.length - 1].y];
  if (point.x < Math.min(...xs) - reach || point.x > Math.max(...xs) + reach
    || point.y < Math.min(...ys) - reach || point.y > Math.max(...ys) + reach) return false;
  for (let k = 0; k < before.length - 1; k++) {
    if (inTriangle(point, before[k], before[k + 1], after[k + 1]) || inTriangle(point, before[k], after[k + 1], after[k])) {
      return true;
    }
  }
  return false;
}
