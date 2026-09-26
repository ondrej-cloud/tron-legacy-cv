// Live tuning panel for the gesture recognition (key G, or ?tune).
//
// For each visible hand it shows the raw measurements next to the thresholds
// they're compared with: how straight each finger is, how far the thumb tip
// is from each fingertip, which way the palm faces. The sliders edit
// THRESHOLDS in place, are remembered in localStorage, and "Copy as code"
// puts the current values on the clipboard ready to paste into gestures.js.

import { THRESHOLDS, DEFAULT_THRESHOLDS, FINGERS } from './gestures.js';

const STORAGE_KEY = 'tron-legacy-cv:thresholds';

const SLIDERS = [
  { key: 'extendedStraightness', label: 'finger straight >', min: 0, max: 1, step: 0.01 },
  { key: 'thumbStraightness', label: 'thumb straight >', min: 0, max: 1, step: 0.01 },
  { key: 'thumbOutDistance', label: 'thumb out >', min: 0, max: 1.5, step: 0.01 },
  { key: 'thumbUpLift', label: 'thumbs-up lift >', min: 0, max: 1, step: 0.01 },
  { key: 'touchOn', label: 'touch on <', min: 0, max: 1, step: 0.01 },
  { key: 'touchOff', label: 'touch off >', min: 0, max: 1.2, step: 0.01 },
  { key: 'pinchRatioClosed', label: 'pinch closed at', min: 0, max: 1, step: 0.01 },
  { key: 'pinchRatioOpen', label: 'pinch open at', min: 0.5, max: 2, step: 0.01 },
  { key: 'gestureHoldMs', label: 'gesture hold ms', min: 0, max: 400, step: 10 },
];

// straightness is a mean cosine (-1..1); touch distances are in palm sizes
const STRAIGHT_RANGE = [-1, 1];
const TOUCH_RANGE = [0, 1.5];

const STYLE = `
.tn-root { position: fixed; inset: 0; pointer-events: none; z-index: 20;
  font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; color: #d9f8ff; }
.tn-root[hidden] { display: none; }
.tn-panel { position: absolute; pointer-events: auto; padding: 10px 12px; border-radius: 4px;
  background: rgba(2,10,16,.78); box-shadow: 0 0 0 1px rgba(111,243,255,.25); }
.tn-hand { top: 14px; width: 350px; }
.tn-hand.left { left: 14px; }
.tn-hand.right { right: 14px; }
.tn-hand h3, .tn-controls h3 { margin: 0 0 6px; font-size: 11px; letter-spacing: .14em; color: #6ff3ff; }
.tn-line { color: rgba(217,248,255,.8); margin-bottom: 2px; }
.tn-line b { color: #fff; font-weight: 600; }
.tn-grid { display: grid; grid-template-columns: 44px 1fr 14px 1fr; gap: 3px 8px; align-items: center; margin-top: 6px; }
.tn-grid .head { color: rgba(217,248,255,.45); }
.tn-bar { position: relative; height: 8px; background: rgba(111,243,255,.08); }
.tn-bar .fill { position: absolute; left: 0; top: 0; bottom: 0; background: rgba(111,243,255,.55); }
.tn-bar .fill.on { background: #ff8a1f; }
.tn-bar .tick { position: absolute; top: -2px; bottom: -2px; width: 1px; background: #fff; }
.tn-bar .tick.off { background: rgba(255,255,255,.45); }
.tn-bar .value { position: absolute; right: 2px; top: -1px; font-size: 9px; color: rgba(255,255,255,.75); }
.tn-controls { left: 50%; bottom: 52px; transform: translateX(-50%); width: min(600px, calc(100vw - 28px)); }
.tn-sliders { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; }
.tn-slider { display: grid; grid-template-columns: 124px 1fr 40px; align-items: center; gap: 6px; white-space: nowrap; }
.tn-slider input { width: 100%; accent-color: #6ff3ff; }
.tn-slider output { text-align: right; color: #fff; }
.tn-buttons { display: flex; gap: 8px; margin-top: 8px; align-items: center; }
.tn-buttons button { font: inherit; color: #d9f8ff; background: rgba(111,243,255,.1); cursor: pointer;
  border: 1px solid rgba(111,243,255,.35); border-radius: 3px; padding: 4px 10px; }
.tn-buttons button:hover { background: rgba(111,243,255,.2); }
.tn-buttons span { color: rgba(217,248,255,.55); }
.tn-tracker { margin-top: 8px; color: rgba(217,248,255,.6); }
@media (max-width: 760px) {
  .tn-hand { width: calc(50vw - 21px); }
  .tn-sliders { grid-template-columns: 1fr; }
}
`;

function loadSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    for (const key of Object.keys(DEFAULT_THRESHOLDS)) {
      if (typeof saved?.[key] === 'number') THRESHOLDS[key] = saved[key];
    }
  } catch {
    // storage blocked or corrupt: keep the defaults
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(THRESHOLDS));
  } catch {
    // not fatal, the values just won't survive a reload
  }
}

function asCode() {
  const lines = Object.entries(THRESHOLDS).map(([key, value]) => `  ${key}: ${value},`);
  return `export const THRESHOLDS = {\n${lines.join('\n')}\n};\n`;
}

function bar(range) {
  const element = document.createElement('div');
  element.className = 'tn-bar';
  element.innerHTML = '<div class="fill"></div><div class="tick"></div><div class="tick off"></div><span class="value"></span>';
  const [fill, tick, offTick, value] = element.children;
  const toPercent = (number) => `${Math.min(100, Math.max(0, (number - range[0]) / (range[1] - range[0]) * 100))}%`;
  return {
    element,
    set(number, threshold, { offThreshold = null, active = false } = {}) {
      fill.style.width = toPercent(number);
      fill.classList.toggle('on', active);
      tick.style.left = toPercent(threshold);
      offTick.style.display = offThreshold === null ? 'none' : '';
      if (offThreshold !== null) offTick.style.left = toPercent(offThreshold);
      value.textContent = number.toFixed(2);
    },
  };
}

function createHandPanel(side) {
  const panel = document.createElement('section');
  panel.className = `tn-panel tn-hand ${side}`;
  panel.innerHTML = `<h3>${side.toUpperCase()} HAND</h3>
    <div class="tn-line" data-role="identity"></div>
    <div class="tn-line" data-role="gesture"></div>
    <div class="tn-grid"><span class="head">finger</span><span class="head">straightness</span>
      <span class="head">ext</span><span class="head">thumb tip → tip</span></div>`;
  const grid = panel.querySelector('.tn-grid');
  const rows = {};
  for (const finger of FINGERS) {
    const name = document.createElement('span');
    name.textContent = finger;
    const straight = bar(STRAIGHT_RANGE);
    const extended = document.createElement('span');
    const touch = bar(TOUCH_RANGE);
    if (finger === 'thumb') touch.element.title = 'thumb tip to index knuckle (thumb out)';
    grid.append(name, straight.element, extended, touch.element);
    rows[finger] = { straight, extended, touch };
  }
  return {
    panel,
    identity: panel.querySelector('[data-role="identity"]'),
    gesture: panel.querySelector('[data-role="gesture"]'),
    rows,
  };
}

function updateHandPanel(view, hand, hands) {
  if (!hand.visible || !hand.fingers) {
    view.identity.textContent = 'not tracked';
    view.gesture.textContent = '';
    view.panel.style.opacity = '0.45';
    return;
  }
  view.panel.style.opacity = '';
  const analysis = hand.fingers;
  const labelInfo = hand.label
    ? ` · mediapipe says ${hand.label} (${hands.labelSwapScore > 0 ? 'swapped' : 'as is'})` : '';
  view.identity.innerHTML = `real hand <b>${hand.physical}</b>${labelInfo}`;
  view.gesture.innerHTML = `gesture <b>${hand.gesture}</b> (raw ${analysis.gesture}) · palm <b>${
    hand.palmFacing ? 'facing' : 'away'}</b> ${analysis.palmNormalZ >= 0 ? '+' : ''}${
    analysis.palmNormalZ.toFixed(2)} · pinch ${hand.pinch.toFixed(2)}${analysis.indexFolded ? ' · index folded' : ''}`;
  for (const finger of FINGERS) {
    const row = view.rows[finger];
    const isThumb = finger === 'thumb';
    row.straight.set(analysis.straight[finger],
      isThumb ? THRESHOLDS.thumbStraightness : THRESHOLDS.extendedStraightness,
      { active: analysis.extended[finger] });
    row.extended.textContent = analysis.extended[finger] ? '●' : '·';
    if (isThumb) {
      row.touch.set(analysis.thumbOut, THRESHOLDS.thumbOutDistance, { active: analysis.thumbOut > THRESHOLDS.thumbOutDistance });
    } else {
      row.touch.set(analysis.touch[finger], THRESHOLDS.touchOn,
        { offThreshold: THRESHOLDS.touchOff, active: hand.touching[finger] });
    }
  }
}

export function createTuningPanel(hands) {
  loadSaved();

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'tn-root';
  root.hidden = !new URLSearchParams(location.search).has('tune');
  document.body.appendChild(root);
  // keep clicks on the panel from counting as a pinch in mouse mode
  root.addEventListener('pointerdown', (event) => event.stopPropagation());

  const views = { left: createHandPanel('left'), right: createHandPanel('right') };
  root.append(views.left.panel, views.right.panel);

  const controls = document.createElement('section');
  controls.className = 'tn-panel tn-controls';
  controls.innerHTML = '<h3>THRESHOLDS</h3><div class="tn-sliders"></div>'
    + '<div class="tn-buttons"><button data-action="copy">Copy as code</button>'
    + '<button data-action="reset">Reset</button><span data-role="note">G closes this panel</span></div>'
    + '<div class="tn-line tn-tracker" data-role="tracker"></div>';
  root.appendChild(controls);
  const note = controls.querySelector('[data-role="note"]');
  const trackerLine = controls.querySelector('[data-role="tracker"]');

  const inputs = new Map();
  for (const slider of SLIDERS) {
    const row = document.createElement('label');
    row.className = 'tn-slider';
    row.innerHTML = `<span>${slider.label}</span>
      <input type="range" min="${slider.min}" max="${slider.max}" step="${slider.step}">
      <output></output>`;
    const input = row.querySelector('input');
    const output = row.querySelector('output');
    input.addEventListener('input', () => {
      THRESHOLDS[slider.key] = Number(input.value);
      // touch has to release further out than it engages, or it would flicker
      if (THRESHOLDS.touchOff < THRESHOLDS.touchOn + 0.02) THRESHOLDS.touchOff = THRESHOLDS.touchOn + 0.02;
      if (THRESHOLDS.pinchRatioOpen < THRESHOLDS.pinchRatioClosed + 0.1) {
        THRESHOLDS.pinchRatioOpen = THRESHOLDS.pinchRatioClosed + 0.1;
      }
      syncInputs();
      save();
    });
    controls.querySelector('.tn-sliders').appendChild(row);
    inputs.set(slider.key, { input, output });
  }

  function syncInputs() {
    for (const [key, { input, output }] of inputs) {
      input.value = THRESHOLDS[key];
      output.textContent = key === 'gestureHoldMs' ? THRESHOLDS[key] : THRESHOLDS[key].toFixed(2);
    }
  }
  syncInputs();

  controls.querySelector('[data-action="reset"]').addEventListener('click', () => {
    Object.assign(THRESHOLDS, DEFAULT_THRESHOLDS);
    syncInputs();
    save();
    note.textContent = 'back to the defaults';
  });
  controls.querySelector('[data-action="copy"]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(asCode());
      note.textContent = 'copied, paste over THRESHOLDS in src/gestures.js';
    } catch {
      console.log(asCode());
      note.textContent = 'clipboard blocked, values printed to the console';
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key.toLowerCase() === 'g') root.hidden = !root.hidden;
  });

  return {
    update() {
      if (root.hidden) return;
      updateHandPanel(views.left, hands.left, hands);
      updateHandPanel(views.right, hands.right, hands);
      const stats = hands.trackerStats;
      trackerLine.textContent = hands.trackerMode
        ? `tracker: ${hands.trackerMode} · ${stats.fps.toFixed(0)} results/s · longest gap ${stats.maxGapMs} ms`
          + ` · hands lost ${stats.lost}`
        : `tracker: ${hands.status}`;
    },
  };
}
