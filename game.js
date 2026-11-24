// Neon Spire v0.3.0 — Three.js renderer + menus + game feel.
// The simulation lives in physics.js (pure, no DOM); this file owns the
// 3D scene, the screen stack, input, Web Audio SFX and the feel tiers.
// The climber swings on the climb-face plane (x = lateral, y = height,
// z = FACE_Z on the +z face of the spire); the camera chases from
// behind and below so the spire fills the frame and the next ring is
// always readable.
import * as THREE from 'three';
import {
  VERSION, DT, CLIMBS, climbById, createRun, startRun, stepRun,
  decisionPolicy, nextRing, nextRingIndex, swingSpeed,
  defaultSave, serializeSave, parseSave, recordBest, isClimbUnlocked, rankFor,
  FEEDBACK, FACE_Z, swingEnergy,
} from './physics.js';

const SAVE_KEY = 'neon-spire-save-v1';
const FOV_BASE = 62;

// ---------------------------------------------------------------- save
let save = defaultSave();
try {
  const raw = localStorage.getItem(SAVE_KEY);
  if (raw) save = parseSave(raw);
} catch { /* storage unavailable — play without saving */ }
function persistSave() {
  try { localStorage.setItem(SAVE_KEY, serializeSave(save)); } catch { /* ignore */ }
}
const params = new URLSearchParams(location.search);
if (params.get('unlock') === '1') {
  save.unlocked = CLIMBS.length;
  persistSave();
}

// ---------------------------------------------------------------- state
const state = {
  phase: 'menu', // 'menu' | 'playing' | 'paused' | 'complete' | 'gameover'
  climbId: 1,
  run: null,
  demoRun: createRun(CLIMBS[0]),
  autopilot: false,
  trauma: 0,
  hitStopT: 0,
  slowMoT: 0,
  timeScale: 1,
  fovPunch: 0,
  fovDip: 0,
  camSnapT: 0,
  pumpTicks: 0,
  lastPumpSign: 0,
  musicActive: false,
  toastT: 0,
  muted: save.settings.muted,
  shakePct: save.settings.shake,
  flash: save.settings.flash,
  musicOn: true,
  sfxOn: true,
  volume: 0.6,
  textScale: 1,
  highContrast: false,
  completeShownAt: 0,
  gameoverShownAt: 0,
};
const screenStack = []; // screen ids, top = last

// ---------------------------------------------------------------- audio
let audioCtx = null;
let masterGain = null;
let musicNodes = null;
function ensureAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = state.volume;
    masterGain.connect(audioCtx.destination);
  } catch { audioCtx = null; }
}
function tone(freq, dur, type = 'sine', gain = 0.2, slideTo = null, delay = 0) {
  if (!audioCtx || !masterGain || state.muted || !state.sfxOn) return;
  const t0 = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}
function playSfx(name, energy = 0) {
  if (!audioCtx) return;
  switch (name) {
    case 'latch': tone(880, 0.09, 'square', 0.12, 620); break;
    case 'release': tone(320, 0.16, 'sawtooth', 0.14, 130); break;
    // Pump tick: pitch rises with swing energy, so pumping a fast
    // swing sounds brighter than pumping a dead one — the ear learns
    // the swing before the eye does.
    case 'pump': tone(520 + energy * 420, 0.05, 'sine', 0.05 + energy * 0.04, 640 + energy * 420); break;
    case 'orb': tone(1320, 0.1, 'sine', 0.16); tone(1760, 0.14, 'sine', 0.12, null, 0.06); break;
    case 'fall': tone(170, 0.35, 'sawtooth', 0.2, 55); break;
    case 'summit':
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.35, 'sine', 0.16, null, i * 0.09));
      break;
    case 'denied': tone(140, 0.08, 'square', 0.1); break;
    case 'tick': tone(1200, 0.03, 'sine', 0.06); break;
    case 'checkpoint': tone(784, 0.12, 'sine', 0.14); tone(1046, 0.18, 'sine', 0.12, null, 0.08); break;
    default: break;
  }
}
// Generative music: a low pad (Am–F–C–G, one chord per bar) plus a
// bass pulse and a soft arpeggio, sequenced from the frame loop with a
// short lookahead. The pad filter opens and the arpeggio lifts an
// octave as the climber gains height, so the music climbs with you.
// Everything is scheduled through the audio clock — no timers to drift
// — and every note is guarded: with no AudioContext (or while muted)
// the scheduler simply does nothing.
const MUSIC_BPM = 104;
const MUSIC_STEP = 60 / MUSIC_BPM / 2; // 8th notes
// [bass root, chord tones] per bar.
const MUSIC_CHORDS = [
  { root: 110.00, tones: [220.00, 261.63, 329.63] }, // Am
  { root: 87.31, tones: [174.61, 220.00, 261.63] }, // F
  { root: 130.81, tones: [196.00, 261.63, 329.63] }, // C
  { root: 98.00, tones: [196.00, 246.94, 293.66] }, // G
];
let musicStepState = null;
function musicNote(freq, t0, dur, type, gain) {
  if (!audioCtx || !masterGain || state.muted || !state.musicOn) return;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}
function startMusic() {
  if (!audioCtx || musicNodes || !state.musicOn || state.muted) return;
  const padGain = audioCtx.createGain();
  padGain.gain.value = 0.05;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 420;
  const o1 = audioCtx.createOscillator();
  const o2 = audioCtx.createOscillator();
  o1.type = 'triangle'; o1.frequency.value = 110;
  o2.type = 'triangle'; o2.frequency.value = 164.8;
  const lfo = audioCtx.createOscillator();
  const lfoGain = audioCtx.createGain();
  lfo.frequency.value = 0.08;
  lfoGain.gain.value = 180;
  lfo.connect(lfoGain).connect(filter.frequency);
  o1.connect(filter); o2.connect(filter);
  filter.connect(padGain).connect(masterGain);
  o1.start(); o2.start(); lfo.start();
  musicNodes = { o1, o2, lfo, padGain, filter };
  musicStepState = { nextStepTime: audioCtx.currentTime + 0.1, step: 0 };
  state.musicActive = true;
}
function scheduleMusic() {
  if (!musicNodes || !audioCtx || !musicStepState) return;
  const run = activeRun();
  const progress = run ? Math.min(1, Math.max(0, run.maxHeight / run.climb.height)) : 0;
  // The pad opens up as the climber gains height.
  if (musicNodes.filter) musicNodes.filter.frequency.value = 420 + progress * 520;
  const now = audioCtx.currentTime;
  while (musicStepState.nextStepTime < now + 0.25) {
    const t0 = musicStepState.nextStepTime;
    const step = musicStepState.step;
    const bar = Math.floor(step / 8) % MUSIC_CHORDS.length;
    const chord = MUSIC_CHORDS[bar];
    const inBar = step % 8;
    if (inBar === 0 || inBar === 4) musicNote(chord.root, t0, 0.3, 'triangle', 0.13);
    if (inBar === 6) musicNote(chord.root * 1.5, t0, 0.2, 'triangle', 0.08);
    // Arpeggio: one chord tone per 8th, cycling 0-1-2-1; up an octave
    // past halfway up the climb.
    const toneIdx = [0, 1, 2, 1, 0, 1, 2, 1][inBar];
    const arpFreq = chord.tones[toneIdx] * (progress > 0.5 ? 2 : 1);
    musicNote(arpFreq, t0, 0.18, 'sine', 0.045);
    musicStepState.nextStepTime += MUSIC_STEP;
    musicStepState.step++;
  }
}
function stopMusic() {
  if (!musicNodes) return;
  try { musicNodes.o1.stop(); musicNodes.o2.stop(); musicNodes.lfo.stop(); } catch { /* already stopped */ }
  musicNodes = null;
  musicStepState = null;
  state.musicActive = false;
}

// ---------------------------------------------------------------- three
const container = document.getElementById('game-container');
let renderer = null;
let webglOK = true;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch {
  webglOK = false;
}
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050514);
scene.fog = new THREE.Fog(0x050514, 40, 140);
const camera = new THREE.PerspectiveCamera(FOV_BASE, window.innerWidth / window.innerHeight, 0.1, 400);
camera.position.set(0, 0, 24);

const hemi = new THREE.HemisphereLight(0x8f7bff, 0x0a0a20, 0.9);
scene.add(hemi);
const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
keyLight.position.set(8, 20, 18);
scene.add(keyLight);
const rimLight = new THREE.PointLight(0xb26bff, 60, 60);
rimLight.position.set(-10, 30, -6);
scene.add(rimLight);

let climbGroup = null;
let spireMesh = null;
let ringMeshes = [];
let orbMeshes = [];
let summitBeacon = null;

// Climber: glowing core + halo ring.
const climberGroup = new THREE.Group();
const climberCore = new THREE.Mesh(
  new THREE.OctahedronGeometry(0.55),
  new THREE.MeshStandardMaterial({ color: 0x22e6ff, emissive: 0x22e6ff, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.1 }),
);
const climberHalo = new THREE.Mesh(
  new THREE.TorusGeometry(0.85, 0.05, 8, 32),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
);
const climberLight = new THREE.PointLight(0x22e6ff, 12, 12);
climberGroup.add(climberCore, climberHalo, climberLight);
scene.add(climberGroup);

// Rope: a 2-point line, hidden while airborne.
const ropeGeo = new THREE.BufferGeometry();
ropeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
const ROPE_COLD = new THREE.Color(0x22e6ff);
const ROPE_HOT = new THREE.Color(0xffd75e);
const rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0x22e6ff, transparent: true, opacity: 0.95 }));
rope.visible = false;
rope.frustumCulled = false;
scene.add(rope);

// Trail: fading line of recent positions.
const TRAIL_N = 24;
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0x22e6ff, transparent: true, opacity: 0.5 }));
trail.frustumCulled = false;
scene.add(trail);
const trailPts = [];

// Particles: one pooled Points cloud.
const P_MAX = 240;
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P_MAX * 3), 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(P_MAX * 3), 3));
const pMat = new THREE.PointsMaterial({ size: 0.35, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
const particles = new THREE.Points(pGeo, pMat);
particles.frustumCulled = false;
scene.add(particles);
const pool = Array.from({ length: P_MAX }, () => ({ life: 0, vx: 0, vy: 0, vz: 0 }));
let pCursor = 0;
function spawnParticles(x, y, z, colorHex, count, speed = 6) {
  const c = new THREE.Color(colorHex);
  const pos = pGeo.attributes.position.array;
  const col = pGeo.attributes.color.array;
  for (let i = 0; i < count; i++) {
    const idx = pCursor;
    pCursor = (pCursor + 1) % P_MAX;
    const p = pool[idx];
    p.life = 0.6 + Math.random() * 0.5;
    const a = Math.random() * Math.PI * 2;
    const b = (Math.random() - 0.5) * Math.PI;
    p.vx = Math.cos(a) * Math.cos(b) * speed * (0.4 + Math.random() * 0.8);
    p.vy = Math.sin(b) * speed * (0.4 + Math.random() * 0.8) + 2;
    p.vz = Math.sin(a) * Math.cos(b) * speed * (0.4 + Math.random() * 0.8);
    pos[idx * 3] = x; pos[idx * 3 + 1] = y; pos[idx * 3 + 2] = z;
    col[idx * 3] = c.r; col[idx * 3 + 1] = c.g; col[idx * 3 + 2] = c.b;
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.color.needsUpdate = true;
}
function updateParticles(dt) {
  const pos = pGeo.attributes.position.array;
  let any = false;
  for (let i = 0; i < P_MAX; i++) {
    const p = pool[i];
    if (p.life <= 0) continue;
    any = true;
    p.life -= dt;
    pos[i * 3] += p.vx * dt;
    pos[i * 3 + 1] += p.vy * dt;
    pos[i * 3 + 2] += p.vz * dt;
    p.vy -= 4 * dt;
    if (p.life <= 0) { pos[i * 3 + 1] = -999; }
  }
  if (any) pGeo.attributes.position.needsUpdate = true;
}

// Stars: static background shell.
{
  const n = 420;
  const arr = new Float32Array(n * 3);
  const colArr = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const r = 60 + Math.random() * 90;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    arr[i * 3] = r * Math.sin(ph) * Math.cos(th);
    arr[i * 3 + 1] = r * Math.cos(ph) * 0.9 - 10;
    arr[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th) - 20;
    c.setHSL(Math.random() < 0.5 ? 0.52 : 0.83, 0.9, 0.55 + Math.random() * 0.3);
    colArr[i * 3] = c.r; colArr[i * 3 + 1] = c.g; colArr[i * 3 + 2] = c.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.5, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
  stars.frustumCulled = false;
  scene.add(stars);
}

function buildClimbScene(climb) {
  if (climbGroup) {
    scene.remove(climbGroup);
    climbGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material.dispose) o.material.dispose();
    });
  }
  climbGroup = new THREE.Group();
  ringMeshes = [];
  orbMeshes = [];
  const accent = new THREE.Color(climb.accent);
  // Spire: tall cylinder with emissive rim bands.
  const spireH = climb.height + 46;
  spireMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(5, 6.5, spireH, 24, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x1a1040, emissive: 0x2a1a66, emissiveIntensity: 0.7, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide }),
  );
  spireMesh.position.set(0, spireH / 2 - 14, 0);
  climbGroup.add(spireMesh);
  for (let y = 0; y < spireH - 14; y += 10) {
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(5.15, 0.07, 8, 48),
      new THREE.MeshBasicMaterial({ color: y % 20 === 0 ? 0x22e6ff : 0xb26bff, transparent: true, opacity: 0.55 }),
    );
    band.rotation.x = Math.PI / 2;
    band.position.set(0, y - 12, 0);
    climbGroup.add(band);
  }
  // Base glow disc.
  const base = new THREE.Mesh(
    new THREE.CircleGeometry(9, 40),
    new THREE.MeshBasicMaterial({ color: 0x22e6ff, transparent: true, opacity: 0.16 }),
  );
  base.rotation.x = -Math.PI / 2;
  base.position.set(0, -13.9, 0);
  climbGroup.add(base);
  // Anchor rings on the climb face.
  climb.rings.forEach((r, i) => {
    const isSummit = !!r.summit;
    const isCheckpoint = !!r.checkpoint;
    const mat = new THREE.MeshStandardMaterial({
      color: isSummit ? 0xffd75e : climb.accent,
      emissive: isSummit ? 0xffd75e : climb.accent,
      emissiveIntensity: isSummit ? 1.8 : 1.1,
      roughness: 0.3, metalness: 0.2,
    });
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(isSummit ? 1.5 : 1.05, isSummit ? 0.14 : 0.09, 10, 40), mat);
    mesh.position.set(r.x, r.y, r.z);
    mesh.userData = { ringIndex: i, checkpoint: isCheckpoint, summit: isSummit, baseScale: 1 };
    climbGroup.add(mesh);
    ringMeshes.push(mesh);
    if (isCheckpoint) {
      const outer = new THREE.Mesh(
        new THREE.TorusGeometry(1.35, 0.045, 8, 40),
        new THREE.MeshBasicMaterial({ color: 0xffd75e, transparent: true, opacity: 0.8 }),
      );
      outer.position.set(r.x, r.y, r.z);
      climbGroup.add(outer);
    }
  });
  // Summit beacon.
  const summit = climb.rings[climb.rings.length - 1];
  summitBeacon = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.1),
    new THREE.MeshStandardMaterial({ color: 0xffd75e, emissive: 0xffd75e, emissiveIntensity: 2.2 }),
  );
  summitBeacon.position.set(summit.x, summit.y + 2.4, summit.z);
  climbGroup.add(summitBeacon);
  const beaconLight = new THREE.PointLight(0xffd75e, 40, 30);
  beaconLight.position.copy(summitBeacon.position);
  climbGroup.add(beaconLight);
  // Orbs.
  climb.orbs.forEach((o) => {
    const m = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.45),
      new THREE.MeshStandardMaterial({ color: 0xffd75e, emissive: 0xffd75e, emissiveIntensity: 1.8 }),
    );
    m.position.set(o.x, o.y, FACE_Z);
    m.userData = { baseY: o.y, phase: Math.random() * Math.PI * 2 };
    climbGroup.add(m);
    orbMeshes.push(m);
  });
  scene.add(climbGroup);
  void accent;
}

if (renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);
}
buildClimbScene(CLIMBS[0]);

// ---------------------------------------------------------------- DOM
const $ = (id) => document.getElementById(id);
const hudEl = $('hud');
const toastEl = $('hud-toast');
const popsEl = $('pops');
const srStatus = $('sr-status');
const flashEl = $('hit-flash');

function showToast(text, ms = 1800) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  srStatus.textContent = text;
  state.toastT = ms / 1000;
}
function spawnPop(text, worldX, worldY) {
  const s = worldToScreen(worldX, worldY, FACE_Z);
  const el = document.createElement('div');
  el.className = 'pop';
  el.textContent = text;
  el.style.left = `${s.x}px`;
  el.style.top = `${s.y}px`;
  popsEl.appendChild(el);
  setTimeout(() => el.remove(), 950);
}
function worldToScreen(x, y, z) {
  const v = new THREE.Vector3(x, y, z).project(camera);
  return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, behind: v.z > 1 };
}

// ---------------------------------------------------------------- screens
const SCREENS = ['menu', 'howto', 'settings', 'complete', 'gameover', 'pause'];
function openScreen(id) {
  const el = $(id);
  if (!el) return;
  el.classList.remove('hidden');
  screenStack.push(id);
  const primary = el.querySelector('.btn.primary') || el.querySelector('.btn') || el.querySelector('button');
  if (primary) primary.focus();
}
function closeScreen(id) {
  const el = $(id);
  if (el) el.classList.add('hidden');
  const i = screenStack.lastIndexOf(id);
  if (i >= 0) screenStack.splice(i, 1);
}
function closeTopScreen() {
  if (screenStack.length === 0) return false;
  closeScreen(screenStack[screenStack.length - 1]);
  return true;
}
function hideAllScreens() {
  SCREENS.forEach((id) => $(id).classList.add('hidden'));
  screenStack.length = 0;
}
function showMenu() {
  state.phase = 'menu';
  state.run = null;
  state.autopilot = false;
  state.demoRun = createRun(CLIMBS[0]);
  buildClimbScene(CLIMBS[0]);
  hideAllScreens();
  hudEl.classList.add('hidden');
  $('touch-controls').classList.add('hidden');
  toastEl.classList.remove('show');
  renderClimbSelect();
  updateMenuBest();
  openScreen('menu');
}
function renderClimbSelect() {
  const wrap = $('climb-select');
  wrap.innerHTML = '';
  CLIMBS.forEach((c) => {
    const unlocked = isClimbUnlocked(save, c.id);
    const best = save.best[c.id];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'track-card' + (c.id === state.climbId ? ' selected' : '');
    b.disabled = !unlocked;
    b.innerHTML = `<span class="tc-name">${c.id}. ${c.name}</span>` +
      `<span class="tc-meta">${unlocked ? `Par ${c.par}s · ${c.height}m` : 'Locked — clear the previous climb'}</span>` +
      (best ? `<span class="tc-best">Best ${best.score} pts</span>` : '');
    b.addEventListener('click', () => {
      ensureAudio(); playSfx('tick');
      state.climbId = c.id;
      renderClimbSelect();
      $('climb-hint').textContent = c.hint;
    });
    wrap.appendChild(b);
  });
  const c = climbById(state.climbId);
  $('climb-hint').textContent = c ? c.hint : '';
}
function updateMenuBest() {
  const done = Object.keys(save.best).length;
  $('menu-best').textContent = done > 0
    ? `${done} climb${done > 1 ? 's' : ''} cleared — best score ${Math.max(...Object.values(save.best).map((b) => b.score))} pts`
    : `${CLIMBS.length} climbs await. The first ring is right above you.`;
  $('menu-hint').textContent = `Climb ${state.climbId} selected — press Play.`;
}
function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}
function updateHUD() {
  const run = state.run;
  if (!run) return;
  const c = run.climb;
  $('hud-climb').textContent = `Climb ${c.id} — ${c.name}`;
  $('hud-time').textContent = fmtTime(run.time);
  $('hud-height').textContent = `Height ${Math.max(0, Math.floor(run.maxHeight))}m / ${c.height}m`;
  $('hud-score').textContent = `Score ${run.score}`;
  $('hud-orbs').textContent = `Orbs ${run.orbs}/${c.orbs.length}`;
  $('hud-falls').textContent = `Falls ${run.falls}/${5}`;
  const best = save.best[c.id];
  $('hud-best').textContent = best ? `Best ${best.score}` : 'Best —';
  // Swing meter: current swing energy, 0..1. No marker, no cue — just
  // how much swing you are carrying right now.
  const energy = swingEnergy(run);
  const fill = $('hud-swing-fill');
  fill.style.width = `${Math.round(energy * 100)}%`;
  fill.classList.toggle('hot', energy > 0.7);
}

// ---------------------------------------------------------------- feel
// The attract demo behind the menu reuses the same events, but its
// feedback must stay visual-only: a demo latch must never shake the menu
// camera, freeze the demo with hit-stop, or flash over the menu —
// otherwise the menu never settles to its exact rest state.
function fireFeedback(event, x, y, z, isDemo = false, energy = 0) {
  const fb = FEEDBACK[event];
  if (!fb) return;
  if (x !== undefined) spawnParticles(x, y, z, event === 'orb' ? 0xffd75e : 0x22e6ff, fb.particles, event === 'summit' ? 12 : 6);
  if (isDemo) return;
  if (event === 'pump') state.pumpTicks++;
  const shakeScale = state.shakePct / 100;
  state.trauma = Math.min(1, state.trauma + fb.trauma * shakeScale);
  if (fb.hitStop > 0) state.hitStopT = Math.max(state.hitStopT, fb.hitStop);
  if (state.flash && fb.flash > 0) {
    flashEl.style.opacity = String(fb.flash * 2.2);
    setTimeout(() => { flashEl.style.opacity = '0'; }, 140);
  }
  if (event === 'summit') {
    state.slowMoT = 0.9;
    state.fovPunch = 1;
  }
  if (event === 'release') state.fovPunch = Math.max(state.fovPunch, 0.45);
  if (event === 'latch') {
    // Latch snap: the camera briefly locks onto the new anchor and the
    // FOV dips in, so a latch reads as a catch, not a teleport.
    state.camSnapT = 0.18;
    state.fovDip = 0.6;
    // Hard latch: catching a ring at high swing speed punches harder —
    // a short hit-stop and a low thud on top of the latch bundle.
    if (energy > 0.7) {
      state.hitStopT = Math.max(state.hitStopT, 0.04);
      spawnParticles(x, y, z, 0xffd75e, 10, 9);
      tone(170, 0.12, 'sine', 0.22, 70);
    }
  }
  playSfx(fb.sfx, energy);
}
function activeRun() {
  return state.phase === 'menu' ? state.demoRun : state.run;
}

// ---------------------------------------------------------------- flow
function startClimb(id, viaParam = false) {
  const climb = climbById(id);
  if (!climb) return;
  if (!viaParam && !isClimbUnlocked(save, climb.id)) {
    playSfx('denied');
    showToast('Clear the previous climb to unlock this one');
    return;
  }
  ensureAudio();
  startMusic();
  state.climbId = climb.id;
  state.run = startRun(climb.id);
  state.phase = 'playing';
  state.autopilot = false;
  state.trauma = 0;
  state.hitStopT = 0;
  state.slowMoT = 0;
  state.timeScale = 1;
  state.fovPunch = 0;
  state.fovDip = 0;
  state.camSnapT = 0;
  state.pumpTicks = 0;
  state.lastPumpSign = 0;
  buildClimbScene(climb);
  hideAllScreens();
  hudEl.classList.remove('hidden');
  if (isTouchDevice()) $('touch-controls').classList.remove('hidden');
  updateHUD();
  showToast(`${climb.name} — ${climb.hint}`, 2600);
  srStatus.textContent = `Climb ${climb.id}, ${climb.name}. Hold Space to grapple, pump with A and D, release at the top of the arc.`;
}
function endClimb(won) {
  const run = state.run;
  if (!run) return;
  // Clear transient UI state on run end (Talon lesson): a leftover
  // toast must not linger over the complete / game-over panel.
  toastEl.classList.remove('show');
  state.toastT = 0;
  if (won) {
    const prev = save.best[run.climb.id];
    recordBest(save, run.climb.id, { won: true, score: run.score, time: run.time, falls: run.falls, orbs: run.orbs, par: run.climb.par });
    persistSave();
    state.phase = 'complete';
    state.completeShownAt = performance.now();
    $('complete-score').textContent = `Score ${run.score}`;
    $('complete-detail').textContent = `${run.climb.name} cleared in ${fmtTime(run.time)} with ${run.falls} fall${run.falls === 1 ? '' : 's'} · ${run.orbs}/${run.climb.orbs.length} orbs`;
    const best = save.best[run.climb.id];
    $('complete-best').textContent = best ? `Best ${best.score} pts` : '';
    $('complete-rank').textContent = `Rank ${rankFor({ won: true, falls: run.falls, time: run.time, par: run.climb.par })} — S needs no falls under par, A under par`;
    $('complete-orbs').textContent = run.climb.id < CLIMBS.length ? 'Next climb unlocked' : 'All climbs cleared — you own the spire';
    $('btn-next').textContent = run.climb.id < CLIMBS.length ? 'Next Climb' : 'Main Menu';
    hideAllScreens();
    hudEl.classList.add('hidden');
    $('touch-controls').classList.add('hidden');
    openScreen('complete');
  } else {
    state.phase = 'gameover';
    state.gameoverShownAt = performance.now();
    $('gameover-detail').textContent = `Reached ${Math.max(0, Math.floor(run.maxHeight))}m of ${run.climb.height}m — ${run.falls} falls`;
    const best = save.best[run.climb.id];
    $('gameover-best').textContent = best ? `Best ${best.score} pts` : 'No clear yet — the spire waits';
    hideAllScreens();
    hudEl.classList.add('hidden');
    $('touch-controls').classList.add('hidden');
    openScreen('gameover');
  }
  state.autopilot = false;
}
function pauseGame() {
  if (state.phase !== 'playing') return;
  state.phase = 'paused';
  openScreen('pause');
}
function resumeGame() {
  if (state.phase !== 'paused') return;
  closeScreen('pause');
  state.phase = 'playing';
}
function quitToMenu() {
  toastEl.classList.remove('show');
  // Snap every feel effect back to its exact rest value (skill rule):
  // the menu must never inherit shake, FOV punch, hit-stop or slow-mo
  // from the run that just ended.
  state.trauma = 0;
  state.fovPunch = 0;
  state.fovDip = 0;
  state.camSnapT = 0;
  state.lastPumpSign = 0;
  state.hitStopT = 0;
  state.slowMoT = 0;
  state.timeScale = 1;
  flashEl.style.opacity = '0';
  showMenu();
}

// ---------------------------------------------------------------- input
const keys = new Set();
const input = { grapple: false, pump: 0, mousePump: 0 };
function recomputePump() {
  const left = keys.has('KeyA') || keys.has('ArrowLeft') || input.mousePump < 0;
  const right = keys.has('KeyD') || keys.has('ArrowRight') || input.mousePump > 0;
  input.pump = (right ? 1 : 0) - (left ? 1 : 0);
}
function isTouchDevice() {
  return 'ontouchstart' in window || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
}
let lastMouseX = null;
window.addEventListener('keydown', (e) => {
  if (e.repeat) { if (e.code === 'Space') e.preventDefault(); return; }
  keys.add(e.code);
  if (e.code === 'Space') {
    e.preventDefault();
    input.grapple = true;
    ensureAudio();
  }
  if (e.code === 'KeyP' && (state.phase === 'playing' || state.phase === 'paused')) {
    if (state.phase === 'playing') pauseGame(); else resumeGame();
  }
  if (e.code === 'KeyM') toggleMute();
  // Retry / restart from inside a climb is not a new entry: the lock
  // gates menu entry only. Without this, Try Again is dead after losing
  // a deep-linked (?climb=N) locked climb — the retry re-checks the
  // lock the deep link bypassed, and the game-over panel just stays.
  if (e.code === 'KeyR' && state.phase === 'playing') startClimb(state.climbId, true);
  if (e.code === 'Escape') {
    if (state.phase === 'playing') pauseGame();
    else if (screenStack.length > 1) closeTopScreen();
    else if (state.phase === 'paused') resumeGame();
  }
  if (e.code === 'Enter' && state.phase === 'menu' && screenStack[screenStack.length - 1] === 'menu') {
    startClimb(state.climbId);
  }
  if (e.code === 'Enter' && state.phase === 'paused') resumeGame();
  recomputePump();
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'Space') input.grapple = false;
  recomputePump();
});
window.addEventListener('blur', () => {
  keys.clear();
  input.grapple = false;
  input.pump = 0;
  if (state.phase === 'playing') pauseGame();
});
if (renderer) {
  renderer.domElement.addEventListener('mousedown', (e) => {
    if (state.phase !== 'playing') return;
    ensureAudio();
    input.grapple = true;
    lastMouseX = e.clientX;
  });
  window.addEventListener('mouseup', () => { input.grapple = false; input.mousePump = 0; lastMouseX = null; recomputePump(); });
  window.addEventListener('mousemove', (e) => {
    if (lastMouseX === null || !input.grapple) return;
    const dx = e.clientX - lastMouseX;
    if (Math.abs(dx) > 4) { input.mousePump = dx > 0 ? 1 : -1; lastMouseX = e.clientX; recomputePump(); }
  });
}
// Touch controls.
function bindHold(el, down, up) {
  const start = (e) => { e.preventDefault(); ensureAudio(); down(); };
  const end = (e) => { e.preventDefault(); up(); };
  el.addEventListener('touchstart', start, { passive: false });
  el.addEventListener('touchend', end, { passive: false });
  el.addEventListener('touchcancel', end, { passive: false });
  el.addEventListener('mousedown', start);
  el.addEventListener('mouseup', end);
  el.addEventListener('mouseleave', end);
}
bindHold($('btn-grapple'), () => { input.grapple = true; $('btn-grapple').classList.add('held'); }, () => { input.grapple = false; $('btn-grapple').classList.remove('held'); });
bindHold($('btn-pump-left'), () => { input.mousePump = -1; recomputePump(); }, () => { input.mousePump = 0; recomputePump(); });
bindHold($('btn-pump-right'), () => { input.mousePump = 1; recomputePump(); }, () => { input.mousePump = 0; recomputePump(); });

// Buttons: hover tick + press feedback on every button.
document.querySelectorAll('button').forEach((b) => {
  b.addEventListener('mouseenter', () => { if (audioCtx) playSfx('tick'); });
  b.addEventListener('click', () => { ensureAudio(); });
});
function toggleMute() {
  state.muted = !state.muted;
  save.settings.muted = state.muted;
  persistSave();
  updateMuteLabels();
  if (state.muted) stopMusic(); else if (state.phase === 'playing') startMusic();
}
function updateMuteLabels() {
  const label = state.muted ? 'Sound: Off' : 'Sound: On';
  $('btn-mute-menu').textContent = label;
  $('btn-mute-hud').textContent = label;
  $('btn-mute-pause').textContent = label;
}
$('btn-play').addEventListener('click', () => startClimb(state.climbId));
$('btn-howto').addEventListener('click', () => openScreen('howto'));
$('btn-howto-close').addEventListener('click', () => closeScreen('howto'));
$('btn-settings').addEventListener('click', () => openScreen('settings'));
$('btn-settings-close').addEventListener('click', () => closeScreen('settings'));
$('btn-mute-menu').addEventListener('click', toggleMute);
$('btn-mute-hud').addEventListener('click', toggleMute);
$('btn-mute-pause').addEventListener('click', toggleMute);
$('btn-pause').addEventListener('click', pauseGame);
$('btn-resume').addEventListener('click', resumeGame);
$('btn-restart').addEventListener('click', () => { closeScreen('pause'); startClimb(state.climbId, true); });
$('btn-quit').addEventListener('click', quitToMenu);
$('btn-next').addEventListener('click', () => {
  if (state.climbId < CLIMBS.length) startClimb(state.climbId + 1);
  else quitToMenu();
});
$('btn-replay').addEventListener('click', () => startClimb(state.climbId, true));
$('btn-menu-complete').addEventListener('click', quitToMenu);
$('btn-retry').addEventListener('click', () => startClimb(state.climbId, true));
$('btn-menu-over').addEventListener('click', quitToMenu);

// Settings bindings.
function bindRange(id, valueId, fmt, apply) {
  const el = $(id);
  const val = $(valueId);
  el.addEventListener('input', () => { val.textContent = fmt(el.value); apply(Number(el.value)); });
}
bindRange('volume-range', 'volume-value', (v) => `${v}%`, (v) => {
  state.volume = v / 100;
  if (masterGain) masterGain.gain.value = state.volume;
});
bindRange('shake-range', 'shake-value', (v) => `${v}%`, (v) => {
  state.shakePct = v; save.settings.shake = v; persistSave();
});
bindRange('shake-range-pause', 'shake-value-pause', (v) => `${v}%`, (v) => {
  state.shakePct = v; save.settings.shake = v; persistSave();
  $('shake-range').value = v; $('shake-value').textContent = `${v}%`;
});
$('music-toggle').addEventListener('change', (e) => {
  state.musicOn = e.target.checked;
  if (state.musicOn) { ensureAudio(); startMusic(); } else stopMusic();
});
$('sfx-toggle').addEventListener('change', (e) => { state.sfxOn = e.target.checked; });
$('reduce-flashing').addEventListener('change', (e) => {
  state.flash = !e.target.checked;
  save.settings.flash = state.flash;
  persistSave();
});
$('text-size-select').addEventListener('change', (e) => {
  state.textScale = Number(e.target.value);
  document.documentElement.style.setProperty('--text-scale', String(state.textScale));
});
$('high-contrast-toggle').addEventListener('change', (e) => {
  state.highContrast = e.target.checked;
  document.body.classList.toggle('high-contrast', state.highContrast);
});
// Restore settings into the controls.
$('volume-range').value = Math.round(state.volume * 100);
$('volume-value').textContent = `${Math.round(state.volume * 100)}%`;
$('shake-range').value = state.shakePct;
$('shake-value').textContent = `${state.shakePct}%`;
$('shake-range-pause').value = state.shakePct;
$('shake-value-pause').textContent = `${state.shakePct}%`;
$('reduce-flashing').checked = !state.flash;
updateMuteLabels();

// ---------------------------------------------------------------- loop
let lastT = performance.now();
let acc = 0;
const camTarget = new THREE.Vector3(0, 0, 24);
const camLook = new THREE.Vector3(0, 4, FACE_Z);
let prevAttached = null;
let prevLatches = 0;
let prevReleases = 0;
let prevOrbs = 0;
let prevFalls = 0;
let prevPhase = 'climbing';

function currentInput(run) {
  if (state.autopilot && state.phase === 'playing') return decisionPolicy(run);
  if (state.phase === 'menu' && run === state.demoRun) return decisionPolicy(run);
  return { grapple: input.grapple, pump: input.pump };
}

function handleEvents(run, isDemo) {
  if (!run) return;
  if (run.latches > prevLatches) {
    const r = run.attached !== null ? run.climb.rings[run.attached] : null;
    const energy = swingEnergy(run);
    if (r && r.checkpoint && !isDemo) {
      fireFeedback('latch', run.pos.x, run.pos.y, FACE_Z, isDemo, energy);
      playSfx('checkpoint');
      showToast(r.summit ? 'Summit ring!' : 'Checkpoint — falls send you back here');
    } else {
      fireFeedback('latch', run.pos.x, run.pos.y, FACE_Z, isDemo, energy);
    }
    if (!isDemo) spawnPop(`+${25}`, run.pos.x, run.pos.y + 1);
  }
  if (run.releases > prevReleases) fireFeedback('release', run.pos.x, run.pos.y, FACE_Z, isDemo);
  if (run.orbs > prevOrbs) {
    fireFeedback('orb', run.pos.x, run.pos.y, FACE_Z, isDemo);
    if (!isDemo) spawnPop('+100', run.pos.x, run.pos.y + 1);
  }
  if (run.falls > prevFalls) {
    fireFeedback('fall', run.pos.x, run.pos.y, FACE_Z, isDemo);
    if (!isDemo) showToast('Fell back to the checkpoint');
  }
  prevLatches = run.latches;
  prevReleases = run.releases;
  prevOrbs = run.orbs;
  prevFalls = run.falls;
  if (run.phase !== prevPhase) {
    if (run.phase === 'won' && !isDemo) {
      fireFeedback('summit', run.pos.x, run.pos.y, FACE_Z);
      setTimeout(() => endClimb(true), 900);
    } else if (run.phase === 'lost' && !isDemo) {
      setTimeout(() => endClimb(false), 600);
    } else if (run.phase !== 'climbing' && isDemo) {
      state.demoRun = createRun(CLIMBS[0]);
      prevLatches = 0; prevReleases = 0; prevOrbs = 0; prevFalls = 0;
    }
  }
  prevPhase = run.phase;
  prevAttached = run.attached;
}

function stepActive(dtReal) {
  const run = activeRun();
  if (!run) return;
  if (state.hitStopT > 0) {
    state.hitStopT -= dtReal;
    return;
  }
  state.timeScale = state.slowMoT > 0 ? 0.35 : 1;
  if (state.slowMoT > 0) state.slowMoT -= dtReal;
  acc += dtReal * state.timeScale;
  let guard = 0;
  let lastInp = null;
  while (acc >= DT && guard < 8) {
    const inp = currentInput(run);
    stepRun(run, inp, DT);
    handleEvents(run, state.phase === 'menu');
    lastInp = inp;
    acc -= DT;
    guard++;
    if (run.phase !== 'climbing' && state.phase === 'playing') break;
  }
  if (guard >= 8) acc = 0;
  // Pump feedback: the pump bundle fires on each pump-direction edge
  // while the climber is attached and pumping WITH the swing — the
  // core interaction finally has a sound, a sparkle and a nudge, and
  // its pitch follows the swing energy. Pumping against the swing
  // stays silent: braking should feel like braking.
  if (lastInp && lastInp.pump !== 0 && lastInp.pump !== state.lastPumpSign) {
    state.lastPumpSign = lastInp.pump;
    if (run.attached !== null && state.phase !== 'paused') {
      const ss = swingSpeed(run);
      if (Math.abs(ss) > 1 && Math.sign(ss) === lastInp.pump) {
        fireFeedback('pump', run.pos.x, run.pos.y, FACE_Z, state.phase === 'menu', swingEnergy(run));
      }
    }
  } else if (lastInp) {
    state.lastPumpSign = lastInp.pump;
  }
}

function syncScene(run, tSec, dtReal) {
  if (!run) return;
  const energy = swingEnergy(run);
  // Climber.
  climberGroup.position.set(run.pos.x, run.pos.y, FACE_Z);
  climberCore.rotation.y += 0.02;
  climberCore.rotation.x += 0.011;
  climberHalo.rotation.z += 0.03;
  const pulse = 1 + Math.sin(tSec * 5) * 0.06;
  climberHalo.scale.setScalar(pulse * (1 + energy * 0.35));
  // Trail.
  trailPts.push(run.pos.x, run.pos.y, FACE_Z);
  if (trailPts.length > TRAIL_N * 3) trailPts.splice(0, 3);
  const tPos = trailGeo.attributes.position.array;
  for (let i = 0; i < TRAIL_N * 3; i++) {
    tPos[i] = trailPts[i] !== undefined ? trailPts[i] : (i % 3 === 0 ? run.pos.x : i % 3 === 1 ? run.pos.y : FACE_Z);
  }
  trailGeo.attributes.position.needsUpdate = true;
  // Rope.
  if (run.attached !== null) {
    const a = run.climb.rings[run.attached];
    const rp = ropeGeo.attributes.position.array;
    rp[0] = a.x; rp[1] = a.y; rp[2] = a.z;
    rp[3] = run.pos.x; rp[4] = run.pos.y; rp[5] = FACE_Z;
    ropeGeo.attributes.position.needsUpdate = true;
    rope.visible = true;
    // The rope heats from cyan to gold with swing energy.
    rope.material.color.lerpColors(ROPE_COLD, ROPE_HOT, energy);
  } else {
    rope.visible = false;
  }
  // Rings: pulse the next ring, spin the summit beacon, bob the orbs.
  const nextIdx = nextRingIndex(run);
  ringMeshes.forEach((m) => {
    const isNext = m.userData.ringIndex === nextIdx;
    const s = isNext ? 1 + Math.sin(tSec * 6) * 0.12 : 1;
    m.scale.setScalar(s);
    if (m.userData.summit) m.rotation.z += 0.01;
  });
  if (summitBeacon) {
    summitBeacon.rotation.y += 0.02;
    summitBeacon.position.y = run.climb.rings[run.climb.rings.length - 1].y + 2.4 + Math.sin(tSec * 2) * 0.25;
  }
  orbMeshes.forEach((m, i) => {
    if (run.orbsCollected[i]) { m.visible = false; return; }
    m.visible = true;
    m.rotation.y += 0.03;
    m.position.y = m.userData.baseY + Math.sin(tSec * 2 + m.userData.phase) * 0.3;
  });
  // Camera: chase from behind and below, looking up the spire.
  const px = run.pos.x;
  const py = run.pos.y;
  camTarget.set(px * 0.55, py - 2.5, 23);
  camLook.set(px * 0.8, py + 5.5, FACE_Z);
  // Latch snap: for a beat after a latch the camera locks onto the new
  // anchor much harder than the usual soft follow.
  const snap = state.camSnapT > 0;
  camera.position.lerp(camTarget, snap ? 0.4 : 1 - Math.pow(0.001, 1 / 60));
  if (snap) state.camSnapT -= dtReal;
  // Trauma shake (decays in REAL time, never moves physics — per-frame
  // decay freezes the camera off-centre under slow frames).
  state.trauma = Math.max(0, state.trauma - 1.6 * dtReal);
  const sh = state.trauma * state.trauma * (state.shakePct / 100);
  camera.position.x += (Math.random() - 0.5) * sh * 1.6;
  camera.position.y += (Math.random() - 0.5) * sh * 1.6;
  camera.lookAt(camLook);
  // FOV punch on release / summit, dip on latch, easing back to base
  // in real time (per-frame decay stalls under slow frames, like trauma did).
  state.fovPunch = Math.max(0, state.fovPunch - 1.8 * dtReal);
  state.fovDip = Math.max(0, state.fovDip - 2.2 * dtReal);
  const fov = FOV_BASE + state.fovPunch * 6 - state.fovDip * 4;
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  const tSec = now / 1000;
  if (state.phase !== 'paused') stepActive(dtReal);
  if (state.toastT > 0) {
    state.toastT -= dtReal;
    if (state.toastT <= 0) toastEl.classList.remove('show');
  }
  const run = activeRun();
  if (run) syncScene(run, tSec, dtReal);
  updateParticles(dtReal);
  scheduleMusic();
  if (renderer) renderer.render(scene, camera);
  if (state.phase === 'playing') updateHUD();
}

window.addEventListener('resize', () => {
  if (!renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
window.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  if (state.phase === 'playing') pauseGame();
  showToast('Graphics paused — click Resume to continue');
});
window.addEventListener('webglcontextrestored', () => { /* renderer recovers on next frame */ });

// ---------------------------------------------------------------- hooks
function info() {
  const run = state.run || state.demoRun;
  return {
    version: VERSION,
    phase: state.phase,
    climbId: state.climbId,
    climbName: run ? run.climb.name : null,
    pos: run ? { x: +run.pos.x.toFixed(2), y: +run.pos.y.toFixed(2) } : null,
    vel: run ? { x: +run.vel.x.toFixed(2), y: +run.vel.y.toFixed(2) } : null,
    attached: run ? run.attached : null,
    ropeLen: run ? +run.ropeLen.toFixed(2) : null,
    swingSpeed: run ? +swingSpeed(run).toFixed(2) : null,
    swingEnergy: run ? +swingEnergy(run).toFixed(3) : 0,
    pumpTicks: state.pumpTicks,
    fovDip: +state.fovDip.toFixed(3),
    camSnapT: +state.camSnapT.toFixed(3),
    musicActive: state.musicActive,
    nextRing: run ? nextRing(run) : null,
    latches: run ? run.latches : 0,
    releases: run ? run.releases : 0,
    runPhase: run ? run.phase : null,
    screen: run ? worldToScreen(run.pos.x, run.pos.y, FACE_Z) : null,
    spireScreen: run ? worldToScreen(0, run.pos.y, 0) : null,
    score: run ? run.score : 0,
    maxHeight: run ? +run.maxHeight.toFixed(1) : 0,
    falls: run ? run.falls : 0,
    orbs: run ? run.orbs : 0,
    time: run ? +run.time.toFixed(2) : 0,
    trauma: +state.trauma.toFixed(3),
    timeScale: state.timeScale,
    fov: +camera.fov.toFixed(1),
    autopilot: state.autopilot,
    unlocked: save.unlocked,
  };
}
window.__spire = {
  version: VERSION,
  get run() { return state.run; },
  get demoRun() { return state.demoRun; },
  get phase() { return state.phase; },
  get state() { return state; },
  get save() { return save; },
  climbs: CLIMBS,
  info,
  startClimb: (id) => startClimb(id, true),
  autopilot(on) { state.autopilot = !!on; },
  pause: pauseGame,
  resume: resumeGame,
  quitToMenu,
  setMuted(m) { if (!!m !== state.muted) toggleMute(); },
  setShake(p) { state.shakePct = p; },
  setFlash(b) { state.flash = !!b; },
  grapple(down) { input.grapple = !!down; },
  setPump(v) { input.mousePump = v; input.pump = v; },
  release() { input.grapple = false; },
  worldToScreen,
  feel: FEEDBACK,
};

// ---------------------------------------------------------------- boot
if (!webglOK || !renderer) {
  $('webgl-error').classList.remove('hidden');
} else {
  showMenu();
  const climbParam = Number(params.get('climb'));
  if (climbParam >= 1 && climbParam <= CLIMBS.length) {
    startClimb(climbParam, true);
  }
  requestAnimationFrame(frame);
}
