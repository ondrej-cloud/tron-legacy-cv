// A light-wall ribbon: a batch of quads rebuilt every frame, each spanning
// from a base line up to a top line, drawn as a glassy translucent body with
// a crisp bright top edge and base line. Used by the walls the fingertip
// draws and by the walls light cycles leave on the floor.
import * as THREE from 'three';
import { additiveMaterial, quadIndices, uploadPrefix } from './gl.js';

// quads reach past the base and the top so the edge lines antialias on both sides
const EDGE_MARGIN = 0.14;

const vertexShader = /* glsl */`
  attribute vec4 aWall;   // v across the wall (0 base, 1 top), alpha, heat, team
  attribute float aAlong; // distance along the wall
  varying vec4 vWall;
  varying float vAlong;
  void main() {
    vWall = aWall;
    vAlong = aAlong;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  uniform vec3 uTeam[2];
  uniform float uTime;
  varying vec4 vWall;
  varying float vAlong;
  void main() {
    float v = vWall.x;
    float alpha = vWall.y;
    float heat = vWall.z;
    vec3 color = mix(uTeam[0], uTeam[1], vWall.w);
    vec3 hot = mix(color, vec3(1.0), 0.75);
    float px = fwidth(v);
    float baseLine = 1.0 - smoothstep(0.5 * px, 1.6 * px, abs(v));
    float topLine = 1.0 - smoothstep(0.6 * px, 1.9 * px, abs(v - 1.0));
    float inside = step(0.0, v) * step(v, 1.0);
    // glassy body, brighter towards the top, with faint bands and a slow
    // pulse of energy running along the wall
    float bands = 0.5 + 0.5 * step(0.55, fract(v * 4.0));
    float pulse = 0.75 + 0.25 * sin(vAlong * 28.0 - uTime * 7.0);
    float body = inside * (0.05 + 0.2 * v * v) * bands * pulse;
    vec3 col = color * body
      + mix(color * 1.3, hot * 1.7, heat) * topLine
      + mix(color * 0.8, hot * 1.1, heat) * baseLine
      + hot * heat * inside * 0.1;
    gl_FragColor = vec4(col * alpha, 1.0);
  }
`;

// teamColors: [TRON, CLU] colours; time: a shared { value } uniform
export function createRibbon(maxQuads, teamColors, time) {
  const positions = new Float32Array(maxQuads * 4 * 3);
  const wallData = new Float32Array(maxQuads * 4 * 4);
  const alongData = new Float32Array(maxQuads * 4);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aWall', new THREE.BufferAttribute(wallData, 4).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aAlong', new THREE.BufferAttribute(alongData, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(new THREE.BufferAttribute(quadIndices(maxQuads), 1));
  const material = additiveMaterial(vertexShader, fragmentShader, { uTeam: { value: teamColors }, uTime: time });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  let count = 0;
  const vertex = (index, base, top, v, alpha, heat, team, along) => {
    positions[index * 3] = base.x + (top.x - base.x) * v;
    positions[index * 3 + 1] = base.y + (top.y - base.y) * v;
    positions[index * 3 + 2] = 0;
    wallData[index * 4] = v;
    wallData[index * 4 + 1] = alpha;
    wallData[index * 4 + 2] = heat;
    wallData[index * 4 + 3] = team;
    alongData[index] = along;
  };

  return {
    mesh,
    begin() {
      count = 0;
    },
    // One stretch of wall from a to b. Each end: { base, top, alpha, heat, team, along }
    // with base and top in view units.
    quad(a, b) {
      if (count >= maxQuads) return;
      const first = count * 4;
      const low = -EDGE_MARGIN;
      const high = 1 + EDGE_MARGIN;
      vertex(first, a.base, a.top, low, a.alpha, a.heat, a.team, a.along);
      vertex(first + 1, b.base, b.top, low, b.alpha, b.heat, b.team, b.along);
      vertex(first + 2, b.base, b.top, high, b.alpha, b.heat, b.team, b.along);
      vertex(first + 3, a.base, a.top, high, a.alpha, a.heat, a.team, a.along);
      count++;
    },
    end() {
      geometry.setDrawRange(0, count * 6);
      for (const name of ['position', 'aWall', 'aAlong']) uploadPrefix(geometry.getAttribute(name), count * 4);
    },
  };
}
