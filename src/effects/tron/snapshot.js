// TRON snapshot: two hands framing a picture take one (controls.js). The
// picture is the page as it shows: the mirrored webcam frame with its colour
// grade, the effect layer screen-blended over it, the vignette, and a small
// "TRON LEGACY CV" mark in the corner. The HUD is left out, so it is a
// picture of the scene rather than of the tracker. The shutter flashes, the
// PNG downloads (not in demo mode) and a thumbnail slides from the frame into
// the corner of the screen.
//
// The WebGL canvas keeps no copy of its last frame, so the picture is taken
// right after the effect has rendered, in the same task (capture()).

const MARK_FONT = 'Michroma';
const FONT_SHEET = 'https://fonts.googleapis.com/css2?family=Michroma&display=swap';

const STYLE = `
.tron-shutter { position: fixed; inset: 0; z-index: 20; pointer-events: none; opacity: 0;
  background: radial-gradient(ellipse at center, rgba(236, 253, 255, 0.95), rgba(150, 240, 255, 0.75)); }
.tron-shot { position: fixed; top: 18px; right: 18px; z-index: 21; width: min(240px, 34vw); pointer-events: none;
  transform-origin: 0 0; font: 600 10px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.16em; color: rgba(226, 250, 255, 0.85); text-transform: uppercase; }
.tron-shot img { display: block; width: 100%; height: auto; box-sizing: border-box;
  border: 1px solid rgba(111, 243, 255, 0.85);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), 0 0 14px rgba(0, 200, 255, 0.55); }
.tron-shot p { margin: 6px 0 0; text-shadow: 0 0 6px rgba(0, 200, 255, 0.7); }
.tron-shot p b { color: rgb(111, 243, 255); font-weight: 700; }
@media (prefers-reduced-motion: reduce) { .tron-shot { transition: none; } }
`;

// hands: hands.js (its video element is the camera picture); canvas: the
// effect's WebGL canvas; onShutter: called as the picture is taken.
export function createSnapshot({ hands, canvas, onShutter = () => {} }) {
  let pending = null;
  let shown = null;   // the thumbnail on screen
  let last = null;    // { url, name } of the latest picture
  const counts = { taken: 0, saved: 0 };

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  // the mark is set in the title's typeface; the intro loads it, a
  // ?skipintro start doesn't, so it is fetched here ahead of the first shot
  if (!document.querySelector(`link[href*="family=${MARK_FONT}"]`)) {
    const sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = FONT_SHEET;
    sheet.onload = () => document.fonts?.load(`400 13px "${MARK_FONT}"`).catch(() => {});
    document.head.appendChild(sheet);
  }

  // frame: { corners: [a, b] } in view units; taken after the next render
  function request(frame, view) {
    pending = { frame, view };
  }

  // Draws the page's layers into a canvas of the WebGL canvas's size.
  function compose() {
    const width = canvas.width;
    const height = canvas.height;
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const context = out.getContext('2d');
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
    const video = hands.video;
    if (video.readyState >= 2 && video.videoWidth > 0) {
      // object-fit: cover, mirrored, with the grade the page puts on it
      const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
      const drawWidth = video.videoWidth * scale;
      const drawHeight = video.videoHeight * scale;
      context.save();
      context.translate(width, 0);
      context.scale(-1, 1);
      context.filter = getComputedStyle(video).filter || 'none';
      context.drawImage(video, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
      context.restore();
    }
    // light adds onto the room, black leaves it as it is
    context.globalCompositeOperation = 'screen';
    context.drawImage(canvas, 0, 0, width, height);
    context.globalCompositeOperation = 'source-over';
    // the page's vignette: an ellipse through the corners, clear to 55%
    context.save();
    context.translate(width / 2, height / 2);
    context.scale(1, height / width);
    const radius = width / Math.SQRT2;
    const vignette = context.createRadialGradient(0, 0, 0, 0, 0, radius);
    vignette.addColorStop(0.55, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
    context.fillStyle = vignette;
    context.fillRect(-width / 2, -radius, width, radius * 2);
    context.restore();
    return out;
  }

  // "TRON LEGACY CV" and the time, small, in the bottom right corner
  function mark(out, date) {
    const context = out.getContext('2d');
    const unit = out.height / 720;
    const margin = 22 * unit;
    const x = out.width - margin;
    const y = out.height - margin;
    context.save();
    context.textAlign = 'right';
    context.textBaseline = 'alphabetic';
    context.font = `400 ${Math.round(13 * unit)}px "${MARK_FONT}", "Rajdhani", ui-sans-serif, sans-serif`;
    context.letterSpacing = `${(4 * unit).toFixed(1)}px`;
    const title = 'TRON LEGACY CV';
    const titleWidth = context.measureText(title).width;
    context.shadowColor = 'rgba(0, 200, 255, 0.9)';
    context.shadowBlur = 10 * unit;
    context.fillStyle = 'rgba(236, 253, 255, 0.95)';
    // letter spacing also trails the last letter: shift it back
    context.fillText(title, x + 4 * unit, y);
    context.shadowBlur = 0;
    context.font = `500 ${Math.round(8.5 * unit)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.letterSpacing = `${(1.6 * unit).toFixed(1)}px`;
    const time = `${stamp(date, ' ', ':')} // GRID`;
    const timeWidth = context.measureText(time).width;
    context.fillStyle = 'rgba(111, 243, 255, 0.8)';
    context.fillText(time, x + 1.6 * unit, y - 21 * unit);
    // a rule between the two lines, with a tick hanging from its left end
    const rule = Math.max(titleWidth, timeWidth) - 4 * unit;
    const line = Math.max(1, unit);
    context.fillStyle = 'rgba(111, 243, 255, 0.85)';
    context.fillRect(x - rule, y - 16 * unit, rule, line);
    context.fillRect(x - rule, y - 16 * unit, line, 5 * unit);
    context.restore();
  }

  function flash() {
    const shutter = document.createElement('div');
    shutter.className = 'tron-shutter';
    document.body.appendChild(shutter);
    const animation = shutter.animate(
      [{ opacity: 0.85 }, { opacity: 0.35, offset: 0.25 }, { opacity: 0 }],
      { duration: 420, easing: 'ease-out' });
    animation.onfinish = () => shutter.remove();
  }

  // the thumbnail grows out of the frame between the hands and slides into
  // the corner, stays a moment, then slides off
  function thumbnail(url, name, saved, from) {
    shown?.remove();
    const element = document.createElement('figure');
    element.className = 'tron-shot';
    element.style.margin = '0';
    element.innerHTML = `<img alt="TRON snapshot"><p><b>Snapshot</b> // ${saved ? name : 'demo, not saved'}</p>`;
    element.querySelector('img').src = url;
    document.body.appendChild(element);
    shown = element;
    const box = element.getBoundingClientRect();
    const start = from && box.width > 0
      ? `translate(${from.left - box.left}px, ${from.top - box.top}px) scale(${from.width / box.width})`
      : 'translateX(30px)';
    const slide = element.animate([
      { transform: start, opacity: 0.2, offset: 0 },
      { transform: 'none', opacity: 1, offset: 0.12 },
      { transform: 'none', opacity: 1, offset: 0.88 },
      { transform: `translateX(${box.width + 40}px)`, opacity: 0, offset: 1 },
    ], { duration: 5200, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
    slide.onfinish = () => {
      element.remove();
      if (shown === element) shown = null;
    };
  }

  // the frame between the hands in CSS pixels
  function frameRect(frame, view) {
    const [a, b] = frame.corners.map((corner) => ({
      x: (corner.x / view.aspect + 0.5) * view.width,
      y: (0.5 - corner.y) * view.height,
    }));
    const left = Math.min(a.x, b.x);
    const top = Math.min(a.y, b.y);
    return { left, top, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
  }

  // Call right after the effect has rendered: takes a requested picture.
  function capture() {
    if (!pending) return;
    const { frame, view } = pending;
    pending = null;
    const date = new Date();
    const out = compose();
    counts.taken++;
    flash();
    onShutter();
    const save = hands.mode !== 'demo';
    const name = `tron-snapshot-${stamp(date, '-', '')}.png`;
    const fonts = document.fonts?.load(`400 13px "${MARK_FONT}"`).catch(() => {}) ?? Promise.resolve();
    const fontTimeout = new Promise((done) => setTimeout(done, 400));
    Promise.race([fonts, fontTimeout]).then(() => {
      mark(out, date);
      out.toBlob((blob) => {
        if (!blob) return;
        if (last) URL.revokeObjectURL(last.url);
        const url = URL.createObjectURL(blob);
        last = { url, name };
        if (save) {
          const link = document.createElement('a');
          link.href = url;
          link.download = name;
          link.click();
          counts.saved++;
        }
        thumbnail(url, name, save, frameRect(frame, view));
      }, 'image/png');
    });
  }

  return {
    counts,
    request,
    capture,
    // the latest picture: { url, name }, for checking it
    get last() {
      return last;
    },
    clear() {
      pending = null;
    },
  };
}

// 20261006-201503 (or 2026-10-06 20:15:03 with other separators)
function stamp(date, between, within) {
  const pad = (value) => String(value).padStart(2, '0');
  const day = [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())];
  const time = [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())];
  return within === ''
    ? `${day.join('')}${between}${time.join('')}`
    : `${day.join('-')}${between}${time.join(within)}`;
}
