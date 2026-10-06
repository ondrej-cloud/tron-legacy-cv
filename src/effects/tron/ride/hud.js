// The ride's HUD, in the style of the AR one (thin crisp lines, monospace
// labels with a glow, scanlines): the score (TRON vs CLU) and the round at
// the top, a radar top left, a marker on CLU or an arrow at the screen's
// edge pointing to it, the speed and a steering indicator at the bottom,
// the handlebar hint while nobody holds on, the 3-2-1 countdown, the crash
// banners, the replay's frame, the result screen, and the frame of the
// camera picture in the corner (the webcam itself shows through there,
// pip.js) with the hands' skeletons and the handlebar reading drawn over it.
import { HAND_CONNECTIONS } from '../../../hands.js';

const FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const TITLE_FONT = '"Helvetica Neue", "Avenir Next", "Segoe UI", Arial, sans-serif';
const WHITE = '226, 250, 255';
const RADAR = { radius: 84, margin: 26 };
const TRACKER = { margin: 52 };   // px from the screen's edges to the off-screen arrow

export function createRideHud(container) {
  const canvas = document.createElement('canvas');
  canvas.style.pointerEvents = 'none';
  container.appendChild(canvas);
  const context = canvas.getContext('2d');
  const scanlines = makeScanlines(context);
  let width = 1;
  let height = 1;
  let pixelRatio = 1;

  function resize(cssWidth, cssHeight) {
    width = cssWidth;
    height = cssHeight;
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
  }

  function text(value, x, y, color, alpha, size, { weight = 400, align = 'left', spacing = 0.14, font = FONT, blur = 8 } = {}) {
    context.font = `${weight} ${size}px ${font}`;
    context.textAlign = align;
    context.letterSpacing = `${spacing}em`;
    context.shadowColor = `rgba(${color}, ${0.85 * alpha})`;
    context.shadowBlur = blur;
    context.fillStyle = `rgba(${color}, ${alpha})`;
    context.fillText(value, x, y);
    context.shadowBlur = 0;
    context.letterSpacing = '0px';
  }

  // how wide `value` is set at `size` px with letter spacing `spacing` em
  function textWidth(value, size, spacing, weight = 400, font = FONT) {
    context.font = `${weight} ${size}px ${font}`;
    context.letterSpacing = `${spacing}em`;
    const measured = context.measureText(value).width;
    context.letterSpacing = '0px';
    return measured;
  }

  // the largest size up to `size` at which `value` fits in `maxWidth` px
  function fitSize(value, size, spacing, weight, maxWidth) {
    return size * Math.min(1, maxWidth / Math.max(1, textWidth(value, size, spacing, weight)));
  }

  function rule(x0, x1, y, color, alpha) {
    context.fillStyle = `rgba(${color}, ${alpha})`;
    context.fillRect(x0, y, x1 - x0, 1);
    context.fillRect(x0, y - 3, 1, 7);
    context.fillRect(x1 - 1, y - 3, 1, 7);
  }

  function roundedRect(x, y, w, h, r) {
    context.beginPath();
    context.roundRect(x, y, w, h, r);
  }

  // TRON 2 : 1 CLU, the player's side marked, the round under it
  function drawScore(info) {
    const x = width / 2;
    const y = 46;
    const [left, right] = info.teams;   // { name, rgb, score, you }
    text(String(left.score), x - 34, y, left.rgb, 1, 34, { weight: 300, align: 'right', font: TITLE_FONT, spacing: 0.05, blur: 14 });
    text(String(right.score), x + 34, y, right.rgb, 1, 34, { weight: 300, align: 'left', font: TITLE_FONT, spacing: 0.05, blur: 14 });
    text(':', x, y - 3, WHITE, 0.7, 26, { align: 'center', font: TITLE_FONT, spacing: 0 });
    text(left.name, x - 84, y - 8, left.rgb, 0.95, 15, { align: 'right', weight: 600, spacing: 0.35 });
    text(right.name, x + 84, y - 8, right.rgb, 0.95, 15, { align: 'left', weight: 600, spacing: 0.35 });
    text(left.you ? 'YOU' : 'PROGRAM', x - 84, y + 8, left.rgb, 0.55, 9, { align: 'right', spacing: 0.4 });
    text(right.you ? 'YOU' : 'PROGRAM', x + 84, y + 8, right.rgb, 0.55, 9, { align: 'left', spacing: 0.4 });
    rule(x - 190, x + 190, y + 20, WHITE, 0.35);
    text(`ROUND ${info.round}  //  FIRST TO ${info.winScore}`, x, y + 38, WHITE, 0.6, 10, { align: 'center', spacing: 0.4 });
    return [x - 220, 0, 440, y + 50];
  }

  // speed, bottom right: a number and a bar with the boost zone
  function drawSpeed(info) {
    const x = width - 40;
    const y = height - 46;
    const accent = info.accent;
    text(String(Math.round(info.speed * 3.6)), x, y, WHITE, 0.95, 40, { align: 'right', weight: 200, font: TITLE_FONT, spacing: 0.02, blur: 12 });
    text('KM/H', x, y + 18, accent, 0.7, 9, { align: 'right', spacing: 0.45 });
    const barWidth = 170;
    const barY = y - 52;
    context.fillStyle = `rgba(${WHITE}, 0.18)`;
    context.fillRect(x - barWidth, barY, barWidth, 2);
    context.fillStyle = `rgba(${accent}, 0.95)`;
    context.shadowColor = `rgba(${accent}, 0.9)`;
    context.shadowBlur = 8;
    context.fillRect(x - barWidth, barY - 1, barWidth * Math.min(1, info.speedFraction), 4);
    context.shadowBlur = 0;
    const mode = info.airborne ? 'AIRBORNE' : info.boosting ? 'BOOST' : info.braking ? 'BRAKE' : 'CRUISE';
    const lit = info.airborne || info.boosting;
    text(mode, x - barWidth, barY - 10, lit ? accent : WHITE, lit ? 0.95 : 0.55, 9, { spacing: 0.45 });
    return [x - barWidth - 20, barY - 30, barWidth + 40, 100];
  }

  // the bars' lock: an arc with a needle, bottom centre
  function drawSteering(info) {
    const x = width / 2;
    const y = height - 34;
    const radius = 56;
    const accent = info.accent;
    context.lineWidth = 1;
    context.strokeStyle = `rgba(${WHITE}, 0.3)`;
    context.beginPath();
    context.arc(x, y, radius, Math.PI * 1.2, Math.PI * 1.8);
    context.stroke();
    for (const tick of [-1, -0.5, 0, 0.5, 1]) {
      const angle = Math.PI * 1.5 + tick * Math.PI * 0.3;
      context.beginPath();
      context.moveTo(x + Math.cos(angle) * (radius - 4), y + Math.sin(angle) * (radius - 4));
      context.lineTo(x + Math.cos(angle) * (radius + 4), y + Math.sin(angle) * (radius + 4));
      context.stroke();
    }
    const angle = Math.PI * 1.5 + info.steer * Math.PI * 0.3;
    context.strokeStyle = `rgba(${accent}, 1)`;
    context.shadowColor = `rgba(${accent}, 0.9)`;
    context.shadowBlur = 8;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x + Math.cos(angle) * (radius - 14), y + Math.sin(angle) * (radius - 14));
    context.lineTo(x + Math.cos(angle) * (radius + 6), y + Math.sin(angle) * (radius + 6));
    context.stroke();
    context.shadowBlur = 0;
    context.lineWidth = 1;
    text(info.gripping ? 'HANDLEBARS' : info.keys ? 'KEYS' : 'NO GRIP', x, y - 8, info.gripping || info.keys ? accent : WHITE,
      0.75, 9, { align: 'center', spacing: 0.4 });
    return [x - radius - 20, y - radius - 20, radius * 2 + 40, radius + 40];
  }

  function drawHint(info, seconds) {
    const blink = 0.65 + 0.35 * Math.sin(seconds * 6);
    const y = 136;
    text('HOLD BOTH FISTS UP LIKE HANDLEBARS', width / 2, y, WHITE, blink, 15, { align: 'center', spacing: 0.3, weight: 500 });
    if (info.reason) text(info.reason.toUpperCase(), width / 2, y + 22, info.accent, 0.7, 10, { align: 'center', spacing: 0.4 });
    return [0, y - 24, width, 56];
  }

  // The grip tutorial (tutorial.js): two fists on a handlebar, held, tilted
  // and pushed in turn, the three steps beside them (the one shown lit), a
  // ring that fills while a steady grip is held, and what is in the way.
  function drawTutorial(info, seconds) {
    const accent = info.accent;
    const w = Math.min(700, width - 48);
    const h = 236;
    const x0 = width / 2 - w / 2;
    const y0 = height * 0.43 - h / 2;
    const alpha = info.fade * Math.min(1, info.time * 3);
    context.globalAlpha = alpha;
    context.fillStyle = 'rgba(0, 6, 10, 0.72)';
    roundedRect(x0, y0, w, h, 8);
    context.fill();
    context.strokeStyle = `rgba(${accent}, 0.55)`;
    context.lineWidth = 1;
    context.stroke();
    text('TAKE THE HANDLEBARS', width / 2, y0 + 38, WHITE, 1, 22,
      { align: 'center', weight: 300, font: TITLE_FONT, spacing: 0.3, blur: 14 });
    rule(width / 2 - 150, width / 2 + 150, y0 + 52, accent, 0.6);

    // the glyph, going through the three steps in a loop
    const cycle = 4.8;
    const local = info.time % cycle;
    const step = Math.min(2, Math.floor(local / (cycle / 3)));
    const t = (local % (cycle / 3)) / (cycle / 3);
    const tilt = step === 1 ? Math.sin(t * Math.PI * 2) * 0.38 : 0;
    const push = step === 2 ? Math.sin(t * Math.PI) : 0;
    const gx = x0 + Math.min(130, w * 0.22);
    const gy = y0 + 140;
    handlebarGlyph(gx, gy + (step === 0 ? Math.sin(info.time * 3) * 2 : 0), tilt, 1 + 0.22 * push, push, accent);
    // the ring around it: how long the grip has been steady
    const ring = 66;
    context.strokeStyle = `rgba(${WHITE}, 0.18)`;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(gx, gy, ring, 0, Math.PI * 2);
    context.stroke();
    if (info.progress > 0) {
      context.strokeStyle = `rgba(${accent}, 1)`;
      context.shadowColor = `rgba(${accent}, 1)`;
      context.shadowBlur = 12;
      context.lineWidth = info.locked === null ? 3 : 3 + 4 * Math.max(0, 1 - info.locked * 4);
      context.beginPath();
      context.arc(gx, gy, ring, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * info.progress);
      context.stroke();
      context.shadowBlur = 0;
    }
    context.lineWidth = 1;

    // the steps, as big as fits beside the glyph
    const steps = ['HOLD BOTH FISTS UP LIKE HANDLEBARS', 'TILT TO STEER', 'PUSH TOWARDS THE CAMERA TO BOOST'];
    const sx = gx + ring + 34;
    const size = Math.min(...steps.map((words) => fitSize(words, 14, 0.22, 600, x0 + w - sx - 34 - 18)));
    steps.forEach((words, index) => {
      const y = y0 + 98 + index * 40;
      const lit = index === step;
      const passed = index === 0 && info.locked !== null;
      text(`0${index + 1}`, sx, y, accent, lit || passed ? 1 : 0.45, 12, { weight: 600, spacing: 0.2 });
      text(words, sx + 34, y, passed ? accent : WHITE, lit ? 1 : 0.55, size, { spacing: 0.22, weight: lit ? 600 : 400 });
      if (lit) {
        context.fillStyle = `rgba(${accent}, 0.9)`;
        context.fillRect(sx - 12, y - 10, 2, 13);
      }
    });

    // what is in the way, or that it has locked in
    const status = info.locked !== null ? 'GRIP LOCKED' : info.hint || (info.progress > 0 ? 'HOLD STEADY' : '');
    if (status) {
      // on a dark card, so it reads over the floor's lines
      const statusWidth = textWidth(status, 13, 0.35, 600);
      context.fillStyle = 'rgba(0, 6, 10, 0.7)';
      roundedRect(width / 2 - statusWidth / 2 - 14, y0 + h + 12, statusWidth + 28, 27, 4);
      context.fill();
      const blink = info.hint ? 0.7 + 0.3 * Math.sin(seconds * 6) : 1;
      text(status, width / 2 + 2, y0 + h + 30, info.hint ? WHITE : accent, blink, 13, { align: 'center', spacing: 0.35, weight: 600 });
    }
    text('ARROW KEYS: RIDE WITHOUT THE CAMERA', width / 2, y0 + h + 52, WHITE, 0.4, 9, { align: 'center', spacing: 0.4 });
    context.globalAlpha = 1;
    return [x0 - 10, y0 - 10, w + 20, h + 74];
  }

  // two fists on a bar, the bar turned by `angle` (clockwise: a right turn),
  // `scale` bigger as they push towards the camera, with speed lines then
  function handlebarGlyph(x, y, angle, scale, rush, color) {
    context.save();
    context.translate(x, y);
    context.scale(scale, scale);
    if (rush > 0.05) {
      context.strokeStyle = `rgba(${color}, ${0.6 * rush})`;
      context.lineWidth = 1;
      for (const [sx, sy] of [[-58, -30], [58, -30], [-64, 18], [64, 18], [-48, 34], [48, 34]]) {
        context.beginPath();
        context.moveTo(sx, sy);
        context.lineTo(sx * (1 + 0.35 * rush), sy * (1 + 0.35 * rush));
        context.stroke();
      }
    }
    context.rotate(angle);
    context.strokeStyle = `rgba(${color}, 1)`;
    context.shadowColor = `rgba(${color}, 0.9)`;
    context.shadowBlur = 8;
    context.lineWidth = 2;
    // the bar, through both fists
    context.beginPath();
    context.moveTo(-48, 0);
    context.lineTo(48, 0);
    context.stroke();
    for (const side of [-1, 1]) {
      const fx = side * 26;
      context.fillStyle = 'rgba(0, 6, 10, 0.9)';
      context.beginPath();
      context.roundRect(fx - 11, -16, 22, 30, 6);
      context.fill();
      context.stroke();
      // knuckles, and the thumb across the front
      context.lineWidth = 1;
      context.beginPath();
      for (let knuckle = 0; knuckle < 3; knuckle++) {
        context.moveTo(fx - 11, -8 + knuckle * 6);
        context.lineTo(fx + 4, -8 + knuckle * 6);
      }
      context.moveTo(fx - side * 9, 9);
      context.lineTo(fx + side * 6, 4);
      context.stroke();
      context.lineWidth = 2;
    }
    context.shadowBlur = 0;
    context.restore();
  }

  // big centred words: the countdown, GO, the result
  function banner(words, sub, color, scale, alpha) {
    const size = Math.round(Math.min(150, width / 9) * scale);
    const y = height * 0.42;
    text(words, width / 2 + size * 0.1, y, WHITE, alpha, size, { align: 'center', weight: 200, font: TITLE_FONT, spacing: 0.2, blur: 22 });
    context.shadowBlur = 0;
    if (sub) text(sub, width / 2, y + 44, color, alpha * 0.9, 13, { align: 'center', spacing: 0.45 });
    const reach = Math.min(width * 0.36, size * words.length * 0.5) * Math.min(1, alpha * 1.5);
    rule(width / 2 - reach, width / 2 + reach, y + 22, color, alpha * 0.8);
    rule(width / 2 - reach, width / 2 + reach, y - size * 0.95, color, alpha * 0.8);
    return [0, y - size * 1.1, width, size * 1.1 + 70];
  }

  // The radar, top left: the floor around the player turned so that up is
  // the way they ride, zoomed so CLU stays on it: the boundary, the ramps,
  // both jetwalls and both cycles as arrows.
  function drawRadar(info, seconds) {
    const radius = RADAR.radius;
    const cx = RADAR.margin + radius;
    const cy = RADAR.margin + radius;
    const { player, clu, range, half, features, accent, enemy } = info;
    const scale = radius / range;
    const forwardX = Math.cos(player.heading);
    const forwardZ = Math.sin(player.heading);
    // world -> radar: the player's right is (-sin, cos), drawn to the right; forward is up
    const toRadar = (x, z) => {
      const dx = x - player.x;
      const dz = z - player.z;
      return [cx + (-dx * forwardZ + dz * forwardX) * scale, cy - (dx * forwardX + dz * forwardZ) * scale];
    };
    context.save();
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.fillStyle = 'rgba(0, 6, 10, 0.62)';
    context.fill();
    context.clip();
    // range rings and the heading line
    context.lineWidth = 1;
    context.strokeStyle = `rgba(${WHITE}, 0.1)`;
    context.beginPath();
    context.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
    context.moveTo(cx, cy - radius);
    context.lineTo(cx, cy + radius);
    context.moveTo(cx - radius, cy);
    context.lineTo(cx + radius, cy);
    context.stroke();
    // the boundary
    context.strokeStyle = `rgba(${WHITE}, 0.55)`;
    context.lineWidth = 1.5;
    context.beginPath();
    [[-half, -half], [half, -half], [half, half], [-half, half]].forEach(([x, z], index) => {
      const [px, py] = toRadar(x, z);
      if (index) context.lineTo(px, py);
      else context.moveTo(px, py);
    });
    context.closePath();
    context.stroke();
    // ramps, decks and the bowl
    context.lineWidth = 1;
    for (const feature of features) {
      const corners = feature.type === 'bowl' ? 16 : 4;
      context.beginPath();
      for (let index = 0; index <= corners; index++) {
        let u;
        let v;
        if (feature.type === 'bowl') {
          const angle = (index / corners) * Math.PI * 2;
          u = Math.cos(angle) * feature.halfLength;
          v = Math.sin(angle) * feature.halfWidth;
        } else {
          u = (index % 4 < 2 ? -1 : 1) * feature.halfLength;
          v = (index % 4 === 1 || index % 4 === 2 ? 1 : -1) * feature.halfWidth;
        }
        const [px, py] = toRadar(feature.x + feature.cos * u - feature.sin * v, feature.z + feature.sin * u + feature.cos * v);
        if (index) context.lineTo(px, py);
        else context.moveTo(px, py);
      }
      context.strokeStyle = `rgba(${WHITE}, ${feature.type === 'kicker' ? 0.5 : 0.28})`;
      context.stroke();
      if (feature.lip) {
        // the lip, brighter: where it flies
        const a = toRadar(feature.lip.x - feature.sin * feature.halfWidth, feature.lip.z + feature.cos * feature.halfWidth);
        const b = toRadar(feature.lip.x + feature.sin * feature.halfWidth, feature.lip.z - feature.cos * feature.halfWidth);
        context.strokeStyle = `rgba(${WHITE}, 0.85)`;
        context.beginPath();
        context.moveTo(a[0], a[1]);
        context.lineTo(b[0], b[1]);
        context.stroke();
      }
    }
    // the jetwalls
    context.lineWidth = 1.6;
    for (const [rider, color] of [[player, accent], [clu, enemy]]) {
      const path = rider.path;
      if (!path?.length) continue;
      context.strokeStyle = `rgba(${color}, 0.85)`;
      context.beginPath();
      // every few points is plenty at this scale
      const stride = Math.max(1, Math.floor(1.5 / (scale * 0.6)));
      let [px, py] = toRadar(path[0].x, path[0].z);
      context.moveTo(px, py);
      for (let index = stride; index < path.length; index += stride) {
        [px, py] = toRadar(path[index].x, path[index].z);
        context.lineTo(px, py);
      }
      if (rider.alive && rider.riding) {
        [px, py] = toRadar(rider.x, rider.z);
        context.lineTo(px, py);
      }
      context.stroke();
    }
    context.restore();
    // CLU: an arrow where it is, or on the rim pointing at it if it is out of range
    if (clu.alive) {
      let [px, py] = toRadar(clu.x, clu.z);
      const out = Math.hypot(px - cx, py - cy);
      const inside = out <= radius - 6;
      if (!inside) {
        px = cx + ((px - cx) / out) * (radius - 6);
        py = cy + ((py - cy) / out) * (radius - 6);
      }
      // its heading relative to the player's, drawn with up as forward
      const turn = clu.heading - player.heading;
      const pulse = info.close ? 0.5 + 0.5 * Math.sin(seconds * 14) : 1;
      arrow(px, py, turn, inside ? 7 : 5, enemy, pulse);
      if (info.close) {
        context.strokeStyle = `rgba(${enemy}, ${0.6 * pulse})`;
        context.beginPath();
        context.arc(px, py, 11 + 3 * pulse, 0, Math.PI * 2);
        context.stroke();
      }
    }
    arrow(cx, cy, 0, 7, accent, 1);
    // the rim
    context.strokeStyle = `rgba(${accent}, 0.75)`;
    context.shadowColor = `rgba(${accent}, 0.8)`;
    context.shadowBlur = 8;
    context.lineWidth = 1;
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.stroke();
    context.shadowBlur = 0;
    text(`RADAR  ${Math.round(range)} M`, cx, cy + radius + 17, accent, 0.7, 9, { spacing: 0.4, align: 'center' });
    if (clu.alive) {
      text(`CLU  ${Math.round(info.distance)} M`, cx, cy + radius + 32, enemy, info.close ? 0.6 + 0.4 * Math.sin(seconds * 14) : 0.9, 11,
        { spacing: 0.35, align: 'center', weight: 600 });
    }
    return [cx - radius - 8, cy - radius - 8, radius * 2 + 16, radius * 2 + 48];
  }

  // an arrowhead at (x, y), pointing up turned by `angle` (clockwise)
  function arrow(x, y, angle, size, color, alpha) {
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.fillStyle = `rgba(${color}, ${alpha})`;
    context.shadowColor = `rgba(${color}, ${alpha})`;
    context.shadowBlur = 8;
    context.beginPath();
    context.moveTo(0, -size);
    context.lineTo(size * 0.7, size * 0.75);
    context.lineTo(0, size * 0.35);
    context.lineTo(-size * 0.7, size * 0.75);
    context.closePath();
    context.fill();
    context.restore();
  }

  // Where CLU is on screen: a marker over it, or, when it is off screen, an
  // arrow at the edge pointing towards it with how far it is; it pulses
  // when CLU is close or behind.
  function drawTracker(info, seconds) {
    const { x, y, onScreen, distance, behind, close, color } = info;
    const pulse = close || behind ? 0.75 + 0.25 * Math.sin(seconds * (close ? 14 : 8)) : 1;
    const label = `CLU  ${Math.round(distance)} M`;
    if (onScreen) {
      if (distance < 18) return null;
      // a bracket over it, smaller the further it is
      const size = Math.max(8, Math.min(22, 500 / distance));
      context.strokeStyle = `rgba(${color}, ${0.85 * pulse})`;
      context.shadowColor = `rgba(${color}, 0.9)`;
      context.shadowBlur = 8;
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(x - size, y - size * 1.6);
      context.lineTo(x, y - size * 0.9);
      context.lineTo(x + size, y - size * 1.6);
      context.stroke();
      context.shadowBlur = 0;
      text(label, x, y - size * 1.6 - 8, color, 0.85 * pulse, 10, { align: 'center', spacing: 0.3 });
      return [x - 80, y - size * 1.6 - 26, 160, size * 1.6 + 30];
    }
    // on the edge of a frame inset from the screen's edges, towards it
    const angle = Math.atan2(y - height / 2, x - width / 2);
    const insetX = width / 2 - TRACKER.margin;
    const insetY = height / 2 - TRACKER.margin;
    const reach = Math.min(Math.abs(insetX / Math.cos(angle) || Infinity), Math.abs(insetY / Math.sin(angle) || Infinity));
    const px = width / 2 + Math.cos(angle) * reach;
    const py = height / 2 + Math.sin(angle) * reach;
    const size = close ? 26 : 20;
    // a dark disc behind it, so it reads over the bright floor
    context.fillStyle = 'rgba(0, 6, 10, 0.55)';
    context.beginPath();
    context.arc(px, py, size * 1.25, 0, Math.PI * 2);
    context.fill();
    context.save();
    context.translate(px, py);
    context.rotate(angle + Math.PI / 2);
    context.fillStyle = `rgba(${color}, ${pulse})`;
    context.shadowColor = `rgba(${color}, 1)`;
    context.shadowBlur = 16;
    context.beginPath();
    context.moveTo(0, -size);
    context.lineTo(size * 0.8, size * 0.55);
    context.lineTo(0, size * 0.15);
    context.lineTo(-size * 0.8, size * 0.55);
    context.closePath();
    context.fill();
    context.restore();
    context.shadowBlur = 0;
    // the label beside it, on the side towards the middle of the screen
    const sideways = Math.abs(Math.cos(angle)) * insetY > Math.abs(Math.sin(angle)) * insetX;
    let lx = px;
    let ly = py;
    let align = 'center';
    if (sideways) {
      align = Math.cos(angle) < 0 ? 'left' : 'right';
      lx = px + (Math.cos(angle) < 0 ? 1 : -1) * (size * 1.25 + 10);
      ly = py + 4;
    } else {
      ly = py + (Math.sin(angle) < 0 ? 1 : -1) * (size * 1.25 + 14) + 4;
    }
    // on a dark card, so it reads over a jetwall of its own colour
    context.font = `700 13px ${FONT}`;
    context.letterSpacing = '0.25em';
    const labelWidth = context.measureText(label).width;
    context.letterSpacing = '0px';
    const left = align === 'left' ? lx : align === 'right' ? lx - labelWidth : lx - labelWidth / 2;
    context.fillStyle = 'rgba(0, 6, 10, 0.6)';
    roundedRect(left - 6, ly - 15, labelWidth + 12, behind ? 36 : 21, 4);
    context.fill();
    text(label, lx, ly, color, Math.max(0.75, pulse), 13, { align, spacing: 0.25, weight: 700 });
    if (behind) text('BEHIND YOU', lx, ly + 15, WHITE, 0.85, 9, { align, spacing: 0.4, weight: 600 });
    return [px - 160, py - 70, 320, 140];
  }

  // the rear-view mirror's frame (the view itself is drawn by mirror.js)
  function drawMirror(info) {
    const { rect, alpha, accent } = info;
    context.strokeStyle = `rgba(${accent}, ${0.85 * alpha})`;
    context.shadowColor = `rgba(${accent}, ${alpha})`;
    context.shadowBlur = 10;
    context.lineWidth = 1;
    context.strokeRect(rect.x - 0.5, rect.y - 0.5, rect.w + 1, rect.h + 1);
    context.shadowBlur = 0;
    text('REAR VIEW', rect.x + rect.w / 2, rect.y + rect.h + 14, accent, 0.8 * alpha, 9, { align: 'center', spacing: 0.45 });
    return [rect.x - 4, rect.y - 4, rect.w + 8, rect.h + 26];
  }

  // A replay: black bars top and bottom like a film, REPLAY blinking in
  // the top bar, how slow it runs, and a timeline in the bottom bar.
  function drawReplay(info, seconds) {
    const bar = Math.round(height * 0.085 * Math.min(1, info.progress * 12));
    context.fillStyle = 'rgba(0, 0, 0, 0.92)';
    context.fillRect(0, 0, width, bar);
    context.fillRect(0, height - bar, width, bar);
    if (bar < 20) return null;
    const y = bar / 2 + 4;
    const blink = Math.sin(seconds * 6) > -0.3 ? 1 : 0.25;
    context.fillStyle = `rgba(255, 60, 50, ${blink})`;
    context.beginPath();
    context.arc(40, y - 4, 5, 0, Math.PI * 2);
    context.fill();
    text(info.final ? 'REPLAY  //  KILL CAM' : 'REPLAY', 54, y, WHITE, 0.9, 12, { spacing: 0.45, weight: 600 });
    text(`${Math.max(0.05, info.speed).toFixed(2)}×`, width - 40, y, WHITE, 0.7, 12, { align: 'right', spacing: 0.3 });
    // the timeline
    const lineY = height - bar / 2;
    const x0 = width * 0.3;
    const x1 = width * 0.7;
    rule(x0, x1, lineY, WHITE, 0.35);
    context.fillStyle = `rgba(${WHITE}, 0.9)`;
    context.fillRect(x0, lineY - 1, (x1 - x0) * Math.min(1, info.progress), 3);
    return [0, 0, width, bar];
  }

  // The end of a match: the winner, the score counting up, the match's
  // numbers one by one, the personal bests, the two ways on (each charging
  // while its gesture is held) and the next match's difficulty.
  function drawResult(info, seconds) {
    const t = info.time;
    const cx = width / 2;
    // with the bests and the difficulty to fit in too, all of it sits higher
    const rows = info.levels || info.bests
      ? { title: 0.24, score: 0.37, stats: 0.455, prompts: 0.655 }
      : { title: 0.3, score: 0.47, stats: 0.55, prompts: 0.76 };
    const appear = (start, length = 0.35) => Math.min(1, Math.max(0, (t - start) / length));
    // a darker band behind the words, so they read over the arena
    const band = context.createLinearGradient(0, height * 0.12, 0, height * 0.95);
    band.addColorStop(0, 'rgba(0, 0, 0, 0)');
    band.addColorStop(0.25, 'rgba(0, 0, 0, 0.45)');
    band.addColorStop(0.8, 'rgba(0, 0, 0, 0.45)');
    band.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = band;
    context.globalAlpha = appear(0, 0.6) * context.globalAlpha;
    context.fillRect(0, height * 0.12, width, height * 0.83);
    context.globalAlpha = 1;

    // the winner, settling in from a little bigger
    const titleIn = appear(0.1, 0.5);
    const size = Math.round(Math.min(120, width / 11) * (1.15 - 0.15 * titleIn ** 0.5));
    const titleY = height * rows.title;
    text(info.title, cx + size * 0.1, titleY, WHITE, titleIn, size, { align: 'center', weight: 200, font: TITLE_FONT, spacing: 0.2, blur: 26 });
    const reach = Math.min(width * 0.38, size * info.title.length * 0.42) * titleIn;
    rule(cx - reach, cx + reach, titleY + 22, info.color, titleIn * 0.9);
    text(info.sub, cx, titleY + 44, info.color, appear(0.5), 12, { align: 'center', spacing: 0.5 });

    // the score: each side counts up to its rounds
    const scoreIn = appear(0.7);
    const scoreY = height * rows.score;
    info.score.forEach((score, index) => {
      const shown = Math.min(score, Math.floor(Math.max(0, t - 0.8) / 0.22));
      const color = index === 0 ? info.accent : info.enemy;
      const side = index === 0 ? -1 : 1;
      const pop = shown === score && score > 0 ? Math.max(0, 1 - (t - 0.8 - score * 0.22) * 3) : 0;
      text(String(shown), cx + side * 46, scoreY, color, scoreIn, 54 + pop * 10,
        { align: index === 0 ? 'right' : 'left', weight: 300, font: TITLE_FONT, spacing: 0.05, blur: 18 });
      text(info.names[index], cx + side * 120, scoreY - 12, color, scoreIn * 0.95, 14,
        { align: index === 0 ? 'right' : 'left', weight: 600, spacing: 0.35 });
      text(index === 0 ? 'YOU' : 'PROGRAM', cx + side * 120, scoreY + 6, color, scoreIn * 0.55, 9,
        { align: index === 0 ? 'right' : 'left', spacing: 0.4 });
    });
    text(':', cx, scoreY - 6, WHITE, scoreIn * 0.7, 40, { align: 'center', font: TITLE_FONT, spacing: 0 });

    // the match's numbers, on a panel of their own
    const statsY = height * rows.stats;
    const columns = info.stats.length;
    const columnWidth = Math.min(170, (width * 0.7) / columns);
    const panelIn = appear(1.2);
    context.fillStyle = `rgba(0, 6, 10, ${0.72 * panelIn})`;
    roundedRect(cx - columnWidth * columns / 2 - 10, statsY - 22, columnWidth * columns + 20, 78, 6);
    context.fill();
    info.stats.forEach(([label, value], index) => {
      const alpha = appear(1.3 + index * 0.15);
      const x = cx + (index - (columns - 1) / 2) * columnWidth;
      text(value, x, statsY + 26 + (1 - alpha) * 8, WHITE, alpha, 22, { align: 'center', weight: 300, font: TITLE_FONT, spacing: 0.06, blur: 10 });
      text(label, x, statsY, info.accent, alpha, 10, { align: 'center', spacing: 0.4, weight: 600 });
    });
    rule(cx - columnWidth * columns / 2, cx + columnWidth * columns / 2, statsY + 44, WHITE, appear(1.3) * 0.3);

    if (info.bests) drawBests(info.bests, statsY + 86, appear(1.8), info.accent, seconds);

    // the ways on
    const promptsIn = appear(2.0, 0.5);
    const boxY = height * rows.prompts;
    if (info.demo !== null) {
      text(`NEXT IN ${Math.ceil(info.demo)}`, cx, boxY - height * 0.02, WHITE, promptsIn * 0.7, 11, { align: 'center', spacing: 0.45 });
    }
    choicePrompt(cx - 190, boxY, 'REMATCH', 'BOTH PALMS OPEN  ·  R', 'palms', info.rematch, info.accent, promptsIn, seconds);
    choicePrompt(cx + 190, boxY, 'END OF LINE', 'TWO FISTS TOGETHER  ·  ESC', 'fists', info.endOfLine, info.enemy, promptsIn, seconds);
    if (info.levels) drawLevels(info.levels, boxY + 112, appear(2.3, 0.5), info.accent);
    return [0, height * 0.12, width, height * 0.83];
  }

  // The personal bests side by side, a beaten one lit, with NEW BEST
  // flashing under it.
  function drawBests(bests, y, alpha, accent, seconds) {
    if (alpha <= 0) return;
    const spread = Math.min(300, width * 0.4);
    bests.forEach((best, index) => {
      const x = width / 2 + (index - (bests.length - 1) / 2) * spread;
      text(best.label, x, y, WHITE, alpha * 0.55, 9, { align: 'center', spacing: 0.4 });
      text(best.value, x, y + 24, best.fresh ? accent : WHITE, alpha * (best.fresh ? 1 : 0.85), 19,
        { align: 'center', weight: 300, font: TITLE_FONT, spacing: 0.08, blur: best.fresh ? 18 : 8 });
      if (!best.fresh) return;
      const flash = 0.55 + 0.45 * Math.sin(seconds * 9);
      context.font = `700 10px ${FONT}`;
      context.letterSpacing = '0.35em';
      const tagWidth = context.measureText('NEW BEST').width;
      context.letterSpacing = '0px';
      context.fillStyle = `rgba(${accent}, ${0.22 * alpha * flash})`;
      context.strokeStyle = `rgba(${accent}, ${alpha * flash})`;
      roundedRect(x - tagWidth / 2 - 8, y + 33, tagWidth + 14, 17, 3);
      context.fill();
      context.stroke();
      text('NEW BEST', x + 2, y + 45, accent, alpha * flash, 10, { align: 'center', spacing: 0.35, weight: 700 });
    });
  }

  // The next match's difficulty: a card for each, the chosen one lit
  // (flashing as it changes), the one a hand is holding up charging, and
  // the record at each.
  function drawLevels(levels, y, alpha, accent) {
    if (alpha <= 0) return;
    const count = levels.names.length;
    const w = Math.min(150, (width - 80) / count - 12);
    const h = 52;
    const gap = 12;
    const left = width / 2 - (count * w + (count - 1) * gap) / 2;
    text('NEXT MATCH  ·  HOLD UP 1, 2 OR 3 FINGERS  ·  KEYS 1 2 3', width / 2, y - 12, WHITE, alpha * 0.5, 9,
      { align: 'center', spacing: 0.35 });
    levels.names.forEach((name, index) => {
      const x = left + index * (w + gap);
      const current = index === levels.current;
      const flash = current ? Math.max(0, 1 - levels.changed * 2) : 0;
      const charge = levels.pending?.level === index ? levels.pending.charge : 0;
      context.fillStyle = current ? `rgba(${accent}, ${(0.16 + 0.35 * flash) * alpha})` : `rgba(0, 6, 10, ${0.55 * alpha})`;
      roundedRect(x, y, w, h, 6);
      context.fill();
      context.strokeStyle = current ? `rgba(${accent}, ${0.95 * alpha})` : `rgba(${WHITE}, ${(charge ? 0.6 : 0.28) * alpha})`;
      context.lineWidth = current ? 1.5 : 1;
      context.stroke();
      context.lineWidth = 1;
      fingers(x + 24, y + h / 2 + 3, index + 1, current || charge ? accent : WHITE, alpha * (current ? 1 : 0.6));
      text(name, x + 46, y + 23, current ? accent : WHITE, alpha * (current ? 1 : 0.7), 13, { weight: 600, spacing: 0.3 });
      text(levels.records[index], x + 46, y + 39, WHITE, alpha * 0.5, 9, { spacing: 0.25 });
      if (charge) {
        context.fillStyle = `rgba(${accent}, ${alpha})`;
        context.fillRect(x, y + h - 3, w * charge, 3);
      }
    });
  }

  // a hand holding up `count` fingers, the others folded
  function fingers(x, y, count, color, alpha) {
    context.strokeStyle = `rgba(${color}, ${alpha})`;
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.beginPath();
    context.roundRect(x - 9, y - 3, 18, 14, 4);
    for (let finger = 0; finger < 4; finger++) {
      const fx = x - 6.6 + finger * 4.4;
      context.moveTo(fx, y - 3);
      context.lineTo(fx, finger < count ? y - 19 + Math.abs(finger - 1.5) * 1.6 : y - 6);
    }
    context.stroke();
    context.lineCap = 'butt';
    context.lineWidth = 1;
  }

  // one way on: a pictogram of the gesture, its name, how to do it, and a
  // bar that fills while it is held
  function choicePrompt(x, y, title, how, gesture, charge, color, alpha, seconds) {
    if (alpha <= 0) return;
    const w = 300;
    const h = 74;
    const lit = charge > 0;
    context.strokeStyle = `rgba(${lit ? color : WHITE}, ${(lit ? 0.9 : 0.35) * alpha})`;
    context.lineWidth = 1;
    roundedRect(x - w / 2, y, w, h, 6);
    context.stroke();
    context.fillStyle = `rgba(${color}, ${0.12 * alpha * (lit ? 1 : 0.4)})`;
    context.fill();
    pictogram(x - w / 2 + 40, y + h / 2, gesture, color, alpha * (lit ? 1 : 0.75 + 0.25 * Math.sin(seconds * 3)));
    text(title, x - w / 2 + 84, y + 31, lit ? color : WHITE, alpha, 17, { weight: 600, spacing: 0.3 });
    text(how, x - w / 2 + 84, y + 50, WHITE, alpha * 0.6, 9, { spacing: 0.3 });
    // the charge
    context.fillStyle = `rgba(${color}, ${alpha})`;
    context.shadowColor = `rgba(${color}, ${alpha})`;
    context.shadowBlur = lit ? 10 : 0;
    context.fillRect(x - w / 2, y + h - 3, w * Math.min(1, charge), 3);
    context.shadowBlur = 0;
  }

  // two open palms side by side, or two fists touching
  function pictogram(x, y, gesture, color, alpha) {
    context.strokeStyle = `rgba(${color}, ${alpha})`;
    context.lineWidth = 1.5;
    for (const side of [-1, 1]) {
      const hx = x + side * (gesture === 'palms' ? 11 : 7);
      context.beginPath();
      if (gesture === 'palms') {
        context.roundRect(hx - 6, y - 2, 12, 14, 3);
        for (let finger = 0; finger < 4; finger++) {
          const fx = hx - 4.5 + finger * 3;
          context.moveTo(fx, y - 2);
          context.lineTo(fx, y - 11 + Math.abs(finger - 1.5) * 1.5);
        }
        // the thumb, out to the side
        context.moveTo(hx - side * 6, y + 4);
        context.lineTo(hx - side * 10, y - 2);
      } else {
        context.roundRect(hx - 6, y - 8, 12, 16, 4);
        for (let knuckle = 0; knuckle < 3; knuckle++) {
          context.moveTo(hx - 6, y - 3 + knuckle * 4);
          context.lineTo(hx + 2, y - 3 + knuckle * 4);
        }
      }
      context.stroke();
    }
  }

  // The camera picture: covered in black here (so the webcam behind shows
  // as it is), framed, with the hands' skeletons and the handlebar line.
  function coverPip(pip) {
    const { x, y, w, h } = pip.rect;
    if (pip.cover <= 0) return;
    context.fillStyle = `rgba(0, 0, 0, ${pip.cover})`;
    roundedRect(x, y, w, h, 10);
    context.fill();
  }

  function drawPip(info) {
    const { rect, hands, grip, accent } = info.pip;
    const { x, y, w, h } = rect;
    if (info.pip.frame <= 0) return;
    const alpha = info.pip.frame;
    context.strokeStyle = `rgba(${accent}, ${0.8 * alpha})`;
    context.shadowColor = `rgba(${accent}, ${alpha})`;
    context.shadowBlur = 10;
    roundedRect(x - 0.5, y - 0.5, w + 1, h + 1, 10);
    context.stroke();
    context.shadowBlur = 0;
    text('CAM // HANDLEBARS', x + 2, y - 9, accent, 0.75 * alpha, 9, { spacing: 0.4 });
    context.save();
    roundedRect(x, y, w, h, 10);
    context.clip();
    for (const landmarks of hands) {
      const points = landmarks.map((point) => [x + point.x * w, y + point.y * h]);
      context.strokeStyle = `rgba(${accent}, ${0.8 * alpha})`;
      context.lineWidth = 1;
      context.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        context.moveTo(points[a][0], points[a][1]);
        context.lineTo(points[b][0], points[b][1]);
      }
      context.stroke();
    }
    // the handlebar: a line between the palms, lit while it's a grip
    if (grip) {
      const [a, b] = grip.palms.map((point) => [x + point.x * w, y + point.y * h]);
      context.strokeStyle = grip.gripping ? `rgba(${accent}, ${alpha})` : `rgba(${WHITE}, ${0.35 * alpha})`;
      context.lineWidth = grip.gripping ? 2 : 1;
      context.setLineDash(grip.gripping ? [] : [4, 4]);
      context.beginPath();
      context.moveTo(a[0], a[1]);
      context.lineTo(b[0], b[1]);
      context.stroke();
      context.setLineDash([]);
      context.lineWidth = 1;
    }
    context.restore();
    const reading = grip?.gripping
      ? `TILT ${grip.tilt >= 0 ? '+' : ''}${grip.tilt.toFixed(0)}°  THR ${Math.round(grip.throttle * 100)}%${grip.brake ? '  BRAKE' : ''}`
      : 'NO GRIP';
    text(reading, x + 2, y + h + 16, grip?.gripping ? accent : WHITE, 0.75 * alpha, 9, { spacing: 0.3 });
  }

  // the bright line and dot an old screen leaves as it switches off
  function collapseLine(x, y, halfWidth, p) {
    const shrink = p < 0.45 ? 1 : Math.max(0, 1 - (p - 0.45) / 0.45);
    const alpha = p < 0.9 ? Math.min(1, p * 4) : Math.max(0, 1 - (p - 0.9) / 0.1);
    context.shadowColor = `rgba(${WHITE}, ${alpha})`;
    context.shadowBlur = 10;
    context.fillStyle = `rgba(${WHITE}, ${alpha})`;
    if (shrink > 0.02) context.fillRect(x - halfWidth * shrink, y - 0.75, halfWidth * shrink * 2, 1.5);
    else {
      context.beginPath();
      context.arc(x, y, 2, 0, Math.PI * 2);
      context.fill();
    }
    context.shadowBlur = 0;
  }

  return {
    canvas,
    resize,
    // info: what to show (see ride/index.js); alpha: the whole HUD's light
    draw(info, seconds) {
      if (canvas.width !== Math.round(width * pixelRatio)) resize(width, height);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (!info) return;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const drawn = [];
      // (no scanlines over the camera picture: they would let the arena through its cover)
      if (info.pip) coverPip(info.pip);
      // switching off like an old screen: squashed to a line, then a dot
      const collapse = info.collapse ?? 0;
      context.save();
      if (collapse > 0) {
        const squash = Math.max(0.02, 1 - collapse * 2.2);
        const shrink = collapse < 0.45 ? 1 : Math.max(0, 1 - (collapse - 0.45) / 0.45);
        context.translate(width / 2, height / 2);
        context.scale(shrink, squash);
        context.translate(-width / 2, -height / 2);
      }
      context.globalAlpha = info.alpha;
      if (info.replay && collapse < 0.45) {
        const area = drawReplay(info.replay, seconds);
        if (area) drawn.push(area);
      }
      context.globalAlpha = 1;
      if (info.pip && collapse < 0.45) drawPip(info);
      context.globalAlpha = info.alpha;
      if (info.alpha > 0 && collapse < 0.45) {
        if (info.result) drawn.push(drawResult(info.result, seconds));
        if (info.score && !info.result) drawn.push(drawScore(info.score));
        if (info.radar) drawn.push(drawRadar(info.radar, seconds));
        if (info.mirror) drawMirror(info.mirror);
        if (info.tracker) {
          const area = drawTracker(info.tracker, seconds);
          if (area) drawn.push(area);
        }
        if (info.gauges) drawn.push(drawSpeed(info.gauges), drawSteering(info.gauges));
        if (info.hint) drawn.push(drawHint(info.hint, seconds));
        if (info.tutorial) drawn.push(drawTutorial(info.tutorial, seconds));
        if (info.banner) {
          const { words, sub, color, scale, alpha } = info.banner;
          drawn.push(banner(words, sub, color, scale, alpha));
        }
      }
      context.globalAlpha = 1;
      context.restore();
      if (collapse > 0 && collapse < 1) collapseLine(width / 2, height / 2, width * 0.4, collapse);
      // scanlines over what was drawn
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalCompositeOperation = 'destination-out';
      context.fillStyle = scanlines;
      for (const [x, y, w, h] of drawn) {
        context.fillRect(Math.floor(x * pixelRatio), Math.floor(y * pixelRatio), Math.ceil(w * pixelRatio), Math.ceil(h * pixelRatio));
      }
      context.globalCompositeOperation = 'source-over';
    },
    clear() {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}

function makeScanlines(context) {
  const tile = document.createElement('canvas');
  tile.width = 1;
  tile.height = 3;
  const tileContext = tile.getContext('2d');
  tileContext.fillStyle = 'rgba(0, 0, 0, 0.35)';
  tileContext.fillRect(0, 2, 1, 1);
  return context.createPattern(tile, 'repeat');
}
