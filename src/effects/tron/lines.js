// Thin glowing line segments in view space, rebuilt every frame: a crisp core
// a pixel or two wide with a faint halo (bloom adds the rest).
import * as THREE from 'three';
import { additiveMaterial, quadIndices, uploadPrefix } from './gl.js';

const HALO_PX = 4;

const vertexShader = /* glsl */`
  attribute vec2 aAcross;   // signed distance from the line (px), half core width (px)
  attribute vec4 aColor;    // rgb, intensity
  varying vec2 vAcross;
  varying vec4 vColor;
  void main() {
    vAcross = aAcross;
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  varying vec2 vAcross;
  varying vec4 vColor;
  void main() {
    float d = abs(vAcross.x);
    float core = 1.0 - smoothstep(vAcross.y, vAcross.y + 1.0, d);
    float halo = exp(-d / ${(HALO_PX / 2).toFixed(1)}) * 0.25;
    vec3 hot = mix(vColor.rgb, vec3(1.0), 0.45);
    gl_FragColor = vec4((hot * core + vColor.rgb * halo) * vColor.a, 1.0);
  }
`;

export function createLines(view, capacity) {
  const positions = new Float32Array(capacity * 4 * 3);
  const across = new Float32Array(capacity * 4 * 2);
  const colors = new Float32Array(capacity * 4 * 4);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aAcross', new THREE.BufferAttribute(across, 2).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 4).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(new THREE.BufferAttribute(quadIndices(capacity), 1));
  const mesh = new THREE.Mesh(geometry, additiveMaterial(vertexShader, fragmentShader, {}));
  mesh.frustumCulled = false;
  let count = 0;

  return {
    mesh,
    begin() {
      count = 0;
    },
    // a, b: view units; color: THREE.Color; width: core width in px
    add(a, b, color, intensity = 1, width = 1.2) {
      if (count >= capacity) return;
      const pixel = 1 / view.height;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length < 1e-6) return;
      // no end caps: consecutive segments of a polyline would overlap and
      // add up to bright beads at every joint
      const reachPx = width / 2 + HALO_PX;
      const nx = (-dy / length) * reachPx * pixel;
      const ny = (dx / length) * reachPx * pixel;
      const corners = [
        [a.x - nx, a.y - ny, -reachPx], [b.x - nx, b.y - ny, -reachPx],
        [b.x + nx, b.y + ny, reachPx], [a.x + nx, a.y + ny, reachPx],
      ];
      corners.forEach(([x, y, side], corner) => {
        const vertex = count * 4 + corner;
        positions.set([x, y, 0], vertex * 3);
        across.set([side, width / 2], vertex * 2);
        colors.set([color.r, color.g, color.b, intensity], vertex * 4);
      });
      count++;
    },
    end() {
      geometry.setDrawRange(0, count * 6);
      for (const name of ['position', 'aAcross', 'aColor']) uploadPrefix(geometry.getAttribute(name), count * 4);
    },
  };
}
