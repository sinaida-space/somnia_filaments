export const PALETTE = { filament: '#22E5FF', glow: '#7BF7FF', void: '#020508', dim: '#0A3540' };
export const TUNNEL = { radius: 3.0, length: 60, farZ: -58 };
export const WORLD_PER_METER = 10;
// Baseline eye→screen distance. Larger z = camera sits further back through the
// window, so more of the tunnel is visible and it reads as further away. Bumped
// from 0.55 → 0.85 (T21 zoom-out) — the tunnel was too in-your-face. The whole
// head-z clamp band (HEADGAIN.zMin/zMax) moves with it so real head motion still
// slews within a plausible band and the off-axis parallax/stability is preserved.
export const SCREEN = { widthM: 0.34, defaultEyeM: { x: 0, y: 0, z: 0.85 } };
export const GAMEPLAY = { ballSpeed: 14, ballR: 0.25, paddleZ: -4, paddleHalfW: 0.9, paddleHalfH: 0.6,
                          blockR: 0.7, blockCount: 36, questionTarget: 12 };

// Fishtank-VR head->view coupling. main.js reads these; no magic numbers inline.
// The off-axis frustum stays physically-based — HEADGAIN.lateral just maps a
// natural head shift to a slightly larger virtual-eye shift so the parallax
// reads. zMin/zMax clamp head depth to a plausible band so IPD-derived z noise
// can't warp the frustum scale (s = near/ez). deadzoneM + slewPerSec kill
// micro-jitter/swim of the whole scene without lagging real head motion.
export const HEADGAIN = {
  lateral: 1.6,     // gain on head x/y before setEyePosition (>1 amplifies parallax)
  zMin: 0.60,       // clamp head z (metres) — plausible near bound (T21: band moved back with defaultEyeM.z)
  zMax: 1.15,       // clamp head z (metres) — plausible far bound (T21: was 0.90)
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
