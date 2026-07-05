import * as THREE from 'three';
import { PALETTE, TUNNEL, WORLD_PER_METER, SCREEN, GAMEPLAY } from './config.js';
import { bus } from './events.js';

const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setClearColor(PALETTE.void);

const scene = new THREE.Scene();

let gameState = 'gate';

function setState(newState) {
  gameState = newState;
  bus.emit('game:state', { state: gameState });
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
}

window.addEventListener('resize', onResize);
onResize();

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, new THREE.Camera());
}

animate();
setState('gate');
