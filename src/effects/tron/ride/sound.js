// The ride's own sounds, synthesised like the rest of the app's (sfx.js):
// countdown beeps, the GO, an engine hum that follows the speed, a derezz
// crash and a short chord for the winner. A separate audio context, made
// only after the page has had a user gesture (the browser wouldn't let it
// play before), and silent whenever the music is muted (N).
export function createRideSound(music) {
  let context = null;
  let output = null;
  let engine = null;
  let noiseBuffer = null;

  function ready() {
    if (music?.muted) return false;
    if (!context) {
      if (!navigator.userActivation?.hasBeenActive) return false;
      context = new AudioContext();
      output = context.createGain();
      output.gain.value = 0.7;
      output.connect(context.destination);
    }
    if (context.state === 'suspended') context.resume();
    return true;
  }

  function envelope(at, peak, attack, release) {
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + release);
    gain.connect(output);
    return gain;
  }

  function tone(type, frequency, at, peak, attack, release, glideTo = null) {
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    if (glideTo) oscillator.frequency.exponentialRampToValueAtTime(glideTo, at + attack + release);
    oscillator.connect(envelope(at, peak, attack, release));
    oscillator.start(at);
    oscillator.stop(at + attack + release + 0.05);
  }

  function noise(at, peak, release, from, to) {
    if (!noiseBuffer) {
      noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(to, at + release);
    source.connect(filter).connect(envelope(at, peak, 0.005, release));
    source.start(at);
    source.stop(at + release + 0.1);
  }

  return {
    tick(count) {
      if (!ready()) return;
      const at = context.currentTime;
      if (count > 0) tone('square', 660, at, 0.05, 0.004, 0.16);
      else {
        tone('square', 1320, at, 0.06, 0.004, 0.45);
        noise(at, 0.08, 0.6, 600, 4000);
      }
    },
    crash() {
      if (!ready()) return;
      const at = context.currentTime;
      noise(at, 0.35, 0.9, 5000, 300);
      tone('sawtooth', 420, at, 0.1, 0.005, 0.7, 40);
      tone('sine', 90, at, 0.4, 0.005, 0.6, 30);
      // a glassy shatter: a few quick high blips
      for (let k = 0; k < 6; k++) tone('triangle', 2000 + Math.random() * 3000, at + 0.03 + k * 0.045, 0.03, 0.002, 0.08);
    },
    win(playerWon) {
      if (!ready()) return;
      const at = context.currentTime;
      const chord = playerWon ? [440, 554, 659, 880] : [392, 466, 587, 784];
      chord.forEach((frequency, index) => tone('sawtooth', frequency, at + index * 0.05, 0.035, 0.03, 1.6));
    },
    // the engine: call every frame while riding (speed in units/s), 0 to stop
    engine(speed) {
      if (speed <= 0 || music?.muted) {
        if (engine) {
          const at = context.currentTime;
          engine.gain.gain.setTargetAtTime(0.0001, at, 0.15);
          engine.oscillators.forEach((oscillator) => oscillator.stop(at + 0.6));
          engine = null;
        }
        return;
      }
      if (!ready()) return;
      if (!engine) {
        const gain = context.createGain();
        gain.gain.value = 0.0001;
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 500;
        filter.connect(gain).connect(output);
        const oscillators = [0, 7].map((detune) => {
          const oscillator = context.createOscillator();
          oscillator.type = 'sawtooth';
          oscillator.detune.value = detune;
          oscillator.connect(filter);
          oscillator.start();
          return oscillator;
        });
        engine = { gain, filter, oscillators };
      }
      const at = context.currentTime;
      const pitch = 38 + speed * 1.6;
      for (const oscillator of engine.oscillators) oscillator.frequency.setTargetAtTime(pitch, at, 0.08);
      engine.filter.frequency.setTargetAtTime(300 + speed * 18, at, 0.1);
      engine.gain.gain.setTargetAtTime(0.03, at, 0.2);
    },
  };
}
