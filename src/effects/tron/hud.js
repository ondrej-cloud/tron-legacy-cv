// Holographic HUD, drawn on a 2D canvas above the WebGL layer. Around every
// tracked hand, in that hand's team colour: a bracket, the 21-point
// skeleton, the hand's team, its gesture and what it is doing, five finger
// bars (how straight each finger is), which side of the hand faces the
// camera, and small readouts. Thin crisp lines, a faint flicker and scanlines.
import { HAND_CONNECTIONS } from '../../hands.js';

const HUD = {
  font: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  boxPadding: 0.2,        // palm sizes around the landmarks
  boxSmoothing: 0.06,     // s, so the bracket doesn't shake with the landmarks
  bracket: 14,            // px, length of the bracket corners
  typeMs: 12,             // per character: new labels are typed out behind a block cursor
  bars: { width: 4, gap: 3, height: 34 },
};

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const GESTURE_NAMES = { thumbsUp: 'THUMBS UP', none: '' };
const WHITE = '226, 250, 255';

export function createHud(container, { hands, view, teams, controls }) {
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  const context = canvas.getContext('2d');
  const scanlines = makeScanlines();
  const labels = new Map();   // typed-out labels by slot
  const boxes = { left: null, right: null };
  const drawn = [];   // CSS-pixel rects drawn this frame; only they get scanlines
  let pixelRatio = 1;

  function resize(width, height) {
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
  }

  // Text that is typed out when it changes, like a terminal printing it.
  function typed(slot, text, nowMs) {
    let label = labels.get(slot);
    if (!label || label.text !== text) {
      label = { text, since: nowMs };
      labels.set(slot, label);
    }
    const shown = Math.floor((nowMs - label.since) / HUD.typeMs);
    return shown >= text.length ? text : `${text.slice(0, shown)}\u2588`;
  }

  function setFont(size, weight = 400) {
    context.font = `${weight} ${size}px ${HUD.font}`;
  }

  function glowText(text, x, y, color, alpha, size, { weight = 400, align = 'left', spacing = 0.12 } = {}) {
    setFont(size, weight);
    context.textAlign = align;
    context.letterSpacing = `${spacing}em`;
    context.shadowColor = `rgba(${color}, ${0.8 * alpha})`;
    context.shadowBlur = 6;
    context.fillStyle = `rgba(${color}, ${alpha})`;
    context.fillText(text, x, y);
    context.shadowBlur = 0;
    context.letterSpacing = '0px';
  }

  function smoothBox(id, target, dt) {
    const box = boxes[id];
    if (!box) {
      boxes[id] = { ...target };
      return boxes[id];
    }
    const blend = 1 - Math.exp(-dt / HUD.boxSmoothing);
    for (const key of ['x0', 'y0', 'x1', 'y1']) box[key] += (target[key] - box[key]) * blend;
    return box;
  }

  function drawHand(hand, nowMs, dt, accent) {
    const width = view.width;
    const height = view.height;
    const points = hand.landmarks.map((point) => ({ x: point.x * width, y: point.y * height }));
    const pad = hand.size * height * HUD.boxPadding;
    const target = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const point of points) {
      target.x0 = Math.min(target.x0, point.x - pad);
      target.y0 = Math.min(target.y0, point.y - pad);
      target.x1 = Math.max(target.x1, point.x + pad);
      target.y1 = Math.max(target.y1, point.y + pad);
    }
    const box = smoothBox(hand.id, target, dt);
    const state = controls.states[hand.id];

    // skeleton and joints: what the tracker sees
    context.lineWidth = 1;
    context.strokeStyle = `rgba(${accent}, 0.32)`;
    context.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      context.moveTo(points[a].x, points[a].y);
      context.lineTo(points[b].x, points[b].y);
    }
    context.stroke();
    context.fillStyle = `rgba(${WHITE}, 0.7)`;
    for (const point of points) context.fillRect(point.x - 1.5, point.y - 1.5, 3, 3);
    context.strokeStyle = `rgba(${accent}, 0.85)`;
    for (const index of [4, 8, 12, 16, 20]) {
      context.beginPath();
      context.arc(points[index].x, points[index].y, 4, 0, Math.PI * 2);
      context.stroke();
    }
    // thumb contact: a ring where the thumb touches a fingertip
    for (const [finger, tipIndex] of [['index', 8], ['middle', 12], ['ring', 16], ['pinky', 20]]) {
      if (!hand.touching[finger]) continue;
      const x = (points[4].x + points[tipIndex].x) / 2;
      const y = (points[4].y + points[tipIndex].y) / 2;
      context.strokeStyle = `rgba(${WHITE}, 0.95)`;
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(x, y, 9, 0, Math.PI * 2);
      context.stroke();
      context.lineWidth = 1;
    }

    // bracket
    const { x0, y0, x1, y1 } = box;
    drawn.push([x0 - 60, y0 - 45, x1 - x0 + 120, y1 - y0 + 90]);
    const arm = Math.min(HUD.bracket, (x1 - x0) / 3, (y1 - y0) / 3);
    context.strokeStyle = `rgba(${accent}, 0.9)`;
    context.lineWidth = 1.25;
    context.beginPath();
    for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x1, y1, -1, -1], [x0, y1, 1, -1]]) {
      context.moveTo(x + dx * arm, y);
      context.lineTo(x, y);
      context.lineTo(x, y + dy * arm);
    }
    // centre ticks on each side
    const midX = (x0 + x1) / 2;
    const midY = (y0 + y1) / 2;
    context.moveTo(midX, y0 - 3); context.lineTo(midX, y0 + 3);
    context.moveTo(midX, y1 - 3); context.lineTo(midX, y1 + 3);
    context.moveTo(x0 - 3, midY); context.lineTo(x0 + 3, midY);
    context.moveTo(x1 - 3, midY); context.lineTo(x1 + 3, midY);
    context.stroke();

    // header: a tag with the hand and its team, the gesture, the action
    const side = hand.physical === 'left' ? 'L' : 'R';
    const tag = typed(`${hand.id}-team`, `${side} ${teams[hand.id].name}`, nowMs);
    setFont(10, 700);
    context.letterSpacing = '0.1em';
    const tagWidth = Math.ceil(context.measureText(tag).width) + 9;
    context.fillStyle = `rgba(${accent}, 0.9)`;
    context.fillRect(x0, y0 - 33, tagWidth, 15);
    context.textAlign = 'left';
    context.fillStyle = 'rgba(0, 0, 0, 1)';
    context.fillText(tag, x0 + 4.5, y0 - 22);
    context.letterSpacing = '0px';
    const gesture = GESTURE_NAMES[hand.gesture] ?? hand.gesture.toUpperCase();
    glowText(typed(`${hand.id}-gesture`, gesture, nowMs), x0 + tagWidth + 7, y0 - 21, WHITE, 0.95, 13,
      { weight: 700, spacing: 0.2 });
    if (state.action) {
      glowText(typed(`${hand.id}-action`, `// ${state.action}`, nowMs), x0, y0 - 6, accent, 0.95, 10, { spacing: 0.16 });
    }

    // finger bars on the outer side: how straight each finger is
    const { width: barWidth, gap, height: barHeight } = HUD.bars;
    const barsWidth = FINGERS.length * barWidth + (FINGERS.length - 1) * gap;
    const outerRight = hand.id === 'right';
    let barsX = outerRight ? x1 + 10 : x0 - 10 - barsWidth;
    if (barsX < 6 || barsX + barsWidth > width - 6) barsX = outerRight ? x0 - 10 - barsWidth : x1 + 10;
    const barsY = y0 + 4;
    FINGERS.forEach((finger, index) => {
      const x = barsX + index * (barWidth + gap);
      const straight = 1 - (hand.fingers?.curl[finger] ?? 0);
      const extended = hand.fingers?.extended[finger];
      context.strokeStyle = `rgba(${WHITE}, 0.28)`;
      context.lineWidth = 1;
      context.strokeRect(x + 0.5, barsY + 0.5, barWidth - 1, barHeight - 1);
      const fill = Math.max(1, straight * barHeight);
      context.fillStyle = extended ? `rgba(${accent}, 0.95)` : `rgba(${WHITE}, 0.45)`;
      context.fillRect(x, barsY + barHeight - fill, barWidth, fill);
      setFont(8);
      context.textAlign = 'center';
      context.fillStyle = `rgba(${WHITE}, 0.6)`;
      context.fillText(finger[0].toUpperCase(), x + barWidth / 2, barsY + barHeight + 10);
    });
    // palm indicator: filled when the palm faces the camera
    const palmX = barsX + barsWidth / 2;
    const palmY = barsY + barHeight + 22;
    context.strokeStyle = `rgba(${accent}, 0.9)`;
    context.beginPath();
    context.moveTo(palmX, palmY - 5);
    context.lineTo(palmX + 5, palmY);
    context.lineTo(palmX, palmY + 5);
    context.lineTo(palmX - 5, palmY);
    context.closePath();
    if (hand.palmFacing) {
      context.fillStyle = `rgba(${accent}, 0.9)`;
      context.fill();
    }
    context.stroke();
    setFont(8);
    context.fillStyle = `rgba(${WHITE}, 0.6)`;
    context.fillText(hand.palmFacing ? 'PALM' : 'BACK', palmX, palmY + 15);

    // readouts under the bracket
    const roll = Math.round((hand.roll * 180) / Math.PI);
    const readoutY = Math.min(y1 + 14, height - 60);
    setFont(9);
    context.textAlign = 'left';
    context.letterSpacing = '0.08em';
    context.fillStyle = `rgba(${WHITE}, 0.55)`;
    context.fillText(`X ${hand.x.toFixed(2)}  Y ${hand.y.toFixed(2)}`, x0, readoutY);
    context.fillText(`ROLL ${roll >= 0 ? '+' : ''}${roll}°  ${hand.fingers?.count ?? 0}/5 UP`, x0, readoutY + 12);
    context.letterSpacing = '0px';
  }

  // a faint hash per time step, for flicker and glitches
  const hash = (value) => {
    const s = Math.sin(value * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };

  let lastMs = performance.now();
  return {
    resize,
    draw(nowMs, seconds) {
      const dt = Math.min(0.1, Math.max(0.001, (nowMs - lastMs) / 1000));
      lastMs = nowMs;
      if (canvas.width !== Math.round(view.width * pixelRatio)) resize(view.width, view.height);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      // hologram: a slight flicker, and now and then a horizontal glitch
      const step = Math.floor(seconds * 12);
      const glitch = hash(step) < 0.012 ? (hash(step + 0.5) - 0.5) * 8 : 0;
      context.globalAlpha = 0.9 + 0.1 * hash(Math.floor(seconds * 30));
      context.translate(glitch, 0);
      for (const hand of hands.list) {
        if (hand.landmarks) drawHand(hand, nowMs, dt, teams[hand.id].cssRgb());
      }
      for (const id of ['left', 'right']) if (!hands[id].visible) boxes[id] = null;
      context.globalAlpha = 1;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalCompositeOperation = 'destination-out';
      context.fillStyle = scanlines;
      for (const [x, y, w, h] of drawn) {
        context.fillRect(Math.floor(x * pixelRatio), Math.floor(y * pixelRatio), Math.ceil(w * pixelRatio), Math.ceil(h * pixelRatio));
      }
      drawn.length = 0;
      context.globalCompositeOperation = 'source-over';
    },
  };

  function makeScanlines() {
    const tile = document.createElement('canvas');
    tile.width = 1;
    tile.height = 3;
    const tileContext = tile.getContext('2d');
    tileContext.fillStyle = 'rgba(0, 0, 0, 0.4)';
    tileContext.fillRect(0, 2, 1, 1);
    return context.createPattern(tile, 'repeat');
  }
}
