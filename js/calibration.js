// calibration.js — arrival ritual: gate check, consent, camera init, guided
// per-axis calibration, parallax preview. Builds against Task 5's Tracking
// contract.
//
// export async function runOnboarding(tracking, rootEl)
// → resolves { handRange:{minX,maxX,minY,maxY} }
// → rejects { code:'gate' }

const DETECT_STABLE_MS = 800;
const DETECT_TIMEOUT_MS = 10000;
const AXIS_DURATION_MS = 4000;
const PARALLAX_DURATION_MS = 2000;
const MIN_SPAN = 0.30;

// Widens [min,max] to at least MIN_SPAN, centered on the original midpoint,
// then clamps into [0,1] by shifting (never crushing) the band. Falls back
// to a centered MIN_SPAN band if the axis is degenerate/inverted (min>=max).
function widenAxis(min, max) {
  if (!(min < max)) {
    return { min: 0.5 - MIN_SPAN / 2, max: 0.5 + MIN_SPAN / 2 };
  }
  const span = max - min;
  if (span >= MIN_SPAN) return { min, max };
  const mid = (min + max) / 2;
  let lo = mid - MIN_SPAN / 2;
  let hi = mid + MIN_SPAN / 2;
  if (lo < 0) {
    hi += -lo;
    lo = 0;
  }
  if (hi > 1) {
    lo -= (hi - 1);
    hi = 1;
  }
  lo = Math.max(0, lo);
  hi = Math.min(1, hi);
  return { min: lo, max: hi };
}

function applyMinSpanGuard(range) {
  const x = widenAxis(range.minX, range.maxX);
  const y = widenAxis(range.minY, range.maxY);
  return { minX: x.min, maxX: x.max, minY: y.min, maxY: y.max };
}

function clearRoot(rootEl) {
  rootEl.innerHTML = '';
}

function makeScreen(rootEl) {
  clearRoot(rootEl);
  const root = document.createElement('div');
  root.className = 'calib-root';
  const screen = document.createElement('div');
  screen.className = 'calib-screen';
  root.appendChild(screen);
  rootEl.appendChild(root);
  return { root, screen };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function hasCoarsePointerOrNoDevices() {
  const coarse = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
  const noDevices = !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  return coarse || noDevices;
}

function renderGate(rootEl, message) {
  const { screen } = makeScreen(rootEl);
  screen.appendChild(el('h1', 'calib-title', 'somnia filaments'));
  screen.appendChild(el('p', 'calib-line', message || 'this piece needs a desktop, a webcam, and your hands'));
  screen.appendChild(el('p', 'calib-url', window.location.href));
}

function renderArrival(rootEl) {
  return new Promise((resolve) => {
    const { screen } = makeScreen(rootEl);
    screen.appendChild(el('h1', 'calib-title', 'somnia filaments'));
    screen.appendChild(el('p', 'calib-line', 'this piece watches you back — camera stays here, nothing is recorded'));
    const btn = el('button', 'calib-button', 'begin');
    btn.addEventListener('click', () => resolve(), { once: true });
    screen.appendChild(btn);
    const link = document.createElement('a');
    link.className = 'calib-artist-link';
    link.href = 'https://sinaida.eu';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'sinaida.eu';
    screen.appendChild(link);
  });
}

// Honest, dismiss-only cookie notice. No storage writes — it reappears on
// reload by design, because the truthful claim is that nothing is stored.
function renderCookieBanner(rootEl) {
  const banner = el('div', 'calib-cookie-banner');
  const text = el(
    'p',
    'calib-cookie-text',
    'this site sets no cookies and tracks nothing — your camera never leaves your device'
  );
  const btn = el('button', 'calib-cookie-ok', 'ok');
  btn.addEventListener('click', () => {
    banner.remove();
  }, { once: true });
  banner.appendChild(text);
  banner.appendChild(btn);
  rootEl.appendChild(banner);
}

function renderWaiting(rootEl, line) {
  const { screen } = makeScreen(rootEl);
  screen.appendChild(el('h1', 'calib-title', 'somnia filaments'));
  screen.appendChild(el('p', 'calib-line', line));
  return { screen };
}

async function initCamera(tracking, rootEl, videoEl) {
  renderWaiting(rootEl, 'the camera is waking up');
  try {
    await tracking.init(videoEl);
    return true;
  } catch (err) {
    renderGate(rootEl, 'the camera declined');
    return false;
  }
}

// Maps raw palm position (0..1 image space) to screen pixels for the live
// hand-dot. Uses the full 0..1 span — this is a detect-time visualization,
// not the calibrated range.
function rawToScreen(rawX, rawY) {
  return { x: rawX * window.innerWidth, y: rawY * window.innerHeight };
}

function positionHandDot(handDot, handLabel, rawX, rawY) {
  const { x, y } = rawToScreen(rawX, rawY);
  handDot.style.opacity = '0.9';
  handDot.style.left = `${x}px`;
  handDot.style.top = `${y}px`;
  handLabel.style.opacity = '0.6';
  handLabel.style.left = `${x}px`;
  handLabel.style.top = `${y}px`;
}

function hideHandDot(handDot, handLabel) {
  handDot.style.opacity = '0';
  handLabel.style.opacity = '0';
}

// Step 0 — detect: waits for hand.present to be stable for DETECT_STABLE_MS.
// Resolves { detected, rawX, rawY }. If nothing is detected within
// DETECT_TIMEOUT_MS, resolves { detected:false }.
function runDetectStep(rootEl, tracking) {
  return new Promise((resolve) => {
    const { root } = makeScreen(rootEl);
    const line = el('p', 'calib-line calib-step-line', 'show me your open hand');
    root.appendChild(line);
    const found = el('p', 'calib-line calib-fade calib-subline', 'got it');
    root.appendChild(found);

    const handDot = el('div', 'calib-hand');
    handDot.style.opacity = '0';
    root.appendChild(handDot);
    const handLabel = el('div', 'calib-hand-label', 'you');
    handLabel.style.opacity = '0';
    root.appendChild(handLabel);

    let raf = null;
    const start = performance.now();
    let presentSince = null;

    function tick(now) {
      const snap = tracking.poll();
      const hand = snap.hand;
      const rawX = hand && hand.rawX;
      const rawY = hand && hand.rawY;
      const present = !!(hand && hand.present && rawX !== undefined);

      if (present) {
        positionHandDot(handDot, handLabel, rawX, rawY);
        if (presentSince === null) presentSince = now;
        if (now - presentSince >= DETECT_STABLE_MS) {
          found.classList.add('calib-visible');
          if (raf) cancelAnimationFrame(raf);
          setTimeout(() => resolve({ detected: true, rawX, rawY }), 500);
          return;
        }
      } else {
        presentSince = null;
        hideHandDot(handDot, handLabel);
      }

      if (now - start >= DETECT_TIMEOUT_MS) {
        resolve({ detected: false });
        return;
      }

      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
  });
}

// Shared per-axis capture. axis is 'x' or 'y'. A single-direction sweep guided
// by a directional arrow; the fill bar tracks the captured extent as live
// feedback. Resolves { min, max }.
function runAxisStep(rootEl, tracking, axis, promptLine) {
  return new Promise((resolve) => {
    const { root } = makeScreen(rootEl);
    const line = el('p', 'calib-line calib-step-line', promptLine);
    root.appendChild(line);

    // Directional arrow hint: one way only (→ across, ↓ down).
    const arrow = el('div', axis === 'x' ? 'calib-arrow calib-arrow-h' : 'calib-arrow calib-arrow-v',
      axis === 'x' ? '→' : '↓');
    root.appendChild(arrow);

    const barTrack = el('div', axis === 'x' ? 'calib-bar-track calib-bar-track-h' : 'calib-bar-track calib-bar-track-v');
    const barFill = el('div', axis === 'x' ? 'calib-bar-fill calib-bar-fill-h' : 'calib-bar-fill calib-bar-fill-v');
    barTrack.appendChild(barFill);
    root.appendChild(barTrack);

    const handDot = el('div', 'calib-hand');
    handDot.style.opacity = '0';
    root.appendChild(handDot);
    const handLabel = el('div', 'calib-hand-label', 'you');
    handLabel.style.opacity = '0';
    root.appendChild(handLabel);

    let min = Infinity;
    let max = -Infinity;
    let raf = null;
    const start = performance.now();

    function tick(now) {
      const frac = Math.min((now - start) / AXIS_DURATION_MS, 1);
      const snap = tracking.poll();
      const hand = snap.hand;
      const rawX = hand && hand.rawX;
      const rawY = hand && hand.rawY;
      const present = !!(hand && hand.present && rawX !== undefined);

      if (present) {
        positionHandDot(handDot, handLabel, rawX, rawY);
        const v = axis === 'x' ? rawX : rawY;
        min = Math.min(min, v);
        max = Math.max(max, v);
      } else {
        hideHandDot(handDot, handLabel);
      }

      if (min !== Infinity) {
        const span = Math.max(0, max - min);
        if (axis === 'x') {
          barFill.style.left = `${min * 100}%`;
          barFill.style.width = `${span * 100}%`;
        } else {
          barFill.style.top = `${min * 100}%`;
          barFill.style.height = `${span * 100}%`;
        }
      }

      if (frac < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        if (min === Infinity) {
          resolve({ min: 0, max: 1 });
        } else {
          resolve({ min, max });
        }
      }
    }

    raf = requestAnimationFrame(tick);
  });
}

// Guided per-axis calibration: detect → horizontal → vertical. Never hard
// blocks — falls back to a full-frame (guarded) range if the hand is never
// detected. Resolves the assembled, min-span-guarded range in 0..1 raw space.
async function runGuidedCalibration(rootEl, tracking) {
  const detect = await runDetectStep(rootEl, tracking);

  if (!detect.detected) {
    return applyMinSpanGuard({ minX: 0, maxX: 1, minY: 0, maxY: 1 });
  }

  const xRange = await runAxisStep(rootEl, tracking, 'x', 'sweep your hand across, following the arrow');
  const yRange = await runAxisStep(rootEl, tracking, 'y', 'now sweep your hand down, following the arrow');

  const rawRange = {
    minX: xRange.min,
    maxX: xRange.max,
    minY: yRange.min,
    maxY: yRange.max
  };
  return applyMinSpanGuard(rawRange);
}

function runParallaxPreview(rootEl, tracking) {
  return new Promise((resolve) => {
    const snap = tracking.poll();
    if (!snap.head || !snap.head.present) {
      resolve();
      return;
    }
    const { screen } = makeScreen(rootEl);
    const line = el('p', 'calib-line calib-fade', 'now move your head slightly');
    screen.appendChild(line);
    requestAnimationFrame(() => line.classList.add('calib-visible'));
    setTimeout(resolve, PARALLAX_DURATION_MS);
  });
}

export async function runOnboarding(tracking, rootEl) {
  if (hasCoarsePointerOrNoDevices()) {
    renderGate(rootEl);
    throw { code: 'gate' };
  }

  renderCookieBanner(rootEl);
  await renderArrival(rootEl);

  let videoEl = document.getElementById('cam');
  if (!videoEl) {
    videoEl = document.createElement('video');
    videoEl.id = 'cam';
    videoEl.playsInline = true;
    videoEl.hidden = true;
    document.body.appendChild(videoEl);
  }

  const camOk = await initCamera(tracking, rootEl, videoEl);
  if (!camOk) {
    throw { code: 'gate' };
  }

  const handRange = await runGuidedCalibration(rootEl, tracking);
  tracking.setHandRange(handRange);

  await runParallaxPreview(rootEl, tracking);

  clearRoot(rootEl);
  return { handRange };
}
