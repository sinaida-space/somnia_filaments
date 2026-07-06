const TYPE_CHAR_MS = 32;
const HOLD_MS = 3500;
const FADE_OUT_MS = 600;
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

    this.panel = document.createElement('div');
    this.panel.className = 'qo-panel';
    this.container.appendChild(this.panel);

    this.titlebar = document.createElement('div');
    this.titlebar.className = 'qo-titlebar';
    this.titlebar.textContent = 'somnia://question';
    this.panel.appendChild(this.titlebar);

    this.body = document.createElement('div');
    this.body.className = 'qo-body';
    this.panel.appendChild(this.body);

    this.promptEl = document.createElement('span');
    this.promptEl.className = 'qo-prompt';
    this.promptEl.textContent = 'C:\\SOMNIA> ';
    this.body.appendChild(this.promptEl);

    this.textEl = document.createElement('span');
    this.textEl.className = 'qo-text';
    this.body.appendChild(this.textEl);

    this.cursorEl = document.createElement('span');
    this.cursorEl.className = 'qo-cursor';
    this.cursorEl.textContent = '█';
    this.body.appendChild(this.cursorEl);

    this.dotsEl = document.createElement('div');
    this.dotsEl.className = 'qo-dots';
    this.panel.appendChild(this.dotsEl);
  }

  async show(text, index) {
    const question = typeof text === 'object' ? text.text : text;
    const tier = typeof text === 'object' ? text.tier : undefined;

    this.panel.classList.remove('qo-fading');
    this.textEl.textContent = '';
    this.dotsEl.textContent = tier ? TIER_DOTS[tier] || '' : '';
    this.cursorEl.classList.remove('qo-blink');

    this.vignette.classList.add('qo-visible');
    this.panel.classList.add('qo-visible');

    await this.typeText(question);

    this.cursorEl.classList.add('qo-blink');

    await wait(HOLD_MS);

    this.panel.classList.add('qo-fading');
    this.vignette.classList.remove('qo-visible');

    await wait(FADE_OUT_MS);

    this.panel.classList.remove('qo-visible');
    this.textEl.textContent = '';
    this.dotsEl.textContent = '';
    this.cursorEl.classList.remove('qo-blink');
  }

  async typeText(question) {
    const chars = [...question];
    for (let i = 0; i < chars.length; i += 1) {
      this.textEl.textContent += chars[i];
      // eslint-disable-next-line no-await-in-loop
      await wait(TYPE_CHAR_MS);
    }
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
