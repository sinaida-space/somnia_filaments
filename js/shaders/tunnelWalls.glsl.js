// Tunnel walls shader — turbulent electric-cyan light filaments on near-black.
//
// Look: long-exposure light-painting. Ridged, domain-warped value-noise fbm,
// stretched heavily along z (anisotropic sampling), sharpened with pow(), and
// turned into additive glow via exponential falloff. No postprocessing bloom —
// the glow is baked into the fragment math so we stay single-pass at 60fps.
//
// Cost note: the fbm loop dominates the frame. Octave count is compile-time
// bounded (MAX_OCTAVES) and gated at runtime by uQuality so we can trade
// fidelity for speed on weaker GPUs without recompiling.

export const vert = /* glsl */`
  varying vec3 vWorldPos;

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const frag = /* glsl */`
  precision highp float;

  varying vec3 vWorldPos;

  uniform float uTime;
  uniform vec3  uRings[4];   // per ring: (bornZ, birthTime, strength); strength<=0 == inactive
  uniform float uDim;        // 0..1 momentary darkening
  uniform float uQuality;    // 1.0 (5 octaves) | 0.6 (3 octaves)
  uniform vec3  uColFilament;
  uniform vec3  uColGlow;
  uniform vec3  uColVoid;

  #define MAX_OCTAVES 5
  #define RING_SPEED 10.0    // world units / sec toward -Z
  #define RING_WIDTH 1.5     // world units
  #define RING_LIFE  2.5     // seconds

  // Cheap hash -> value noise. Deliberately not simplex: this is the hot path.
  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  }

  float valueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);           // smoothstep interpolant
    // 8 corner samples of the unit cell.
    float n000 = hash(i + vec3(0.0, 0.0, 0.0));
    float n100 = hash(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash(i + vec3(1.0, 1.0, 1.0));
    float nx00 = mix(n000, n100, f.x);
    float nx10 = mix(n010, n110, f.x);
    float nx01 = mix(n001, n101, f.x);
    float nx11 = mix(n011, n111, f.x);
    float nxy0 = mix(nx00, nx10, f.y);
    float nxy1 = mix(nx01, nx11, f.y);
    return mix(nxy0, nxy1, f.z);
  }

  // Ridged fbm: each octave folded to a ridge (1 - |2n-1|), accumulated.
  // octaveLimit is the runtime-active count; the loop bound stays constant.
  float ridgedFbm(vec3 p, int octaveLimit) {
    float sum = 0.0;
    float amp = 0.55;
    float freq = 1.0;
    for (int o = 0; o < MAX_OCTAVES; o++) {
      if (o >= octaveLimit) break;
      float n = valueNoise(p * freq);
      float ridge = 1.0 - abs(2.0 * n - 1.0);  // ridge in 0..1
      sum += ridge * amp;
      freq *= 2.0;
      amp  *= 0.5;
    }
    return sum;
  }

  void main() {
    int octaves = (uQuality >= 0.8) ? 5 : 3;

    // Anisotropic sample coords: compress z so features stretch into long
    // filament streaks down the tunnel; the drift term slides them toward -Z.
    vec3 base = vec3(vWorldPos.xy * 2.2, vWorldPos.z * 0.35);
    vec3 sp = base;
    sp.z -= uTime * 0.6;

    // Domain warp: perturb the sample by a low-freq ridged field for the
    // wandering, hand-painted quality.
    float warp = ridgedFbm(sp * 0.5, octaves);
    sp += vec3(warp * 0.9, warp * 0.9, warp * 0.4);

    float f = ridgedFbm(sp, octaves);

    // Sharpen ridges into thin bright filaments.
    float fil = pow(clamp(f, 0.0, 1.0), 4.5);

    // Exponential glow falloff around the sharpened filaments -> soft additive halo.
    float glow = fil + pow(clamp(f, 0.0, 1.0), 2.0) * 0.25;

    vec3 col = uColFilament * fil * 2.2 + uColGlow * glow * 0.6;

    // Ring pulses: bright bands travelling toward -Z, additive over filaments.
    for (int r = 0; r < 4; r++) {
      float strength = uRings[r].z;
      if (strength <= 0.0) continue;
      float age = uTime - uRings[r].y;
      if (age < 0.0 || age > RING_LIFE) continue;
      float ringZ = uRings[r].x - age * RING_SPEED;
      float band = 1.0 - smoothstep(0.0, RING_WIDTH, abs(vWorldPos.z - ringZ));
      float fade = 1.0 - (age / RING_LIFE);
      col += uColGlow * band * fade * strength * 1.6;
    }

    // Depth fog: mix to void with 1 - exp(-0.03 * dist). Camera sits at origin,
    // so world distance ~= length(vWorldPos).
    float dist = length(vWorldPos);
    float fog = 1.0 - exp(-0.03 * dist);
    col = mix(col, uColVoid, fog);

    // Momentary darkening (miss feedback).
    col *= (1.0 - uDim * 0.85);

    // Lift toward void so the darkest walls are near-black, never pure 0.
    col += uColVoid;

    gl_FragColor = vec4(col, 1.0);
  }
`;
