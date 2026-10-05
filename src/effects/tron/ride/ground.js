// The arena floor as meshes: the terrain (terrain.js) as a grid of
// triangles out to a little past the boundary walls, and the flat apron
// beyond it, a ring of four quads around the grid out to the horizon.
//
// Each vertex also carries which features it lies on (aFeature: up to two
// indices into terrain.features, -1 for none), so the floor shader only
// draws the decals of those rather than testing every feature.
import * as THREE from 'three';
import { features, heightAt } from './terrain.js';

// the (up to two) features whose reach covers (x, z), into out[at], out[at + 1]
function featuresAt(x, z, out, at) {
  out[at] = out[at + 1] = -1;
  let found = 0;
  for (const feature of features) {
    const dx = x - feature.x;
    const dz = z - feature.z;
    if (dx * dx + dz * dz > feature.reach * feature.reach) continue;
    // a kicker standing on a deck goes second
    if (found < 2) out[at + found++] = feature.index;
  }
}

// The terrain from -half to +half on both axes, in square blocks of
// `block` m: a fine grid (`spacing` m) where a feature reaches into the
// block, a single quad where it is flat. (Far away, small triangles cost
// far more to draw than their size: the flat floor stays coarse.) Blocks
// next to each other meet without cracks: where a fine block borders a
// flat one, its edge is flat too.
export function terrainGeometry(half, spacing, block = 16) {
  const blocks = Math.ceil((2 * half) / block);
  const size = (2 * half) / blocks;
  const cells = Math.ceil(size / spacing);
  const step = size / cells;
  const plan = [];
  let vertexCount = 0;
  let indexCount = 0;
  for (let row = 0; row < blocks; row++) {
    for (let column = 0; column < blocks; column++) {
      const x0 = -half + column * size;
      const z0 = -half + row * size;
      const n = touchesFeature(x0, z0, size) ? cells : 1;
      plan.push({ x0, z0, n });
      vertexCount += (n + 1) * (n + 1);
      indexCount += n * n * 6;
    }
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const owners = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(indexCount);
  // heights of one fine block with a border of one, for the normals
  const side = cells + 3;
  const heights = new Float32Array(side * side);
  let vertex = 0;
  let index = 0;
  for (const { x0, z0, n } of plan) {
    const fine = n > 1;
    const cell = size / n;
    if (fine) {
      for (let j = 0; j < side; j++) {
        for (let i = 0; i < side; i++) heights[j * side + i] = heightAt(x0 + (i - 1) * step, z0 + (j - 1) * step);
      }
    }
    const first = vertex;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = x0 + i * cell;
        const z = z0 + j * cell;
        let y = 0;
        let nx = 0;
        let ny = 1;
        let nz = 0;
        if (fine) {
          const at = (j + 1) * side + (i + 1);
          y = heights[at];
          const gx = (heights[at + 1] - heights[at - 1]) / (2 * step);
          const gz = (heights[at + side] - heights[at - side]) / (2 * step);
          const length = Math.hypot(gx, 1, gz);
          nx = -gx / length;
          ny = 1 / length;
          nz = -gz / length;
        }
        positions[vertex * 3] = x;
        positions[vertex * 3 + 1] = y;
        positions[vertex * 3 + 2] = z;
        normals[vertex * 3] = nx;
        normals[vertex * 3 + 1] = ny;
        normals[vertex * 3 + 2] = nz;
        featuresAt(x, z, owners, vertex * 2);
        vertex++;
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = first + j * (n + 1) + i;
        const b = a + 1;
        const c = a + n + 1;
        const d = c + 1;
        // counter-clockwise seen from above
        indices[index++] = a;
        indices[index++] = c;
        indices[index++] = b;
        indices[index++] = b;
        indices[index++] = c;
        indices[index++] = d;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('aFeature', new THREE.BufferAttribute(owners, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

// Does any feature's ground reach into the square block at (x0, z0),
// `size` across? Its bounds (a rectangle in its own frame) against the
// block, on the axes of both.
function touchesFeature(x0, z0, size) {
  const corners = [[x0, z0], [x0 + size, z0], [x0, z0 + size], [x0 + size, z0 + size]];
  return features.some((feature) => {
    const { back, front, side } = feature.bounds;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const [x, z] of corners) {
      const u = (x - feature.x) * feature.cos + (z - feature.z) * feature.sin;
      const v = -(x - feature.x) * feature.sin + (z - feature.z) * feature.cos;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    if (u1 < back || u0 > front || v1 < -side || v0 > side) return false;
    // the feature's rectangle on the block's axes
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [u, v] of [[back, -side], [back, side], [front, -side], [front, side]]) {
      const x = feature.x + u * feature.cos - v * feature.sin;
      const z = feature.z + u * feature.sin + v * feature.cos;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    return !(maxX < x0 || minX > x0 + size || maxZ < z0 || minZ > z0 + size);
  });
}

// The flat floor from the grid's edge (inner, a half size) out to `outer`.
export function apronGeometry(inner, outer) {
  const quads = [
    [-outer, -outer, outer, -inner],    // south, the full width
    [-outer, inner, outer, outer],      // north
    [-outer, -inner, -inner, inner],    // west, between them
    [inner, -inner, outer, inner],      // east
  ];
  const positions = [];
  const indices = [];
  for (const [x0, z0, x1, z1] of quads) {
    const first = positions.length / 3;
    positions.push(x0, 0, z0, x1, 0, z0, x0, 0, z1, x1, 0, z1);
    indices.push(first, first + 2, first + 1, first + 1, first + 2, first + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(quads.flatMap(() => [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  geometry.setAttribute('aFeature', new THREE.Float32BufferAttribute(new Array(16 * 2).fill(-1), 2));
  geometry.setIndex(indices);
  return geometry;
}
