// Pure WebAudio generative audio — subaquatic nerve-hum drone + event stingers.
// No assets, no libraries. init() must be called after a user gesture.

const PENTATONIC = [523, 587, 659, 784, 880];
const MASTER_GAIN = 0.4;
const RAMP = 0.015; // seconds, minimum ramp time to avoid clicks on any gain touch

let ctx = null;
let master = null;
let droneNodes = null;
let questionIndex = 0;
let bound = null; // { bus, handlers } for listen()

function nowPlus(t) {
  return ctx.currentTime + t;
}

// Smoothly move a gain to a target value, always via a ramp (never a jump).
function rampGain(gainParam, target, duration) {
  const t0 = ctx.currentTime;
  gainParam.cancelScheduledValues(t0);
  gainParam.setValueAtTime(Math.max(gainParam.value, 0.0001), t0);
  gainParam.linearRampToValueAtTime(target, t0 + Math.max(duration, RAMP));
}

function buildDrone() {
  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = 55;

  const osc2 = ctx.createOscillator();
  osc2.type = 'triangle';
  osc2.frequency.value = 110.5;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 400;
  filter.Q.value = 0.7;

  // LFO sweeping the lowpass cutoff 200-600Hz at 0.05Hz
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.05;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 200; // sweep amplitude around the 400Hz center
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);

  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.12;

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(droneGain);
  droneGain.connect(master);

  osc1.start();
  osc2.start();
  lfo.start();

  return { osc1, osc2, filter, lfo, lfoGain, gain: droneGain };
}

function pluck(index) {
  const freq = PENTATONIC[((index % PENTATONIC.length) + PENTATONIC.length) % PENTATONIC.length];

  const bufferSize = ctx.sampleRate * 0.8;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.value = freq;
  bandpass.Q.value = 8;

  const gain = ctx.createGain();
  const t0 = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(0.5, t0 + RAMP);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8);

  noise.connect(bandpass);
  bandpass.connect(gain);
  gain.connect(master);

  noise.start(t0);
  noise.stop(t0 + 0.85);
}

function shimmerUp() {
  if (bound && bound.shimmer) {
    // already shimmering; do nothing to avoid stacking indefinitely
    return;
  }
  const fund = 660;
  // 5 partials, fundamental + ascending overtones, each with a subtle detune (cents)
  const partials = [1, 1.5, 2, 2.5, 3];
  const detunes = [0, 7, -6, 12, -11];
  const oscs = [];
  const gains = [];
  const shimmerBus = ctx.createGain();
  shimmerBus.gain.value = 1;
  shimmerBus.connect(master);

  partials.forEach((mult, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = fund * mult;
    osc.detune.value = detunes[i];

    const g = ctx.createGain();
    g.gain.value = 0.0001;
    osc.connect(g);
    g.connect(shimmerBus);
    osc.start();

    const target = 0.03 / (i + 1); // higher partials quieter
    const t0 = ctx.currentTime;
    g.gain.cancelScheduledValues(t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(target, t0 + 1);

    oscs.push(osc);
    gains.push(g);
  });

  bound.shimmer = { oscs, gains, bus: shimmerBus };
}

function shimmerDown() {
  if (!bound || !bound.shimmer) return;
  const { oscs, gains, bus: shimmerBus } = bound.shimmer;
  const t0 = ctx.currentTime;
  gains.forEach((g) => {
    g.gain.cancelScheduledValues(t0);
    g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t0);
    g.gain.linearRampToValueAtTime(0.0001, t0 + 1);
  });
  oscs.forEach((osc) => {
    osc.stop(t0 + 1.05);
  });
  setTimeout(() => {
    try { shimmerBus.disconnect(); } catch (e) { /* noop */ }
  }, 1100);
  bound.shimmer = null;
}

function thump() {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 70;

  const gain = ctx.createGain();
  const t0 = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(0.15, t0 + RAMP);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);

  osc.connect(gain);
  gain.connect(master);

  osc.start(t0);
  osc.stop(t0 + 0.45);
}

function droneSwellThenFade() {
  if (!droneNodes) return;
  const t0 = ctx.currentTime;
  // swell
  droneNodes.gain.gain.cancelScheduledValues(t0);
  droneNodes.gain.gain.setValueAtTime(Math.max(droneNodes.gain.gain.value, 0.0001), t0);
  droneNodes.gain.gain.linearRampToValueAtTime(0.22, t0 + 2);
  // then fade
  droneNodes.gain.gain.linearRampToValueAtTime(0.0001, t0 + 6);
}

export const audio = {
  init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);

    droneNodes = buildDrone();

    if (ctx.state === 'suspended') {
      ctx.resume();
    }
  },

  listen(bus) {
    if (!ctx) return; // audio not initialized; guard per Task 9 contract
    if (bound) return; // already listening

    const onBlockBroken = () => pluck(questionIndex);
    const onQuestionStart = ({ index } = {}) => {
      if (typeof index === 'number') questionIndex = index;
      shimmerUp();
    };
    const onQuestionEnd = () => shimmerDown();
    const onBallMiss = () => thump();
    const onGameState = ({ state } = {}) => {
      if (state === 'ending') droneSwellThenFade();
    };

    bus.on('block:broken', onBlockBroken);
    bus.on('question:start', onQuestionStart);
    bus.on('question:end', onQuestionEnd);
    bus.on('ball:miss', onBallMiss);
    bus.on('game:state', onGameState);

    bound = {
      bus,
      shimmer: null,
      handlers: { onBlockBroken, onQuestionStart, onQuestionEnd, onBallMiss, onGameState }
    };
  },

  setMuted(muted) {
    if (!ctx || !master) return;
    rampGain(master.gain, muted ? 0 : MASTER_GAIN, 0.2);
  }
};
