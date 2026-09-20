// The intro's backdrop: black, a horizon of light and a perspective Grid
// floor that draws itself out of the horizon, with the odd light cycle
// streaking across it. Drawn on a 2D canvas in CSS pixels; the soft glows
// and the vignette don't change from frame to frame, so they are rendered
// once per size into offscreen canvases.
import { BLUE, CYAN, WHITE } from './intro-glyphs.js';

const FLOOR = {
  cellFraction: 1 / 11,   // tile width at the bottom edge, as a fraction of the screen width
  minCell: 54,            // px
  farDepth: 70,           // depth (camera heights) where the floor ends
  trail: 2.6,             // depth units behind a light cycle head
  maxPixelRatio: 2,
};

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const smooth = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const easeOut = (value) => 1 - (1 - clamp01(value)) ** 3;
const easeIn = (value) => clamp01(value) ** 2;

export function createFloor(canvas) {
  const context = canvas.getContext('2d');
  let width = 1;
  let height = 1;
  let ratio = 1;
  let layers = null;   // cached glow and vignette for one size and horizon

  function resize() {
    ratio = Math.min(window.devicePixelRatio || 1, FLOOR.maxPixelRatio);
    width = Math.max(1, canvas.clientWidth);
    height = Math.max(1, canvas.clientHeight);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    layers = null;
  }

  function offscreen(paint) {
    const layer = document.createElement('canvas');
    layer.width = canvas.width;
    layer.height = canvas.height;
    const layerContext = layer.getContext('2d');
    layerContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    paint(layerContext);
    return layer;
  }

  function buildLayers(horizon) {
    const cx = width / 2;
    const glow = offscreen((c) => {
      const sky = c.createLinearGradient(0, horizon - height * 0.55, 0, horizon);
      sky.addColorStop(0, `rgba(${BLUE}, 0)`);
      sky.addColorStop(1, `rgba(${BLUE}, 0.09)`);
      c.fillStyle = sky;
      c.fillRect(0, horizon - height * 0.55, width, height * 0.55);
      const floor = c.createLinearGradient(0, horizon, 0, height);
      floor.addColorStop(0, `rgba(${BLUE}, 0.07)`);
      floor.addColorStop(0.5, `rgba(${BLUE}, 0)`);
      c.fillStyle = floor;
      c.fillRect(0, horizon, width, height - horizon);
      // a wide, flat glow where the floor meets the sky
      c.globalCompositeOperation = 'lighter';
      c.translate(cx, horizon);
      c.scale(1, 0.12);
      const flat = c.createRadialGradient(0, 0, 0, 0, 0, width * 0.6);
      flat.addColorStop(0, `rgba(${CYAN}, 0.22)`);
      flat.addColorStop(1, `rgba(${CYAN}, 0)`);
      c.fillStyle = flat;
      c.fillRect(-width * 0.6, -width * 0.6, width * 1.2, width * 1.2);
    });
    // darkens the lines towards the corners
    const vignette = offscreen((c) => {
      const shade = c.createRadialGradient(cx, horizon, height * 0.2, cx, horizon, Math.hypot(width, height) * 0.62);
      shade.addColorStop(0, 'rgba(0, 0, 0, 0)');
      shade.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
      c.fillStyle = shade;
      c.fillRect(0, 0, width, height);
    });
    return { horizon, glow, vignette };
  }

  // Floor projection: camera one unit above the floor, looking at the horizon.
  // Depth 1 lands on the bottom edge of the screen.
  function geometry(horizon) {
    const depthPx = Math.max(60, height - horizon);
    const cell = Math.max(FLOOR.minCell, Math.min(width, 1700) * FLOOR.cellFraction);
    return {
      cx: width / 2,
      horizon,
      depthPx,
      cell,
      worldCell: cell / depthPx,
      project: (x, depth) => ({ x: width / 2 + (x * depthPx) / depth, y: horizon + depthPx / depth }),
    };
  }

  function drawGrid(g, state) {
    const { t, timing, brightness } = state;
    const { cx, horizon, depthPx, cell, worldCell, project } = g;
    if (t < timing.floor) return;

    // lines running away from the viewer, all meeting at the vanishing point
    const reach = Math.ceil(width / 2 / cell) * 5;
    const fade = context.createLinearGradient(0, horizon, 0, height);
    fade.addColorStop(0, `rgba(${CYAN}, 0)`);
    fade.addColorStop(0.18, `rgba(${CYAN}, ${0.16 * brightness})`);
    fade.addColorStop(1, `rgba(${CYAN}, ${0.62 * brightness})`);
    const glowFade = context.createLinearGradient(0, horizon, 0, height);
    glowFade.addColorStop(0, `rgba(${BLUE}, 0)`);
    glowFade.addColorStop(1, `rgba(${BLUE}, ${0.16 * brightness})`);
    const lanes = new Path2D();
    for (let k = -reach; k <= reach; k++) {
      const grow = easeOut((t - timing.floor - 0.03 * Math.min(Math.abs(k), 12)) / 0.75);
      if (grow <= 0) continue;
      const near = project(k * worldCell, 0.5);
      lanes.moveTo(cx, horizon);
      lanes.lineTo(cx + (near.x - cx) * grow, horizon + (near.y - horizon) * grow);
    }
    context.lineWidth = 3;
    context.strokeStyle = glowFade;
    context.stroke(lanes);
    context.lineWidth = 1;
    context.strokeStyle = fade;
    context.stroke(lanes);

    // cross lines, scrolling towards the viewer
    const offset = state.scroll % worldCell;
    for (let n = 1; ; n++) {
      const depth = n * worldCell - offset + 0.5;
      if (depth > FLOOR.farDepth) break;
      const y = horizon + depthPx / depth;
      if (y > height + 2) continue;
      if (y - horizon < 1.5) break;
      const along = (y - horizon) / depthPx;   // 0 at the horizon, 1 at the bottom
      const appear = smooth((t - timing.floor - 0.25 - (1 - along) * 0.2 - along * 0.75) / 0.3);
      if (appear <= 0) continue;
      // far lines crowd together; let them fade out before they merge into a band
      const spacing = (depthPx * worldCell) / (depth * depth);
      const alpha = appear * brightness * (0.06 + 0.56 * smooth(along / 0.7)) * smooth((spacing - 2) / 7);
      if (alpha < 0.004) continue;
      context.fillStyle = `rgba(${BLUE}, ${alpha * 0.22})`;
      context.fillRect(0, y - 1.5, width, 3);
      context.fillStyle = `rgba(${CYAN}, ${alpha})`;
      context.fillRect(0, y - 0.5, width, 1);
    }
  }

  function drawHorizon(g, state) {
    const { t, timing } = state;
    const { cx, horizon } = g;
    // on the camera screen: a faint, unlit line that goes dark as the boot starts
    if (state.dormant > 0) {
      const unlit = context.createLinearGradient(0, 0, width, 0);
      unlit.addColorStop(0, `rgba(${CYAN}, 0)`);
      unlit.addColorStop(0.5, `rgba(${CYAN}, ${0.3 * state.dormant})`);
      unlit.addColorStop(1, `rgba(${CYAN}, 0)`);
      context.fillStyle = unlit;
      context.fillRect(0, horizon - 0.5, width, 1);
    }
    if (t < timing.horizon - 0.2) return;

    // a point of light flickers on, then stretches into the horizon
    const spread = easeOut((t - timing.horizon) / 0.65);
    const flash = Math.max(0, 1 - Math.abs(t - timing.horizon - 0.05) / 0.5) + state.flare;
    const half = Math.max(2, spread * width * 0.56);
    // the glow is an ellipse, so it tapers off with the line instead of ending square
    const band = 26 + 40 * flash;
    context.save();
    context.translate(cx, horizon);
    context.scale(half / band, 1);
    const glow = context.createRadialGradient(0, 0, 0, 0, 0, band);
    glow.addColorStop(0, `rgba(${BLUE}, ${0.24 + 0.35 * flash})`);
    glow.addColorStop(0.6, `rgba(${BLUE}, ${0.08 + 0.12 * flash})`);
    glow.addColorStop(1, `rgba(${BLUE}, 0)`);
    context.fillStyle = glow;
    context.fillRect(-band, -band, band * 2, band * 2);
    context.restore();
    const core = context.createLinearGradient(cx - half, 0, cx + half, 0);
    core.addColorStop(0, `rgba(${CYAN}, 0)`);
    core.addColorStop(0.18, `rgba(${CYAN}, 0.75)`);
    core.addColorStop(0.5, `rgba(${WHITE}, 1)`);
    core.addColorStop(0.82, `rgba(${CYAN}, 0.75)`);
    core.addColorStop(1, `rgba(${CYAN}, 0)`);
    context.fillStyle = core;
    context.fillRect(cx - half, horizon - 0.75, half * 2, 1.5);
    if (flash > 0.01) {
      const radius = 60 + 120 * flash;
      context.save();
      context.translate(cx, horizon);
      context.scale(1, 0.18);
      const flare = context.createRadialGradient(0, 0, 0, 0, 0, radius * 2);
      flare.addColorStop(0, `rgba(${WHITE}, ${0.65 * Math.min(1, flash)})`);
      flare.addColorStop(0.3, `rgba(${CYAN}, ${0.25 * Math.min(1, flash)})`);
      flare.addColorStop(1, `rgba(${CYAN}, 0)`);
      context.fillStyle = flare;
      context.fillRect(-radius * 2, -radius * 2, radius * 4, radius * 4);
      context.restore();
    }
  }

  // A light cycle head with its wall: along a lane (towards the viewer) or
  // across a row of the floor.
  function drawStreak(g, streak, t) {
    const progress = (t - streak.start) / streak.duration;
    if (progress <= 0 || progress >= 1.25) return;
    const fade = 1 - smooth((progress - 1) / 0.25);
    let head;
    let tail;
    if (streak.lane !== undefined) {
      const x = streak.lane * g.worldCell;
      const depth = 9 * (1 - progress) + 0.6;
      head = g.project(x, Math.max(0.6, depth));
      tail = g.project(x, Math.min(FLOOR.farDepth, depth + FLOOR.trail * (1 + 6 * (1 - progress))));
    } else {
      const y = g.horizon + g.depthPx / streak.depth;
      const span = width * 1.3;
      const headX = streak.direction > 0 ? -0.15 * width + span * progress : width * 1.15 - span * progress;
      head = { x: headX, y };
      tail = { x: headX - streak.direction * width * 0.42, y };
    }
    const wall = context.createLinearGradient(tail.x, tail.y, head.x, head.y);
    wall.addColorStop(0, `rgba(${streak.color}, 0)`);
    wall.addColorStop(0.75, `rgba(${streak.color}, ${0.7 * fade})`);
    wall.addColorStop(1, `rgba(${WHITE}, ${fade})`);
    context.strokeStyle = wall;
    context.lineCap = 'round';
    context.lineWidth = 2.2;
    context.beginPath();
    context.moveTo(tail.x, tail.y);
    context.lineTo(head.x, head.y);
    context.stroke();
    context.lineWidth = 7;
    context.globalAlpha = 0.25;
    context.stroke();
    context.globalAlpha = 1;
    const glow = context.createRadialGradient(head.x, head.y, 0, head.x, head.y, 26);
    glow.addColorStop(0, `rgba(${WHITE}, ${0.9 * fade})`);
    glow.addColorStop(0.3, `rgba(${streak.color}, ${0.45 * fade})`);
    glow.addColorStop(1, `rgba(${streak.color}, 0)`);
    context.fillStyle = glow;
    context.fillRect(head.x - 26, head.y - 26, 52, 52);
  }

  // Exit burst: a pulse of light races down every lane towards the viewer.
  function drawBurst(g, amount, phase) {
    if (amount <= 0) return;
    const reach = Math.ceil(width / 2 / g.cell) * 3;
    const depth = 40 * (1 - easeIn(phase)) + 0.5;
    const pulses = new Path2D();
    for (let k = -reach; k <= reach; k++) {
      const head = g.project(k * g.worldCell, depth);
      const tail = g.project(k * g.worldCell, depth * 1.9 + 1);
      pulses.moveTo(tail.x, tail.y);
      pulses.lineTo(head.x, head.y);
    }
    context.lineWidth = 1.6;
    context.strokeStyle = `rgba(${WHITE}, ${0.8 * amount})`;
    context.stroke(pulses);
  }

  // state: { t, timing, horizon, backdrop, brightness, scroll, flare, streaks,
  //          burst: { amount, phase }, slit: { top, bottom } | null, dormant }
  function draw(state) {
    if (!layers || Math.abs(layers.horizon - state.horizon) > 0.5) layers = buildLayers(state.horizon);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    if (state.slit) {
      const clip = new Path2D();
      clip.rect(0, 0, canvas.width, Math.max(0, state.slit.top * ratio));
      clip.rect(0, state.slit.bottom * ratio, canvas.width, Math.max(0, canvas.height - state.slit.bottom * ratio));
      context.clip(clip);
    }
    context.fillStyle = `rgba(0, 0, 0, ${state.backdrop})`;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = 'lighter';
    // the glow brightens past full strength while leaving: draw it again on top
    for (let glow = smooth((state.t - state.timing.horizon) / 1.2) * state.brightness; glow > 0.004; glow -= 1) {
      context.globalAlpha = Math.min(1, glow);
      context.drawImage(layers.glow, 0, 0);
    }
    context.globalAlpha = 1;

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const g = geometry(state.horizon);
    context.save();
    context.beginPath();
    context.rect(0, g.horizon, width, height - g.horizon);
    context.clip();
    drawGrid(g, state);
    for (const streak of state.streaks) drawStreak(g, streak, state.t);
    drawBurst(g, state.burst.amount, state.burst.phase);
    context.restore();
    drawHorizon(g, state);

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = state.backdrop;
    context.drawImage(layers.vignette, 0, 0);
    context.restore();
  }

  return { resize, draw };
}
