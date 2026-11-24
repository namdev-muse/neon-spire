// Neon Spire v0.2.0 — Node smoke tests for physics.js (no DOM, no Three.js).
import {
  VERSION, CLIMBS, climbById, climbThreat, DT, GRAVITY, GRAPPLE_RANGE,
  ROPE_MIN, PUMP_ACCEL, MAX_SWING_SPEED, FALL_LIMIT, MAX_FALLS,
  FACE_Z, createRun, startRun, stepRun, nextRing, latchTarget,
  swingTangent, swingSpeed, noInputPolicy, holdPolicy, randomPolicy,
  decisionPolicy, simulateRun, defaultSave, serializeSave, parseSave,
  recordBest, isClimbUnlocked, rankFor, FEEDBACK, FEEDBACK_TIERS, FEEDBACK_LAYERS,
} from '../physics.js';

let passed = 0, failed = 0;
const failures = [];
function check(name, cond) {
  if (cond) passed++;
  else { failed++; failures.push(name); console.error('FAIL:', name); }
}
function approx(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

check('physics version is 0.2.0', VERSION === '0.2.0');
check('12 climbs defined', CLIMBS.length === 12);
check('climb ids are 1..12 in order', CLIMBS.every((c, i) => c.id === i + 1));
check('every climb has a name and a hint', CLIMBS.every((c) => c.name && c.hint));
check('every climb has a distinct accent', new Set(CLIMBS.map((c) => c.accent)).size === 12);
check('climbById finds climb 1', climbById(1) && climbById(1).name === 'First Light');
check('climbById finds climb 12', climbById(12) && climbById(12).name === 'Void Crown');
check('climbById returns null for unknown id', climbById(99) === null);
check('every climb has 7+ rings', CLIMBS.every((c) => c.rings.length >= 7));
check('every climb has a start checkpoint ring', CLIMBS.every((c) => c.rings[0].checkpoint));
check('every climb has a summit ring last', CLIMBS.every((c) => c.rings[c.rings.length - 1].summit));
check('every climb has 2+ checkpoints', CLIMBS.every((c) => c.rings.filter((r) => r.checkpoint).length >= 2));
check('every climb has 4+ orbs', CLIMBS.every((c) => c.orbs.length >= 4));
check('ring heights strictly increase', CLIMBS.every((c) => c.rings.every((r, i) => i === 0 || r.y > c.rings[i - 1].y)));
check('summit height matches climb height', CLIMBS.every((c) => c.rings[c.rings.length - 1].y === c.height));
check('every ring sits on the climb face', CLIMBS.every((c) => c.rings.every((r) => r.z === FACE_Z)));
check('no ring gap is beyond grapple reach (diagonal <= range + 4)', CLIMBS.every((c) =>
  c.rings.every((r, i) => i === 0 || Math.hypot(r.x - c.rings[i - 1].x, r.y - c.rings[i - 1].y) <= GRAPPLE_RANGE + 4)));
check('threat grows with climb number', CLIMBS.every((c, i) => i === 0 || climbThreat(c) > climbThreat(CLIMBS[i - 1])));
check('no difficulty cliff: each climb within 1.6x of the previous threat',
  CLIMBS.every((c, i) => i === 0 || climbThreat(c) < climbThreat(CLIMBS[i - 1]) * 1.6));

// --- run lifecycle ---
const run1 = startRun(1);
check('startRun returns a run on climb 1', !!run1 && run1.climb.id === 1);
check('run starts attached to the start ring', run1.attached === 0);
check('run starts hanging below the start ring', approx(run1.pos.y, 2 - ROPE_MIN));
check('run starts in climbing phase', run1.phase === 'climbing');
check('startRun returns null for unknown climb', startRun(99) === null);

// --- pendulum: pumping with the swing builds energy, against it brakes ---
{
  const r = startRun(1);
  const s0 = Math.abs(swingSpeed(r));
  // Pump with the motion for 2 seconds: start the swing from rest.
  for (let i = 0; i < 120; i++) stepRun(r, { grapple: true, pump: swingSpeed(r) >= 0 ? 1 : -1 });
  const sWith = Math.abs(swingSpeed(r));
  check('pumping with the swing builds swing speed', sWith > 4 && sWith > s0);
  // Now pump against the motion for 2 seconds: the swing must decay.
  const before = Math.abs(swingSpeed(r));
  for (let i = 0; i < 120; i++) stepRun(r, { grapple: true, pump: swingSpeed(r) >= 0 ? -1 : 1 });
  const after = Math.abs(swingSpeed(r));
  check('pumping against the swing brakes it', after < before);
}
// Rope constraint: the climber never drifts beyond rope length.
{
  const r = startRun(1);
  let maxOver = 0;
  for (let i = 0; i < 600; i++) {
    stepRun(r, { grapple: true, pump: swingSpeed(r) >= 0 ? 1 : -1 });
    if (r.attached !== null) {
      const a = r.climb.rings[r.attached];
      const d = Math.hypot(r.pos.x - a.x, r.pos.y - a.y);
      maxOver = Math.max(maxOver, d - r.ropeLen);
    }
  }
  check('rope never stretches beyond ropeLen', maxOver <= 1e-6);
}
// Swing never loops over the top (speed cap).
{
  const r = startRun(1);
  let maxSpeed = 0;
  for (let i = 0; i < 1800; i++) {
    stepRun(r, { grapple: true, pump: swingSpeed(r) >= 0 ? 1 : -1 });
    maxSpeed = Math.max(maxSpeed, Math.hypot(r.vel.x, r.vel.y));
    if (r.attached === null) break; // released — stop measuring the swing
  }
  check('attached swing speed stays capped (no full-circle spins)', maxSpeed <= MAX_SWING_SPEED + 1e-6);
}
// Release keeps velocity (ballistic flight, no rope).
{
  // Twin-run check: two identical runs, pumped identically for 90 steps,
  // then one releases and the other keeps holding. The release itself
  // adds no impulse (gravity, pump, drag and the rope constraint all
  // apply identically in that step; only attached flips), so the
  // velocities must match exactly after the step.
  const r = startRun(1);
  const twin = startRun(1);
  for (let i = 0; i < 90; i++) {
    const inp = { grapple: true, pump: swingSpeed(r) >= 0 ? 1 : -1 };
    stepRun(r, inp);
    stepRun(twin, inp);
  }
  const inp = { grapple: true, pump: swingSpeed(r) >= 0 ? 1 : -1 };
  stepRun(r, { grapple: false, pump: inp.pump });
  stepRun(twin, inp);
  check('release detaches the rope', r.attached === null);
  check('release keeps the velocity (no impulse on release)', r.vel.x === twin.vel.x && r.vel.y === twin.vel.y);
  check('release records the release velocity', !!r.lastReleaseVel);
  // Just-released ring is locked out for a moment.
  check('just-released ring is locked out of latchTarget', latchTarget(r) !== r.lastReleasedRing || r.releaseLock <= 0);
}
// Grace: a run that has never seen grapple held stays latched for the
// first 3 seconds (clicking Play must not insta-release the climber),
// but a run that HAS grappled releases normally, and the grace expires.
{
  const r = startRun(1);
  for (let i = 0; i < 120; i++) stepRun(r, { grapple: false, pump: 0 });
  check('grace: never-grappled climber stays latched for the first 3s', r.attached === 0 && r.phase === 'climbing');
  for (let i = 0; i < 120; i++) stepRun(r, { grapple: false, pump: 0 });
  check('grace expires: never-grappled climber releases after 3s', r.attached === null);
  const r2 = startRun(1);
  stepRun(r2, { grapple: true, pump: 0 });
  stepRun(r2, { grapple: false, pump: 0 });
  check('grace does not block release once the player has grappled', r2.attached === null);
}
// Latch: the nearest in-range ring above the climber is the target.
{
  const r = startRun(1);
  r.attached = null;
  r.pos = { x: 3, y: 10, z: FACE_Z }; // just below ring 1 (3, 12)
  const t = latchTarget(r);
  check('latchTarget picks the nearest in-range ring above', t === 1);
}
// Gravity pulls a free climber down.
{
  const r = startRun(1);
  r.attached = null;
  r.vel = { x: 0, y: 0, z: 0 };
  const y0 = r.pos.y;
  stepRun(r, { grapple: false, pump: 0 });
  check('gravity pulls the airborne climber down', r.pos.y < y0 && r.vel.y < 0);
}
// Falling below the checkpoint respawns there, with a time penalty.
{
  const r = startRun(1);
  const t0 = r.time;
  r.attached = null;
  r.pos = { x: 0, y: 2 - FALL_LIMIT - 1, z: FACE_Z };
  stepRun(r, { grapple: false, pump: 0 });
  check('falling below the checkpoint respawns at it', r.attached === 0 && r.falls === 1);
  check('a fall costs 3 seconds on the clock', r.time >= t0 + 3);
  check('respawn hangs the climber below the ring', approx(r.pos.y, 2 - ROPE_MIN));
}
// 5 falls lose the climb.
{
  const r = startRun(1);
  r.falls = MAX_FALLS - 1;
  r.attached = null;
  r.pos = { x: 0, y: 2 - FALL_LIMIT - 1, z: FACE_Z };
  stepRun(r, { grapple: false, pump: 0 });
  check('5th fall loses the climb', r.phase === 'lost' && r.falls === MAX_FALLS);
}
// Orbs: flying through one collects it for score.
{
  const r = startRun(1);
  const o = r.climb.orbs[0];
  r.attached = null; // airborne at the orb (a latched climber is rope-bound)
  r.vel = { x: 0, y: 0, z: 0 };
  r.pos = { x: o.x, y: o.y, z: FACE_Z };
  const score0 = r.score;
  stepRun(r, { grapple: false, pump: 0 }); // no grapple: no latch bonus in this step
  check('orb collected on contact', r.orbs === 1 && r.score === score0 + 100);
  check('orb cannot be collected twice', (() => {
    const s = r.score;
    stepRun(r, { grapple: false, pump: 0 });
    return r.score === s;
  })());
}
// Next ring advances as the climber latches higher.
{
  const r = startRun(1);
  check('next ring from the start is ring 1', nextRing(r).y === r.climb.rings[1].y);
  r.attached = 3;
  check('next ring after ring 3 is ring 4', nextRing(r).y === r.climb.rings[4].y);
}
// Swing tangent is perpendicular to the rope.
{
  const r = startRun(1);
  r.pos = { x: 2.5, y: -0.5, z: FACE_Z }; // rope at 45 degrees
  const t = swingTangent(r);
  const a = r.climb.rings[r.attached];
  const rx = r.pos.x - a.x;
  const ry = r.pos.y - a.y;
  check('swing tangent is perpendicular to the rope', Math.abs(t.x * rx + t.y * ry) < 1e-9);
  check('swing tangent is a unit vector', approx(Math.hypot(t.x, t.y), 1));
}
// Determinism: identical inputs give identical runs.
{
  const a = startRun(2);
  const b = startRun(2);
  for (let i = 0; i < 300; i++) {
    const inp = decisionPolicy(a);
    stepRun(a, inp);
    stepRun(b, decisionPolicy(b));
  }
  check('identical inputs give identical runs', a.pos.x === b.pos.x && a.pos.y === b.pos.y && a.score === b.score);
}
// Save / unlock / ranks.
{
  const s = defaultSave();
  check('fresh save unlocks only climb 1', s.unlocked === 1 && isClimbUnlocked(s, 1) && !isClimbUnlocked(s, 2));
  recordBest(s, 1, { won: true, score: 1500, time: 40, falls: 0, orbs: 3 });
  check('clearing climb 1 unlocks climb 2', s.unlocked === 2 && isClimbUnlocked(s, 2));
  check('best score recorded', s.best[1].score === 1500);
  const s2 = parseSave(serializeSave(s));
  check('save round-trips through JSON', s2.unlocked === 2 && s2.best[1].score === 1500);
  check('corrupt save falls back to defaults', parseSave('not json').unlocked === 1);
  check('S rank needs no falls under par', rankFor({ won: true, falls: 0, time: 40, par: 45 }) === 'S');
  check('A rank is a win under par with a fall', rankFor({ won: true, falls: 1, time: 40, par: 45 }) === 'A');
  check('B rank is a win over par', rankFor({ won: true, falls: 0, time: 90, par: 45 }) === 'B');
  check('no rank without a win', rankFor({ won: false, falls: 0, time: 40, par: 45 }) === null);
  check('a loss does not record a best', (() => {
    const s3 = defaultSave();
    recordBest(s3, 1, { won: false, score: 9999, time: 10, falls: 5, orbs: 0 });
    return !s3.best[1];
  })());
}
// Feedback table is complete and tiered.
check('feedback events exist for every game event',
  ['latch', 'release', 'orb', 'fall', 'summit', 'denied'].every((e) => !!FEEDBACK[e]));
check('feedback tiers cover small/medium/large',
  !!FEEDBACK_TIERS.small && !!FEEDBACK_TIERS.medium && !!FEEDBACK_TIERS.large);
check('feedback layers list sound, particles, shake, flash, number-pop',
  FEEDBACK_LAYERS.join(',') === 'sound,particles,shake,flash,number-pop');
check('summit is the biggest feedback (trauma >= fall)',
  FEEDBACK.summit.trauma >= FEEDBACK.fall.trauma && FEEDBACK.summit.hitStop >= FEEDBACK.fall.hitStop);
check('gravity is positive and sane', GRAVITY > 10 && GRAVITY < 30);
check('pump beats gravity enough to build a swing', PUMP_ACCEL > 10);
check('fixed step is 1/60', approx(DT, 1 / 60));

console.log(`smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('failures:', failures.join(' | '));
  process.exit(1);
}
