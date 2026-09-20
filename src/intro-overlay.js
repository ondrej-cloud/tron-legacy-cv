// What the intro draws over its page: the tracked hands with their gesture,
// the progress of the both-palms entry (between the hands and in the small
// ring next to the prompt), and the two edges of the seam the intro leaves
// through.
import { POSES } from './gestures.js';
import { gestureLabel } from './intro-copy.js';
import { BLUE, CYAN, WHITE, drawHand, handPoints } from './intro-glyphs.js';

const MAX_PIXEL_RATIO = 2;
const SEAM_GLOW = 34;          // px above and below each seam edge

export function createOverlay({ canvas, ring, reduced }) {
  const context = canvas.getContext('2d');
  const ringContext = ring.getContext('2d');
  let ratio = 1;
  let width = 1;
  let height = 1;
  let drawn = false;   // whether the canvas holds anything that needs clearing

  function resize() {
    ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ringRatio = Math.min(window.devicePixelRatio || 1, 2);
    ring.width = Math.round(ring.clientWidth * ringRatio);
    ring.height = Math.round(ring.clientHeight * ringRatio);
    drawn = true;
  }

  function palmCentre(hand) {
    const points = hand.landmarks;
    return {
      x: ((points[0].x + points[9].x) / 2) * width,
      y: ((points[0].y + points[9].y) / 2) * height,
    };
  }

  // Returns whether anything was drawn.
  function drawHands(hands, palms, progress, alpha) {
    if (hands.mode === 'mouse' || alpha <= 0) return false;
    const visible = hands.list.filter((hand) => hand.landmarks);
    if (!visible.length) return false;
    context.font = '500 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.textAlign = 'center';
    for (const hand of visible) {
      const open = palms[hand.id];
      const points = hand.landmarks.map((point) => ({ x: point.x * width, y: point.y * height }));
      drawHand(context, points, { alpha: alpha * (open ? 0.85 : 0.42), scale: 1 });
      const label = gestureLabel(hand);
      if (label) {
        context.fillStyle = `rgba(${open ? CYAN : WHITE}, ${alpha * (open ? 0.9 : 0.55)})`;
        context.fillText(label.toUpperCase(), points[0].x, points[0].y + 22);
      }
    }
    // both palms up: a beam between them with the progress ring in the middle
    if (visible.length < 2 || progress <= 0) return true;
    const [a, b] = visible.map(palmCentre);
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    context.save();
    context.globalCompositeOperation = 'lighter';
    context.strokeStyle = `rgba(${CYAN}, ${alpha * (0.2 + 0.6 * progress)})`;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
    context.strokeStyle = `rgba(${CYAN}, ${0.3 * alpha})`;
    context.beginPath();
    context.arc(middle.x, middle.y, 26, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = `rgba(${WHITE}, ${alpha})`;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(middle.x, middle.y, 26, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    context.stroke();
    context.restore();
    return true;
  }

  function drawSeam(slit, alpha) {
    context.save();
    context.globalCompositeOperation = 'lighter';
    for (const y of [slit.top, slit.bottom]) {
      const glow = context.createLinearGradient(0, y - SEAM_GLOW, 0, y + SEAM_GLOW);
      glow.addColorStop(0, `rgba(${BLUE}, 0)`);
      glow.addColorStop(0.5, `rgba(${BLUE}, ${0.5 * alpha})`);
      glow.addColorStop(1, `rgba(${BLUE}, 0)`);
      context.fillStyle = glow;
      context.fillRect(0, y - SEAM_GLOW, width, SEAM_GLOW * 2);
      context.fillStyle = `rgba(${WHITE}, ${alpha})`;
      context.fillRect(0, y - 1, width, 2);
    }
    context.restore();
  }

  // hands: the Hands instance; palms: { left, right } open and facing;
  // progress: 0..1 towards entering; alpha: how much of the hands to show;
  // seam: { top, bottom, alpha } while leaving, else null.
  function draw({ hands, palms, progress, alpha, seam }) {
    const busy = seam || (alpha > 0 && hands.list.length);
    if (!busy && !drawn) return;   // nothing on screen and nothing to add
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawn = drawHands(hands, palms, progress, alpha);
    if (seam) {
      drawSeam(seam, seam.alpha);
      drawn = true;
    }
  }

  // The ring next to the prompt: a slowly turning dashed track, the progress
  // arc, and a small hand per side that lights up while that palm is shown.
  function drawRing(palms, progress, seconds) {
    const size = ring.clientWidth;
    ringContext.setTransform(1, 0, 0, 1, 0, 0);
    ringContext.clearRect(0, 0, ring.width, ring.height);
    if (!ring.width || !size) return;
    const scale = ring.width / size;
    ringContext.setTransform(scale, 0, 0, scale, 0, 0);
    ringContext.globalCompositeOperation = 'lighter';
    const centre = size / 2;
    const radius = size * 0.44;
    ringContext.lineWidth = 1;
    ringContext.strokeStyle = `rgba(${CYAN}, 0.28)`;
    const spin = reduced ? 0 : seconds * 0.4;
    for (let dash = 0; dash < 24; dash++) {
      const start = spin + (dash / 24) * Math.PI * 2;
      ringContext.beginPath();
      ringContext.arc(centre, centre, radius, start, start + (Math.PI * 2) / 24 * 0.55);
      ringContext.stroke();
    }
    if (progress > 0) {
      ringContext.lineCap = 'round';
      ringContext.strokeStyle = `rgba(${BLUE}, 0.35)`;
      ringContext.lineWidth = 5;
      ringContext.beginPath();
      ringContext.arc(centre, centre, radius, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ringContext.stroke();
      ringContext.strokeStyle = `rgba(${WHITE}, 0.95)`;
      ringContext.lineWidth = 1.6;
      ringContext.stroke();
    }
    for (const side of ['left', 'right']) {
      const points = handPoints(POSES.open, {
        x: centre + (side === 'left' ? -1 : 1) * size * 0.17,
        y: centre + size * 0.03,
        size: size * 0.17,
        roll: side === 'left' ? -0.12 : 0.12,
        physical: side,
      });
      drawHand(ringContext, points, { pose: POSES.open, alpha: palms[side] ? 1 : 0.35, scale: 0.7 });
    }
  }

  return { resize, draw, drawRing };
}
