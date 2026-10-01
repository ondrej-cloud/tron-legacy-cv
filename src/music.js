// Background music: one looping track at a time, crossfaded with Web Audio so
// loops are gapless. Tracks are optional files in audio/; a missing file is
// simply silent. Browsers only allow sound after the user has interacted with
// the page, so anything requested earlier starts on the first click or key.
// N mutes and unmutes (remembered in the browser).

// name -> file in audio/. Empty until the tracks are added; play() of a track
// that isn't listed does nothing.
const TRACKS = {};
const VOLUME = 0.55;
const CROSSFADE = 1.6;   // s
const MUTE_KEY = 'tron-legacy-cv:muted';

export function createMusic() {
  let context = null;
  let master = null;
  let current = null;        // { name, source, gain }
  let wanted = null;         // track to play once audio is unlocked
  const buffers = new Map(); // name -> Promise<AudioBuffer | null>
  let muted = false;
  try {
    muted = localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    // storage blocked: start unmuted
  }

  function load(name) {
    if (!buffers.has(name)) {
      buffers.set(name, fetch(TRACKS[name])
        .then((response) => (response.ok ? response.arrayBuffer() : null))
        .then((data) => (data ? context.decodeAudioData(data) : null))
        .catch(() => null));
    }
    return buffers.get(name);
  }

  function unlock() {
    if (!context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : VOLUME;
      master.connect(context.destination);
    }
    if (context.state === 'suspended') context.resume();
    if (wanted && current?.name !== wanted) start(wanted);
  }
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  function fadeOutCurrent(seconds) {
    if (!current) return;
    const { source, gain } = current;
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + seconds);
    source.stop(now + seconds + 0.05);
    current = null;
  }

  async function start(name) {
    if (!TRACKS[name]) return;
    const buffer = await load(name);
    if (!buffer || wanted !== name || current?.name === name) return;
    fadeOutCurrent(CROSSFADE);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(1, context.currentTime + CROSSFADE);
    source.connect(gain).connect(master);
    source.start();
    current = { name, source, gain };
  }

  function setMuted(value) {
    muted = value;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // not fatal
    }
    if (master) master.gain.setTargetAtTime(muted ? 0 : VOLUME, context.currentTime, 0.1);
  }

  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key.toLowerCase() === 'n') setMuted(!muted);
  });

  return {
    // crossfade to a track (it starts as soon as the browser allows audio)
    play(name) {
      wanted = name;
      if (context && context.state !== 'closed') start(name);
    },
    // fade the current track out over `seconds` (e.g. END OF LINE)
    fadeOut(seconds = 3) {
      wanted = null;
      if (context) fadeOutCurrent(seconds);
    },
    get muted() {
      return muted;
    },
    hasTracks: Object.keys(TRACKS).length > 0,
    setMuted,
  };
}
