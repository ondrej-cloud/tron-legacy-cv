// What the duel looks like: the arena, the two light cycles (and their
// reflections in the glossy floor), their jetwalls, and the voxels a
// derezzed cycle and its wall break into. Placed from the duel's riders
// every frame.
import * as THREE from 'three';
import { createJetwalls } from '../jetwall3d.js';
import { REZZ, createLightCycle, loadLightCycle } from '../lightcycle-model.js';
import { createArena } from './arena.js';
import { createVoxels3d } from './voxels3d.js';
import { BIKE } from './rules.js';

const WALL_QUADS = 7000;
const BEAM = { length: 16, radius: 2.2, height: 0.55 };

// A headlight's beam: a soft cone of light in the air ahead of the bike,
// brightest at the lamp, fading along its length and towards its edges.
const beamVertex = /* glsl */`
  varying float vAlong;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vAlong = position.x / ${BEAM.length.toFixed(1)};
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const beamFragment = /* glsl */`
  uniform float uPower;
  varying float vAlong;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    // seen through its middle it is thicker than at its rim
    float core = pow(min(1.0, abs(dot(vNormal, vView)) / max(length(vNormal), 1e-4)), 1.5);
    float fade = (1.0 - smoothstep(0.0, 1.0, vAlong)) * smoothstep(0.0, 0.06, vAlong);
    gl_FragColor = vec4(vec3(0.75, 0.9, 1.0) * core * fade * 0.07 * uPower, 1.0);
  }
`;

function createBeam() {
  // a cone along +x with its tip at the lamp
  const geometry = new THREE.ConeGeometry(BEAM.radius, BEAM.length, 24, 1, true)
    .rotateZ(Math.PI / 2)
    .translate(BEAM.length / 2, 0, 0);
  geometry.scale(1, 0.45, 1);   // flattened: the light spreads more sideways than up
  const material = new THREE.ShaderMaterial({
    vertexShader: beamVertex,
    fragmentShader: beamFragment,
    uniforms: { uPower: { value: 1 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const beam = new THREE.Mesh(geometry, material);
  beam.position.set(BIKE.length * 0.97, BEAM.height, 0);
  beam.renderOrder = 2;
  return beam;
}
const WALL_FADE = 0.9;        // s a derezzed cycle's wall takes to go out
const REFLECTION = 0.5;       // how lit the bikes' mirror images are (the floor dims them further)

export function createRideScene({ renderer, envMap, teamColors }) {
  const arena = createArena({ envMap });
  const scene = arena.scene;
  const time = { value: 0 };
  const jetwalls = createJetwalls(WALL_QUADS, teamColors, time, { reflection: 0.35, nearFade: 6 });
  const voxels = createVoxels3d();
  scene.add(jetwalls.object, voxels.mesh);

  // two bikes and their mirror images, once the model is in
  const bikes = [];
  let model = 'loading';
  const ready = loadLightCycle()
    .then((template) => {
      if (!template) throw new Error('no light cycle model');
      for (let index = 0; index < 2; index++) {
        const bike = createLightCycle(template, { envMap });
        const mirror = createLightCycle(template, { envMap });
        mirror.object.scale.y = -1;
        const beam = createBeam();
        bike.object.add(beam);
        scene.add(bike.object, mirror.object);
        bikes.push({ bike, mirror, beam });
      }
      model = 'ready';
      return bikes[0].bike.precompile(renderer, scene, new THREE.PerspectiveCamera());
    })
    .catch((error) => {
      model = 'missing';
      console.warn('ride: no light cycle model', error);
    });

  const lights = [{}, {}];
  const point = new THREE.Vector3();
  const origin = new THREE.Vector3();

  function placeBike(slot, rider, rezzAge, power, seconds) {
    const visible = rider.alive && power > 0;
    // the lamp comes on with the rims, at the end of the rezz
    slot.beam.material.uniforms.uPower.value = power * Math.min(1, Math.max(0, (rezzAge - REZZ.rims[0]) / 0.4));
    for (const [bike, scale] of [[slot.bike, 1], [slot.mirror, REFLECTION]]) {
      bike.object.visible = visible;
      if (!visible) continue;
      bike.object.position.set(rider.x, 0, rider.z);
      bike.object.rotation.set(0, -rider.heading, 0);
      bike.setLength(BIKE.length);
      bike.setLean(rider.lean);
      bike.spin(rider.spin);
      bike.setPower(power * scale);
      bike.rezz(rezzAge, seconds);
      bike.updateMatrices();
    }
  }

  function drawWall(rider, alpha, heat) {
    const path = rider.path;
    if (!path.length || alpha <= 0) return;
    const end = (x, z, along) => ({
      x, z, along,
      height: BIKE.wallHeight,
      alpha,
      heat,
      team: rider.team,
      back: rider.alive ? rider.along - along : 1e3,
    });
    let previous = end(path[0].x, path[0].z, path[0].along);
    for (let index = 1; index < path.length; index++) {
      const current = end(path[index].x, path[index].z, path[index].along);
      jetwalls.quad(previous, current);
      previous = current;
    }
    if (rider.alive && rider.riding) jetwalls.quad(previous, end(rider.x, rider.z, rider.along));
  }

  return {
    scene,
    arena,
    voxels,
    ready,
    get model() {
      return model;
    },
    // team colour of bike `index` (0 player, 1 CLU), accent on its wheels
    setColors(index, color, accent = color) {
      const slot = bikes[index];
      if (!slot) return;
      slot.bike.setColors(color, accent);
      slot.mirror.setColors(color, accent);
    },
    // A cycle derezzes: its bike breaks into voxels, flung forwards.
    derezzBike(index, rider, color) {
      const slot = bikes[index];
      origin.set(rider.x + rider.forwardX * BIKE.length * 0.5, 0.6, rider.z + rider.forwardZ * BIKE.length * 0.5);
      const surface = slot ? slot.bike.surfacePoints(260) : [];
      for (const sample of surface) {
        voxels.spawn(sample.point, origin, color, { size: 0.09, speed: 7, life: 1.4, rise: 2.5 });
      }
      // and a burst of bigger pieces carried on by its speed
      for (let k = 0; k < 60; k++) {
        point.set(origin.x + (Math.random() - 0.5) * 2, 0.3 + Math.random() * 1.2, origin.z + (Math.random() - 0.5) * 2);
        voxels.spawn(point, origin, color, { size: 0.22, speed: 9 + rider.speed * 0.25, life: 1.6, rise: 3 });
      }
    },
    // ... and its jetwall comes down in pieces along its length
    derezzWall(rider, color) {
      const path = rider.path;
      for (let index = 0; index < path.length; index += 4) {
        const sample = path[index];
        point.set(sample.x, Math.random() * BIKE.wallHeight, sample.z);
        origin.set(sample.x, -1, sample.z);
        voxels.spawn(point, origin, color, { size: 0.16, speed: 1.5, life: 1.1, rise: 1, delay: (index / path.length) * 0.4 });
      }
    },
    // riders: [player, clu]; rezz: seconds into each bike's rezz (Infinity:
    // built); fades: s since each rider's wall started to fade (null: lit);
    // power: how lit the arena is, riderPower: each bike and its wall (END OF LINE)
    update({ riders, rezz, fades, colors, power = 1, riderPower = [power, power], seconds, dt }) {
      time.value = seconds;
      arena.update(seconds);
      arena.setPower(power);
      voxels.update(dt);
      jetwalls.begin();
      riders.forEach((rider, index) => {
        const fade = fades[index];
        const alpha = fade === null ? 1 : Math.max(0, 1 - fade / WALL_FADE);
        const heat = fade === null ? 0 : Math.max(0, 1 - fade / (WALL_FADE * 0.5));
        drawWall(rider, alpha * riderPower[index], heat);
        if (bikes[index]) placeBike(bikes[index], rider, rezz[index], riderPower[index], seconds);
        const light = lights[index];
        light.x = rider.x + rider.forwardX * BIKE.length * 0.5;
        light.z = rider.z + rider.forwardZ * BIKE.length * 0.5;
        light.heading = rider.heading;
        light.light = rider.alive ? Math.min(1, rezz[index] / REZZ.length) * riderPower[index] : 0;
        light.color = colors[index];
      });
      jetwalls.end();
      arena.setBikes(lights);
    },
  };
}
