#!/usr/bin/env node
/**
 * Makes the link-preview images and the site icon's PNG forms.
 *
 *   npm run previews
 *
 * LinkedIn, X, Slack and iMessage show a page's og:image when its link is
 * shared. Each map's image is a screenshot of that map laid out alone at
 * 1200×627 (the page's ?card mode); the front page's shows both maps. They
 * are saved to data/previews/, with the hashes of what they were made from,
 * so the build can name any that the data has since outrun. favicon.ico and
 * apple-touch-icon.png are made from data/brand/icon.svg.
 *
 * Screenshots use macOS's own WebKit through scripts/snapshot.swift (the
 * Xcode command line tools compile it once), so no browser is installed.
 * Elsewhere, set CHROME_PATH to a Chrome or Chromium binary.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildSite, loadTemplates, loadLogos } from './lib/site.mjs';
import { PREVIEW, previewHashes } from './lib/previews.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const markets = fs.readdirSync(path.join(ROOT, 'data/markets')).filter(f => f.endsWith('.json')).sort()
  .map(f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/markets', f), 'utf8')));

// 1. The site as it would deploy, in a scratch folder, plus two pages that
//    draw the icon at favicon and home-screen sizes.
const site = fs.mkdtempSync(path.join(os.tmpdir(), 'market-maps-previews-'));
const { files } = buildSite(markets, { templates: loadTemplates(ROOT), logos: loadLogos(ROOT) });
for (const [file, contents] of files) {
  fs.mkdirSync(path.dirname(path.join(site, file)), { recursive: true });
  fs.writeFileSync(path.join(site, file), contents);
}
fs.mkdirSync(path.join(site, '_brand'));
fs.copyFileSync(path.join(ROOT, 'data/brand/icon.svg'), path.join(site, '_brand/icon.svg'));
fs.writeFileSync(path.join(site, '_brand/favicon.html'), '<!doctype html><html style="background:transparent"><body style="margin:0;background:transparent"><img src="icon.svg" width="32" height="32" style="display:block"></body></html>');
// A home-screen icon must be opaque: the mark sits on the page colour.
fs.writeFileSync(path.join(site, '_brand/touch.html'), '<!doctype html><html><body style="margin:0;width:180px;height:180px;display:grid;place-items:center;background:#f5f5f1"><img src="icon.svg" width="148" height="148"></body></html>');

// 2. A local server for it.
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let file = path.join(site, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!file.startsWith(site) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// 3. The camera: macOS WebKit through snapshot.swift, or Chrome if CHROME_PATH is set.
// It runs asynchronously: the server above lives in this process and must keep answering.
const run = promisify(execFile);
function camera() {
  if (process.env.CHROME_PATH) return (url, out, w, h, transparent) => run(process.env.CHROME_PATH, [
    '--headless=new', '--hide-scrollbars', `--window-size=${w},${h}`, '--force-device-scale-factor=1', '--virtual-time-budget=6000',
    ...(transparent ? ['--default-background-color=00000000'] : []), `--screenshot=${out}`, url]);
  if (process.platform !== 'darwin') throw new Error('Set CHROME_PATH to a Chrome or Chromium binary to make previews on this system.');
  const source = path.join(ROOT, 'scripts/snapshot.swift');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex').slice(0, 12);
  const binary = path.join(os.tmpdir(), `market-maps-snapshot-${hash}`);
  if (!fs.existsSync(binary)) {
    console.log('Compiling scripts/snapshot.swift (once)…');
    execFileSync('swiftc', ['-O', '-o', binary, source], { stdio: 'inherit' });
  }
  return (url, out, w, h, transparent) => run(binary, [url, out, String(w), String(h), '1', transparent ? 'transparent' : '']);
}

try {
  const shoot = camera();
  const previews = path.join(ROOT, 'data/previews'), brand = path.join(ROOT, 'data/brand');
  fs.mkdirSync(previews, { recursive: true });
  for (const doc of markets) {
    await shoot(`${base}/${doc.market.id}/?card`, path.join(previews, `${doc.market.id}.png`), PREVIEW.width, PREVIEW.height);
    console.log(`✓ data/previews/${doc.market.id}.png`);
  }
  await shoot(`${base}/?card`, path.join(previews, 'index.png'), PREVIEW.width, PREVIEW.height);
  console.log('✓ data/previews/index.png');

  // favicon.ico: one 32px PNG inside an ICO header, which every browser reads.
  const png32 = path.join(site, 'favicon-32.png');
  await shoot(`${base}/_brand/favicon.html`, png32, 32, 32, true);
  const png = fs.readFileSync(png32), header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header[6] = 32; header[7] = 32; header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(brand, 'favicon.ico'), Buffer.concat([header, png]));
  await shoot(`${base}/_brand/touch.html`, path.join(brand, 'apple-touch-icon.png'), 180, 180);
  console.log('✓ data/brand/favicon.ico, data/brand/apple-touch-icon.png');

  fs.writeFileSync(path.join(previews, 'manifest.json'), JSON.stringify(previewHashes(ROOT), null, 2) + '\n');
} finally {
  server.close();
  fs.rmSync(site, { recursive: true, force: true });
}
