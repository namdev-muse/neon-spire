# Neon Spire — devlog

## v0.5.0 — M5 polish & robustness (milestone run, Tue 2026-11-24 21:30 +07)

A polish pass over the M1–M4 carries — no new climbs, no new modes, no physics changes, no climb-data changes. Every fix is small and surgical.

- **endClimb setTimeout race (real bug, M3 carry).** Losing a climb scheduled `endClimb(false)` 600ms later (900ms on a win) with no handle on the timer: quitting to the menu inside that window let the timeout fire and open the game-over panel over the menu. The timer id now lives on `state.endTimer`, is cleared in `quitToMenu()` and when a new run begins, and `endClimb()` no-ops when the phase is already the menu. Regression test in the render check drives the real loss path, quits inside the window, and asserts the timer is cleared and no game-over panel appears. (The M3 toast-lingering claim was refuted by probe; this one was a real race in the same code path.)
- **HUD pill backdrops (M3 carry).** Each HUD group (`.hud-left` / `.hud-mid` / `.hud-right`) now sits on a subtle semi-transparent panel (blur, border, radius, padding) so the text reads over bright neon rings. Pointer events unchanged — only the buttons take input.
- **Height shows peak (M4 carry).** The HUD height is `maxHeight`, not the current height; it is now labelled honestly: `Peak Xm / Ym` on climbs, `Peak Xm` in Endless Ascent. Render-check regex updated (`/^Peak \d+m$/` for endless, `/^Peak \d+m \/ 60m$/` for climb 1).
- **Game-over dialog layout (M1 carry).** `#gameover-detail` no longer uses the `big-score` class (1.6rem gold) for a full sentence — it has its own class at normal size and weight, so the dialog layout is stable. The complete screen is untouched. Render check asserts the detail's computed font size is normal text.
- **How to Play wording.** The touch line said "tap ◀ / ▶ to pump" — the pump buttons are hold buttons, so it now says "hold ◀ / ▶ to pump". The Controls line now documents mouse-drag pumping ("drag mouse left/right: pump"); mouse grapple was already documented and stays so. README controls updated to match.
- **FPS guard (new, M5 performance scope).** Adapted from Surge's established pattern, minimally: a rolling FPS average in the frame loop; sustained <28fps for 2s steps the renderer pixel ratio down one rung (2 → 1.5 → 1, via `setPixelRatio` + `setSize`) and reduces particle spawn (1 → 0.6 → 0.35). One-way only, never oscillates back up. Antialiasing is untouched (fixed at creation) and physics is untouched. Guard state (`dprCap`, pixel ratio, particle scale, fps) is exposed in `window.__spire.info()` plus a `triggerFpsGuard()` hook; the render check asserts the state is present, the cap steps down on demand, and the renderer keeps working.
- **Climb-5 framing + camera diagonal (M3/M4 cosmetic carry).** A/B probe at the same trigger (autopilot first reaching 20m on climb 5): before, the spire leaned ~25° across the frame and the route above the climber left the frame; the cause was the look target tracking the climber's lateral factor (0.8) while the camera tracked 0.55. One-line fix — the look target now uses the camera's own factor (0.55), so the camera looks straight up the face plane. After: the spire reads as a tower (~8° lean at a wide swing), three rings of the route stay in frame, climber and rope still read clearly. No physics or ring-data change. Screenshots.js now takes a climb-5 framing shot every run.
- **Settings empty area (M3 carry).** Measured, not assumed: at 2560x1080 the settings panel is 680×428 with content height 426 — there is no empty area *inside* the panel; the space around it is the standard centred overlay. The panel still gained one real row: a read-only **Performance** line showing live fps and the FPS guard's render scale (refreshed while Settings is open), which fits M5 and gives the guard a visible readout. Render check asserts the line's format.
- **Transient HUD clip frame (M4 carry).** Not reproduced: the size sweep (14 shots, all three resolutions, menu + settings + gameplay + pause) shows no HUD clipping at any resolution after the backdrop change; the single clipped frame in M4 was a mid-shake transient. Logged as not reproduced.

### Test totals

- Smoke: **102/102 PASS** (unchanged — no physics changes, no new smoke assertions needed; M5 is render-check scope).
- Bot gates: **all pass** — decision clears 12/12 (11.77→60.48s, 0 falls); hold/none/random lose all 12; endless gates unchanged (decision 355.9m, hold 4.5m, random 1.6m).
- Render check (headless Chromium): **PASS** — everything M4 asserted, plus FPS guard present and stepping, Peak label on climb + endless HUD, HUD pill backdrops (computed style), game-over detail at normal text size, settings performance line, endClimb race regression (quit inside the 600ms loss window → menu clean, timer cleared), zero console/page errors.
- Size sweep: **PASS** — 14 shots inspected by eye (menu + settings + gameplay + pause at 1280x720, 2560x1080, 1080x2340, plus endless + climb-5 at 1280x720). No clipping, no overlap, no empty in-panel area; HUD reads at every size; portrait keeps the known large vertical empty bands (carried to M6).
- Firefox cross-browser check: **could not run — environment limit, not a game defect.** The Playwright Firefox build (firefox-1572) launches but cannot create a WebGL context in this VM at all ("AllowWebgl2:false restricts context creation on this system", "Exhausted GL driver options"), even with `webgl.force-enabled` / software-WebGL prefs forced; Chromium works via SwiftShader, Firefox has no software-GL fallback here. The game handles a missing WebGL context gracefully (it shows the in-page "3D graphics couldn't start" message). Firefox on a real machine remains unverified — carried to M6.

### Carried to M6

- Portrait framing leaves large vertical empty bands (same caveat class as Apex/Bastion).
- Music/SFX never had a human-ear check.
- Endless Ascent's live autopilot climb is verified to 25m in the render check; the 100m+ heights are sim-bot evidence only.
- The live playtester has still never completed a ring-to-ring transfer or a full climb in a real browser (tooling ceiling) — transfer evidence is sim bot + live autopilot + CI harness; the rank badge is render-check verified.

## v0.4.0 — M4 progression & depth (milestone run, Tue 2026-11-24 19:30 +07)

Two systems, both complete: a second mode and per-climb ranks.

- **Endless Ascent.** A seeded, scaling, never-ending climb from a secondary menu button (`btn-endless`, Play stays the one primary action). `generateEndlessClimb(seed)` in physics builds ~120 rings deterministically from `mulberry32`: ring(0,2) checkpoint, gaps growing ~9.5m low to ~11.5m high, lateral offsets alternating ±(3–6)m growing slightly, a checkpoint every 7–9 rings, orbs every ~3 rings offset from the ring line, and NO summit ring — an endless climb never wins, it only ends on 5 falls. Best height + score + seed saved in `save.endlessBest` (save version stays 1, key stays `neon-spire-save-v1`), shown under the button ("Endless best: 87m" / "Endless Ascent — no run yet"). Default seed is today's date as YYYYMMDD; `?endless=1` starts today, `?endless=<digits>` starts that seed. The HUD names the mode and shows a bare `Height Xm` (no total — there is no summit); quitting from pause banks the best height first, and the game-over panel shows height reached, "New best!" and the best height. R / pause-Restart / Try Again restart the same endless seed. One real bug found by the smoke suite while building this: `recordBest` replaced the saved entry on a better score *before* reading the saved rank, so a better-score A clear wiped an earlier S — fixed by capturing the rank first.
- **Per-climb clear ranks, saved and visible.** `rankFor` already existed but the rank was never stored and never shown on the cards. `recordBest` now tracks the best rank ever achieved per climb (S > A > B) independently of the score: a better rank upgrades the saved rank even on a lower-score clear, a worse rank never downgrades it. The complete screen shows the rank, the saved best rank, and "New best rank!" on improvement; climb cards show a rank badge (gold S, cyan A, violet B) next to the best score; the menu best line counts S-ranks.
- **Balance gate (fixed seed 20261124, physics untouched).** Decision bot 355.9m (100m reached in 22.8s sim time, worst single-ring dwell 7.4s, 0 falls); hold bot 4.5m; random bot 1.6m, lost. The first generator draft was too wide (diagonals to 18.3m, bot stalled to 144m in 400s) — tuned the generator only (gap 9.5→11.3m, lateral 3–6.5m), never the physics constants; the 12 hand-crafted climbs' bot times are unchanged (11.77→60.48s).

### Test totals

- Smoke: **102/102 PASS** (was 72; +30: endless generation ×9, endless bots ×4, rank persistence ×9, endless best ×8).
- Bot gates: **all pass** — decision clears 12/12 (11.77→60.48s, 0 falls), hold/none/random lose all 12, curve unchanged; endless gates pass (decision 355.9m, hold 4.5m, random 1.6m).
- Render check (headless Chromium): **PASS** — everything M3 asserted, plus Endless Ascent is a secondary menu action with the best line, autopilot climbs Endless Ascent live to 25.5m, quitting banks the best (25m) and the menu shows it, `?endless=20261124` and `?endless=1` deep-link correctly, the climb-1 card shows rank badge "A" after the live clear (autopilot 23.28s, 2 falls under slow frames), zero console/page errors.
- Size sweep: **PASS** — 1280x720, 2560x1080, 1080x2340, menu + gameplay at each size, plus a new Endless Ascent gameplay shot; all 7 shots inspected by eye, `docs/screenshots/` refreshed (menu.png, gameplay.png, endless.png). Portrait menu fits with the known large vertical empty bands (M5 item).

### Carried to M5

- Portrait framing leaves large vertical empty bands (M5 item).
- Music/SFX never had a human-ear check.
- Endless Ascent's live autopilot climb is verified to 25m in the render check; the 100m+ heights are sim-bot evidence only.
- The endClimb setTimeout race (quit within 600ms of losing opens game-over over the menu) is still open — M5 item, deliberately untouched.

## v0.3.0 — M3 feel & juice (milestone run, Tue 2026-11-24 17:30 +07)

A traversal/feedback pass over the whole swing loop — no new climbs, no new modes, just making the existing game feel like a game.

- **Pump feedback finally fires.** `FEEDBACK.pump` existed since M1 but nothing ever called it — the core interaction (pumping) was silent and invisible. Now every pump-direction edge while swinging *with* the motion fires the small bundle: a tick whose pitch rises with swing energy (520→940 Hz), 2 spark particles at the climber, 0.05 trauma. Pumping *against* the swing stays silent — braking should feel like braking. Render check asserts ticks 1→4 across pump flips.
- **Swing-energy readout (Talon lesson).** New `swingEnergy(run)` in physics (0..1, capped by the swing cap): a SWING meter in the HUD, the rope heating cyan→gold with energy, the climber halo swelling with energy. No marker, no cue — it shows how much swing you carry, never when to release. Smoke asserts energy 0 at rest, rising with the swing, capped at 1, 0 while airborne.
- **Generative music.** The static 2-osc pad is now a sequencer: Am–F–C–G at 104 BPM, bass pulse + soft arpeggio scheduled from the frame loop with a 0.25s lookahead on the audio clock. The pad filter opens (420→940 Hz) and the arpeggio lifts an octave past halfway up the climb, so the music climbs with you. Render check asserts music is active after Play.
- **Camera polish.** Latch snap: for 0.18s after a latch the camera locks onto the new anchor much harder than the soft follow, plus a brief FOV dip (−2.4°). Hard latch (|swingSpeed| > 0.7 of cap): 0.04s hit-stop + gold particle burst + low thud on top of the latch bundle.
- **Feedback tier audit.** Smoke now asserts every FEEDBACK entry carries a full bundle (sfx, particles, trauma 0..1, hit-stop 0..0.15, flash 0..0.2) and each event sits inside its game-feel tier. One real fix from the audit: fall trauma was 0.55, above the skill's medium tier (0.30–0.50) — set to 0.5, the tier top.
- **Accessibility toggles verified.** Render check now opens Settings and asserts reduce-flashing turns `state.flash` off, text-size Large grows the root font, high-contrast adds the body class — and all three restore cleanly. Rest-state check extended: FOV dip 0 and camera snap 0 after quit-to-menu.

### Test totals

- Smoke: **72/72 PASS** (was 65; +7: swing energy ×4, feedback completeness ×2, tier bands ×1).
- Bot gates: **all pass** — decision clears 12/12 (11.77→60.48s, 0 falls), hold/none/random lose all 12; curve unchanged (no physics changes beyond the fall-trauma number, which is feel-only).
- Render check (headless Chromium): **PASS** — everything M2 asserted, plus accessibility toggles, generative music active after Play, pump ticks 1→4, swing meter tracking energy (max 0.64 sampled, fill 17% at the sampled instant), autopilot clears climb 1 live (23.72s, 2 falls under slow frames), rest state clean (trauma 0, FOV 62, timeScale 1, fovDip 0, camSnapT 0), zero console/page errors.
- Size sweep: **PASS** — 1280x720, 2560x1080, 1080x2340, menu + gameplay at each size, all 6 shots inspected by eye. HUD fits at every size; the SWING meter reads at every size. Portrait gameplay keeps the known large vertical empty bands (M5 item).

### Carried to M4 / M5

- Portrait framing leaves large vertical empty bands (M5 item).
- Music/SFX never had a human-ear check (the live playtest below is the first ear on the new music).

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
