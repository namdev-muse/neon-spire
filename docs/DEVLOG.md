# Neon Spire — devlog

## v0.1.0 — M1 core (setup run, Tue 2026-11-24 ~11:41–13:00 +07, local tree only)

Grapple-swing core: latch / pump / release / ballistic flight / fall + checkpoint respawn. 3 dense hand-crafted climbs (First Light 60m, Crosswind 84m, Vortex Crown 102m), live animated menu with screen stack and attract demo, Web Audio synth SFX + ambient pad, trauma shake / hit-stop / FOV punch / summit slow-mo, pooled particles, touch controls, `?climb=N` + `?unlock=1` playtest paths (not in the UI).

### Tuning found by probe (3 iterations)

1. First probe: decision bot cleared all 3 but with 5 latches per ring — every release re-caught the ring just left. Fix: 1.2s re-latch lock on the just-released ring.
2. Second probe: highest-in-range latching let the bot skip rings and clear in ~10s. Fix: nearest-in-range latching (you must actually fly to the next ring).
3. Third probe: wider gaps (10m) + range 11 stalled the bot — the swing couldn't reach the next ring's diagonal. Two real bugs found: (a) pumping with no damping spun the climber in full 30 u/s circles around the anchor, so the release window was razor-thin; (b) the 14m diagonal gaps were beyond the swing's reach. Fixes: swing-speed cap 17 + 0.12/s drag (the swing can never loop over the top), range 12, lateral jumps narrowed to ≤10m. Final: decision bot clears in 11.8s / 16.3s / 21.7s with 0 falls; hold/none/random bots lose on every climb.

### Bugs found + fixed during the build

- Insta-release on Play: the run started latched and the first frame released the climber before the player touched a key. Fix (physics): 3s grace after start/respawn — the release is ignored until the player has held grapple once (Orbit lesson: default states must be safe).
- Trauma decay was per-frame, so under slow headless frames the camera stayed shaken off-centre (FOV punch had the same per-frame decay). Fix: both decay in real time (skill rule).
- Two smoke-test expectation bugs (release step also applies gravity/drag/constraint; orb step also latched a ring for +25) — fixed the tests with a twin-run comparison, not the game.

### Test totals

- Smoke: **65/65 PASS** (pendulum, rope constraint, release, latch, gravity, falls/respawn, orbs, determinism, save/ranks, feedback table, grace).
- Bot gates: **all pass** — decision clears 3/3 (11.8s/16.3s/21.7s, 0 falls), hold loses 3/3 (max height 4.5m), no-input loses 3/3 (5 falls), random loses 3/3; clear time grows with climb number.
- Render check (headless Chromium): **PASS** — menu + live demo, no version text, Play primary, climb 1 unlocked only, screen-space pump (ArrowLeft moves the climber left vs the spire), release/re-latch, autopilot clears climb 1 live (20.75s, 2 falls under slow frames), no-input falls + respawn, 5 falls lose, pause focuses Resume + Enter resumes, R restarts, shake 0 suppresses trauma, rest state clean (trauma 0, FOV 62, timeScale 1), `?climb=3` reaches Vortex Crown, zero console/page errors.
- Size sweep: **PASS** — 1280x720, 2560x1080, 1080x2340, menu + gameplay at each size, all 6 shots inspected by eye. No clipped or overlapping elements; HUD fits at every size.

### Carried to M2 / M5

- Portrait framing leaves large vertical empty bands (M5 item).
- Music/SFX never had a human-ear check (M3/M5 item).
- Live autopilot took 2 falls under slow frames while the sim bot takes 0 — watch the grace + release timing on real hardware at the 13:30 live playtest.
