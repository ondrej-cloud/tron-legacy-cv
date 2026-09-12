// On-screen chrome: a tracking status pill and the keyboard shortcuts
// (H hide UI, F fullscreen, D demo, M mouse, C camera; G is in tuning.js).

const STYLE = `
.sd-ui { position: fixed; inset: 0; pointer-events: none; z-index: 10;
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: rgba(225,248,255,.85); }
.sd-ui.hidden .sd-hideable { opacity: 0; }
.sd-hideable { transition: opacity .4s ease; }
.sd-status { position: absolute; right: 18px; bottom: 18px; padding: 6px 12px; border-radius: 4px;
  background: rgba(4,12,18,.5); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 0 0 1px rgba(111,243,255,.18); white-space: nowrap; letter-spacing: .04em; }
.sd-status b { font-weight: 600; color: #fff; text-transform: uppercase; }
.sd-keys { position: absolute; left: 22px; bottom: 24px; color: rgba(225,248,255,.4);
  text-shadow: 0 1px 8px rgba(0,0,0,.6); letter-spacing: .04em; }
@media (max-width: 760px) { .sd-keys { display: none; } }
`;

export function createUI(hands) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'sd-ui';
  root.innerHTML = `
    <div class="sd-status sd-hideable"></div>
    <div class="sd-keys sd-hideable">H hide UI · F fullscreen · G tune gestures · D demo · M mouse · C camera</div>`;
  document.body.appendChild(root);
  const status = root.querySelector('.sd-status');

  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'h') root.classList.toggle('hidden');
    else if (key === 'f') toggleFullscreen();
    else if (key === 'd') hands.setMode(hands.mode === 'demo' ? 'camera' : 'demo');
    else if (key === 'm') hands.setMode('mouse');
    else if (key === 'c') hands.setMode('camera');
  });

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  function update() {
    const working = hands.status === 'ready' || hands.status === hands.mode;
    const gestures = hands.list.map((hand) => hand.gesture).join(' + ');
    status.innerHTML = `<b>${hands.mode}</b> · ${working
      ? `hands: ${hands.list.length}${gestures ? ` · ${gestures}` : ''}` : hands.status}`;
  }

  return { root, update };
}
