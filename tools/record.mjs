// Records a stretch of the app to a GIF or MP4, for the README.
//
//   node tools/record.mjs [--query demo=1&skipintro&clean] [--from 0] [--to 12000]
//                         [--size 1280x720] [--width 720] [--fps 15] [--speed 1]
//                         [--colors 192] [--out media/demo.gif] [--fake-video off]
//
// Serves the project root, opens the page in headless Chrome on the real GPU,
// captures frames with the DevTools screencast (with their real timestamps),
// keeps those between --from and --to (ms after load) and encodes them with
// ffmpeg: a two-pass palette for GIFs, H.264 for .mp4.

import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
};

const options = {
  query: 'demo=1&skipintro&clean', from: 0, to: 12000, size: [1280, 720], width: 720, fps: 15,
  speed: 1, colors: 192, out: 'media/demo.gif', fakeVideo: 'off',
};
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index++) {
  const [flag, value] = [argv[index], argv[index + 1]];
  index++;
  if (flag === '--query') options.query = value;
  else if (flag === '--from') options.from = Number(value);
  else if (flag === '--to') options.to = Number(value);
  else if (flag === '--size') options.size = value.split('x').map(Number);
  else if (flag === '--width') options.width = Number(value);
  else if (flag === '--fps') options.fps = Number(value);
  else if (flag === '--speed') options.speed = Number(value);
  else if (flag === '--colors') options.colors = Number(value);
  else if (flag === '--out') options.out = value;
  else if (flag === '--fake-video') options.fakeVideo = value;
  else throw new Error(`unknown option ${flag}`);
}

const server = createServer(async (request, response) => {
  const urlPath = decodeURIComponent(new URL(request.url, 'http://x').pathname);
  let filePath = normalize(join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { response.writeHead(403).end(); return; }
  if (urlPath.endsWith('/')) filePath = join(filePath, 'index.html');
  let body;
  try {
    body = await readFile(filePath);
  } catch {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' }).end(body);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));

const cameraOff = options.fakeVideo === 'off';
const fakeVideo = !cameraOff && existsSync(resolve(ROOT, options.fakeVideo)) ? resolve(ROOT, options.fakeVideo) : null;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
    ...(cameraOff ? [] : ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']),
    ...(fakeVideo ? [`--use-file-for-fake-video-capture=${fakeVideo}`] : [])],
});
const page = await browser.newPage({ viewport: { width: options.size[0], height: options.size[1] } });
const session = await page.context().newCDPSession(page);
const frames = [];
let loadedAt = 0;
session.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  session.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  if (loadedAt) frames.push({ time: metadata.timestamp * 1000 - loadedAt, data });
});

await page.goto(`http://127.0.0.1:${server.address().port}/?${options.query}`, { waitUntil: 'load' });
loadedAt = await page.evaluate(() => performance.timeOrigin + performance.now());
await session.send('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1 });
await page.waitForTimeout(options.to + 300);
await session.send('Page.stopScreencast');
await browser.close();
server.close();

const kept = frames.filter((frame) => frame.time >= options.from && frame.time <= options.to)
  .sort((a, b) => a.time - b.time);
if (kept.length < 2) throw new Error(`only ${kept.length} frames in range`);

// write the frames with their real durations, then let ffmpeg resample to a steady rate
const work = join(tmpdir(), `record-${process.pid}`);
await mkdir(work, { recursive: true });
const list = [];
for (const [index, frame] of kept.entries()) {
  const name = `f${String(index).padStart(5, '0')}.jpg`;
  await writeFile(join(work, name), Buffer.from(frame.data, 'base64'));
  const next = kept[index + 1];
  const duration = ((next ? next.time : frame.time + 1000 / options.fps) - frame.time) / 1000 / options.speed;
  list.push(`file '${name}'`, `duration ${duration.toFixed(4)}`);
}
list.push(`file '${`f${String(kept.length - 1).padStart(5, '0')}.jpg`}'`);
await writeFile(join(work, 'frames.txt'), list.join('\n'));

const out = resolve(ROOT, options.out);
const scale = `fps=${options.fps},scale=${options.width}:-2:flags=lanczos`;
const input = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(work, 'frames.txt')];
if (out.endsWith('.gif')) {
  execFileSync('ffmpeg', [...input, '-vf', `${scale},palettegen=max_colors=${options.colors}:stats_mode=diff`, join(work, 'palette.png')]);
  execFileSync('ffmpeg', [...input, '-i', join(work, 'palette.png'), '-lavfi',
    `${scale}[v];[v][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle`, '-loop', '0', out]);
} else {
  execFileSync('ffmpeg', [...input, '-vf', scale, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23',
    '-movflags', '+faststart', out]);
}
await rm(work, { recursive: true, force: true });
const seconds = (kept.at(-1).time - kept[0].time) / 1000;
console.log(`${kept.length} frames over ${seconds.toFixed(1)} s -> ${options.out}`);
