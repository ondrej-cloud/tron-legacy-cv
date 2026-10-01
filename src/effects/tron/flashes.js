// Short-lived flashes: an expanding ring with a cross-shaped glint. Used when
// a disc materialises, ricochets or is caught, and when the team switches.
import * as THREE from 'three';
import { additiveMaterial } from './gl.js';

const POOL = 12;

const vertexShader = /* glsl */`
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  uniform vec3 uColor;
  uniform float uProgress;   // 0..1 over the flash's life
  uniform float uGlint;      // strength of the cross glint
  uniform float uPixel;      // local units per pixel
  uniform float uIntensity;
  varying vec2 vLocal;
  void main() {
    float r = length(vLocal);
    float p = uProgress;
    float fade = (1.0 - p) * (1.0 - p);
    float radius = mix(0.08, 0.95, 1.0 - pow(1.0 - p, 3.0));
    float aa = fwidth(r);
    float ring = 1.0 - smoothstep(0.6 * aa, 1.8 * aa, abs(r - radius));
    float halo = exp(-abs(r - radius) * 18.0) * 0.25;
    float reach = (1.0 - p) * 0.9;
    float glint = (exp(-abs(vLocal.y) / (1.2 * uPixel)) * step(abs(vLocal.x), reach)
      + exp(-abs(vLocal.x) / (1.2 * uPixel)) * step(abs(vLocal.y), reach * 0.6))
      * (1.0 - smoothstep(0.0, 1.0, r / max(reach, 1e-3))) * uGlint;
    float core = exp(-r * r * 90.0) * pow(1.0 - p, 3.0) * 2.5;
    vec3 hot = mix(uColor, vec3(1.0), 0.6);
    vec3 col = hot * (ring * 2.0 + glint * 2.0 + core) + uColor * halo;
    col *= fade * uIntensity * (1.0 - smoothstep(0.92, 1.0, r));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createFlashes(view) {
  const group = new THREE.Group();
  const plane = new THREE.PlaneGeometry(2, 2);
  const flashes = [];
  for (let index = 0; index < POOL; index++) {
    const uniforms = {
      uColor: { value: new THREE.Color() },
      uProgress: { value: 1 },
      uGlint: { value: 1 },
      uPixel: { value: 0.01 },
      uIntensity: { value: 1 },
    };
    const mesh = new THREE.Mesh(plane, additiveMaterial(vertexShader, fragmentShader, uniforms));
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 4;
    group.add(mesh);
    flashes.push({ mesh, uniforms, start: 0, duration: 1, size: 0.1 });
  }
  let cursor = 0;
  let now = 0;

  return {
    group,
    // x, y, size (radius): view units; duration: s
    spawn({ x, y, size = 0.12, duration = 0.5, color, glint = 1, intensity = 1 }) {
      const flash = flashes[cursor];
      cursor = (cursor + 1) % POOL;
      flash.start = now;
      flash.duration = duration;
      flash.size = size;
      flash.mesh.position.set(x, y, 0);
      flash.mesh.scale.setScalar(size);
      flash.uniforms.uColor.value.copy(color);
      flash.uniforms.uGlint.value = glint;
      flash.uniforms.uIntensity.value = intensity;
      flash.uniforms.uProgress.value = 0;
      flash.mesh.visible = true;
    },
    // a fresh Grid: no flashes
    clear() {
      for (const flash of flashes) flash.mesh.visible = false;
    },
    update(time) {
      now = time;
      for (const flash of flashes) {
        if (!flash.mesh.visible) continue;
        const progress = (now - flash.start) / flash.duration;
        flash.mesh.visible = progress < 1;
        flash.uniforms.uProgress.value = Math.min(1, Math.max(0, progress));
        flash.uniforms.uPixel.value = 1 / (view.height * flash.size);
      }
    },
  };
}
