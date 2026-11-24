// Neon Spire v0.4.0 — Node smoke tests for physics.js (no DOM, no Three.js).
import {
  VERSION, CLIMBS, climbById, climbThreat, DT, GRAVITY, GRAPPLE_RANGE,
  ROPE_MIN, PUMP_ACCEL, MAX_SWING_SPEED, FALL_LIMIT, MAX_FALLS,
  FACE_Z, createRun, startRun, stepRun, nextRing, latchTarget,
  swingTangent, swingSpeed, swingEnergy, noInputPolicy, holdPolicy, randomPolicy,
  decisionPolicy, simulateRun, defaultSave, serializeSave, parseSave,
  recordBest, isClimbUnlocked, rankFor, FEEDBACK, FEEDBACK_TIERS, FEEDBACK_LAYERS,
  generateEndlessClimb, createEndlessRun, simulateEndless, recordEndlessBest,
} from '../physics.js';

let passed = 0, failed = 0;
const failures = [];
function check(name, cond) {
  if (cond) passed++;
  else { failed++; failures.push(name); console.error('FAIL:', name); }
}
function approx(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

check('physics version is 0.4.0', VERSION === '0.4.0');
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
// Per-climb clear ranks are saved and kept (M4): rank tracking is
// independent of the score — a better rank upgrades the saved rank
// even on a lower-score clear, and a worse rank never downgrades it.
{
  const s = defaultSave();
  recordBest(s, 1, { won: true, score: 1500, time: 40, falls: 0, orbs: 3, par: 45 });
  check('an S clear stores rank S', s.best[1].rank === 'S');
  recordBest(s, 1, { won: true, score: 1600, time: 40, falls: 1, orbs: 3, par: 45 });
  check('a later A clear with a better score keeps rank S', s.best[1].rank === 'S' && s.best[1].score === 1600);
  const s2 = defaultSave();
  recordBest(s2, 1, { won: true, score: 1000, time: 90, falls: 0, orbs: 2, par: 45 });
  check('a B clear stores rank B', s2.best[1].rank === 'B');
  recordBest(s2, 1, { won: true, score: 900, time: 40, falls: 1, orbs: 2, par: 45 });
  check('a later A clear with a lower score upgrades rank B to A', s2.best[1].rank === 'A' && s2.best[1].score === 1000);
  recordBest(s2, 1, { won: true, score: 800, time: 90, falls: 2, orbs: 2, par: 45 });
  check('rank survives a lower-score clear', s2.best[1].rank === 'A' && s2.best[1].score === 1000);
  const s3 = parseSave(serializeSave(s2));
  check('save round-trip keeps rank', s3.best[1].rank === 'A');
  check('parseSave drops an invalid rank', parseSave(JSON.stringify({ best: { 1: { score: 1, won: true, rank: 'X' } } })).best[1].rank === undefined);
  check('parseSave keeps a valid rank', parseSave(JSON.stringify({ best: { 1: { score: 1, won: true, rank: 'S' } } })).best[1].rank === 'S');
}
// Endless Ascent (M4): seeded generation, balance gates, best height.
{
  const e1 = generateEndlessClimb(20261124);
  const e2 = generateEndlessClimb(20261124);
  check('endless generation is deterministic per seed', JSON.stringify(e1.rings) === JSON.stringify(e2.rings) && JSON.stringify(e1.orbs) === JSON.stringify(e2.orbs));
  check('endless generation differs across seeds', JSON.stringify(generateEndlessClimb(20261125).rings) !== JSON.stringify(e1.rings));
  check('endless climb has ~120 rings', e1.rings.length === 120);
  check('endless climb starts at ring(0,2) checkpoint', e1.rings[0].x === 0 && e1.rings[0].y === 2 && e1.rings[0].checkpoint === true);
  check('endless climb shape (id 0, par null, endless, seed)', e1.id === 0 && e1.name === 'Endless Ascent' && e1.endless === true && e1.par === null && e1.seed === 20261124 && e1.height === e1.rings[e1.rings.length - 1].y);
  check('endless has no summit ring', !e1.rings.some((r) => r.summit));
  check('endless has checkpoints', e1.rings.filter((r) => r.checkpoint).length >= 10);
  check('endless has orbs', e1.orbs.length >= 30);
  const gaps = e1.rings.slice(1).map((r, i) => r.y - e1.rings[i].y);
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  check('endless gaps grow with height', avg(gaps.slice(-20)) > avg(gaps.slice(0, 20)));
  check('endless gaps stay in the climbable band', gaps.every((g) => g >= 9 && g <= 12.5));
  const dec = simulateEndless(20261124, 'decision');
  check('endless decision bot reaches >= 100m on seed 20261124', dec.maxHeight >= 100);
  check('endless never wins (no summit)', dec.won === false);
  const hold = simulateEndless(20261124, 'hold');
  check('endless hold bot reaches < 25m', hold.maxHeight < 25 && !hold.won);
  const rand = simulateEndless(20261124, 'random');
  check('endless random bot reaches < 25m and/or loses', (rand.maxHeight < 25 || rand.lost) && !rand.won);
  const run = createEndlessRun(20261124);
  check('createEndlessRun builds an endless run latched to ring 0', run.climb.endless === true && run.attached === 0);
  const s = defaultSave();
  check('fresh save has no endless best', s.endlessBest === null);
  recordEndlessBest(s, { maxHeight: 87.4, score: 1200, seed: 20261124 });
  check('endless best records height + score + seed', s.endlessBest.height === 87 && s.endlessBest.score === 1200 && s.endlessBest.seed === 20261124);
  recordEndlessBest(s, { maxHeight: 50, score: 9999, seed: 20261124 });
  check('a lower endless height does not replace the best', s.endlessBest.height === 87 && s.endlessBest.score === 1200);
  recordEndlessBest(s, { maxHeight: 120.9, score: 2000, seed: 20261125 });
  check('a higher endless height replaces the best', s.endlessBest.height === 120 && s.endlessBest.seed === 20261125);
  const s2 = parseSave(serializeSave(s));
  check('save round-trip keeps endlessBest', s2.endlessBest.height === 120 && s2.endlessBest.seed === 20261125);
  check('parseSave drops an invalid endlessBest', parseSave(JSON.stringify({ endlessBest: { height: 'high' } })).endlessBest === null);
  check('parseSave keeps a valid endlessBest', parseSave(JSON.stringify({ endlessBest: { height: 87, score: 1, seed: 20261124, date: '2026-11-24' } })).endlessBest.height === 87);
}
// Swing energy: the meter the HUD, rope and pump tick all read from.
{
  const r = startRun(1);
  check('swing energy is 0 at rest', swingEnergy(r) === 0);
  for (let i = 0; i < 120; i++) stepRun(r, { grapple: true, pump: swingSpeed(r) >= 0 ? 1 : -1 });
  const e = swingEnergy(r);
  check('swing energy rises as the swing builds', e > 0.2 && e <= 1);
  for (let i = 0; i < 1800; i++) stepRun(r, { grapple: true, pump: swingSpeed(r) >= 0 ? 1 : -1 });
  check('swing energy never exceeds 1 (capped by the swing cap)', swingEnergy(r) <= 1);
  const r2 = startRun(1);
  r2.attached = null;
  check('swing energy is 0 while airborne (no swing to measure)', swingEnergy(r2) === 0);
}
// Feedback table is complete and tiered.
check('feedback events exist for every game event',
  ['latch', 'pump', 'release', 'orb', 'fall', 'summit', 'denied'].every((e) => !!FEEDBACK[e]));
check('every feedback entry carries a full bundle (sfx, particles, trauma, hit-stop, flash)',
  Object.values(FEEDBACK).every((fb) =>
    typeof fb.sfx === 'string' && fb.sfx.length > 0 &&
    Number.isInteger(fb.particles) && fb.particles >= 0 &&
    fb.trauma >= 0 && fb.trauma <= 1 &&
    fb.hitStop >= 0 && fb.hitStop <= 0.15 &&
    fb.flash >= 0 && fb.flash <= 0.2));
check('feedback tiers match the game-feel skill ranges',
  FEEDBACK_TIERS.small.trauma[0] === 0.1 && FEEDBACK_TIERS.small.trauma[1] === 0.2 && FEEDBACK_TIERS.small.hitStop === 0 &&
  FEEDBACK_TIERS.medium.trauma[0] === 0.3 && FEEDBACK_TIERS.medium.trauma[1] === 0.5 &&
  FEEDBACK_TIERS.medium.hitStop[0] === 0.04 && FEEDBACK_TIERS.medium.hitStop[1] === 0.06 &&
  FEEDBACK_TIERS.large.trauma[0] === 0.7 && FEEDBACK_TIERS.large.trauma[1] === 1.0 &&
  FEEDBACK_TIERS.large.hitStop[0] === 0.1 && FEEDBACK_TIERS.large.hitStop[1] === 0.15);
check('every feedback event sits inside its tier (trauma within the matching tier band)',
  FEEDBACK.latch.trauma <= FEEDBACK_TIERS.small.trauma[1] &&
  FEEDBACK.pump.trauma <= FEEDBACK_TIERS.small.trauma[1] &&
  FEEDBACK.release.trauma <= FEEDBACK_TIERS.medium.trauma[1] &&
  FEEDBACK.fall.trauma >= FEEDBACK_TIERS.medium.trauma[0] && FEEDBACK.fall.trauma <= FEEDBACK_TIERS.medium.trauma[1] &&
  FEEDBACK.fall.hitStop >= FEEDBACK_TIERS.medium.hitStop[0] && FEEDBACK.fall.hitStop <= FEEDBACK_TIERS.medium.hitStop[1] &&
  FEEDBACK.summit.trauma >= FEEDBACK_TIERS.large.trauma[0] && FEEDBACK.summit.hitStop >= FEEDBACK_TIERS.large.hitStop[0]);
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
