// Light cycles: a thumbs-up launches one from the hand. It materialises at
// the palm, drops onto the Grid floor and races along it in perspective,
// turning 90° every so often, leaving a light wall behind it in its hand's
// colour. After a few seconds, or when a derezz wave reaches it, it breaks
// into voxels and its wall fades.
//
// Everything lives in the floor's grid space (x across, z into the frame,
// h up; see stage.js) and is projected to the view every frame. The bike is
// a wireframe of glowing lines: two wheel rings with hubs and a low, sleek
// body over them, seen from wherever the camera happens to be.
import * as THREE from 'three';
import { createRibbon } from './ribbon.js';
import { createLines } from './lines.js';
import { smoothstep } from './filters.js';

export const CYCLE = {
  speed: 1.4,              // floor units/s
  rideTime: [3.8, 4.4],    // s on the floor before it derezzes
  dropTime: 0.45,          // s from the palm to the floor
  startDepth: { left: 2.0, right: 2.7, both: 2.2 },   // the two hands' cycles ride at different depths
  depthRange: [1.7, 3.6],
  sideMargin: 0.12,        // view units kept clear at the sides of the frame
  laneGap: 0.04,           // each hand's cycles keep to their half of the floor, this far from the middle
  turnEvery: [0.7, 1.2],   // s between random turns while riding across the frame ...
  depthRunTime: [0.25, 0.45],   // ... and while riding into or out of the distance
  lookAhead: 0.3,          // floor units checked ahead for the edges of the arena
  wallHeight: 0.06,        // floor units
  sampleSpacing: 0.03,
  wallFade: 1.6,           // s after the cycle is gone
  hotTime: 0.35,
  maxCycles: 4,
  nearClip: 0.9,           // things fade out between this depth and half a unit further
};

// The bike in its own frame: u forward from the back wheel's contact point,
// h up, s to the side. Floor units.
const BIKE_SCALE = 1.4;
const WHEEL_RADIUS = 0.045 * BIKE_SCALE;
const WHEELS = [0.05, 0.19].map((u) => u * BIKE_SCALE);
const BODY_SIDE = 0.016 * BIKE_SCALE;
const BODY = [[-0.01, 0.035], [0.0, 0.062], [0.05, 0.088], [0.12, 0.09], [0.175, 0.078],
  [0.225, 0.058], [0.25, 0.034], [0.215, 0.02], [0.15, 0.024], [0.09, 0.024], [0.03, 0.02], [-0.01, 0.035]]
  .map(([u, h]) => [u * BIKE_SCALE, h * BIKE_SCALE]);
const STRUTS = [1, 3, 6];
const WHEEL_SEGMENTS = 18;
const MAX_QUADS = 1200;

export function createCycles({ view, teams, stage, voxels, flashes, log }) {
  const time = { value: 0 };
  const ribbon = createRibbon(MAX_QUADS, teams.colors, time);
  const lines = createLines(view, 600);
  lines.mesh.renderOrder = 2;
  const group = new THREE.Group();
  group.add(ribbon.mesh, lines.mesh);

  const cycles = [];
  const counts = { launched: 0, derezzed: 0 };
  const white = new THREE.Color(1, 1, 1);
  let now = 0;

  const random = (range) => range[0] + Math.random() * (range[1] - range[0]);

  // owner: the launching hand, or 'both' for a cycle rezzed from two batons
  // (it rides the whole floor); palm: where it appears, in view units; team:
  // the owner's team. options.scale makes a bigger bike, options.accent
  // colours its wheels.
  function launch(owner, palm, team, { scale = 1, accent = null } = {}) {
    while (cycles.filter((cycle) => cycle.state !== 'gone').length >= CYCLE.maxCycles) {
      derezz(cycles.find((cycle) => cycle.state !== 'gone'));
    }
    const depth = CYCLE.startDepth[owner];
    // start right at the palm: the height that projects onto it at this depth
    const height = Math.max(0, heightAt(palm.y, depth));
    const x = stage.gridX(palm.x, depth);
    const cycle = {
      owner,
      scale,
      teamIndex: team.index,
      color: team.color.clone(),
      accent: (accent ?? team.color).clone(),
      state: 'drop',
      start: now,
      x, z: stage.gridZ(depth), h: height, dropFrom: height,
      // set off across the frame, towards the middle of the hand's lane
      dir: { x: owner === 'left' || (owner === 'both' && palm.x < 0) ? 1 : -1, z: 0 },
      rideUntil: Infinity,
      nextTurn: Infinity,
      turns: 0,
      path: [],
      goneAt: Infinity,
      light: 0,
    };
    cycles.push(cycle);
    counts.launched++;
    log(`cycle ${owner[0].toUpperCase()}`);
    flashes.spawn({ x: palm.x, y: palm.y, size: 0.12, duration: 0.45, color: cycle.color, glint: 0.8, intensity: 0.7 });
    return cycle;
  }

  // the height above the floor at which a point at `depth` shows at view y
  function heightAt(viewY, depth) {
    const projected = stage.project(0, 0, stage.gridZ(depth));
    return (viewY - projected.y) * depth;
  }

  function pushPoint(cycle) {
    cycle.path.push({ x: cycle.x, z: cycle.z, born: now, gone: false,
      along: cycle.path.length ? cycle.path[cycle.path.length - 1].along + CYCLE.sampleSpacing : 0 });
  }

  // can the cycle head this way for a little while without leaving the arena?
  // the stretch of floor (view x) a hand's cycles ride in
  function lane(cycle) {
    const edge = view.aspect / 2 - CYCLE.sideMargin;
    if (cycle.owner === 'both') return [-edge, edge];
    return cycle.owner === 'left' ? [-edge, -CYCLE.laneGap] : [CYCLE.laneGap, edge];
  }

  function clear(cycle, dir, distance = CYCLE.lookAhead) {
    const x = cycle.x + dir.x * distance;
    const z = cycle.z + dir.z * distance;
    const point = stage.project(x, 0, z);
    const [nearest, farthest] = CYCLE.depthRange;
    const [left, right] = lane(cycle);
    return point.depth > nearest && point.depth < farthest && point.x > left && point.x < right;
  }

  function turn(cycle, forced) {
    const sides = [{ x: -cycle.dir.z, z: cycle.dir.x }, { x: cycle.dir.z, z: -cycle.dir.x }];
    const open = sides.filter((dir) => clear(cycle, dir));
    // into the distance while near, back towards us while far, sideways towards the middle of its lane
    const point = stage.project(cycle.x, 0, cycle.z);
    const midDepth = (CYCLE.depthRange[0] + CYCLE.depthRange[1]) / 2;
    const [left, right] = lane(cycle);
    const laneMiddle = (left + right) / 2;
    const preferred = sides.find((dir) => (dir.z !== 0
      ? Math.sign(dir.z) === (point.depth < midDepth ? 1 : -1)
      : Math.sign(dir.x) === Math.sign(laneMiddle - point.x)));
    let next;
    if (open.length === 2) next = Math.random() < 0.7 ? preferred : sides.find((dir) => dir !== preferred);
    else if (open.length === 1) next = open[0];
    else if (forced) next = { x: -cycle.dir.x, z: -cycle.dir.z };
    else return;
    pushPoint(cycle);
    cycle.dir = next;
    cycle.turns++;
    // seen from behind a cycle is just a sliver, so runs into the distance stay short
    cycle.nextTurn = now + random(next.z ? CYCLE.depthRunTime : CYCLE.turnEvery);
  }

  function ride(cycle, dt) {
    if (now >= cycle.rideUntil) {
      derezz(cycle);
      return;
    }
    if (!clear(cycle, cycle.dir)) turn(cycle, true);
    else if (now >= cycle.nextTurn) turn(cycle, false);
    let travel = CYCLE.speed * dt;
    const last = cycle.path[cycle.path.length - 1];
    let sinceLast = Math.abs(cycle.x - last.x) + Math.abs(cycle.z - last.z);
    while (travel > 1e-9) {
      const step = Math.min(travel, Math.max(1e-6, CYCLE.sampleSpacing - sinceLast));
      cycle.x += cycle.dir.x * step;
      cycle.z += cycle.dir.z * step;
      travel -= step;
      sinceLast += step;
      if (sinceLast >= CYCLE.sampleSpacing - 1e-9) {
        pushPoint(cycle);
        sinceLast = 0;
      }
    }
  }

  // the bike's wireframe in view units, as pairs of points
  function bikeSegments(cycle) {
    const forward = { x: cycle.dir.x, z: cycle.dir.z };
    const side = { x: -forward.z, z: forward.x };
    const size = cycle.scale;
    const point = (u, h, s) => stage.project(cycle.x + (forward.x * u + side.x * s) * size, cycle.h + h * size,
      cycle.z + (forward.z * u + side.z * s) * size);
    // seen end-on the lines pile up on each other, so they dim
    const sideOn = 0.3 + 0.7 * Math.abs(forward.x);
    const segments = [];
    for (const center of WHEELS) {
      for (const [radius, count] of [[WHEEL_RADIUS, WHEEL_SEGMENTS], [WHEEL_RADIUS * 0.45, 10]]) {
        for (let k = 0; k < count; k++) {
          const a0 = (k / count) * Math.PI * 2;
          const a1 = ((k + 1) / count) * Math.PI * 2;
          segments.push({
            a: point(center + Math.cos(a0) * radius, WHEEL_RADIUS + Math.sin(a0) * radius, 0),
            b: point(center + Math.cos(a1) * radius, WHEEL_RADIUS + Math.sin(a1) * radius, 0),
            bright: (radius === WHEEL_RADIUS ? 1.0 : 0.55) * sideOn,
            accent: true,
          });
        }
      }
    }
    for (const s of [-BODY_SIDE, BODY_SIDE]) {
      for (let k = 1; k < BODY.length; k++) {
        segments.push({ a: point(BODY[k - 1][0], BODY[k - 1][1], s), b: point(BODY[k][0], BODY[k][1], s), bright: 0.8 * sideOn });
      }
    }
    for (const k of STRUTS) {
      segments.push({ a: point(BODY[k][0], BODY[k][1], -BODY_SIDE), b: point(BODY[k][0], BODY[k][1], BODY_SIDE), bright: 0.5 });
    }
    // white-hot tail light where the wall comes out
    segments.push({ a: point(-0.015, 0.04, 0), b: point(-0.015, 0.085, 0), bright: 1.6, hot: true });
    return segments;
  }

  function derezz(cycle) {
    if (!cycle || cycle.state === 'gone') return;
    if (cycle.state === 'ride') pushPoint(cycle);
    for (const { a, b } of bikeSegments(cycle)) {
      if (Math.random() < 0.55) continue;
      const scale = 1 / Math.max(a.depth, CYCLE.nearClip);
      voxels.spawn({
        x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
        vx: (Math.random() - 0.5) * 0.3, vy: Math.random() * 0.25,
        size: 0.012 * scale + Math.random() * 0.005,
        life: 0.9 + Math.random() * 0.9,
        heat: 0.7,
        color: cycle.color,
        delay: Math.random() * 0.08,
      });
    }
    const center = stage.project(cycle.x, cycle.h + 0.04, cycle.z);
    flashes.spawn({ x: center.x, y: center.y, size: 0.14, duration: 0.5, color: cycle.color, glint: 0.7 });
    cycle.state = 'gone';
    cycle.goneAt = now;
    counts.derezzed++;
    log(`cycle derezz ${cycle.owner[0].toUpperCase()}`);
  }

  // a derezz wave: cycles and stretches of their walls within `radius` of `origin` (view units)
  function shatter(origin, radius, bornBefore) {
    const radiusSquared = radius * radius;
    const within = (point) => (point.x - origin.x) ** 2 + (point.y - origin.y) ** 2 < radiusSquared;
    for (const cycle of cycles) {
      if (cycle.state !== 'gone' && cycle.start < bornBefore && within(stage.project(cycle.x, cycle.h, cycle.z))) {
        derezz(cycle);
      }
      for (const sample of cycle.path) {
        if (sample.gone || sample.born > bornBefore) continue;
        const base = stage.project(sample.x, 0, sample.z);
        if (base.depth < CYCLE.nearClip || !within(base)) continue;
        sample.gone = true;
        if (Math.round(sample.along / CYCLE.sampleSpacing) % 2) continue;
        const top = stage.project(sample.x, CYCLE.wallHeight * cycle.scale, sample.z);
        voxels.spawn({
          x: (base.x + top.x) / 2, y: (base.y + top.y) / 2,
          vx: (base.x - origin.x) * 0.4 + (Math.random() - 0.5) * 0.1, vy: 0.05 + Math.random() * 0.15,
          size: Math.max(0.005, (top.y - base.y) * 0.4),
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
    for (const cycle of cycles) {
      if (cycle.state === 'drop') {
        const progress = Math.min(1, (now - cycle.start) / CYCLE.dropTime);
        cycle.h = cycle.dropFrom * (1 - progress * progress);
        if (progress >= 1) {
          cycle.h = 0;
          cycle.state = 'ride';
          cycle.rideUntil = now + random(CYCLE.rideTime);
          cycle.nextTurn = now + random(CYCLE.turnEvery);
          pushPoint(cycle);
          const landing = stage.project(cycle.x, 0, cycle.z);
          flashes.spawn({ x: landing.x, y: landing.y, size: 0.1, duration: 0.4, color: cycle.color, glint: 1 });
        }
      } else if (cycle.state === 'ride') {
        ride(cycle, dt);
      }
      const target = cycle.state === 'ride' ? 1 : cycle.state === 'drop' ? 0.4 : 0;
      cycle.light += (target - cycle.light) * (1 - Math.exp(-dt / 0.25));
    }
    for (let index = cycles.length - 1; index >= 0; index--) {
      const cycle = cycles[index];
      if (cycle.state === 'gone' && now - cycle.goneAt > CYCLE.wallFade) cycles.splice(index, 1);
    }
  }

  function draw() {
    ribbon.begin();
    lines.begin();
    for (const cycle of cycles) {
      const fade = cycle.state === 'gone' ? 1 - smoothstep(0, CYCLE.wallFade, now - cycle.goneAt) : 1;
      const end = (point) => {
        const base = stage.project(point.x, 0, point.z);
        const top = stage.project(point.x, CYCLE.wallHeight * cycle.scale, point.z);
        const heat = 1 - smoothstep(0, CYCLE.hotTime, now - point.born);
        const near = smoothstep(CYCLE.nearClip, CYCLE.nearClip + 0.5, base.depth);
        return { base, top, alpha: fade * near, heat, team: cycle.teamIndex, along: point.along * 0.5 };
      };
      const path = cycle.path;
      const points = cycle.state === 'ride'
        ? [...path, { x: cycle.x, z: cycle.z, born: now, gone: false, along: (path[path.length - 1]?.along ?? 0) }]
        : path;
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1];
        const b = points[index];
        if (a.gone || b.gone) continue;
        const endA = end(a);
        const endB = end(b);
        if (endA.base.depth < CYCLE.nearClip || endB.base.depth < CYCLE.nearClip) continue;
        ribbon.quad(endA, endB);
      }
      if (cycle.state === 'gone') continue;
      const appear = cycle.state === 'drop' ? smoothstep(0, 0.15, now - cycle.start) : 1;
      for (const segment of bikeSegments(cycle)) {
        const depth = Math.min(segment.a.depth, segment.b.depth);
        if (depth < CYCLE.nearClip) continue;
        const width = Math.min(2.2, 1.0 + 0.6 / depth);
        const color = segment.hot ? white : segment.accent ? cycle.accent : cycle.color;
        lines.add(segment.a, segment.b, color, segment.bright * appear, width);
      }
    }
    ribbon.end();
    lines.end();
  }

  return {
    group,
    counts,
    launch,
    shatter,
    update,
    draw,
    get active() {
      return cycles.filter((cycle) => cycle.state !== 'gone').length;
    },
    // where the cycles light up the floor, for the stage
    lights() {
      return cycles.filter((cycle) => cycle.light > 0.01).slice(0, 4).map((cycle) => {
        const point = stage.project(cycle.x, 0, cycle.z);
        return { x: point.x, y: point.y, strength: cycle.light, size: 0.5 / point.depth, color: cycle.color };
      });
    },
  };
}
