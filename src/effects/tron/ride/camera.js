// The ride's camera. Chasing: behind and above the player's cycle, swinging
// a little wide in curves (it follows the heading with a lag), rolling with
// the bike's lean, widening its field of view with speed, and following the
// ground up ramps and the bike into the air (slower there, so a jump reads
// as one). Around that:
//
//   entry     from where the AR view showed the bike (behind it, with the AR
//             view's off-centre lens) forwards and down into the seat
//   seat      close behind the bike for the countdown, easing back into the
//             chase as the race gets going
//   swoop     between rounds: from beside the bike, down behind it
//   crash     a cut to a crash, then a look at it
//   killcam   circling low around a crash being replayed
//   showcase  a slow orbit around the winner for the result
//   orbit     a slow orbit high over the arena
import * as THREE from 'three';
import { BIKE } from './rules.js';
import { heightAt } from './terrain.js';

const CHASE = {
  distance: 5.4,          // behind the middle of the bike ...
  side: 1.1,              // ... a little to its right, so its jetwall streams out beside the view
  height: 1.55,
  lookAhead: 14,
  lookHeight: 1.0,
  headingLag: 0.22,       // s
  positionLag: 0.06,
  groundLag: 0.12,        // s, following the ground up and down ...
  airLag: 0.32,           // ... and the bike in the air
  clearance: 0.7,         // m kept between the camera and the ground under it
  fov: 60,
  fovAtBoost: 76,
  fovLag: 0.35,
  roll: 0.3,              // of the bike's lean
};
// in the rider's seat, just over the bike, for the countdown
const SEAT = { distance: 1.6, side: 0, height: 1.75, lookAhead: 26, lookHeight: 1.1, fov: 62 };

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const ease = (dt, timeConstant) => 1 - Math.exp(-dt / timeConstant);
const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

export function createRideCamera() {
  const camera = new THREE.PerspectiveCamera(CHASE.fov, 16 / 9, 0.1, 4000);
  const position = new THREE.Vector3(0, 3, 0);
  const target = new THREE.Vector3();
  let heading = 0;
  let roll = 0;
  let fov = CHASE.fov;
  let shake = 0;
  let ground = 0;           // the height the chase camera rides at, smoothed
  let lookGround = 0;       // ... and the height it looks at
  const shift = { x: 0, y: 0 };   // the lens's off-centre shift (view units), for the entry
  const swoopFrom = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 50 };
  const entryFrom = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 50, shift: { x: 0, y: 0 } };
  const pose = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  const scratch = new THREE.Vector3();
  const look = new THREE.Camera();   // a camera's lookAt turns its -z (its view) to the target

  // where the camera wants to be behind this rider: blend 0 in the seat .. 1 chasing
  function behind(rider, cameraHeading, blend, out) {
    const distance = lerp(SEAT.distance, CHASE.distance, blend);
    const side = lerp(SEAT.side, CHASE.side, blend);
    const height = lerp(SEAT.height, CHASE.height, blend);
    const lookAhead = lerp(SEAT.lookAhead, CHASE.lookAhead, blend);
    const middleX = rider.x + rider.forwardX * BIKE.length * 0.5;
    const middleZ = rider.z + rider.forwardZ * BIKE.length * 0.5;
    // right of the heading is (-sin, cos)
    out.position.set(
      middleX - Math.cos(cameraHeading) * distance - Math.sin(cameraHeading) * side,
      ground + height,
      middleZ - Math.sin(cameraHeading) * distance + Math.cos(cameraHeading) * side);
    // never into a ramp or a bank
    out.position.y = Math.max(out.position.y, heightAt(out.position.x, out.position.z) + CHASE.clearance);
    out.target.set(middleX + rider.forwardX * lookAhead, lookGround + lerp(SEAT.lookHeight, CHASE.lookHeight, blend),
      middleZ + rider.forwardZ * lookAhead);
    return out;
  }

  // follow the ground under the bike, and the bike itself in the air
  function track(rider, dt) {
    const y = rider.y ?? 0;
    ground += (y - ground) * ease(dt, rider.airborne ? CHASE.airLag : CHASE.groundLag);
    const aheadX = rider.x + rider.forwardX * CHASE.lookAhead;
    const aheadZ = rider.z + rider.forwardZ * CHASE.lookAhead;
    // look up a ramp ahead, but not down into the bowl
    const wanted = Math.max(ground, (heightAt(aheadX, aheadZ) + ground) / 2);
    lookGround += (wanted - lookGround) * ease(dt, 0.3);
  }

  function setLens(x, y) {
    shift.x = x;
    shift.y = y;
    if (Math.abs(x) < 1e-4 && Math.abs(y) < 1e-4) {
      if (camera.view?.enabled) camera.clearViewOffset();
      return;
    }
    // the optical axis lands at (x, y) view units from the middle of the frame (y up)
    camera.setViewOffset(camera.aspect, 1, -x, y, camera.aspect, 1);
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

  function settle(dt, wantedFov, lag = 0.5) {
    roll += (0 - roll) * ease(dt, 0.3);
    fov += (wantedFov - fov) * ease(dt, lag);
    shake = Math.max(0, shake - dt * 2);
  }

  return {
    camera,
    setAspect(aspect) {
      camera.aspect = aspect;
      if (camera.view?.enabled) setLens(shift.x, shift.y);
      camera.updateProjectionMatrix();
    },
    // jump straight into the seat behind the rider (a new round)
    snapBehind(rider) {
      heading = rider.heading;
      ground = lookGround = rider.y ?? 0;
      behind(rider, heading, 0, pose);
      position.copy(pose.position);
      target.copy(pose.target);
      roll = 0;
      fov = SEAT.fov;
      setLens(0, 0);
      apply(0);
    },

    // The entry starts where the AR view was: a camera at `from.position`
    // turned by `from.quaternion`, `from.fov` (vertical, degrees) with its
    // optical axis `from.shift` view units off the middle of the frame.
    startEntry(from) {
      entryFrom.position.copy(from.position);
      entryFrom.quaternion.copy(from.quaternion);
      entryFrom.fov = from.fov;
      entryFrom.shift.x = from.shift.x;
      entryFrom.shift.y = from.shift.y;
      position.copy(from.position);
      fov = from.fov;
      camera.position.copy(position);
      camera.quaternion.copy(from.quaternion);
      camera.fov = fov;
      setLens(from.shift.x, from.shift.y);
      camera.updateProjectionMatrix();
    },
    // progress 0..1: forwards and down from there into the seat
    entry(rider, progress, dt) {
      heading = rider.heading;
      track(rider, dt);
      behind(rider, heading, 0, pose);
      const t = smooth(clamp(progress, 0, 1));
      // ease out of the start: quick at first, settling into the seat
      const move = 1 - (1 - t) ** 2;
      position.lerpVectors(entryFrom.position, pose.position, move);
      // a little dip on the way, as if sitting down onto the bike
      position.y -= Math.sin(Math.PI * move) * 0.25;
      look.position.copy(position);
      look.lookAt(pose.target);
      camera.position.copy(position);
      camera.quaternion.slerpQuaternions(entryFrom.quaternion, look.quaternion, move);
      target.copy(pose.target);
      fov = lerp(entryFrom.fov, SEAT.fov, move);
      camera.fov = fov;
      setLens(entryFrom.shift.x * (1 - move), entryFrom.shift.y * (1 - move));
      camera.updateProjectionMatrix();
      roll = 0;
    },

    // the start of a swoop between rounds: a camera at `from` looking at `at`
    startSwoop(from, at, fieldOfView) {
      swoopFrom.position.copy(from);
      swoopFrom.target.copy(at);
      swoopFrom.fov = fieldOfView;
      position.copy(from);
      target.copy(at);
      fov = fieldOfView;
      setLens(0, 0);
      apply(0);
    },
    // progress 0..1 from the swoop's start down into the seat behind the rider
    swoop(rider, progress) {
      heading = rider.heading;
      ground = lookGround = rider.y ?? 0;
      behind(rider, heading, 0, pose);
      const t = smooth(clamp(progress, 0, 1));
      // around the bike's middle: angle, distance and height each ease over
      const middle = scratch.set(rider.x + rider.forwardX * BIKE.length * 0.5, 0,
        rider.z + rider.forwardZ * BIKE.length * 0.5);
      const fromAngle = Math.atan2(swoopFrom.position.z - middle.z, swoopFrom.position.x - middle.x);
      const toAngle = Math.atan2(pose.position.z - middle.z, pose.position.x - middle.x);
      const angle = fromAngle + wrap(toAngle - fromAngle) * t;
      const fromDistance = Math.hypot(swoopFrom.position.x - middle.x, swoopFrom.position.z - middle.z);
      const toDistance = Math.hypot(pose.position.x - middle.x, pose.position.z - middle.z);
      const distance = fromDistance + (toDistance - fromDistance) * t;
      // a dive: up a little first, then down to the seat's height
      const lift = Math.sin(Math.PI * t) * 2.5;
      position.set(middle.x + Math.cos(angle) * distance,
        swoopFrom.position.y + (pose.position.y - swoopFrom.position.y) * t + lift,
        middle.z + Math.sin(angle) * distance);
      target.copy(swoopFrom.target).lerp(pose.target, t);
      fov = swoopFrom.fov + (SEAT.fov - swoopFrom.fov) * t;
      apply(0);
    },
    // behind the rider; speedFactor 0 cruising .. 1 full boost; blend 0 in
    // the seat .. 1 chasing
    follow(rider, dt, speedFactor, blend = 1) {
      heading += wrap(rider.heading - heading) * ease(dt, CHASE.headingLag);
      track(rider, dt);
      behind(rider, heading, blend, pose);
      position.lerp(pose.position, ease(dt, CHASE.positionLag));
      target.lerp(pose.target, ease(dt, CHASE.positionLag));
      roll += (rider.lean * CHASE.roll - roll) * ease(dt, 0.15);
      const cruising = lerp(SEAT.fov, CHASE.fov, blend);
      const wantedFov = cruising + (CHASE.fovAtBoost - CHASE.fov) * clamp(speedFactor, -0.3, 1);
      fov += (wantedFov - fov) * ease(dt, CHASE.fovLag);
      shake = Math.max(0, shake - dt * 2);
      if (shift.x || shift.y) setLens(0, 0);
      apply(roll);
    },
    // a cut to a crash at `point` (a cycle heading `crashHeading` hit
    // something): beside and a little behind it, where its pieces fly past
    cutTo(point, crashHeading) {
      const forwardX = Math.cos(crashHeading);
      const forwardZ = Math.sin(crashHeading);
      position.set(point.x - forwardX * 5 - forwardZ * 7, point.y + 2.0, point.z - forwardZ * 5 + forwardX * 7);
      position.y = Math.max(position.y, heightAt(position.x, position.z) + CHASE.clearance);
      target.set(point.x + forwardX * 2, point.y + 0.2, point.z + forwardZ * 2);
      roll = 0;
      fov = CHASE.fov;
      setLens(0, 0);
      apply(0);
    },
    // turn to watch a crash at `point`, pulling up and back from it
    watch(point, dt) {
      const away = scratch.subVectors(position, point).setY(0);
      const distance = Math.max(1, away.length());
      away.multiplyScalar(clamp(distance, 10, 18) / distance);
      const wanted = away.add(point).setY(point.y + 5);
      position.lerp(wanted, ease(dt, 0.7));
      target.lerp(point, ease(dt, 0.25));
      settle(dt, CHASE.fov);
      apply(roll);
    },
    // circling low around `subject` (a rider in a replay); progress 0..1;
    // orbit: { angle, sweep, radius: [from, to], height: [from, to] }
    killcam(subject, progress, orbit, dt) {
      const t = smooth(clamp(progress, 0, 1));
      const angle = orbit.angle + orbit.sweep * t;
      const radius = lerp(orbit.radius[0], orbit.radius[1], t);
      const middleX = subject.x + Math.cos(subject.heading) * BIKE.length * 0.5;
      const middleZ = subject.z + Math.sin(subject.heading) * BIKE.length * 0.5;
      const y = subject.y ?? 0;
      const x = middleX + Math.cos(angle) * radius;
      const z = middleZ + Math.sin(angle) * radius;
      const wanted = scratch.set(x, Math.max(y + lerp(orbit.height[0], orbit.height[1], t), heightAt(x, z) + CHASE.clearance), z);
      // the first frame of a replay is a cut
      if (progress < 0.02) position.copy(wanted);
      else position.lerp(wanted, ease(dt, 0.08));
      target.set(middleX, y + 0.8, middleZ);
      settle(dt, 46, 0.6);
      setLens(0, 0);
      apply(roll);
    },
    // A slow sway around `rider` (the winner, standing), seen from the
    // arena's side of it a little from above, with the bike low and to the
    // right of the picture, out from under the result's words.
    showcase(rider, seconds, dt, cut = false) {
      const middleX = rider.x + rider.forwardX * BIKE.length * 0.5;
      const middleZ = rider.z + rider.forwardZ * BIKE.length * 0.5;
      const y = rider.y ?? 0;
      const angle = Math.atan2(-middleZ, -middleX) + 0.6 * Math.sin(seconds * 0.12);
      const x = middleX + Math.cos(angle) * 12;
      const z = middleZ + Math.sin(angle) * 12;
      // (the first frame of it is a cut)
      position.lerp(scratch.set(x, Math.max(y + 3.6, heightAt(x, z) + CHASE.clearance), z), cut ? 1 : ease(dt, 0.9));
      // look past it on the left (the camera's right is (sin, -cos) of the angle)
      const side = 6.5;
      target.lerp(scratch.set(middleX - Math.sin(angle) * side, y + 1.4, middleZ + Math.cos(angle) * side), cut ? 1 : ease(dt, 0.5));
      if (cut) {
        roll = 0;
        fov = 50;
      }
      settle(dt, 50, 0.8);
      setLens(0, 0);
      apply(roll);
    },
    // a slow orbit high over the arena
    orbit(seconds, dt, radius = 210, height = 95) {
      const angle = seconds * 0.12;
      position.lerp(scratch.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius), ease(dt, 1.2));
      target.lerp(scratch.set(0, 0, 0), ease(dt, 0.8));
      settle(dt, 55, 0.8);
      setLens(0, 0);
      apply(roll);
    },
    // carry on a little the way it was going, slowing down (END OF LINE)
    drift(dt) {
      roll += (0 - roll) * ease(dt, 0.6);
      if (!shift.x && !shift.y) apply(roll);
    },
    kick(amount) {
      shake = Math.max(shake, amount);
    },
    get fov() {
      return fov;
    },
  };
}
