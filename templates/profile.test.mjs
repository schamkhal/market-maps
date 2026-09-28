import test from 'node:test';
import assert from 'node:assert/strict';
import { configureCategories, configureAxes } from './map-model.mjs';
import { renderProfile } from './profile.mjs';

configureCategories([
  { id: 'executive', name: 'Personal assistants', color: '#456cd3', description: 'Assistants for everyday life.' },
]);

const base = {
  id: 'pally', name: 'Pally', company: 'Pally', cls: 'independent', cat: 'executive', hq: 'New York, NY',
  site: 'https://pally.com', desc: 'An assistant that lives in your texts.', founded: 2024, verified: '2026-09-26',
  founders: [{ n: 'Haz Hubble', r: 'CEO', li: 'https://www.linkedin.com/in/example' }], parent: null, traction: null,
  valuation: 30e6, raised: 5.2e6, lastAmount: 5.2e6, lastSeries: 'Seed', lastDate: '2026-08-06',
  leads: ['Lead Fund'], others: ['Angel <script>'], conf: 'reported', valConf: 'manual', valNote: 'Hand-entered estimate.',
  src: { p: 'Dealroom', u: 'https://dealroom.co/x', d: '2026-08-06' },
  autonomy: 60, breadth: 55, distribution: 80, why: 'Acts in iMessage.',
  news: [1, 2, 3, 4, 5].map(i => ({ t: `Story ${i}`, p: 'Pub', d: `2026-0${i}-01`, u: `https://news.example/${i}` })),
  checks: [{ t: 'Product availability and features', p: 'Pally', d: '2026-09-26', u: 'https://pally.com/' }],
};

test('a manual valuation says so and never borrows the round source', () => {
  const html = renderProfile(base);
  assert.match(html, /Entered by hand · no public source/);
  assert.match(html, /Manual · no source/);
  assert.match(html, /Hand-entered estimate\./);
  // The round row still cites its own source.
  assert.match(html, /Reported · <a href="https:\/\/dealroom\.co\/x"/);
});
test('drawer and page share content; the page shows every source and opens the log', () => {
  const drawer = renderProfile(base, { profileHref: '/p/pally/' });
  const page = renderProfile(base, { variant: 'page', mapHref: '/?company=pally' });
  assert.match(drawer, /<h2 id="companyTitle">Pally<\/h2>/);
  assert.match(page, /<h1 id="companyTitle">Pally<\/h1>/);
  assert.equal((drawer.match(/news\.example/g) || []).length, 4);
  assert.equal((page.match(/news\.example/g) || []).length, 5);
  assert.match(drawer, /All 5 sources on the full profile/);
  assert.match(drawer, /<details class="check-log"><summary>Verification log · 1 check/);
  assert.match(page, /<details class="check-log" open>/);
  assert.match(page, /See it on the map/);
  for (const html of [drawer, page]) {
    assert.match(html, /Why this figure\?/);
    assert.match(html, /Last checked in dataset · Sep 26, 2026/);
  }
});
test('platforms show the parent note and no financial rows', () => {
  const html = renderProfile({ ...base, cls: 'platform', company: 'Alphabet', brand: 'Google', valuation: null, raised: null, parent: 'Alphabet is Google’s parent.' });
  assert.match(html, /No standalone valuation/);
  assert.match(html, /Alphabet is Google’s parent\./);
  assert.doesNotMatch(html, /Post-money valuation/);
  assert.doesNotMatch(html, /Total funding/);
});
test('every dataset string is escaped', () => {
  const html = renderProfile(base);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Angel &lt;script&gt;/);
});
test('acquired companies explain that the figure is not an exit price', () => {
  assert.match(renderProfile({ ...base, cls: 'acquired', valConf: 'estimated' }), /not the acquisition price/);
});
test('a hand-entered funding total is labelled; an unrecorded source says so', () => {
  assert.match(renderProfile({ ...base, raisedConf: 'manual' }), /Total funding<\/dt><dd>\$5\.2M<small>Cumulative figure · <span class="confidence manual">Manual · no source/);
  assert.match(renderProfile(base), /Cumulative figure · source not recorded/);
  const sourced = renderProfile({ ...base, raisedConf: 'reported', raisedSrc: { p: 'Wire', u: 'https://wire.example/total', d: '2026-08-01' } });
  assert.match(sourced, /Cumulative figure · Reported · <a href="https:\/\/wire\.example\/total"/);
});
test('a link that is not http(s) renders as text, never as an href', () => {
  const html = renderProfile({ ...base, site: 'javascript:alert(1)', news: [{ t: 'Story', p: 'Pub', d: '2026-01-01', u: 'data:text/html,x' }] });
  assert.doesNotMatch(html, /href="(javascript|data):/);
  assert.match(html, /<span>Story<small>/);
});
test('score rows follow the market axes', () => {
  configureAxes({ x: { key: 'speed', label: 'Speed' }, y: { key: 'reach', label: 'Reach' } });
  const html = renderProfile({ ...base, speed: 70, reach: 20, rationales: { reach: 'Only in one app.' } });
  assert.match(html, /<span>Speed<\/span>.*<strong>70<\/strong>/s);
  assert.match(html, /<span>Reach<\/span>.*<strong>20<\/strong><\/div><p class="score-note">Only in one app\.<\/p>/s);
  assert.doesNotMatch(html, /Autonomy/);
  configureAxes({ x: { key: 'autonomy', label: 'Autonomy' }, y: { key: 'breadth', label: 'Context breadth' }, yAlt: { key: 'distribution', label: 'Distribution surface', short: 'Distribution' } });
});
test('a rumored valuation says the round has not closed', () => {
  const html = renderProfile({ ...base, valConf: 'rumored', valSrc: { p: 'Scoop', u: 'https://scoop.example/talks', d: '2026-09-03' } });
  assert.match(html, /Rumored/);
  assert.match(html, /still being negotiated/);
  assert.match(html, /href="https:\/\/scoop\.example\/talks"[^>]*>Scoop ↗<\/a> · Sep 3, 2026/);
  assert.doesNotMatch(renderProfile(base), /still being negotiated/);
});
