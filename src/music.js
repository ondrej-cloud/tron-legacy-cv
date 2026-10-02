// Background music and sound effects.
//
// One track plays throughout: muffled and quiet behind the intro, opening up
// to full when the user enters the Grid, and slowing to a stop like a tape
// when the Grid powers down (END OF LINE). The track has a fade-out tail, so
// it loops over its main body with a short crossfade instead of end to end.
// Sound effects are synthesised (src/sfx.js). Browsers only allow audio after
// the user has interacted with the page, so anything requested earlier starts
// on the first click or key. N mutes and unmutes (remembered in the browser).

import { createSfx } from './sfx.js';

const TRACK = {
  url: 'audio/the-arcade-city.mp3',
  loopStart: 0.33,   // s, after the leading silence
  loopEnd: 77.9,     // s, where the outro tail begins
  crossfade: 1.6,    // s, between the end of one pass and the next
};
const MODES = {
  intro: { volume: 0.32, cutoff: 700 },    // distant, through a low-pass filter
  grid: { volume: 0.7, cutoff: 20000 },
};
const MODE_CHANGE = 1.1;   // s
const MUTE_KEY = 'tron-legacy-cv:muted';

export function createMusic() {
  let context = null;
  let master = null;     // mute
  let musicBus = null;   // music volume
  let filter = null;     // intro muffling
  let buffer = null;
  let loading = null;
  let voices = [];       // { source, gain, endsAt }
  let loopTimer = 0;
  let mode = null;       // wanted mode: 'intro' | 'grid' | null (stopped)
  let playing = false;
  let sfx = null;
  let muted = false;
  try {
    muted = localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    // storage blocked: start unmuted
  }

  function unlock() {
    if (!context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : 1;
      // a limiter, so music and effects together never clip
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.15;
      master.connect(limiter).connect(context.destination);
      filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.7;
      musicBus = context.createGain();
      musicBus.gain.value = 0;
      filter.connect(musicBus).connect(master);
      sfx = createSfx(context, master);
    }
    if (context.state === 'suspended') context.resume();
    if (mode) apply();
  }
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  function loadTrack() {
    loading ??= fetch(TRACK.url)
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .then((data) => (data ? context.decodeAudioData(data) : null))
      .then((decoded) => { buffer = decoded; })
      .catch(() => {});
    return loading;
  }

  // Starts one pass of the loop at `when`, fading in over `fadeIn`, and
  // schedules the next pass to start a crossfade before this one ends.
  function startPass(when, fadeIn) {
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(1, when + fadeIn);
    const length = TRACK.loopEnd - TRACK.loopStart;
    const endsAt = when + length;
    gain.gain.setValueAtTime(1, endsAt - TRACK.crossfade);
    gain.gain.linearRampToValueAtTime(0, endsAt);
    source.connect(gain).connect(filter);
    source.start(when, TRACK.loopStart, length);
    source.stop(endsAt + 0.05);
    const voice = { source, gain, endsAt };
    voices.push(voice);
    source.onended = () => { voices = voices.filter((other) => other !== voice); };
    const nextAt = endsAt - TRACK.crossfade;
    clearTimeout(loopTimer);
    loopTimer = setTimeout(() => {
      if (playing) startPass(nextAt, TRACK.crossfade);
    }, Math.max(0, (nextAt - context.currentTime - 1) * 1000));
  }

  async function apply() {
    await loadTrack();
    if (!buffer || !mode) return;
    const target = MODES[mode];
    const now = context.currentTime;
    if (!playing) {
      playing = true;
      filter.frequency.setValueAtTime(target.cutoff, now);
      musicBus.gain.setValueAtTime(0, now);
      musicBus.gain.linearRampToValueAtTime(target.volume, now + 2);
      startPass(now + 0.05, 0.05);
      return;
    }
    filter.frequency.cancelScheduledValues(now);
    filter.frequency.setTargetAtTime(target.cutoff, now, MODE_CHANGE / 3);
    musicBus.gain.cancelScheduledValues(now);
    musicBus.gain.setTargetAtTime(target.volume, now, MODE_CHANGE / 3);
  }

  // Tape stop: everything playing slows down, drops in pitch and fades out.
  function tapeStop(seconds) {
    clearTimeout(loopTimer);
    playing = false;
    const now = context.currentTime;
    for (const { source } of voices) {
      source.playbackRate.cancelScheduledValues(now);
      source.playbackRate.setValueAtTime(1, now);
      source.playbackRate.exponentialRampToValueAtTime(0.2, now + seconds * 0.7);
      source.stop(now + seconds + 0.1);
    }
    musicBus.gain.cancelScheduledValues(now);
    musicBus.gain.setValueAtTime(musicBus.gain.value, now);
    musicBus.gain.linearRampToValueAtTime(0, now + seconds);
    filter.frequency.cancelScheduledValues(now);
    filter.frequency.setTargetAtTime(400, now, seconds / 3);
    voices = [];
  }

  function setMuted(value) {
    muted = value;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // not fatal
    }
    if (master) master.gain.setTargetAtTime(muted ? 0 : 1, context.currentTime, 0.1);
  }

  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key.toLowerCase() === 'n') setMuted(!muted);
  });

  // Sound effects are only available once audio is unlocked; before that
  // they are silently skipped.
  const effects = new Proxy({}, {
    get: (target, name) => (...args) => sfx?.[name]?.(...args),
  });

  return {
    // 'intro' (muffled) or 'grid' (full); starts the track if needed
    play(name) {
      const entering = mode === 'intro' && name === 'grid';
      mode = name;
      if (context) {
        if (entering) sfx.enterGrid();
        apply();
      }
    },
    // END OF LINE: tape stop over `seconds` with the power-down sound
    fadeOut(seconds = 3) {
      mode = null;
      if (!context) return;
      sfx.powerDown();
      if (playing) tapeStop(Math.min(seconds, 3));
    },
    sfx: effects,
    get muted() {
      return muted;
    },
    setMuted,
  };
}
