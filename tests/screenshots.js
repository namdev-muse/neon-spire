// Neon Spire v0.4.0 — size sweep: menu + gameplay screenshots at
// 1280x720, 2560x1080 and 1080x2340, for inspection by eye.
// Same serving + Three.js-fulfilment setup as tests/render-check.js.
// Run: node tests/screenshots.js
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';

const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = path.join(os.tmpdir(), 'neon-spire-screenshots');
const DOCS_SHOTS_DIR = path.join(GAME_DIR, 'docs', 'screenshots');
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
  if (st.size < 100000) throw new Error('downloaded Three.js module is unexpectedly small');
  return THREE_CACHE;
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
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

const SIZES = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '2560x1080', width: 2560, height: 1080 },
  { name: '1080x2340', width: 1080, height: 2340 },
];
const errors = [];
let browser;
try {
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const cached = await fetchThreeModule();
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  for (const size of SIZES) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, timezoneId: 'Asia/Bangkok', hasTouch: true });
    const page = await context.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(size.name + ' console: ' + msg.text()); });
    page.on('pageerror', (err) => errors.push(size.name + ' pageerror: ' + String(err)));
    await page.route(THREE_URL, (route) => route.fulfill({ path: cached }));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__spire, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOTS_DIR, `menu-${size.name}.png`), timeout: 60000 });
    console.log(`screenshots: menu-${size.name}.png saved`);
    await page.click('#btn-play');
    await page.waitForFunction(() => window.__spire.phase === 'playing', null, { timeout: 5000 });
    await page.evaluate(() => window.__spire.autopilot(true));
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(SHOTS_DIR, `gameplay-${size.name}.png`), timeout: 60000 });
    console.log(`screenshots: gameplay-${size.name}.png saved`);
    await context.close();
  }
  // M4: an Endless Ascent gameplay shot, plus fresh menu/gameplay
  // shots for the README (docs/screenshots), taken from the 1280x720
  // captures above.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'Asia/Bangkok', hasTouch: true });
    const page = await context.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push('endless console: ' + msg.text()); });
    page.on('pageerror', (err) => errors.push('endless pageerror: ' + String(err)));
    await page.route(THREE_URL, (route) => route.fulfill({ path: cached }));
    await page.goto(`http://127.0.0.1:${port}/?endless=20261124`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__spire && window.__spire.phase === 'playing', null, { timeout: 30000 });
    await page.evaluate(() => window.__spire.autopilot(true));
    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.join(SHOTS_DIR, 'endless-1280x720.png'), timeout: 60000 });
    console.log('screenshots: endless-1280x720.png saved');
    await context.close();
  }
  fs.mkdirSync(DOCS_SHOTS_DIR, { recursive: true });
  for (const [src, dst] of [
    ['menu-1280x720.png', 'menu.png'],
    ['gameplay-1280x720.png', 'gameplay.png'],
    ['endless-1280x720.png', 'endless.png'],
  ]) {
    fs.copyFileSync(path.join(SHOTS_DIR, src), path.join(DOCS_SHOTS_DIR, dst));
    console.log(`screenshots: docs/screenshots/${dst} refreshed`);
  }
  if (errors.length > 0) {
    console.error('screenshots: errors seen:');
    errors.forEach((e) => console.error('  ' + e));
    process.exitCode = 1;
  } else {
    console.log(`screenshots: done — 7 shots in ${SHOTS_DIR} (menu/gameplay/endless copied to docs/screenshots/), zero console/page errors. INSPECT BY EYE.`);
  }
} catch (err) {
  console.error('screenshots: FAIL —', err.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}
