import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSite, loadTemplates, orderMarkets, toPagePayload } from './site.mjs';
import { RESERVED_AXIS_KEYS, axisKeys } from './validate-market.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const templates = loadTemplates(ROOT);
const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/markets/personal-ai-agents.json'), 'utf8'));
// A second, smaller market, as a new data file would add one.
const second = structuredClone(dataset);
Object.assign(second.market, { id: 'second-map', name: 'Second map', edition: 2, featured: false });
second.companies = second.companies.slice(0, 2);

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
    if (file.endsWith('index.html') && html.includes('const SITE =')) {
      const site = siteJSON(html);
      hrefs.push(site.home, site.changelog, ...toPagePayload(file === 'index.html' ? dataset : second).map(c => site.companyHref.replace('__ID__', c.id)));
    }
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
    const { files } = buildSite([dataset, second], { templates, relative });
    assert.deepEqual(brokenLinks(files, relative), [], relative ? 'relative build' : 'root-relative build');
  }
});

test('each market gets its own map; the featured one owns the root', () => {
  const { files, pageCount, featured } = buildSite([second, dataset], { templates, relative: true });
  assert.equal(featured.market.id, 'personal-ai-agents', 'the featured flag wins over file order');
  assert.equal(siteJSON(files.get('index.html')).marketId, 'personal-ai-agents');
  assert.equal(siteJSON(files.get('second-map/index.html')).marketId, 'second-map');
  assert.equal(pageCount, dataset.companies.length + second.companies.length);
  const secondCompany = files.get(`second-map/${second.companies[0].id}/index.html`);
  assert.match(secondCompany, /href="\.\.\/\.\.\/second-map\/index\.html">← Second map</);
  assert.match(secondCompany, /href="\.\.\/\.\.\/second-map\/index\.html\?view=map&amp;company=/);
  assert.deepEqual(siteJSON(files.get('index.html')).maps.map(m => m.id), ['personal-ai-agents', 'second-map']);
  const sitemap = files.get('sitemap.xml');
  assert.match(sitemap, /\/second-map\/<\/loc>/);
  assert.match(sitemap, new RegExp(`/second-map/${second.companies[1].id}/</loc>`));
});

test('without a featured flag the lowest edition is the home page, never file order', () => {
  const a = structuredClone(dataset), b = structuredClone(second);
  delete a.market.featured;
  assert.equal(orderMarkets([b, a])[0].market.id, 'personal-ai-agents');
  const { files } = buildSite([dataset], { templates, relative: true });
  assert.deepEqual(siteJSON(files.get('index.html')).maps, [], 'a single map shows no switcher');
});

test('the page payload never collides with an axis name', () => {
  const axes = axisKeys(dataset.market);
  for (const row of toPagePayload(dataset)) {
    for (const key of Object.keys(row)) if (!axes.includes(key)) assert.ok(RESERVED_AXIS_KEYS.includes(key), `payload field "${key}" must be listed in RESERVED_AXIS_KEYS`);
  }
});

test('every inlined module shares one scope without redeclaring a name', () => {
  const { files } = buildSite([dataset], { templates, relative: true });
  const script = files.get('index.html').match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'market-maps-')), 'page.mjs');
  fs.writeFileSync(file, script);
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
});

test('production builds carry a 404 page; relative builds do not', () => {
  const production = buildSite([dataset], { templates, relative: false }).files;
  assert.match(production.get('404.html'), /Page not found/);
  assert.match(production.get('404.html'), /href="\/">Open the Personal AI Agents map/);
  assert.ok(!buildSite([dataset], { templates, relative: true }).files.has('404.html'));
  assert.doesNotMatch(production.get('sitemap.xml'), /404/);
});

test('pages describe themselves in full words', () => {
  const { files } = buildSite([dataset], { templates, relative: true });
  const unescape = s => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  for (const c of dataset.companies) {
    const html = files.get(`personal-ai-agents/${c.id}/index.html`);
    const desc = unescape(html.match(/<meta name="description" content="([^"]*)"/)[1]);
    assert.ok(desc.length <= 161, `${c.id}: description is ${desc.length} characters`);
    if (desc === c.description) continue;
    // A shortened description ends at a word boundary of the original, then an ellipsis.
    const kept = desc.slice(0, -1);
    assert.ok(desc.endsWith('…') && c.description.startsWith(kept), `${c.id}: not a prefix of the description`);
    assert.match(c.description.slice(kept.length, kept.length + 1), /[\s,;:.—–-]/, `${c.id}: cut mid-word at "${kept.slice(-12)}"`);
  }
  assert.match(files.get('index.html'), /<title>Personal AI Agents Market Map<\/title>/);
  assert.match(files.get('index.html'), /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com/);
  assert.doesNotMatch(files.get('assets/site.css'), /@import/);
});
