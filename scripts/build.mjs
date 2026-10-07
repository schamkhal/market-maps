#!/usr/bin/env node
/**
 * Builds the static site into dist/.
 *
 *   dist/index.html                        the maps hub
 *   dist/<market>/index.html               each market's interactive map
 *   dist/<market>/<company>/index.html     a forward to the company's profile on its map
 *   dist/404.html                          not-found page (production builds)
 *   dist/assets/site.css                   the shared stylesheet (map.css)
 *   dist/assets/logos/<market>/…           company logos (data/logos)
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
import { fileURLToPath } from 'node:url';
import { buildSite, loadTemplates, loadLogos } from './lib/site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const marketFiles = fs.readdirSync(path.join(ROOT, 'data/markets')).filter(f => f.endsWith('.json'));
const markets = marketFiles.map(f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/markets', f), 'utf8')));
const { files, pageCount } = buildSite(markets, {
  templates: loadTemplates(ROOT),
  logos: loadLogos(ROOT),
  siteUrl: process.env.SITE_URL || 'https://example.com',
  // RELATIVE=1 emits relative links with explicit index.html, so the built site
  // works from a file:// path, inside a subdirectory, or in a preview host that
  // does not resolve directory URLs. Production deploys use root-relative links.
  relative: process.env.RELATIVE === '1',
});

fs.rmSync(DIST, { recursive: true, force: true });
for (const [file, contents] of files) {
  const target = path.join(DIST, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}
console.log(`Built dist/ — ${markets.length} map${markets.length === 1 ? '' : 's'}, ${pageCount} company links.`);
