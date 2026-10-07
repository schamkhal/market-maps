import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSite, loadTemplates, loadLogos, orderMarkets, toPagePayload } from './site.mjs';
import { RESERVED_AXIS_KEYS, axisKeys } from './validate-market.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const templates = loadTemplates(ROOT);
const load = file => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/markets', file), 'utf8'));
const dataset = load('personal-ai-agents.json');
const worldModels = load('world-models.json');
// A third, smaller market, as a new data file would add one.
const third = structuredClone(dataset);
Object.assign(third.market, { id: 'third-map', name: 'Third map', edition: 3, featured: false });
third.companies = third.companies.slice(0, 2);
const published = [dataset, worldModels];
const all = [dataset, worldModels, third];

const siteJSON = html => JSON.parse(html.match(/const SITE = (\{.*?\});\n/)[1]);
// Every internal href/src in every page must name a file the build emitted.
function brokenLinks(files, relative) {
  const broken = [];
  const resolve = (from, href) => {
    const clean = href.split('#')[0].split('?')[0];
    if (!clean) return null;
    let target = clean.startsWith('/') ? clean.slice(1) : path.posix.join(path.posix.dirname(from), clean);
    target = path.posix.normalize(target);
    if (target === '.' || target === '' || target.endsWith('/')) target = path.posix.join(target === '.' ? '' : target, 'index.html');
    return target;
  };
  for (const [file, html] of files) {
    if (!file.endsWith('.html')) continue;
    // Attributes only: template literals inside the inlined scripts are not links.
    const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const hrefs = [...markup.matchAll(/\s(?:href|src)="([^"]*)"/g)].map(m => m[1])
      .filter(h => !/^(https?:|mailto:|#|data:)/.test(h));
    if (html.includes('const SITE =')) {
      const site = siteJSON(html);
      hrefs.push(site.home, ...site.maps.map(m => m.href));
    }
    const refresh = html.match(/http-equiv="refresh" content="0; url=([^"]+)"/);
    if (refresh) hrefs.push(refresh[1].replace(/&amp;/g, '&'));
    for (const href of hrefs) {
      if (relative && href.startsWith('/')) broken.push(`${file}: root-relative link ${href} in a relative build`);
      const target = resolve(file, href);
      if (target && !files.has(target)) broken.push(`${file} → ${href}`);
    }
  }
  return broken;
}

test('every internal link resolves, in both link modes and with several markets', () => {
  for (const relative of [true, false]) {
    const { files } = buildSite(all, { templates, relative });
    assert.deepEqual(brokenLinks(files, relative), [], relative ? 'relative build' : 'root-relative build');
  }
});

test('the hub owns the root and every market gets its own map', () => {
  const { files, pageCount } = buildSite([third, worldModels, dataset], { templates, relative: true });
  const hub = files.get('index.html');
  assert.ok(!hub.includes('const SITE ='), 'the root is the hub, not a map');
  // Newest edition first, each card linking to its map.
  const cards = [...hub.matchAll(/<h3><a href="([^"]+)">([^<]+)<\/a><\/h3>/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(cards, [['third-map/index.html', 'Third map'], ['world-models/index.html', 'World Models (Global)'], ['personal-ai-agents/index.html', 'Personal AI Agents (USA)']]);
  assert.match(hub, /<p class="eyebrow">Independent research<\/p>/, 'the label above the title carries no count');
  // The wordmark already says "Market maps"; the page title is for screen readers only.
  assert.match(hub, /<h1 id="hubTitle" class="visually-hidden">Market maps<\/h1>/);
  // The cards follow the introduction directly: no stats block, no visible section heading.
  assert.doesNotMatch(hub, /snapshot|companies tracked|Each map places one market/);
  // Its footer keeps the disclaimer only, without the "Market maps" label.
  assert.match(hub, /<footer class="site-footer"><span>Educational use only · not investment advice<\/span><\/footer>/);
  for (const doc of all) {
    const site = siteJSON(files.get(`${doc.market.id}/index.html`));
    assert.equal(site.marketId, doc.market.id);
    assert.deepEqual(site.maps.map(m => m.id), ['personal-ai-agents', 'world-models', 'third-map'], 'the switcher lists maps in edition order');
    assert.equal(site.home, '../index.html');
  }
  assert.equal(pageCount, all.reduce((sum, d) => sum + d.companies.length, 0));
  // A company's own address forwards to its profile in the map's drawer.
  const id = worldModels.companies[0].id;
  const forward = files.get(`world-models/${id}/index.html`);
  assert.ok(forward.includes(`<meta http-equiv="refresh" content="0; url=../../world-models/index.html?company=${id}">`));
  assert.ok(forward.includes(`<a href="../../world-models/index.html?company=${id}">`));
  assert.match(forward, /<meta name="robots" content="noindex">/);
  const production = buildSite(all, { templates, siteUrl: 'https://maps.test' }).files;
  assert.ok(production.get(`world-models/${id}/index.html`).includes(`content="0; url=/world-models/?company=${id}"`));
  const sitemap = production.get('sitemap.xml');
  for (const loc of ['https://maps.test/', 'https://maps.test/personal-ai-agents/', 'https://maps.test/world-models/']) {
    assert.ok(sitemap.includes(`<loc>${loc}</loc>`), loc);
  }
  assert.ok(!sitemap.includes(`world-models/${id}/`), 'forwards stay out of the sitemap');
});

test('the hub previews each map with one mark per company', () => {
  const hub = buildSite(published, { templates, relative: true }).files.get('index.html');
  const previews = [...hub.matchAll(/<div class="map-card-preview">([\s\S]*?)<\/svg><\/div>/g)].map(m => m[1]);
  assert.equal(previews.length, 2);
  // World Models is the newer map, so its card comes first.
  assert.deepEqual(previews.map(svg => (svg.match(/class="preview-mark/g) || []).length), [worldModels.companies.length, dataset.companies.length]);
  assert.match(previews[0], /INTERACTIVITY →/);
  // The badge shares the newest card's title row, so every card's title starts at the same height.
  assert.match(hub, /<div class="map-card-heading"><h3><a href="world-models\/index\.html">World Models \(Global\)<\/a><\/h3><span class="map-card-new">Latest<\/span><\/div>/);
  assert.match(hub, /<div class="map-card-heading"><h3><a href="personal-ai-agents\/index\.html">Personal AI Agents \(USA\)<\/a><\/h3><\/div>/);
  // The hub's masthead is the wordmark alone: no "Maps" link to the page itself.
  assert.doesNotMatch(hub, /<nav aria-label="Main navigation">/);
});

test('links from before the hub still open the map that used to live at the root', () => {
  // The featured flag decides, whatever the file order or edition.
  assert.equal(orderMarkets([third, worldModels, dataset])[0].market.id, 'personal-ai-agents');
  const unflagged = structuredClone(dataset);
  delete unflagged.market.featured;
  assert.equal(orderMarkets([third, worldModels, unflagged])[0].market.id, 'personal-ai-agents', 'without a flag, the lowest edition');

  const forwardScript = relative => buildSite(all, { templates, relative }).files.get('index.html').match(/<script>([\s\S]*?)<\/script>/)[1];
  const visit = (script, search, hash = '') => {
    let target = null;
    new Function('location', script)({ search, hash, replace: url => { target = url; } });
    return target;
  };
  const production = forwardScript(false), relative = forwardScript(true);
  assert.equal(visit(production, '?view=map&company=hark'), '/personal-ai-agents/?view=map&company=hark');
  assert.equal(visit(production, '?sort=breadth', '#research'), '/personal-ai-agents/?sort=breadth#research');
  assert.equal(visit(production, '', '#methodology'), '/personal-ai-agents/#methodology');
  assert.equal(visit(relative, '?company=hark'), 'personal-ai-agents/index.html?company=hark');
  assert.equal(visit(production, ''), null, 'the hub itself stays put');
  assert.equal(visit(production, '?utm_source=newsletter'), null, 'unrelated parameters stay on the hub');
  assert.equal(visit(production, '', '#maps'), null);
});

test('the page payload never collides with an axis name', () => {
  for (const doc of published) {
    const axes = axisKeys(doc.market);
    for (const row of toPagePayload(doc)) {
      for (const key of Object.keys(row)) if (!axes.includes(key)) assert.ok(RESERVED_AXIS_KEYS.includes(key), `payload field "${key}" must be listed in RESERVED_AXIS_KEYS`);
    }
  }
});

test('every inlined module shares one scope without redeclaring a name', () => {
  const { files } = buildSite(published, { templates, relative: true });
  for (const doc of published) {
    const script = files.get(`${doc.market.id}/index.html`).match(/<script type="module">([\s\S]*?)<\/script>/)[1];
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'market-maps-')), 'page.mjs');
    fs.writeFileSync(file, script);
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(check.status, 0, `${doc.market.id}: ${check.stderr}`);
  }
});

test('each map carries its own copy, so no map borrows another one\'s words', () => {
  const { files } = buildSite(published, { templates, relative: true });
  const agents = files.get('personal-ai-agents/index.html'), world = files.get('world-models/index.html');
  assert.equal(siteJSON(agents).allDescription, 'Compare autonomy, context, and reach across the full landscape.');
  assert.equal(siteJSON(world).allDescription, worldModels.market.allDescription);
  // The title is in the HTML before any script runs.
  assert.match(agents, /<h1 id="pageTitle">Personal AI Agents \(USA\)<\/h1>/);
  assert.match(world, /<h1 id="pageTitle">World Models \(Global\)<\/h1>/);
  // The other map is named only in the map switcher's list.
  assert.doesNotMatch(world.replace(/"maps":\[.*?\]/, ''), /Personal AI Agents/);
  // Map pages carry no footer label: neither the brand nor the scope.
  for (const html of [agents, world]) assert.doesNotMatch(html, /footerScope|scopeLabel|footerBrand|<footer/);
});

test('production builds carry a 404 page that lists every map; relative builds do not', () => {
  const production = buildSite(published, { templates, relative: false }).files;
  const notFound = production.get('404.html');
  assert.match(notFound, /Page not found/);
  assert.match(notFound, /href="\/personal-ai-agents\/">Personal AI Agents \(USA\)</);
  assert.match(notFound, /href="\/world-models\/">World Models \(Global\)</);
  assert.match(notFound, /href="\/">See all maps/);
  assert.ok(![...production.keys()].some(file => file.startsWith('changelog/')), 'the site has no changelog');
  assert.doesNotMatch([...production.values()].join(''), /[Cc]hangelog/);
  assert.ok(!buildSite(published, { templates, relative: true }).files.has('404.html'));
  assert.doesNotMatch(production.get('sitemap.xml'), /404/);
});

test('pages carry their own titles', () => {
  const { files } = buildSite(published, { templates, relative: true });
  assert.match(files.get('personal-ai-agents/index.html'), /<title>Personal AI Agents \(USA\) Market Map<\/title>/);
  assert.match(files.get('world-models/index.html'), /<title>World Models \(Global\) Market Map<\/title>/);
  assert.match(files.get('index.html'), /<title>Market Maps<\/title>/);
  assert.match(files.get('index.html'), /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com/);
  assert.doesNotMatch(files.get('assets/site.css'), /@import/);
});

test('every company has a logo, and every logo the pages link to is emitted', () => {
  // A company added without one shows its initials until `node scripts/fetch-logos.mjs` fetches it.
  const logos = loadLogos(ROOT);
  for (const doc of published) for (const c of doc.companies) assert.ok(logos[doc.market.id]?.[c.id]?.light, `${doc.market.id}/${c.id} has no logo in data/logos`);
  for (const relative of [false, true]) {
    const { files } = buildSite(published, { templates, logos, relative });
    for (const doc of published) {
      const page = files.get(`${doc.market.id}/index.html`);
      const data = JSON.parse(page.match(/const DATA = (\[.*?\]);\n/)[1]);
      for (const c of data) for (const href of [c.logo, c.logoDark].filter(Boolean)) {
        const target = href.startsWith('/') ? href.slice(1) : path.posix.normalize(path.posix.join(doc.market.id, href));
        assert.ok(files.has(target) && Buffer.isBuffer(files.get(target)), `${doc.market.id}/${c.id}: ${href}`);
      }
      assert.equal(data.filter(c => c.logo).length, doc.companies.length);
    }
  }
});
