#!/usr/bin/env node
/**
 * Fetches each company's site icon into data/logos/<market>/<company>.<ext>,
 * the logo the list and the profiles show in place of a letter tile. The
 * chart itself never shows logos, so they never compete with bubble size.
 *
 * For every company it reads the official site (the company's `website`, or
 * the brand's home page for a platform product, see PAGES below), collects the
 * icons the page declares, and keeps the best one:
 *
 *   1. a home-screen icon (apple-touch-icon or web-manifest icon, 120px+):
 *      an opaque square that reads the same on light and dark pages;
 *   2. an SVG icon;
 *   3. the largest PNG or ICO icon.
 *
 * An icon the page declares for dark mode (media="(prefers-color-scheme: dark)")
 * is saved alongside as <company>-dark.<ext>. Every source is recorded in
 * data/logos/<market>/sources.json.
 *
 *   node scripts/fetch-logos.mjs                 fetch logos that are missing
 *   node scripts/fetch-logos.mjs --force         fetch every logo again
 *   node scripts/fetch-logos.mjs --only=hark,poke
 *   node scripts/fetch-logos.mjs --icon=chatgpt=https://…/apple-touch-icon.png
 *
 * --icon takes a specific icon file: for a site that blocks automated reads,
 * or whose only site icon is a tiny favicon, the company's own App Store icon
 * (itunes.apple.com/search lists it as artworkUrl512, with the developer's
 * name to check against) is the next best official source.
 * A dark-mode icon smaller than 96px is skipped: the light home-screen icon
 * reads better in both themes than a blurry enlarged favicon.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const force = args.includes('--force');
const icons = Object.fromEntries(args.filter(a => a.startsWith('--icon=')).map(a => { const [id, ...url] = a.slice(7).split('='); return [id, url.join('=')]; }));
const only = args.find(a => a.startsWith('--only='))?.slice(7).split(',').filter(Boolean) ?? (Object.keys(icons).length ? Object.keys(icons) : null);

// A platform product's `website` is often a deep product page on a big
// domain; its icon is the brand's, so the brand's home page is read instead.
const PAGES = {
  'superhuman-go': 'https://superhuman.com',
  alexa: 'https://alexa.amazon.com',
  siri: 'https://www.apple.com',
  'grok-bot': 'https://grok.com',
  genie: 'https://deepmind.google',
  cosmos: 'https://www.nvidia.com',
  'microsoft-muse': 'https://www.microsoft.com',
  'v-jepa': 'https://ai.meta.com',
  'hy-world': 'https://hunyuan.tencent.com',
  'matrix-game': 'https://skywork.ai',
  'happy-oyster': 'https://www.alibabagroup.com',
};

const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,image/avif,image/webp,image/svg+xml,image/*,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};
const get = async (url, accept = HEADERS.accept) => {
  const res = await fetch(url, { headers: { ...HEADERS, accept }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
};

const attrs = tag => Object.fromEntries([...tag.matchAll(/([a-z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
  .map(m => [m[1].toLowerCase(), (m[3] ?? m[4] ?? m[5] ?? '').replace(/&amp;/g, '&')]));
const largest = sizes => Math.max(0, ...String(sizes ?? '').split(/\s+/).map(s => parseInt(s, 10) || (s === 'any' ? 512 : 0)));

async function candidates(page) {
  const res = await get(page);
  const base = res.url, html = await res.text();
  const found = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(tag), rel = (a.rel ?? '').toLowerCase();
    if (!a.href) continue;
    const href = new URL(a.href, base).href, dark = /prefers-color-scheme:\s*dark/i.test(a.media ?? '');
    if (/apple-touch-icon/.test(rel)) found.push({ href, kind: 'home', size: largest(a.sizes) || 180, dark });
    else if (/\bicon\b/.test(rel) && !/mask-icon/.test(rel)) {
      const svg = /svg/.test(a.type ?? '') || /\.svg(\?|$)/i.test(href);
      found.push({ href, kind: svg ? 'svg' : 'icon', size: svg ? 512 : largest(a.sizes) || (/\.ico(\?|$)/i.test(href) ? 32 : 64), dark });
    } else if (rel === 'manifest') {
      try {
        const manifest = await (await get(href)).json();
        for (const icon of manifest.icons ?? []) {
          if (/maskable/.test(icon.purpose ?? '') && !/any/.test(icon.purpose ?? '')) continue;
          found.push({ href: new URL(icon.src, href).href, kind: 'home', size: largest(icon.sizes), dark: false });
        }
      } catch { /* a broken manifest is not fatal */ }
    }
  }
  // Pages that declare nothing still usually serve the conventional files.
  const origin = new URL(base).origin;
  for (const [file, kind, size] of [['/apple-touch-icon.png', 'home', 180], ['/favicon.svg', 'svg', 512], ['/favicon.ico', 'icon', 32]]) {
    if (!found.some(c => c.href === origin + file)) found.push({ href: origin + file, kind, size, dark: false, guess: true });
  }
  return found;
}

const rank = c => (c.kind === 'home' && c.size >= 120 ? 3000 : c.kind === 'svg' ? 2000 : 1000) + Math.min(c.size, 1024) - (c.guess ? 500 : 0);

// Pixel width of a PNG, JPEG-free formats only; SVG counts as large.
function width(bytes, ext) {
  if (ext === 'svg') return 1024;
  if (ext === 'png') return bytes.readUInt32BE(16);
  if (ext === 'ico') return Math.max(...Array.from({ length: bytes.readUInt16LE(4) }, (_, i) => bytes[6 + 16 * i] || 256));
  if (ext === 'gif') return bytes.readUInt16LE(6);
  return 0;
}

function sniff(bytes) {
  const head = bytes.subarray(0, 512).toString('latin1');
  if (bytes[0] === 0x89 && head.startsWith('\x89PNG')) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return 'ico';
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'webp';
  if (head.startsWith('GIF8')) return 'gif';
  if (/<svg[\s>]/i.test(bytes.subarray(0, 4096).toString('utf8'))) return 'svg';
  return null;
}

async function download(list) {
  for (const c of [...list].sort((a, b) => rank(b) - rank(a))) {
    try {
      const bytes = Buffer.from(await (await get(c.href, 'image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8')).arrayBuffer());
      const ext = sniff(bytes);
      if (ext && bytes.length > 100 && bytes.length < 1_000_000) return { ...c, bytes, ext };
    } catch { /* try the next candidate */ }
  }
  return null;
}

// Logos show at 34–46px, so a raster icon is stored at no more than 128px
// (crisp on 2x screens, a few KB instead of hundreds). macOS's sips does the
// resizing; elsewhere the file is kept as fetched.
const save = (dir, name, icon) => {
  for (const f of fs.readdirSync(dir)) if (f.replace(/\.[a-z]+$/, '') === name) fs.rmSync(path.join(dir, f));
  const file = path.join(dir, `${name}.${icon.ext}`);
  fs.writeFileSync(file, icon.bytes);
  if (process.platform === 'darwin' && ['png', 'jpg'].includes(icon.ext)) {
    try { execFileSync('sips', ['-Z', '128', file], { stdio: 'ignore' }); } catch { /* keep the original */ }
  }
  return `${name}.${icon.ext}`;
};

const today = new Date().toISOString().slice(0, 10);
for (const file of fs.readdirSync(path.join(ROOT, 'data/markets')).filter(f => f.endsWith('.json'))) {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/markets', file), 'utf8'));
  const dir = path.join(ROOT, 'data/logos', doc.market.id);
  fs.mkdirSync(dir, { recursive: true });
  const manifestFile = path.join(dir, 'sources.json');
  const sources = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
  for (const c of doc.companies) {
    if (only && !only.includes(c.id)) continue;
    const have = fs.readdirSync(dir).some(f => f.replace(/\.[a-z]+$/, '') === c.id);
    if (have && !force && !only) continue;
    const page = PAGES[c.id] ?? c.website;
    try {
      const list = icons[c.id] ? [{ href: icons[c.id], kind: 'home', size: 512, dark: false }] : await candidates(page);
      const light = await download(list.filter(x => !x.dark));
      if (!light) { console.log(`✗ ${doc.market.id}/${c.id}: no usable icon at ${page}`); continue; }
      let dark = await download(list.filter(x => x.dark));
      if (dark && dark.ext !== 'svg' && width(dark.bytes, dark.ext) < 96) dark = null;
      for (const f of fs.readdirSync(dir)) if (f.replace(/\.[a-z]+$/, '') === `${c.id}-dark`) fs.rmSync(path.join(dir, f));
      const entry = { page: icons[c.id] ? new URL(icons[c.id]).origin : page, light: light.href, file: save(dir, c.id, light), fetched: today };
      if (dark) Object.assign(entry, { dark: dark.href, darkFile: save(dir, `${c.id}-dark`, dark) });
      sources[c.id] = entry;
      console.log(`✓ ${doc.market.id}/${c.id}: ${light.kind} ${light.ext} ${light.bytes.length}B${dark ? ` + dark ${dark.ext}` : ''}  ← ${light.href}`);
    } catch (error) {
      console.log(`✗ ${doc.market.id}/${c.id}: ${error.message}`);
    }
  }
  fs.writeFileSync(manifestFile, JSON.stringify(Object.fromEntries(Object.entries(sources).sort()), null, 2) + '\n');
}
