// The intro title, rezzed in letter by letter behind a sweeping line of
// light. Every letter is pre-rendered into small sprites (white-hot core,
// cyan glow, and two tinted copies for the chromatic split while it rezzes),
// so a frame is just a handful of drawImage calls.
import { BLUE, CYAN, ORANGE, WHITE } from './intro-glyphs.js';

export const TITLE_FONT = 'Michroma';
const FONT_STACK = `"${TITLE_FONT}", "Eurostile", "Arial Black", sans-serif`;
const TRACKING = 0.22;      // em between letters
const LINE_GAP = 0.5;       // em between lines when the title wraps
const PAD = 0.5;            // em of room around each letter for its glow
const REZ_TIME = 0.42;      // s a letter flickers before it settles
const GLINT_TIME = 0.9;     // s for the highlight to cross the title
const GLINT_EVERY = 9;      // s between idle glints

const clamp01 = (value) => Math.min(1, Math.max(0, value));

// Stable pseudo-random 0..1 for integer inputs.
function hash(a, b) {
  const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

export function createTitle(canvas, { reduced = false } = {}) {
  const context = canvas.getContext('2d');
  const scratch = document.createElement('canvas');
  const scratchContext = scratch.getContext('2d');
  let letters = [];
  let fontSize = 0;
  let ratio = 1;

  function sprite(width, height) {
    const element = document.createElement('canvas');
    element.width = width;
    element.height = height;
    return element;
  }

  function build() {
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    canvas.width = width;
    canvas.height = height;
    scratch.width = width;
    scratch.height = height;

    const lines = canvas.clientWidth / canvas.clientHeight < 4 ? ['TRON', 'LEGACY'] : ['TRON LEGACY'];
    const measure = scratchContext;
    measure.font = `400 100px ${FONT_STACK}`;
    const capHeight = (measure.measureText('H').actualBoundingBoxAscent || 72) / 100;
    const advance = (char) => measure.measureText(char).width / 100 + TRACKING;
    const lineWidth = (text) => [...text].reduce((sum, char) => sum + advance(char), 0) - TRACKING;
    const widest = Math.max(...lines.map(lineWidth));
    const blockHeight = lines.length * capHeight + (lines.length - 1) * LINE_GAP;
    fontSize = Math.min(width / (widest + 2 * PAD * 0.7), height / (blockHeight + 2 * PAD * 0.8));

    const pad = Math.ceil(PAD * fontSize);
    const cap = capHeight * fontSize;
    const spriteHeight = Math.ceil(cap + pad * 2);
    const top = (height - blockHeight * fontSize) / 2;
    letters = [];
    lines.forEach((text, lineIndex) => {
      let x = (width - lineWidth(text) * fontSize) / 2;
      const baseline = top + cap + lineIndex * (capHeight + LINE_GAP) * fontSize;
      for (const char of text) {
        const glyphWidth = advance(char) * fontSize - TRACKING * fontSize;
        if (char !== ' ') letters.push(makeLetter(char, x, baseline, glyphWidth, cap, pad, spriteHeight));
        x += advance(char) * fontSize;
      }
    });
  }

  function makeLetter(char, x, baseline, glyphWidth, cap, pad, spriteHeight) {
    const spriteWidth = Math.ceil(glyphWidth + pad * 2);
    const font = `400 ${fontSize}px ${FONT_STACK}`;
    const origin = { x: pad, y: pad + cap };
    const layer = (paint) => {
      const element = sprite(spriteWidth, spriteHeight);
      const c = element.getContext('2d');
      c.font = font;
      c.textBaseline = 'alphabetic';
      paint(c);
      return element;
    };
    const core = layer((c) => {
      const gradient = c.createLinearGradient(0, origin.y - cap, 0, origin.y);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(0.5, '#e4fcff');
      gradient.addColorStop(0.52, '#b9f5ff');
      gradient.addColorStop(1, '#8cecff');
      c.fillStyle = gradient;
      c.fillText(char, origin.x, origin.y);
    });
    const glow = layer((c) => {
      c.fillStyle = `rgba(${BLUE}, 0.9)`;
      c.shadowColor = `rgba(${BLUE}, 1)`;
      c.shadowBlur = fontSize * 0.34;
      c.fillText(char, origin.x, origin.y);
      c.shadowColor = `rgba(${CYAN}, 1)`;
      c.shadowBlur = fontSize * 0.1;
      c.fillText(char, origin.x, origin.y);
    });
    const tinted = (color) => layer((c) => {
      c.fillStyle = `rgba(${color}, 0.85)`;
      c.shadowColor = `rgba(${color}, 1)`;
      c.shadowBlur = fontSize * 0.08;
      c.fillText(char, origin.x, origin.y);
    });
    return {
      char,
      x: x - pad,
      y: baseline - cap - pad,
      width: spriteWidth,
      height: spriteHeight,
      centre: x + glyphWidth / 2,
      core,
      glow,
      warm: tinted(ORANGE),
      cool: tinted(BLUE),
    };
  }

  // Draws a sprite in horizontal bands shifted sideways: the digital tear of
  // a letter that is still rezzing.
  function drawTorn(target, image, x, y, tear, seed) {
    if (tear < 0.5) {
      target.drawImage(image, x, y);
      return;
    }
    const bands = 4;
    const bandHeight = image.height / bands;
    for (let band = 0; band < bands; band++) {
      const shift = (hash(seed, band) - 0.5) * 2 * tear;
      target.drawImage(image, 0, band * bandHeight, image.width, bandHeight,
        x + shift, y + band * bandHeight, image.width, bandHeight);
    }
  }

  function drawSweep(x, alpha) {
    const { height } = canvas;
    const reach = fontSize * 0.55;
    // an elliptical glow, so the beam fades out instead of ending at the canvas edge
    context.save();
    context.translate(x, height / 2);
    context.scale(1, height / 2 / reach);
    const glow = context.createRadialGradient(0, 0, 0, 0, 0, reach);
    glow.addColorStop(0, `rgba(${BLUE}, ${0.45 * alpha})`);
    glow.addColorStop(1, `rgba(${BLUE}, 0)`);
    context.fillStyle = glow;
    context.fillRect(-reach, -reach, reach * 2, reach * 2);
    context.restore();
    const core = context.createLinearGradient(0, 0, 0, height);
    core.addColorStop(0, `rgba(${WHITE}, 0)`);
    core.addColorStop(0.5, `rgba(${WHITE}, ${alpha})`);
    core.addColorStop(1, `rgba(${WHITE}, 0)`);
    context.fillStyle = core;
    context.fillRect(x - ratio, 0, ratio * 2, height);
  }

  // A diagonal highlight that only lights up the letters.
  function drawGlint(progress) {
    const { width, height } = canvas;
    scratchContext.globalCompositeOperation = 'source-over';
    scratchContext.clearRect(0, 0, width, height);
    for (const letter of letters) scratchContext.drawImage(letter.core, letter.x, letter.y);
    scratchContext.globalCompositeOperation = 'source-in';
    const centre = -0.2 * width + progress * 1.4 * width;
    const spread = width * 0.06;
    const band = scratchContext.createLinearGradient(centre - spread, height, centre + spread, 0);
    band.addColorStop(0, 'rgba(255, 255, 255, 0)');
    band.addColorStop(0.5, 'rgba(255, 255, 255, 0.95)');
    band.addColorStop(1, 'rgba(255, 255, 255, 0)');
    scratchContext.fillStyle = band;
    scratchContext.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'lighter';
    context.drawImage(scratch, 0, 0);
    context.drawImage(scratch, 0, 0);
  }

  const IDLE_PERIOD = 7.3;   // s between idle flickers

  // Whether a frame at boot time t would differ from a settled title, so the
  // caller can skip redrawing a title that isn't changing.
  function animating(t, { sweep, glintAt }) {
    if (reduced) return t < sweep.start + sweep.duration + 0.4;
    if (t < sweep.start + sweep.duration + REZ_TIME + 0.1) return true;
    if (t >= glintAt && ((t - glintAt) % GLINT_EVERY) < GLINT_TIME + 0.05) return true;
    return t - Math.floor(t / IDLE_PERIOD) * IDLE_PERIOD < 0.2;
  }

  // t: seconds into the boot (0 before it starts); sweep: { start, duration };
  // glintAt: seconds; dormant: 0..1, how much the letters the sweep hasn't
  // reached yet show as unlit glass (the camera screen).
  function draw(t, { sweep, glintAt }, dormant = 0) {
    const { width, height } = canvas;
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.clearRect(0, 0, width, height);
    if (!letters.length) return;
    context.globalCompositeOperation = 'lighter';

    const sweepProgress = (t - sweep.start) / sweep.duration;
    const sweepX = (-0.04 + 1.08 * sweepProgress) * width;
    const breathe = reduced ? 1 : 0.88 + 0.12 * Math.sin(t * 1.4);
    // now and then one letter drops out for a few frames, like a tired tube
    const idleCycle = Math.floor(t / IDLE_PERIOD);
    const idleLetter = Math.floor(hash(idleCycle, 3) * letters.length);
    const idleDip = !reduced && t - idleCycle * IDLE_PERIOD < 0.16 && t > sweep.start + sweep.duration + 2;
    const frame = Math.floor(t * 30);

    letters.forEach((letter, index) => {
      const revealAt = sweep.start + sweep.duration * ((letter.centre / width + 0.04) / 1.08);
      const age = t - revealAt;
      if (age < 0) {
        if (dormant > 0) {
          context.globalAlpha = 0.16 * dormant;
          context.drawImage(letter.core, letter.x, letter.y);
        }
        return;
      }
      let alpha = 1;
      let split = 0;
      let tear = 0;
      if (reduced) {
        alpha = clamp01(age / 0.3);
      } else if (age < REZ_TIME) {
        const settle = age / REZ_TIME;
        alpha = hash(index, frame) > 0.55 * (1 - settle) ? 0.95 : 0.15;
        split = (1 - settle) ** 2 * fontSize * 0.09;
        tear = (1 - settle) ** 2 * fontSize * 0.12;
      }
      if (idleDip && index === idleLetter && frame % 3 !== 0) alpha *= 0.45;
      context.globalAlpha = alpha * 0.8 * breathe;
      context.drawImage(letter.glow, letter.x, letter.y);
      if (split > 0.5) {
        context.globalAlpha = alpha * 0.8;
        drawTorn(context, letter.warm, letter.x - split, letter.y, tear, index + frame);
        drawTorn(context, letter.cool, letter.x + split, letter.y, tear, index + frame + 7);
      }
      context.globalAlpha = alpha;
      drawTorn(context, letter.core, letter.x, letter.y, tear, index + frame + 3);
    });
    context.globalAlpha = 1;

    if (!reduced && sweepProgress > 0 && sweepProgress < 1.05) {
      drawSweep(sweepX, Math.min(1, (1.05 - sweepProgress) * 6));
    }
    if (!reduced && t >= glintAt) {
      const glint = ((t - glintAt) % GLINT_EVERY) / GLINT_TIME;
      if (glint < 1) drawGlint(glint);
    }
    context.globalCompositeOperation = 'source-over';
  }

  return { build, draw, animating };
}
