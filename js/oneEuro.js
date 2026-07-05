// One-Euro filter — standard implementation (Casiez, Roussel, Vogel 2012).
// Adaptive low-pass: low jitter at rest, low lag on fast motion.

class LowPass {
  constructor() { this.hasLast = false; this.last = 0; }
  filter(value, alpha) {
    this.last = this.hasLast ? alpha * value + (1 - alpha) * this.last : value;
    this.hasLast = true;
    return this.last;
  }
}

function alpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuroFilter {
  constructor(minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPass();
    this.dx = new LowPass();
    this.lastValue = 0;
    this.hasLast = false;
  }

  // value: raw sample, dt: seconds since previous sample (>0).
  filter(value, dt) {
    if (!(dt > 0)) dt = 1e-3;
    const rawDeriv = this.hasLast ? (value - this.lastValue) / dt : 0;
    const edx = this.dx.filter(rawDeriv, alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const out = this.x.filter(value, alpha(cutoff, dt));
    this.lastValue = value;
    this.hasLast = true;
    return out;
  }

  reset() {
    this.x = new LowPass();
    this.dx = new LowPass();
    this.hasLast = false;
  }
}
