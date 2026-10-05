// The stadium around the duel floor: "Tron Race Arena" by SpringSociety
// (CC BY 4.0, see models/tron-race-arena/license.txt), a ring of track with
// stands along it, scaled up so its inner edge runs just behind the
// grandstand around the floor (stands.js). Its 154 pieces share one
// material, so they are merged into a single mesh (one draw call). The
// model's own emissive texture has the floodlights, light strips and the
// crowd's lights; the base colour is kept dark so the stadium reads as a
// shape in the fog beyond the grandstand.
//
// Loaded in the background; the arena works without it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { findModel } from '../lightcycle-model.js';
import { ARENA } from './rules.js';

// the ring's inner edge, in the model's units (measured from the glTF)
const INNER = { x0: -26.8, x1: 19.6, z0: -50.4, z1: 85.9 };
const EMISSIVE_TINT = new THREE.Color(0.75, 0.92, 1.0);

export async function loadStadium({ envMap = null } = {}) {
  const entry = await findModel('tron-race-arena');
  if (!entry) return null;
  const gltf = await new GLTFLoader().loadAsync(entry.url);
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  const meshes = [];
  root.traverse((node) => {
    if (node.isMesh) meshes.push(node);
  });
  const material = meshes[0].material;
  const geometries = meshes.map((mesh) => mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
  const merged = mergeGeometries(geometries);
  let object;
  if (merged) {
    object = new THREE.Mesh(merged, material);
    for (const geometry of geometries) geometry.dispose();
  } else {
    object = root;   // the pieces didn't share a layout: keep them apart
  }

  material.color.multiplyScalar(0.35);
  material.emissive.copy(EMISSIVE_TINT);
  material.emissiveIntensity = 1.6;
  material.envMap = envMap;
  material.envMapIntensity = 0.5;

  // centre the ring's inside on the floor and scale it around the walls
  const scale = ARENA.stadiumScale;
  const group = new THREE.Group();
  object.position.set(-(INNER.x0 + INNER.x1) / 2, 0, -(INNER.z0 + INNER.z1) / 2);
  group.add(object);
  group.scale.setScalar(scale);
  group.position.y = -0.1 * scale;   // its track surface sits just under the Grid
  group.updateMatrixWorld(true);
  return { object: group, material };
}
