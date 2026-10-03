// Jetwalls in 3D: the walls of light a light cycle leaves behind, standing
// on a floor at y = 0, like the film's. A razor-bright white-hot top edge in
// a team-coloured glow, a translucent body that is denser towards the top
// with long horizontal streaks and slow waves of light flowing through it,
// brighter where it is seen edge-on (fresnel), a fainter line where it
// meets the floor, and a crisp white-hot start right behind the cycle. The
// same strip is drawn again mirrored under the floor, dimmer and softer:
// its reflection in the glossy Grid.
//
// World coordinates, y up, so any 3D scene can use it (the AR Grid in
// grid3d.js, or a full arena). The strip is rebuilt every frame from
// stretches of wall: begin(), quad(a, b) for each stretch, end().
import * as THREE from 'three';
import { quadIndices, uploadPrefix } from './gl.js';

// quads reach this far above the top (in wall heights) for the edge's glow
const MARGIN = 0.18;

const vertexShader = /* glsl */`
  attribute vec4 aWall;     // v up the wall (0 floor, 1 top), alpha, heat, team
  attribute vec2 aRun;      // distance along the wall, distance back from the cycle
  attribute vec2 aNormal;   // the wall's normal on the floor (x, z)
  uniform float uMirror;    // 1: the reflection under the floor
  varying vec4 vWall;
  varying vec2 vRun;
  varying vec2 vNormal;
  varying vec3 vWorld;
  void main() {
    vWall = aWall;
    vRun = aRun;
    vNormal = aNormal;
    vec4 world = modelMatrix * vec4(position.x, position.y * (1.0 - 2.0 * uMirror), position.z, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */`
  uniform vec3 uTeam[2];
  uniform float uTime;
  uniform float uMirror;
  uniform float uReflection;   // how bright the reflection is
  varying vec4 vWall;
  varying vec2 vRun;
  varying vec2 vNormal;
  varying vec3 vWorld;
  void main() {
    float v = vWall.x;
    float alpha = vWall.y;
    float heat = vWall.z;
    float along = vRun.x;
    float back = vRun.y;
    vec3 color = mix(uTeam[0], uTeam[1], vWall.w);
    vec3 hot = mix(color, vec3(1.0), 0.8);
    float px = max(fwidth(v), 1e-4);
    float inside = 1.0 - step(1.0, v);
    float h = clamp(v, 0.0, 1.0);
    // the reflection is blurrier: its lines spread over more pixels
    float soft = 1.0 + 2.5 * uMirror;

    // seen edge-on the glass looks thicker and brighter
    vec3 toEye = normalize(cameraPosition - vWorld);
    float facing = abs(dot(vec3(vNormal.x, 0.0, vNormal.y), toEye));
    float grazing = pow(1.0 - facing, 3.0);

    // the top edge: a white-hot core at least a pixel and a half wide (a
    // rounded rim of glass, thicker close up) in a coloured glow, and the
    // glass's thickness as a fainter line just under it
    float coreHalf = max(0.6 * px * soft, 0.008);
    float fromTop = abs(v - 1.0);
    float core = 1.0 - smoothstep(coreHalf, coreHalf + 1.2 * px * soft, fromTop);
    float glow = exp(-fromTop / (3.0 * px * soft + 0.02));
    float bevel = 1.0 - smoothstep(0.5 * px, 1.5 * px, abs(v - 1.0 + 3.0 * coreHalf + 2.0 * px));
    float base = 1.0 - smoothstep(0.8 * px * soft, 2.2 * px * soft, v);

    // the body: tinted glass, faint in the middle, denser towards the top,
    // and a little light caught near the floor
    float body = inside * (0.05 + 0.07 * exp(-h / 0.08) + 0.42 * pow(h, 2.2));
    float streaks = 0.7 + 0.3 * sin(h * 46.0 + 2.2 * sin(along * 2.3 - uTime * 0.7) + along * 0.8);
    streaks *= 0.88 + 0.12 * sin(along * 23.0 - h * 6.0 + uTime * 1.3);
    // slow waves of light flowing through the glass
    float wave = sin(along * 6.0 - uTime * 2.2 + 2.6 * sin(h * 4.5 + along * 1.6 + uTime * 0.8));
    float flow = pow(0.5 + 0.5 * wave, 10.0) * inside * (0.2 + 0.8 * h);

    // right behind the cycle the wall comes out white-hot, with a crisp start
    float emitter = exp(-back / 0.03);
    float pxBack = max(fwidth(back), 1e-5);
    float start = (1.0 - smoothstep(1.0 * pxBack, 2.5 * pxBack, back)) * inside;
    float fresh = max(heat, emitter);

    vec3 col = color * body * streaks * (1.0 + 1.8 * grazing)
      + mix(color, hot, 0.5) * flow * 0.22
      + hot * core * 1.1 + color * glow * 0.3 + color * bevel * 0.3
      + color * base * 0.35
      + hot * (inside * 0.12 + core * 0.4) * fresh
      + hot * start * 0.6;
    // the reflection fades out with depth below the floor, in faint streaks
    float mirrored = uReflection * exp(-h * 3.5) * (0.75 + 0.25 * sin(along * 41.0 + h * 5.0));
    col *= mix(1.0, mirrored, uMirror);
    gl_FragColor = vec4(col * alpha, 1.0);
  }
`;

// teamColors: [TRON, CLU]; time: a shared { value } uniform (seconds);
// reflection: brightness of the reflection in the floor (0 for none)
export function createJetwalls(capacity, teamColors, time, { reflection = 0.2 } = {}) {
  const positions = new Float32Array(capacity * 4 * 3);
  const wallData = new Float32Array(capacity * 4 * 4);
  const runData = new Float32Array(capacity * 4 * 2);
  const normalData = new Float32Array(capacity * 4 * 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aWall', new THREE.BufferAttribute(wallData, 4).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aRun', new THREE.BufferAttribute(runData, 2).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aNormal', new THREE.BufferAttribute(normalData, 2).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(new THREE.BufferAttribute(quadIndices(capacity), 1));

  const material = (mirror) => new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTeam: { value: teamColors },
      uTime: time,
      uMirror: { value: mirror },
      uReflection: { value: reflection },
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const wall = new THREE.Mesh(geometry, material(0));
  const mirror = new THREE.Mesh(geometry, material(1));
  for (const mesh of [wall, mirror]) {
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
  }
  mirror.visible = reflection > 0;
  const object = new THREE.Group();
  object.add(mirror, wall);

  let count = 0;
  const vertex = (index, end, v, height, nx, nz) => {
    positions[index * 3] = end.x;
    positions[index * 3 + 1] = v * height;
    positions[index * 3 + 2] = end.z;
    wallData[index * 4] = v;
    wallData[index * 4 + 1] = end.alpha;
    wallData[index * 4 + 2] = end.heat;
    wallData[index * 4 + 3] = end.team;
    runData[index * 2] = end.along;
    runData[index * 2 + 1] = end.back;
    normalData[index * 2] = nx;
    normalData[index * 2 + 1] = nz;
  };

  return {
    object,
    begin() {
      count = 0;
    },
    // One stretch of wall from a to b. Each end: { x, z, height, alpha, heat,
    // team, along, back }: world floor position, wall height, opacity (0..1),
    // heat (0..1, fresh or struck glass runs white-hot), team index, distance
    // along the wall, and distance back from the cycle that emits it.
    quad(a, b) {
      if (count >= capacity) return;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 1e-6) return;
      const nx = -dz / length;
      const nz = dx / length;
      const first = count * 4;
      const top = 1 + MARGIN;
      vertex(first, a, 0, a.height, nx, nz);
      vertex(first + 1, b, 0, b.height, nx, nz);
      vertex(first + 2, b, top, b.height, nx, nz);
      vertex(first + 3, a, top, a.height, nx, nz);
      count++;
    },
    end() {
      geometry.setDrawRange(0, count * 6);
      for (const name of ['position', 'aWall', 'aRun', 'aNormal']) uploadPrefix(geometry.getAttribute(name), count * 4);
    },
    get count() {
      return count;
    },
  };
}
