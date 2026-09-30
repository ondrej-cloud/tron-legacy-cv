// Glass light walls, like the jetwalls behind the light cycles in the film:
// a batch of quads rebuilt every frame, each spanning from a base line up to
// a top line. A razor-bright top edge (a white-hot core in a team-coloured
// glow) with a faint bevel line under it for the glass's thickness, and a
// translucent tinted body that fades towards the base, with long streaks
// and a slow reflection sliding through it. Where the wall is seen edge-on
// the glass looks thicker and brighter, like a fresnel rim. Used by the
// walls the fingertip draws and by the walls the light cycles leave.
import * as THREE from 'three';
import { additiveMaterial, quadIndices, uploadPrefix } from './gl.js';

// quads reach past the base and the top so the edge lines antialias on both sides
const EDGE_MARGIN = 0.25;

const vertexShader = /* glsl */`
  attribute vec4 aWall;    // v across the wall (0 base, 1 top), alpha, heat, team
  attribute vec2 aGlass;   // distance along the wall, how edge-on it is seen (0..1)
  varying vec4 vWall;
  varying vec2 vGlass;
  void main() {
    vWall = aWall;
    vGlass = aGlass;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  uniform vec3 uTeam[2];
  uniform float uTime;
  uniform float uBody;     // how dense the glass is
  uniform float uEdgeOn;   // how much the viewing angle changes the look (0..1)
  varying vec4 vWall;
  varying vec2 vGlass;
  void main() {
    float v = vWall.x;
    float alpha = vWall.y;
    float heat = vWall.z;
    float along = vGlass.x;
    float edgeOn = vGlass.y * uEdgeOn;
    vec3 color = mix(uTeam[0], uTeam[1], vWall.w);
    vec3 hot = mix(color, vec3(1.0), 0.8);
    float px = max(fwidth(v), 1e-4);
    float inside = step(0.0, v) * step(v, 1.0);

    // the top edge: a crisp white-hot line in a coloured glow
    float top = 1.0 - smoothstep(0.45 * px, 1.4 * px, abs(v - 1.0));
    float glow = exp(-abs(v - 1.0) / (4.0 * px));
    // the glass's thickness: a second, fainter line just under the top
    float bevel = 1.0 - smoothstep(0.35 * px, 1.2 * px, abs(v - 1.0 + 3.5 * px));
    float base = 1.0 - smoothstep(0.4 * px, 1.3 * px, abs(v));
    // the glass catches light along its lower edge too
    float lowerRim = inside * exp(-v / 0.12) * 0.12;

    // the body: tinted glass, clear at the base and denser towards the top,
    // with long streaks that waver along the wall
    // (pow of a negative number is NaN, and bloom would smear it over the frame)
    float body = inside * (0.025 + 0.25 * pow(clamp(v, 0.0, 1.0), 1.7)) * uBody;
    float streaks = 0.62 + 0.38 * sin(v * 42.0 + 2.6 * sin(along * 2.7 + uTime * 0.5) + along * 1.3);
    streaks *= 0.85 + 0.15 * sin(along * 31.0 - v * 7.0 + uTime * 1.5);
    // a soft reflection sliding through the glass
    float sweep = fract(along * 0.4 - uTime * 0.11 + v * 0.3);
    float fromSweep = (sweep - 0.5) / 0.05;
    float reflection = exp(-fromSweep * fromSweep) * inside * v * 0.3;
    float fresnel = mix(1.0, 1.7, edgeOn);
    // seen edge-on the wall folds onto itself and the layers add up: thin it out
    float folded = mix(1.0, 0.45, edgeOn);

    vec3 col = color * body * streaks * fresnel
      + hot * reflection
      + mix(color, hot, 0.7) * top * 1.25 + color * glow * 0.28
      + color * bevel * 0.45
      + color * base * 0.2 * uBody
      + color * lowerRim;
    // fresh or struck glass runs hot
    col += (hot * inside * 0.1 + hot * top * 0.5) * heat;
    gl_FragColor = vec4(col * alpha * folded, 1.0);
  }
`;

// teamColors: [TRON, CLU] colours; time: a shared { value } uniform;
// body: how dense the glass is (walls over the bright Grid floor need more);
// edgeOn: how much a wall seen edge-on changes (the curving cycle walls) or
// not at all (the drawn walls, whose runs should all read the same)
export function createRibbon(maxQuads, teamColors, time, { body = 1, edgeOn = 1 } = {}) {
  const positions = new Float32Array(maxQuads * 4 * 3);
  const wallData = new Float32Array(maxQuads * 4 * 4);
  const glassData = new Float32Array(maxQuads * 4 * 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aWall', new THREE.BufferAttribute(wallData, 4).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aGlass', new THREE.BufferAttribute(glassData, 2).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(new THREE.BufferAttribute(quadIndices(maxQuads), 1));
  const material = additiveMaterial(vertexShader, fragmentShader,
    { uTeam: { value: teamColors }, uTime: time, uBody: { value: body }, uEdgeOn: { value: edgeOn } });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  let count = 0;
  const vertex = (index, end, v, edgeOn) => {
    positions[index * 3] = end.base.x + (end.top.x - end.base.x) * v;
    positions[index * 3 + 1] = end.base.y + (end.top.y - end.base.y) * v;
    positions[index * 3 + 2] = 0;
    wallData[index * 4] = v;
    wallData[index * 4 + 1] = end.alpha;
    wallData[index * 4 + 2] = end.heat;
    wallData[index * 4 + 3] = end.team;
    glassData[index * 2] = end.along;
    glassData[index * 2 + 1] = edgeOn;
  };

  // how edge-on a stretch of wall is seen: its base runs along the
  // direction it rises in
  function edgeOnness(a, b) {
    const runX = b.base.x - a.base.x;
    const runY = b.base.y - a.base.y;
    const riseX = a.top.x - a.base.x;
    const riseY = a.top.y - a.base.y;
    const run = Math.hypot(runX, runY);
    const rise = Math.hypot(riseX, riseY);
    if (run < 1e-9 || rise < 1e-9) return 1;
    return Math.abs(runX * riseX + runY * riseY) / (run * rise);
  }

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
      const edgeOn = edgeOnness(a, b) ** 2;
      vertex(first, a, low, edgeOn);
      vertex(first + 1, b, low, edgeOn);
      vertex(first + 2, b, high, edgeOn);
      vertex(first + 3, a, high, edgeOn);
      count++;
    },
    end() {
      geometry.setDrawRange(0, count * 6);
      for (const name of ['position', 'aWall', 'aGlass']) uploadPrefix(geometry.getAttribute(name), count * 4);
    },
  };
}
