#!/usr/bin/env node
/**
 * Local preview — see the whole site before pushing anything to git.
 *
 *   npm run preview      → builds, then serves on http://127.0.0.1:5173
 *
 * Builds in RELATIVE=1 mode, so the same dist/ also works if you just
 * double-click dist/index.html. Serving it is still better: directory URLs
 * resolve and the links match what production will do.
 *
 * Zero dependencies. Ctrl-C to stop.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 5173);

const build = spawnSync(process.execPath, [path.join(ROOT, 'scripts/build.mjs')], {
  cwd: ROOT, stdio: 'inherit', env: { ...process.env, RELATIVE: '1' },
});
if (build.status !== 0) process.exit(build.status ?? 1);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.json': 'application/json',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  let file = path.join(DIST, url);

  // Refuse anything that escapes dist/ (including a sibling such as dist-old/).
  if (file !== DIST && !file.startsWith(DIST + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');

  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<p style="font:15px system-ui;padding:40px">Not found: ${url}<br>
      <a href="/">← back to the map</a></p>`);
  }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  // Company pages live at <market>/<company>/index.html, for every market.
  const dirs = p => fs.readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
  const n = dirs(DIST).filter(d => !['assets', 'changelog'].includes(d)).flatMap(d => dirs(path.join(DIST, d))).length;
  console.log(`\n  Preview  →  http://127.0.0.1:${PORT}`);
  console.log(`  ${n} company pages · changelog at /changelog/`);
  console.log(`  Nothing is published. Ctrl-C to stop.\n`);
});
