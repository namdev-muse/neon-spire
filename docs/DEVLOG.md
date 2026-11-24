# Neon Spire — devlog

## v0.2.1 — M2 hotfix (same run, Tue 2026-11-24 ~16:30 +07)

Live playtest of v0.2.0 found one real defect: Try Again was dead after losing a deep-linked locked climb (`?climb=12`). Root cause: the retry buttons (Try Again, Climb Again, pause Restart, R) called `startClimb(id)` with `viaParam=false`, so the retry re-checked the lock the deep link had bypassed — the denied toast fired behind the Climb Lost panel and nothing happened. Fix: in-run retry/restart passes `viaParam=true` — the lock gates menu entry only; once you are playing a climb, retrying it is not a new entry. Also fixed two cosmetics from the same playtest: the game-over panel could read "Reached -1m" (maxHeight starts at −0.5; now clamped to ≥ 0) and the "Fell back to the checkpoint" toast lingered over the game-over panel (endClimb now clears transient UI state on run end — Talon lesson). Regression test added to the render check: force a loss on `?climb=12`, assert the panel shows a non-negative height, the toast is cleared, and Try Again restarts climb 12 fresh.

## v0.2.0 — M2 climb craft (milestone run, Tue 2026-11-24 15:30 +07)

12 hand-crafted climbs (was 3): Verdant Rise 118m, Ember Stair 124m, Rose Circuit 150m, Tideglass 159m, Azure Spiral 176m, Crimson Gate 186m, Golden Helix 196m, Frost Veil 206m, Void Crown 216m — each with its own identity (distinct ring layout, gap pattern and accent). Heights 60→216m, rings 7→23, par times retuned from measured decision-bot times (par ≈ 3.5× bot time). Render check now asserts 12 climb cards (11 locked on a fresh save) and `?climb=12` reaching Void Crown.

### Tuning found by probe (6 iterations)

1. First bot run: decision bot stalled on climb 5 (Ember Stair) at ring 4 for the full 400s — the climber hung motionless at 74° from vertical. Root cause, a real physics artifact: at a high angle the pump's tangential push (17) exactly balances gravity's tangential pull, and the rope constraint kills the radial component, so a constant pump pins the climber sideways. A human would pump the other way; the bot pumped +1 forever. Fix (physics): the decision bot pumps toward the next ring when the swing is dead (|swingSpeed| ≤ 0.4) instead of always +1. Climb 5 then clears in 36.7s.
2. Curve gate failed: times 11.8/16.3/21.7/28.7/36.7/31.7/29.5/55.4/46.3/44.8/51.7/58.9 — climbs 6–7 and 9–10 were faster than their predecessors. Root cause: per-transfer cost is set by gap geometry, not ring count — near-vertical steps (dx ≤ 2, dy 10) cost ~6s of pumping each, wide reversals (dx 8–10) ~4s, narrow zigzags ~2s, and the bot skips rings on wide reversals. Fixes: dy=8 on same-side steps (climb 5), wider lateral on Tideglass, spiral rebuilt with dy=8 drift steps, climbs 9–12 rescaled to 186/196/206/216m.
3. Second curve failure: 36.4/32.3/47.8/55.4/46.3/44.8 — climb 6 skipped 5 of 15 rings, climb 7's wide reversals were slow. Fixes: climb 6 +2 rings (18, gaps ~9m), climb 7 narrowed to ±3 (dx ≤ 6), climb 10 dy=12 steps eased, climb 11 gaps widened.
4. Third curve failure: 38.6/31.0/39.7/52.8/58.2/55.0/56.5 — climb 7's ±3 column was bot-fast (16 latches, 1.9s/transfer) and the top was compressed. Fixes: climb 7 back to ±3–4 (dx 7–8, dy 9 on the wide steps), climb 8 +2 rings, climb 11 +2 rings, climb 12 +1 ring.
5. Fourth curve failure: 47.7/39.4/52.8/58.2/46.9/60.6 — denser rings made climbs 8 and 11 FASTER (smaller gaps = faster transfers + more skipping). Lesson: gap size, not ring count, is the slow lever. Fixes: climb 8 rebuilt at 18 rings with dy=10–11 on the near-vertical steps, climb 11 rebuilt as wide ±5–6 reversals with dy 11.
6. Fifth run: climb 11 stalled (400s) and smoke failed — the dx=12/dy=11 reversals (diagonal 16.3) are beyond the bot's release geometry and beyond the smoke gap limit. Fix: climb 11 back to ±5 reversals (dx 10, dy 11 — the proven Crimson Gate pattern), climb 10's dy=12 step eased to dy=11. Final curve: 11.77/16.27/21.7/28.72/36.42/38.57/47.65/50.1/52.83/58.17/58.27/60.48 — strictly increasing, decision bot clears all 12 with 0 falls, hold/none/random lose all 12. Climb 10→11 is only +0.1s on the bot's clock; the human will feel climb 11 as harder through its wider reversals and taller gaps, but the bot-time margin there is thin (logged in README known issues).

### Test totals

- Smoke: **65/65 PASS**.
- Bot gates: **all pass** — decision clears 12/12 (0 falls), hold loses 12/12 (max height 4.5m), no-input loses 12/12 (5 falls), random loses 12/12; clear time grows with climb number.
- Render check (headless Chromium): **PASS** — menu + live demo, no version text, Play primary, 12 climb cards (11 locked on a fresh save), screen-space pump, release/re-latch, autopilot clears climb 1 live (20.8s, 2 falls under slow frames), no-input falls + respawn, 5 falls lose, pause focuses Resume + Enter resumes, R restarts, shake 0 suppresses trauma, rest state clean (trauma 0, FOV 62, timeScale 1), `?climb=3` reaches Vortex Crown, `?climb=12` reaches Void Crown, zero console/page errors.
- Size sweep: **PASS** — 1280x720, 2560x1080, 1080x2340, menu + gameplay at each size, all 6 shots inspected by eye. All 12 climb cards fit the menu grid at every size with no clipping; HUD fits at every size. Portrait gameplay keeps the known large vertical empty bands (M5 item).

### Carried to M3 / M5

- Portrait framing leaves large vertical empty bands (M5 item).
- Music/SFX never had a human-ear check (M3/M5 item).

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
