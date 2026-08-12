// Derezz voxels: glowing cubes that drift, tumble and fade. Each cube's whole
// life is computed in the vertex shader from its spawn values, so spawning
// is the only CPU work; slots are reused round-robin.
import * as THREE from 'three';
import { additiveMaterial } from './gl.js';

const CAPACITY = 4096;
const DRAG = 1.8;          // 1/s, cubes coast to a drift
const RISE = 0.03;         // view units/s², they float up a little as they cool

const vertexShader = /* glsl */`
  attribute vec3 aStart;     // spawn position (view units)
  attribute vec3 aVelocity;
  attribute vec4 aSpin;      // rotation axis, angular speed
  attribute vec4 aLife;      // birth (s), lifetime (s), edge length, initial heat
  attribute vec3 aColor;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vFade;
  varying float vHeat;
  vec3 rotate(vec3 p, vec3 axis, float angle) {
    return p * cos(angle) + cross(axis, p) * sin(angle) + axis * dot(axis, p) * (1.0 - cos(angle));
  }
  void main() {
    float age = uTime - aLife.x;
    if (age < 0.0 || age > aLife.y) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    float t = age / aLife.y;
    vec3 drift = aVelocity * (1.0 - exp(-${DRAG.toFixed(2)} * age)) / ${DRAG.toFixed(2)}
      + vec3(0.0, ${RISE.toFixed(3)}, 0.0) * age * age;
    float pop = 0.6 + 0.4 * smoothstep(0.0, 0.08, age);
    float size = aLife.z * pop * (1.0 - 0.35 * t);
    vec3 local = rotate(position * size, normalize(aSpin.xyz), aSpin.w * age + aStart.x * 13.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(aStart + drift + local, 1.0);
    vUv = uv;
    vColor = aColor;
    // digital flicker as the cube dies
    float flicker = step(0.35, fract(sin(floor(age * 24.0) + aStart.y * 91.0) * 43758.5));
    vFade = (1.0 - t) * (1.0 - t) * mix(1.0, flicker, smoothstep(0.55, 0.85, t));
    vHeat = aLife.w * exp(-age * 7.0);
  }
`;

const fragmentShader = /* glsl */`
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vFade;
  varying float vHeat;
  void main() {
    vec2 toEdge = min(vUv, 1.0 - vUv);
    float edgeDistance = min(toEdge.x, toEdge.y);
    float px = fwidth(edgeDistance);
    float edge = 1.0 - smoothstep(px, 2.0 * px + 0.05, edgeDistance);
    vec3 color = mix(vColor, vec3(1.0), vHeat * 0.6);
    vec3 col = color * (edge * 0.9 + 0.07) * (1.0 + vHeat * 0.5);
    gl_FragColor = vec4(col * vFade, 1.0);
  }
`;

export function createVoxels() {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = box.index;
  geometry.setAttribute('position', box.getAttribute('position'));
  geometry.setAttribute('uv', box.getAttribute('uv'));
  const attributes = {
    aStart: new Float32Array(CAPACITY * 3),
    aVelocity: new Float32Array(CAPACITY * 3),
    aSpin: new Float32Array(CAPACITY * 4),
    aLife: new Float32Array(CAPACITY * 4),
    aColor: new Float32Array(CAPACITY * 3),
  };
  // everything starts long dead
  for (let slot = 0; slot < CAPACITY; slot++) attributes.aLife[slot * 4] = -1e6;
  for (const [name, array] of Object.entries(attributes)) {
    const itemSize = array.length / CAPACITY;
    geometry.setAttribute(name, new THREE.InstancedBufferAttribute(array, itemSize).setUsage(THREE.DynamicDrawUsage));
  }
  geometry.instanceCount = CAPACITY;

  const uniforms = { uTime: { value: 0 } };
  const mesh = new THREE.Mesh(geometry, additiveMaterial(vertexShader, fragmentShader, uniforms));
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;

  let cursor = 0;
  let dirty = false;
  const deaths = new Float32Array(CAPACITY);   // death times, for counting live cubes
  let now = 0;

  // x, y: view units; vx, vy: view units/s; color: THREE.Color
  function spawn({ x, y, vx = 0, vy = 0, size = 0.012, life = 1.6, heat = 1, color, delay = 0 }) {
    const slot = cursor;
    cursor = (cursor + 1) % CAPACITY;
    const { aStart, aVelocity, aSpin, aLife, aColor } = attributes;
    aStart.set([x, y, 0], slot * 3);
    aVelocity.set([vx, vy, (Math.random() - 0.5) * 0.2], slot * 3);
    const axis = randomAxis();
    aSpin.set([axis.x, axis.y, axis.z, (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random() * 4)], slot * 4);
    aLife.set([now + delay, life, size, heat], slot * 4);
    aColor.set([color.r, color.g, color.b], slot * 3);
    deaths[slot] = now + delay + life;
    dirty = true;
  }

  return {
    mesh,
    spawn,
    update(time) {
      now = time;
      uniforms.uTime.value = time;
      if (!dirty) return;
      for (const name of Object.keys(attributes)) geometry.getAttribute(name).needsUpdate = true;
      dirty = false;
    },
    get alive() {
      let count = 0;
      for (let slot = 0; slot < CAPACITY; slot++) if (deaths[slot] > now) count++;
      return count;
    },
  };
}

function randomAxis() {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(1 - z * z);
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle), z };
}
