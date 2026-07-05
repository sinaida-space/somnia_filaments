import * as THREE from 'three';
import { PALETTE, TUNNEL } from './config.js';
import { vert, frag } from './shaders/tunnelWalls.glsl.js';

// Inward-facing tunnel of turbulent cyan light filaments.
//
// A single open-ended cylinder (BackSide) is rotated so its axis lies along Z
// and pushed forward so it spans z = 0 .. -length. All the look lives in the
// ShaderMaterial (see shaders/tunnelWalls.glsl.js); this class owns the mesh,
// drives uTime, and manages a small fixed pool of travelling ring pulses.

const RING_SLOTS = 4;

export class Tunnel {
  constructor(scene) {
    // 96 radial segments give smooth filament wrap; 64 along length feeds the
    // vertex world-pos varying densely enough for the fog gradient. Open-ended
    // (last arg true) so there are no end caps to see.
    const geo = new THREE.CylinderGeometry(
      TUNNEL.radius, TUNNEL.radius, TUNNEL.length, 96, 64, true
    );

    this.uniforms = {
      uTime:        { value: 0 },
      // vec3 per ring: (bornZ, birthTime, strength). strength <= 0 == inactive.
      uRings:       { value: Array.from({ length: RING_SLOTS }, () => new THREE.Vector3(0, 0, 0)) },
      uDim:         { value: 0 },
      uQuality:     { value: 1.0 },
      uColFilament: { value: new THREE.Color(PALETTE.filament) },
      uColGlow:     { value: new THREE.Color(PALETTE.glow) },
      uColVoid:     { value: new THREE.Color(PALETTE.void) },
    };

    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    // Cylinder axis is Y by default -> rotate to Z, then centre the span at
    // z = -length/2 so it runs from the camera (z~0) into -Z.
    this.mesh.rotation.x = Math.PI / 2;
    this.mesh.position.z = -TUNNEL.length / 2;
    scene.add(this.mesh);

    this._time = 0;
    this._nextSlot = 0;   // oldest-first recycling cursor
    this._dimTarget = 0;
  }

  update(dt, timeSec) {
    // Prefer the caller's clock when given; otherwise integrate dt ourselves.
    this._time = (timeSec !== undefined) ? timeSec : this._time + dt;
    this.uniforms.uTime.value = this._time;

    // Dim decays back to 0 over ~1.5s (exp ease toward target 0).
    const dim = this.uniforms.uDim;
    dim.value += (this._dimTarget - dim.value) * Math.min(1, dt / 1.5 * 4);
    if (dim.value < 0.001) dim.value = 0;
    // Target itself relaxes so a setDim spike fades rather than latching.
    this._dimTarget += (0 - this._dimTarget) * Math.min(1, dt / 1.5 * 4);

    // Retire rings past their lifetime so freed slots read as inactive.
    const rings = this.uniforms.uRings.value;
    for (let i = 0; i < RING_SLOTS; i++) {
      const age = this._time - rings[i].y;
      if (rings[i].z > 0 && age > 2.5) rings[i].z = 0;
    }
  }

  emitRing(zWorld, strength = 1.0) {
    const rings = this.uniforms.uRings.value;
    // Reuse an inactive slot if one exists, else evict oldest (round-robin).
    let slot = -1;
    for (let i = 0; i < RING_SLOTS; i++) {
      if (rings[i].z <= 0) { slot = i; break; }
    }
    if (slot === -1) {
      slot = this._nextSlot;
      this._nextSlot = (this._nextSlot + 1) % RING_SLOTS;
    }
    rings[slot].set(zWorld, this._time, strength);
  }

  setDim(v) {
    // Momentary darkening; update() eases it back down.
    this._dimTarget = Math.max(this._dimTarget, Math.min(1, Math.max(0, v)));
    this.uniforms.uDim.value = Math.max(this.uniforms.uDim.value, this._dimTarget);
  }

  setQuality(q) {
    // 1.0 -> 5 octaves, 0.6 -> 3 octaves (branch in the frag shader).
    this.uniforms.uQuality.value = q;
  }
}
