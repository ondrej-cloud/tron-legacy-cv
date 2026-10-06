// Light batons, the handle a light cycle rezzes from. A shaka (thumb and
// pinky out) rezzes one in the hand, along the thumb-tip to pinky-tip axis,
// centred on the palm: a dark metal cylinder about a hand span long, made
// of two handles joined at a seam in the middle, with glowing bands and
// bright end caps. It rezzes in with light traces running out along it.
// A swing leaves a fading arc of light, cuts the light walls the rod sweeps
// through, and deflects thrown discs (disc.js asks for sweeps()). When the
// other hand takes its free end and pulls (controls.js), a progress bar
// fills along the rod, and at the end it splits into its two handles, one
// in each hand, while the light cycle rezzes between them.
//
// Collisions use the area the rod swept since the last frame, so a fast
// swing can't jump over a wall or a disc.
import * as THREE from 'three';
import { additiveMaterial, quadIndices, uploadPrefix } from './gl.js';
import { easeTowards, smoothstep } from './filters.js';
import { WALL } from './walls.js';

export const BATON = {
  radius: 0.0095,         // view units
  margin: 0.02,           // the rod reaches this far past the thumb and pinky tips
  seam: 0.004,            // half the gap between the two handles
  rezTime: 0.45,          // s for the traces to run out and the rod to build
  collapseTime: 0.25,     // s to collapse into voxels when let go
  splitTime: 0.55,        // s the two handles stay in the hands after a split
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
const RODS = 4;   // a baton per hand, or the two handles of a split one each

const rodVertex = /* glsl */`
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The dark metal of the cylinder: drawn black over what is behind it (the
// layer otherwise only adds light), so it reads as a solid object.
const metalFragment = /* glsl */`
  uniform vec2 uQuadHalf;
  uniform float uLength;
  uniform float uRadius;
  uniform float uPixel;
  uniform float uBuild;
  uniform float uFade;
  varying vec2 vLocal;
  void main() {
    vec2 q = vLocal * uQuadHalf;
    float shown = clamp(uBuild * 1.3 - 0.3, 0.0, 1.0) * uLength;
    float inside = (1.0 - smoothstep(uRadius - uPixel, uRadius, abs(q.y))) * step(abs(q.x), shown);
    gl_FragColor = vec4(0.01, 0.014, 0.018, 0.85 * inside * uFade);
  }
`;

// The light of the cylinder: thin rim lines along its silhouette, a
// specular streak, glowing bands, bright end caps and the seam between the
// two handles.
const rodFragment = /* glsl */`
  uniform vec3 uColor;
  uniform vec2 uQuadHalf;    // the quad's half size, view units
  uniform float uLength;     // half the rod's length
  uniform float uRadius;
  uniform float uSeam;       // half the gap at the seam, 0 for a single handle
  uniform float uPixel;
  uniform float uBuild;      // 0..1 while it rezzes in, 1 when built
  uniform vec2 uGrab;        // progress of a pull (0..1), the grabbed end (+1 / -1, 0 = none)
  uniform float uFade;
  uniform float uTime;
  varying vec2 vLocal;

  float crisp(float distance, float halfWidth) {
    return 1.0 - smoothstep(halfWidth, halfWidth + uPixel, distance);
  }

  void main() {
    vec2 q = vLocal * uQuadHalf;
    float L = uLength;
    float R = uRadius;
    float along = abs(q.x);
    float across = abs(q.y);
    vec3 hot = mix(uColor, vec3(1.0), 0.65);

    // the rezz: traces run out from the middle, the rod builds behind them
    float head = uBuild * 1.3 * L;
    float shown = clamp(uBuild * 1.3 - 0.3, 0.0, 1.0) * L;
    float built = step(along, shown);
    float inside = (1.0 - smoothstep(R - uPixel, R, across)) * built;
    float gap = 1.0 - smoothstep(uSeam, uSeam + uPixel, along);
    inside *= 1.0 - gap * step(0.0001, uSeam);

    float rim = crisp(abs(across - R), 0.35 * uPixel) * built;
    float spec = crisp(abs(q.y - 0.42 * R), 0.35 * uPixel) * inside;
    float spec2 = crisp(abs(q.y + 0.55 * R), 0.3 * uPixel) * inside;
    // three bands around each handle, measured from the seam to the end
    float span = max(L - uSeam, 1e-4);
    float bands = 0.0;
    bands += crisp(abs(along - uSeam - 0.24 * span), 0.0018);
    bands += crisp(abs(along - uSeam - 0.5 * span), 0.0018);
    bands += crisp(abs(along - uSeam - 0.74 * span), 0.0018);
    bands *= inside;
    float cap = crisp(abs(along - (L - 0.0035)), 0.0035) * inside;
    float seamEdges = step(0.0001, uSeam) * crisp(abs(along - uSeam - 0.0012), 0.0008) * inside;
    float outside = length(vec2(max(along - shown, 0.0), max(across - R, 0.0)));
    float glow = exp(-outside / (R * 1.4)) * step(0.0, shown - 0.001);

    vec3 col = uColor * inside * 0.025
      + mix(uColor, vec3(1.0), 0.3) * rim * 0.5
      + vec3(1.0) * spec * 0.45 + vec3(0.7) * spec2 * 0.15
      + (uColor * 0.9 + hot * 0.35) * bands
      + hot * cap * 1.3
      + hot * seamEdges * 0.9
      + uColor * glow * 0.07;

    if (uBuild < 1.0) {
      float lanes = crisp(abs(q.y - R), 0.4 * uPixel) + crisp(abs(q.y + R), 0.4 * uPixel)
        + crisp(abs(q.y - 0.42 * R), 0.4 * uPixel) + crisp(abs(q.y + 0.2 * R), 0.4 * uPixel);
      float traces = lanes * step(along, head) * (0.6 + 0.4 * step(0.5, fract(along * 140.0 - uTime * 20.0)));
      float lag = (along - head) / 0.006;
      float spark = exp(-lag * lag) * exp(-across / (R * 0.9));
      col += hot * traces * 1.5 + vec3(1.0) * spark * 2.5;
    }

    // a pull fills a bar along the axis, from the grabbed end
    if (uGrab.y != 0.0) {
      float x = q.x * uGrab.y;
      float filled = step(L - 2.0 * L * uGrab.x, x) * step(x, L);
      float bar = crisp(across, 0.6 * uPixel) * built;
      col += hot * bar * (0.12 + 1.1 * filled) * (0.85 + 0.15 * sin(uTime * 30.0));
    }
    gl_FragColor = vec4(col * uFade, 1.0);
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
  const rods = [];
  for (let index = 0; index < RODS; index++) {
    const uniforms = {
      uColor: { value: new THREE.Color() },
      uQuadHalf: { value: new THREE.Vector2(1, 1) },
      uLength: { value: 0 },
      uRadius: { value: BATON.radius },
      uSeam: { value: BATON.seam },
      uPixel: { value: 1 / 720 },
      uBuild: { value: 1 },
      uGrab: { value: new THREE.Vector2() },
      uFade: { value: 1 },
      uTime: { value: 0 },
    };
    const mesh = new THREE.Mesh(plane, additiveMaterial(rodVertex, rodFragment, uniforms));
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 3;
    const metal = new THREE.Mesh(plane, new THREE.ShaderMaterial({
      vertexShader: rodVertex,
      fragmentShader: metalFragment,
      uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
    }));
    metal.frustumCulled = false;
    metal.renderOrder = 2.5;
    mesh.add(metal);
    group.add(mesh);
    rods.push({ mesh, uniforms });
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
  const handles = [];   // the two halves of a split baton
  const counts = { rezzed: 0, cuts: 0, splits: 0 };
  let now = 0;

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
        build: 0,
        grab: null,
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

  function shed(a, b, center, color) {
    for (let k = 0; k < 16; k++) {
      const t = (k + 0.5) / 16;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      voxels.spawn({
        x, y,
        vx: (center.x - x) * 1.5 + (Math.random() - 0.5) * 0.15,
        vy: (center.y - y) * 1.5 + Math.random() * 0.12,
        size: 0.006 + Math.random() * 0.005,
        life: 0.5 + Math.random() * 0.5,
        heat: 0.5,
        color,
        delay: Math.abs(t - 0.5) * 0.1,
      });
    }
  }

  function release(id) {
    const baton = batons[id];
    if (!baton || baton.state === 'collapsing') return;
    baton.state = 'collapsing';
    baton.since = now;
    const { a, b } = baton.current ?? endpoints(baton, 1);
    shed(a, b, baton.center, baton.color);
  }

  // The other hand pulled it apart: the two handles go one to each hand.
  // `side` is the grabbed end (+1 / -1 along the rod), `to` the hands:
  // { holder, grabber } ids.
  let palmsAtSplit = {};
  function split(id, side, to) {
    const baton = batons[id];
    if (!baton) return;
    const offset = baton.half / 2;
    const halfLength = baton.half / 2 - BATON.seam / 2;
    for (const [sign, follow] of [[-side, to.holder], [side, to.grabber]]) {
      const center = { x: baton.center.x + baton.dir.x * offset * sign, y: baton.center.y + baton.dir.y * offset * sign };
      handles.push({
        follow,
        // where the handle sits relative to its palm, so it stays there
        offset: palmsAtSplit[follow] ? { x: center.x - palmsAtSplit[follow].x, y: center.y - palmsAtSplit[follow].y } : { x: 0, y: 0 },
        center,
        dir: { ...baton.dir },
        half: halfLength,
        color: baton.color.clone(),
        born: now,
      });
    }
    flashes.spawn({ x: baton.center.x, y: baton.center.y, size: 0.06, duration: 0.35, color: baton.color, glint: 1.2, intensity: 0.8 });
    batons[id] = null;
    counts.splits++;
    log(`baton split ${id[0].toUpperCase()}`);
  }

  // a derezz wave: batons within `radius` of `origin` collapse
  function derezzWithin(origin, radius) {
    derezzWhere((center) => Math.hypot(center.x - origin.x, center.y - origin.y) < radius);
  }

  // batons whose centre `test(point)` accepts collapse (the Recognizer's beam)
  function derezzWhere(test) {
    for (const id of IDS) {
      const baton = batons[id];
      if (baton && baton.state !== 'collapsing' && test(baton.center)) release(id);
    }
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
      baton.build = Math.min(1, age / BATON.rezTime);
      baton.extent = 1;
      if (age >= BATON.rezTime) baton.state = 'held';
    } else if (baton.state === 'held') {
      baton.build = 1;
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
    if (baton.state === 'held') baton.trail.push({ ...baton.current, time: now });
  }

  // the handles of a split baton ride along with their hands, then break up
  function stepHandles(dt, palms) {
    for (let index = handles.length - 1; index >= 0; index--) {
      const handle = handles[index];
      const palm = palms[handle.follow];
      if (palm) {
        handle.center.x = easeTowards(handle.center.x, palm.x + handle.offset.x, dt, 0.05);
        handle.center.y = easeTowards(handle.center.y, palm.y + handle.offset.y, dt, 0.05);
      }
      if (now - handle.born < BATON.splitTime) continue;
      const a = { x: handle.center.x - handle.dir.x * handle.half, y: handle.center.y - handle.dir.y * handle.half };
      const b = { x: handle.center.x + handle.dir.x * handle.half, y: handle.center.y + handle.dir.y * handle.half };
      shed(a, b, handle.center, handle.color);
      handles.splice(index, 1);
    }
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

  function drawRod(rod, { center, dir, half, color, seam, build, grab, fade }) {
    const { mesh, uniforms } = rod;
    const halfWidth = BATON.radius * 4;
    mesh.visible = true;
    mesh.position.set(center.x, center.y, 0);
    mesh.rotation.z = Math.atan2(dir.y, dir.x);
    mesh.scale.set(half + halfWidth, halfWidth, 1);
    uniforms.uQuadHalf.value.set(half + halfWidth, halfWidth);
    uniforms.uLength.value = half;
    uniforms.uSeam.value = seam;
    uniforms.uColor.value.copy(color);
    uniforms.uPixel.value = 1 / view.height;
    uniforms.uBuild.value = build;
    uniforms.uGrab.value.set(grab?.progress ?? 0, grab?.side ?? 0);
    uniforms.uFade.value = fade;
    uniforms.uTime.value = now;
  }

  function drawRods() {
    const draws = [];
    for (const id of IDS) {
      const baton = batons[id];
      if (!baton) continue;
      draws.push({ center: baton.center, dir: baton.dir, half: baton.half * baton.extent, color: baton.color,
        seam: BATON.seam, build: baton.build, grab: baton.grab, fade: 1 });
    }
    for (const handle of handles) {
      const age = now - handle.born;
      draws.push({ center: handle.center, dir: handle.dir, half: handle.half, color: handle.color, seam: 0,
        build: 1, grab: null, fade: 1 - smoothstep(BATON.splitTime * 0.6, BATON.splitTime, age) * 0.6 });
    }
    rods.forEach((rod, index) => {
      if (draws[index]) drawRod(rod, draws[index]);
      else rod.mesh.visible = false;
    });
  }

  return {
    group,
    counts,
    hold,
    release,
    split,
    derezzWithin,
    derezzWhere,
    // a fresh Grid: no batons or handles
    clear() {
      batons.left = null;
      batons.right = null;
      handles.length = 0;
    },
    // the baton a hand holds (not one that is collapsing)
    get(id) {
      const baton = batons[id];
      return baton && baton.state !== 'collapsing' ? baton : null;
    },
    // the other hand's pull: { side, progress } or null
    setGrab(id, grab) {
      if (batons[id]) batons[id].grab = grab;
    },
    // rods that deflect discs, with where they were a frame ago
    sweeps() {
      return IDS.map((id) => batons[id]).filter((baton) => baton && baton.state === 'held');
    },
    // palms: { left, right } in view units (or null) for the handles of a split baton
    update(time, dt, palms) {
      now = time;
      palmsAtSplit = palms;
      for (const id of IDS) {
        if (batons[id]) step(batons[id], dt);
        if (batons[id]) {
          batons[id].color.lerp(batons[id].team.color, 1 - Math.exp(-dt / 0.2));
          cutWalls(batons[id]);
        }
      }
      stepHandles(dt, palms);
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
