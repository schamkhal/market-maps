/**
 * Link-preview images and the site icon.
 *
 *   data/previews/<market>.png   each map's 1200×627 og:image
 *   data/previews/index.png      the front page's
 *   data/previews/manifest.json  what each image was made from (input hashes)
 *   data/brand/icon.svg          the site icon (hand-edited); favicon.ico and
 *                                apple-touch-icon.png are made from it
 *
 * scripts/previews.mjs makes the images; the build only reads them, and
 * names any that no longer match the data and templates they were made from.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PREVIEW = { width: 1200, height: 627 };

// What a map's preview shows: its data and the page that draws it.
const MAP_INPUTS = ['templates/map.html', 'templates/map.css', 'templates/map.js', 'templates/map-model.mjs', 'templates/label-layout.mjs'];
const HUB_INPUTS = ['scripts/lib/hub.mjs', 'templates/map.css'];
const BRAND_INPUTS = ['data/brand/icon.svg'];

const digest = parts => crypto.createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 16);
const read = (root, file) => fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8') : '';

/** The current input hash of every image: { index, brand, <market>: … }. */
export function previewHashes(root) {
  const markets = fs.readdirSync(path.join(root, 'data/markets')).filter(f => f.endsWith('.json')).sort();
  const hashes = {};
  for (const file of markets) {
    const id = JSON.parse(read(root, `data/markets/${file}`)).market.id;
    hashes[id] = digest([read(root, `data/markets/${file}`), ...MAP_INPUTS.map(f => read(root, f))]);
  }
  hashes.index = digest([...markets.map(f => read(root, `data/markets/${f}`)), ...HUB_INPUTS.map(f => read(root, f))]);
  hashes.brand = digest(BRAND_INPUTS.map(f => read(root, f)));
  return hashes;
}

/** The images on disk: { previews: { name: bytes }, brand: { file: bytes }, manifest }. */
export function loadPreviews(root) {
  const dir = path.join(root, 'data/previews'), brandDir = path.join(root, 'data/brand');
  const previews = {}, brand = {};
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.png'))) previews[f.slice(0, -4)] = fs.readFileSync(path.join(dir, f));
  if (fs.existsSync(brandDir)) for (const f of ['icon.svg', 'favicon.ico', 'apple-touch-icon.png']) {
    if (fs.existsSync(path.join(brandDir, f))) brand[f] = fs.readFileSync(path.join(brandDir, f));
  }
  const manifestFile = path.join(dir, 'manifest.json');
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
  return { previews, brand, manifest };
}

/** Names of images that are missing or were made from different inputs. */
export function stalePreviews(root) {
  const { previews, manifest } = loadPreviews(root);
  return Object.entries(previewHashes(root))
    .filter(([name, hash]) => manifest[name] !== hash || (name !== 'brand' && !previews[name]))
    .map(([name]) => name);
}
