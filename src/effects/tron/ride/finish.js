// The last pass over the ride's frame (after bloom): speed lines streaming
// out from where the bike is heading, a flash for cuts and crashes, the
// frame breaking up into voxels when the arena derezzes on the way out,
// and an overall dimmer for END OF LINE.
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uSpeed: { value: 0 },        // 0 .. 1, speed lines
    uFocus: { value: new THREE.Vector2(0.5, 0.55) },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(0.7, 0.95, 1) },
    uDissolve: { value: 0 },     // 0 whole .. 1 gone
    uPower: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uSpeed;
    uniform vec2 uFocus;
    uniform float uFlash;
    uniform vec3 uFlashColor;
    uniform float uDissolve;
    uniform float uPower;
    varying vec2 vUv;

    float hash(float n) {
      return fract(sin(n * 127.1 + 311.7) * 43758.5453);
    }
    float hash2(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec3 color = texture2D(tDiffuse, vUv).rgb;
      vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
      vec2 offset = (vUv - uFocus) * aspect + vec2(1e-6, 0.0);   // atan(0, 0) is undefined
      float radius = length(offset);

      // speed lines: thin dashes in a few of many lanes around the focus
      if (uSpeed > 0.001) {
        float angle = atan(offset.y, offset.x) / 6.28318 + 0.5;
        float lanes = 220.0;
        float lane = floor(angle * lanes);
        float pick = hash(lane);
        float across = abs(fract(angle * lanes) - 0.5);
        float thin = 1.0 - smoothstep(0.04, 0.16, across);
        float dash = pow(fract(radius * (0.6 + pick) - uTime * (1.4 + 2.0 * hash(lane + 7.0))), 6.0);
        float shown = step(0.9 - 0.08 * uSpeed, pick) * smoothstep(0.4, 0.95, radius);
        color += vec3(0.6, 0.9, 1.0) * thin * dash * shown * uSpeed * 0.22;
      }

      color += uFlashColor * uFlash * (1.0 - 0.6 * smoothstep(0.0, 0.9, radius));
      color *= uPower;

      // the derezz: the frame breaks into blocks that flare and go out,
      // from the middle outwards
      if (uDissolve > 0.0) {
        vec2 cell = floor(vUv * uResolution / 22.0);
        float threshold = 0.55 * hash2(cell) + 0.45 * min(1.0, radius * 1.1);
        float gone = step(threshold, uDissolve * 1.15);
        float edge = smoothstep(threshold - 0.12, threshold, uDissolve * 1.15) * (1.0 - gone);
        color = color * (1.0 - gone) + vec3(0.5, 0.9, 1.0) * edge * 0.6;
      }
      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

export function createFinishPass() {
  const pass = new ShaderPass(FinishShader);
  const uniforms = pass.uniforms;
  return {
    pass,
    setSize(width, height) {
      uniforms.uResolution.value.set(width, height);
    },
    set({ time, speed = 0, flash = 0, flashColor = null, dissolve = 0, power = 1, focus = null }) {
      uniforms.uTime.value = time;
      uniforms.uSpeed.value = speed;
      uniforms.uFlash.value = flash;
      if (flashColor) uniforms.uFlashColor.value.copy(flashColor);
      uniforms.uDissolve.value = dissolve;
      uniforms.uPower.value = power;
      if (focus) uniforms.uFocus.value.copy(focus);
    },
  };
}
