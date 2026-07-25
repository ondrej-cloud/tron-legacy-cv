// Small helpers shared by the meshes of this effect.
import * as THREE from 'three';

// Everything here is light: added onto black, no depth, both faces.
export function additiveMaterial(vertexShader, fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

// Index buffer for `quads` independent quads of 4 vertices each.
export function quadIndices(quads) {
  const indices = new Uint32Array(quads * 6);
  for (let quad = 0; quad < quads; quad++) {
    const vertex = quad * 4;
    indices.set([vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3], quad * 6);
  }
  return indices;
}

// Marks the first `count` items of a dynamic attribute for upload.
export function uploadPrefix(attribute, count) {
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, Math.max(1, count) * attribute.itemSize);
  attribute.needsUpdate = true;
}
