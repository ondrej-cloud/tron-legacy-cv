// The duel arena: a dark glossy floor with a network of glowing tiles,
// shaped by the terrain (terrain.js: a bowl, decks, kickers), glass
// boundary walls around it, a stadium beyond (stadium.js), a deep
// blue-black sky with a glow along the horizon, and fog.
//
// The floor is glossy: it is drawn see-through over mirror images of the
// bikes and of the jetwalls (scene.js), which go first (DRAW_ORDER). It
// writes depth, so the decks hide what is behind them. Bikes light the
// floor around them and throw a headlight beam ahead, and the boundary
// walls light up where a bike comes close.
import * as THREE from 'three';
import { ARENA } from './rules.js';
import { loadStadium } from './stadium.js';
import { createStands } from './stands.js';
import { features } from './terrain.js';
import { apronGeometry, terrainGeometry } from './ground.js';

const BIKES = 2;
const FEATURES = features.length;
// Among the opaque things: the sky first, then the mirror images under
// the floor (scene.js), then the floor over them, then what stands on it.
export const DRAW_ORDER = { sky: -10, reflections: -6, floor: -2 };
const TERRAIN = { margin: 8, spacing: 1 };   // m: past the boundary walls, between vertices
const TYPES = { bowl: 0, deck: 1, kicker: 2 };
export const FOG_COLOR = new THREE.Color(0.0025, 0.006, 0.011);

// the features as the floor shader reads them
function featureUniforms() {
  const pose = [];
  const size = [];
  const shape = [];
  for (const feature of features) {
    pose.push(new THREE.Vector4(feature.x, feature.z, feature.cos, feature.sin));
    size.push(new THREE.Vector4(feature.halfLength, feature.halfWidth, feature.height, TYPES[feature.type]));
    const [a, b, c] = feature.type === 'bowl' ? [feature.gap, feature.ringWidth, feature.rim]
      : feature.type === 'deck' ? [feature.ramp, feature.bank, 0]
        : [feature.back, feature.side, 0];
    shape.push(new THREE.Vector4(a, b, c, feature.reach + 1));
  }
  return {
    uFeaturePose: { value: pose },
    uFeatureSize: { value: size },
    uFeatureShape: { value: shape },
  };
}
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

const floorVertex = /* glsl */`
  attribute vec2 aFeature;
  varying vec3 vWorld;
  varying vec3 vNormal;
  flat varying vec2 vFeature;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normal;   // the floor is neither turned nor scaled
    vFeature = aFeature;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// The floor: near-black glossy glass with a network of rounded tiles in
// two weights of line, decals on the terrain's features (chevrons up the
// ramps, glowing rims along their edges), a bright edge along the
// boundary, the bikes' light, and the stadium's light strips reflected in
// it. Inside the boundary it is the terrain mesh, outside a flat apron.
const floorFragment = /* glsl */`
  uniform float uTile;
  uniform float uHalf;
  uniform float uBikeY[${BIKES}];
  uniform vec4 uFeaturePose[${FEATURES}];    // x, z, cos, sin of the heading
  uniform vec4 uFeatureSize[${FEATURES}];    // half length, half width, height, type
  uniform vec4 uFeatureShape[${FEATURES}];   // per type (see featureUniforms), w: reach
  varying vec3 vWorld;
  varying vec3 vNormal;
  flat varying vec2 vFeature;     // the features this triangle lies on (-1: none)
  ${commonChunk}

  float pixel;                    // m of floor across a pixel here

  float hash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  // signed distance to the rounded rectangle inside rect (x0, z0, x1, z1)
  float roundRect(vec2 p, vec4 rect, float radius) {
    vec2 centre = 0.5 * (rect.xy + rect.zw);
    vec2 halfSize = max(0.5 * (rect.zw - rect.xy), vec2(radius));
    vec2 q = abs(p - centre) - halfSize + radius;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  }

  // anti-aliased line along the zero of a distance field (in m)
  float stroke(float d, float width) {
    return line(abs(d), width, pixel);
  }

  // One cut of a tile around p, if it is still being cut ("open"): across
  // its longer side at a third, a half or two thirds, keeping the side p
  // is on. Now and then (chance "whole") a tile is left as it is, and so
  // are tiles already small.
  void cut(vec2 p, inout vec4 rect, inout float seed, inout bool open, float level, float whole) {
    float h1 = hash(vec2(seed * 97.31, level + 1.7));
    float h2 = hash(vec2(seed * 41.97 + 3.1, level * 7.3 + 0.4));
    float h3 = fract(h1 * 13.7 + h2 * 7.1);
    vec2 size = rect.zw - rect.xy;
    open = open && h3 >= whole && max(size.x, size.y) >= 5.0;
    bool acrossX = size.x > size.y * 1.25 || (size.y <= size.x * 1.25 && h1 < 0.5);
    float f = h2 < 0.4 ? 0.5 : (h1 < 0.5 ? 1.0 / 3.0 : 2.0 / 3.0);
    float at = acrossX ? mix(rect.x, rect.z, f) : mix(rect.y, rect.w, f);
    bool low = (acrossX ? p.x : p.y) < at;
    vec4 next = acrossX
      ? (low ? vec4(rect.xy, at, rect.w) : vec4(at, rect.yzw))
      : (low ? vec4(rect.xyz, at) : vec4(rect.x, at, rect.zw));
    float nextSeed = fract(seed * (acrossX ? 7.13 : 5.71) + (low ? 0.31 : 0.67) + (acrossX ? 0.0 : 0.12));
    if (open) {
      rect = next;
      seed = nextSeed;
    }
  }

  // The tile network: each square of uTile is cut in two and its halves
  // in two again (the big tiles, in bold), and those once or twice more
  // (the small tiles, fine). Each tile is a rounded rectangle a little
  // inside its cell, like the circuitry on the Grid. Returns (bold, fine,
  // glow); the small tiles only where they are big enough to see.
  vec3 tiles(vec2 p) {
    vec2 cell = floor(p / uTile);
    vec4 rect = vec4(cell * uTile, (cell + 1.0) * uTile);
    float seed = hash(cell + 17.0);
    bool open = true;
    cut(p, rect, seed, open, 0.0, 0.03);
    cut(p, rect, seed, open, 1.0, 0.1);
    vec4 big = rect;
    float toBig = roundRect(p, big + vec4(0.4, 0.4, -0.4, -0.4), 2.2);
    float bold = stroke(toBig, 0.12);
    float glow = exp(-abs(toBig) / 0.35);
    float fine = 0.0;
    if (pixel < 0.9) {
      cut(p, rect, seed, open, 2.0, 0.3);
      cut(p, rect, seed, open, 3.0, 0.3);
      // the small tiles sit further in where they share an edge with their big one
      vec4 inset = mix(vec4(0.3), vec4(1.0), vec4(equal(rect, big)));
      if (any(notEqual(rect, big))) fine = stroke(roundRect(p, rect + inset * vec4(1.0, 1.0, -1.0, -1.0), 1.2), 0.05);
    }
    return vec3(bold, fine, glow);
  }

  // A row of chevrons pointing along +u, spacing apart, within |v| < halfWidth.
  float chevrons(float u, float v, float halfWidth, float spacing) {
    float s = (u + abs(v) * 0.75) / spacing;
    float d = abs(fract(s) - 0.5) * spacing;
    float band = 1.0 - smoothstep(0.32 * spacing - pixel * 1.5, 0.32 * spacing, d);
    return band * (1.0 - smoothstep(halfWidth - 0.2, halfWidth, abs(v)));
  }

  // what the features add: x the decals (chevrons), y the rims, z how
  // much of the tile network still shows on them
  vec3 decals(vec2 p) {
    vec3 result = vec3(0.0, 0.0, 1.0);
    for (int k = 0; k < 2; k++) {
      int i = int(k == 0 ? vFeature.x : vFeature.y);
      if (i < 0) continue;
      vec4 pose = uFeaturePose[i];
      vec4 shape = uFeatureShape[i];
      vec2 offset = p - pose.xy;
      vec4 size = uFeatureSize[i];
      float u = dot(offset, pose.zw);
      float v = dot(offset, vec2(-pose.w, pose.z));
      float hl = size.x;
      float hw = size.y;
      if (size.w < 0.5) {
        // bowl: shape = gap, ring half width, rim height
        float radius = min(hl, hw);
        float r = length(vec2(u / hl, v / hw));
        float fromEdge = (r - 1.0) * radius;
        result.y += stroke(fromEdge + 0.4, 0.14) * 0.8;
        result.y += stroke(fromEdge - shape.x, 0.25) * 1.1;           // the raised ring's crest
        result.y += stroke(fromEdge - shape.x - shape.y, 0.08) * 0.35;
        // three chevrons down into it from each end
        float down = abs(u) / hl;
        result.x += chevrons(-sign(u) * u, v, hw * 0.12, 1.6) * step(0.5, down) * step(down, 0.5 + 4.6 / hl) * 0.8;
        result.z *= mix(0.25, 1.0, smoothstep(-2.0, 0.0, fromEdge));
      } else if (size.w < 1.5) {
        // deck: shape = ramp, bank
        float ramp = shape.x;
        float bank = shape.y;
        vec2 top = vec2(hl, hw);
        // the top's edge, except where the ramp comes up
        float edge = roundRect(vec2(u, v), vec4(-top, top) + vec4(0.4, 0.4, -0.4, -0.4), 3.0);
        float notRamp = smoothstep(-hl - 0.5, -hl + 3.0, u);
        result.y += stroke(edge, 0.25) * 2.2 * notRamp;
        // light spilling down the banks from the rim; fewer tile lines on them
        float down = max(edge, 0.0);
        result.y += 0.25 * exp(-down / 2.5) * step(0.0, edge) * notRamp;
        result.z *= mix(1.0, 0.45, smoothstep(0.0, 1.0, edge) * (1.0 - smoothstep(bank - 1.0, bank, edge)));
        // the foot of its banks
        float foot = roundRect(vec2(u, v), vec4(-hl, -hw - bank, hl + bank, hw + bank), 4.0);
        result.y += stroke(foot + 0.3, 0.1) * 0.5 * step(-hl + 1.0, u);
        // the ramp: rims along its sides and chevrons up it in groups of three
        float onRamp = step(-hl - ramp, u) * step(u, -hl);
        result.y += stroke(abs(v) - hw + 0.4, 0.14) * onRamp * 1.1;
        float group = step(fract((u + hl) / 10.0), 0.42);
        result.x += chevrons(u, v, hw * 0.3, 1.4) * group * step(-hl - ramp + 3.0, u) * step(u, -hl - 1.0);
      } else {
        // kicker: shape = back (the slope behind the lip), side falloff
        float lip = hl - shape.x;
        float onRamp = step(-hl, u) * step(u, lip);
        result.y += stroke(u - lip + 0.15, 0.22) * step(abs(v), hw) * 2.2;
        result.y += stroke(abs(v) - hw + 0.3, 0.12) * onRamp * 1.1;
        result.y += stroke(u + hl - 0.3, 0.08) * step(abs(v), hw) * 0.5;
        result.x += chevrons(u, v, hw * 0.45, 1.5) * step(-hl + 1.5, u) * step(u, lip - 1.2);
        // the ramp glows brighter towards its lip
        float up = clamp((u + hl) / (lip + hl), 0.0, 1.0);
        result.x += 0.12 * up * up * onRamp * (1.0 - smoothstep(hw - 0.5, hw + 0.5, abs(v)));
        result.z *= mix(1.0, 0.3, onRamp * step(abs(v), hw + 1.0));
      }
    }
    return result;
  }

  // the stadium's light strips and the glow above the horizon, as the
  // glossy floor reflects them in direction r: soft, and broken up
  // irregularly around the stands
  vec3 reflected(vec3 r) {
    float elevation = r.y;
    float around = atan(r.z, r.x) * 6.0;
    float panel = step(0.4, hash(vec2(floor(around), 5.0))) * smoothstep(0.0, 0.3, fract(around)) * smoothstep(1.0, 0.7, fract(around));
    float strips = exp(-pow((elevation - 0.04) / 0.03, 2.0)) * 0.22
      + exp(-pow((elevation - 0.13) / 0.05, 2.0)) * panel * 0.35;
    float haze = exp(-max(elevation, 0.0) / 0.05);
    return vec3(0.55, 0.85, 1.0) * strips + vec3(0.01, 0.025, 0.035) * haze;
  }

  void main() {
    vec2 p = vWorld.xz;
    float fromBoundary = uHalf - max(abs(p.x), abs(p.y));
    float inside = step(0.0, fromBoundary);
    vec3 cyan = vec3(0.3, 0.82, 1.0);
    vec3 white = vec3(0.75, 0.93, 1.0);
    vec3 normal = normalize(vNormal);
    vec3 toEye = normalize(cameraPosition - vWorld);

    // lines further apart than they are wide on screen fade out, not shimmer
    pixel = length(fwidth(p)) * 0.75;
    vec3 network = tiles(p) * vec3(1.0 - smoothstep(1.2, 5.0, pixel), 1.0 - smoothstep(0.2, 0.9, pixel), 1.0 - smoothstep(0.5, 3.0, pixel));
    vec3 decal = decals(p);
    float lines = (0.7 * network.x + 0.14 * network.y + 0.05 * network.z) * decal.z * inside;
    float bright = decal.x * 0.4 + decal.y * 0.5;
    // the boundary: a white-hot edge, a fainter one inside it
    float edge = stroke(fromBoundary - 0.5, 0.3) * 2.2 + stroke(fromBoundary - 2.2, 0.1) * 0.5
      + exp(-abs(fromBoundary) / 2.5) * 0.08;

    vec3 color = vec3(0.002, 0.0035, 0.006);
    // glossy: the light strips around the stadium, stronger at a glancing angle
    float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(normal, toEye), 0.0), 5.0);
    color += reflected(reflect(-toEye, normal)) * fresnel * 0.2;
    // slopes catch a little of the light from above the stands
    color += vec3(0.01, 0.025, 0.035) * (1.0 - normal.y) * 2.0;

    // the bikes light the floor: a pool of their colour, a white beam ahead
    vec3 light = vec3(0.0);
    float beams = 0.0;
    for (int i = 0; i < ${BIKES}; i++) {
      vec4 bike = uBike[i];
      if (bike.w <= 0.0) continue;
      vec2 forward = vec2(cos(bike.z), sin(bike.z));
      vec2 offset = p - bike.xy;
      float above = vWorld.y - uBikeY[i];
      float pool = exp(-(dot(offset, offset) + above * above * 4.0) / 10.0);
      float ahead = dot(offset, forward);
      float across = abs(offset.x * forward.y - offset.y * forward.x);
      float beam = 0.0;
      if (ahead > 1.0) {
        // widening ahead (smoothstep's edges must stay in order: NaN otherwise)
        float spread = 1.0 + ahead * 0.15;
        beam = smoothstep(1.0, 4.0, ahead) * exp(-ahead / 26.0) * (1.0 - smoothstep(0.6, 1.4, across / spread))
          * exp(-abs(above) / 3.0);
      }
      light += bike.w * uBikeColor[i] * pool * 0.5;
      beams += bike.w * beam;
    }
    // the lines pick up the bikes' light; the decals, already bright, less so
    float lit = lines + 0.25 * bright;
    color += light * (0.25 + 2.5 * lit);
    color += vec3(0.7, 0.9, 1.0) * beams * (0.012 + 0.9 * lit);
    color += cyan * lines + mix(cyan, white, 0.6) * bright + white * edge;
    // glossy: what is under the floor (the reflections) shows through a little
    float alpha = clamp(0.72 + (lines + bright) * 2.0 + edge + beams * 0.1, 0.0, 1.0);
    gl_FragColor = vec4(fogged(color * uPower), alpha);
  }
`;

// glass boundary walls: a white-hot top edge, a base line, faint horizontal
// bands, and a grid of panels that lights up where a bike comes close
const wallVertex = /* glsl */`
  varying vec3 vWorld;
  varying float vAlong;
  varying vec3 vFacing;     // the wall's normal
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vFacing = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
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
  varying vec3 vFacing;
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
    // seen almost edge-on, its lines would pile up into a bright smear
    float facing = smoothstep(0.03, 0.25, abs(dot(vFacing, normalize(cameraPosition - vWorld))));
    // mostly just its edges; the glass itself shows where a bike comes close
    vec3 color = white * (top * mix(0.5, 1.2, facing) + base * 0.5 * facing)
      + (white * (bands * 0.015 + posts * 0.03) * (0.4 + 0.6 * v)
        + vec3(0.006, 0.02, 0.03) * pow(v, 3.0)
        + (tint * 0.6 + white * near * 0.1) * (0.06 + 0.45 * bands + 0.6 * posts)) * facing;
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

  // The floor writes depth, so raised ground hides what is behind it. It
  // is still see-through over the mirror images drawn before it: it goes
  // with the opaque things (transparent: false) but blends.
  const floorMaterial = new THREE.ShaderMaterial({
    vertexShader: floorVertex,
    fragmentShader: floorFragment,
    uniforms: {
      ...shared,
      ...featureUniforms(),
      uTile: { value: ARENA.tile },
      uHalf: { value: ARENA.half },
      uBikeY: { value: new Array(BIKES).fill(0) },
    },
    transparent: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const reach = ARENA.half + TERRAIN.margin;
  const floor = new THREE.Group();
  for (const geometry of [terrainGeometry(reach, TERRAIN.spacing), apronGeometry(reach, 2000)]) {
    const mesh = new THREE.Mesh(geometry, floorMaterial);
    // after the reflections (DRAW_ORDER), before everything standing on it
    mesh.renderOrder = DRAW_ORDER.floor;
    floor.add(mesh);
  }

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
  sky.renderOrder = DRAW_ORDER.sky;
  sky.frustumCulled = false;
  sky.onBeforeRender = (renderer, scene, camera) => sky.position.copy(camera.position);

  scene.add(sky, floor, walls, createStands(shared));

  let stadium = null;
  const stadiumReady = loadStadium({ envMap })
    .then((loaded) => {
      stadium = loaded;
      if (loaded) scene.add(loaded.object);
    })
    .catch((error) => console.warn('ride: no stadium model, the arena stands on its own', error));

  return {
    scene,
    // bikes: [{ x, z, y, heading, light, color }] (light 0 = not on the floor)
    setBikes(bikes) {
      for (let index = 0; index < BIKES; index++) {
        const bike = bikes[index];
        const slot = shared.uBike.value[index];
        if (!bike) {
          slot.w = 0;
          continue;
        }
        slot.set(bike.x, bike.z, bike.heading, bike.light);
        floorMaterial.uniforms.uBikeY.value[index] = bike.y ?? 0;
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
