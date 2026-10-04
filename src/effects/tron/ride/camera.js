// The ride's camera. Chasing: behind and above the player's cycle, swinging
// a little wide in curves (it follows the heading with a lag), rolling with
// the bike's lean and widening its field of view with speed. Around that:
// the swoop in (from wherever the AR view showed the bike, down behind
// it), a look at a crash, and a slow orbit high over the arena for the
// result.
import * as THREE from 'three';
import { BIKE } from './rules.js';

const CHASE = {
  distance: 5.4,          // behind the middle of the bike ...
  side: 1.1,              // ... a little to its right, so its jetwall streams out beside the view
  height: 1.55,
  lookAhead: 14,
  lookHeight: 1.0,
  headingLag: 0.22,       // s
  positionLag: 0.06,
  fov: 60,
  fovAtBoost: 76,
  fovLag: 0.35,
  roll: 0.3,              // of the bike's lean
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const ease = (dt, timeConstant) => 1 - Math.exp(-dt / timeConstant);
const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const smooth = (t) => t * t * (3 - 2 * t);

export function createRideCamera() {
  const camera = new THREE.PerspectiveCamera(CHASE.fov, 16 / 9, 0.1, 4000);
  const position = new THREE.Vector3(0, 3, 0);
  const target = new THREE.Vector3();
  let heading = 0;
  let roll = 0;
  let fov = CHASE.fov;
  let shake = 0;
  const swoopFrom = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 50 };
  const chase = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  const scratch = new THREE.Vector3();

  // where the chase camera wants to be for this rider right now
  function chasePose(rider, cameraHeading, out) {
    const middleX = rider.x + rider.forwardX * BIKE.length * 0.5;
    const middleZ = rider.z + rider.forwardZ * BIKE.length * 0.5;
    // right of the heading is (-sin, cos)
    out.position.set(
      middleX - Math.cos(cameraHeading) * CHASE.distance - Math.sin(cameraHeading) * CHASE.side,
      CHASE.height,
      middleZ - Math.sin(cameraHeading) * CHASE.distance + Math.cos(cameraHeading) * CHASE.side);
    out.target.set(middleX + rider.forwardX * CHASE.lookAhead, CHASE.lookHeight,
      middleZ + rider.forwardZ * CHASE.lookAhead);
    return out;
  }

  function apply(rollAngle) {
    camera.position.copy(position);
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
    }
    camera.lookAt(target);
    camera.rotateZ(rollAngle);
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  return {
    camera,
    setAspect(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    // jump straight behind the rider (a new round)
    snapBehind(rider) {
      heading = rider.heading;
      chasePose(rider, heading, chase);
      position.copy(chase.position);
      target.copy(chase.target);
      roll = 0;
      fov = CHASE.fov;
      apply(0);
    },
    // the start of the swoop: a camera at `from` looking at `at`, with `fieldOfView`
    startSwoop(from, at, fieldOfView) {
      swoopFrom.position.copy(from);
      swoopFrom.target.copy(at);
      swoopFrom.fov = fieldOfView;
      position.copy(from);
      target.copy(at);
      fov = fieldOfView;
      apply(0);
    },
    // progress 0..1 from the swoop's start down behind the rider
    swoop(rider, progress) {
      heading = rider.heading;
      chasePose(rider, heading, chase);
      const t = smooth(clamp(progress, 0, 1));
      // around the bike's middle: angle, distance and height each ease over
      const middle = scratch.set(rider.x + rider.forwardX * BIKE.length * 0.5, 0,
        rider.z + rider.forwardZ * BIKE.length * 0.5);
      const fromAngle = Math.atan2(swoopFrom.position.z - middle.z, swoopFrom.position.x - middle.x);
      const toAngle = Math.atan2(chase.position.z - middle.z, chase.position.x - middle.x);
      const angle = fromAngle + wrap(toAngle - fromAngle) * t;
      const fromDistance = Math.hypot(swoopFrom.position.x - middle.x, swoopFrom.position.z - middle.z);
      const toDistance = Math.hypot(chase.position.x - middle.x, chase.position.z - middle.z);
      const distance = fromDistance + (toDistance - fromDistance) * t;
      // a dive: up a little first, then down to the chase height
      const lift = Math.sin(Math.PI * t) * 2.5;
      position.set(middle.x + Math.cos(angle) * distance,
        swoopFrom.position.y + (CHASE.height - swoopFrom.position.y) * t + lift,
        middle.z + Math.sin(angle) * distance);
      target.copy(swoopFrom.target).lerp(chase.target, t);
      fov = swoopFrom.fov + (CHASE.fov - swoopFrom.fov) * t;
      apply(0);
    },
    // behind the rider; speedFactor 0 cruising .. 1 full boost
    follow(rider, dt, speedFactor) {
      heading += wrap(rider.heading - heading) * ease(dt, CHASE.headingLag);
      chasePose(rider, heading, chase);
      position.lerp(chase.position, ease(dt, CHASE.positionLag));
      target.lerp(chase.target, ease(dt, CHASE.positionLag));
      roll += (rider.lean * CHASE.roll - roll) * ease(dt, 0.15);
      const wantedFov = CHASE.fov + (CHASE.fovAtBoost - CHASE.fov) * clamp(speedFactor, -0.3, 1);
      fov += (wantedFov - fov) * ease(dt, CHASE.fovLag);
      shake = Math.max(0, shake - dt * 2);
      apply(roll);
    },
    // a cut to a crash at `point` (a cycle heading `crashHeading` hit
    // something): beside and a little behind it, where its pieces fly past
    cutTo(point, crashHeading) {
      const forwardX = Math.cos(crashHeading);
      const forwardZ = Math.sin(crashHeading);
      position.set(point.x - forwardX * 5 - forwardZ * 7, 2.6, point.z - forwardZ * 5 + forwardX * 7);
      target.set(point.x + forwardX * 2, 0.8, point.z + forwardZ * 2);
      roll = 0;
      fov = CHASE.fov;
      apply(0);
    },
    // turn to watch a crash at `point`, pulling up and back from it
    watch(point, dt) {
      const away = scratch.subVectors(position, point).setY(0);
      const distance = Math.max(1, away.length());
      away.multiplyScalar(clamp(distance, 10, 18) / distance);
      const wanted = away.add(point).setY(5.5);
      position.lerp(wanted, ease(dt, 0.7));
      target.lerp(point, ease(dt, 0.25));
      roll += (0 - roll) * ease(dt, 0.3);
      fov += (CHASE.fov - fov) * ease(dt, 0.5);
      shake = Math.max(0, shake - dt * 2);
      apply(roll);
    },
    // a slow orbit high over the arena
    orbit(seconds, dt, radius = 110, height = 55) {
      const angle = seconds * 0.12;
      position.lerp(scratch.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius), ease(dt, 1.2));
      target.lerp(scratch.set(0, 0, 0), ease(dt, 0.8));
      roll += (0 - roll) * ease(dt, 0.3);
      fov += (55 - fov) * ease(dt, 0.8);
      apply(roll);
    },
    // carry on a little the way it was going, slowing down (END OF LINE)
    drift(dt) {
      roll += (0 - roll) * ease(dt, 0.6);
      apply(roll);
    },
    kick(amount) {
      shake = Math.max(shake, amount);
    },
    get fov() {
      return fov;
    },
  };
}
