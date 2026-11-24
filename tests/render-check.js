// Neon Spire v0.4.0 — headless browser render check.
// Serves the game dir over local HTTP, loads it in a headless
// browser, and asserts the M1 core, by hook and by eye:
//   - the menu renders over a LIVE 3D scene (the attract demo
//     actually climbs — the demo run advances), with no
//     version/engine text anywhere the player can see, one clear
//     primary Play action, and 12 climb cards (climb 1 unlocked,
//     climb 2 locked on a fresh save)
//   - Play starts climb 1 with the HUD; the climber hangs from ring 0
//   - pumping is asserted in SCREEN space: ArrowLeft moves the
//     climber LEFT on screen relative to the spire (the Drift M2
//     lesson — a mirrored input bug survived every world-space test)
//   - releasing Space detaches the rope; holding Space again latches
//     a ring mid-flight
//   - the autopilot (decision bot) clears climb 1 in the real browser
//   - with no input the climber falls and respawns at the checkpoint
//     (falls increment), and 5 falls lose the climb
//   - pause focuses Resume; Enter resumes; R restarts
//   - shake 0 suppresses trauma; the rest state settles clean
//     (trauma 0, FOV 62, time scale 1, FOV dip 0, camera snap 0)
//   - M3 feel: pumping fires its feedback bundle (pump ticks on pump
//     edges while swinging with the motion); the swing meter tracks
//     swing energy; generative music is active after Play; the
//     accessibility toggles work (reduce-flashing, text size, high
//     contrast) and restore cleanly
//   - ?climb=3 reaches climb 3 and ?climb=12 reaches climb 12 (public unlock/seed path — Apex lesson)
//   - the canvas pixels actually change during a run
//   - zero console errors and zero page errors, and a WebGL context exists
//
// Run: node tests/render-check.js
//
// CDN note: the repo pins Three.js 0.160.0 from jsdelivr and does NOT
// vendor it. The sandboxed browser cannot reach the jsdelivr CDN (the VM
// egress proxy answers policy_denied to every non-curl/wget client,
// including Chromium), even though curl gets HTTP 200 for the pinned
// URL from this VM. So this check downloads the pinned module with
// curl into the OS temp dir and fulfils that one request locally via
// page.route. The shipped game still loads Three.js from the CDN.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';

const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = path.join(os.tmpdir(), 'neon-spire-render-check');
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
const THREE_CACHE = path.join(os.tmpdir(), 'neon-spire-three-0.160.0.module.js');

async function fetchThreeModule() {
  try {
    const st = fs.statSync(THREE_CACHE);
    if (st.size > 100000) return THREE_CACHE;
  } catch { /* not cached yet */ }
  await new Promise((resolve, reject) => {
    execFile('curl', ['-s', '-o', THREE_CACHE, THREE_URL], (err) => (err ? reject(err) : resolve()));
  });
  const st = fs.statSync(THREE_CACHE);
  if (st.size < 100000) throw new Error(`downloaded Three.js module is unexpectedly small (${st.size} bytes)`);
  return THREE_CACHE;
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

function findHeadlessShell() {
  const base = path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    for (const entry of fs.readdirSync(base)) {
      const candidate = path.join(base, entry, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch { /* cache dir missing */ }
  return null;
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.join(GAME_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(GAME_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const require = createRequire(import.meta.url);
const playwrightPath = fileURLToPath(new URL('../../neon-hexfall/node_modules/playwright-core', import.meta.url));
const { chromium } = require(playwrightPath);
const executablePath = findHeadlessShell();
console.log('render-check: chromium executable:', executablePath || '(playwright default)');

const errors = [];
const T0 = Date.now();
const stamp = () => ((Date.now() - T0) / 1000).toFixed(1) + 's';
let browser;
try {
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    timezoneId: 'Asia/Bangkok',
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(stamp() + ' console: ' + msg.text()); });
  page.on('pageerror', (err) => errors.push(stamp() + ' pageerror: ' + String(err)));

  if (!process.env.NO_THREE_CACHE) {
    const cached = await fetchThreeModule();
    console.log(`render-check: fulfilling pinned three@0.160.0 from local curl cache (${cached}) — sandboxed browser cannot reach jsdelivr directly`);
    await page.route(THREE_URL, (route) => route.fulfill({ path: cached }));
  }

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });

  try {
    await page.waitForFunction(() => window.__spire, null, { timeout: 30000 });
  } catch {
    console.error('render-check: window.__spire never appeared — the pinned Three.js module failed to load.');
    console.error('CDN check from this VM: curl -sI ' + THREE_URL + ' (expect HTTP 200).');
    throw new Error('game module did not initialise (see CDN note above)');
  }

  const version = await page.evaluate(() => window.__spire.version);
  if (version !== '0.4.0') throw new Error(`expected version 0.4.0, got ${version}`);
  console.log('render-check: game module initialised, version 0.4.0');

  // WebGL context exists and the canvas is on screen.
  const gl = await page.evaluate(() => {
    const canvas = document.querySelector('#game-container canvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return ctx ? { width: canvas.width, height: canvas.height } : null;
  });
  if (!gl) throw new Error('no WebGL context on the game canvas');
  console.log(`render-check: WebGL context live (${gl.width}x${gl.height} canvas)`);

  // The menu: title, one primary Play, 12 climb cards, NO version/engine
  // text anywhere the player can see. Climb 1 unlocked, climb 2 locked.
  const menuText = await page.textContent('#menu');
  if (!menuText.includes('NEON SPIRE')) throw new Error('menu title missing');
  if (menuText.includes('v0.4.0') || menuText.includes('Three.js') || menuText.includes('0.160.0')) {
    throw new Error('menu shows version/engine text — it must live in the README only');
  }
  const playClass = await page.getAttribute('#btn-play', 'class');
  if (!playClass || !playClass.includes('primary')) throw new Error('Play is not the primary action');
  // M4: the Endless Ascent button is a SECONDARY action — Play stays
  // the one primary — and the menu shows the endless best line.
  const endlessClass = await page.getAttribute('#btn-endless', 'class');
  if (!endlessClass || endlessClass.includes('primary')) throw new Error('Endless Ascent must be a secondary button, not primary');
  const endlessLabel = await page.textContent('#btn-endless');
  if (!endlessLabel.includes('Endless Ascent')) throw new Error(`Endless button label wrong: ${endlessLabel}`);
  const endlessBestLine = await page.textContent('#menu-endless-best');
  if (!endlessBestLine.includes('Endless Ascent')) throw new Error(`endless best line missing on a fresh save: ${endlessBestLine}`);
  console.log(`render-check: Endless Ascent is a secondary menu action (best line: "${endlessBestLine.trim()}")`);
  const climbCards = await page.locator('#climb-select .track-card').count();
  if (climbCards !== 12) throw new Error(`expected 12 climb cards, got ${climbCards}`);
  const climbs = await page.evaluate(() => window.__spire.climbs.map((c) => c.name));
  if (climbs.length !== 12 || climbs[0] !== 'First Light' || climbs[11] !== 'Void Crown') {
    throw new Error(`climb list wrong: ${JSON.stringify(climbs)}`);
  }
  const unlocked = await page.evaluate(() => window.__spire.save.unlocked);
  if (unlocked !== 1) throw new Error(`fresh save should unlock only climb 1, got ${unlocked}`);
  const lockedCards = await page.locator('#climb-select .track-card:disabled').count();
  if (lockedCards !== 11) throw new Error(`expected 11 locked climb cards on a fresh save, got ${lockedCards}`);
  console.log('render-check: menu renders — live 3D behind it, no version text, Play primary, 12 climbs, climb 1 unlocked only');

  // M3: the accessibility toggles work and restore cleanly.
  await page.click('#btn-settings');
  await page.waitForFunction(() => !document.getElementById('settings').classList.contains('hidden'), null, { timeout: 5000 });
  await page.check('#reduce-flashing');
  const flashOff = await page.evaluate(() => window.__spire.state.flash);
  if (flashOff !== false) throw new Error('reduce-flashing should turn state.flash off');
  await page.selectOption('#text-size-select', '1.2');
  const fsLarge = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  if (!(fsLarge > 16)) throw new Error(`text size Large should grow the root font, got ${fsLarge}px`);
  await page.check('#high-contrast-toggle');
  const hc = await page.evaluate(() => document.body.classList.contains('high-contrast'));
  if (!hc) throw new Error('high-contrast toggle should add the high-contrast class');
  await page.uncheck('#reduce-flashing');
  await page.selectOption('#text-size-select', '1');
  await page.uncheck('#high-contrast-toggle');
  const flashBack = await page.evaluate(() => window.__spire.state.flash);
  if (flashBack !== true) throw new Error('unchecking reduce-flashing should restore flash');
  const fsBack = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  if (Math.abs(fsBack - 16) > 0.5) throw new Error(`text size should restore to 16px, got ${fsBack}px`);
  const hcBack = await page.evaluate(() => document.body.classList.contains('high-contrast'));
  if (hcBack) throw new Error('high-contrast toggle should remove the class when unchecked');
  await page.click('#btn-settings-close');
  await page.waitForFunction(() => document.getElementById('settings').classList.contains('hidden'), null, { timeout: 5000 });
  console.log('render-check: accessibility toggles work — reduce-flashing, text size, high contrast, all restored');

  // The attract demo climbs behind the menu: the demo run advances.
  const demo0 = await page.evaluate(() => window.__spire.info());
  if (!demo0) throw new Error('no demo info in the menu phase');
  await page.waitForFunction((t0) => {
    const i = window.__spire.info();
    return i && i.time > t0 + 5;
  }, demo0.time, { timeout: 60000 });
  const demo1 = await page.evaluate(() => window.__spire.info());
  console.log(`render-check: attract demo alive — demo climber swinging (t ${demo0.time.toFixed(1)} -> ${demo1.time.toFixed(1)}, height ${demo1.maxHeight.toFixed(1)}m)`);

  // Menu screenshot for the by-eye check.
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOTS_DIR, 'menu-1280x720.png'), timeout: 60000 });
  console.log(`render-check: menu screenshot saved to ${SHOTS_DIR}/menu-1280x720.png — INSPECT BY EYE (live 3D scene, no clipped cards)`);

  // PLAY starts climb 1 with the HUD; the climber hangs from ring 0.
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__spire.phase === 'playing', null, { timeout: 5000 });
  if (!await page.isVisible('#hud')) throw new Error('HUD not visible after PLAY');
  const hudClimb = await page.textContent('#hud-climb');
  if (!hudClimb.includes('First Light')) throw new Error(`expected climb 1 First Light, got: ${hudClimb}`);
  const startInfo = await page.evaluate(() => window.__spire.info());
  if (startInfo.attached !== 0) throw new Error(`climber should start latched to ring 0, got attached=${startInfo.attached}`);
  console.log('render-check: PLAY starts climb 1 (First Light), HUD visible, climber latched to ring 0');

  // M3: the generative music starts with the climb.
  const musicActive = await page.evaluate(() => window.__spire.state.musicActive);
  if (!musicActive) throw new Error('music should be active after Play');
  console.log('render-check: generative music active after Play');

  // Pumping is asserted in SCREEN space: ArrowLeft must move the
  // climber LEFT on screen relative to the spire axis. The camera
  // follows the player, so the raw screen x barely moves — the
  // climber-vs-spire offset is the real screen-space signal.
  // Hold Space (grapple) + ArrowLeft (pump) and poll for the offset
  // to swing 20px left.
  const relX0 = await page.evaluate(() => {
    const i = window.__spire.info();
    return i.screen.x - i.spireScreen.x;
  });
  await page.keyboard.down('Space');
  await page.keyboard.down('ArrowLeft');
  try {
    await page.waitForFunction((x0) => {
      const i = window.__spire.info();
      return i && (i.screen.x - i.spireScreen.x) < x0 - 20;
    }, relX0, { timeout: 30000 });
  } finally {
    await page.keyboard.up('ArrowLeft');
  }
  const relX1 = await page.evaluate(() => {
    const i = window.__spire.info();
    return i.screen.x - i.spireScreen.x;
  });
  console.log(`render-check: ArrowLeft pumps the climber left on screen vs the spire (offset ${relX0.toFixed(0)} -> ${relX1.toFixed(0)})`);

  // M3: pumping fires its feedback bundle — a pump tick on each pump
  // direction edge while swinging WITH the motion — and the swing
  // meter tracks the energy. Flip the pump direction several times
  // while grappled (Space is still held); at least one edge must land
  // with the swing. Sampling the meter as a max over 2s, not an
  // instant read: swing energy crosses zero at each arc extreme.
  const ticks0 = await page.evaluate(() => window.__spire.info().pumpTicks);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(700);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(700);
    await page.keyboard.up('ArrowLeft');
  }
  const ticks1 = await page.evaluate(() => window.__spire.info().pumpTicks);
  if (ticks1 <= ticks0) throw new Error(`pump edges should fire pump feedback ticks, got ${ticks0} -> ${ticks1}`);
  console.log(`render-check: pump feedback fires on pump edges (ticks ${ticks0} -> ${ticks1})`);
  let maxEnergy = 0;
  for (let i = 0; i < 10; i++) {
    const e = await page.evaluate(() => window.__spire.info().swingEnergy);
    maxEnergy = Math.max(maxEnergy, e);
    await page.waitForTimeout(200);
  }
  if (maxEnergy <= 0.15) throw new Error(`swing energy should build while pumping, max sampled ${maxEnergy}`);
  const meterW = await page.evaluate(() => document.getElementById('hud-swing-fill').style.width);
  if (!meterW || parseFloat(meterW) <= 0) throw new Error(`swing meter should show energy, fill width is ${meterW}`);
  console.log(`render-check: swing meter tracks swing energy (max ${maxEnergy.toFixed(2)}, fill ${meterW})`);

  // Release: letting go of Space detaches the rope; holding Space
  // again latches a ring mid-flight.
  await page.keyboard.up('Space');
  await page.waitForFunction(() => {
    const i = window.__spire.info();
    return i && i.attached === null;
  }, null, { timeout: 5000 });
  console.log('render-check: releasing Space detaches the rope (airborne)');
  await page.keyboard.down('Space');
  await page.waitForFunction(() => {
    const i = window.__spire.info();
    return i && i.attached !== null;
  }, null, { timeout: 10000 });
  await page.keyboard.up('Space');
  const relatch = await page.evaluate(() => window.__spire.info());
  console.log(`render-check: holding Space again latches a ring mid-flight (attached=${relatch.attached})`);

  // Shake 0 suppresses trauma: latch while shake is 0, trauma stays 0.
  // (First let leftover trauma from the release/re-latch above settle.)
  await page.evaluate(() => window.__spire.setShake(0));
  await page.waitForFunction(() => window.__spire.info().trauma === 0, null, { timeout: 30000 });
  const latches0 = await page.evaluate(() => window.__spire.info().latches);
  await page.evaluate(() => window.__spire.autopilot(true));
  await page.waitForFunction((l0) => window.__spire.info().latches > l0, latches0, { timeout: 60000 });
  const trauma0 = await page.evaluate(() => window.__spire.info().trauma);
  if (trauma0 !== 0) throw new Error(`shake 0 should suppress trauma, got ${trauma0}`);
  await page.evaluate(() => window.__spire.setShake(100));
  console.log('render-check: shake 0 suppresses trauma (0 after a latch)');

  // The autopilot (decision bot) clears climb 1 in the real browser.
  await page.waitForFunction(() => window.__spire.phase === 'complete', null, { timeout: 180000 });
  const clearInfo = await page.evaluate(() => window.__spire.info());
  console.log(`render-check: autopilot cleared climb 1 live (score ${clearInfo.score}, time ${clearInfo.time}s, falls ${clearInfo.falls})`);
  if (!await page.isVisible('#complete')) throw new Error('complete screen not visible after the clear');
  const completeText = await page.textContent('#complete');
  if (!completeText.includes('Summit Reached')) throw new Error('complete screen title wrong');
  console.log('render-check: Summit Reached screen shows with score + rank');

  // Back to the menu, then start climb 1 again with NO input: the
  // climber releases, falls, and respawns at the checkpoint.
  // M4: the climb-1 card shows the rank badge earned by the clear.
  await page.click('#btn-menu-complete');
  await page.waitForFunction(() => window.__spire.phase === 'menu', null, { timeout: 5000 });
  const rankBadge = await page.locator('#climb-select .track-card').first().locator('.tc-rank').textContent().catch(() => null);
  if (!rankBadge || !/^[SAB]$/.test(rankBadge.trim())) throw new Error(`climb-1 card should show a rank badge after the clear, got: ${rankBadge}`);
  const savedRank = await page.evaluate(() => window.__spire.save.best[1] && window.__spire.save.best[1].rank);
  console.log(`render-check: climb-1 card shows rank badge "${rankBadge.trim()}" (saved rank ${savedRank})`);
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__spire.phase === 'playing', null, { timeout: 5000 });
  await page.waitForFunction(() => {
    const i = window.__spire.info();
    return i && i.falls >= 1;
  }, null, { timeout: 60000 });
  const fallInfo = await page.evaluate(() => window.__spire.info());
  console.log(`render-check: no-input climber falls and respawns at the checkpoint (falls ${fallInfo.falls})`);
  // 5 falls lose the climb (no input keeps releasing after every respawn).
  await page.waitForFunction(() => window.__spire.phase === 'gameover', null, { timeout: 120000 });
  if (!await page.isVisible('#gameover')) throw new Error('game-over screen not visible after 5 falls');
  console.log('render-check: 5 falls lose the climb — Climb Lost screen shows');

  // Pause focuses Resume; Enter resumes; R restarts.
  await page.click('#btn-retry');
  await page.waitForFunction(() => window.__spire.phase === 'playing', null, { timeout: 5000 });
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__spire.phase === 'paused', null, { timeout: 5000 });
  if (!await page.isVisible('#pause')) throw new Error('pause screen not visible');
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
  if (focused !== 'btn-resume') throw new Error(`pause should focus Resume, focused ${focused}`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__spire.phase === 'playing', null, { timeout: 5000 });
  console.log('render-check: pause focuses Resume, Enter resumes');
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(500);
  const afterRestart = await page.evaluate(() => window.__spire.info());
  if (afterRestart.time > 2 || afterRestart.falls !== 0) throw new Error(`R should restart the climb (time ${afterRestart.time}, falls ${afterRestart.falls})`);
  console.log('render-check: R restarts the climb');

  // The canvas must actually update during a run.
  const shotA = await page.screenshot({ timeout: 60000 });
  await page.waitForTimeout(1000);
  const shotB = await page.screenshot({ timeout: 60000 });
  if (shotA.equals(shotB)) throw new Error('canvas did not change between two screenshots during a run — the render loop may be frozen');
  console.log('render-check: canvas updates during a run (two screenshots differ)');

  // Gameplay screenshot for the by-eye check.
  await page.evaluate(() => window.__spire.autopilot(true));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(SHOTS_DIR, 'gameplay-1280x720.png'), timeout: 60000 });
  console.log(`render-check: gameplay screenshot saved to ${SHOTS_DIR}/gameplay-1280x720.png — INSPECT BY EYE (3D depth, spire, HUD)`);
  await page.evaluate(() => window.__spire.autopilot(false));

  // Rest state settles clean (trauma 0, FOV 62, time scale 1, FOV dip 0, camera snap 0).
  await page.evaluate(() => window.__spire.quitToMenu());
  await page.waitForTimeout(1500);
  const rest = await page.evaluate(() => window.__spire.info());
  if (rest.trauma !== 0) throw new Error(`rest state trauma should be 0, got ${rest.trauma}`);
  if (Math.abs(rest.fov - 62) > 0.5) throw new Error(`rest state FOV should be 62, got ${rest.fov}`);
  if (rest.timeScale !== 1) throw new Error(`rest state timeScale should be 1, got ${rest.timeScale}`);
  if (rest.fovDip !== 0) throw new Error(`rest state fovDip should be 0, got ${rest.fovDip}`);
  if (rest.camSnapT !== 0) throw new Error(`rest state camSnapT should be 0, got ${rest.camSnapT}`);
  console.log('render-check: rest state clean (trauma 0, FOV 62, timeScale 1, fovDip 0, camSnapT 0)');

  // M4: Endless Ascent from the menu button. The HUD shows the mode
  // and a bare height (no total — there is no summit), the climber
  // starts latched to ring 0, and the autopilot climbs it live.
  await page.click('#btn-endless');
  await page.waitForFunction(() => window.__spire.phase === 'playing', null, { timeout: 5000 });
  const endlessInfo = await page.evaluate(() => window.__spire.info());
  if (!endlessInfo.endless || endlessInfo.climbName !== 'Endless Ascent') {
    throw new Error(`Endless button should start Endless Ascent, got ${JSON.stringify({ endless: endlessInfo.endless, name: endlessInfo.climbName })}`);
  }
  if (endlessInfo.attached !== 0) throw new Error(`endless climber should start latched to ring 0, got attached=${endlessInfo.attached}`);
  const endlessHudClimb = await page.textContent('#hud-climb');
  if (!endlessHudClimb.includes('Endless Ascent')) throw new Error(`endless HUD should name the mode, got: ${endlessHudClimb}`);
  const endlessHudHeight = await page.textContent('#hud-height');
  if (!/^Height \d+m$/.test(endlessHudHeight.trim())) throw new Error(`endless HUD height should be a bare height, got: ${endlessHudHeight}`);
  console.log('render-check: Endless Ascent starts from the menu button (HUD names the mode, climber latched to ring 0)');
  await page.evaluate(() => window.__spire.autopilot(true));
  await page.waitForFunction(() => {
    const i = window.__spire.info();
    return i && i.maxHeight >= 25;
  }, null, { timeout: 90000 });
  const endlessClimb = await page.evaluate(() => window.__spire.info());
  console.log(`render-check: autopilot climbs Endless Ascent live (height ${endlessClimb.maxHeight}m, score ${endlessClimb.score})`);
  await page.evaluate(() => window.__spire.autopilot(false));
  // Quitting to the menu from an endless run banks the best height.
  await page.evaluate(() => window.__spire.quitToMenu());
  await page.waitForFunction(() => window.__spire.phase === 'menu', null, { timeout: 5000 });
  const bankedBest = await page.evaluate(() => window.__spire.save.endlessBest);
  if (!bankedBest || !(bankedBest.height > 0)) throw new Error(`quitting an endless run should bank a best height, got ${JSON.stringify(bankedBest)}`);
  const menuEndlessBest = await page.textContent('#menu-endless-best');
  if (!menuEndlessBest.includes(`Endless best: ${bankedBest.height}m`)) throw new Error(`menu endless best line should show the banked height, got: ${menuEndlessBest}`);
  console.log(`render-check: quitting Endless Ascent banks the best height (${bankedBest.height}m) and the menu shows it`);

  // ?endless=<seed> deep-links straight into that seeded climb.
  await page.goto(`http://127.0.0.1:${port}/?endless=20261124`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__spire && window.__spire.phase === 'playing', null, { timeout: 30000 });
  const deepEndless = await page.evaluate(() => window.__spire.info());
  if (!deepEndless.endless || deepEndless.climbName !== 'Endless Ascent' || deepEndless.endlessSeed !== 20261124) {
    throw new Error(`?endless=20261124 should start seed 20261124, got ${JSON.stringify({ endless: deepEndless.endless, name: deepEndless.climbName, seed: deepEndless.endlessSeed })}`);
  }
  console.log('render-check: ?endless=20261124 jumps straight into the seeded endless climb');
  // ?endless=1 starts today's seeded climb.
  await page.goto(`http://127.0.0.1:${port}/?endless=1`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__spire && window.__spire.phase === 'playing', null, { timeout: 30000 });
  const todayEndless = await page.evaluate(() => {
    const i = window.__spire.info();
    const d = new Date();
    const today = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    return { endless: i.endless, seed: i.endlessSeed, today };
  });
  if (!todayEndless.endless || todayEndless.seed !== todayEndless.today) {
    throw new Error(`?endless=1 should start today's seed ${todayEndless.today}, got ${todayEndless.seed}`);
  }
  console.log(`render-check: ?endless=1 starts today's seeded climb (seed ${todayEndless.seed})`);

  // ?climb=3 reaches climb 3 (public unlock/seed path — Apex lesson).
  await page.goto(`http://127.0.0.1:${port}/?climb=3`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__spire && window.__spire.phase === 'playing', null, { timeout: 30000 });
  const climb3 = await page.evaluate(() => window.__spire.info());
  if (climb3.climbId !== 3 || climb3.climbName !== 'Vortex Crown') {
    throw new Error(`?climb=3 should start Vortex Crown, got ${JSON.stringify({ id: climb3.climbId, name: climb3.climbName })}`);
  }
  console.log('render-check: ?climb=3 jumps straight into Vortex Crown (unlock path works)');

  // ?climb=12 reaches the last climb (Void Crown) — the M2 set must be
  // reachable through the same public unlock path.
  await page.goto(`http://127.0.0.1:${port}/?climb=12`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__spire && window.__spire.phase === 'playing', null, { timeout: 30000 });
  const climb12 = await page.evaluate(() => window.__spire.info());
  if (climb12.climbId !== 12 || climb12.climbName !== 'Void Crown') {
    throw new Error(`?climb=12 should start Void Crown, got ${JSON.stringify({ id: climb12.climbId, name: climb12.climbName })}`);
  }
  console.log('render-check: ?climb=12 jumps straight into Void Crown (unlock path reaches the last climb)');

  // Regression: Try Again after losing a deep-linked LOCKED climb.
  // The retry buttons must restart the climb you are already in — the
  // lock gates menu entry only. Before the fix, Try Again re-checked
  // the lock the deep link had bypassed, so the Climb Lost panel just
  // stayed. Also asserts the game-over height never goes negative
  // (maxHeight starts at -0.5) and the fall toast is cleared on run end.
  await page.evaluate(() => { window.__spire.run.falls = 4; });
  await page.waitForFunction(() => window.__spire.phase === 'gameover', null, { timeout: 60000 });
  if (!await page.isVisible('#gameover')) throw new Error('game-over screen not visible after the forced loss on climb 12');
  const overText = await page.textContent('#gameover-detail');
  if (overText.includes('-1m')) throw new Error(`game-over height must not go negative, got: ${overText}`);
  const toastHidden = await page.evaluate(() => !document.getElementById('hud-toast').classList.contains('show'));
  if (!toastHidden) throw new Error('fall toast must be cleared when the run ends');
  await page.click('#btn-retry');
  await page.waitForFunction(() => window.__spire.phase === 'playing', null, { timeout: 5000 });
  const retryInfo = await page.evaluate(() => window.__spire.info());
  if (retryInfo.climbId !== 12 || retryInfo.falls !== 0) throw new Error(`Try Again should restart climb 12 fresh, got ${JSON.stringify({ id: retryInfo.climbId, falls: retryInfo.falls })}`);
  console.log('render-check: Try Again restarts a deep-linked locked climb (retry bypasses the menu lock); game-over height non-negative, toast cleared');

  if (errors.length > 0) {
    console.error('render-check: console/page errors seen:');
    errors.forEach((e) => console.error('  ' + e));
    throw new Error(`${errors.length} console/page error(s) during the check`);
  }
  console.log('render-check: PASS — zero console errors, zero page errors');
} catch (err) {
  console.error('render-check: FAIL —', err.message);
  if (errors.length > 0) errors.forEach((e) => console.error('  ' + e));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}
