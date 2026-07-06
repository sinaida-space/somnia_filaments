// calibration.js — arrival ritual: gate check, consent, camera init, hand-circle
// calibration, parallax preview. Builds against Task 5's Tracking contract.
//
// export async function runOnboarding(tracking, rootEl)
// → resolves { handRange:{minX,maxX,minY,maxY} }
// → rejects { code:'gate' }

const CIRCLE_DURATION_MS = 12000;
const CIRCLE_RADIUS_VMIN = 30;
const PRESENCE_THRESHOLD = 0.7;
const PARALLAX_DURATION_MS = 2000;

function vmin(pct) {
  return (Math.min(window.innerWidth, window.innerHeight) * pct) / 100;
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
  });
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

// Runs the hand-circle ritual once. Resolves { range, presenceRatio }.
function runHandCircleOnce(rootEl, tracking) {
  return new Promise((resolve) => {
    const { root } = makeScreen(rootEl);
    const line = el('p', 'calib-line', 'follow it with your open hand');
    line.style.position = 'fixed';
    line.style.top = '12%';
    line.style.left = '50%';
    line.style.transform = 'translateX(-50%)';
    root.appendChild(line);

    const dot = el('div', 'calib-dot');
    root.appendChild(dot);

    const handDot = el('div', 'calib-hand');
    handDot.style.opacity = '0';
    root.appendChild(handDot);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let samples = 0;
    let presentSamples = 0;
    let raf = null;
    const start = performance.now();
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const r = vmin(CIRCLE_RADIUS_VMIN);

    function tick(now) {
      const t = now - start;
      const frac = Math.min(t / CIRCLE_DURATION_MS, 1);
      const angle = frac * Math.PI * 2 - Math.PI / 2;
      const dx = cx + r * Math.cos(angle);
      const dy = cy + r * Math.sin(angle);
      dot.style.left = `${dx}px`;
      dot.style.top = `${dy}px`;

      const snap = tracking.poll();
      samples += 1;
      // Capture the RAW palm position (0..1 image space) — this is the space
      // handRange is applied in. snap.hand.x/y are already mapped to -1..1 and
      // must NOT be used here, or the range comes out in the wrong space.
      const rawX = snap.hand && snap.hand.rawX;
      const rawY = snap.hand && snap.hand.rawY;
      if (snap.hand && snap.hand.present && rawX !== undefined) {
        presentSamples += 1;
        handDot.style.opacity = '0.7';
        handDot.style.left = `${(snap.hand.x * 0.5 + 0.5) * window.innerWidth}px`;
        handDot.style.top = `${(snap.hand.y * 0.5 + 0.5) * window.innerHeight}px`;
        minX = Math.min(minX, rawX);
        maxX = Math.max(maxX, rawX);
        minY = Math.min(minY, rawY);
        maxY = Math.max(maxY, rawY);
      } else {
        handDot.style.opacity = '0';
      }

      if (frac < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        const presenceRatio = samples > 0 ? presentSamples / samples : 0;
        // Fallback is the full camera frame in 0..1 (raw) space, not -1..1.
        const range = (minX === Infinity)
          ? { minX: 0, maxX: 1, minY: 0, maxY: 1 }
          : { minX, maxX, minY, maxY };
        resolve({ range, presenceRatio });
      }
    }

    raf = requestAnimationFrame(tick);
  });
}

async function runHandRitual(rootEl, tracking) {
  let result = await runHandCircleOnce(rootEl, tracking);
  if (result.presenceRatio < PRESENCE_THRESHOLD) {
    result = await runHandCircleOnce(rootEl, tracking);
  }
  return result.range;
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

  const handRange = await runHandRitual(rootEl, tracking);
  tracking.setHandRange(handRange);

  await runParallaxPreview(rootEl, tracking);

  clearRoot(rootEl);
  return { handRange };
}
