// Neon Spire v0.5.0 — bot harness gates.
// The decision bot must clear every climb with real latch/pump/release
// timing; the bots that must lose (hold grapple forever, no input, random)
// must lose on every climb. If a hold-one-button bot clears a climb,
// the climb is not done.
import { CLIMBS, simulateRun, simulateEndless } from '../physics.js';

let failed = 0;
function gate(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failed++;
}

for (const climb of CLIMBS) {
  const decision = simulateRun(climb, 'decision');
  gate(
    `decision bot clears climb ${climb.id} (${climb.name})`,
    decision.won,
    `time ${decision.time}s (par ${climb.par}s), maxH ${decision.maxHeight}/${climb.height}, falls ${decision.falls}, latches ${decision.latches}, releases ${decision.releases}, orbs ${decision.orbs}, score ${decision.score}`,
  );
  gate(
    `decision bot clears climb ${climb.id} without falling`,
    decision.won && decision.falls === 0,
    `falls ${decision.falls}`,
  );
  gate(
    `decision bot uses real timing on climb ${climb.id} (multiple swings, not one latch)`,
    decision.won && decision.latches >= 4 && decision.releases >= 4,
    `latches ${decision.latches}, releases ${decision.releases}`,
  );

  const hold = simulateRun(climb, 'hold');
  gate(
    `hold-grapple-forever bot LOSES climb ${climb.id}`,
    !hold.won,
    `maxH ${hold.maxHeight}/${climb.height}, latches ${hold.latches}`,
  );
  gate(
    `hold bot never gets halfway up climb ${climb.id}`,
    hold.maxHeight < climb.height * 0.5,
    `maxH ${hold.maxHeight}`,
  );

  const none = simulateRun(climb, 'none');
  gate(
    `no-input bot LOSES climb ${climb.id}`,
    !none.won && none.lost,
    `lost=${none.lost}, falls ${none.falls}, time ${none.time}s`,
  );

  const random = simulateRun(climb, 'random');
  gate(
    `random-input bot LOSES climb ${climb.id}`,
    !random.won,
    `maxH ${random.maxHeight}/${climb.height}, falls ${random.falls}`,
  );
}

// Difficulty curve: the decision bot's clear time grows with climb number
// (later climbs take more real swings, not fewer).
{
  const times = CLIMBS.map((c) => simulateRun(c, 'decision').time);
  gate(
    'decision-bot clear time grows with climb number (real curve, no cliff)',
    times.every((t, i) => i === 0 || t > times[i - 1]),
    `times ${times.join('s, ')}s`,
  );
}

// Endless Ascent gates (M4): the decision bot climbs far on the
// fixed seed; the bots that must lose stay near the base. An endless
// climb never wins — there is no summit ring.
{
  const seed = 20261124;
  const decision = simulateEndless(seed, 'decision');
  gate(
    'endless decision bot reaches >= 100m on seed 20261124',
    decision.maxHeight >= 100,
    `maxH ${decision.maxHeight}, latches ${decision.latches}, falls ${decision.falls}, time ${decision.time}s`,
  );
  gate(
    'endless decision bot never wins (no summit)',
    !decision.won,
    `won=${decision.won}`,
  );
  const hold = simulateEndless(seed, 'hold');
  gate(
    'endless hold-grapple-forever bot reaches < 25m',
    hold.maxHeight < 25,
    `maxH ${hold.maxHeight}`,
  );
  const random = simulateEndless(seed, 'random');
  gate(
    'endless random-input bot reaches < 25m and/or loses',
    random.maxHeight < 25 || random.lost,
    `maxH ${random.maxHeight}, lost=${random.lost}`,
  );
}

if (failed > 0) {
  console.error(`bot gates: ${failed} FAILED`);
  process.exit(1);
}
console.log('bot gates: all pass');
