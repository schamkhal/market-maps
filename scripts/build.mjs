#!/usr/bin/env node
/**
 * Builds the static site into dist/.
 *
 *   dist/index.html                        the featured market's interactive map
 *   dist/<market>/index.html               every other market's map
 *   dist/<market>/<company>/index.html     one static page per company (SEO)
 *   dist/changelog/index.html              what changed, from git history
 *   dist/404.html                          not-found page (production builds)
 *   dist/assets/site.css                   the shared stylesheet (map.css)
 *
 * Rendering lives in scripts/lib/site.mjs, which returns every file as data;
 * this script only reads inputs and writes the result.
 *
 * Zero runtime dependencies, runs in milliseconds. Deploy dist/ to Cloudflare Pages.
 *
 *   node scripts/build.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSite, loadTemplates } from './lib/site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const markets = fs.readdirSync(path.join(ROOT, 'data/markets')).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/markets', f), 'utf8')));

let commits = [];
try {
  const log = execSync(
    'git log --format=%H%x1f%ad%x1f%s --date=short -n 40 -- data/markets',
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  commits = log.trim().split('\n').filter(Boolean).map(l => {
    const [hash, date, subject] = l.split('\x1f');
    return { hash, date, subject };
  });
} catch { /* not a git repo yet — the changelog just renders empty */ }

const { files, pageCount } = buildSite(markets, {
  templates: loadTemplates(ROOT),
  siteUrl: process.env.SITE_URL || 'https://example.com',
  // RELATIVE=1 emits relative links with explicit index.html, so the built site
  // works from a file:// path, inside a subdirectory, or in a preview host that
  // does not resolve directory URLs. Production deploys use root-relative links.
  relative: process.env.RELATIVE === '1',
  commits,
});

fs.rmSync(DIST, { recursive: true, force: true });
for (const [file, contents] of files) {
  const target = path.join(DIST, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}
console.log(`Built dist/ — ${markets.length} map${markets.length === 1 ? '' : 's'}, ${pageCount} company pages, ${commits.length} changelog entries.`);
