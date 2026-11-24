// Neon Spire v0.1.0 — pure simulation core (no DOM, no Three.js).
// A 3D neon grapple-climb ascender: the climber ascends a towering spire
// by latching anchor rings, pumping the pendulum swing, and releasing at
// the right moment to fly up and latch the next higher ring. The swing
// lives in the vertical climb-face plane (x = lateral, y = height); the
// spire, camera and background give it 3D depth in game.js, while the
// mechanic itself is a clean 2D pendulum — the same shape as the Apex
// physics split (pure sim here, rendering there).
//
// Core loop per swing: hold GRAPPLE to latch the nearest in-range ring
// (rope length = latch distance), pump A/D in time with the swing to
// build amplitude, release when the predicted ballistic apex reaches
// the next ring, fly, latch higher. Fall below the last checkpoint ring
// and you drop back to it (falls are the fail state: 5 falls = climb lost).
//
// Anti-slop: no auto-aim grapple (the rope only latches the nearest
// in-range ring — you must fly to it), no "release now" prompt, no
// assist that plays the swing for you. The bot plays through the same
// stepRun + public input hooks and must latch/pump/release with real
// timing decisions; a bot that holds grapple forever, or releases at
// random, loses on every climb (see simulateRun + the bot harness).
//
// Deterministic: every climb is hand-built from a fixed ring list, and
// the fixed-step simulation gives identical results for identical inputs.

export const VERSION = '0.1.0';
export const DT = 1 / 60;
export const GRAVITY = 18;
export const GRAPPLE_RANGE = 12;
export const ROPE_MIN = 2.5;
export const PUMP_ACCEL = 17;
export const AIR_CONTROL = 5.5;
export const MAX_SPEED = 30;
export const MAX_SWING_SPEED = 17; // while attached: body drag caps the swing — without it the pump spins the climber in full circles around the anchor (probe showed 30 u/s orbits, release window razor-thin)
export const LATCH_COOLDOWN = 0.18;
export const FALL_LIMIT = 14; // below checkpoint height -> respawn there
export const MAX_FALLS = 5;
export const ORB_RADIUS = 1.9;
export const ORB_SCORE = 100;
export const LATCH_SCORE = 25;
export const HEIGHT_SCORE = 10; // per unit of max height reached
export const WIN_TIME_BONUS = 20; // per second under par
export const FACE_Z = 6.5; // climb face: rings sit on the +z face of the spire

// ---------------------------------------------------------------- vectors
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- climbs
// Rings are ordered by height. rings[0] is the start ring (checkpoint);
// the last ring is the summit ring (latching it wins the climb).
// x = lateral offset on the climb face, y = height up the spire.
function ring(x, y, opts = {}) {
  return { x, y, z: FACE_Z, checkpoint: !!opts.checkpoint, summit: !!opts.summit };
}

export const CLIMBS = [
  {
    id: 1,
    name: 'First Light',
    hint: 'Latch, pump with the swing, release at the top of the arc.',
    accent: '#22e6ff',
    accentName: 'cyan',
    par: 45,
    height: 60,
    rings: [
      ring(0, 2, { checkpoint: true }),
      ring(3, 12),
      ring(-3, 21),
      ring(4, 31, { checkpoint: true }),
      ring(-4, 40),
      ring(2, 50, { checkpoint: true }),
      ring(0, 60, { summit: true }),
    ],
    orbs: [
      { x: 5, y: 16 }, { x: -5, y: 35 }, { x: 5, y: 45 },
      { x: -2, y: 55 },
    ],
  },
  {
    id: 2,
    name: 'Crosswind',
    hint: 'Wide swings now — pump hard and release late.',
    accent: '#ff3df0',
    accentName: 'magenta',
    par: 60,
    height: 84,
    rings: [
      ring(0, 2, { checkpoint: true }),
      ring(4, 12),
      ring(-4, 22),
      ring(4, 32, { checkpoint: true }),
      ring(-4, 42),
      ring(4, 52),
      ring(-4, 62, { checkpoint: true }),
      ring(4, 72),
      ring(0, 84, { summit: true }),
    ],
    orbs: [
      { x: 6, y: 17 }, { x: -6, y: 27 }, { x: 6, y: 47 },
      { x: -6, y: 57 }, { x: 6, y: 67 }, { x: -2, y: 77 },
    ],
  },
  {
    id: 3,
    name: 'Vortex Crown',
    hint: 'Long gaps, sharp angles. Every release counts.',
    accent: '#b26bff',
    accentName: 'violet',
    par: 75,
    height: 102,
    rings: [
      ring(0, 2, { checkpoint: true }),
      ring(5, 12),
      ring(-4, 22),
      ring(4, 32, { checkpoint: true }),
      ring(-5, 42),
      ring(5, 52),
      ring(-4, 62, { checkpoint: true }),
      ring(4, 72),
      ring(-5, 82),
      ring(3, 92, { checkpoint: true }),
      ring(0, 102, { summit: true }),
    ],
    orbs: [
      { x: 7, y: 17 }, { x: -6, y: 27 }, { x: 7, y: 47 },
      { x: -6, y: 57 }, { x: 7, y: 77 }, { x: -6, y: 87 },
    ],
  },
];

export function climbById(id) {
  return CLIMBS.find((c) => c.id === id) || null;
}

export function climbThreat(c) {
  // Rough difficulty measure: height + lateral spread + gap size.
  const gaps = [];
  for (let i = 1; i < c.rings.length; i++) {
    gaps.push(Math.hypot(c.rings[i].x - c.rings[i - 1].x, c.rings[i].y - c.rings[i - 1].y));
  }
  const maxGap = Math.max(...gaps);
  return c.height + maxGap * 2 + c.rings.length;
}

// ---------------------------------------------------------------- run state
export function createRun(climb) {
  const start = climb.rings[0];
  return {
    climb,
    phase: 'climbing', // 'climbing' | 'won' | 'lost'
    time: 0,
    pos: { x: start.x, y: start.y - ROPE_MIN, z: FACE_Z },
    vel: { x: 0, y: 0, z: 0 },
    attached: 0, // ring index, or null when airborne
    ropeLen: ROPE_MIN,
    checkpoint: 0, // ring index of the last checkpoint latched
    falls: 0,
    latches: 0,
    releases: 0,
    orbs: 0,
    orbsCollected: climb.orbs.map(() => false),
    maxHeight: start.y - ROPE_MIN,
    score: 0,
    latchCooldown: 0,
    graceT: 3, // seconds after start/respawn during which the climber stays latched unless the player has held grapple (Orbit lesson: default states must be safe — a run must not insta-release the moment Play is clicked, before the player has touched a key)
    hasGrappled: false, // set the first time the player holds grapple in this run
    releaseLock: 0, // seconds the just-released ring cannot be re-latched
    lastReleasedRing: -1,
    latchedRings: new Set([0]),
    lastReleaseVel: null,
  };
}

export function startRun(climbId) {
  const climb = climbById(climbId);
  if (!climb) return null;
  return createRun(climb);
}

// The next ring the climber should aim for: the lowest ring above the
// current anchor (or above the climber when airborne) that is not the
// ring currently latched.
export function nextRing(run) {
  const anchorY = run.attached !== null
    ? run.climb.rings[run.attached].y
    : run.pos.y;
  for (const r of run.climb.rings) {
    if (r.y > anchorY + 0.5) return r;
  }
  return run.climb.rings[run.climb.rings.length - 1];
}

export function nextRingIndex(run) {
  const target = nextRing(run);
  return run.climb.rings.indexOf(target);
}

// Tangent direction of the pendulum swing in the climb-face plane.
// rope r = pos - anchor; tangent t = (-ry, rx) / |r| (unit, in x/y).
export function swingTangent(run) {
  if (run.attached === null) return { x: 1, y: 0 };
  const a = run.climb.rings[run.attached];
  const rx = run.pos.x - a.x;
  const ry = run.pos.y - a.y;
  const len = Math.hypot(rx, ry) || 1;
  return { x: -ry / len, y: rx / len };
}

// Signed swing speed along the tangent (positive = swinging one way,
// negative = the other). Pumping with the sign of this builds energy.
export function swingSpeed(run) {
  const t = swingTangent(run);
  return run.vel.x * t.x + run.vel.y * t.y;
}

// Nearest latchable ring: within range, not below the climber. The ring
// just released is locked out until another ring is latched or the lock
// expires — otherwise every release re-catches the ring you just left
// (the first probe showed 5 latches per ring from that churn alone).
// Nearest-in-range (not highest) is deliberate: you must actually fly
// to the next ring, you cannot skip two rings ahead in one latch.
export function latchTarget(run) {
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < run.climb.rings.length; i++) {
    const r = run.climb.rings[i];
    if (run.releaseLock > 0 && i === run.lastReleasedRing) continue;
    if (r.y < run.pos.y - 1) continue;
    const d = Math.hypot(r.x - run.pos.x, r.y - run.pos.y);
    if (d > GRAPPLE_RANGE) continue;
    if (best === null || d < bestD - 0.01 || (Math.abs(d - bestD) <= 0.01 && r.y > run.climb.rings[best].y)) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

function respawn(run) {
  const cp = run.climb.rings[run.checkpoint];
  run.pos = { x: cp.x, y: cp.y - ROPE_MIN, z: FACE_Z };
  run.vel = { x: 0, y: 0, z: 0 };
  run.attached = run.checkpoint;
  run.ropeLen = ROPE_MIN;
  run.latchCooldown = 0;
  run.releaseLock = 0;
  run.lastReleasedRing = -1;
  run.graceT = 3;
  run.hasGrappled = false;
  run.time += 3; // a fall costs 3 seconds on the clock
}

function collectOrbs(run) {
  for (let i = 0; i < run.climb.orbs.length; i++) {
    if (run.orbsCollected[i]) continue;
    const o = run.climb.orbs[i];
    if (Math.hypot(o.x - run.pos.x, o.y - run.pos.y) <= ORB_RADIUS) {
      run.orbsCollected[i] = true;
      run.orbs++;
      run.score += ORB_SCORE;
    }
  }
}

function finishScore(run) {
  run.score += Math.round(run.maxHeight * HEIGHT_SCORE);
  if (run.phase === 'won') {
    run.score += Math.max(0, Math.round((run.climb.par - run.time) * WIN_TIME_BONUS));
  }
  if (run.score < 0) run.score = 0;
}

// One fixed step. input: { grapple: boolean, pump: -1 | 0 | 1 }.
// pump = -1 means "pump left" (A / Left), +1 means "pump right" (D / Right).
export function stepRun(run, input, dt = DT) {
  if (run.phase !== 'climbing') return run;
  const pump = clamp(input.pump || 0, -1, 1);
  const grapple = !!input.grapple;
  run.time += dt;
  if (run.latchCooldown > 0) run.latchCooldown -= dt;
  if (run.releaseLock > 0) run.releaseLock -= dt;
  if (run.graceT > 0) run.graceT -= dt;
  if (grapple) run.hasGrappled = true;

  if (run.attached !== null) {
    const a = run.climb.rings[run.attached];
    // Gravity.
    run.vel.y -= GRAVITY * dt;
    // Pump: accelerate along the swing tangent. Pumping with the swing
    // (same sign as the swing speed) adds energy; pumping against it
    // brakes — timing is the skill.
    const t = swingTangent(run);
    run.vel.x += t.x * PUMP_ACCEL * pump * dt;
    run.vel.y += t.y * PUMP_ACCEL * pump * dt;
    // Clamp swing speed (body drag: the swing cannot loop over the top)
    // and bleed a little energy so the amplitude settles where pumping
    // sustains it — the player must keep pumping, not pump once and spin.
    const sp = Math.hypot(run.vel.x, run.vel.y);
    if (sp > MAX_SWING_SPEED) {
      run.vel.x *= MAX_SWING_SPEED / sp;
      run.vel.y *= MAX_SWING_SPEED / sp;
    }
    const drag = 1 - 0.12 * dt;
    run.vel.x *= drag;
    run.vel.y *= drag;
    // Integrate.
    run.pos.x += run.vel.x * dt;
    run.pos.y += run.vel.y * dt;
    // Rope constraint: the rope is inextensible — pull the climber back
    // onto the sphere of radius ropeLen and kill outward radial velocity.
    const rx = run.pos.x - a.x;
    const ry = run.pos.y - a.y;
    const len = Math.hypot(rx, ry);
    if (len > run.ropeLen) {
      const nx = rx / len;
      const ny = ry / len;
      run.pos.x = a.x + nx * run.ropeLen;
      run.pos.y = a.y + ny * run.ropeLen;
      const vr = run.vel.x * nx + run.vel.y * ny;
      if (vr > 0) {
        run.vel.x -= nx * vr;
        run.vel.y -= ny * vr;
      }
    }
    // Release: let go of the rope, keep the velocity. During the
    // grace window the release is ignored if the player has never held
    // grapple in this run — the climber just hangs, waiting for input.
    if (!grapple && !(run.graceT > 0 && !run.hasGrappled)) {
      run.lastReleasedRing = run.attached;
      run.releaseLock = 1.2;
      run.attached = null;
      run.releases++;
      run.lastReleaseVel = { x: run.vel.x, y: run.vel.y };
      run.latchCooldown = LATCH_COOLDOWN;
    }
  } else {
    // Ballistic flight.
    run.vel.y -= GRAVITY * dt;
    // Weak air control: nudge laterally toward the pump direction.
    run.vel.x += pump * AIR_CONTROL * dt;
    const sp = Math.hypot(run.vel.x, run.vel.y);
    if (sp > MAX_SPEED) {
      run.vel.x *= MAX_SPEED / sp;
      run.vel.y *= MAX_SPEED / sp;
    }
    run.pos.x += run.vel.x * dt;
    run.pos.y += run.vel.y * dt;
    // Latch attempt while the grapple is held.
    if (grapple && run.latchCooldown <= 0) {
      const target = latchTarget(run);
      if (target !== null) {
        const r = run.climb.rings[target];
        const d = Math.hypot(r.x - run.pos.x, r.y - run.pos.y);
        run.attached = target;
        run.ropeLen = clamp(d, ROPE_MIN, GRAPPLE_RANGE);
        run.latches++;
        run.score += LATCH_SCORE;
        run.latchedRings.add(target);
        if (r.checkpoint && target > run.checkpoint) run.checkpoint = target;
        if (r.summit) {
          run.phase = 'won';
          finishScore(run);
          return run;
        }
      }
    }
  }

  if (run.pos.y > run.maxHeight) run.maxHeight = run.pos.y;
  collectOrbs(run);

  // Fell below the last checkpoint: drop back to it.
  const cpY = run.climb.rings[run.checkpoint].y;
  if (run.pos.y < cpY - FALL_LIMIT || run.pos.y < -20) {
    run.falls++;
    if (run.falls >= MAX_FALLS) {
      run.phase = 'lost';
      finishScore(run);
      return run;
    }
    respawn(run);
  }
  return run;
}

// ---------------------------------------------------------------- bots
export function noInputPolicy() {
  return { grapple: false, pump: 0 };
}

export function holdPolicy() {
  // Holds grapple forever and pumps one way forever: the anti-slop bot
  // that must lose. Holding grapple means it never releases, so it can
  // never fly to the next ring; pumping one way adds energy half the
  // swing and brakes the other half, so amplitude never builds.
  return { grapple: true, pump: 1 };
}

export function randomPolicy(rng) {
  return {
    grapple: rng() < 0.5,
    pump: rng() < 0.33 ? -1 : rng() < 0.5 ? 1 : 0,
  };
}

// The decision bot: real latch/pump/release timing through the same
// public input hooks a human uses.
// - Attached: pump with the swing (sign of swing speed); release when
//   the predicted ballistic apex comes within latch range of the next ring.
// - Airborne: hold grapple to latch when a ring comes in range; steer
//   laterally toward the next ring.
export function decisionPolicy(run) {
  const target = nextRing(run);
  if (run.attached !== null) {
    const ss = swingSpeed(run);
    let pump = 0;
    if (Math.abs(ss) > 0.4) pump = ss > 0 ? 1 : -1;
    else pump = 1; // start the swing from rest
    // Release check: only while moving upward, with real swing energy,
    // flying toward the target, and the predicted ballistic apex within
    // latch range of the next ring.
    if (run.vel.y > 2 && Math.abs(ss) > 5) {
      const tUp = run.vel.y / GRAVITY;
      const apexX = run.pos.x + run.vel.x * tUp;
      const apexY = run.pos.y + run.vel.y * tUp - 0.5 * GRAVITY * tUp * tUp;
      const dApex = Math.hypot(target.x - apexX, target.y - apexY);
      const toward = run.vel.x * (target.x - run.pos.x) + run.vel.y * (target.y - run.pos.y);
      if (dApex < GRAPPLE_RANGE * 0.8 && toward > 0) {
        return { grapple: false, pump: 0 };
      }
    }
    return { grapple: true, pump };
  }
  // Airborne: hold grapple, steer toward the next ring.
  const steer = target.x > run.pos.x + 0.3 ? 1 : target.x < run.pos.x - 0.3 ? -1 : 0;
  return { grapple: true, pump: steer };
}

export function simulateRun(climb, policy, maxSeconds = 400) {
  const run = createRun(climb);
  const maxSteps = Math.floor(maxSeconds / DT);
  let steps = 0;
  // Random policy needs a stable input cadence: re-roll every 15 steps.
  const rng = mulberry32(1337 + climb.id);
  let cached = policy === 'random' ? randomPolicy(rng) : null;
  while (run.phase === 'climbing' && steps < maxSteps) {
    let input;
    if (policy === 'none') input = noInputPolicy();
    else if (policy === 'hold') input = holdPolicy();
    else if (policy === 'random') {
      if (steps % 15 === 0) cached = randomPolicy(rng);
      input = cached;
    } else if (policy === 'decision') input = decisionPolicy(run);
    else throw new Error('unknown policy: ' + policy);
    stepRun(run, input);
    steps++;
  }
  return {
    policy,
    climbId: climb.id,
    won: run.phase === 'won',
    lost: run.phase === 'lost',
    time: +run.time.toFixed(2),
    maxHeight: +run.maxHeight.toFixed(1),
    falls: run.falls,
    latches: run.latches,
    releases: run.releases,
    orbs: run.orbs,
    score: run.score,
    steps,
  };
}

// ---------------------------------------------------------------- save
export function defaultSave() {
  return {
    version: 1,
    best: {}, // climbId -> { score, time, falls, orbs, won }
    unlocked: 1, // highest climb id unlocked
    settings: { muted: false, shake: 100, flash: true },
  };
}

export function serializeSave(save) {
  return JSON.stringify(save);
}

export function parseSave(raw) {
  try {
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return defaultSave();
    const d = defaultSave();
    return {
      version: 1,
      best: { ...(s.best || {}) },
      unlocked: Number.isInteger(s.unlocked) ? clamp(s.unlocked, 1, CLIMBS.length) : 1,
      settings: { ...d.settings, ...(s.settings || {}) },
    };
  } catch {
    return defaultSave();
  }
}

export function recordBest(save, climbId, result) {
  const prev = save.best[climbId];
  if (!result.won) return save;
  const better = !prev || result.score > prev.score;
  if (better) {
    save.best[climbId] = {
      score: result.score,
      time: result.time,
      falls: result.falls,
      orbs: result.orbs,
      won: true,
    };
  }
  if (climbId < CLIMBS.length && save.unlocked < climbId + 1) {
    save.unlocked = climbId + 1;
  }
  return save;
}

export function isClimbUnlocked(save, climbId) {
  return climbId <= save.unlocked;
}

export function rankFor(result) {
  // S: won with 0 falls and under par. A: won under par. B: won over par.
  if (!result.won) return null;
  if (result.falls === 0 && result.time <= result.par) return 'S';
  if (result.time <= result.par) return 'A';
  return 'B';
}

// ---------------------------------------------------------------- feedback
// Game-feel tiers (same shape as the other games): every event fires a
// bundle of layered responses within ~100ms.
export const FEEDBACK = {
  latch: { trauma: 0.18, hitStop: 0, sfx: 'latch', flash: 0, particles: 10 },
  pump: { trauma: 0.05, hitStop: 0, sfx: 'pump', flash: 0, particles: 2 },
  release: { trauma: 0.22, hitStop: 0, sfx: 'release', flash: 0, particles: 8 },
  orb: { trauma: 0.15, hitStop: 0, sfx: 'orb', flash: 0, particles: 14 },
  fall: { trauma: 0.55, hitStop: 0.06, sfx: 'fall', flash: 0.12, particles: 22 },
  summit: { trauma: 0.8, hitStop: 0.12, sfx: 'summit', flash: 0.2, particles: 60 },
  denied: { trauma: 0.08, hitStop: 0, sfx: 'denied', flash: 0, particles: 0 },
};
export const FEEDBACK_TIERS = {
  small: { trauma: [0.1, 0.2], hitStop: 0 },
  medium: { trauma: [0.3, 0.5], hitStop: [0.04, 0.06] },
  large: { trauma: [0.7, 1.0], hitStop: [0.1, 0.15] },
};
export const FEEDBACK_LAYERS = ['sound', 'particles', 'shake', 'flash', 'number-pop'];
