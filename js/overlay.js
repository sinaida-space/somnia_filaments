const FADE_IN_WINDOW_MS = 800;
const HOLD_MS = 3500;
const FADE_OUT_MS = 700;
const TIER_DOTS = { 1: '·', 2: '··', 3: '···' };

export class QuestionOverlay {
  constructor(rootEl) {
    this.root = rootEl;

    this.vignette = document.createElement('div');
    this.vignette.className = 'qo-vignette';
    this.root.appendChild(this.vignette);

    this.container = document.createElement('div');
    this.container.className = 'qo-container';
    this.root.appendChild(this.container);

    this.textEl = document.createElement('div');
    this.textEl.className = 'qo-text';
    this.container.appendChild(this.textEl);

    this.dotsEl = document.createElement('div');
    this.dotsEl.className = 'qo-dots';
    this.container.appendChild(this.dotsEl);
  }

  async show(text, index) {
    const question = typeof text === 'object' ? text.text : text;
    const tier = typeof text === 'object' ? text.tier : undefined;

    this.textEl.classList.remove('qo-fading');
    this.textEl.innerHTML = '';
    this.dotsEl.textContent = tier ? TIER_DOTS[tier] || '' : '';

    const letters = [...question].map((ch) => {
      const span = document.createElement('span');
      span.className = 'qo-letter';
      span.textContent = ch === ' ' ? ' ' : ch;
      this.textEl.appendChild(span);
      return span;
    });

    this.vignette.classList.add('qo-visible');

    // force layout so the initial (blurred/opacity 0) state is committed
    // before we start toggling classes for the stagger.
    // eslint-disable-next-line no-unused-expressions
    this.textEl.offsetHeight;

    const staggerStep = letters.length > 1 ? FADE_IN_WINDOW_MS / (letters.length - 1) : 0;
    letters.forEach((span, i) => {
      setTimeout(() => span.classList.add('qo-in'), i * staggerStep);
    });

    await wait(FADE_IN_WINDOW_MS + HOLD_MS);

    this.textEl.classList.add('qo-fading');
    this.vignette.classList.remove('qo-visible');

    await wait(FADE_OUT_MS);

    this.textEl.innerHTML = '';
    this.dotsEl.textContent = '';
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
