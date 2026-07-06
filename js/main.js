import * as THREE from 'three';
import { PALETTE, TUNNEL, GAMEPLAY, PERF } from './config.js';
import { bus } from './events.js';
import { Game } from './game.js';
import { Tunnel } from './tunnel.js';
import { OffAxisCamera } from './offAxisCamera.js';
import { Tracking } from './tracking.js';
import { QuestionOverlay } from './overlay.js';
import { QUESTIONS } from './questions.js';
import { runOnboarding } from './calibration.js';
import { audio } from './audio.js';

const canvas = document.getElementById('stage');
const uiRoot = document.getElementById('ui');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setClearColor(PALETTE.void);

const scene = new THREE.Scene();

const game = new Game(scene, bus);
const tunnel = new Tunnel(scene);
const offAxis = new OffAxisCamera();
const tracking = new Tracking();

let overlay = null; // built after onboarding clears #ui

// ---- state -----------------------------------------------------------

let gameState = 'gate';

function setState(newState) {
  gameState = newState;
  bus.emit('game:state', { state: gameState });
}

// ---- timescale (critically-damped ease toward target) ----------------

let timescale = 1.0;
let timescaleTarget = 1.0;
const TIMESCALE_K = 6; // 1/s

function updateTimescale(dtReal) {
  const t = 1 - Math.exp(-TIMESCALE_K * dtReal);
  timescale += (timescaleTarget - timescale) * t;
}

// ---- resize ------------------------------------------------------------

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  offAxis.setViewport(w, h);
}

window.addEventListener('resize', onResize);
onResize();

// ---- quality governor (rolling 90-frame fps) ---------------------------

const fpsSamples = [];
let qualityStep = 0; // 0 = full quality/full tracking, 1 = tunnel reduced, 2 = hand-only
let lowFpsSinceMs = null;
let highFpsSinceMs = null;

function updateQualityGovernor(dtReal, nowMs) {
  if (dtReal <= 0) return;
  const fps = 1 / dtReal;
  fpsSamples.push(fps);
  if (fpsSamples.length > PERF.fpsWindow) fpsSamples.shift();
  if (fpsSamples.length < PERF.fpsWindow) return;

  let sum = 0;
  for (let i = 0; i < fpsSamples.length; i++) sum += fpsSamples[i];
  const avgFps = sum / fpsSamples.length;

  if (avgFps < PERF.lowFps) {
    if (lowFpsSinceMs === null) lowFpsSinceMs = nowMs;
    highFpsSinceMs = null;

    if (qualityStep === 0) {
      tunnel.setQuality(PERF.reducedQuality);
      qualityStep = 1;
      lowFpsSinceMs = nowMs; // restart the demote clock for the next step
    } else if (qualityStep === 1 && nowMs - lowFpsSinceMs >= PERF.demoteHoldMs) {
      tracking.setMode('hand-only');
      qualityStep = 2;
    }
  } else if (avgFps > PERF.highFps) {
    lowFpsSinceMs = null;
    if (highFpsSinceMs === null) highFpsSinceMs = nowMs;

    if (qualityStep > 0 && nowMs - highFpsSinceMs >= PERF.recoverHoldMs) {
      if (qualityStep === 2) {
        tracking.setMode('full');
        qualityStep = 1;
      } else if (qualityStep === 1) {
        tunnel.setQuality(PERF.fullQuality);
        qualityStep = 0;
      }
      highFpsSinceMs = nowMs; // require another clean recovery window per step
    }
  } else {
    lowFpsSinceMs = null;
    highFpsSinceMs = null;
  }
}

// ---- miss handling -------------------------------------------------------

bus.on('ball:miss', () => {
  tunnel.setDim(0.5);
});

// ---- question sequence ---------------------------------------------------

let questionIndex = 0;
let questioning = false;

bus.on('block:broken', ({ pos }) => {
  if (questionIndex >= QUESTIONS.length) return;
  runQuestion(pos);
});

async function runQuestion(pos) {
  if (questioning) return;
  questioning = true;
  const idx = questionIndex;
  questionIndex++;

  setState('question');
  timescaleTarget = 0.12;
  tunnel.emitRing(pos.z, 1.0);

  bus.emit('question:start', { index: idx });
  await overlay.show(QUESTIONS[idx], idx);
  bus.emit('question:end', { index: idx });

  timescaleTarget = 1.0;
  setState('play');
  questioning = false;
}

// ---- ending sequence -------------------------------------------------------

let ending = false;

function maybeEnd() {
  if (ending) return;
  const s = game.stats;
  const questionsShown = questionIndex >= GAMEPLAY.questionTarget;
  const allBroken = s.blocksBroken >= s.blocksTotal;
  if (questionsShown || allBroken) {
    startEnding();
  }
}

async function startEnding() {
  ending = true;
  setState('ending');
  timescaleTarget = 0;

  tunnel.emitRing(game.ballPos ? game.ballPos.z : -8, 1.0);
  await wait(400);
  tunnel.emitRing(game.ballPos ? game.ballPos.z : -8, 1.0);
  await wait(400);
  tunnel.emitRing(game.ballPos ? game.ballPos.z : -8, 1.0);

  const ganzfeld = document.createElement('div');
  ganzfeld.style.position = 'fixed';
  ganzfeld.style.inset = '0';
  ganzfeld.style.background = PALETTE.glow;
  ganzfeld.style.opacity = '0';
  ganzfeld.style.transition = 'opacity 6s ease';
  ganzfeld.style.zIndex = '9997';
  ganzfeld.style.pointerEvents = 'none';
  uiRoot.appendChild(ganzfeld);
  requestAnimationFrame(() => { ganzfeld.style.opacity = '1'; });

  await wait(6000);

  await overlay.show('you brought all of this with you', -1);

  const again = document.createElement('button');
  again.textContent = 'again';
  again.style.position = 'fixed';
  again.style.left = '50%';
  again.style.bottom = '12%';
  again.style.transform = 'translateX(-50%)';
  again.style.zIndex = '9999';
  again.style.background = 'transparent';
  again.style.border = `1px solid ${PALETTE.filament}`;
  again.style.color = PALETTE.filament;
  again.style.fontFamily = "'IBM Plex Mono', ui-monospace, monospace";
  again.style.fontSize = '0.9rem';
  again.style.letterSpacing = '0.05em';
  again.style.textTransform = 'lowercase';
  again.style.padding = '0.7em 1.6em';
  again.style.cursor = 'pointer';
  uiRoot.appendChild(again);

  again.addEventListener('click', () => {
    ganzfeld.remove();
    again.remove();
    resetAndRestart();
  }, { once: true });
}

function resetAndRestart() {
  questionIndex = 0;
  questioning = false;
  ending = false;
  timescale = 1.0;
  timescaleTarget = 1.0;
  tunnel.setDim(0);
  game.start();
  setState('play');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- tracking wiring -------------------------------------------------------

let lastTrackingSnapshot = null;

function updateTracking() {
  if (!tracking.ready) return;
  const t = tracking.poll();
  lastTrackingSnapshot = t;
  if (t.hand.present) game.setPaddleTarget(t.hand.x, t.hand.y); // else hold last paddle target
  if (t.mode === 'full' && t.head.present) {
    offAxis.setEyePosition(t.head.x, t.head.y, t.head.z);
  }
}

// ---- main loop -------------------------------------------------------------

const FIXED_STEP = 1 / 120;
let accumulator = 0;
let lastMs = performance.now();

function animate(nowMs) {
  requestAnimationFrame(animate);

  const dtReal = Math.min((nowMs - lastMs) / 1000, 0.25);
  lastMs = nowMs;

  updateQualityGovernor(dtReal, nowMs);
  updateTimescale(dtReal);

  if (gameState === 'play' || gameState === 'question') {
    updateTracking();

    accumulator += dtReal;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 240) {
      game.update(FIXED_STEP * timescale);
      accumulator -= FIXED_STEP;
      steps++;
    }

    if (gameState === 'play') maybeEnd();
  }

  tunnel.update(dtReal);
  offAxis.update();

  renderer.render(scene, offAxis.camera);

  updateDebugHud();
}

requestAnimationFrame(animate);
setState('gate');

// ---- mute toggle -------------------------------------------------------

let muted = false;
window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') {
    muted = !muted;
    audio.setMuted(muted);
  }
  if (e.key === 'd' || e.key === 'D') {
    toggleDebugHud();
  }
});

// ---- debug readout (hidden by default, lazy-built on first 'd' press) ------

let debugHud = null;
let debugHudVisible = false;

function toggleDebugHud() {
  if (!debugHud) {
    debugHud = document.createElement('div');
    debugHud.id = 'debug-hud';
    debugHud.style.position = 'fixed';
    debugHud.style.top = '8px';
    debugHud.style.left = '8px';
    debugHud.style.zIndex = '99999';
    debugHud.style.pointerEvents = 'none';
    debugHud.style.fontFamily = "'IBM Plex Mono', ui-monospace, monospace";
    debugHud.style.fontSize = '0.7rem';
    debugHud.style.lineHeight = '1.3';
    debugHud.style.color = PALETTE.filament;
    debugHud.style.opacity = '0.75';
    debugHud.style.whiteSpace = 'pre';
    (uiRoot || document.body).appendChild(debugHud);
  }
  debugHudVisible = !debugHudVisible;
  debugHud.style.display = debugHudVisible ? 'block' : 'none';
}

function updateDebugHud() {
  if (!debugHud || !debugHudVisible) return;
  const t = lastTrackingSnapshot;
  const fps = fpsSamples.length ? fpsSamples[fpsSamples.length - 1] : 0;
  if (!t) {
    debugHud.textContent = 'tracking: not ready';
    return;
  }
  debugHud.textContent =
    `hand x: ${t.hand.x.toFixed(2)}\n` +
    `hand y: ${t.hand.y.toFixed(2)}\n` +
    `hand.present: ${t.hand.present}\n` +
    `mode: ${t.mode}\n` +
    `procMs: ${t.procMs.toFixed(1)}\n` +
    `fps: ${fps.toFixed(1)}`;
}

// ---- boot -------------------------------------------------------------

runOnboarding(tracking, uiRoot).then(() => {
  overlay = new QuestionOverlay(uiRoot);
  audio.init();
  audio.listen(bus);
  game.start();
  setState('play');
}).catch((err) => {
  if (err && err.code === 'gate') {
    // Gate page already rendered by runOnboarding; nothing more to do.
    return;
  }
  // Unexpected rejection: surface in console, stay on gate state.
  console.error('onboarding failed', err);
});
