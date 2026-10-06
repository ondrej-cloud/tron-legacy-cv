// Light walls: pointing draws a light-cycle wall from the index fingertip.
//
// The path only runs horizontally or vertically. The head follows the
// fingertip along the current run and turns 90° once the fingertip has
// clearly left that line, so tracker jitter never bends it. Each wall is a
// glass ribbon (ribbon.js) extruded up and slightly to the right by a fixed
// amount on screen (a wall seen from a little above), so it keeps its
// height whichever way a run goes, with a white-hot leading edge, in the
// colour of the hand that draws it. Walls fade after a few seconds, the
// oldest go first when there is too much, thrown discs bounce off them
// (segments() and pulse()), and derezz waves and light batons break them
// (shatterWhere()); a freshly broken end glows for a moment. A pinch picks
// a whole wall up and drags it along (nearest(), move()). When the Grid
// powers down, the walls go out run by run (powerDown()).
import * as THREE from 'three';
import { additiveMaterial, quadIndices, uploadPrefix } from './gl.js';
import { createRibbon } from './ribbon.js';
import { smoothstep } from './filters.js';
import { lightPower } from './endofline.js';

export const WALL = {
  height: 0.052,            // view units (the frame is 1 unit tall)
  lean: 0.45,               // the extrusion leans right by this much per unit up
  spacing: 0.008,           // distance between stored path samples
  maxLength: 5,             // total wall length kept on screen
  capFade: 0.4,             // s, fade of walls dropped by the length cap
  fadeStart: 6,             // s
  fadeEnd: 8,
  hotTime: 0.45,            // the newest part stays white-hot this long
  startDistance: 0.018,     // fingertip travel that picks the first direction
  turnOffset: 0.036,        // off-axis offset that always turns
  quickTurnOffset: 0.016,   // a smaller offset turns if the fingertip clearly moves sideways
  quickTurnSpeed: 0.2,      // view units/s
  sidewaysRatio: 1.5,       // sideways speed vs speed along the run
  minRun: 0.024,            // shortest run between two turns
  reverseDistance: 0.05,    // backing up this far makes a U-turn
  headLag: 0.03,            // s, the head eases onto the fingertip's projection
  solidAlpha: 0.3,          // a fading wall stops discs until it is fainter than this
  pulseSpeed: 1.1,          // view units/s, the flash running along a wall a disc hit
  pulseWidth: 0.03,
  pulseTime: 0.7,           // s
  cutGlow: 0.8,             // s a freshly cut end of wall stays hot
};

const MAX_SAMPLES = Math.ceil(WALL.maxLength / WALL.spacing);
const MAX_QUADS = MAX_SAMPLES + 256;   // room for dying samples and live head segments
const MAX_EDGES = 64;   // vertical posts at wall ends and at the live heads

// Vertical posts from the base to the top of a wall: plain caps at the ends
// of a wall, and at the live head a white-hot leading edge with a bright
// point where the "light cycle" is.
const edgeVertex = /* glsl */`
  attribute vec4 aEdge;   // across (view units), along (0 base .. 1 top), team, heat
  attribute float aEdgeAlpha;
  varying vec4 vEdge;
  varying float vAlpha;
  void main() {
    vEdge = aEdge;
    vAlpha = aEdgeAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const edgeFragment = /* glsl */`
  uniform vec3 uTeam[2];
  uniform float uPixel;    // view units per pixel
  uniform float uHeight;   // wall height in view units
  uniform float uTime;
  varying vec4 vEdge;
  varying float vAlpha;
  void main() {
    vec3 color = mix(uTeam[0], uTeam[1], vEdge.z);
    float heat = vEdge.w;
    vec3 hot = mix(color, vec3(1.0), 0.8);
    float d = abs(vEdge.x);
    float along = vEdge.y;
    float span = smoothstep(-0.12, 0.0, along) * (1.0 - smoothstep(1.0, 1.12, along));
    float post = (1.0 - smoothstep(0.8 * uPixel, 2.0 * uPixel, d)) * span;
    float glow = exp(-d / (6.0 * uPixel)) * span * mix(0.08, 0.2, heat);
    float lift = along * uHeight;
    float flicker = 0.85 + 0.15 * sin(uTime * 53.0);
    float point = exp(-(d * d + lift * lift) / (uPixel * uPixel * 16.0)) * flicker * heat;
    vec3 col = mix(color * 1.1, hot * 1.5, heat) * post + hot * point * 1.8 + color * glow;
    gl_FragColor = vec4(col * vAlpha, 1.0);
  }
`;

// teams: from createTeams(); each trail takes the team of the hand drawing it
export function createLightWalls(view, teams) {
  const lean = Math.hypot(WALL.lean, 1);
  const extrude = { x: (WALL.lean / lean) * WALL.height, y: WALL.height / lean };

  const trails = [];
  const pulses = [];
  let livingSamples = 0;

  const time = { value: 0 };
  const ribbon = createRibbon(MAX_QUADS, teams.colors, time, { edgeOn: 0 });

  const edgePositions = new Float32Array(MAX_EDGES * 4 * 3);
  const edgeData = new Float32Array(MAX_EDGES * 4 * 4);
  const edgeAlpha = new Float32Array(MAX_EDGES * 4);
  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3).setUsage(THREE.DynamicDrawUsage));
  edgeGeometry.setAttribute('aEdge', new THREE.BufferAttribute(edgeData, 4).setUsage(THREE.DynamicDrawUsage));
  edgeGeometry.setAttribute('aEdgeAlpha', new THREE.BufferAttribute(edgeAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  edgeGeometry.setIndex(new THREE.BufferAttribute(quadIndices(MAX_EDGES), 1));
  const edgeUniforms = {
    uTeam: { value: teams.colors },
    uPixel: { value: 1 / 720 },
    uHeight: { value: WALL.height },
    uTime: time,
  };
  const edges = new THREE.Mesh(edgeGeometry, additiveMaterial(edgeVertex, edgeFragment, edgeUniforms));
  edges.frustumCulled = false;

  const group = new THREE.Group();
  group.add(ribbon.mesh, edges);

  function pushSample(trail, x, y, now) {
    const previous = trail.samples[trail.samples.length - 1];
    const along = previous ? previous.along + Math.hypot(x - previous.x, y - previous.y) : 0;
    trail.samples.push({ x, y, born: now, team: trail.team.index, along, gone: false, dieAt: Infinity });
    livingSamples++;
  }

  function lastSample(trail) {
    return trail.samples[trail.samples.length - 1];
  }

  // moves the head along the current run and drops samples behind it
  function advance(trail, distance, now) {
    const { head, dir } = trail;
    head.x += dir.x * distance;
    head.y += dir.y * distance;
    let last = lastSample(trail);
    if (!last) {
      pushSample(trail, head.x, head.y, now);
      return;
    }
    let gap = Math.hypot(head.x - last.x, head.y - last.y);
    while (gap >= WALL.spacing) {
      pushSample(trail, last.x + dir.x * WALL.spacing, last.y + dir.y * WALL.spacing, now);
      last = lastSample(trail);
      gap -= WALL.spacing;
    }
  }

  function turn(trail, dirX, dirY, now) {
    const last = lastSample(trail);
    if (!last || Math.hypot(trail.head.x - last.x, trail.head.y - last.y) > 1e-4) {
      pushSample(trail, trail.head.x, trail.head.y, now);
    }
    trail.dir = { x: dirX, y: dirY };
    trail.corner = { x: trail.head.x, y: trail.head.y };
    trail.turns++;
  }

  function start(tip, now, team) {
    const trail = {
      team,
      active: true,
      head: { x: tip.x, y: tip.y },
      corner: { x: tip.x, y: tip.y },
      dir: null,
      samples: [],
      turns: 0,
    };
    pushSample(trail, tip.x, tip.y, now);
    trails.push(trail);
    return trail;
  }

  // tip and velocity in view units (y up); called every frame while pointing
  function steer(trail, tip, velocity, now, dt) {
    const { head } = trail;
    if (!trail.dir) {
      const dx = tip.x - head.x;
      const dy = tip.y - head.y;
      if (Math.hypot(dx, dy) < WALL.startDistance) return;
      trail.dir = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
    }
    const { dir } = trail;
    const side = { x: -dir.y, y: dir.x };
    const offsetX = tip.x - head.x;
    const offsetY = tip.y - head.y;
    const along = offsetX * dir.x + offsetY * dir.y;
    const across = offsetX * side.x + offsetY * side.y;
    const speedAlong = velocity.x * dir.x + velocity.y * dir.y;
    const speedAcross = velocity.x * side.x + velocity.y * side.y;
    const run = Math.abs((head.x - trail.corner.x) * dir.x + (head.y - trail.corner.y) * dir.y);

    if (run < WALL.minRun) {
      // The run has barely started. A run that hasn't moved yet may aim
      // anywhere (a bad first guess); a short one may only double back.
      // Without this a fingertip that reverses right away would be stuck.
      const dominant = Math.abs(offsetX) >= Math.abs(offsetY)
        ? { x: Math.sign(offsetX), y: 0 } : { x: 0, y: Math.sign(offsetY) };
      const reversed = dominant.x === -dir.x && dominant.y === -dir.y;
      const elsewhere = dominant.x !== dir.x || dominant.y !== dir.y;
      if (Math.hypot(offsetX, offsetY) > 2 * WALL.startDistance && (run < 1e-3 ? elsewhere : reversed)) {
        if (run < 1e-3) trail.dir = dominant;
        else turn(trail, dominant.x, dominant.y, now);
        return;
      }
      // a fingertip that has clearly gone off to the side turns even a short
      // run (only small sideways moves wait for the run to grow, against jitter)
      if (run >= 1e-3 && Math.abs(across) > WALL.turnOffset) {
        const sign = Math.sign(across);
        turn(trail, side.x * sign, side.y * sign, now);
        return;
      }
    } else {
      const movingSideways = Math.abs(across) > WALL.quickTurnOffset
        && Math.sign(speedAcross) === Math.sign(across)
        && Math.abs(speedAcross) > WALL.quickTurnSpeed
        && Math.abs(speedAcross) > WALL.sidewaysRatio * Math.abs(speedAlong);
      if (Math.abs(across) > WALL.turnOffset || movingSideways) {
        const sign = Math.sign(across);
        turn(trail, side.x * sign, side.y * sign, now);
        return;
      }
      if (along < -WALL.reverseDistance) {
        // a light cycle can't reverse: jog sideways, the next turn heads back
        const sign = Math.sign(across) || 1;
        turn(trail, side.x * sign, side.y * sign, now);
        advance(trail, WALL.minRun, now);
        return;
      }
    }
    if (along > 0) advance(trail, along * (1 - Math.exp(-dt / WALL.headLag)), now);
  }

  function finish(trail, now) {
    const last = lastSample(trail);
    if (last && !last.gone && Math.hypot(trail.head.x - last.x, trail.head.y - last.y) > 1e-4) {
      pushSample(trail, trail.head.x, trail.head.y, now);
    }
    trail.active = false;
  }

  // Shatters every wall sample born before `bornBefore` within `radius` of
  // `origin`; `onShatter` gets each sample and the extrusion vector.
  function shatter(origin, radius, bornBefore, onShatter, now) {
    const radiusSquared = radius * radius;
    shatterWhere((sample) => sample.born <= bornBefore
      && (sample.x - origin.x) ** 2 + (sample.y - origin.y) ** 2 <= radiusSquared, onShatter, now);
  }

  // Shatters every visible wall sample for which `test(sample, extrude)` is
  // true; `onShatter` gets each sample and the extrusion vector.
  function shatterWhere(test, onShatter, now) {
    for (const trail of trails) {
      const samples = trail.samples;
      let broke = false;
      for (const sample of samples) {
        if (sample.gone || sampleAlpha(sample, now) <= 0 || !test(sample, extrude)) continue;
        sample.gone = true;
        broke = true;
        if (sample.dieAt === Infinity) livingSamples--;
        onShatter(sample, extrude);
      }
      if (!broke) continue;
      // the ends left standing next to a break glow for a moment
      for (let index = 0; index < samples.length; index++) {
        const sample = samples[index];
        if (sample.gone) continue;
        if (samples[index - 1]?.gone || samples[index + 1]?.gone) sample.cutAt = now;
      }
      // a wall still being drawn carries on from where the head is now
      const last = lastSample(trail);
      if (trail.active && last && last.gone) {
        trail.corner = { x: trail.head.x, y: trail.head.y };
        pushSample(trail, trail.head.x, trail.head.y, now);
      }
    }
  }

  // The stretches of wall solid enough to stop a disc, as segments of its
  // base line in view units: { x0, y0, x1, y1, trail, along0, team }.
  function segments(now) {
    const out = [];
    for (const trail of trails) {
      const points = trail.samples.slice();
      const last = lastSample(trail);
      if (trail.active && last && !last.gone) {
        points.push({ x: trail.head.x, y: trail.head.y, born: now, dieAt: Infinity, gone: false,
          team: trail.team.index, along: last.along + Math.hypot(trail.head.x - last.x, trail.head.y - last.y) });
      }
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1];
        const b = points[index];
        if (a.gone || b.gone || sampleAlpha(a, now) < WALL.solidAlpha || sampleAlpha(b, now) < WALL.solidAlpha) continue;
        if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
        out.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, trail, along0: a.along, team: b.team });
      }
    }
    return out;
  }

  // The Grid powers down: every straight run of wall goes out at the time
  // `offTime(point)` gives for its middle, after a last flicker.
  function powerDown(offTime) {
    for (const trail of trails) {
      const samples = trail.samples.filter((sample) => !sample.gone);
      let run = [];
      const close = () => {
        if (!run.length) return;
        const middle = run[Math.floor(run.length / 2)];
        const offAt = offTime(middle);
        const seed = Math.random() * 100;
        for (const sample of run) {
          sample.offAt = offAt;
          sample.offSeed = seed;
        }
        run = [];
      };
      for (let index = 0; index < samples.length; index++) {
        const sample = samples[index];
        const previous = samples[index - 1];
        const before = samples[index - 2];
        if (previous && before) {
          const horizontal = Math.abs(sample.y - previous.y) < 1e-6;
          const wasHorizontal = Math.abs(previous.y - before.y) < 1e-6;
          // a corner belongs to both runs; the new run starts after it
          if (horizontal !== wasHorizontal) close();
        }
        run.push(sample);
      }
      close();
    }
  }

  // The finished wall nearest to `point` (view units) within `reach`, as
  // { trail, along }, or null. Distance is measured to the wall's middle
  // line, less half its height, so pinching anywhere on the glass counts.
  function nearest(point, reach, now) {
    const halfHeight = Math.hypot(extrude.x, extrude.y) / 2;
    let best = null;
    let bestDistance = reach;
    for (const trail of trails) {
      if (trail.active) continue;
      const samples = trail.samples;
      for (let index = 1; index < samples.length; index++) {
        const a = samples[index - 1];
        const b = samples[index];
        if (a.gone || b.gone || sampleAlpha(a, now) < WALL.solidAlpha) continue;
        const ax = a.x + extrude.x / 2;
        const ay = a.y + extrude.y / 2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSquared = dx * dx + dy * dy || 1e-12;
        const t = Math.min(1, Math.max(0, ((point.x - ax) * dx + (point.y - ay) * dy) / lengthSquared));
        const distance = Math.hypot(point.x - ax - dx * t, point.y - ay - dy * t) - halfHeight;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { trail, along: a.along + (b.along - a.along) * t };
        }
      }
    }
    return best;
  }

  // A wall picked up by a pinch: it glows, moves as a whole with the hand
  // (move()) and is lit afresh, so it fades only a while after it is put
  // down, like a newly drawn one.
  function grab(trail, grabbed, now) {
    trail.grabbed = grabbed;
    if (!grabbed) return;
    for (const sample of trail.samples) sample.born = Math.max(sample.born, now - WALL.hotTime);
  }

  function move(trail, dx, dy, dt) {
    for (const sample of trail.samples) {
      sample.x += dx;
      sample.y += dy;
      sample.born += dt;
      if (sample.dieAt !== Infinity) sample.dieAt += dt;
    }
    for (const point of [trail.head, trail.corner]) {
      point.x += dx;
      point.y += dy;
    }
  }

  // A wall that turned out not to be one (the start of a two-hand frame
  // gesture, see controls.js) goes away without breaking up.
  function discard(trail) {
    const index = trails.indexOf(trail);
    if (index < 0) return;
    for (const sample of trail.samples) {
      if (!sample.gone && sample.dieAt === Infinity) livingSamples--;
    }
    trails.splice(index, 1);
  }

  // a fresh Grid: no walls at all
  function clear() {
    trails.length = 0;
    pulses.length = 0;
    livingSamples = 0;
  }

  // a flash that runs both ways along a wall from where a disc struck it
  function pulse(trail, along, now) {
    pulses.push({ trail, along, start: now });
  }

  function pulseHeat(trail, along, now) {
    let heat = 0;
    for (const item of pulses) {
      if (item.trail !== trail) continue;
      const age = now - item.start;
      const spread = Math.abs(Math.abs(along - item.along) - age * WALL.pulseSpeed);
      heat += Math.exp(-((spread / WALL.pulseWidth) ** 2)) * (1 - age / WALL.pulseTime);
    }
    return Math.min(1, heat);
  }

  // too much wall on screen: the oldest samples fade out quickly
  function enforceLengthCap(now) {
    while (livingSamples > MAX_SAMPLES) {
      let oldest = null;
      for (const trail of trails) {
        const candidate = trail.samples.find((sample) => !sample.gone && sample.dieAt === Infinity);
        if (candidate && (!oldest || candidate.born < oldest.born)) oldest = candidate;
      }
      if (!oldest) break;
      oldest.dieAt = now + WALL.capFade;
      livingSamples--;
    }
  }

  function prune(now) {
    for (let index = trails.length - 1; index >= 0; index--) {
      const trail = trails[index];
      const samples = trail.samples;
      while (samples.length > (trail.active ? 1 : 0)) {
        const first = samples[0];
        const expired = now - first.born >= WALL.fadeEnd || now >= first.dieAt;
        if (!first.gone && !expired) break;
        if (!first.gone && first.dieAt === Infinity) livingSamples--;
        samples.shift();
      }
      if (!trail.active && samples.length === 0) trails.splice(index, 1);
    }
    for (let index = pulses.length - 1; index >= 0; index--) {
      if (now - pulses[index].start > WALL.pulseTime) pulses.splice(index, 1);
    }
  }

  function sampleAlpha(sample, now) {
    const age = now - sample.born;
    const fade = 1 - smoothstep(WALL.fadeStart, WALL.fadeEnd, age);
    const cap = sample.dieAt === Infinity ? 1 : Math.max(0, (sample.dieAt - now) / WALL.capFade);
    return fade * cap * lightPower(sample.offAt, now, sample.offSeed);
  }

  function rebuild(now) {
    ribbon.begin();
    let edgeCount = 0;
    const addEdge = (point, teamIndex, heat, alpha) => {
      if (edgeCount < MAX_EDGES && alpha > 0) writeEdge(edgeCount++, point, teamIndex, heat, alpha);
    };
    const hasPulses = pulses.length > 0;
    const cutHeat = (point) => (point.cutAt === undefined ? 0 : 1 - smoothstep(0, WALL.cutGlow, now - point.cutAt));
    // a wall held by a pinch glows, with a slow throb
    const grabHeat = 0.8 + 0.2 * Math.sin(now * 7);
    const end = (trail, point, alpha, team) => {
      let fresh = Math.max(1 - smoothstep(0, WALL.hotTime, now - point.born), cutHeat(point));
      if (trail.grabbed) fresh = Math.max(fresh, grabHeat);
      const heat = hasPulses ? Math.max(fresh, pulseHeat(trail, point.along, now)) : fresh;
      return {
        base: point,
        top: { x: point.x + extrude.x, y: point.y + extrude.y },
        alpha,
        heat,
        team,
        along: point.along,
      };
    };
    for (const trail of trails) {
      const samples = trail.samples;
      for (let index = 1; index < samples.length; index++) {
        const a = samples[index - 1];
        const b = samples[index];
        if (a.gone || b.gone) continue;
        const alphaA = sampleAlpha(a, now);
        const alphaB = sampleAlpha(b, now);
        if (alphaA <= 0 && alphaB <= 0) continue;
        ribbon.quad(end(trail, a, alphaA, a.team), end(trail, b, alphaB, b.team));
      }
      for (const sample of samples) {
        const heat = sample.gone ? 0 : cutHeat(sample);
        if (heat > 0) addEdge(sample, sample.team, heat, sampleAlpha(sample, now));
      }
      const first = samples[0];
      const last = lastSample(trail);
      const endHeat = trail.grabbed ? grabHeat : 0;
      if (first && !first.gone && samples.length > 1) addEdge(first, first.team, endHeat, sampleAlpha(first, now));
      if (!trail.active && last && !last.gone && samples.length > 1) addEdge(last, last.team, endHeat, sampleAlpha(last, now));
      if (!trail.active || !last || last.gone) continue;
      const head = { x: trail.head.x, y: trail.head.y, born: now,
        along: last.along + Math.hypot(trail.head.x - last.x, trail.head.y - last.y) };
      if (head.along - last.along > 1e-5) {
        ribbon.quad(end(trail, last, sampleAlpha(last, now), last.team), end(trail, head, 1, trail.team.index));
      }
      addEdge(trail.head, trail.team.index, 1, 1);
    }
    ribbon.end();
    edgeGeometry.setDrawRange(0, edgeCount * 6);
    for (const name of ['position', 'aEdge', 'aEdgeAlpha']) uploadPrefix(edgeGeometry.getAttribute(name), edgeCount * 4);
  }

  // a narrow quad along the extrusion vector, from just below the base to just above the top
  function writeEdge(slot, point, teamIndex, heat, alpha) {
    const width = 0.03;
    const normal = { x: extrude.y / WALL.height, y: -extrude.x / WALL.height };
    const ends = [-0.15, 1.15];
    const corners = [[ends[0], -1], [ends[0], 1], [ends[1], 1], [ends[1], -1]];
    corners.forEach(([along, side], corner) => {
      const vertex = slot * 4 + corner;
      edgePositions[vertex * 3] = point.x + extrude.x * along + normal.x * side * width;
      edgePositions[vertex * 3 + 1] = point.y + extrude.y * along + normal.y * side * width;
      edgePositions[vertex * 3 + 2] = 0;
      edgeData.set([side * width, along, teamIndex, heat], vertex * 4);
      edgeAlpha[vertex] = alpha;
    });
  }

  return {
    object: group,
    extrude,
    start,
    steer,
    finish,
    shatter,
    shatterWhere,
    nearest,
    grab,
    move,
    discard,
    segments,
    powerDown,
    clear,
    colorOf(sample) {
      return teams.colors[sample.team];
    },
    pulse,
    update(now) {
      time.value = now;
      edgeUniforms.uPixel.value = 1 / view.height;
      enforceLengthCap(now);
      prune(now);
      rebuild(now);
    },
    get length() {
      return livingSamples * WALL.spacing;
    },
    get trailCount() {
      return trails.length;
    },
    get turnCount() {
      return trails.reduce((sum, trail) => sum + trail.turns, 0);
    },
  };
}
