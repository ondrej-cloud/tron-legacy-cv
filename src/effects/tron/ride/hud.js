// The ride's HUD, in the style of the AR one (thin crisp lines, monospace
// labels with a glow, scanlines): the score (TRON vs CLU) and the round at
// the top, the speed and a steering indicator at the bottom, the handlebar
// hint while nobody holds on, the 3-2-1 countdown, the crash and result
// banners, and the frame of the camera picture in the corner (the webcam
// itself shows through there, pip.js) with the hands' skeletons and the
// handlebar reading drawn over it.
import { HAND_CONNECTIONS } from '../../../hands.js';

const FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const TITLE_FONT = '"Helvetica Neue", "Avenir Next", "Segoe UI", Arial, sans-serif';
const WHITE = '226, 250, 255';

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
    text(info.boosting ? 'BOOST' : info.braking ? 'BRAKE' : 'CRUISE', x - barWidth, barY - 10, info.boosting ? accent : WHITE,
      info.boosting ? 0.95 : 0.55, 9, { spacing: 0.45 });
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
      if (info.pip && collapse < 0.45) drawPip(info);
      context.globalAlpha = info.alpha;
      if (info.alpha > 0 && collapse < 0.45) {
        if (info.score) drawn.push(drawScore(info.score));
        if (info.gauges) drawn.push(drawSpeed(info.gauges), drawSteering(info.gauges));
        if (info.hint) drawn.push(drawHint(info.hint, seconds));
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
