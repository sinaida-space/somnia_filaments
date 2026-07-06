import * as THREE from 'three';
import { PALETTE, TUNNEL, GAMEPLAY } from './config.js';

// ---- seeded value-noise / curl-noise helper -------------------------------

const SEED = 1989;

function hash3(x, y, z) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + SEED * 0.001) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);

  const c000 = hash3(xi, yi, zi);
  const c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi);
  const c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1);
  const c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1);
  const c111 = hash3(xi + 1, yi + 1, zi + 1);

  const x00 = c000 + (c100 - c000) * u;
  const x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u;
  const x11 = c011 + (c111 - c011) * u;

  const y0 = x00 + (x10 - x00) * v;
  const y1 = x01 + (x11 - x01) * v;

  return y0 + (y1 - y0) * w;
}

// Three offset value-noise fields act as potential components for a curl-noise
// approximation via finite differences. Cheap, deterministic (seed 1989).
const EPS = 0.1;
const OFFA = [0, 0, 0];
const OFFB = [37.1, 11.3, 5.7];
const OFFC = [91.7, 23.9, 61.2];

function potential(off, x, y, z, t) {
  return valueNoise3(x + off[0], y + off[1], z + off[2] + t * 0.05);
}

// Reused across every physics step so the hot loop allocates nothing.
const _curlOut = new THREE.Vector3();

function curl(pos, t) {
  const { x, y, z } = pos;

  const pA_y1 = potential(OFFA, x, y + EPS, z, t);
  const pA_y0 = potential(OFFA, x, y - EPS, z, t);
  const pA_z1 = potential(OFFA, x, y, z + EPS, t);
  const pA_z0 = potential(OFFA, x, y, z - EPS, t);

  const pB_x1 = potential(OFFB, x + EPS, y, z, t);
  const pB_x0 = potential(OFFB, x - EPS, y, z, t);
  const pB_z1 = potential(OFFB, x, y, z + EPS, t);
  const pB_z0 = potential(OFFB, x, y, z - EPS, t);

  const pC_x1 = potential(OFFC, x + EPS, y, z, t);
  const pC_x0 = potential(OFFC, x - EPS, y, z, t);
  const pC_y1 = potential(OFFC, x, y + EPS, z, t);
  const pC_y0 = potential(OFFC, x, y - EPS, z, t);

  // curl = ( dPz/dy - dPy/dz, dPx/dz - dPz/dx, dPy/dx - dPx/dy )
  const dPzdy = (pC_y1 - pC_y0) / (2 * EPS);
  const dPydz = (pA_z1 - pA_z0) / (2 * EPS);
  const dPxdz = (pB_z1 - pB_z0) / (2 * EPS);
  const dPzdx = (pC_x1 - pC_x0) / (2 * EPS);
  const dPydx = (pB_x1 - pB_x0) / (2 * EPS);
  const dPxdy = (pA_y1 - pA_y0) / (2 * EPS);

  return _curlOut.set(
    dPzdy - dPydz,
    dPxdz - dPzdx,
    dPydx - dPxdy
  );
}

// ---- deterministic block placement -----------------------------------------

function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export class Game {
  constructor(scene, bus) {
    this.scene = scene;
    this.bus = bus;

    this.paddleTarget = new THREE.Vector2(0, 0);
    this.paddlePos = new THREE.Vector2(0, 0);

    this.ballVel = new THREE.Vector3(0, 0, -GAMEPLAY.ballSpeed);
    this.ballAlive = true;
    this.ballFading = false;
    this.fadeT = 0;
    this.respawnT = 0;

    this.time = 0;

    this.stats = { blocksBroken: 0, blocksTotal: GAMEPLAY.blockCount, misses: 0 };

    this.blocks = [];

    this._buildPaddle();
    this._buildBall();
  }

  _buildPaddle() {
    const geo = new THREE.BoxGeometry(GAMEPLAY.paddleHalfW * 2, GAMEPLAY.paddleHalfH * 2, 0.1);
    // rounded-box stand-in: thin box, semi-transparent cyan
    const mat = new THREE.MeshBasicMaterial({
      color: PALETTE.filament,
      transparent: true,
      opacity: 0.55
    });
    this.paddleMesh = new THREE.Mesh(geo, mat);
    this.paddleMesh.position.set(0, 0, GAMEPLAY.paddleZ);
    this.scene.add(this.paddleMesh);
  }

  _buildBall() {
    const geo = new THREE.SphereGeometry(GAMEPLAY.ballR, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color: PALETTE.glow, transparent: true, opacity: 1 });
    this.ballMesh = new THREE.Mesh(geo, mat);
    this.ballMesh.position.set(0, 0, -8);
    this.scene.add(this.ballMesh);
    this.ballPos = this.ballMesh.position;
  }

  _buildBlocks() {
    const rand = seededRandom(SEED);
    const bandCount = 12;
    const perBand = 3;
    const zStart = -16;
    const zStep = 3.27;

    const geo = new THREE.IcosahedronGeometry(0.45, 0);

    let id = 0;
    for (let band = 0; band < bandCount; band++) {
      const z = zStart - band * zStep;
      for (let i = 0; i < perBand; i++) {
        const radius = 1.2 + rand() * (2.4 - 1.2);
        const angle = rand() * Math.PI * 2 + i * (Math.PI * 2 / perBand);
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;

        const mat = new THREE.MeshBasicMaterial({ color: PALETTE.filament, transparent: true, opacity: 0.85 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.userData.spinAxis = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
        mesh.userData.spinSpeed = 0.2 + rand() * 0.4;

        // Glowing edge outline, parented to the block so it spins and
        // scale-to-zeros with the break animation alongside the filled shard.
        const edgeGeo = new THREE.EdgesGeometry(geo);
        const edgeMat = new THREE.LineBasicMaterial({ color: PALETTE.glow });
        const edges = new THREE.LineSegments(edgeGeo, edgeMat);
        mesh.add(edges);

        this.scene.add(mesh);

        this.blocks.push({
          id: id++,
          mesh,
          pos: mesh.position,
          alive: true,
          breaking: false,
          breakT: 0
        });
      }
    }
  }

  start() {
    // clear any prior blocks (idempotent restart)
    for (const b of this.blocks) {
      this.scene.remove(b.mesh);
    }
    this.blocks = [];
    this._buildBlocks();

    this.stats.blocksBroken = 0;
    this.stats.blocksTotal = this.blocks.length;
    this.stats.misses = 0;

    this._serveBall();
  }

  _serveBall() {
    this.ballPos.set(0, 0, -8);
    this.ballVel.set(0, 0, -GAMEPLAY.ballSpeed);
    this.ballAlive = true;
    this.ballFading = false;
    this.fadeT = 0;
    this.ballMesh.material.opacity = 1;
    this.ballMesh.visible = true;
  }

  setPaddleTarget(nx, ny) {
    const r = TUNNEL.radius * 0.8;
    this.paddleTarget.set(nx * r, ny * r);
  }

  update(dt) {
    this.time += dt;

    // paddle ease toward target
    const k = 12;
    const t = 1 - Math.exp(-k * dt);
    this.paddlePos.lerp(this.paddleTarget, t);
    this.paddleMesh.position.x = this.paddlePos.x;
    this.paddleMesh.position.y = this.paddlePos.y;

    // block visuals: spin + break animation
    for (const b of this.blocks) {
      if (b.breaking) {
        b.breakT += dt;
        const p = Math.min(b.breakT / 0.4, 1);
        const scale = 1 - p;
        b.mesh.scale.setScalar(Math.max(scale, 0));
        if (p >= 1) {
          this.scene.remove(b.mesh);
          b.alive = false;
          b.breaking = false;
        }
      } else if (b.alive) {
        b.mesh.rotateOnAxis(b.mesh.userData.spinAxis, b.mesh.userData.spinSpeed * dt);
      }
    }

    if (!this.ballAlive) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) {
        this._serveBall();
      }
      return;
    }

    if (this.ballFading) {
      this.fadeT += dt;
      const p = Math.min(this.fadeT / 0.5, 1);
      this.ballMesh.material.opacity = 1 - p;
      if (p >= 1) {
        this.ballMesh.visible = false;
        this.ballAlive = false;
        this.respawnT = 1.0;
      }
      // still integrate position lightly so fade doesn't freeze it mid-space? keep simple: freeze motion during fade
      return;
    }

    // curl noise drift
    const c = curl(this.ballPos, this.time);
    this.ballVel.x += c.x * 0.6 * dt;
    this.ballVel.y += c.y * 0.6 * dt;
    this.ballVel.z += c.z * 0.6 * dt;

    // integrate
    this.ballPos.x += this.ballVel.x * dt;
    this.ballPos.y += this.ballVel.y * dt;
    this.ballPos.z += this.ballVel.z * dt;

    // wall bounce (cylindrical)
    const rXY = Math.hypot(this.ballPos.x, this.ballPos.y);
    const maxR = TUNNEL.radius - GAMEPLAY.ballR;
    if (rXY > maxR) {
      const nx = -this.ballPos.x / rXY;
      const ny = -this.ballPos.y / rXY;
      const vDotN = this.ballVel.x * nx + this.ballVel.y * ny;
      this.ballVel.x -= 2 * vDotN * nx;
      this.ballVel.y -= 2 * vDotN * ny;
      // nudge inside
      const overshoot = rXY - maxR;
      this.ballPos.x += nx * overshoot;
      this.ballPos.y += ny * overshoot;
    }

    // far cap bounce
    if (this.ballPos.z < TUNNEL.farZ + GAMEPLAY.ballR) {
      this.ballPos.z = TUNNEL.farZ + GAMEPLAY.ballR;
      this.ballVel.z = Math.abs(this.ballVel.z);
    }

    // paddle hit: crossing z = paddleZ moving +Z
    if (this.ballVel.z > 0 && this.ballPos.z >= GAMEPLAY.paddleZ) {
      const dx = this.ballPos.x - this.paddlePos.x;
      const dy = this.ballPos.y - this.paddlePos.y;
      const hitW = GAMEPLAY.paddleHalfW + GAMEPLAY.ballR;
      const hitH = GAMEPLAY.paddleHalfH + GAMEPLAY.ballR;
      if (Math.abs(dx) < hitW && Math.abs(dy) < hitH) {
        this.ballVel.z = -this.ballVel.z;
        this.ballVel.x += dx * 3;
        this.ballVel.y += dy * 3;
        const speed = this.ballVel.length();
        const maxSpeed = GAMEPLAY.ballSpeed * 1.15;
        if (speed > maxSpeed) {
          this.ballVel.multiplyScalar(maxSpeed / speed);
        }
      }
    }

    // miss: ball reaches z > -1 (passed the paddle plane, heading toward viewer)
    if (this.ballPos.z > -1) {
      this.stats.misses++;
      this.bus.emit('ball:miss', { misses: this.stats.misses });
      this.ballFading = true;
      this.fadeT = 0;
    }

    // block collisions
    for (const b of this.blocks) {
      if (!b.alive || b.breaking) continue;
      const dx = this.ballPos.x - b.pos.x;
      const dy = this.ballPos.y - b.pos.y;
      const dz = this.ballPos.z - b.pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < GAMEPLAY.blockR + GAMEPLAY.ballR) {
        b.breaking = true;
        b.breakT = 0;
        const questionIndex = this.stats.blocksBroken;
        this.stats.blocksBroken++;
        this.bus.emit('block:broken', {
          blockId: b.id,
          questionIndex,
          pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z }
        });

        // simple reflection off block surface
        if (dist > 0.0001) {
          const nx = dx / dist, ny = dy / dist, nz = dz / dist;
          const vDotN = this.ballVel.x * nx + this.ballVel.y * ny + this.ballVel.z * nz;
          this.ballVel.x -= 2 * vDotN * nx;
          this.ballVel.y -= 2 * vDotN * ny;
          this.ballVel.z -= 2 * vDotN * nz;
        }
        break;
      }
    }
  }
}
