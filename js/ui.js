// Tron-Legacy HUD chrome for somnia — cyan-on-void, VT323. Emulates (not imports)
// the-eyes-chico's ui.js vocabulary: a fixed top HUD bar (pointer-events none
// except its controls) with fullscreen + mute toggles, a small menu (finish /
// restart / fullscreen / mute), a live gesture glyph (✋/✊) and a one-line hint,
// plus a farewell screen. Everything is built in JS so index.html stays minimal.
//
// Callbacks are wired by main.js: onMute(muted), onFinish(), onRestart().
// The debug 'd' HUD and 'm' key live in main.js and are untouched by this file.

const FS_ROOT = document.documentElement;

function fullscreenSupported() {
  return !!(FS_ROOT.requestFullscreen || FS_ROOT.webkitRequestFullscreen);
}
function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}
function toggleFullscreen() {
  if (isFullscreen()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else (FS_ROOT.requestFullscreen || FS_ROOT.webkitRequestFullscreen).call(FS_ROOT);
}

export class UI {
  constructor(rootEl) {
    this.root = rootEl;
    this._muted = false;
    this._menuOpen = false;
    this._cbMute = null;
    this._cbFinish = null;
    this._cbRestart = null;

    this._buildHud();
    this._buildFarewell();
    this._initFullscreen();
  }

  // ---- HUD bar --------------------------------------------------------------
  _buildHud() {
    const hud = document.createElement('div');
    hud.className = 'hud';
    this.hud = hud;

    // left: gesture glyph + hint
    const left = document.createElement('div');
    left.className = 'hud-left';
    this.glyphEl = document.createElement('span');
    this.glyphEl.className = 'hud-glyph';
    this.glyphEl.textContent = '·';
    this.hintEl = document.createElement('span');
    this.hintEl.className = 'hud-hint';
    this.hintEl.textContent = 'catch the light · make a fist to go further';
    left.appendChild(this.glyphEl);
    left.appendChild(this.hintEl);

    // right: fullscreen, mute, menu
    const right = document.createElement('div');
    right.className = 'hud-right';

    this.fsBtn = this._hudBtn('⛶', 'fullscreen', toggleFullscreen);
    this.muteBtn = this._hudBtn('SOUND: ON', 'mute', () => this._toggleMute());
    this.menuBtn = this._hudBtn('☰ MENU', 'menu', () => this._toggleMenu());
    right.appendChild(this.fsBtn);
    right.appendChild(this.muteBtn);
    right.appendChild(this.menuBtn);

    hud.appendChild(left);
    hud.appendChild(right);
    this.root.appendChild(hud);

    // dropdown menu (hidden until toggled)
    const menu = document.createElement('div');
    menu.className = 'hud-menu hidden';
    this.menu = menu;
    this.menuFinish = this._menuItem('finish', () => { this._closeMenu(); if (this._cbFinish) this._cbFinish(); });
    this.menuRestart = this._menuItem('restart', () => { this._closeMenu(); if (this._cbRestart) this._cbRestart(); });
    this.menuFs = this._menuItem('fullscreen', () => { this._closeMenu(); toggleFullscreen(); });
    this.menuMute = this._menuItem('mute', () => { this._closeMenu(); this._toggleMute(); });
    menu.appendChild(this.menuFinish);
    menu.appendChild(this.menuRestart);
    menu.appendChild(this.menuFs);
    menu.appendChild(this.menuMute);
    this.root.appendChild(menu);
  }

  _hudBtn(label, kind, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `hud-btn hud-btn-${kind}`;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  _menuItem(label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hud-menu-item';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  _toggleMenu() {
    this._menuOpen = !this._menuOpen;
    this.menu.classList.toggle('hidden', !this._menuOpen);
  }
  _closeMenu() {
    this._menuOpen = false;
    this.menu.classList.add('hidden');
  }

  // ---- mute (shared surface with the 'm' key in main.js) --------------------
  _toggleMute() { this.setMuted(!this._muted, true); }

  // muted: bool; fire: whether to invoke the onMute callback (false when 'm' key
  // already toggled the audio and only wants the label synced).
  setMuted(muted, fire) {
    this._muted = muted;
    const label = muted ? 'SOUND: OFF' : 'SOUND: ON';
    this.muteBtn.textContent = label;
    this.menuMute.textContent = muted ? 'unmute' : 'mute';
    if (fire && this._cbMute) this._cbMute(muted);
  }

  onMute(cb) { this._cbMute = cb; }
  onFinish(cb) { this._cbFinish = cb; }
  onRestart(cb) { this._cbRestart = cb; }

  // ---- live gesture glyph + hint -------------------------------------------
  setGlyph(gesture) {
    this.glyphEl.textContent = gesture === 'fist' ? '✊' : gesture === 'palm' ? '✋' : '·';
  }
  setHint(t) { this.hintEl.textContent = t; }

  showHud() { this.hud.classList.remove('hidden'); }
  hideHud() { this.hud.classList.add('hidden'); this._closeMenu(); }

  // ---- fullscreen label sync ------------------------------------------------
  _initFullscreen() {
    if (!fullscreenSupported()) {
      this.fsBtn.classList.add('hidden');
      this.menuFs.classList.add('hidden');
      return;
    }
    const label = () => {
      this.fsBtn.textContent = isFullscreen() ? '⛶✕' : '⛶';
      this.menuFs.textContent = isFullscreen() ? 'exit fullscreen' : 'fullscreen';
    };
    addEventListener('fullscreenchange', label);
    addEventListener('webkitfullscreenchange', label);
    label();
  }

  // ---- farewell screen ------------------------------------------------------
  _buildFarewell() {
    const screen = document.createElement('div');
    screen.className = 'farewell hidden';
    this.farewell = screen;

    const inner = document.createElement('div');
    inner.className = 'farewell-inner';

    const breath = document.createElement('p');
    breath.className = 'farewell-breath';
    breath.textContent = 'take a deep breath in… and let it out';
    inner.appendChild(breath);

    const row = document.createElement('div');
    row.className = 'farewell-buttons';

    const unwind = this._farewellBtn('unwind', () =>
      window.open('https://open.spotify.com/playlist/38qrJ3BVx5RJ7bHy3NQm0J', '_blank', 'noopener,noreferrer'));
    const again = this._farewellBtn('again', () => {
      this.hideFarewell();
      if (this._cbRestart) this._cbRestart();
    });
    const site = this._farewellBtn('sinaida.eu', () =>
      window.open('https://sinaida.eu', '_blank', 'noopener,noreferrer'));

    row.appendChild(unwind);
    row.appendChild(again);
    row.appendChild(site);
    inner.appendChild(row);
    screen.appendChild(inner);
    this.root.appendChild(screen);
  }

  _farewellBtn(label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'farewell-btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  showFarewell() {
    this.hideHud();
    this.farewell.classList.remove('hidden');
    requestAnimationFrame(() => this.farewell.classList.add('farewell-visible'));
  }
  hideFarewell() {
    this.farewell.classList.remove('farewell-visible');
    this.farewell.classList.add('hidden');
    this.showHud();
  }
  get farewellOpen() { return !this.farewell.classList.contains('hidden'); }
}
