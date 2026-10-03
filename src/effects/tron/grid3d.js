// The Grid floor in 3D, for the things that stand on it (the light cycles
// and their jetwalls). stage.js draws the floor flat and maps a floor point
// (x, h, z) to the view as
//   view x = vanish + x / depth,  view y = horizon - (cameraHeight - h) / depth,
// with depth = z - gridScroll * time. Here the same point sits at world
// (x, h, -z), and a camera at (0, cameraHeight, -gridScroll * time) looks
// down -z through an off-centre projection built from those formulas, so a
// mesh placed on the floor lands exactly on the drawn grid. index.js renders
// this scene in a pass of its own between the stage and the flat effects,
// with a depth buffer, so a bike hides the wall behind it.
import * as THREE from 'three';
import { STAGE } from './stage.js';
import { createArenaEnvironment } from './environment.js';

const NEAR = 0.05;
const FAR = 200;

export function createGrid3d(renderer) {
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  camera.position.set(0, STAGE.cameraHeight, 0);
  let environment = null;

  return {
    scene,
    camera,
    // the arena's reflections for glossy materials, made on first use
    get environment() {
      environment ??= createArenaEnvironment(renderer);
      return environment;
    },
    // floor coordinates (stage.js) -> world
    toWorld(x, h, z, target = new THREE.Vector3()) {
      return target.set(x, h, -z);
    },
    update(seconds, aspect, vanish) {
      camera.position.z = -STAGE.gridScroll * seconds;
      camera.updateMatrixWorld();
      // view x = vanish + x / depth and view y = horizon + (h - cameraHeight) / depth,
      // in clip space (the flat effects' orthographic camera spans aspect x 1)
      camera.projectionMatrix.set(
        2 / aspect, 0, -2 * vanish / aspect, 0,
        0, 2, -2 * STAGE.horizon, 0,
        0, 0, -(FAR + NEAR) / (FAR - NEAR), -2 * FAR * NEAR / (FAR - NEAR),
        0, 0, -1, 0);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    },
  };
}
