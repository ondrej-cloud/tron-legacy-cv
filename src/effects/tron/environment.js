// What glossy things on the Grid reflect: a dark arena ringed with rows of
// white floodlights and a cyan rail at the stands, long light bars
// overhead and a dim floor. Rendered once into a prefiltered environment
// map (PMREM), so a near-black lacquered body picks up long, sharp
// highlights like the light cycles in the film.
import * as THREE from 'three';

export function createArenaEnvironment(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0.006, 0.009, 0.014);
  const geometries = [];
  const lightMaterial = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), side: THREE.DoubleSide });
  const box = (width, height, depth, material) => {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    return mesh;
  };

  const floodlight = lightMaterial(9, 9.5, 10);
  const rail = lightMaterial(1.2, 3.2, 4.5);
  const bar = lightMaterial(5, 5.5, 6);
  const floor = lightMaterial(0.02, 0.05, 0.07);

  // a ring of floodlights high in the stands, and a lower one
  const ring = (count, radius, height, width, tall, material, phase = 0) => {
    for (let k = 0; k < count; k++) {
      const angle = phase + (k / count) * Math.PI * 2;
      const light = box(width, tall, 0.2, material);
      light.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
      light.lookAt(0, height, 0);
    }
  };
  ring(18, 20, 7, 2.6, 0.7, floodlight);
  ring(28, 20, 3.2, 1.4, 0.25, floodlight, 0.1);
  // the rail along the edge of the arena: a continuous thin band of light
  ring(64, 20, 1.2, 2.1, 0.12, rail);
  // light bars overhead, for the highlights along the top of a body
  for (const x of [-4, 4]) {
    const light = box(1.2, 0.1, 40, bar);
    light.position.set(x, 12, 0);
  }
  const floorPlane = box(80, 0.1, 80, floor);
  floorPlane.position.y = -2;

  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(scene, 0.015);
  generator.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const material of [floodlight, rail, bar, floor]) material.dispose();
  return target.texture;
}
