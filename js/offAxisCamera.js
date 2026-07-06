import * as THREE from 'three';
import { SCREEN, WORLD_PER_METER } from './config.js';

// Kooima generalized perspective projection.
// "Generalized Perspective Projection", R. Kooima, 2008.
//
// The screen is a physical rectangle we look THROUGH like a window. We keep its
// definition (center, size, orientation) in one private struct so a future
// projector/installation build can swap it out — e.g. a screen that is not
// centred at the world origin, or lies in a different plane. Here:
//   - screen is centred at world origin,
//   - lies in the XY plane (normal = +Z),
//   - its physical width is SCREEN.widthM metres, height derived from the
//     viewport aspect, both converted to world units via WORLD_PER_METER.
//
// The eye sits at (ex, ey, ez) world units, +z toward the viewer. Rather than
// rotating the camera to aim at the screen (which is WRONG for off-axis — it
// distorts the window), we keep the camera axis-aligned (no rotation) at the
// eye position and put ALL of the asymmetry into the projection frustum.

export class OffAxisCamera {
  constructor({ screenWidthM = SCREEN.widthM, near = 0.05, far = 120 } = {}) {
    this.near = near;
    this.far = far;

    // Private screen definition — the single place installation-specific
    // geometry lives. Swap this for a projector build.
    this._screen = {
      widthM: screenWidthM,
      // half-extents in WORLD units, filled in by setViewport()
      halfW: 1,
      halfH: 1,
    };

    // Axis-aligned perspective camera; we override its projection matrix.
    // fov/aspect/near/far here are placeholders — update() rebuilds the matrix.
    this.camera = new THREE.PerspectiveCamera(50, 1, near, far);
    this.camera.matrixAutoUpdate = true; // we only override PROJECTION, not view;
                                         // position drives the (unrotated) view matrix.
    this.camera.rotation.set(0, 0, 0);

    // Eye position in world units.
    const e = SCREEN.defaultEyeM;
    this._eye = new THREE.Vector3(
      e.x * WORLD_PER_METER,
      e.y * WORLD_PER_METER,
      e.z * WORLD_PER_METER
    );

    // Frustum is only rebuilt when the eye or viewport actually moves. Both
    // setters flip this; update() clears it. Saves a projection-matrix invert
    // (raycast/cull read projectionMatrixInverse) on frames where nothing moved.
    this._dirty = true;

    this.setViewport(window.innerWidth, window.innerHeight);
  }

  // Recompute screen half-extents (world units) from the physical width and the
  // viewport aspect. Height metres = widthM / aspect so on-screen pixels stay square.
  setViewport(wPx, hPx) {
    const aspect = wPx / hPx;
    const widthWu = this._screen.widthM * WORLD_PER_METER;
    const heightWu = widthWu / aspect;
    this._screen.halfW = widthWu / 2;
    this._screen.halfH = heightWu / 2;
    this._dirty = true;
  }

  // Eye position in METRES relative to screen centre, +z toward viewer.
  setEyePosition(xM, yM, zM) {
    this._eye.set(
      xM * WORLD_PER_METER,
      yM * WORLD_PER_METER,
      zM * WORLD_PER_METER
    );
    this._dirty = true;
  }

  // Recompute the off-axis frustum + keep projectionMatrixInverse in sync
  // (raycasting / frustum culling read the inverse). Call once per frame.
  update() {
    if (!this._dirty) return;
    this._dirty = false;

    const ex = this._eye.x;
    const ey = this._eye.y;
    const ez = this._eye.z;
    const { halfW, halfH } = this._screen;
    const { near, far } = this;

    // Screen edges at z=0 projected onto the near plane, seen from the eye.
    // Scale factor near/ez maps screen-plane offsets to the near plane.
    const s = near / ez;
    const left   = (-halfW - ex) * s;
    const right  = ( halfW - ex) * s;
    const bottom = (-halfH - ey) * s;
    const top    = ( halfH - ey) * s;

    // Place the camera at the eye, axis-aligned (looking down -Z).
    this.camera.position.copy(this._eye);

    const m = this.camera.projectionMatrix;
    m.makePerspective(left, right, top, bottom, near, far, THREE.WebGLCoordinateSystem);
    this.camera.projectionMatrixInverse.copy(m).invert();
  }
}
