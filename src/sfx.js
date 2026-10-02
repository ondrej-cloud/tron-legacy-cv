// Synthesised sound effects (Web Audio, no samples): entering the Grid and
// the END OF LINE power-down. Everything runs through `output`, so muting the
// music mutes these too.

export function createSfx(context, output) {
  const bus = context.createGain();
  bus.gain.value = 0.9;
  bus.connect(output);

  // a short, dark reverb shared by every effect
  const reverb = context.createConvolver();
  reverb.buffer = impulse(2.4, 2.8);
  const reverbSend = context.createGain();
  reverbSend.gain.value = 0.35;
  reverbSend.connect(reverb).connect(bus);

  let noiseBuffer = null;
  function noise() {
    if (!noiseBuffer) {
      noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    return source;
  }

  function impulse(seconds, decay) {
    const length = Math.floor(context.sampleRate * seconds);
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
    }
    return buffer;
  }

  // gain envelope node: attack to `peak`, exponential decay over `release`
  function envelope(at, peak, attack, release) {
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + release);
    return gain;
  }

  function connect(node, wet = 0.35) {
    node.connect(bus);
    if (wet) {
      const send = context.createGain();
      send.gain.value = wet / 0.35;
      node.connect(send).connect(reverbSend);
    }
    return node;
  }

  // Riser into an impact: filtered noise and a detuned saw glide sweep up
  // for ~0.45 s, then a sub drop, a noise burst and a bright digital chord.
  function enterGrid() {
    const now = context.currentTime;
    const hit = now + 0.45;

    const sweep = noise();
    const band = context.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 4;
    band.frequency.setValueAtTime(400, now);
    band.frequency.exponentialRampToValueAtTime(7000, hit);
    const sweepGain = context.createGain();
    sweepGain.gain.setValueAtTime(0.0001, now);
    sweepGain.gain.exponentialRampToValueAtTime(0.5, hit - 0.02);
    sweepGain.gain.exponentialRampToValueAtTime(0.0001, hit + 0.05);
    sweep.connect(band).connect(sweepGain);
    connect(sweepGain, 0.2);
    sweep.start(now);
    sweep.stop(hit + 0.1);

    for (const detune of [-12, 12]) {
      const glide = context.createOscillator();
      glide.type = 'sawtooth';
      glide.detune.value = detune;
      glide.frequency.setValueAtTime(110, now);
      glide.frequency.exponentialRampToValueAtTime(880, hit);
      const lowpass = context.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(600, now);
      lowpass.frequency.exponentialRampToValueAtTime(5000, hit);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.09, hit - 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, hit + 0.06);
      glide.connect(lowpass).connect(gain);
      connect(gain, 0.15);
      glide.start(now);
      glide.stop(hit + 0.1);
    }

    // impact: sub boom
    const sub = context.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(95, hit);
    sub.frequency.exponentialRampToValueAtTime(32, hit + 1.2);
    const subGain = envelope(hit, 0.55, 0.008, 1.6);
    sub.connect(subGain);
    connect(subGain, 0.1);
    sub.start(hit);
    sub.stop(hit + 1.8);

    // impact: noise burst through a closing low-pass
    const burst = noise();
    const burstFilter = context.createBiquadFilter();
    burstFilter.type = 'lowpass';
    burstFilter.frequency.setValueAtTime(9000, hit);
    burstFilter.frequency.exponentialRampToValueAtTime(300, hit + 0.7);
    const burstGain = envelope(hit, 0.28, 0.004, 0.8);
    burst.connect(burstFilter).connect(burstGain);
    connect(burstGain, 0.6);
    burst.start(hit);
    burst.stop(hit + 1);

    // impact: a bright open fifth with a quick upward arpeggio
    [220, 330, 440, 660, 880].forEach((frequency, index) => {
      const tone = context.createOscillator();
      tone.type = index % 2 ? 'triangle' : 'sine';
      tone.frequency.value = frequency;
      const at = hit + index * 0.045;
      const gain = envelope(at, 0.08, 0.01, 1.4);
      tone.connect(gain);
      connect(gain, 0.8);
      tone.start(at);
      tone.stop(at + 1.6);
    });
  }

  // The Grid shutting down: a low thud, a falling power-down whine and a
  // few seconds of electric crackle that thins out.
  function powerDown() {
    const now = context.currentTime;

    const thud = context.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(70, now);
    thud.frequency.exponentialRampToValueAtTime(28, now + 0.9);
    const thudGain = envelope(now, 0.6, 0.01, 1.2);
    thud.connect(thudGain);
    connect(thudGain, 0.2);
    thud.start(now);
    thud.stop(now + 1.4);

    const whine = context.createOscillator();
    whine.type = 'sawtooth';
    whine.frequency.setValueAtTime(420, now + 0.1);
    whine.frequency.exponentialRampToValueAtTime(35, now + 2.8);
    const whineFilter = context.createBiquadFilter();
    whineFilter.type = 'lowpass';
    whineFilter.frequency.setValueAtTime(3000, now);
    whineFilter.frequency.exponentialRampToValueAtTime(200, now + 2.8);
    const whineGain = context.createGain();
    whineGain.gain.setValueAtTime(0.0001, now);
    whineGain.gain.exponentialRampToValueAtTime(0.12, now + 0.25);
    whineGain.gain.exponentialRampToValueAtTime(0.0001, now + 3);
    whine.connect(whineFilter).connect(whineGain);
    connect(whineGain, 0.4);
    whine.start(now);
    whine.stop(now + 3.1);

    // crackle: short noise clicks, dense at first, sparser as the lights die
    let at = now + 0.05;
    while (at < now + 2.4) {
      const click = noise();
      const highpass = context.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 2000 + Math.random() * 4000;
      const level = 0.25 * (1 - (at - now) / 2.6);
      const gain = envelope(at, Math.max(0.01, level), 0.002, 0.02 + Math.random() * 0.05);
      click.connect(highpass).connect(gain);
      connect(gain, 0.3);
      click.start(at);
      click.stop(at + 0.12);
      at += 0.025 + Math.random() * 0.12 * (1 + (at - now));
    }
  }

  // One typed character: a soft digital tick.
  function key() {
    const now = context.currentTime;
    const tick = context.createOscillator();
    tick.type = 'square';
    tick.frequency.value = 1700 + Math.random() * 300;
    const bandpass = context.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 2500;
    const gain = envelope(now, 0.07, 0.002, 0.04);
    tick.connect(bandpass).connect(gain);
    connect(gain, 0.25);
    tick.start(now);
    tick.stop(now + 0.08);
  }

  // An old TV switching off: a click and a fading high whine.
  function crtOff() {
    const now = context.currentTime;
    const click = noise();
    const clickGain = envelope(now, 0.3, 0.001, 0.03);
    click.connect(clickGain);
    connect(clickGain, 0.4);
    click.start(now);
    click.stop(now + 0.06);

    const whine = context.createOscillator();
    whine.type = 'sine';
    whine.frequency.setValueAtTime(9000, now);
    whine.frequency.exponentialRampToValueAtTime(6000, now + 0.6);
    const gain = envelope(now, 0.035, 0.005, 0.7);
    whine.connect(gain);
    connect(gain, 0.5);
    whine.start(now);
    whine.stop(now + 0.8);
  }

  return { enterGrid, powerDown, key, crtOff };
}
