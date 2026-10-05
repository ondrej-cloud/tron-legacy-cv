// The grandstand right around the duel floor, as in the film's arena: a
// ring that follows the boundary at a few metres' distance, its rounded
// corners included. In section, from the floor outwards: a low parapet
// with a light strip along its top, the crowd on a steep rake of seats
// broken by aisles and a walkway with glowing gates, a back wall, and a
// roof reaching back over the seats with a bright fascia and a row of
// floodlights. One mesh; everything on it is drawn by its shader.
//
// The model stadium (stadium.js) stands further out behind it.
import * as THREE from 'three';
import { ARENA } from './rules.js';

const STANDS = {
  gap: 12,          // m from the boundary walls to the parapet
  corner: 34,       // m, radius of the rounded corners (at the parapet)
  cornerSteps: 14,
};

// The section: (out, up) points in m, from the parapet's foot outwards,
// and which part each stretch between them is.
const SECTION = [
  { out: 0, up: -1 },
  { out: 0, up: 3.2, part: 0 },       // parapet
  { out: 1.5, up: 3.2, part: 0 },     // its top
  { out: 36, up: 24, part: 1 },       // seats
  { out: 37, up: 31, part: 2 },       // back wall
  { out: 17, up: 33.5, part: 3 },     // roof, reaching back over the seats
  { out: 17, up: 32, part: 4 },       // its fascia
];

const vertexShader = /* glsl */`
  attribute vec3 aSection;    // part, m along the section within the part, length of the part
  attribute float aAlong;     // m along the ring
  varying vec3 vSection;
  varying float vAlong;
  varying vec3 vWorld;
  void main() {
    vSection = aSection;
    vAlong = aAlong;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */`
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uPower;
  uniform float uTime;
  varying vec3 vSection;
  varying float vAlong;
  varying vec3 vWorld;

  float hash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  // a band from a to b across coordinate x, soft by about a pixel
  float band(float x, float a, float b, float pixel) {
    return smoothstep(a - pixel, a + pixel, x) * (1.0 - smoothstep(b - pixel, b + pixel, x));
  }
  vec3 fogged(vec3 color) {
    float d = distance(cameraPosition, vWorld) * uFogDensity;
    return mix(color, uFogColor, 1.0 - exp(-d * d));
  }

  void main() {
    float part = floor(vSection.x + 0.5);
    float up = vSection.y;
    float span = vSection.z;        // the part's length across the section
    float along = vAlong;
    vec2 pixel = max(fwidth(vec2(along, up)), vec2(1e-4));
    vec3 cyan = vec3(0.3, 0.82, 1.0);
    vec3 white = vec3(0.8, 0.94, 1.0);
    vec3 color = vec3(0.006, 0.008, 0.012);

    if (part < 0.5) {
      // the parapet: a light strip along its top, a fainter one at its foot
      color += cyan * band(up, span - 0.35, span - 0.12, pixel.y) * 2.2;
      color += cyan * band(up, 0.9, 1.05, pixel.y) * 0.25;
    } else if (part < 1.5) {
      // the crowd: a seat every 0.6 m in rows 0.9 m apart up the rake
      vec2 seat = vec2(along / 0.6, up / 0.9);
      vec2 cell = floor(seat);
      float person = hash(cell);
      vec3 crowd = mix(vec3(0.03, 0.032, 0.05), vec3(0.17, 0.17, 0.25), person * person);
      crowd = mix(crowd, vec3(0.12, 0.05, 0.05), step(0.97, hash(cell + 7.0)));
      crowd *= 0.55 + 0.45 * step(0.25, fract(seat.y));        // the row in front's backs
      // too small to see one by one: their average
      float tiny = smoothstep(0.25, 0.8, max(pixel.x / 0.6, pixel.y / 0.9));
      crowd = mix(crowd, vec3(0.065, 0.066, 0.095), tiny);
      // fuller and emptier blocks, so it doesn't read as panels
      vec2 block = floor(vec2(along / 4.2, up / 2.7));
      crowd *= 0.45 + 0.9 * hash(block + 3.0) * (0.6 + 0.4 * hash(floor(block / 3.0) + 9.0));
      // aisles every 24 m, and a walkway across the middle
      float aisle = band(mod(along, 24.0), 0.0, 1.4, pixel.x);
      float walk = band(up, span * 0.48, span * 0.48 + 2.2, pixel.y);
      color = mix(crowd, vec3(0.01, 0.012, 0.018), max(aisle, walk));
      color += cyan * band(up, span * 0.48 + 2.2, span * 0.48 + 2.4, pixel.y) * 0.9;
      // gates along the walkway, glowing rounded rectangles
      float gateAt = mod(along + 12.0, 24.0) - 12.0;
      vec2 q = abs(vec2(gateAt, up - span * 0.48 - 1.1)) - vec2(3.0, 0.7) + 0.35;
      float gate = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.35;
      color += mix(cyan, white, 0.5) * (1.0 - smoothstep(0.0, 0.12 + pixel.x, abs(gate))) * 1.2;
      color += cyan * (1.0 - smoothstep(-0.2, 0.0, gate)) * 0.12;
      // a little light from the arena on the front rows
      color += cyan * 0.02 * exp(-up / 4.0);
    } else if (part < 2.5) {
      color += cyan * band(up, span * 0.3, span * 0.3 + 0.25, pixel.y) * 0.8;
    } else if (part < 3.5) {
      // the roof's underside, faintly ribbed
      color += cyan * 0.04 * band(mod(along, 12.0), 0.0, 0.3, pixel.x);
    } else {
      // the fascia: a bright line and floodlights every 20 m
      color += white * band(up, 0.0, 0.25, pixel.y) * 1.6;
      float lamp = band(mod(along, 20.0), 8.0, 12.0, pixel.x) * band(up, 0.45, 1.3, pixel.y);
      color += white * lamp * 2.6;
    }
    gl_FragColor = vec4(fogged(color * uPower), 1.0);
  }
`;

// The ring's path at the parapet: points around a rounded square, with
// the outward direction at each and the distance along it.
function ringPath() {
  const half = ARENA.half + STANDS.gap;
  const radius = STANDS.corner;
  const straight = half - radius;
  const points = [];
  // corners in turn, counter-clockwise from +x +z; each corner's arc
  // joins the straight sides around it
  const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  corners.forEach(([sx, sz], index) => {
    const start = (index * Math.PI) / 2;
    for (let step = 0; step <= STANDS.cornerSteps; step++) {
      const angle = start + (step / STANDS.cornerSteps) * (Math.PI / 2);
      const nx = Math.cos(angle);
      const nz = Math.sin(angle);
      points.push({ x: sx * straight + nx * radius, z: sz * straight + nz * radius, nx, nz });
    }
  });
  points.push({ ...points[0] });   // closed (a copy: the first point keeps along 0)
  let along = 0;
  points.forEach((point, index) => {
    if (index > 0) along += Math.hypot(point.x - points[index - 1].x, point.z - points[index - 1].z);
    point.along = along;
  });
  return points;
}

export function createStands(shared) {
  const path = ringPath();
  const positions = [];
  const sections = [];
  const alongs = [];
  const indices = [];
  for (let stretch = 1; stretch < SECTION.length; stretch++) {
    const from = SECTION[stretch - 1];
    const to = SECTION[stretch];
    const length = Math.hypot(to.out - from.out, to.up - from.up);
    const first = positions.length / 3;
    for (const point of path) {
      for (const [end, along] of [[from, 0], [to, length]]) {
        positions.push(point.x + point.nx * end.out, end.up, point.z + point.nz * end.out);
        sections.push(to.part, along, length);
        alongs.push(point.along);
      }
    }
    for (let index = 0; index < path.length - 1; index++) {
      const a = first + index * 2;
      // a, a + 1 at this point (low, high); a + 2, a + 3 at the next
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSection', new THREE.Float32BufferAttribute(sections, 3));
  geometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(alongs, 1));
  geometry.setIndex(indices);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uFogColor: shared.uFogColor,
      uFogDensity: shared.uFogDensity,
      uPower: shared.uPower,
      uTime: shared.uTime,
    },
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}
