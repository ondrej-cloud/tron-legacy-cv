// Identity disc: an "ok" hand summons it, it stays at that palm, and a fast
// flick throws it. In flight it spins and leaves a light trail; it ricochets
// off the edges of the frame and off the light walls (a swept test, so a
// fast disc can't tunnel through a thin wall), two thrown discs bounce off
// each other, and a light baton bats a disc away. Once the ricochets settle
// it homes back to its owner and is caught by an open hand (a closed hand
// makes it circle and wait). If the owner's hand is gone, the disc fades
// out. Each disc has its hand's colour.
import * as THREE from 'three';
import { additiveMaterial, uploadPrefix } from './gl.js';
import { clamp, easeTowards } from './filters.js';
import { BATON, distanceToSegment, sweptContains } from './baton.js';

export const DISC = {
  radiusPerPalm: 0.72,      // disc radius relative to the palm length
  minRadius: 0.065,         // view units
  maxRadius: 0.12,
  summonTime: 0.5,          // s for the rings to draw in
  heldSpin: 2.4,            // rad/s
  summonSpin: 7,
  flightSpin: 20,
  heldSquash: 0.86,         // apparent tilt: minor / major axis
  flightSquash: 0.42,
  throwGain: 2.0,           // hand speed -> disc speed
  minThrowSpeed: 1.25,      // view units/s: even a gentle toss crosses the frame and ricochets
  maxThrowSpeed: 2.4,
  bounceDamping: 0.94,
  minFreeFlight: 1.1,       // s: it flies free at least this long ...
  settleTime: 0.6,          // ... and until it hasn't hit anything for this long ...
  maxFreeFlight: 2.2,       // ... but no longer than this, then it homes in
  hitReach: 0.9,            // share of the disc's radius that collides
  batonReach: 0.55,         // ... with a baton (the disc is seen at an angle)
  batonRestitution: 0.9,
  batonCooldown: 0.15,      // s before the same disc can be batted again
  homingSpeed: 1.9,
  homingTurn: [2.5, 10],    // steering rate (1/s) when homing starts .. one second later
  catchDistance: 0.07,
  orbitRadius: 0.16,        // around a hand that isn't open yet
  lostHandGrace: 0.5,       // s without the owner's hand before the disc gives up
  maxFlight: 7,
  fadeTime: 0.6,
  trailTime: 0.3,
  trailPoints: 48,
};

// the rim sits at this radius of the quad; the rest is room for the glow
const RIM = 0.8;
const POOL = 4;

const discVertex = /* glsl */`
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const discFragment = /* glsl */`
  uniform vec3 uColor;
  uniform float uSpin;       // radians
  uniform float uProgress;   // summoning: 0..1
  uniform float uAlpha;
  uniform float uFlash;      // white flash when summoned or caught
  varying vec2 vLocal;
  const float TAU = 6.28318530718;
  float ringLine(float r, float radius, float halfWidth, float aa) {
    return 1.0 - smoothstep(halfWidth, halfWidth + 1.5 * aa, abs(r - radius));
  }
  float band(float r, float inner, float outer, float aa) {
    return smoothstep(inner - aa, inner + aa, r) * (1.0 - smoothstep(outer - aa, outer + aa, r));
  }
  void main() {
    float r = length(vLocal);
    float aa = fwidth(r);
    float angle = atan(vLocal.y, vLocal.x);
    // summoning draws the disc in, clockwise from the top
    float sweep = fract(0.25 - angle / TAU);
    float reveal = 1.0 - smoothstep(uProgress - 0.015, uProgress, sweep);
    float behind = (sweep - uProgress) * 30.0;
    float spark = uProgress < 1.0 ? exp(-behind * behind) * band(r, 0.6, 0.85, aa) : 0.0;

    float turn = fract((angle - uSpin) / TAU);
    float segment = fract(turn * 5.0);
    float lit = smoothstep(0.0, 0.04, segment) * (1.0 - smoothstep(0.8, 0.84, segment));
    float rim = band(r, 0.68, 0.8, aa);
    float outerEdge = ringLine(r, 0.8, 0.004, aa);
    float innerEdge = ringLine(r, 0.68, 0.002, aa);
    float innerRing = ringLine(r, 0.5, 0.006, aa);
    float ticks = step(fract((angle + uSpin * 0.6) / TAU * 48.0), 0.3) * band(r, 0.54, 0.6, aa);
    float hub = ringLine(r, 0.17, 0.008, aa);
    float hubFill = 1.0 - smoothstep(0.14, 0.17, r);
    float body = band(r, 0.2, 0.66, aa);
    float halo = exp(-max(r - 0.8, 0.0) * 22.0) * step(0.8, r);

    vec3 hot = mix(uColor, vec3(1.0), 0.55);
    vec3 col = hot * (outerEdge * 1.4 + innerEdge * 0.7 + innerRing * 0.9)
      + uColor * (rim * (0.1 + 0.6 * lit) + ticks * 0.35 + hub * 0.8 + hubFill * 0.08 + body * 0.03 + halo * 0.15);
    col += vec3(1.0) * uFlash * (outerEdge + innerRing + hub) * 1.0;
    col = col * reveal + hot * spark * 1.8;
    gl_FragColor = vec4(col * uAlpha * (1.0 - smoothstep(0.95, 1.0, r)), 1.0);
  }
`;

const trailVertex = /* glsl */`
  attribute vec2 aTrail;   // across (-1..1), along (0 at the disc .. 1 at the tail)
  varying vec2 vTrail;
  void main() {
    vTrail = aTrail;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const trailFragment = /* glsl */`
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec2 vTrail;
  void main() {
    float across = vTrail.x;
    float fade = pow(1.0 - clamp(vTrail.y, 0.0, 1.0), 1.5);
    float core = exp(-across * across * 30.0);
    float body = exp(-across * across * 3.0);
    vec3 hot = mix(uColor, vec3(1.0), 0.7);
    gl_FragColor = vec4((hot * core * 1.1 + uColor * body * 0.18) * fade * uAlpha, 1.0);
  }
`;

// `log(name)` records an action for the stats.
export function createDiscs({ view, teams, walls, batons, stage, voxels, flashes, log }) {
  const group = new THREE.Group();
  const plane = new THREE.PlaneGeometry(2, 2);
  const slots = [];
  for (let index = 0; index < POOL; index++) {
    const uniforms = {
      uColor: { value: teams.left.color },
      uSpin: { value: 0 },
      uProgress: { value: 0 },
      uAlpha: { value: 1 },
      uFlash: { value: 0 },
    };
    const disc = new THREE.Mesh(plane, additiveMaterial(discVertex, discFragment, uniforms));
    disc.frustumCulled = false;
    disc.renderOrder = 2;

    const points = DISC.trailPoints;
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute('position',
      new THREE.BufferAttribute(new Float32Array(points * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    trailGeometry.setAttribute('aTrail',
      new THREE.BufferAttribute(new Float32Array(points * 2 * 2), 2).setUsage(THREE.DynamicDrawUsage));
    trailGeometry.setIndex(new THREE.BufferAttribute(stripIndices(points), 1));
    const trailUniforms = { uColor: { value: teams.left.color }, uAlpha: { value: 1 } };
    const trail = new THREE.Mesh(trailGeometry, additiveMaterial(trailVertex, trailFragment, trailUniforms));
    trail.frustumCulled = false;
    trail.renderOrder = 1;
    group.add(trail, disc);
    slots.push({ disc, uniforms, trail, trailGeometry, trailUniforms });
  }

  const discs = [];
  const counts = { summoned: 0, thrown: 0, bounces: 0, wallHits: 0, clashes: 0, deflects: 0, caught: 0, shattered: 0 };
  const logFor = (name, disc) => log(`${name} ${disc.owner[0].toUpperCase()}`);
  const colorOf = (disc) => teams[disc.owner].color;
  const thrown = (disc) => disc.state === 'flying' || disc.state === 'returning';
  let now = 0;

  const radiusFor = (size) => clamp(size * DISC.radiusPerPalm, DISC.minRadius, DISC.maxRadius);

  // hand: { palm: {x, y}, size, roll } in view units
  function summon(owner, hand) {
    const disc = {
      owner,
      state: 'summoning',
      stateTime: 0,
      x: hand.palm.x, y: hand.palm.y, vx: 0, vy: 0,
      radius: radiusFor(hand.size),
      spin: 0,
      squash: DISC.heldSquash,
      angle: 0,
      progress: 0,
      flash: 0,
      alpha: 1,
      flightTime: 0,
      bounces: 0,
      lastHitAt: -Infinity,
      batonHitAt: -Infinity,
      lostFor: 0,
      trail: [],
    };
    discs.push(disc);
    counts.summoned++;
    logFor('summon', disc);
    flashes.spawn({ x: disc.x, y: disc.y, size: disc.radius * 1.6, duration: 0.55, color: colorOf(disc), glint: 0.6 });
    return disc;
  }

  // vx, vy: the hand's velocity in view units/s
  function throwDisc(disc, vx, vy) {
    const handSpeed = Math.hypot(vx, vy) || 1;
    const speed = clamp(handSpeed * DISC.throwGain, DISC.minThrowSpeed, DISC.maxThrowSpeed);
    disc.vx = (vx / handSpeed) * speed;
    disc.vy = (vy / handSpeed) * speed;
    disc.state = 'flying';
    disc.stateTime = 0;
    disc.flightTime = 0;
    disc.bounces = 0;
    disc.lastHitAt = now;
    disc.progress = 1;
    counts.thrown++;
    logFor('throw', disc);
  }

  function shatter(disc) {
    if (disc.state === 'gone') return;
    const cos = Math.cos(disc.angle);
    const sin = Math.sin(disc.angle);
    const size = Math.max(0.007, disc.radius * 0.11);
    for (const fraction of [1, 0.625, 0.21]) {
      const radius = disc.radius * fraction;
      const count = Math.ceil((2 * Math.PI * radius) / (size * 1.3));
      for (let k = 0; k < count; k++) {
        const around = (k / count) * Math.PI * 2 + Math.random() * 0.1;
        const localX = Math.cos(around) * radius;
        const localY = Math.sin(around) * radius * disc.squash;
        const offsetX = localX * cos - localY * sin;
        const offsetY = localX * sin + localY * cos;
        const outward = (0.18 + Math.random() * 0.25) / Math.max(radius, 1e-3);
        voxels.spawn({
          x: disc.x + offsetX,
          y: disc.y + offsetY,
          vx: offsetX * outward + disc.vx * 0.3 + (Math.random() - 0.5) * 0.08,
          vy: offsetY * outward + disc.vy * 0.3 + (Math.random() - 0.5) * 0.08,
          size: size * (0.7 + Math.random() * 0.6),
          life: 0.8 + Math.random() * 0.7,
          heat: 0.5,
          color: colorOf(disc),
          delay: Math.random() * 0.06,
        });
      }
    }
    flashes.spawn({ x: disc.x, y: disc.y, size: disc.radius * 2, duration: 0.5, color: colorOf(disc), glint: 0.5 });
    disc.state = 'gone';
    counts.shattered++;
    logFor('shatter', disc);
  }

  function startFading(disc) {
    if (disc.state === 'fading' || disc.state === 'gone') return;
    disc.state = 'fading';
    disc.stateTime = 0;
  }

  function followHand(disc, hand, dt) {
    if (!hand.visible) {
      disc.lostFor += dt;
      if (disc.lostFor > DISC.lostHandGrace) startFading(disc);
      return;
    }
    disc.lostFor = 0;
    disc.x = easeTowards(disc.x, hand.palm.x, dt, 0.035);
    disc.y = easeTowards(disc.y, hand.palm.y, dt, 0.035);
    disc.vx = disc.vy = 0;
    disc.radius = easeTowards(disc.radius, radiusFor(hand.size), dt, 0.25);
    if (disc.state === 'summoning') {
      disc.progress = Math.min(1, disc.progress + dt / DISC.summonTime);
      if (disc.progress >= 1) {
        disc.state = 'held';
        disc.stateTime = 0;
        disc.flash = 1;
      }
    }
    disc.spin += (disc.state === 'summoning' ? DISC.summonSpin : DISC.heldSpin) * dt;
    disc.squash = easeTowards(disc.squash, DISC.heldSquash + 0.03 * Math.sin(now * 1.3), dt, 0.15);
    disc.angle = easeTowards(disc.angle, clamp(hand.roll * 0.4, -0.5, 0.5), dt, 0.15);
  }

  function fly(disc, hand, dt, wallSegments) {
    disc.flightTime += dt;
    const settled = disc.flightTime > DISC.minFreeFlight && now - disc.lastHitAt > DISC.settleTime;
    if (disc.state === 'flying' && (settled || disc.flightTime > DISC.maxFreeFlight)) {
      disc.state = 'returning';
      disc.stateTime = 0;
    }
    if (disc.state === 'returning') {
      if (hand.visible) {
        disc.lostFor = 0;
        const toHandX = hand.palm.x - disc.x;
        const toHandY = hand.palm.y - disc.y;
        const distance = Math.hypot(toHandX, toHandY);
        if (hand.open && distance < DISC.catchDistance) {
          catchDisc(disc);
          return;
        }
        let targetX = hand.palm.x;
        let targetY = hand.palm.y;
        if (!hand.open && distance < DISC.orbitRadius * 2) {
          targetX += Math.cos(now * 3.5) * DISC.orbitRadius;
          targetY += Math.sin(now * 3.5) * DISC.orbitRadius;
        }
        const towardX = targetX - disc.x;
        const towardY = targetY - disc.y;
        const towardLength = Math.hypot(towardX, towardY) || 1;
        const speed = DISC.homingSpeed * clamp(towardLength / 0.3, 0.45, 1);
        const rate = DISC.homingTurn[0] + (DISC.homingTurn[1] - DISC.homingTurn[0]) * Math.min(1, disc.stateTime);
        disc.vx = easeTowards(disc.vx, (towardX / towardLength) * speed, dt, 1 / rate);
        disc.vy = easeTowards(disc.vy, (towardY / towardLength) * speed, dt, 1 / rate);
      } else {
        disc.lostFor += dt;
        if (disc.lostFor > DISC.lostHandGrace) startFading(disc);
      }
    }
    if (disc.flightTime > DISC.maxFlight) startFading(disc);
    const fromX = disc.x;
    const fromY = disc.y;
    disc.x += disc.vx * dt;
    disc.y += disc.vy * dt;
    // a returning disc flies over the walls on its way home
    if (disc.state === 'flying') bounceOffWalls(disc, fromX, fromY, wallSegments);
    bounceOffBatons(disc, fromX, fromY);
    ricochet(disc);
    disc.spin += DISC.flightSpin * dt;
    disc.squash = easeTowards(disc.squash, DISC.flightSquash, dt, 0.08);
    disc.angle = easeTowards(disc.angle, clamp(-disc.vx * 0.15, -0.45, 0.45), dt, 0.1);
  }

  function ricochet(disc) {
    const halfWidth = view.aspect / 2 - disc.radius;
    const halfHeight = 0.5 - disc.radius * disc.squash;
    let hit = null;
    if (disc.x < -halfWidth && disc.vx < 0) hit = { x: -view.aspect / 2, y: disc.y, nx: 1, ny: 0 };
    else if (disc.x > halfWidth && disc.vx > 0) hit = { x: view.aspect / 2, y: disc.y, nx: -1, ny: 0 };
    else if (disc.y < -halfHeight && disc.vy < 0) hit = { x: disc.x, y: -0.5, nx: 0, ny: 1 };
    else if (disc.y > halfHeight && disc.vy > 0) hit = { x: disc.x, y: 0.5, nx: 0, ny: -1 };
    if (!hit) return;
    if (hit.nx) disc.vx = -disc.vx * DISC.bounceDamping;
    else disc.vy = -disc.vy * DISC.bounceDamping;
    disc.x = clamp(disc.x, -halfWidth, halfWidth);
    disc.y = clamp(disc.y, -halfHeight, halfHeight);
    disc.bounces++;
    disc.lastHitAt = now;
    counts.bounces++;
    logFor('bounce', disc);
    flashes.spawn({ x: hit.x, y: hit.y, size: 0.14, duration: 0.45, color: colorOf(disc) });
    sparks(hit.x + hit.nx * 0.01, hit.y + hit.ny * 0.01, hit.nx, hit.ny, colorOf(disc), 14);
  }

  // small voxels spraying away from a surface (normal nx, ny) and along it
  function sparks(x, y, nx, ny, color, count, speed = 1, heat = 0.8) {
    for (let k = 0; k < count; k++) {
      const along = (Math.random() - 0.5) * 1.2 * speed;
      const away = (0.15 + Math.random() * 0.45) * speed;
      voxels.spawn({
        x, y,
        vx: nx * away - ny * along, vy: ny * away + nx * along,
        size: 0.006 + Math.random() * 0.006,
        life: 0.5 + Math.random() * 0.5,
        heat,
        color,
      });
    }
  }

  // Swept test against every segment of wall: the wall is a band around its
  // middle line (half the extrusion up from the base), as thick as the
  // extrusion looks across that segment, and the disc collides when its
  // centre crosses into that band widened by the disc's own reach. The
  // earliest crossing this frame wins; the velocity is reflected off the
  // segment, so curved walls bounce as they should.
  function bounceOffWalls(disc, fromX, fromY, segments) {
    const extrude = walls.extrude;
    const rx = disc.radius * DISC.hitReach;
    const ry = disc.radius * disc.squash * DISC.hitReach;
    const moveX = disc.x - fromX;
    const moveY = disc.y - fromY;
    let best = null;
    for (const segment of segments) {
      const ax = segment.x0 + extrude.x / 2;
      const ay = segment.y0 + extrude.y / 2;
      const dx = segment.x1 - segment.x0;
      const dy = segment.y1 - segment.y0;
      const length = Math.hypot(dx, dy);
      const tx = dx / length;
      const ty = dy / length;
      const nx = -ty;
      const ny = tx;
      const half = Math.abs(tx * extrude.y - ty * extrude.x) / 2;
      const discReach = Math.hypot(rx * nx, ry * ny);
      const reach = half + discReach;
      const before = (fromX - ax) * nx + (fromY - ay) * ny;
      const after = before + moveX * nx + moveY * ny;
      let t;
      if (before >= reach && after < reach) t = (before - reach) / (before - after);
      else if (before <= -reach && after > -reach) t = (-reach - before) / (after - before);
      else continue;
      if (best && t >= best.t) continue;
      const along = (fromX + moveX * t - ax) * tx + (fromY + moveY * t - ay) * ty;
      const slack = discReach * 0.5;
      if (along < -slack || along > length + slack) continue;
      best = { t, segment, side: Math.sign(before), nx, ny, tx, ty, ax, ay, half, along };
    }
    if (!best) return;
    const { t, segment, side, nx, ny, tx, ty, ax, ay, half, along } = best;
    disc.x = fromX + moveX * t;
    disc.y = fromY + moveY * t;
    const normalSpeed = disc.vx * nx + disc.vy * ny;
    disc.vx -= (1 + DISC.bounceDamping) * normalSpeed * nx;
    disc.vy -= (1 + DISC.bounceDamping) * normalSpeed * ny;
    disc.bounces++;
    disc.lastHitAt = now;
    counts.bounces++;
    counts.wallHits++;
    logFor('wall hit', disc);
    const onWall = Math.min(Math.max(along, 0), Math.hypot(segment.x1 - segment.x0, segment.y1 - segment.y0));
    const contact = { x: ax + tx * onWall + nx * side * half, y: ay + ty * onWall + ny * side * half };
    const wallColor = teams.colors[segment.team];
    flashes.spawn({ x: contact.x, y: contact.y, size: 0.11, duration: 0.4, color: colorOf(disc), glint: 1 });
    sparks(contact.x, contact.y, nx * side, ny * side, colorOf(disc), 10);
    sparks(contact.x, contact.y, nx * side, ny * side, wallColor, 8, 0.7);
    walls.pulse(segment.trail, segment.along0 + onWall, now);
  }

  // A light baton bats a flying disc away (one on its way home passes): the
  // disc's velocity relative to the rod is reflected off the rod, with a
  // little loss, so a swing adds to it. It counts if the disc touches the
  // rod, flew across it, or the rod swept over the disc this frame.
  function bounceOffBatons(disc, fromX, fromY) {
    if (disc.state !== 'flying' || now - disc.batonHitAt < DISC.batonCooldown) return;
    for (const baton of batons.sweeps()) {
      const { a, b } = baton.current;
      const point = { x: disc.x, y: disc.y };
      const reach = disc.radius * DISC.batonReach + BATON.radius;
      const touching = distanceToSegment(point, a, b) < reach;
      const crossed = segmentsCross({ x: fromX, y: fromY }, point, a, b);
      if (!touching && !crossed && !sweptContains(baton, point, reach)) continue;
      const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      let normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
      const relativeX = disc.vx - baton.velocity.x;
      const relativeY = disc.vy - baton.velocity.y;
      let closing = relativeX * normal.x + relativeY * normal.y;
      // the normal points to the side the disc ends up on
      if (closing > 0) {
        normal = { x: -normal.x, y: -normal.y };
        closing = -closing;
      }
      disc.vx -= (1 + DISC.batonRestitution) * closing * normal.x;
      disc.vy -= (1 + DISC.batonRestitution) * closing * normal.y;
      const speed = Math.hypot(disc.vx, disc.vy) || 1;
      const limited = clamp(speed, DISC.minThrowSpeed, DISC.maxThrowSpeed * 1.2);
      disc.vx *= limited / speed;
      disc.vy *= limited / speed;
      // out of the rod, on the side it now flies to
      const t = clamp(((disc.x - a.x) * (b.x - a.x) + (disc.y - a.y) * (b.y - a.y)) / (length * length), 0, 1);
      const contact = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      disc.x = contact.x + normal.x * reach * 1.05;
      disc.y = contact.y + normal.y * reach * 1.05;
      disc.batonHitAt = now;
      disc.lastHitAt = now;
      disc.flash = 0.6;
      counts.deflects++;
      logFor('deflect', disc);
      flashes.spawn({ x: contact.x, y: contact.y, size: 0.1, duration: 0.4, color: baton.color, glint: 1.2 });
      sparks(contact.x, contact.y, normal.x, normal.y, colorOf(disc), 10, 1.2);
      sparks(contact.x, contact.y, -normal.x, -normal.y, baton.color, 6, 0.8);
      return;
    }
  }

  // Thrown discs that meet bounce off each other: an elastic collision of
  // two equal circles, then a two-colour burst where they touched. Discs on
  // their way home pass each other, so they always make it back.
  function collideDiscs() {
    const flying = discs.filter((disc) => disc.state === 'flying');
    for (let i = 0; i < flying.length; i++) {
      for (let j = i + 1; j < flying.length; j++) {
        const a = flying[i];
        const b = flying[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy) || 1e-6;
        const contactDistance = (a.radius + b.radius) * 0.75;
        if (distance > contactDistance) continue;
        const nx = dx / distance;
        const ny = dy / distance;
        const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (closing <= 0) continue;
        a.vx -= closing * nx;
        a.vy -= closing * ny;
        b.vx += closing * nx;
        b.vy += closing * ny;
        const overlap = (contactDistance - distance) / 2;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;
        for (const disc of [a, b]) {
          disc.lastHitAt = now;
          disc.flash = 0.35;
        }
        counts.clashes++;
        log('disc clash');
        const x = a.x + nx * a.radius * 0.75;
        const y = a.y + ny * a.radius * 0.75;
        flashes.spawn({ x, y, size: 0.16, duration: 0.5, color: colorOf(a), glint: 1.0, intensity: 0.35 });
        flashes.spawn({ x, y, size: 0.26, duration: 0.65, color: colorOf(b), glint: 0, intensity: 0.4 });
        stage.shock(x, y, colorOf(a), 0.8, 0.45);
        stage.shock(x, y, colorOf(b), 0.55, 0.35);
        // the sparks fly out sideways from the impact, each disc's colour on its own side
        sparks(x, y, -ny, nx, colorOf(a), 16, 1.6, 0.3);
        sparks(x, y, ny, -nx, colorOf(b), 16, 1.6, 0.3);
        sparks(x, y, -nx, -ny, colorOf(a), 8, 1.2, 0.3);
        sparks(x, y, nx, ny, colorOf(b), 8, 1.2, 0.3);
      }
    }
  }

  function catchDisc(disc) {
    disc.state = 'held';
    disc.stateTime = 0;
    disc.flash = 1;
    disc.vx = disc.vy = 0;
    counts.caught++;
    logFor('catch', disc);
    flashes.spawn({ x: disc.x, y: disc.y, size: disc.radius * 1.6, duration: 0.45, color: colorOf(disc), glint: 0.5 });
  }

  function updateTrail(disc) {
    if (thrown(disc)) disc.trail.unshift({ x: disc.x, y: disc.y, t: now });
    while (disc.trail.length && (now - disc.trail[disc.trail.length - 1].t > DISC.trailTime
      || disc.trail.length > DISC.trailPoints)) disc.trail.pop();
  }

  function writeTrail(slot, disc) {
    const points = disc.trail;
    const count = points.length;
    slot.trail.visible = count >= 2;
    if (count < 2) return;
    const position = slot.trailGeometry.getAttribute('position');
    const data = slot.trailGeometry.getAttribute('aTrail');
    for (let index = 0; index < count; index++) {
      const previous = points[Math.max(0, index - 1)];
      const next = points[Math.min(count - 1, index + 1)];
      let tangentX = previous.x - next.x;
      let tangentY = previous.y - next.y;
      const length = Math.hypot(tangentX, tangentY) || 1;
      tangentX /= length;
      tangentY /= length;
      const along = clamp((now - points[index].t) / DISC.trailTime, 0, 1);
      const halfWidth = disc.radius * 0.35 * (1 - 0.6 * along);
      for (const side of [-1, 1]) {
        const vertex = index * 2 + (side > 0 ? 1 : 0);
        position.array[vertex * 3] = points[index].x - tangentY * halfWidth * side;
        position.array[vertex * 3 + 1] = points[index].y + tangentX * halfWidth * side;
        position.array[vertex * 3 + 2] = 0;
        data.array[vertex * 2] = side;
        data.array[vertex * 2 + 1] = along;
      }
    }
    uploadPrefix(position, count * 2);
    uploadPrefix(data, count * 2);
    slot.trailGeometry.setDrawRange(0, (count - 1) * 6);
    slot.trailUniforms.uAlpha.value = disc.alpha;
  }

  return {
    group,
    counts,
    list: discs,
    summon,
    throwDisc,
    shatter,
    // a derezz wave: every disc within `radius` of `origin` shatters
    shatterWithin(origin, radius) {
      for (const disc of discs) {
        if (disc.state === 'gone' || disc.state === 'fading') continue;
        if (Math.hypot(disc.x - origin.x, disc.y - origin.y) < radius + disc.radius * 0.5) shatter(disc);
      }
    },
    // put away: a held disc fades out of the hand (a baton takes its place)
    dismiss(disc) {
      if (disc.state !== 'held') return;
      flashes.spawn({ x: disc.x, y: disc.y, size: disc.radius * 1.4, duration: 0.35, color: colorOf(disc), glint: 0.3 });
      startFading(disc);
    },
    // the disc a hand owns, wherever it is (not one that is already fading)
    ownedBy(owner) {
      return discs.find((disc) => disc.owner === owner && disc.state !== 'fading' && disc.state !== 'gone');
    },
    // hands: { left, right } each { visible, palm, open, size, roll } in view units
    update(time, dt, hands) {
      now = time;
      const wallSegments = discs.some((disc) => disc.state === 'flying') ? walls.segments(now) : [];
      for (const disc of discs) {
        disc.stateTime += dt;
        disc.flash = Math.max(0, disc.flash - dt * 2.5);
        const hand = hands[disc.owner];
        if (disc.state === 'summoning' || disc.state === 'held') followHand(disc, hand, dt);
        else if (thrown(disc)) fly(disc, hand, dt, wallSegments);
        else if (disc.state === 'fading') {
          disc.alpha = Math.max(0, 1 - disc.stateTime / DISC.fadeTime);
          disc.x += disc.vx * dt;
          disc.y += disc.vy * dt;
          disc.vx *= Math.exp(-dt * 3);
          disc.vy *= Math.exp(-dt * 3);
          disc.spin += DISC.heldSpin * dt;
          if (disc.alpha <= 0) disc.state = 'gone';
        }
        updateTrail(disc);
      }
      collideDiscs();
      for (let index = discs.length - 1; index >= 0; index--) {
        if (discs[index].state === 'gone') discs.splice(index, 1);
      }
      slots.forEach((slot, index) => {
        const disc = discs[index];
        slot.disc.visible = Boolean(disc);
        slot.trail.visible = false;
        if (!disc) return;
        const scale = disc.radius / RIM;
        const pop = disc.state === 'summoning' ? 0.7 + 0.3 * Math.sin(Math.min(1, disc.progress * 1.4) * Math.PI / 2) : 1;
        slot.disc.position.set(disc.x, disc.y, 0);
        slot.disc.rotation.z = disc.angle;
        slot.disc.scale.set(scale * pop, scale * pop * disc.squash, 1);
        slot.uniforms.uSpin.value = disc.spin;
        slot.uniforms.uProgress.value = disc.progress;
        slot.uniforms.uAlpha.value = disc.alpha;
        slot.uniforms.uFlash.value = disc.flash;
        slot.uniforms.uColor.value = colorOf(disc);
        slot.trailUniforms.uColor.value = colorOf(disc);
        writeTrail(slot, disc);
      });
    },
  };
}

function stripIndices(points) {
  const indices = new Uint32Array((points - 1) * 6);
  for (let index = 0; index < points - 1; index++) {
    const a = index * 2;
    indices.set([a, a + 1, a + 3, a, a + 3, a + 2], index * 6);
  }
  return indices;
}

// Do segments p0-p1 and a-b cross?
function segmentsCross(p0, p1, a, b) {
  const side = (o, u, v) => (u.x - o.x) * (v.y - o.y) - (u.y - o.y) * (v.x - o.x);
  const d1 = side(a, b, p0);
  const d2 = side(a, b, p1);
  const d3 = side(p0, p1, a);
  const d4 = side(p0, p1, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
