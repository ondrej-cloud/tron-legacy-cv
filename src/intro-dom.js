// The intro's markup, its stylesheet and its web fonts.
import { CONTROLS } from './intro-glyphs.js';
import { TITLE_FONT } from './intro-title.js';

const MUSIC_CREDIT_URL = 'https://pixabay.com/music/synthwave-the-arcade-city-cinematic-hybrid-music-519731/';
const CYCLE_CREDIT_URL = 'https://dreamloft3d.itch.io/tron-light-cycle';
const ARENA_CREDIT_URL = 'https://sketchfab.com/3d-models/tron-race-arena-87d91ccd75d4445f8ab0f70288e827af';
const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Michroma&family=Rajdhani:wght@500;600;700&display=swap';

let fontsReady = null;

// Resolves once the title and UI fonts can be drawn (or failed to load).
export function loadFonts() {
  if (fontsReady) return fontsReady;
  const origins = [['https://fonts.googleapis.com', false], ['https://fonts.gstatic.com', true]];
  for (const [href, crossOrigin] of origins) {
    const hint = document.createElement('link');
    hint.rel = 'preconnect';
    hint.href = href;
    if (crossOrigin) hint.crossOrigin = '';
    document.head.appendChild(hint);
  }
  const sheet = document.createElement('link');
  sheet.rel = 'stylesheet';
  sheet.href = FONTS_URL;
  document.head.appendChild(sheet);
  fontsReady = new Promise((resolve) => {
    sheet.onload = resolve;
    sheet.onerror = resolve;
  }).then(() => Promise.all([
    document.fonts.load(`400 64px "${TITLE_FONT}"`, 'TRON LEGACY'),
    document.fonts.load('600 16px "Rajdhani"'),
    document.fonts.load('700 16px "Rajdhani"'),
  ])).catch(() => {});
  return fontsReady;
}

export function loadStyles() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./intro.css', import.meta.url).href;
  document.head.appendChild(link);
  const loaded = new Promise((resolve) => {
    link.onload = resolve;
    link.onerror = resolve;
    setTimeout(resolve, 1500);
  });
  return { link, loaded };
}

export function buildDom() {
  const root = document.createElement('div');
  // no transitions until the stylesheet has put everything in its start state,
  // and nothing visible until the title can be drawn in its own font
  root.className = 'intro is-instant is-loading';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'intro-heading');
  // cover the page right away, before the stylesheet arrives
  root.style.cssText = 'position: fixed; inset: 0; z-index: 1000; background: #000;';
  const touch = window.matchMedia('(hover: none)').matches;
  root.innerHTML = `
    <canvas class="intro-floor" aria-hidden="true"></canvas>
    <div class="intro-page">
      <header class="intro-head">
        <h1 id="intro-heading" class="intro-sr">Tron Legacy, a computer vision project</h1>
        <canvas class="intro-title" aria-hidden="true"></canvas>
        <p class="intro-subtitle"><span>Computer vision project</span></p>
        <p class="intro-fan">Unofficial fan project · not affiliated with Disney</p>
      </header>
      <div class="intro-log" aria-label="System status">
        <div class="intro-log-head"></div>
        ${['camera', 'tracker', 'input', 'hands'].map((key) => `
          <div class="intro-log-row" data-row="${key}">
            <span class="label"></span><span class="leader"></span><span class="value"></span>
          </div>`).join('')}
      </div>
      <p class="intro-credit" data-at="manual">
        Music · <a href="${MUSIC_CREDIT_URL}" target="_blank" rel="noopener noreferrer">The Arcade City by
        Luis_Humanoide (Pixabay)</a>
        <span class="intro-credit-model">Light cycle model · <a href="${CYCLE_CREDIT_URL}" target="_blank"
        rel="noopener noreferrer">Dreamloft3D (CC BY 4.0)</a></span>
        <span class="intro-credit-model">Arena model · <a href="${ARENA_CREDIT_URL}" target="_blank"
        rel="noopener noreferrer">SpringSociety (CC BY 4.0)</a></span>
        <span class="intro-credit-key"><kbd>N</kbd> mutes the music</span>
      </p>
      <div class="intro-stage">
        <section class="intro-gate" aria-labelledby="intro-gate-heading" aria-describedby="intro-gate-text">
          <p class="intro-gate-label"></p>
          <h2 id="intro-gate-heading"></h2>
          <p class="intro-gate-text" id="intro-gate-text"></p>
          <p class="intro-gate-note"></p>
          <div class="intro-gate-progress" aria-hidden="true"></div>
          <div class="intro-gate-actions">
            <button class="intro-button intro-gate-primary" type="button"><span></span><kbd>Enter</kbd></button>
            <button class="intro-link intro-gate-secondary" type="button"></button>
          </div>
        </section>
        <section class="intro-manual" data-at="manual" aria-labelledby="intro-manual-heading">
          <svg class="intro-frame" aria-hidden="true"><path class="edge" pathLength="1"></path><path class="accent" pathLength="1"></path></svg>
          <div class="intro-manual-head">
            <h2 id="intro-manual-heading">Controls</h2>
            <p>Use either hand. Each hand has its own colour.</p>
          </div>
          <ul class="intro-controls">
            ${CONTROLS.map((control, index) => `
              <li class="intro-control${control.placeholder ? ' is-placeholder' : ''}" style="--i: ${index}">
                <canvas class="intro-glyph" aria-hidden="true"></canvas>
                <div>
                  <h3>${control.name}</h3>
                  <p class="action">${control.action}</p>
                  <p class="detail">${control.detail}</p>
                </div>
              </li>`).join('')}
          </ul>
        </section>
      </div>
      <footer class="intro-enter" data-at="enter">
        <div class="intro-palms">
          <canvas class="intro-ring" aria-hidden="true"></canvas>
          <div>
            <p class="intro-prompt" id="intro-prompt"></p>
            <p class="intro-hint"></p>
          </div>
        </div>
        <button class="intro-button intro-enter-button" type="button"><span>Enter the Grid</span><kbd>Enter</kbd></button>
      </footer>
    </div>
    <canvas class="intro-fx" aria-hidden="true"></canvas>
    <p class="intro-skip">${touch ? 'Tap to skip' : 'Press any key to skip'}</p>`;
  const find = (selector) => root.querySelector(selector);
  return {
    root,
    floor: find('.intro-floor'),
    fx: find('.intro-fx'),
    page: find('.intro-page'),
    head: find('.intro-head'),
    title: find('.intro-title'),
    logHead: find('.intro-log-head'),
    logRows: [...root.querySelectorAll('.intro-log-row')].map((row) => ({
      key: row.dataset.row,
      row,
      label: row.querySelector('.label'),
      value: row.querySelector('.value'),
    })),
    gate: find('.intro-gate'),
    gateLabel: find('.intro-gate-label'),
    gateHeading: find('#intro-gate-heading'),
    gateText: find('.intro-gate-text'),
    gateNote: find('.intro-gate-note'),
    gatePrimary: find('.intro-gate-primary'),
    gateSecondary: find('.intro-gate-secondary'),
    manual: find('.intro-manual'),
    frame: find('.intro-frame'),
    glyphs: [...root.querySelectorAll('.intro-glyph')],
    ring: find('.intro-ring'),
    prompt: find('.intro-prompt'),
    hint: find('.intro-hint'),
    enterButton: find('.intro-enter-button'),
    reveals: [...root.querySelectorAll('[data-at]')],
  };
}

// The controls card's outline: chamfered corners, with brighter strokes
// along them. `cut` is the chamfer in CSS pixels.
export function shapeFrame(frame, width, height, cut) {
  frame.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const [edge, accent] = frame.querySelectorAll('path');
  edge.setAttribute('d', `M${cut + 0.5} 0.5 H${width - 0.5} V${height - cut - 0.5} `
    + `L${width - cut - 0.5} ${height - 0.5} H0.5 V${cut + 0.5} Z`);
  accent.setAttribute('d', `M0.5 ${cut + 26} V${cut + 0.5} L${cut + 0.5} 0.5 H${cut + 64} `
    + `M${width - 0.5} ${height - cut - 26} V${height - cut - 0.5} L${width - cut - 0.5} ${height - 0.5} `
    + `H${width - cut - 64}`);
}
