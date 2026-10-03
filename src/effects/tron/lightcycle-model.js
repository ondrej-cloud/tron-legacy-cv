// A light cycle in 3D: the glTF model (models/light-cycle.glb) or, where it
// can't be had, a stand-in built from primitives, prepared once as a
// template and then instanced for each cycle on the Grid.
//
// Looks: a near-black lacquered body that reflects the arena's lights
// (environment.js), with a rim light in the team colour along its
// silhouette, and glowing trim (wheel rims, body lines) in the team colour,
// so over the camera image, where black is see-through, the bike still
// reads as a shape drawn in light.
//
// The rezz, like the film's: concentric rings bloom where the front wheel
// will be, then the rear one; a holographic build (wireframe and voxels)
// sweeps from front to back behind a bright scan line that runs over the
// bike's surface; the solid glossy bike follows it; then the rims light up.
//
// Bike space: x forward from the tail (0) to the nose (1), y up from the
// ground, z across, centred. The caller places `object` and scales nothing:
// setLength() sets the bike's length in world units.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// models/models.json lists the models that are there, so a missing one is
// skipped quietly instead of with a 404:
//   { "light-cycle": { "file": "light-cycle.glb", "forward": "+z" } }
// `forward` is the direction the model's nose points in (+x, -x, +z or -z);
// without it the nose is taken to point along the long axis, positive way.
const MODELS = new URL('../../../models/', import.meta.url);

// The rezz, in seconds since it began: [start, end] of each phase.
export const REZZ = {
  rings: [[0, 0.5], [0.15, 0.65]],   // front wheel, then rear: rings bloom out from the hub
  holo: [0.3, 1.0],                  // the hologram sweeps front to back ...
  solid: [0.75, 1.4],                // ... and the solid bike follows it
  rims: [1.2, 1.65],                 // the rims light up
  length: 1.7,
};

const VOXEL_COUNT = 3200;
const RING_FRACTIONS = [0.38, 0.68, 1.0];
const WIRE_ANGLE = 28;   // degrees between faces for an edge to show in the wireframe

// ---------------------------------------------------------------- templates

// A model's entry in models/models.json with its full `url`, or null.
export async function findModel(name) {
  try {
    const response = await fetch(new URL('models.json', MODELS));
    if (!response.ok) return null;
    const entry = (await response.json())[name];
    return entry?.file ? { ...entry, url: new URL(entry.file, MODELS).href } : null;
  } catch {
    return null;
  }
}

// Loads the light cycle's glTF (from models.json, or `url`) and turns it
// into a template (and logs what it found), or resolves to null if there
// is no model.
export async function loadLightCycle(url = null, forward = null) {
  const entry = url ? { url, forward } : await findModel('light-cycle');
  if (!entry) return null;
  const gltf = await new GLTFLoader().loadAsync(entry.url);
  return templateFromScene(gltf.scene, entry.url, entry.forward);
}

function templateFromScene(root, label, forward = null) {
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((node) => {
    if (node.isMesh && node.geometry?.attributes.position) meshes.push(node);
  });
  if (!meshes.length) throw new Error(`${label}: no meshes`);

  // overall bounds, in the model's own frame
  const bounds = new THREE.Box3();
  for (const mesh of meshes) bounds.union(new THREE.Box3().setFromObject(mesh));
  const size = bounds.getSize(new THREE.Vector3());
  // glTF's y is up; the nose points along the long axis unless told otherwise
  const nose = forward ?? (size.x >= size.z ? '+x' : '+z');
  const length = nose.endsWith('x') ? size.x : size.z;
  const turn = { '+x': 0, '+z': Math.PI / 2, '-x': Math.PI, '-z': -Math.PI / 2 }[nose] ?? 0;

  const toBike = new THREE.Matrix4();
  {
    // turn the nose onto +x, move the tail to x = 0 and the ground to y = 0, scale to length 1
    const rotate = new THREE.Matrix4().makeRotationY(turn);
    const rotated = bounds.clone().applyMatrix4(rotate);
    const center = rotated.getCenter(new THREE.Vector3());
    const scale = 1 / length;
    toBike.makeScale(scale, scale, scale)
      .multiply(new THREE.Matrix4().makeTranslation(-rotated.min.x, -rotated.min.y, -center.z))
      .multiply(rotate);
  }

  // Every mesh in bike space. The wheel meshes (named like wheels or tyres,
  // not their covers) are split at the middle of the bike into a rear and a
  // front wheel, each around its own hub so it can spin: models often keep
  // both wheels in one mesh.
  const parts = [];
  const halves = [[], []];
  for (const mesh of meshes) {
    const matrix = new THREE.Matrix4().multiplyMatrices(toBike, mesh.matrixWorld);
    const geometry = mesh.geometry.clone().applyMatrix4(matrix);
    // a mirroring transform turns the triangles inside out
    if (matrix.determinant() < 0) flipWinding(geometry);
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const part = { name: mesh.name || material?.name || 'part', geometry, wheel: -1, kind: classify(material), source: material,
      // wheel covers don't spin, but light up in the wheels' colour
      accent: /wheel|tire|tyre/i.test(nameChain(mesh, root)) };
    if (!isWheelMesh(mesh, root)) {
      parts.push(part);
      continue;
    }
    splitAtX(geometry, 0.5).forEach((half, index) => {
      if (half) halves[index].push({ ...part, geometry: half });
    });
  }
  const wheels = [];
  for (const group of halves) {
    if (!group.length) continue;
    const box = new THREE.Box3();
    for (const part of group) {
      part.geometry.computeBoundingBox();
      box.union(part.geometry.boundingBox);
    }
    const center = box.getCenter(new THREE.Vector3());
    const extent = box.getSize(new THREE.Vector3());
    const wheel = wheels.length;
    wheels.push({ center, radius: Math.max(extent.x, extent.y) / 2, halfWidth: extent.z / 2 });
    for (const part of group) {
      part.geometry.translate(-center.x, -center.y, -center.z);
      parts.push({ ...part, wheel });
    }
  }

  const template = finishTemplate(parts, wheels, 'glb');
  template.nose = nose;
  logTemplate(template, label, meshes, size);
  return template;
}

function nameChain(mesh, root) {
  const names = [];
  for (let node = mesh; node && node !== root; node = node.parent) names.push(node.name);
  return names.join(' ');
}

function isWheelMesh(mesh, root) {
  for (let node = mesh; node && node !== root; node = node.parent) {
    if (/cover|fender|guard/i.test(node.name)) return false;
    if (/wheel|tire|tyre/i.test(node.name)) return true;
  }
  return false;
}

function flipWinding(geometry) {
  if (!geometry.index) geometry.setIndex([...Array(geometry.attributes.position.count).keys()]);
  const index = geometry.index;
  for (let k = 0; k + 2 < index.count; k += 3) {
    const b = index.getX(k + 1);
    index.setX(k + 1, index.getX(k + 2));
    index.setX(k + 2, b);
  }
  index.needsUpdate = true;
}

// The triangles of a geometry on either side of x = `at` (by their middle):
// [behind, ahead], either null if empty.
function splitAtX(geometry, at) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = flat.attributes.position;
  const sides = [[], []];
  for (let k = 0; k + 2 < position.count; k += 3) {
    const middle = (position.getX(k) + position.getX(k + 1) + position.getX(k + 2)) / 3;
    sides[middle < at ? 0 : 1].push(k);
  }
  return sides.map((starts) => {
    if (!starts.length) return null;
    const half = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(flat.attributes)) {
      const size = attribute.itemSize;
      const array = new Float32Array(starts.length * 3 * size);
      starts.forEach((start, triangle) => {
        for (let corner = 0; corner < 3; corner++) {
          for (let c = 0; c < size; c++) {
            array[(triangle * 3 + corner) * size + c] = attribute.getComponent(start + corner, c);
          }
        }
      });
      half.setAttribute(name, new THREE.BufferAttribute(array, size));
    }
    return half;
  });
}

// Trim is anything that already glows; the rest is body.
function classify(material) {
  if (!material) return 'body';
  const emissive = material.emissive && (material.emissive.r + material.emissive.g + material.emissive.b) > 0.05;
  return emissive || material.emissiveMap ? 'trim' : 'body';
}

function logTemplate(template, label, meshes, size) {
  const triangles = template.parts.reduce((sum, part) => sum + triangleCount(part.geometry), 0);
  const materials = new Map();
  for (const part of template.parts) {
    const material = part.source;
    const key = material?.name || material?.uuid || 'none';
    if (!materials.has(key)) {
      materials.set(key, `${key} (${part.kind}; ${material?.type ?? '-'}`
        + `${material?.map ? ', map' : ''}${material?.normalMap ? ', normalMap' : ''}`
        + `${material?.emissiveMap ? ', emissiveMap' : ''}${material?.metalnessMap ? ', metal/rough map' : ''}`
        + `${material?.emissive ? `, emissive #${material.emissive.getHexString()}` : ''})`);
    }
  }
  console.info(`[light cycle] ${label}: ${meshes.length} meshes, ${triangles} triangles, `
    + `size ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)} (model units); `
    + `materials: ${[...materials.values()].join('; ')}; `
    + `wheels: ${template.wheels.length ? template.wheels.map((wheel) => `x ${wheel.center.x.toFixed(2)} r ${wheel.radius.toFixed(2)}`).join(', ') : 'not separate'}; `
    + `wireframe ${template.wireSegments} lines, nose ${template.nose}, height ${template.height.toFixed(2)}, width ${template.width.toFixed(2)} (lengths)`);
}

function triangleCount(geometry) {
  return (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
}

// A TRON: Legacy style cycle from primitives: two wide wheels with glowing
// rims at either end, a long low shell arching over them, a light line
// along each flank and a tail light.
export function buildLightCycle() {
  const radius = 0.175;
  const tireHalf = 0.065;
  const wheels = [0.185, 0.815].map((x) => ({ center: new THREE.Vector3(x, radius, 0), radius, halfWidth: tireHalf }));
  const parts = [];
  const body = (geometry, wheel = -1) => parts.push({ name: 'shell', geometry, wheel, kind: 'body' });
  const trim = (geometry, wheel = -1) => parts.push({ name: 'trim', geometry, wheel, kind: 'trim' });

  wheels.forEach((wheel, index) => {
    const tire = new THREE.CylinderGeometry(radius, radius, tireHalf * 2, 48, 1);
    tire.rotateX(Math.PI / 2);
    body(tire, index);
    const hub = new THREE.CylinderGeometry(radius * 0.42, radius * 0.42, tireHalf * 2 + 0.012, 24, 1);
    hub.rotateX(Math.PI / 2);
    body(hub, index);
    for (const side of [-1, 1]) {
      const rim = new THREE.TorusGeometry(radius * 0.86, 0.014, 16, 72);
      rim.translate(0, 0, side * (tireHalf + 0.002));
      trim(rim, index);
      const inner = new THREE.TorusGeometry(radius * 0.5, 0.006, 16, 48);
      inner.translate(0, 0, side * (tireHalf + 0.006));
      trim(inner, index);
      // segments across the face, so a spinning wheel shows it
      for (let k = 0; k < 3; k++) {
        const bar = new THREE.BoxGeometry(radius * 0.3, 0.008, 0.004);
        bar.translate(radius * 0.66, 0, side * (tireHalf + 0.004));
        bar.rotateZ((k / 3) * Math.PI * 2);
        trim(bar, index);
      }
    }
  });

  const outline = [[0.0, 0.26], [0.03, 0.345], [0.13, 0.385], [0.3, 0.375], [0.46, 0.34], [0.6, 0.345],
    [0.76, 0.385], [0.9, 0.37], [0.995, 0.3], [0.99, 0.22], [0.88, 0.16], [0.62, 0.115], [0.38, 0.115],
    [0.12, 0.16]];
  const curve = new THREE.CatmullRomCurve3(outline.map(([x, y]) => new THREE.Vector3(x, y, 0)), true, 'centripetal');
  const shape = new THREE.Shape(curve.getPoints(90).map((point) => new THREE.Vector2(point.x, point.y)));
  const shellDepth = 0.075;
  const shell = new THREE.ExtrudeGeometry(shape, {
    depth: shellDepth, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.012, bevelSegments: 4, curveSegments: 4,
  });
  shell.translate(0, 0, -shellDepth / 2);
  body(shell);

  // light lines along both flanks, and the tail light where the wall comes out
  const flank = new THREE.CatmullRomCurve3([[0.04, 0.27], [0.16, 0.31], [0.34, 0.25], [0.55, 0.22], [0.74, 0.29],
    [0.9, 0.31], [0.97, 0.27]].map(([x, y]) => new THREE.Vector3(x, y, 0)));
  for (const side of [-1, 1]) {
    const line = new THREE.TubeGeometry(flank, 64, 0.0055, 16, false);
    line.translate(0, 0, side * (shellDepth / 2 + 0.019));
    trim(line);
  }
  const tail = new THREE.BoxGeometry(0.012, 0.05, shellDepth);
  tail.translate(0.012, 0.29, 0);
  trim(tail);

  return finishTemplate(parts, wheels, 'builtin');
}

// Wireframe edges and voxel samples for every part, and the overall size.
function finishTemplate(parts, wheels, source) {
  const bounds = new THREE.Box3();
  const offset = new THREE.Vector3();
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    const box = part.geometry.boundingBox.clone();
    if (part.wheel >= 0) box.translate(offset.copy(wheels[part.wheel].center));
    bounds.union(box);
    part.edges = new THREE.EdgesGeometry(part.geometry, WIRE_ANGLE);
  }
  const areas = parts.map((part) => surfaceArea(part.geometry));
  const total = areas.reduce((sum, area) => sum + area, 0) || 1;
  parts.forEach((part, index) => {
    part.voxels = sampleSurface(part.geometry, Math.max(4, Math.round(VOXEL_COUNT * areas[index] / total)));
  });
  const size = bounds.getSize(new THREE.Vector3());
  // a detailed model has a dense wireframe: each line is dimmer, so the
  // hologram doesn't burn out
  const segments = parts.reduce((sum, part) => sum + part.edges.attributes.position.count / 2, 0);
  const wireGain = Math.min(1, Math.max(0.2, 1200 / Math.max(1, segments)));
  return { source, parts, wheels, height: size.y, width: size.z, wireSegments: segments, wireGain };
}

function surfaceArea(geometry) {
  let area = 0;
  forEachTriangle(geometry, (a, b, c) => {
    area += triangleArea(a, b, c);
  });
  return area;
}

const scratch = { ab: new THREE.Vector3(), ac: new THREE.Vector3() };
function triangleArea(a, b, c) {
  return scratch.ab.subVectors(b, a).cross(scratch.ac.subVectors(c, a)).length() / 2;
}

function forEachTriangle(geometry, visit) {
  const position = geometry.attributes.position;
  const index = geometry.index;
  const count = index ? index.count : position.count;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let k = 0; k + 2 < count; k += 3) {
    const ia = index ? index.getX(k) : k;
    const ib = index ? index.getX(k + 1) : k + 1;
    const ic = index ? index.getX(k + 2) : k + 2;
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    visit(a, b, c);
  }
}

// `count` random points on the surface, area-weighted, with a random seed each
function sampleSurface(geometry, count) {
  const triangles = [];
  let total = 0;
  forEachTriangle(geometry, (a, b, c) => {
    const area = triangleArea(a, b, c);
    if (area <= 0) return;
    total += area;
    triangles.push({ a: a.clone(), b: b.clone(), c: c.clone(), upTo: total });
  });
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const point = new THREE.Vector3();
  for (let k = 0; k < count && triangles.length; k++) {
    const pick = Math.random() * total;
    let low = 0;
    let high = triangles.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (triangles[middle].upTo < pick) low = middle + 1;
      else high = middle;
    }
    const { a, b, c } = triangles[low];
    let u = Math.random();
    let v = Math.random();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    point.copy(a).addScaledVector(scratch.ab.subVectors(b, a), u).addScaledVector(scratch.ac.subVectors(c, a), v);
    point.toArray(positions, k * 3);
    seeds[k] = Math.random();
  }
  const geometryOut = new THREE.BufferGeometry();
  geometryOut.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometryOut.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  return geometryOut;
}

// ---------------------------------------------------------------- shaders

// Solid materials (MeshPhysicalMaterial) get the rezz cut, the scan line
// and the rim light patched in.
const solidVertexHead = /* glsl */`
  uniform mat4 uToBike;
  varying float vRezzU;
`;
const solidVertexBody = /* glsl */`
  vRezzU = (uToBike * modelMatrix * vec4(transformed, 1.0)).x;
`;
const solidFragmentHead = /* glsl */`
  uniform float uHoloCut;
  uniform float uSolidCut;
  uniform vec3 uScanColor;
  uniform float uScan;
  uniform vec3 uRimColor;
  uniform float uRim;
  varying float vRezzU;
`;
// ahead of the solid part only the scan line shows, drawn on the surface
const solidFragmentCut = /* glsl */`
  float scanBand = 1.0 - smoothstep(0.004, 0.012, abs(vRezzU - uHoloCut));
  bool ghost = vRezzU < uSolidCut;
  if (ghost && scanBand * uScan < 0.05) discard;
`;
const solidFragmentGlow = /* glsl */`
  {
    // rim light along the silhouette, in the team colour
    float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
    totalEmissiveRadiance += uRimColor * pow(1.0 - facing, 3.0) * uRim;
    // the solid's leading edge glows as it forms
    float forming = exp(-max(vRezzU - uSolidCut, 0.0) / 0.02);
    totalEmissiveRadiance += uScanColor * forming * uScan * 0.6;
  }
`;
const solidFragmentEnd = /* glsl */`
  if (ghost) gl_FragColor = vec4(uScanColor * scanBand * uScan * 1.2, 1.0);
`;
// a coloured emissive map only says where the trim glows; the team colour says how
const tintedEmissiveMap = /* glsl */`
  #ifdef USE_EMISSIVEMAP
    vec4 emissiveColor = texture2D(emissiveMap, vEmissiveMapUv);
    totalEmissiveRadiance *= max(emissiveColor.r, max(emissiveColor.g, emissiveColor.b));
  #endif
`;

function patchSolid(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${solidVertexHead}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${solidVertexBody}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${solidFragmentHead}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${solidFragmentCut}`)
      .replace('#include <emissivemap_fragment>', `${tintedEmissiveMap}\n${solidFragmentGlow}`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${solidFragmentEnd}`);
  };
  material.customProgramCacheKey = () => 'light-cycle-solid';
}

const wireVertex = /* glsl */`
  uniform mat4 uToBike;
  varying float vU;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vU = (uToBike * world).x;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const wireFragment = /* glsl */`
  uniform vec3 uColor;
  uniform float uHoloCut;
  uniform float uSolidCut;
  uniform float uHolo;
  uniform float uWireGain;
  uniform float uTime;
  varying float vU;
  void main() {
    if (vU < uHoloCut) discard;
    float fresh = exp(-(vU - uHoloCut) / 0.05);
    float solid = smoothstep(uSolidCut - 0.01, uSolidCut + 0.05, vU);
    float flicker = 0.85 + 0.15 * step(0.5, fract(sin(floor(uTime * 24.0) + vU * 40.0) * 43758.5));
    float bright = (0.45 + 1.3 * fresh) * (1.0 - solid) * flicker * uHolo * uWireGain;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.3 + 0.5 * fresh) * bright, 1.0);
  }
`;

const voxelVertex = /* glsl */`
  attribute float aSeed;
  uniform mat4 uToBike;
  uniform float uHoloCut;
  uniform float uSolidCut;
  uniform float uHolo;
  uniform float uTime;
  uniform float uSize;            // world units
  uniform float uPixelsPerUnit;   // at a distance of 1
  varying float vBright;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    float u = (uToBike * world).x;
    float passed = u - uHoloCut;
    float near = exp(-abs(passed) / 0.06);
    // the built part, until the solid takes over
    float built = step(0.0, passed) * (1.0 - smoothstep(0.0, 0.05, u - uSolidCut));
    // a few cubes glitch in just ahead of the sweep
    float glitch = step(passed, 0.0) * step(-0.08, passed)
      * step(0.7, fract(aSeed * 91.7 + floor(uTime * 22.0) * 0.371));
    float flicker = 0.7 + 0.3 * step(0.4, fract(aSeed * 57.3 + floor(uTime * 18.0) * 0.53));
    vBright = (built * (0.3 + 1.0 * near) + glitch * 0.8) * flicker * uHolo;
    // fresh cubes pop out a little from the surface before they settle
    world.y += near * built * (fract(aSeed * 7.13) - 0.3) * uSize * 2.0;
    vec4 clip = projectionMatrix * viewMatrix * world;
    gl_Position = clip;
    float size = uSize * uPixelsPerUnit / max(clip.w, 1e-3) * (0.5 + fract(aSeed * 13.7));
    gl_PointSize = vBright > 0.01 ? clamp(size, 1.5, 12.0) : 0.0;
  }
`;

const voxelFragment = /* glsl */`
  uniform vec3 uColor;
  varying float vBright;
  void main() {
    vec2 q = abs(gl_PointCoord - 0.5);
    float edge = max(q.x, q.y);
    float cube = 1.0 - smoothstep(0.36, 0.5, edge);
    float frame = smoothstep(0.22, 0.36, edge) * cube;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.35) * (0.2 * cube + 0.75 * frame) * vBright, 1.0);
  }
`;

// concentric rings blooming out from a hub, drawn on a quad in the wheel's plane
const ringVertex = /* glsl */`
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ringFragment = /* glsl */`
  uniform vec3 uColor;
  uniform float uProgress;
  uniform float uFade;
  varying vec2 vLocal;   // in wheel radii
  void main() {
    float r = length(vLocal);
    float aa = max(fwidth(r), 1e-4);
    vec3 col = vec3(0.0);
    ${RING_FRACTIONS.map((fraction, index) => `{
      float local = clamp(uProgress * 1.6 - ${(index * 0.3).toFixed(2)}, 0.0, 1.0);
      float radius = ${fraction.toFixed(2)} * (0.25 + 0.75 * (1.0 - pow(1.0 - local, 3.0)));
      float halfWidth = 0.025 + 0.6 * aa;
      float line = (1.0 - smoothstep(halfWidth, halfWidth + 1.5 * aa, abs(r - radius))) * step(0.001, local);
      col += mix(uColor, vec3(1.0), 0.4 + 0.4 * (1.0 - local)) * line * (0.45 + 0.6 * (1.0 - local))
        * smoothstep(0.0, 0.25, local);
    }`).join('\n')}
    gl_FragColor = vec4(col * uFade, 1.0);
  }
`;

const additive = (vertexShader, fragmentShader, uniforms) => new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader,
  uniforms,
  transparent: true,
  depthTest: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
});

// ---------------------------------------------------------------- instances

const BODY_COLOR = new THREE.Color(0.016, 0.018, 0.022);
const TRIM_GLOW = 1.3;    // emissive intensity of the trim
const RIM_LIGHT = 0.4;    // the team-coloured light along the silhouette
const WHITE = new THREE.Color(1, 1, 1);

// One light cycle on screen. envMap: what its lacquer reflects.
export function createLightCycle(template, { envMap = null } = {}) {
  const uniforms = {
    uToBike: { value: new THREE.Matrix4() },
    uHoloCut: { value: -1 },
    uSolidCut: { value: -1 },
    uScan: { value: 0 },
    uScanColor: { value: new THREE.Color() },
    uRimColor: { value: new THREE.Color() },
    uRim: { value: 0.55 },
    uColor: { value: new THREE.Color() },
    uHolo: { value: 0 },
    uWireGain: { value: template.wireGain },
    uTime: { value: 0 },
    uSize: { value: 0.01 },
    uPixelsPerUnit: { value: 500 },
  };
  const color = new THREE.Color();
  const accent = new THREE.Color();

  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: BODY_COLOR,
    metalness: 0.55,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMap,
    envMapIntensity: 1.6,
  });
  const trimMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.02, 0.02, 0.02),
    metalness: 0,
    roughness: 0.4,
    envMap,
    envMapIntensity: 0.3,
    emissive: new THREE.Color(),
    emissiveIntensity: 1,
  });
  const wheelTrimMaterial = trimMaterial.clone();
  const sourceMaps = (material, source) => {
    if (!source) return material;
    for (const key of ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
      if (source[key]) material[key] = source[key];
    }
    if (source.normalScale) material.normalScale.copy(source.normalScale);
    return material;
  };
  const materials = new Set();
  const materialFor = (part) => {
    let material;
    if (part.kind === 'trim') {
      const onWheel = part.wheel >= 0 || part.accent;
      material = (onWheel ? wheelTrimMaterial : trimMaterial).clone();
      if (part.source?.emissiveMap) material.emissiveMap = part.source.emissiveMap;
      material.userData.wheel = onWheel;
    } else {
      material = sourceMaps(bodyMaterial.clone(), part.source);
    }
    patchSolid(material, uniforms);
    materials.add(material);
    return material;
  };

  const object = new THREE.Group();   // placed and turned by the caller
  const lean = new THREE.Group();     // rolls about the bike's forward axis
  const model = new THREE.Group();    // bike space, scaled to its length
  object.add(lean);
  lean.add(model);

  const pivots = template.wheels.map((wheel) => {
    const pivot = new THREE.Group();
    pivot.position.copy(wheel.center);
    model.add(pivot);
    return pivot;
  });

  const wireMaterial = additive(wireVertex, wireFragment, uniforms);
  const voxelMaterial = additive(voxelVertex, voxelFragment, uniforms);
  const hologram = [];
  const partMeshes = [];
  for (const part of template.parts) {
    const parent = part.wheel >= 0 ? pivots[part.wheel] : model;
    const mesh = new THREE.Mesh(part.geometry, materialFor(part));
    parent.add(mesh);
    partMeshes.push(mesh);
    const wire = new THREE.LineSegments(part.edges, wireMaterial);
    const voxels = new THREE.Points(part.voxels, voxelMaterial);
    wire.renderOrder = 3;
    voxels.renderOrder = 3;
    parent.add(wire, voxels);
    hologram.push(wire, voxels);
  }

  // the rezz rings: a quad on each side of each wheel
  const rings = template.wheels.map((wheel) => {
    const ringUniforms = { uColor: { value: new THREE.Color() }, uProgress: { value: 0 }, uFade: { value: 1 } };
    const material = additive(ringVertex, ringFragment, ringUniforms);
    const quads = [-1, 1].map((side) => {
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), material);
      quad.scale.setScalar(wheel.radius);
      quad.position.copy(wheel.center);
      quad.position.z += side * (wheel.halfWidth + 0.006);
      quad.renderOrder = 3;
      model.add(quad);
      return quad;
    });
    return { uniforms: ringUniforms, quads };
  });

  const pixelSize = new THREE.Vector2();
  // voxels are sized in world units: they need the camera's scale
  hologram.filter((item) => item.isPoints).forEach((points) => {
    points.onBeforeRender = (renderer, scene, camera) => {
      renderer.getDrawingBufferSize(pixelSize);
      uniforms.uPixelsPerUnit.value = pixelSize.y * camera.projectionMatrix.elements[5] / 2;
    };
  });

  let length = 1;
  let power = 1;
  let glow = 1;
  let rezzing = true;

  function setVisible(list, visible) {
    for (const item of list) item.visible = visible;
  }

  function applyGlow() {
    for (const material of materials) {
      if (material.emissive && material.userData.wheel !== undefined) {
        const base = material.userData.wheel ? accent : color;
        // white-hot in the middle; bloom spreads the team colour around it
        material.emissive.copy(base).lerp(WHITE, 0.3);
        material.emissiveIntensity = TRIM_GLOW * glow * power;
      } else {
        material.envMapIntensity = 1.6 * power;
      }
    }
    uniforms.uRim.value = RIM_LIGHT * power;
  }

  const api = {
    object,
    template,
    get length() {
      return length;
    },
    get wheels() {
      return template.wheels;
    },
    // the bike's length in world units
    setLength(value) {
      length = value;
      model.scale.setScalar(value);
      uniforms.uSize.value = 0.011 * value;
    },
    // team colour for the body's lights, accent for the wheels
    setColors(team, wheelAccent = team) {
      color.copy(team);
      accent.copy(wheelAccent);
      uniforms.uColor.value.copy(team);
      uniforms.uRimColor.value.copy(team);
      uniforms.uScanColor.value.copy(team).lerp(WHITE, 0.6);
      for (const ring of rings) ring.uniforms.uColor.value.copy(wheelAccent);
      applyGlow();
    },
    // how lit it still is (the Grid powering down): 1 .. 0
    setPower(value) {
      if (value === power) return;
      power = value;
      applyGlow();
    },
    // roll about the forward axis, radians (positive leans to the bike's right, +z)
    setLean(angle) {
      lean.rotation.x = angle;
    },
    // wheel rotation, radians
    spin(angle) {
      for (const pivot of pivots) pivot.rotation.z = -angle;
    },
    // Shows the rezz `age` seconds in; past REZZ.length it is the finished bike.
    rezz(age, time = 0) {
      uniforms.uTime.value = time;
      const phase = ([start, end]) => Math.min(1, Math.max(0, (age - start) / (end - start)));
      const done = age >= REZZ.length;
      if (done && !rezzing) return;
      rezzing = !done;
      const holo = phase(REZZ.holo);
      const solid = phase(REZZ.solid);
      const rims = phase(REZZ.rims);
      // the cuts run from just past the nose to just behind the tail
      uniforms.uHoloCut.value = done ? -1 : 1.04 - 1.1 * holo;
      uniforms.uSolidCut.value = done ? -1 : (solid > 0 ? 1.04 - 1.1 * solid : 2);
      uniforms.uScan.value = done ? 0 : (holo > 0 && holo < 1 ? 1 : 0) + (solid > 0 && solid < 1 ? 0.6 : 0);
      uniforms.uHolo.value = done ? 0 : 1 - 0.7 * solid;
      setVisible(hologram, !done && holo > 0 && solid < 1);
      rings.forEach((ring, index) => {
        // the front wheel (the last) first
        const order = rings.length - 1 - index;
        ring.uniforms.uProgress.value = phase(REZZ.rings[Math.min(order, REZZ.rings.length - 1)]);
        ring.uniforms.uFade.value = (1 - rims) * power;
        setVisible(ring.quads, !done && ring.uniforms.uProgress.value > 0 && rims < 1);
      });
      // the trim glows faintly as it forms, then flares up and settles
      glow = done ? 1 : rims <= 0 ? 0.3 : 0.3 + 0.7 * rims + 0.6 * Math.sin(Math.PI * rims);
      applyGlow();
    },
    // call once per frame after placing `object`, before rendering
    updateMatrices() {
      object.updateMatrixWorld(true);
      uniforms.uToBike.value.copy(model.matrixWorld).invert();
    },
    // `count` points on its surface, in world coordinates (for derezz voxels)
    surfacePoints(count) {
      const points = [];
      const parts = template.parts;
      for (let k = 0; k < count; k++) {
        const index = Math.floor(Math.random() * parts.length);
        const samples = parts[index].voxels.attributes.position;
        const pick = Math.floor(Math.random() * samples.count);
        const point = new THREE.Vector3().fromBufferAttribute(samples, pick).applyMatrix4(partMeshes[index].matrixWorld);
        points.push({ point, wheel: parts[index].wheel >= 0 });
      }
      return points;
    },
    // Builds the shaders now (in the background where the browser can)
    // rather than as the first cycle rezzes; it compiles hidden parts too.
    // Shaders depend on where they draw to: a linear render target, like
    // an EffectComposer's, unless toScreen.
    precompile(renderer, scene, camera, { toScreen = false } = {}) {
      const previous = renderer.getRenderTarget();
      const target = toScreen ? null : new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
      renderer.setRenderTarget(target);
      const done = renderer.compileAsync(object, camera, scene);
      renderer.setRenderTarget(previous);
      return done.finally(() => target?.dispose());
    },
    dispose() {
      for (const material of materials) material.dispose();
      wireMaterial.dispose();
      voxelMaterial.dispose();
      for (const ring of rings) {
        ring.quads[0].material.dispose();
        for (const quad of ring.quads) quad.geometry.dispose();
      }
    },
  };
  api.setColors(new THREE.Color(0.1, 0.83, 1));
  api.rezz(REZZ.length);
  return api;
}
