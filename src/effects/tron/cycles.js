// Light cycles. A thumbs-up launches one from the hand; pulling a light
// baton apart rezzes a big one between the hands (controls.js). Either way
// it rezzes in mid-air like in the film (lightcycle-model.js: rings, a
// holographic build sweeping front to back, the solid bike, the rims
// lighting up), drops onto the Grid and rides off in straight runs and
// sharp 90° turns (cycleride.js), leaning into each turn, with a jetwall
// rising behind it in its hand's colour (jetwall3d.js). After a few
// seconds, when it rides into a jetwall, or when a derezz wave reaches it,
// it breaks into voxels; its wall fades from the oldest end. When the Grid
// powers down, cycles stop and go dark, and their walls go out stretch by
// stretch (powerDown()).
//
// Everything lives in the floor's grid space (x across, z into the frame,
// h up; see stage.js). The bikes and walls are 3D meshes in grid3d.js's
// scene, which lines up with the drawn floor. If the model can't be loaded
// the bikes are drawn in lines instead (cyclesketch.js); ?cycle=sketch
// shows that fallback and ?cycle=builtin a stand-in model made of
// primitives.
import * as THREE from 'three';
import { clamp, smoothstep } from './filters.js';
import { STAGE } from './stage.js';
import { lightPower } from './endofline.js';
import { createJetwalls } from './jetwall3d.js';
import { REZZ, buildLightCycle, createLightCycle, loadLightCycle } from './lightcycle-model.js';
import { createCycleSketch } from './cyclesketch.js';
import { rayToWalls, steer } from './cycleride.js';

export const CYCLE = {
  speed: 1.3,              // floor units/s (bigger bikes ride a little faster)
  rideTime: [4.0, 4.8],    // s on the floor before it derezzes
  dropTime: 0.35,          // s from where it rezzed to the floor
  // where it rezzes: close to the camera, so a bike the size of a hand is
  // small on the floor and has room to ride out towards the horizon
  startDepth: { left: 1.4, right: 1.9, both: 1.8 },
  depthRange: [1.2, 5.0],
  sideMargin: 0.12,        // view units kept clear at the sides of the frame
  laneGap: 0.04,           // each hand's cycles keep to their half of the floor, this far from the middle
  wallHeight: 0.36,        // of the bike's length
  sampleSpacing: 0.03,     // floor units between stored points of a wall
  wallLife: 2.4,           // s a stretch of wall stays lit ...
  wallFadeTime: 1.0,       // ... before it fades out over this
  wallFade: 1.3,           // s the rest of a wall takes to fade once its cycle is gone
  solidWall: 0.3,          // a wall fainter than this no longer stops cycles or discs
  hotTime: 0.15,
  pulseSpeed: 1.6,         // floor units/s, the flash running along a wall a disc hit
  pulseWidth: 0.06,
  pulseTime: 0.7,
  maxCycles: 4,
  nearClip: 0.9,           // things fade out between this depth and half a unit further
};

// A cycle somebody is about to get on (ride mode) rezzes between the hands
// with its back to the camera, as if the user stood behind it: on the line
// of sight through the middle of the hands, `distance` bike lengths away,
// and tipped back just enough that the camera sees it a little from above
// (the Grid's camera sits low, so a bike at hand height is above its eye).
const MOUNT = { scale: 1.8, distance: 1.9, above: 8, maxPitch: 26 };   // degrees for the angles
const DEGREES = Math.PI / 180;

// the bike's length at scale 1, in floor units
export const BIKE_LENGTH = 0.385;
const HUB_HEIGHT = 0.18;   // of the length: about where its middle is
const MAX_QUADS = 2400;
const CYCLE_MODEL = new URLSearchParams(location.search).get('cycle');

export function createCycles({ view, teams, stage, grid3d, renderer, voxels, flashes, log }) {
  const time = { value: 0 };
  const jetwalls = createJetwalls(MAX_QUADS, teams.colors, time);
  const sketch = createCycleSketch(view, voxels);
  const group3d = new THREE.Group();
  group3d.add(jetwalls.object);

  const cycles = [];
  const counts = { launched: 0, derezzed: 0, crashed: 0 };
  let now = 0;
  let segments = [];   // jetwall segments on the floor, this frame

  // 3D bikes, one per cycle, from a pool made once the model is in
  const pool = [];
  let model = 'loading';
  loadModel();

  async function loadModel() {
    if (CYCLE_MODEL === 'sketch') {
      model = 'sketch';
      return;
    }
    try {
      const template = CYCLE_MODEL === 'builtin' ? buildLightCycle() : await loadLightCycle();
      if (!template) {
        model = 'sketch';
        return;
      }
      const envMap = grid3d.environment;
      for (let index = 0; index < CYCLE.maxCycles; index++) {
        const bike = createLightCycle(template, { envMap });
        bike.object.visible = false;
        group3d.add(bike.object);
        pool.push({ bike, cycle: null });
      }
      await pool[0].bike.precompile(renderer, grid3d.scene, grid3d.camera);
      model = template.source;
    } catch (error) {
      console.warn('light cycle: no 3D model, drawing the cycles in lines instead', error);
      model = 'sketch';
    }
  }

  function acquireBike(cycle) {
    if (model === 'loading' || model === 'sketch') return null;
    const slot = pool.find((candidate) => !candidate.cycle);
    if (!slot) return null;
    slot.cycle = cycle;
    slot.bike.setColors(cycle.color, cycle.accent);
    slot.bike.setPower(1);
    return slot.bike;
  }

  function releaseBike(cycle) {
    const slot = pool.find((candidate) => candidate.cycle === cycle);
    if (slot) {
      slot.cycle = null;
      slot.bike.object.visible = false;
    }
    cycle.bike = null;
  }

  const random = (range) => range[0] + Math.random() * (range[1] - range[0]);

  // owner: the launching hand, or 'both' for a cycle rezzed from a baton
  // pulled apart (it rides the whole floor); at: where it rezzes, in view
  // units; team: the owner's team. options.length: the bike's length on
  // screen (view units) while it rezzes; options.accent colours its wheels;
  // options.mount: someone is getting on (ride mode), so it rezzes with its
  // back to the camera (placeMount) and stays there instead of dropping
  // onto the floor and riding off.
  function launch(owner, at, team, { length = null, accent = null, mount = false } = {}) {
    while (cycles.filter((cycle) => cycle.state !== 'gone').length >= CYCLE.maxCycles) {
      derezz(cycles.find((cycle) => cycle.state !== 'gone'));
    }
    const depth = CYCLE.startDepth[owner];
    const scale = length ? clamp(length * depth / BIKE_LENGTH, 0.8, 3.2) : 1;
    const bikeLength = BIKE_LENGTH * scale;
    // facing across the frame, towards the middle of its lane
    const heading = owner === 'left' || (owner === 'both' && at.x < 0) ? 0 : Math.PI;
    // centred on `at`
    const x = stage.gridX(at.x, depth) - Math.cos(heading) * bikeLength / 2;
    const height = Math.max(0, heightAt(at.y, depth) - HUB_HEIGHT * bikeLength);
    const cycle = {
      owner,
      scale,
      pitch: 0,
      length: bikeLength,
      teamIndex: team.index,
      color: team.color.clone(),
      accent: (accent ?? team.color).clone(),
      state: 'rezz',
      start: now,
      x, z: stage.gridZ(depth), h: height, dropFrom: height, dropStart: 0,
      heading, yaw: heading, lean: 0, leanKick: 0,
      nextTurn: 0, lastTurn: -Infinity,
      spin: 0,
      rideUntil: Infinity,
      path: [],
      pulses: [],
      goneAt: Infinity,
      light: 0,
      bike: null,
      mount,
    };
    if (mount) placeMount(cycle, at);
    cycle.bike = acquireBike(cycle);
    cycles.push(cycle);
    counts.launched++;
    log(`cycle ${owner[0].toUpperCase()}`);
    return cycle;
  }

  // Puts a cycle somebody is getting on where MOUNT says, its middle on
  // screen at `at` (view units).
  function placeMount(cycle, at) {
    cycle.scale = MOUNT.scale;
    cycle.length = BIKE_LENGTH * MOUNT.scale;
    // the line of sight through `at`: (rayX, rayY, 1) from the camera, per unit of depth
    const rayX = at.x - stage.vanish;
    const rayY = at.y - STAGE.horizon;
    const depth = (MOUNT.distance * cycle.length) / Math.hypot(rayX, rayY, 1);
    const middleX = rayX * depth;
    const middleH = STAGE.cameraHeight + rayY * depth;
    const middleZ = stage.gridZ(depth);
    // pointing away along it, the nose raised by the line's own climb and a little more
    const yaw = Math.atan2(depth, middleX);
    const climb = Math.atan2(rayY, Math.hypot(rayX, 1));
    const pitch = clamp(climb + MOUNT.above * DEGREES, 0, MOUNT.maxPitch * DEGREES);
    // from the middle back to the rear wheel's contact point (HUB_HEIGHT below the bike's axis)
    const back = cycle.length / 2;
    const down = HUB_HEIGHT * cycle.length;
    cycle.heading = cycle.yaw = yaw;
    cycle.pitch = pitch;
    cycle.x = middleX - Math.cos(yaw) * (Math.cos(pitch) * back - Math.sin(pitch) * down);
    cycle.z = middleZ - Math.sin(yaw) * (Math.cos(pitch) * back - Math.sin(pitch) * down);
    cycle.h = cycle.dropFrom = middleH - Math.sin(pitch) * back - Math.cos(pitch) * down;
  }

  // Where the Grid's camera is as seen from a mounted cycle: its position in
  // the bike's own frame (x forward, y up, z to its right; in bike lengths
  // from the rear wheel's contact point), which way it is turned there, and
  // its lens: vertical field of view (degrees) and where its optical axis
  // falls on screen (view units). The ride starts its camera from there.
  function mountView(cycle) {
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, cycle.yaw, cycle.pitch));
    const inverse = rotation.clone().invert();
    const camera = new THREE.Vector3(0, STAGE.cameraHeight, -STAGE.gridScroll * now);
    const position = camera.sub(new THREE.Vector3(cycle.x, cycle.h, -cycle.z)).applyQuaternion(inverse)
      .divideScalar(cycle.length);
    return {
      position,
      quaternion: inverse,
      fov: 2 * Math.atan(0.5) / DEGREES,
      shift: { x: stage.vanish, y: STAGE.horizon },
      age: now - cycle.start,
    };
  }

  // the height above the floor at which a point at `depth` shows at view y
  function heightAt(viewY, depth) {
    const projected = stage.project(0, 0, stage.gridZ(depth));
    return (viewY - projected.y) * depth;
  }

  function pushPoint(cycle) {
    const last = cycle.path[cycle.path.length - 1];
    const along = last ? last.along + Math.hypot(cycle.x - last.x, cycle.z - last.z) : 0;
    cycle.path.push({ x: cycle.x, z: cycle.z, born: now, gone: false, along });
  }

  function headAlong(cycle) {
    const last = cycle.path[cycle.path.length - 1];
    return last ? last.along + Math.hypot(cycle.x - last.x, cycle.z - last.z) : 0;
  }

  // the stretch of floor (view x) a hand's cycles ride in
  function lane(cycle) {
    const edge = view.aspect / 2 - CYCLE.sideMargin;
    if (cycle.owner === 'both') return [-edge, edge];
    return cycle.owner === 'left' ? [-edge, -CYCLE.laneGap] : [CYCLE.laneGap, edge];
  }

  function inArena(cycle, x, z) {
    const point = stage.project(x, 0, z);
    const [nearest, farthest] = CYCLE.depthRange;
    const [left, right] = lane(cycle);
    return point.depth > nearest && point.depth < farthest && point.x > left && point.x < right;
  }

  // a wall that still stands: lit enough, not shattered
  function wallAlpha(cycle, point) {
    const fade = cycle.state === 'gone' ? 1 - smoothstep(0, CYCLE.wallFade, now - cycle.goneAt) : 1;
    const life = 1 - smoothstep(CYCLE.wallLife, CYCLE.wallLife + CYCLE.wallFadeTime, now - point.born);
    return fade * life * lightPower(point.offAt, now, point.offSeed);
  }

  // every standing stretch of jetwall on the floor, for steering and crashes
  function collectSegments() {
    segments = [];
    for (const cycle of cycles) {
      const points = wallPoints(cycle);
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1];
        const b = points[index];
        if (a.gone || b.gone || wallAlpha(cycle, a) < CYCLE.solidWall) continue;
        segments.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, cycle, along: b.along });
      }
    }
  }

  // the stored points of a cycle's wall, plus the live end at the bike
  function wallPoints(cycle) {
    if (cycle.state !== 'ride' || !cycle.path.length) return cycle.path;
    return [...cycle.path, { x: cycle.x, z: cycle.z, born: now, gone: false, offAt: cycle.offAt,
      offSeed: cycle.offSeed, along: headAlong(cycle) }];
  }

  // its own wall right behind it doesn't count
  const skipOwnTail = (cycle) => {
    const recent = headAlong(cycle) - cycle.length * 1.5;
    return (segment) => segment.cycle === cycle && segment.along > recent;
  };

  function ride(cycle, dt) {
    if (now >= cycle.rideUntil) {
      derezz(cycle);
      return;
    }
    const skip = skipOwnTail(cycle);
    steer(cycle, now, dt, { inside: (x, z) => inArena(cycle, x, z), segments, skip }, pushPoint);
    const speed = CYCLE.speed * Math.sqrt(cycle.scale);
    const dx = Math.cos(cycle.heading);
    const dz = Math.sin(cycle.heading);
    // riding into a jetwall derezzes it
    const noseX = cycle.x + dx * cycle.length;
    const noseZ = cycle.z + dz * cycle.length;
    if (rayToWalls(noseX, noseZ, dx, dz, segments, speed * dt, skip) < Infinity) {
      counts.crashed++;
      log(`cycle crash ${cycle.owner[0].toUpperCase()}`);
      derezz(cycle);
      return;
    }
    const steps = Math.max(1, Math.ceil((speed * dt) / CYCLE.sampleSpacing));
    for (let step = 0; step < steps; step++) {
      cycle.x += dx * speed * dt / steps;
      cycle.z += dz * speed * dt / steps;
      const last = cycle.path[cycle.path.length - 1];
      if (Math.hypot(cycle.x - last.x, cycle.z - last.z) >= CYCLE.sampleSpacing) pushPoint(cycle);
    }
  }

  // bike frame (floor units from the tail at scale 1: u forward, h up, s
  // across) -> view units, for this cycle right now
  function projector(cycle) {
    const forwardX = Math.cos(cycle.yaw);
    const forwardZ = Math.sin(cycle.yaw);
    const size = cycle.scale;
    return (u, h, s) => stage.project(
      cycle.x + (forwardX * u - forwardZ * s) * size,
      cycle.h + h * size,
      cycle.z + (forwardZ * u + forwardX * s) * size);
  }

  // where a cycle shows, for derezz waves and the floor's light
  function centerOf(cycle, height = cycle.h + HUB_HEIGHT * cycle.length) {
    return stage.project(cycle.x + Math.cos(cycle.yaw) * cycle.length / 2, height,
      cycle.z + Math.sin(cycle.yaw) * cycle.length / 2);
  }

  function derezz(cycle) {
    if (!cycle || cycle.state === 'gone') return;
    if (cycle.state === 'ride') pushPoint(cycle);
    const points = cycle.bike
      ? cycle.bike.surfacePoints(90).map(({ point, wheel }) => ({ ...stage.project(point.x, point.y, -point.z), wheel }))
      : sketch.derezzPoints(projector(cycle));
    for (const point of points) {
      if (point.depth < CYCLE.nearClip) continue;
      voxels.spawn({
        x: point.x, y: point.y,
        vx: (Math.random() - 0.5) * 0.3, vy: Math.random() * 0.25,
        size: (0.012 * cycle.scale) / point.depth + Math.random() * 0.004,
        life: 0.9 + Math.random() * 0.9,
        heat: 0.7,
        color: point.wheel ? cycle.accent : cycle.color,
        delay: Math.random() * 0.08,
      });
    }
    const center = centerOf(cycle);
    flashes.spawn({ x: center.x, y: center.y, size: 0.1 * Math.sqrt(cycle.scale), duration: 0.5, color: cycle.color, glint: 0.7 });
    releaseBike(cycle);
    cycle.state = 'gone';
    cycle.goneAt = now;
    counts.derezzed++;
    log(`cycle derezz ${cycle.owner[0].toUpperCase()}`);
  }

  // a derezz wave: cycles and stretches of their walls within `radius` of `origin` (view units)
  function shatter(origin, radius, bornBefore) {
    const radiusSquared = radius * radius;
    shatterWhere((point) => (point.x - origin.x) ** 2 + (point.y - origin.y) ** 2 < radiusSquared, bornBefore, origin);
  }

  // Cycles, and stretches of their walls, that `within(point)` accepts (view
  // units); the voxels fly away from `origin`. `spareMounted` leaves a cycle
  // somebody is getting on alone (ride mode takes it over).
  function shatterWhere(within, bornBefore = Infinity, origin = null, { spareMounted = false } = {}) {
    for (const cycle of cycles) {
      if (spareMounted && cycle.mount) continue;
      if (cycle.state !== 'gone' && cycle.start < bornBefore && within(centerOf(cycle))) derezz(cycle);
      const wallHeight = CYCLE.wallHeight * cycle.length;
      for (const sample of cycle.path) {
        if (sample.gone || sample.born > bornBefore) continue;
        const base = stage.project(sample.x, 0, sample.z);
        if (base.depth < CYCLE.nearClip || !within(base)) continue;
        sample.gone = true;
        if (Math.round(sample.along / CYCLE.sampleSpacing) % 2) continue;
        const top = stage.project(sample.x, wallHeight, sample.z);
        voxels.spawn({
          x: (base.x + top.x) / 2, y: (base.y + top.y) / 2,
          vx: (origin ? (base.x - origin.x) * 0.4 : 0) + (Math.random() - 0.5) * 0.1, vy: 0.05 + Math.random() * 0.15,
          size: Math.max(0.005, (top.y - base.y) * 0.3),
          life: 1.0 + Math.random() * 0.8,
          heat: 0.6,
          color: teams.colors[cycle.teamIndex],
        });
      }
    }
  }

  function update(seconds, dt) {
    now = seconds;
    time.value = seconds;
    collectSegments();
    for (const cycle of cycles) {
      const age = now - cycle.start;
      // powered down: it stops where it is and goes dark
      if (cycle.offAt !== undefined) continue;
      const rolling = cycle.state === 'ride' ? CYCLE.speed * Math.sqrt(cycle.scale) / (HUB_HEIGHT * cycle.length) : 6;
      cycle.spin += dt * rolling;
      if (cycle.state === 'rezz') {
        if (age >= REZZ.length && !cycle.mount) {
          cycle.state = 'drop';
          cycle.dropStart = now;
        }
      } else if (cycle.state === 'drop') {
        const progress = Math.min(1, (now - cycle.dropStart) / CYCLE.dropTime);
        cycle.h = cycle.dropFrom * (1 - progress * progress);
        // (a cycle rezzed for a ride nobody got on levels out as it drops)
        cycle.pitch *= 1 - progress;
        if (progress >= 1) {
          cycle.h = 0;
          cycle.state = 'ride';
          cycle.rideUntil = now + random(CYCLE.rideTime);
          cycle.nextTurn = now + 0.35;
          pushPoint(cycle);
          const landing = stage.project(cycle.x, 0, cycle.z);
          flashes.spawn({ x: landing.x, y: landing.y, size: 0.08 * Math.sqrt(cycle.scale), duration: 0.4, color: cycle.color, glint: 1 });
        }
      } else if (cycle.state === 'ride') {
        ride(cycle, dt);
      }
      const target = cycle.state === 'ride' ? 1 : cycle.state === 'drop' ? 0.4 : 0;
      cycle.light += (target - cycle.light) * (1 - Math.exp(-dt / 0.25));
    }
    for (let index = cycles.length - 1; index >= 0; index--) {
      const cycle = cycles[index];
      // the oldest end of a wall has faded out
      const path = cycle.path;
      while (path.length > 1 && now - path[0].born > CYCLE.wallLife + CYCLE.wallFadeTime) path.shift();
      cycle.pulses = cycle.pulses.filter((pulse) => now - pulse.start < CYCLE.pulseTime);
      const faded = cycle.state === 'gone' && now - cycle.goneAt > CYCLE.wallFade;
      const dark = cycle.offAt !== undefined && now > cycle.allOffAt;
      if (faded || dark) {
        releaseBike(cycle);
        cycles.splice(index, 1);
      }
    }
  }

  function pulseHeat(cycle, along) {
    let heat = 0;
    for (const pulse of cycle.pulses) {
      const age = now - pulse.start;
      const spread = Math.abs(Math.abs(along - pulse.along) - age * CYCLE.pulseSpeed);
      heat += Math.exp(-((spread / CYCLE.pulseWidth) ** 2)) * (1 - age / CYCLE.pulseTime);
    }
    return Math.min(1, heat);
  }

  function drawWall(cycle) {
    const riding = cycle.state === 'ride';
    const head = headAlong(cycle);
    const height = CYCLE.wallHeight * cycle.length;
    const end = (point) => {
      const depth = stage.project(point.x, 0, point.z).depth;
      const fresh = 1 - smoothstep(0, CYCLE.hotTime, now - point.born);
      return {
        x: point.x,
        z: -point.z,
        height,
        alpha: wallAlpha(cycle, point) * smoothstep(CYCLE.nearClip, CYCLE.nearClip + 0.5, depth),
        heat: cycle.pulses.length ? Math.max(fresh, pulseHeat(cycle, point.along)) : fresh,
        team: cycle.teamIndex,
        along: point.along,
        back: riding ? head - point.along : 1e3,
      };
    };
    const points = wallPoints(cycle);
    let previous = null;
    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      const current = point.gone ? null : end(point);
      if (previous && current && (previous.alpha > 0 || current.alpha > 0)) jetwalls.quad(previous, current);
      previous = current;
    }
  }

  function drawBike(cycle) {
    const age = now - cycle.start;
    const lit = lightPower(cycle.offAt, now, cycle.offSeed);
    const bike = cycle.bike;
    if (!bike) {
      sketch.draw(cycle, projector(cycle), cycle.state === 'rezz' ? age : Infinity, lit);
      return;
    }
    bike.object.visible = lit > 0;
    bike.object.position.set(cycle.x, cycle.h, -cycle.z);
    bike.object.rotation.set(0, cycle.yaw, cycle.pitch);
    bike.setLength(cycle.length);
    bike.setLean(cycle.lean);
    bike.spin(cycle.spin);
    bike.setPower(lit);
    bike.rezz(age, now);
    bike.updateMatrices();
  }

  function draw() {
    jetwalls.begin();
    sketch.begin();
    for (const cycle of cycles) {
      drawWall(cycle);
      if (cycle.state !== 'gone') drawBike(cycle);
    }
    jetwalls.end();
    sketch.end();
  }

  // The stretches of jetwall solid enough to stop a disc, as segments of
  // their base line in view units, each with the wall's rise on screen
  // ({ x0, y0, x1, y1, extrude, trail, along0, team, owner }, see disc.js).
  function viewSegments() {
    const out = [];
    for (const cycle of cycles) {
      const points = wallPoints(cycle);
      const height = CYCLE.wallHeight * cycle.length;
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1];
        const b = points[index];
        if (a.gone || b.gone || wallAlpha(cycle, a) < CYCLE.solidWall || wallAlpha(cycle, b) < CYCLE.solidWall) continue;
        const baseA = stage.project(a.x, 0, a.z);
        const baseB = stage.project(b.x, 0, b.z);
        if (baseA.depth < CYCLE.nearClip || Math.hypot(baseB.x - baseA.x, baseB.y - baseA.y) < 1e-6) continue;
        const topA = stage.project(a.x, height, a.z);
        const topB = stage.project(b.x, height, b.z);
        out.push({
          x0: baseA.x, y0: baseA.y, x1: baseB.x, y1: baseB.y,
          extrude: { x: (topA.x - baseA.x + topB.x - baseB.x) / 2, y: (topA.y - baseA.y + topB.y - baseB.y) / 2 },
          trail: cycle, along0: a.along, team: cycle.teamIndex, owner: api,
          // view units to floor units along this stretch, for pulse()
          scale: Math.hypot(b.x - a.x, b.z - a.z) / Math.hypot(baseB.x - baseA.x, baseB.y - baseA.y),
        });
      }
    }
    return out;
  }

  // The Grid powers down: every cycle stops and goes out at the time
  // `offTime(point)` gives, and its wall goes out stretch by stretch.
  function powerDown(offTime) {
    const stretch = 0.15;   // floor units of wall that go out together
    for (const cycle of cycles) {
      if (cycle.state === 'gone') continue;
      cycle.offAt = offTime(centerOf(cycle));
      cycle.offSeed = Math.random() * 100;
      cycle.allOffAt = cycle.offAt;
      let chunk = null;
      for (const point of cycle.path) {
        const index = Math.floor(point.along / stretch);
        if (!chunk || chunk.index !== index) {
          chunk = { index, offAt: offTime(stage.project(point.x, 0, point.z)), seed: Math.random() * 100 };
        }
        point.offAt = chunk.offAt;
        point.offSeed = chunk.seed;
        cycle.allOffAt = Math.max(cycle.allOffAt, chunk.offAt);
      }
    }
  }

  // a mounted cycle leaves the AR Grid quietly (the arena has taken over)
  function dismount(cycle) {
    const index = cycles.indexOf(cycle);
    if (index < 0) return;
    releaseBike(cycle);
    cycles.splice(index, 1);
  }

  const api = {
    group: sketch.group,   // flat: the fallback bikes
    group3d,               // in grid3d's scene: the bikes and their walls
    counts,
    launch,
    mountView,
    dismount,
    shatter,
    shatterWhere,
    powerDown,
    segments: viewSegments,
    // a disc struck a jetwall `along` view units into the segment it hit
    pulse(cycle, along, time, segment) {
      cycle.pulses.push({ along: segment.along0 + (along - segment.along0) * segment.scale, start: time });
    },
    // a fresh Grid: no cycles
    clear() {
      for (const cycle of cycles) releaseBike(cycle);
      cycles.length = 0;
    },
    update,
    draw,
    get model() {
      return model;
    },
    get active() {
      return cycles.filter((cycle) => cycle.state !== 'gone').length;
    },
    // where the cycles light up the floor, for the stage
    lights() {
      return cycles.filter((cycle) => cycle.light > 0.01).slice(0, 4).map((cycle) => {
        const point = centerOf(cycle, 0);
        const lit = lightPower(cycle.offAt, now, cycle.offSeed);
        return { x: point.x, y: point.y, strength: cycle.light * lit, size: (0.5 * Math.sqrt(cycle.scale)) / point.depth, color: cycle.color };
      });
    },
  };
  return api;
}
