// Derezz in 3D: a cycle (or a stretch of jetwall) breaks into glowing cubes
// that burst outwards, tumble, fall and fade, hot white at first and then
// their team colour. One instanced mesh for all of them.
import * as THREE from 'three';

const MAX = 1400;
const GRAVITY = 9;

export function createVoxels3d() {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, MAX);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3)
    .setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.count = 0;

  const voxels = [];
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const white = new THREE.Color(1, 1, 1);
  const cameraPosition = new THREE.Vector3();
  mesh.onBeforeRender = (renderer, scene, camera) => cameraPosition.setFromMatrixPosition(camera.matrixWorld);

  return {
    mesh,
    // one cube at `point` (Vector3-like), flung out from `from` at `speed`
    spawn(point, from, colorValue, { size = 0.12, speed = 6, life = 1.2, delay = 0, rise = 3 } = {}) {
      if (voxels.length >= MAX) voxels.shift();
      const dx = point.x - from.x;
      const dy = point.y - from.y;
      const dz = point.z - from.z;
      const length = Math.hypot(dx, dy, dz) || 1;
      const kick = speed * (0.4 + Math.random() * 0.8);
      voxels.push({
        x: point.x, y: point.y, z: point.z,
        vx: (dx / length) * kick + (Math.random() - 0.5) * speed * 0.5,
        vy: (dy / length) * kick * 0.5 + rise * (0.3 + Math.random()),
        vz: (dz / length) * kick + (Math.random() - 0.5) * speed * 0.5,
        spinX: (Math.random() - 0.5) * 12, spinY: (Math.random() - 0.5) * 12,
        size: size * (0.6 + Math.random() * 0.8),
        age: -delay,
        life: life * (0.7 + Math.random() * 0.6),
        color: colorValue.clone(),
      });
    },
    update(dt) {
      let count = 0;
      for (let index = voxels.length - 1; index >= 0; index--) {
        const voxel = voxels[index];
        voxel.age += dt;
        if (voxel.age >= voxel.life) {
          voxels.splice(index, 1);
          continue;
        }
        if (voxel.age < 0) continue;
        voxel.vy -= GRAVITY * dt;
        voxel.vx *= 1 - dt * 1.2;
        voxel.vz *= 1 - dt * 1.2;
        voxel.x += voxel.vx * dt;
        voxel.y += voxel.vy * dt;
        voxel.z += voxel.vz * dt;
        if (voxel.y < voxel.size / 2) {
          voxel.y = voxel.size / 2;
          voxel.vy = Math.abs(voxel.vy) * 0.3;
        }
        const t = voxel.age / voxel.life;
        euler.set(voxel.age * voxel.spinX, voxel.age * voxel.spinY, 0);
        rotation.setFromEuler(euler);
        position.set(voxel.x, voxel.y, voxel.z);
        scale.setScalar(voxel.size * (1 - t * 0.5));
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(count, matrix);
        // white-hot, then the team colour, then out; dimmer right in front
        // of the camera, where a cube covers half the screen
        const near = Math.min(1, Math.max(0.08, (cameraPosition.distanceTo(position) - 1) / 8));
        color.copy(voxel.color).lerp(white, Math.max(0, 1 - t * 6) * 0.6).multiplyScalar(0.9 * near * (1 - t) ** 1.5);
        mesh.setColorAt(count, color);
        count++;
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    },
    clear() {
      voxels.length = 0;
      mesh.count = 0;
    },
    get alive() {
      return voxels.length;
    },
  };
}
