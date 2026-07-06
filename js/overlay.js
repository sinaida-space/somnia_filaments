const TYPE_CHAR_MS = 32;
const GRACE_MS = 500;      // ignore continue for this long so the catching gesture doesn't skip
const FADE_OUT_MS = 600;
const TIER_DOTS = { 1: '·', 2: '··', 3: '···' };

// Terminal-panel question overlay. The game is FULLY frozen while this is open
// (main.js sets timescale target 0). Dismissal is gesture-gated, not time-gated:
// the overlay resolves only when the player makes a ✊ fist (main.js drives the
// rising-edge and calls requestContinue()) OR clicks the `let's go further`
// button. A short grace after the text finishes typing prevents the same gesture
// that caught the block from instantly skipping the question.
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

    // Continue affordance: gesture glyph + hint line + explicit button fallback.
    this.footer = document.createElement('div');
    this.footer.className = 'qo-footer';
    this.panel.appendChild(this.footer);

    this.glyphEl = document.createElement('span');
    this.glyphEl.className = 'qo-glyph';
    this.glyphEl.textContent = '✊';
    this.footer.appendChild(this.glyphEl);

    this.hintEl = document.createElement('span');
    this.hintEl.className = 'qo-hint';
    this.hintEl.textContent = 'make a fist — let’s go further';
    this.footer.appendChild(this.hintEl);

    this.button = document.createElement('button');
    this.button.className = 'qo-continue';
    this.button.type = 'button';
    this.button.textContent = "let’s go further";
    this.button.addEventListener('click', () => this.requestContinue());
    this.footer.appendChild(this.button);

    this._resolve = null;
    this._armed = false;   // true once the grace window has passed
  }

  // Reflect the live hand gesture on the footer glyph while open (main.js pushes it).
  setGlyph(gesture) {
    if (!this.open) return;
    this.glyphEl.textContent = gesture === 'fist' ? '✊' : gesture === 'palm' ? '✋' : '·';
  }

  get open() { return this.panel.classList.contains('qo-visible'); }

  // Resolve the open question — called by the fist rising-edge (main.js) or the
  // button. Ignored during the grace window and when not open.
  requestContinue() {
    if (!this.open || !this._armed || !this._resolve) return;
    const done = this._resolve;
    this._resolve = null;
    this._armed = false;

    this.panel.classList.add('qo-fading');
    this.vignette.classList.remove('qo-visible');
    setTimeout(() => {
      this.panel.classList.remove('qo-visible', 'qo-fading');
      this.textEl.textContent = '';
      this.dotsEl.textContent = '';
      this.cursorEl.classList.remove('qo-blink');
      done();
    }, FADE_OUT_MS);
  }

  async show(text, index) {
    const question = typeof text === 'object' ? text.text : text;
    const tier = typeof text === 'object' ? text.tier : undefined;

    this.panel.classList.remove('qo-fading');
    this.textEl.textContent = '';
    this.dotsEl.textContent = tier ? TIER_DOTS[tier] || '' : '';
    this.cursorEl.classList.remove('qo-blink');
    this.glyphEl.textContent = '·';
    this._armed = false;

    this.vignette.classList.add('qo-visible');
    this.panel.classList.add('qo-visible');

    await this.typeText(question);

    this.cursorEl.classList.add('qo-blink');

    // Arm continue after a short grace so the catching gesture can't skip it.
    return new Promise((resolve) => {
      this._resolve = resolve;
      setTimeout(() => { this._armed = true; }, GRACE_MS);
    });
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
