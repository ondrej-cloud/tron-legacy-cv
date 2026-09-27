// Light walls: pointing draws a light-cycle wall from the index fingertip.
//
// The wall follows the fingertip in smooth curves. The fingertip is already
// filtered (controls.js); here the head of the wall hangs from it on a short
// string (a "lazy brush"), so tracker jitter smaller than the string never
// reaches the wall, and samples are dropped at an even spacing along the
// head's path. Each wall is a glass ribbon (ribbon.js) extruded up and
// slightly to the right (a wall seen from a little above), with a
// white-hot leading edge, in the colour of the hand that draws it. Walls
// fade after a few seconds, the oldest go first when there is too much,
// thrown discs bounce off them (segments() and pulse()), and derezz waves
// and light batons break them (shatterWhere()); a freshly broken end glows
// for a moment.
import * as THREE from 'three';
import { additiveMaterial, quadIndices, uploadPrefix } from './gl.js';
import { createRibbon } from './ribbon.js';
import { smoothstep } from './filters.js';

export const WALL = {
  height: 0.052,            // view units (the frame is 1 unit tall)
  lean: 0.45,               // the extrusion leans right by this much per unit up
  spacing: 0.008,           // distance between stored path samples
  maxLength: 5,             // total wall length kept on screen
  capFade: 0.4,             // s, fade of walls dropped by the length cap
  fadeStart: 6,             // s
  fadeEnd: 8,
  hotTime: 0.45,            // the newest part stays white-hot this long
  brushRadius: 0.01,        // view units of slack between the fingertip and the wall's head
  headLag: 0.03,            // s, the head eases after the fingertip
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
  const ribbon = createRibbon(MAX_QUADS, teams.colors, time);

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

  // drops samples at an even spacing along the way to the head
  function resample(trail, now) {
    const { head } = trail;
    let last = lastSample(trail);
    let gap = Math.hypot(head.x - last.x, head.y - last.y);
    while (gap >= WALL.spacing) {
      const t = WALL.spacing / gap;
      pushSample(trail, last.x + (head.x - last.x) * t, last.y + (head.y - last.y) * t, now);
      last = lastSample(trail);
      gap = Math.hypot(head.x - last.x, head.y - last.y);
    }
  }

  function start(tip, now, team) {
    const trail = {
      team,
      active: true,
      head: { x: tip.x, y: tip.y },
      samples: [],
    };
    pushSample(trail, tip.x, tip.y, now);
    trails.push(trail);
    return trail;
  }

  // tip in view units (y up); called every frame while pointing
  function steer(trail, tip, now, dt) {
    const { head } = trail;
    const dx = tip.x - head.x;
    const dy = tip.y - head.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= WALL.brushRadius) return;
    const pull = (distance - WALL.brushRadius) * (1 - Math.exp(-dt / WALL.headLag));
    head.x += (dx / distance) * pull;
    head.y += (dy / distance) * pull;
    resample(trail, now);
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
      if (trail.active && last && last.gone) pushSample(trail, trail.head.x, trail.head.y, now);
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
    return fade * cap;
  }

  function rebuild(now) {
    ribbon.begin();
    let edgeCount = 0;
    const addEdge = (point, teamIndex, heat, alpha) => {
      if (edgeCount < MAX_EDGES && alpha > 0) writeEdge(edgeCount++, point, teamIndex, heat, alpha);
    };
    const hasPulses = pulses.length > 0;
    const cutHeat = (point) => (point.cutAt === undefined ? 0 : 1 - smoothstep(0, WALL.cutGlow, now - point.cutAt));
    const end = (trail, point, alpha, team) => {
      const fresh = Math.max(1 - smoothstep(0, WALL.hotTime, now - point.born), cutHeat(point));
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
      if (first && !first.gone && samples.length > 1) addEdge(first, first.team, 0, sampleAlpha(first, now));
      if (!trail.active && last && !last.gone && samples.length > 1) addEdge(last, last.team, 0, sampleAlpha(last, now));
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
    segments,
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
  };
}
