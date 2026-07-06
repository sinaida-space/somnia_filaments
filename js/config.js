export const PALETTE = { filament: '#22E5FF', glow: '#7BF7FF', void: '#020508', dim: '#0A3540' };
// T21-fix: zoom-out is done here (wider hall + content pushed back), NOT by
// moving the eye — see SCREEN comment below for why that lever is backwards.
export const TUNNEL = { radius: 4.2, length: 60, farZ: -58 };
export const WORLD_PER_METER = 10;
// Baseline eye→screen distance. In a Kooima off-axis window, objects BEHIND the
// screen plane (paddle, blocks, tunnel — everything here) get proportionally
// LARGER as the eye moves back, not smaller: distance-to-paddle/distance-to-screen
// = ez/(ez+|paddleZ|) → 1 as ez grows. T21 bumped this to 0.85 intending a
// zoom-out and instead inflated the paddle. Reverted to 0.55; real zoom-out now
// lives in TUNNEL.radius (wider hall) and GAMEPLAY.paddleZ (content pushed back).
export const SCREEN = { widthM: 0.34, defaultEyeM: { x: 0, y: 0, z: 0.55 } };
export const GAMEPLAY = { ballSpeed: 14, ballR: 0.25, paddleZ: -6.5, paddleHalfW: 0.9, paddleHalfH: 0.6,
                          blockR: 0.7, blockCount: 36, questionTarget: 12 };

// Fishtank-VR head->view coupling. main.js reads these; no magic numbers inline.
// The off-axis frustum stays physically-based — HEADGAIN.lateral just maps a
// natural head shift to a slightly larger virtual-eye shift so the parallax
// reads. zMin/zMax clamp head depth to a plausible band so IPD-derived z noise
// can't warp the frustum scale (s = near/ez). deadzoneM + slewPerSec kill
// micro-jitter/swim of the whole scene without lagging real head motion.
export const HEADGAIN = {
  lateral: 1.6,     // gain on head x/y before setEyePosition (>1 amplifies parallax)
  zMin: 0.35,       // clamp head z (metres) — plausible near bound (reverted with defaultEyeM.z)
  zMax: 0.90,       // clamp head z (metres) — plausible far bound (reverted with defaultEyeM.z)
  deadzoneM: 0.003, // ignore sub-3mm eye moves (kills static shimmer)
  slewPerSec: 4.0,  // max eye travel (metres/sec) toward target — anti-swim slew limit
};

// Quality/degradation governor. Ladder is fixed: quality drop (step 1) before
// hand-only tracking (step 2); the hand paddle never drops. main.js reads these
// — no magic numbers there.
export const PERF = {
  fpsWindow: 90,          // rolling frames averaged for the fps estimate
  lowFps: 55,             // below this (avg) → demote
  highFps: 58,            // above this (avg) → recover
  demoteHoldMs: 3000,     // sustained low-fps time before step 1 → step 2
  recoverHoldMs: 5000,    // sustained high-fps time before each recovery step
  reducedQuality: 0.6,    // tunnel quality at step 1
  fullQuality: 1.0,       // tunnel quality at step 0
};
