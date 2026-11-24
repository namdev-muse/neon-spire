// Neon Spire v0.1.0 — bot harness gates.
// The decision bot must clear every climb with real latch/pump/release
// timing; the bots that must lose (hold grapple forever, no input, random)
// must lose on every climb. If a hold-one-button bot clears a climb,
// the climb is not done.
import { CLIMBS, simulateRun } from '../physics.js';

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

if (failed > 0) {
  console.error(`bot gates: ${failed} FAILED`);
  process.exit(1);
}
console.log('bot gates: all pass');
