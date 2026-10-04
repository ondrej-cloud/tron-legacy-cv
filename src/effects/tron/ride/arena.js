// The duel arena: a dark glossy floor with the glowing Grid, glass boundary
// walls around a square of it, a stadium beyond (stadium.js), a deep
// blue-black sky with a glow along the horizon, and fog.
//
// The floor is glossy: it is drawn see-through over mirror images of the
// bikes (scene.js) and doesn't write depth, so the jetwalls' mirrored
// strips (jetwall3d.js) show through it too, as reflections. Bikes light
// the floor around them and throw a headlight beam ahead, and the boundary
// walls light up where a bike comes close.
import * as THREE from 'three';
import { ARENA } from './rules.js';
import { loadStadium } from './stadium.js';

const BIKES = 2;
export const FOG_COLOR = new THREE.Color(0.0025, 0.006, 0.011);

const worldVertex = /* glsl */`
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// shared by the floor and the walls: fog and the bikes' positions
const commonChunk = /* glsl */`
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uPower;          // 1 lit, 0 dark (END OF LINE)
  uniform vec4 uBike[${BIKES}];   // x, z, heading, light (0 = not there)
  uniform vec3 uBikeColor[${BIKES}];
  vec3 fogged(vec3 color) {
    float d = distance(cameraPosition, vWorld) * uFogDensity;
    return mix(color, uFogColor, 1.0 - exp(-d * d));
  }
  // a thin line at distance d from its centre, at least about a pixel wide
  float line(float d, float width, float pixel) {
    pixel = max(pixel, 1e-5);
    float halfWidth = max(width * 0.5, pixel * 0.75);
    float core = 1.0 - smoothstep(halfWidth - pixel * 0.5, halfWidth + pixel * 0.5, d);
    return core * min(1.0, width * 0.5 / halfWidth);
  }
`;

const floorFragment = /* glsl */`
  uniform float uCell;
  uniform float uMajor;
  uniform float uHalf;
  uniform float uTime;
  varying vec3 vWorld;
  ${commonChunk}

  float grid(vec2 p, float cell, float width) {
    vec2 pixel = fwidth(p);
    vec2 d = abs(fract(p / cell - 0.5) - 0.5) * cell;
    // lines closer together than a few pixels fade out instead of shimmering
    vec2 fade = 1.0 - smoothstep(cell * 0.06, cell * 0.25, pixel);
    return max(line(d.x, width, pixel.x) * fade.x, line(d.y, width, pixel.y) * fade.y);
  }

  void main() {
    vec2 p = vWorld.xz;
    float inside = step(max(abs(p.x), abs(p.y)), uHalf);
    vec3 cyan = vec3(0.35, 0.85, 1.0);
    float minor = grid(p, uCell, 0.05);
    float major = grid(p, uCell * uMajor, 0.12);
    vec3 color = vec3(0.0025, 0.004, 0.007);
    float lines = (0.07 * minor + 0.22 * major) * mix(0.35, 1.0, inside);

    // the bikes light the floor: a pool of their colour, a white beam ahead
    vec3 light = vec3(0.0);
    float beams = 0.0;
    for (int i = 0; i < ${BIKES}; i++) {
      vec4 bike = uBike[i];
      if (bike.w <= 0.0) continue;
      vec2 forward = vec2(cos(bike.z), sin(bike.z));
      vec2 offset = p - bike.xy;
      float pool = exp(-dot(offset, offset) / 10.0);
      float ahead = dot(offset, forward);
      float across = abs(offset.x * forward.y - offset.y * forward.x);
      float beam = 0.0;
      if (ahead > 1.0) {
        // widening ahead (smoothstep's edges must stay in order: NaN otherwise)
        float spread = 1.0 + ahead * 0.15;
        beam = smoothstep(1.0, 4.0, ahead) * exp(-ahead / 26.0) * (1.0 - smoothstep(0.6, 1.4, across / spread));
      }
      light += bike.w * uBikeColor[i] * pool * 0.5;
      beams += bike.w * beam;
    }
    color += light * (0.25 + 2.5 * lines);
    color += vec3(0.7, 0.9, 1.0) * beams * (0.012 + 0.9 * lines);
    color += cyan * lines;
    // glossy: what is under the floor (the reflections) shows through a little
    float alpha = clamp(0.72 + lines * 2.0 + beams * 0.1, 0.0, 1.0);
    gl_FragColor = vec4(fogged(color * uPower), alpha);
  }
`;

// glass boundary walls: a white-hot top edge, a base line, faint horizontal
// bands, and a grid of panels that lights up where a bike comes close
const wallVertex = /* glsl */`
  varying vec3 vWorld;
  varying float vAlong;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    // distance along the wall: its local x axis, in the world
    vAlong = dot(world.xz, normalize((modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xz));
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const wallFragment = /* glsl */`
  uniform float uHeight;
  uniform float uTime;
  varying vec3 vWorld;
  varying float vAlong;
  ${commonChunk}

  void main() {
    float v = clamp(vWorld.y / uHeight, 0.0, 1.0);
    float along = vAlong;
    float pixelV = fwidth(vWorld.y);
    float pixelA = fwidth(along);
    float top = line(uHeight - vWorld.y, 0.025, pixelV);
    float base = line(vWorld.y, 0.1, pixelV);
    float bands = line(abs(fract(vWorld.y / 1.25 - 0.5) - 0.5) * 1.25, 0.03, pixelV);
    float posts = line(abs(fract(along / 8.0 - 0.5) - 0.5) * 8.0, 0.06, pixelA);
    float near = 0.0;
    vec3 tint = vec3(0.0);
    for (int i = 0; i < ${BIKES}; i++) {
      vec4 bike = uBike[i];
      if (bike.w <= 0.0) continue;
      float d = distance(vec3(bike.x, 0.8, bike.y), vWorld);
      float glow = exp(-d / 7.0) * bike.w;
      near += glow;
      tint += uBikeColor[i] * glow;
    }
    vec3 white = vec3(0.7, 0.92, 1.0);
    // mostly just its edges; the glass itself shows where a bike comes close
    vec3 color = white * (top * 1.2 + base * 0.5)
      + white * (bands * 0.015 + posts * 0.03) * (0.4 + 0.6 * v)
      + vec3(0.006, 0.02, 0.03) * pow(v, 3.0)
      + (tint * 0.6 + white * near * 0.1) * (0.06 + 0.45 * bands + 0.6 * posts);
    gl_FragColor = vec4(fogged(color * uPower), 1.0);
  }
`;

const skyVertex = /* glsl */`
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = clip.xyww;   // on the far plane
  }
`;

const skyFragment = /* glsl */`
  uniform vec3 uFogColor;
  uniform float uPower;
  varying vec3 vDirection;
  void main() {
    vec3 direction = normalize(vDirection);
    float up = direction.y;
    vec3 zenith = vec3(0.0015, 0.003, 0.008);
    vec3 color = mix(uFogColor, zenith, smoothstep(-0.02, 0.4, up));
    // a band of glow along the horizon, brightest just above it
    color += vec3(0.04, 0.12, 0.17) * exp(-abs(up - 0.015) / 0.03);
    // below the horizon it is only seen through the glossy floor: dark
    color *= mix(0.08, 1.0, smoothstep(-0.03, 0.0, up));
    gl_FragColor = vec4(color * mix(0.2, 1.0, uPower), 1.0);
  }
`;

// envMap: what the stadium's glossy surfaces reflect
export function createArena({ envMap = null } = {}) {
  const scene = new THREE.Scene();
  scene.background = FOG_COLOR.clone();
  scene.fog = new THREE.FogExp2(FOG_COLOR.clone(), ARENA.fog);

  const shared = {
    uFogColor: { value: FOG_COLOR.clone() },
    uFogDensity: { value: ARENA.fog },
    uPower: { value: 1 },
    uTime: { value: 0 },
    uBike: { value: Array.from({ length: BIKES }, () => new THREE.Vector4()) },
    uBikeColor: { value: Array.from({ length: BIKES }, () => new THREE.Color()) },
  };

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      vertexShader: worldVertex,
      fragmentShader: floorFragment,
      uniforms: { ...shared, uCell: { value: ARENA.gridCell }, uMajor: { value: ARENA.gridMajor },
        uHalf: { value: ARENA.half } },
      transparent: true,
      depthWrite: false,
    }));
  // first of the see-through things: over the reflections, under the walls
  floor.renderOrder = -2;

  const wallMaterial = new THREE.ShaderMaterial({
    vertexShader: wallVertex,
    fragmentShader: wallFragment,
    uniforms: { ...shared, uHeight: { value: ARENA.wallHeight } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const walls = new THREE.Group();
  const side = 2 * ARENA.half;
  for (let index = 0; index < 4; index++) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(side, ARENA.wallHeight), wallMaterial);
    const angle = (index * Math.PI) / 2;
    wall.position.set(Math.sin(angle) * ARENA.half, ARENA.wallHeight / 2, Math.cos(angle) * ARENA.half);
    wall.rotation.y = angle;
    wall.renderOrder = 1;
    walls.add(wall);
  }

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      uniforms: { uFogColor: shared.uFogColor, uPower: shared.uPower },
      side: THREE.BackSide,
      depthWrite: false,
    }));
  sky.renderOrder = -3;
  sky.frustumCulled = false;
  sky.onBeforeRender = (renderer, scene, camera) => sky.position.copy(camera.position);

  scene.add(sky, floor, walls);

  let stadium = null;
  const stadiumReady = loadStadium({ envMap })
    .then((loaded) => {
      stadium = loaded;
      if (loaded) scene.add(loaded.object);
    })
    .catch((error) => console.warn('ride: no stadium model, the arena stands on its own', error));

  return {
    scene,
    // bikes: [{ x, z, heading, light, color }] (light 0 = not on the floor)
    setBikes(bikes) {
      for (let index = 0; index < BIKES; index++) {
        const bike = bikes[index];
        const slot = shared.uBike.value[index];
        if (!bike) {
          slot.w = 0;
          continue;
        }
        slot.set(bike.x, bike.z, bike.heading, bike.light);
        shared.uBikeColor.value[index].copy(bike.color);
      }
    },
    stadiumReady,
    // 1 lit .. 0 dark
    setPower(value) {
      shared.uPower.value = value;
      if (stadium) stadium.material.emissiveIntensity = 1.6 * value;
    },
    update(seconds) {
      shared.uTime.value = seconds;
    },
  };
}
