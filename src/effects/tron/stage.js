// The stage: one fullscreen pass with the Grid floor along the bottom of the
// frame, the portal's beam of light, the local flash when a hand switches
// team and the derezz shock rings, plus the particles rising in the portal.
// The Grid's lights can be powered down and rebooted (endofline.js).
//
// The floor is seen by a camera `cameraHeight` above it, looking level at
// the horizon. A floor point (x, z) in grid space, at height h, shows at
//   view x = vanish + x / depth,  view y = horizon - (cameraHeight - h) / depth,
// with depth = z - gridScroll * time: the grid slowly slides towards the
// viewer, and light cycles ride on it (project()).
//
// Colours: the left half of the stage takes the left hand's team colour and
// the right half the right hand's, blended across the middle.
import * as THREE from 'three';
import { additiveMaterial } from './gl.js';

export const STAGE = {
  horizon: -0.24,         // view y of the floor's horizon (0.74 of the frame height from the top)
  cameraHeight: 0.26,
  gridDensity: 7,         // grid cells per unit of floor
  gridScroll: 0.05,       // floor units/s
  idleGrid: 0.1,          // grid brightness with nothing going on
  idleHorizon: 0.22,
  sweepTime: 0.8,         // s, the flash around a hand that switches team
  sweepRadius: 0.2,
  shocks: 6,
  cycleLights: 4,
  particles: 700,
};

const fullscreenVertex = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const stageFragment = /* glsl */`
  uniform float uAspect;
  uniform float uPixel;          // view units per pixel
  uniform float uTime;
  uniform vec3 uColorLeft;
  uniform vec3 uColorRight;
  uniform float uSplit;          // view x where the left and right colours meet
  uniform float uVanish;         // view x of the floor's vanishing point
  uniform vec4 uPortal;          // centre x, half width, strength, height of the hands (view units)
  uniform float uPortalAge;      // s since the portal opened
  uniform vec4 uTether[2];       // palm x, y, strength (left, right hand)
  uniform vec4 uSweep[2];        // origin x, y, progress 0..1, strength (left, right hand)
  uniform vec3 uSweepColor[2];
  uniform vec4 uShock[${STAGE.shocks}];   // centre x, y, radius, strength
  uniform vec3 uShockColor[${STAGE.shocks}];
  uniform vec4 uCycle[${STAGE.cycleLights}];   // view x, y, strength, size
  uniform vec3 uCycleColor[${STAGE.cycleLights}];
  uniform float uRiding;         // 0..1, a light cycle is on the floor
  uniform vec3 uPower;           // floor lights, horizon line, how far out the horizon reaches (0..1)
  varying vec2 vUv;

  const float TAU = 6.28318530718;
  const float HORIZON = ${STAGE.horizon.toFixed(4)};

  float crispLine(float distance, float halfWidth) {
    return 1.0 - smoothstep(halfWidth, halfWidth + 1.2 * uPixel, distance);
  }

  vec3 sideColor(float x, float blend) {
    return mix(uColorLeft, uColorRight, smoothstep(uSplit - blend, uSplit + blend, x));
  }

  vec3 gridFloor(vec2 p) {
    // no early return: fwidth needs every pixel of the quad to run the same code
    float onFloor = step(p.y, HORIZON);
    float below = max(HORIZON - p.y, 1e-3);
    float depth = ${STAGE.cameraHeight.toFixed(4)} / below;
    vec2 cell = vec2((p.x - uVanish) * depth, depth + uTime * ${STAGE.gridScroll.toFixed(3)}) * ${STAGE.gridDensity.toFixed(1)};
    vec2 fw = fwidth(cell);
    vec2 d = abs(fract(cell - 0.5) - 0.5);
    vec2 halfWidth = max(vec2(0.025), fw * 0.5);
    vec2 lines = 1.0 - smoothstep(halfWidth, halfWidth + fw * 1.2, d);
    float line = max(lines.x, lines.y) * (1.0 - smoothstep(0.2, 0.65, max(fw.x, fw.y)));
    float near = 0.55 + 0.45 * smoothstep(0.0, 0.25, below + 0.05);

    // the portal lights the floor outwards from its foot
    vec2 foot = vec2(uPortal.x, HORIZON);
    float fromFoot = length((p - foot) * vec2(1.0, 3.2));
    float wave = smoothstep(uPortalAge * 1.8, uPortalAge * 1.8 - 0.25, fromFoot);
    float lit = uPortal.z * wave * (0.25 + 0.6 * exp(-fromFoot * 1.6));
    float brightness = ${STAGE.idleGrid.toFixed(3)} + lit + uRiding * 0.2;
    vec3 col = sideColor(p.x, 0.45) * line * brightness * near;

    // light cycles light up the grid around them in their own colour
    for (int i = 0; i < ${STAGE.cycleLights}; i++) {
      vec4 cycle = uCycle[i];
      if (cycle.z < 0.002) continue;
      float distance = length((p - cycle.xy) * vec2(1.0, 2.6)) / cycle.w;
      col += uCycleColor[i] * (line * 0.9 + 0.05) * exp(-distance * 1.6) * cycle.z * near;
    }

    // the beam's reflection on the glossy floor
    float dx = p.x - uPortal.x;
    float across = dx / (uPortal.y * 0.22 + 2.0 * uPixel);
    float reflection = exp(-across * across) * exp(-below * 4.5)
      * (0.65 + 0.35 * sin(below * 150.0 - uTime * 5.0));
    col += mix(sideColor(p.x, uPortal.y * 0.3 + 0.01), vec3(1.0), 0.4) * reflection * uPortal.z * 0.35;
    return col * onFloor;
  }

  vec3 horizonLine(vec2 p) {
    float reach = uPower.z * uAspect * 0.5;
    float drawn = 1.0 - smoothstep(reach - 0.01, reach, abs(p.x));
    // the tips of a horizon that is still drawing out glow white
    float fromTip = (abs(p.x) - reach) / 0.02;
    float tips = exp(-fromTip * fromTip) * step(uPower.z, 0.999);
    float d = abs(p.y - HORIZON);
    float strength = ${STAGE.idleHorizon.toFixed(3)} + uPortal.z * 0.6 + uRiding * 0.25;
    float nearPortal = 0.55 + 0.45 * exp(-abs(p.x - uPortal.x) * 2.5 * (1.0 - uPortal.z * 0.6));
    float line = crispLine(d, 0.5 * uPixel) * 1.3 + exp(-d * 90.0) * 0.18;
    vec3 col = mix(sideColor(p.x, 0.45), vec3(1.0), 0.25) * line * strength * nearPortal * drawn;
    col += vec3(1.0) * line * tips * 2.0;
    return col * uPower.y;
  }

  vec3 beam(vec2 p) {
    float strength = uPortal.z;
    if (strength < 0.002) return vec3(0.0);
    float dx = p.x - uPortal.x;
    float halfWidth = uPortal.y;
    vec3 color = sideColor(p.x, halfWidth * 0.3 + 0.01);
    float rise = smoothstep(HORIZON - 0.003, HORIZON + 0.004, p.y);
    // above the hands the beam thins out, so the face behind it stays visible
    float above = smoothstep(uPortal.w + 0.02, uPortal.w + 0.24, p.y);
    float shimmer = 0.85 + 0.15 * sin(p.y * 90.0 - uTime * 14.0) * sin(p.y * 23.0 + uTime * 5.0);
    float core = crispLine(abs(dx), 0.9 * uPixel);
    float coreX = dx / (halfWidth * 0.04 + 2.0 * uPixel);
    float innerX = dx / (halfWidth * 0.3);
    float coreGlow = exp(-coreX * coreX);
    float inner = exp(-innerX * innerX);
    float outer = exp(-abs(dx) / (halfWidth * 0.9));
    float height = clamp((p.y - HORIZON) / max(uPortal.w - HORIZON, 0.05), 0.0, 1.0);
    float edges = crispLine(abs(abs(dx) - halfWidth), 0.5 * uPixel) * (1.0 - above) * mix(1.0, 0.5, height);
    // the doorway between the hands: faint rays of light, brightest at the floor
    float inside = 1.0 - smoothstep(halfWidth - 2.0 * uPixel, halfWidth, abs(dx));
    float rays = 0.55 + 0.45 * sin(dx / halfWidth * 23.0 + uTime * 1.3) * sin(dx / halfWidth * 9.0 - uTime * 0.8);
    float doorway = inside * (1.0 - above) * mix(1.0, 0.35, height) * rays;
    vec3 col = vec3(1.0) * core * 1.6 * mix(1.0, 0.22, above)
      + mix(color, vec3(1.0), 0.5) * coreGlow * 0.7 * mix(1.0, 0.12, above)
      + color * (inner * 0.34 * mix(1.0, 0.05, above) + outer * 0.07 * mix(1.0, 0.12, above)) * shimmer
      + color * (edges * 0.8 + doorway * 0.12);
    col *= rise * strength;
    // a pool of light where the beam meets the floor
    vec2 foot = vec2(uPortal.x, HORIZON);
    float pool = exp(-length((p - foot) * vec2(1.0, 8.0)) / (halfWidth * 0.25 + 0.015));
    col += mix(color, vec3(1.0), 0.6) * pool * 0.45 * strength;
    return col;
  }

  // dashed energy lines from the palms into the beam
  vec3 tethers(vec2 p) {
    vec3 col = vec3(0.0);
    for (int i = 0; i < 2; i++) {
      vec4 tether = uTether[i];
      if (tether.z < 0.002) continue;
      vec2 a = tether.xy;
      vec2 b = vec2(uPortal.x, tether.y);
      vec2 ab = b - a;
      float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
      float d = length(p - (a + ab * t));
      float along = t * length(ab);
      float dash = step(0.45, fract(along * 40.0 - uTime * 3.0));
      float fade = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.85, 1.0, t));
      vec3 color = i == 0 ? uColorLeft : uColorRight;
      col += mix(color, vec3(1.0), 0.3) * crispLine(d, 0.5 * uPixel) * dash * fade * tether.z * 0.9;
    }
    return col;
  }

  // a hand switched team: a ring opens around it and a scan bar runs down
  // through it in the new colour
  vec3 sweeps(vec2 p) {
    vec3 col = vec3(0.0);
    for (int i = 0; i < 2; i++) {
      vec4 sweep = uSweep[i];
      if (sweep.w < 0.002) continue;
      float t = sweep.z;
      vec2 offset = p - sweep.xy;
      float r = length(offset);
      float radius = ${STAGE.sweepRadius.toFixed(3)} * (1.0 - pow(1.0 - t, 3.0));
      float d = abs(r - radius);
      float ring = crispLine(d, 0.8 * uPixel) * 1.4 + exp(-d / 0.008) * 0.3;
      float scan = step(0.5, fract(p.y / (3.0 * uPixel)));
      float wash = step(r, radius) * 0.06 * scan;
      float barY = sweep.y + 0.2 - t * 0.4;
      float bar = crispLine(abs(p.y - barY), 0.7 * uPixel) * step(abs(offset.x), 0.17) * 1.3
        * step(r, ${STAGE.sweepRadius.toFixed(3)});
      col += uSweepColor[i] * (ring + wash + bar) * sweep.w;
    }
    return col;
  }

  vec3 shocks(vec2 p) {
    vec3 col = vec3(0.0);
    for (int i = 0; i < ${STAGE.shocks}; i++) {
      vec4 shock = uShock[i];
      if (shock.w < 0.002) continue;
      vec2 offset = p - shock.xy;
      float distance = length(offset);
      float d = abs(distance - shock.z);
      float dashes = step(0.3, fract(atan(offset.y, offset.x) / TAU * 72.0));
      float ring = crispLine(d, 0.6 * uPixel) * (0.5 + 0.6 * dashes);
      float glow = exp(-d * 90.0) * 0.15;
      float wake = smoothstep(shock.z - 0.1, shock.z, distance) * step(distance, shock.z) * 0.08;
      col += mix(uShockColor[i], vec3(1.0), 0.3) * (ring * 1.2 + glow + wake) * shock.w;
    }
    return col;
  }

  void main() {
    vec2 p = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5);
    vec3 col = (gridFloor(p) + beam(p) + tethers(p)) * uPower.x + horizonLine(p) + sweeps(p) + shocks(p);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const particleVertex = /* glsl */`
  attribute vec4 aSeed;
  uniform vec4 uPortal;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vBright;
  varying float vSide;
  void main() {
    float life = fract(aSeed.w + uTime * (0.12 + 0.3 * aSeed.z));
    float y = ${STAGE.horizon.toFixed(4)} + life * (0.55 - ${STAGE.horizon.toFixed(4)});
    float spread = uPortal.y * (0.06 + 0.94 * aSeed.x * aSeed.x);
    float sway = sin(uTime * (1.0 + aSeed.z * 2.0) + aSeed.w * 30.0) * 0.006;
    float offset = (aSeed.y * 2.0 - 1.0) * spread + sway;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(uPortal.x + offset, y, 0.0, 1.0);
    float above = smoothstep(uPortal.w + 0.02, uPortal.w + 0.25, y);
    vBright = uPortal.z * sin(life * 3.14159) * (1.0 - 0.9 * above) * (1.0 - 0.6 * aSeed.x);
    vSide = smoothstep(-0.02, 0.02, offset);
    gl_PointSize = (1.5 + 2.5 * aSeed.z) * uPixelRatio;
  }
`;

const particleFragment = /* glsl */`
  uniform vec3 uColorLeft;
  uniform vec3 uColorRight;
  varying float vBright;
  varying float vSide;
  void main() {
    vec2 q = abs(gl_PointCoord - 0.5);
    float square = 1.0 - smoothstep(0.3, 0.5, max(q.x, q.y));
    vec3 color = mix(uColorLeft, uColorRight, vSide);
    gl_FragColor = vec4(mix(color, vec3(1.0), 0.5) * vBright * 1.5 * square, 1.0);
  }
`;

export function createStage(view, teams) {
  const uniforms = {
    uAspect: { value: 1 },
    uPixel: { value: 1 / 720 },
    uTime: { value: 0 },
    uColorLeft: { value: teams.left.color },
    uColorRight: { value: teams.right.color },
    uSplit: { value: 0 },
    uVanish: { value: 0 },
    uPortal: { value: new THREE.Vector4(0, 0.2, 0, 0) },
    uPortalAge: { value: 0 },
    uTether: { value: [new THREE.Vector4(), new THREE.Vector4()] },
    uSweep: { value: [new THREE.Vector4(), new THREE.Vector4()] },
    uSweepColor: { value: [new THREE.Color(), new THREE.Color()] },
    uShock: { value: Array.from({ length: STAGE.shocks }, () => new THREE.Vector4()) },
    uShockColor: { value: Array.from({ length: STAGE.shocks }, () => new THREE.Color()) },
    uCycle: { value: Array.from({ length: STAGE.cycleLights }, () => new THREE.Vector4()) },
    uCycleColor: { value: Array.from({ length: STAGE.cycleLights }, () => new THREE.Color()) },
    uRiding: { value: 0 },
    uPower: { value: new THREE.Vector3(1, 1, 1) },
  };
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), additiveMaterial(fullscreenVertex, stageFragment, uniforms));
  quad.frustumCulled = false;
  quad.renderOrder = -1;

  const seeds = new Float32Array(STAGE.particles * 4).map(() => Math.random());
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STAGE.particles * 3), 3));
  particleGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const particleUniforms = {
    uPortal: uniforms.uPortal,
    uTime: uniforms.uTime,
    uPixelRatio: { value: 1 },
    uColorLeft: uniforms.uColorLeft,
    uColorRight: uniforms.uColorRight,
  };
  const particles = new THREE.Points(particleGeometry, additiveMaterial(particleVertex, particleFragment, particleUniforms));
  particles.frustumCulled = false;

  const group = new THREE.Group();
  group.add(quad, particles);

  const sweepState = { left: { x: 0, y: 0, start: -Infinity }, right: { x: 0, y: 0, start: -Infinity } };
  const shockState = Array.from({ length: STAGE.shocks }, () => ({ x: 0, y: 0, start: -Infinity, speed: 1, reach: 1, color: new THREE.Color() }));
  let shockCursor = 0;
  let now = 0;
  let vanish = 0;
  let riding = 0;

  return {
    group,
    // grid space -> view units, see the header comment
    project(x, height, z) {
      const depth = Math.max(z - STAGE.gridScroll * now, 1e-3);
      return { x: vanish + x / depth, y: STAGE.horizon - (STAGE.cameraHeight - height) / depth, depth };
    },
    // the inverse for a point on the floor plane, or the depth a height has to sit at
    gridX(viewX, depth) {
      return (viewX - vanish) * depth;
    },
    gridZ(depth) {
      return depth + STAGE.gridScroll * now;
    },
    sweep(id, x, y, color) {
      Object.assign(sweepState[id], { x, y, start: now });
      uniforms.uSweepColor.value[id === 'left' ? 0 : 1].copy(color);
    },
    shock(x, y, color, speed, reach) {
      const shock = shockState[shockCursor];
      shockCursor = (shockCursor + 1) % STAGE.shocks;
      Object.assign(shock, { x, y, start: now, speed, reach });
      shock.color.copy(color);
    },
    // portal: { x, halfWidth, strength, handsY, age }, tethers: [{x, y, strength}] (left, right),
    // cycleLights: [{ x, y, strength, size, color }],
    // light: { floor, horizon, reveal } (endofline.js)
    update(time, portal, tethers, cycleLights, light) {
      uniforms.uPower.value.set(light.floor, light.horizon, light.reveal);
      const dt = Math.min(0.1, Math.max(0, time - now));
      now = time;
      uniforms.uTime.value = time;
      uniforms.uAspect.value = view.aspect;
      uniforms.uPixel.value = 1 / view.height;
      particleUniforms.uPixelRatio.value = view.pixelRatio;
      uniforms.uPortal.value.set(portal.x, portal.halfWidth, portal.strength, portal.handsY);
      uniforms.uPortalAge.value = portal.age;
      uniforms.uSplit.value = portal.x * portal.strength;
      // the floor's vanishing point drifts under the portal
      vanish += (portal.x * portal.strength - vanish) * (1 - Math.exp(-dt / 0.3));
      uniforms.uVanish.value = vanish;
      tethers.forEach((tether, index) => uniforms.uTether.value[index].set(tether.x, tether.y, tether.strength, 0));
      particles.visible = portal.strength * light.floor > 0.002;

      ['left', 'right'].forEach((id, index) => {
        const sweep = sweepState[id];
        const progress = (time - sweep.start) / STAGE.sweepTime;
        const strength = progress < 1 ? 1 - progress * progress : 0;
        uniforms.uSweep.value[index].set(sweep.x, sweep.y, Math.min(1, Math.max(0, progress)), strength);
      });

      shockState.forEach((shock, index) => {
        const age = time - shock.start;
        const radius = age * shock.speed;
        const strength = radius < shock.reach ? (1 - radius / shock.reach) ** 0.7 : 0;
        uniforms.uShock.value[index].set(shock.x, shock.y, radius, strength);
        uniforms.uShockColor.value[index].copy(shock.color);
      });

      let strongest = 0;
      uniforms.uCycle.value.forEach((light, index) => {
        const cycle = cycleLights[index];
        if (!cycle) {
          light.set(0, 0, 0, 1);
          return;
        }
        light.set(cycle.x, cycle.y, cycle.strength, cycle.size);
        uniforms.uCycleColor.value[index].copy(cycle.color);
        strongest = Math.max(strongest, cycle.strength);
      });
      riding += (strongest - riding) * (1 - Math.exp(-dt / 0.4));
      uniforms.uRiding.value = riding;
    },
  };
}
