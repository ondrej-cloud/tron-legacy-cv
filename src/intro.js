// Intro screen. It first asks for the camera on a calm screen (the unlit
// title, a faint horizon, what the camera is for), then boots into the Grid,
// shows the controls and waits for both open palms, Enter or the button.
//
//   runIntro({ hands, onDone, returning })
//
// returning: true when the app hands the screen back after END OF LINE. The
// camera is already running, so there is no camera screen: the Grid reboots
// out of black (a quicker boot), then the controls and the way in as usual.
// Each call builds a fresh overlay; a run still on screen is torn down first.
//
// A full-screen overlay goes up immediately. The camera is only requested
// from the "Enable camera" button, or straight away when the permission was
// granted before, so the browser's prompt never covers the boot animation.
// onDone() is called the moment the way in starts, so the app begins
// rendering underneath; the overlay then folds into the horizon, which splits
// open like a seam of light, and removes itself.
//
// Pieces: intro-dom.js (markup, fonts), intro-copy.js (words), intro-grid.js
// (floor and horizon), intro-title.js, intro-glyphs.js (the controls' hand
// animations) and intro-overlay.js (tracked hands, palms progress, seam).
import { CONTROLS, CYAN, ORANGE, createGlyph } from './intro-glyphs.js';
import { GATE, promptState, systemState } from './intro-copy.js';
import { buildDom, loadFonts, loadStyles, shapeFrame } from './intro-dom.js';
import { createFloor } from './intro-grid.js';
import { createOverlay } from './intro-overlay.js';
import { createTitle } from './intro-title.js';

const FONT_TIMEOUT = 1500;       // ms to wait for the web fonts before showing anything

// Boot timelines in seconds. Reduced motion runs the same clock faster.
// logStep: delay between the system log's rows.
const BOOT = {
  log: 0.15,
  logStep: 0.3,
  horizon: 0.3,
  floor: 0.75,
  sweep: 1.45,
  sweepDuration: 0.8,
  subtitle: 2.2,
  glint: 2.7,
  manual: 2.85,
  enter: 3.5,
  ready: 3.9,
};
// The reboot after END OF LINE: the horizon stutters back on, the floor
// redraws and the title rezzes again, in about two and a half seconds.
const REBOOT = {
  log: 0.05,
  logStep: 0.12,
  horizon: 0.25,
  floor: 0.6,
  sweep: 0.95,
  sweepDuration: 0.6,
  subtitle: 1.45,
  glint: 1.8,
  manual: 1.7,
  enter: 2.2,
  ready: 2.45,
  reboot: true,
};
const REDUCED_SPEED = 3.3;
const PALMS_HOLD = 0.8;          // s both open palms must stay up to enter
const PALMS_DRAIN = 0.35;        // s for the progress to drain once they drop
const EXIT_TIME = 0.95;          // s
const REDUCED_EXIT_TIME = 0.4;   // s
const BACKDROP_READY = 0.86;     // how much black stays over the camera behind the manual
const FLOOR_SPEED = 0.16;        // floor depth units per second
const TYPE_RATE = 70;            // characters per second in the system log
// The hand tracker's first load and first inference block the main thread
// for up to half a second each. The boot waits for them (at most this long)
// so they can't stall the animation.
const TRACKER_WAIT = 10000;      // ms
// Demo mode: the scripted hands start with both palms open. Restarting the
// script this long after the manual is up gives people time to read it
// before the demo hands open the way in.
const DEMO_PALMS_AFTER = 3.2;    // s

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const smooth = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const easeInOut = (value) => {
  const t = clamp01(value);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};
const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

function setData(element, key, value) {
  if (element.dataset[key] !== value) element.dataset[key] = value;
}

// Resolves true when the camera can be opened without a prompt. Safari and
// older browsers don't know the 'camera' permission name, hence the catch.
async function cameraAllowed() {
  try {
    const permission = await navigator.permissions?.query({ name: 'camera' });
    return permission?.state === 'granted';
  } catch {
    return false;
  }
}

// The run on screen, so that a new one can tear it down first.
let currentRun = null;

export function runIntro({ hands, onDone, returning = false }) {
  currentRun?.dispose();
  const timing = returning ? REBOOT : BOOT;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dom = buildDom();
  const { root } = dom;
  document.body.appendChild(root);
  document.body.classList.add('intro-open');
  const styles = loadStyles();
  const fonts = loadFonts();

  const floor = createFloor(dom.floor);
  const title = createTitle(dom.title, { reduced });
  const overlay = createOverlay({ canvas: dom.fx, ring: dom.ring, reduced });
  const glyphs = dom.glyphs.map((canvas, index) => createGlyph(canvas, CONTROLS[index], index * 0.45));
  const typed = new Map();
  const titleTiming = { sweep: { start: timing.sweep, duration: timing.sweepDuration }, glintAt: timing.glint };
  const streaks = [
    { lane: 2, start: timing.floor + 0.35, duration: 1.1, color: CYAN },
    { lane: -5, start: timing.floor + 0.8, duration: 1.3, color: CYAN },
    { depth: 1.6, direction: -1, start: timing.subtitle + 0.2, duration: 1.4, color: ORANGE },
  ];
  let nextStreak = timing.ready + 5;
  let streakCount = 0;

  let phase = 'loading';   // loading -> gate -> boot -> leaving -> done
  let frameId = 0;
  let framesSeen = 0;
  let lastMs = performance.now();
  let bootStartMs = 0;
  let seconds = 0;         // real time since the boot started
  let boot = 0;            // boot clock (s), jumps forward when skipped
  let skipped = 0;
  let manualSince = null;
  let ready = false;
  let demoRestarted = false;
  let palmProgress = 0;
  let trackerSettledAt = null;
  let exitHold = 0;        // frames to wait after onDone() before the exit moves
  let exitElapsed = 0;     // s; advanced in capped steps so a slow frame can't skip the exit
  let horizon = window.innerHeight * 0.4;
  let viewportHeight = window.innerHeight;
  let stillDirty = true;   // the gate screen only redraws when something changed
  let gateShown = false;
  let titleStale = false;  // fonts arrived mid-boot; rebuild the title once it is still

  function resize() {
    viewportHeight = window.innerHeight;
    floor.resize();
    overlay.resize();
    title.build();
    for (const glyph of glyphs) glyph.resize();
    reshape();
  }

  let resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  }

  // Layout is only read here (on resize, scroll and size changes), never in
  // the middle of a frame that has just written to the DOM.
  function reshape() {
    const cut = parseFloat(getComputedStyle(root).getPropertyValue('--cut')) || 14;
    shapeFrame(dom.frame, dom.manual.clientWidth, dom.manual.clientHeight, cut);
    measure();
  }

  function measure() {
    const box = dom.head.getBoundingClientRect();
    horizon = Math.min(viewportHeight - 60, box.bottom + Math.min(26, viewportHeight * 0.03));
    stillDirty = true;
  }

  // Text that types itself out, like a terminal printing it.
  function type(element, text) {
    let entry = typed.get(element);
    if (!entry || entry.text !== text) {
      entry = { text, since: seconds };
      typed.set(element, entry);
    }
    const shown = Math.floor((seconds - entry.since) * TYPE_RATE);
    setText(element, shown >= text.length ? text : `${text.slice(0, shown)}▌`);
    return shown >= text.length;
  }

  function updateLog() {
    if (boot < timing.log) return;
    const booting = returning ? 'Grid // reboot' : 'Grid // boot sequence';
    type(dom.logHead, ready ? 'Grid // online' : booting);
    const state = systemState(hands);
    dom.logRows.forEach((entry, index) => {
      if (boot < timing.log + timing.logStep * (index + 1)) return;
      const [label, value, tone] = state[entry.key];
      const labelDone = type(entry.label, label);
      if (labelDone !== entry.row.classList.contains('is-typed')) entry.row.classList.toggle('is-typed', labelDone);
      if (labelDone) {
        type(entry.value, value);
        setData(entry.value, 'state', tone);
      }
    });
  }

  function updateReveals() {
    for (const element of dom.reveals) {
      if (!element.classList.contains('is-on') && boot >= timing[element.dataset.at]) element.classList.add('is-on');
    }
    if (boot >= timing.subtitle && !dom.head.classList.contains('is-lit')) dom.head.classList.add('is-lit');
    if (manualSince === null && boot >= timing.manual) manualSince = seconds;
    if (!ready && boot >= timing.ready) {
      ready = true;
      root.classList.add('is-ready');
      dom.enterButton.focus({ preventScroll: true });
    }
  }

  function setGate(state) {
    const copy = GATE[state];
    dom.gate.dataset.state = state;
    setText(dom.gateLabel, copy.label);
    setText(dom.gateHeading, copy.heading);
    setText(dom.gateText, copy.text);
    setText(dom.gateNote, copy.note);
    for (const [button, action] of [[dom.gatePrimary, copy.primary], [dom.gateSecondary, copy.secondary]]) {
      button.hidden = !action;
      if (!action) continue;
      button.dataset.action = action[0];
      setText(button.firstElementChild ?? button, action[1]);
    }
    dom.gatePrimary.setAttribute('aria-disabled', String(state === 'waiting'));
    if (copy.primary && state !== 'waiting') dom.gatePrimary.focus({ preventScroll: true });
  }

  function showGate(state) {
    phase = 'gate';
    gateShown = true;
    setGate(state);
    dom.gate.classList.add('is-on');
  }

  function requestCamera() {
    setGate('waiting');
    hands.start();
    hands.cameraReady.then((granted) => {
      if (phase !== 'gate') return;   // the user went for the demo meanwhile
      if (granted) startTracking();
      else setGate(navigator.mediaDevices?.getUserMedia ? 'denied' : 'unsupported');
    });
  }

  // Camera on: hold the still screen until the tracker has loaded and run
  // once, then boot. frame() waits a few more frames so the first inference
  // (the slowest one) is behind us before anything moves.
  function startTracking() {
    showGate('starting');
    Promise.race([hands.ready, timeout(TRACKER_WAIT)]).then(() => {
      trackerSettledAt = framesSeen;
    });
  }

  // hands.start() only asks once, so a retry asks the browser directly and
  // reloads the page once the camera is allowed.
  async function retryCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      for (const track of stream.getTracks()) track.stop();
      location.reload();
    } catch {
      setGate('blocked');
    }
  }

  function onGateAction(event) {
    const button = event.currentTarget;
    if (phase !== 'gate' || button.getAttribute('aria-disabled') === 'true') return;
    const action = button.dataset.action;
    if (action === 'camera') {
      requestCamera();
    } else if (action === 'demo') {
      hands.setMode('demo');
      startBoot();
    } else if (action === 'retry') {
      retryCamera();
    }
  }

  function startBoot() {
    if (phase !== 'loading' && phase !== 'gate') return;
    phase = 'boot';
    dom.gate.classList.remove('is-on');
    root.classList.add('is-booting');
    bootStartMs = performance.now();
    if (root.contains(document.activeElement)) document.activeElement.blur();
  }

  function skipBoot() {
    if (phase !== 'boot' || ready) return;
    skipped += timing.ready - boot;
    boot = timing.ready;
    root.classList.add('is-instant');
    updateReveals();
    void root.offsetWidth;   // apply the end state before transitions come back
    requestAnimationFrame(() => root.classList.remove('is-instant'));
  }

  function openPalms() {
    const palms = { left: false, right: false };
    if (hands.mode === 'mouse') return palms;
    for (const hand of hands.list) palms[hand.id] = hand.gesture === 'open' && hand.palmFacing;
    return palms;
  }

  function spawnStreak() {
    streakCount++;
    const color = streakCount % 3 === 0 ? ORANGE : CYAN;
    if (streakCount % 2) {
      const lane = (streakCount % 4 < 2 ? 1 : -1) * (2 + (streakCount % 5));
      streaks.push({ lane, start: boot, duration: 1.3, color });
    } else {
      streaks.push({ depth: 1.4 + (streakCount % 3) * 0.6, direction: streakCount % 4 ? 1 : -1,
        start: boot, duration: 1.6, color });
    }
    nextStreak = boot + 6 + (streakCount % 3) * 2;
    while (streaks.length > 4) streaks.shift();
  }

  function leave() {
    if (phase === 'leaving') return;
    phase = 'leaving';
    // the app's first frames compile its shaders; let that pass before the fold starts
    exitHold = 2;
    dom.page.style.transformOrigin = `50% ${horizon + dom.page.scrollTop}px`;
    root.classList.add('is-leaving');
    document.body.classList.remove('intro-open');
    try {
      onDone?.();
    } catch (error) {
      console.error('intro: onDone failed', error);
    }
  }

  function finish() {
    if (phase === 'done') return;
    phase = 'done';
    cancelAnimationFrame(frameId);
    clearTimeout(resizeTimer);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onKeyDown, true);
    resizeObserver.disconnect();
    root.remove();
    styles.link.remove();
    document.body.classList.remove('intro-open');
    if (currentRun === run) currentRun = null;
  }

  // The gate is a still picture: redraw it only when the layout changed.
  function drawStill() {
    if (!stillDirty) return;
    stillDirty = false;
    floor.draw({
      t: 0, timing: BOOT, horizon, backdrop: 1, brightness: 1, scroll: 0, flare: 0,
      streaks: [], burst: { amount: 0, phase: 0 }, slit: null, dormant: 1,
    });
    title.draw(0, titleTiming, 1);
  }

  function frame() {
    frameId = requestAnimationFrame(frame);
    const nowMs = performance.now();
    const dt = Math.min(0.1, (nowMs - lastMs) / 1000);
    lastMs = nowMs;
    framesSeen++;
    if (phase === 'loading' || phase === 'done') return;
    // fade in only once the title has been drawn in its own font
    if (root.classList.contains('is-loading')) root.classList.remove('is-loading');
    if (phase === 'gate') {
      drawStill();
      if (trackerSettledAt !== null && framesSeen - trackerSettledAt >= 3) startBoot();
      return;
    }
    const leaving = phase === 'leaving';
    seconds = (nowMs - bootStartMs) / 1000;
    boot = seconds * (reduced ? REDUCED_SPEED : 1) + skipped;

    // DOM writes only from here on; layout is measured outside the frame
    updateReveals();
    updateLog();
    if (ready && titleStale && !title.animating(boot, titleTiming)) {
      titleStale = false;
      title.build();
    }
    // the unlit title and horizon of the camera screen go dark before the boot lights them
    const dormant = gateShown ? 1 - smooth(boot / 0.3) : 0;

    const palms = openPalms();
    const palmCount = Number(palms.left) + Number(palms.right);
    // scripted hands only count once the demo has been restarted on purpose
    const palmsArmed = ready && !leaving && (hands.mode !== 'demo' || demoRestarted);
    if (palmsArmed && palmCount === 2) palmProgress = Math.min(1, palmProgress + dt / PALMS_HOLD);
    else palmProgress = Math.max(0, palmProgress - dt / PALMS_DRAIN);
    if (palmProgress >= 1) leave();
    if (ready && hands.mode === 'demo' && !demoRestarted && boot >= timing.ready + DEMO_PALMS_AFTER) {
      demoRestarted = true;
      hands.setMode('demo');
    }

    if (boot >= timing.enter - 0.2) {
      const prompt = promptState(hands, palmCount);
      setText(dom.prompt, prompt.prompt);
      setText(dom.hint, prompt.hint);
      setData(dom.hint, 'tone', prompt.tone);
      if (root.classList.contains('is-mouse') !== (hands.mode === 'mouse')) root.classList.toggle('is-mouse');
    }
    if (ready && !reduced && boot >= nextStreak) spawnStreak();

    if (leaving && exitHold > 0) exitHold--;
    else if (leaving) exitElapsed += Math.min(dt, 1 / 30);
    const exit = clamp01(exitElapsed / (reduced ? REDUCED_EXIT_TIME : EXIT_TIME));
    let slit = null;
    // black behind everything until the backdrop thins out over the camera
    if ((leaving || boot >= timing.manual) && root.style.background !== 'transparent') {
      root.style.background = 'transparent';
    }
    if (leaving && reduced) {
      root.style.opacity = String(1 - exit);
    } else if (leaving) {
      // the page folds into the horizon line, which then splits open
      const fold = clamp01(exit / 0.3) ** 2;
      dom.page.style.transform = `scale(${1 + 0.05 * fold}, ${Math.max(0.002, 1 - fold)})`;
      dom.page.style.opacity = String(1 - smooth((exit - 0.16) / 0.16));
      const open = easeInOut((exit - 0.2) / 0.75);
      slit = {
        top: horizon - open * (horizon + 80),
        bottom: horizon + open * (viewportHeight - horizon + 80),
      };
    }

    floor.draw({
      t: boot,
      timing,
      horizon,
      backdrop: 1 - (1 - BACKDROP_READY) * smooth((boot - timing.manual) / 1.2),
      brightness: 1 + (leaving ? 1.6 * (1 - exit) : 0),
      scroll: reduced ? 0 : seconds * FLOOR_SPEED * (1 + (leaving ? 14 * exit : 0)),
      flare: slit ? 1.6 * smooth(exit / 0.22) * (1 - smooth((exit - 0.22) / 0.3)) : 0,
      reboot: Boolean(timing.reboot) && !reduced,
      streaks,
      burst: { amount: slit ? 1 - smooth((exit - 0.3) / 0.4) : 0, phase: clamp01(exit / 0.6) },
      slit,
      dormant,
    });
    if (!leaving) {
      title.draw(boot, titleTiming, dormant);
      if (manualSince !== null) {
        const shown = seconds - manualSince;
        // each glyph starts as its row fades in, so they don't all begin in one frame
        glyphs.forEach((glyph, index) => {
          if (shown >= 0.3 + index * 0.07) glyph.draw(shown);
        });
      }
      if (boot >= timing.enter - 0.2) overlay.drawRing(palms, palmProgress, seconds);
    }
    overlay.draw({
      hands,
      palms,
      progress: palmProgress,
      alpha: smooth((boot - timing.manual) / 0.8) * (1 - smooth(exit / 0.3)),
      seam: slit && { ...slit, alpha: 1 - smooth((exit - 0.75) / 0.25) },
    });

    if (exit >= 1) finish();
  }

  function onKeyDown(event) {
    if (phase === 'leaving' || event.metaKey || event.ctrlKey || event.altKey) return;
    if (phase === 'gate') {
      // Enter means the primary button, unless another button has the focus
      const onButton = event.target instanceof HTMLButtonElement && root.contains(event.target);
      if (event.key === 'Enter' && !onButton) {
        event.preventDefault();
        dom.gatePrimary.click();
      }
      return;
    }
    if (phase !== 'boot') return;
    // N mutes the music (music.js); a link keeps its own Enter
    if (event.key.toLowerCase() === 'n' || event.target instanceof HTMLAnchorElement) return;
    const confirm = event.key === 'Enter' || event.key === ' ';
    if (!ready) {
      if (event.key === 'Tab' || event.key === 'Shift') return;
      if (confirm) event.preventDefault();
      skipBoot();
      return;
    }
    if (confirm) {
      event.preventDefault();
      leave();
    }
  }

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', onResize);
  root.addEventListener('pointerdown', () => skipBoot());
  dom.page.addEventListener('scroll', measure, { passive: true });
  dom.enterButton.addEventListener('click', () => (ready ? leave() : skipBoot()));
  dom.gatePrimary.addEventListener('click', onGateAction);
  dom.gateSecondary.addEventListener('click', onGateAction);
  const resizeObserver = new ResizeObserver(reshape);
  resizeObserver.observe(dom.manual);
  resizeObserver.observe(dom.head);

  const run = { dispose: finish };
  currentRun = run;

  let fontsArrived = false;
  fonts.then(() => {
    fontsArrived = true;
  });
  Promise.all([styles.loaded, Promise.race([fonts, timeout(FONT_TIMEOUT)])]).then(async () => {
    if (phase === 'done') return;
    // runs that skip the camera screen start booting before transitions are
    // switched on, so the title block starts hidden instead of fading out
    const bootNow = returning || hands.mode === 'demo';
    if (bootNow) startBoot();
    void root.offsetWidth;
    root.classList.remove('is-instant');
    resize();
    if (!fontsArrived) {
      // too slow: start with fallback fonts and swap the title in while it is still
      fonts.then(() => {
        if (phase === 'done') return;
        if (phase === 'boot' || phase === 'leaving') {
          titleStale = true;
        } else {
          title.build();
          stillDirty = true;
        }
      });
    }
    frameId = requestAnimationFrame(frame);
    if (returning) return;   // the camera is already running
    const allowed = await cameraAllowed();
    if (phase === 'done') return;
    if (bootNow) {
      // the demo needs no camera; use it as the background only if it's already allowed
      if (allowed) hands.start();
    } else if (allowed || hands.started) {
      hands.start();
      hands.cameraReady.then((granted) => (granted ? startTracking() : showGate('denied')));
    } else {
      showGate('ask');
    }
  });
}
