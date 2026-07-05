// Tunnel walls shader — sparse glowing cyan filaments on a near-black void.
//
// Look: "space noir dreamcore". The wall is a dark field (uColVoid dominates the
// frame at rest); a small set of helical filaments wound along the tunnel's Z
// axis are the only bright things. Each filament is an analytic curve on the
// cylinder wall — angle advances linearly with depth (a helix) plus a little
// sinusoidal wander so it reads hand-drawn rather than machined. Per fragment we
// measure arc-length distance to each filament centreline and turn it into a
// thin hot core plus a soft exponential halo (exp(-d*k)) — the same crisp-core /
// additive-falloff family as a glowing constellation edge. All glow is baked in
// the fragment math: single pass, no postprocessing bloom.
//
// Why analytic helices, not thresholded fbm: the void between filaments is
// exactly zero, so the frame is provably dark-dominant and the "how many bright
// traces exist" count is a constant (FIL_COUNT), not an emergent property of a
// noise band. Cost is a small fixed loop; uQuality trims the filament count and
// skips the grain for weaker GPUs.

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
  uniform vec3  uRings[4];    // per ring: (bornZ, birthTime, strength); strength<=0 == inactive
  uniform float uDim;         // 0..1 momentary darkening
  uniform float uQuality;     // 1.0 (6 filaments + grain) | 0.6 (3 filaments, no grain)
  uniform vec3  uColFilament; // hot core colour (electric cyan)
  uniform vec3  uColGlow;     // soft halo colour (pale cyan)
  uniform vec3  uColVoid;     // near-black background

  #define FIL_MAX     6
  #define TWO_PI      6.2831853
  #define RING_SPEED  10.0    // world units / sec toward -Z
  #define RING_WIDTH  1.5     // world units
  #define RING_LIFE   2.5     // seconds
  #define TUNNEL_R    3.0     // cylinder radius (matches config TUNNEL.radius)

  // Cheap hash for the film grain only (filaments are analytic, no noise).
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  // Per-filament constants, spread around the tube. Returned as
  // (phase0, twist, wanderAmp, wanderFreq).
  vec4 filamentParams(int k) {
    // Deterministic but irregular spacing so the filaments don't sit on a
    // perfect lattice. Values chosen by hand for a pleasant scatter.
    float fk = float(k);
    float phase0    = fk * 2.3999632;               // golden-angle-ish spread around the tube
    float twist     = 0.22 + 0.10 * sin(fk * 1.7);  // radians of angle per world-unit of z
    float wanderAmp = 0.28 + 0.14 * fract(fk * 0.618);
    float wanderFreq= 0.35 + 0.12 * fract(fk * 1.371);
    return vec4(phase0, twist, wanderAmp, wanderFreq);
  }

  // Smallest absolute wrapped angular difference in [0, PI].
  float angDiff(float a, float b) {
    float d = mod(a - b + 3.14159265, TWO_PI) - 3.14159265;
    return abs(d);
  }

  // Per-filament temporal phase seed so their wander desyncs.
  float filSeed(int k) {
    return float(k) * 2.399963;
  }

  void main() {
    // Active filament count by quality (loop bound stays constant).
    int filCount = (uQuality >= 0.8) ? 6 : 3;

    // Cylinder-wall coordinates: angle around the tube, and depth (world z).
    float ang = atan(vWorldPos.y, vWorldPos.x);   // -PI..PI
    float z   = vWorldPos.z;                        // 0 (near) .. -length (far)

    // A gentle global drift of the whole filament bundle toward the camera,
    // so the network appears to flow past you down the tunnel.
    float flow = uTime * 0.25;

    float core = 0.0;   // thin hot centreline accumulator
    float halo = 0.0;   // soft additive falloff accumulator

    for (int k = 0; k < FIL_MAX; k++) {
      if (k >= filCount) break;
      vec4 fp = filamentParams(k);
      float phase0    = fp.x;
      float twist     = fp.y;
      float wanderAmp = fp.z;
      float wanderFreq= fp.w;

      // Helix angle at this depth, plus slow sinusoidal wander + global flow.
      float filAng = phase0
                   + z * twist
                   + wanderAmp * sin(z * wanderFreq + uTime * 0.6 + filSeed(k))
                   + flow;

      // Arc-length distance from this fragment to the filament centreline.
      float dAng = angDiff(ang, filAng);
      float dArc = dAng * TUNNEL_R;   // radians -> world arc length on the wall

      // Crisp hot core: sub-pixel-thin bright centreline.
      core += 1.0 - smoothstep(0.0, 0.045, dArc);
      // Soft exponential halo radiating outward from the core.
      halo += exp(-dArc * 6.0);
    }

    // Compose: hot near-white core drives the filament colour; halo is the
    // softer pale-cyan bloom. Everything not near a filament stays ~0 here.
    vec3 col = uColFilament * core * 1.6
             + uColGlow     * halo * 0.55;

    // Ring pulses: bright bands travelling toward -Z. They only light where the
    // filament network already is (band * halo), so a pulse reads as a glow
    // surge racing along the traces rather than a solid disc.
    for (int r = 0; r < 4; r++) {
      float strength = uRings[r].z;
      if (strength <= 0.0) continue;
      float age = uTime - uRings[r].y;
      if (age < 0.0 || age > RING_LIFE) continue;
      float ringZ = uRings[r].x - age * RING_SPEED;
      float band  = 1.0 - smoothstep(0.0, RING_WIDTH, abs(z - ringZ));
      float fade  = 1.0 - (age / RING_LIFE);
      // Surge the filaments here, plus a faint void-fill so the band is
      // perceptible even in the gaps between traces.
      col += uColGlow * band * fade * strength * (halo * 1.4 + 0.06);
    }

    // Depth fade: far filaments desaturate and sink toward the void rather than
    // snapping to pure cyan-to-black. Camera sits at origin, dist ~= |worldPos|.
    float dist = length(vWorldPos);
    float fog  = 1.0 - exp(-0.045 * dist);
    // Slight desaturation toward the fog limit (noir, not neon).
    float lum  = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(lum), fog * 0.4);
    col = mix(col, uColVoid, fog);

    // Radial vignette: fragments whose screen-projected direction points away
    // from the tunnel axis (-Z) sit at the frame edge. Use the angle between the
    // view direction and the axis as a cheap vignette proxy.
    vec3 viewDir = normalize(vWorldPos);      // camera at origin
    float axial  = -viewDir.z;                 // 1 straight ahead, ->0 at edges
    float vign    = smoothstep(-0.15, 0.85, axial);
    col *= mix(0.55, 1.0, vign);

    // Momentary darkening (miss feedback).
    col *= (1.0 - uDim * 0.85);

    // Restrained film grain (skipped on low quality). Animated per frame, very
    // low opacity, and scaled by local brightness so the void stays clean.
    if (uQuality >= 0.8) {
      float g = hash21(gl_FragCoord.xy + fract(uTime) * 91.7);
      col += (g - 0.5) * 0.03 * (0.4 + col);
    }

    // Lift toward void so the darkest walls are near-black, never pure 0.
    col += uColVoid;

    gl_FragColor = vec4(col, 1.0);
  }
`;
