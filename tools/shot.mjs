// Headless screenshot + health check for a variant, using the installed Chrome.
//
//   node tools/shot.mjs <page path> [--times 1500,4000,8000] [--size 1280x720]
//                       [--query demo=1] [--out shots/<name>] [--fake-video file|none]
//                       [--keys Enter@1500,Space@4000]
//
// Serves the project root on a random local port, opens the page (demo mode by
// default, so hands are scripted), saves a PNG at each time, then prints
// console errors/warnings, uncaught exceptions, the measured FPS, and
// window.__stats if the page exposes it, and every main-thread stall longer
// than 50 ms (long tasks), which is what reads as a hitch on screen.
//
// The webcam is faked: .local/camera.mjpeg (a synthetic room, if present) or
// the file given with --fake-video; `--fake-video none` uses Chrome's built-in
// test pattern and `--fake-video off` runs with no camera at all (black background).

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glsl': 'text/plain',
};

function parseArgs(argv) {
  const options = { page: null, times: [1500, 4000, 8000], size: [1280, 720], query: 'demo=1', out: null,
    fakeVideo: '.local/camera.mjpeg', keys: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--times') options.times = argv[++index].split(',').map(Number);
    else if (arg === '--size') options.size = argv[++index].split('x').map(Number);
    else if (arg === '--query') options.query = argv[++index];
    else if (arg === '--out') options.out = argv[++index];
    else if (arg === '--fake-video') options.fakeVideo = argv[++index];
    else if (arg === '--keys') {
      options.keys = argv[++index].split(',').map((entry) => {
        const [key, time] = entry.split('@');
        return { key, time: Number(time) };
      });
    }
    else options.page = arg;
  }
  if (!options.page) {
    console.error('usage: node tools/shot.mjs <page path> [--times ms,ms] [--size WxH] [--query k=v] [--out dir]');
    process.exit(2);
  }
  const name = basename(options.page.replace(/\/?(index\.html)?$/, ''));
  options.out ??= join('shots', name && name !== '.' ? name : 'app');
  return options;
}

function startServer() {
  const server = createServer(async (request, response) => {
    const urlPath = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    let filePath = normalize(join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) { response.writeHead(403).end(); return; }
    if (urlPath.endsWith('/')) filePath = join(filePath, 'index.html');
    try {
      const body = await readFile(filePath);
      response.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

const options = parseArgs(process.argv.slice(2));
const server = await startServer();
const port = server.address().port;
const pagePath = options.page.replace(/^\.?\//, '');
const url = `http://127.0.0.1:${port}/${pagePath}${options.query ? `?${options.query}` : ''}`;
await mkdir(options.out, { recursive: true });

const cameraOff = options.fakeVideo === 'off';
const fakeVideo = !['none', 'off'].includes(options.fakeVideo) && existsSync(resolve(ROOT, options.fakeVideo))
  ? resolve(ROOT, options.fakeVideo) : null;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl',
    ...(cameraOff ? [] : ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']),
    ...(fakeVideo ? [`--use-file-for-fake-video-capture=${fakeVideo}`] : []),
    '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: options.size[0], height: options.size[1] } });
const messages = [];
page.on('console', (message) => {
  if (['error', 'warning'].includes(message.type())) messages.push(`[${message.type()}] ${message.text()}`);
});
page.on('pageerror', (error) => messages.push(`[exception] ${error.stack || error.message}`));
page.on('requestfailed', (request) => messages.push(`[request failed] ${request.url()} ${request.failure()?.errorText}`));
await page.addInitScript(() => {
  window.__longTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__longTasks.push({ start: Math.round(entry.startTime), duration: Math.round(entry.duration) });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // long task timing not supported
  }
});

const startedAt = Date.now();
await page.goto(url, { waitUntil: 'load' });
const saved = [];
const events = [
  ...options.times.map((time) => ({ time, shot: true })),
  ...options.keys.map(({ key, time }) => ({ time, key })),
].sort((a, b) => a.time - b.time);
for (const event of events) {
  const wait = event.time - (Date.now() - startedAt);
  if (wait > 0) await page.waitForTimeout(wait);
  if (event.key) {
    await page.keyboard.press(event.key);
    continue;
  }
  const file = join(options.out, `t${String(event.time).padStart(5, '0')}.png`);
  await page.screenshot({ path: file });
  saved.push(file);
}

const fps = await page.evaluate(() => new Promise((done) => {
  let frames = 0;
  const start = performance.now();
  const tick = () => {
    frames++;
    if (performance.now() - start < 2000) requestAnimationFrame(tick);
    else done(frames / ((performance.now() - start) / 1000));
  };
  requestAnimationFrame(tick);
}));
const stats = await page.evaluate(() => window.__stats ?? null);
const longTasks = await page.evaluate(() => window.__longTasks ?? []);
const renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : (gl ? 'webgl2 (unknown renderer)' : 'NO WEBGL2');
});

await browser.close();
server.close();

console.log(`url:       ${url}`);
console.log(`camera:    ${cameraOff ? 'off' : fakeVideo ?? 'chrome test pattern'}`);
console.log(`renderer:  ${renderer}`);
console.log(`fps:       ${fps.toFixed(1)} (headless; real browser is usually higher)`);
if (stats) console.log(`stats:     ${JSON.stringify(stats)}`);
const worst = [...longTasks].sort((a, b) => b.duration - a.duration).slice(0, 6)
  .map((task) => `${task.duration} ms @ ${task.start}`).join(', ');
console.log(`stalls:    ${longTasks.length} over 50 ms${worst ? ` (worst: ${worst})` : ''}`);
console.log(`shots:     ${saved.join(', ')}`);
console.log(messages.length ? `problems (${messages.length}):\n  ${messages.join('\n  ')}` : 'problems:  none');
