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
  autonomy: 60, breadth: 55, distribution: 80,
  rationales: { autonomy: 'Acts in iMessage.', breadth: 'Mail and calendar.', distribution: 'Lives in your texts.' },
  news: [1, 2, 3, 4, 5].map(i => ({ t: `Story ${i}`, p: 'Pub', d: `2026-0${i}-01`, u: `https://news.example/${i}` })),
  checks: [{ t: 'Product availability and features', p: 'Pally', d: '2026-09-26', u: 'https://pally.com/' }],
};

test('a manual valuation says so and never borrows the round source', () => {
  const html = renderProfile(base);
  assert.match(html, /<span class="confidence manual">Entered manually<\/span><\/div><div class="source-line">Source not public<\/div>/);
  assert.match(html, /Entered manually from a source that is not public\./);
  assert.match(html, /Hand-entered estimate\./);
  // The round row still cites its own source.
  assert.match(html, /Reported · <a href="https:\/\/dealroom\.co\/x"/);
});
test('the drawer is the whole profile: every source, no second page to open', () => {
  const html = renderProfile(base);
  assert.match(html, /<h2 id="companyTitle">Pally<\/h2>/);
  // Every story is in the profile; past the latest four they fold away.
  assert.equal((html.match(/news\.example/g) || []).length, 5);
  assert.match(html, /<details class="more-news"><summary>1 older source<\/summary><div class="profile-news"><a href="https:\/\/news\.example\/1"/);
  assert.doesNotMatch(renderProfile({ ...base, news: base.news.slice(0, 4) }), /more-news/);
  assert.match(html, /<details class="check-log"><summary>Verification log · 1 check/);
  assert.match(html, /Why this figure\?/);
  assert.doesNotMatch(html, /Full research profile|full profile|See it on the map|Last checked in dataset/);
});
test('every score has its reasoning right under it, the first axis included', () => {
  const html = renderProfile(base);
  assert.match(html, /<span>Autonomy<\/span>.*?<strong>60<\/strong><\/div><p class="score-note">Acts in iMessage\.<\/p>/s);
  assert.match(html, /<strong>55<\/strong><\/div><p class="score-note">Mail and calendar\.<\/p>/s);
  assert.match(html, /<strong>80<\/strong><\/div><p class="score-note">Lives in your texts\.<\/p>/s);
  assert.doesNotMatch(html, /Scoring note/);
});
test('platforms show the parent note and no financial rows', () => {
  const html = renderProfile({ ...base, cls: 'platform', company: 'Alphabet', brand: 'Google', valuation: null, raised: null, parent: 'Alphabet is Google’s parent.' });
  assert.match(html, /No standalone valuation/);
  assert.match(html, /Alphabet is Google’s parent\./);
  assert.doesNotMatch(html, /Post-money valuation/);
  assert.doesNotMatch(html, /Total funding/);
});
test('every dataset string is escaped', () => {
  const html = renderProfile({ ...base, traction: 'Angel <script>' });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Angel &lt;script&gt;/);
});
test('profiles no longer list round investors', () => {
  assert.doesNotMatch(renderProfile(base), /Round investors|Lead Fund/);
});
test('acquired companies explain that the figure is not an exit price', () => {
  assert.match(renderProfile({ ...base, cls: 'acquired', valConf: 'estimated' }), /not the acquisition price/);
  // Unless the figure is the acquisition price itself (World Labs and AMD).
  const deal = renderProfile({ ...base, cls: 'acquired', valuation: 8.2e9, valConf: 'reported', valBasis: 'acquisition' });
  assert.match(deal, /Valuation · announced acquisition price/);
  assert.doesNotMatch(deal, /last private-round valuation/);
  assert.match(deal, /<p>Acquired · /);
});
test('a hand-entered funding total is labelled; an unrecorded source says so', () => {
  assert.match(renderProfile({ ...base, raisedConf: 'manual' }), /Total funding<\/dt><dd>\$5\.2M<small>Cumulative figure · <span class="confidence manual">Entered manually/);
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
test('an acquisition price says it is not a round valuation', () => {
  const deal = { ...base, valuation: 8.2e9, valConf: 'reported', valBasis: 'acquisition', valNote: 'AMD agreed to buy the company.', valSrc: { p: 'AMD', u: 'https://amd.example/deal', d: '2026-09-28' } };
  const html = renderProfile(deal);
  assert.match(html, /Valuation · announced acquisition price/);
  assert.match(html, /price of an announced acquisition, not the price of a funding round/);
  assert.match(html, /href="https:\/\/amd\.example\/deal"[^>]*>AMD ↗<\/a> · Sep 28, 2026/);
  assert.doesNotMatch(html, /Post-money valuation/);
  assert.match(renderProfile(base), /Post-money valuation/);
});

test('a company with a logo shows it, with its dark-page version when there is one', () => {
  const plain = renderProfile(base);
  assert.match(plain, /<span class="avatar" aria-hidden="true" style="--category:#456cd3">P<\/span>/, 'no logo: the initials tile');
  const logo = renderProfile({ ...base, logo: '../assets/logos/agents/pally.png' });
  assert.match(logo, /<span class="avatar has-logo" aria-hidden="true"><img class="logo-light" src="\.\.\/assets\/logos\/agents\/pally\.png" alt="" loading="lazy" decoding="async"><\/span>/);
  const both = renderProfile({ ...base, logo: 'a.png', logoDark: 'a-dark.png' });
  assert.match(both, /class="avatar has-logo has-dark"[^>]*><img class="logo-light" src="a\.png"[^>]*><img class="logo-dark" src="a-dark\.png"/);
});
