#!/usr/bin/env node
/**
 * Offline tests for the refresh agent's guardrails. No API key needed —
 * these exercise stages 3 and 4 with synthetic claims.
 *
 *   node agent/refresh.test.mjs
 *
 * These are the rules that decide whether you can trust a Monday PR, so they
 * are the part worth testing.
 */
import assert from 'node:assert/strict';
import { reconcile, applyProposals, prBody, parseFeed } from './refresh.mjs';
import { validateMarket } from '../scripts/lib/validate-market.mjs';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
};

const company = (over = {}) => ({
  id: 'acme', name: 'Acme', company: 'Acme', class: 'independent', category: 'work', region: 'US',
  description: 'A personal agent that does things for you across your life.',
  axes: { autonomy: { score: 50, rationale: 'Acts on delegated tasks.' }, breadth: { score: 50 } },
  lastRound: { series: 'Series A', amountUsd: 1e7, postMoneyUsd: 1e8, date: '2026-01-01',
               leads: ['Old Fund'], otherInvestors: [], confidence: 'reported',
               source: { url: 'https://a.test/1', publisher: 'Old Wire', date: '2026-01-01' } },
  metrics: { totalRaisedUsd: 1e7 }, news: [], checks: [], locked: [], lastVerified: '2026-09-01',
  ...over,
});
const doc = cs => ({
  schemaVersion: 1,
  market: {
    id: 'test-map', name: 'Test', definition: 'Agents that act for one person.', inclusion: ['Acts for you'],
    regions: ['US'], asOf: '2026-09-12',
    axes: { x: { key: 'autonomy', label: 'Autonomy', rubric: '0 = prompted every time; 100 = unprompted' }, y: { key: 'breadth', label: 'Breadth', rubric: '0 = one surface; 100 = the whole of a life' } },
    categories: [{ id: 'work', name: 'Work', color: '#25806a', description: 'Agents for work and planning.' }],
  },
  companies: cs,
});
const claim = (over = {}) => ({
  companyId: 'acme', field: 'lastRound.postMoneyUsd', value: 5e8,
  sourceUrl: 'https://b.test/2', publisher: 'New Wire', sourceDate: '2026-09-01', headline: 'Acme is now worth $500M', ...over,
});
const run = (d, claims, today = '2026-09-20') => {
  const result = reconcile(d, claims);
  return { result, ...applyProposals(d, result, { today }) };
};

console.log('\nrefresh agent guardrails\n');

await test('accepts a newer, sourced figure', async () => {
  const r = await reconcile(doc([company()]), [claim()]);
  assert.equal(r.proposals.length, 1);
  assert.equal(r.proposals[0].value, 5e8);
  assert.equal(r.proposals[0].current, 1e8);
});

await test('never overwrites a locked field', async () => {
  const r = await reconcile(doc([company({ locked: ['lastRound.postMoneyUsd'] })]), [claim()]);
  assert.equal(r.proposals.length, 0);
  assert.equal(r.skipped[0].reason, 'field is locked');
});

await test('a locked parent path locks its children', async () => {
  const r = await reconcile(doc([company({ locked: ['lastRound'] })]), [claim()]);
  assert.equal(r.proposals.length, 0);
  assert.match(r.skipped[0].reason, /locked/);
});

await test('rejects a source older than the incumbent', async () => {
  const r = await reconcile(doc([company()]), [claim({ sourceDate: '2025-06-01' })]);
  assert.equal(r.proposals.length, 0);
  assert.match(r.skipped[0].reason, /older than incumbent/);
});

await test('platforms never take round data', async () => {
  const r = await reconcile(doc([company({ class: 'platform' })]), [claim()]);
  assert.equal(r.proposals.length, 0);
  assert.match(r.skipped[0].reason, /platform/);
});

await test('conflicting sources are flagged and neither value is applied', async () => {
  const d = doc([company()]);
  const { result, applied } = run(d, [
    claim({ value: 5e8, publisher: 'Wire A' }),
    claim({ value: 9e8, publisher: 'Wire B', sourceUrl: 'https://c.test/3' }),
    claim({ value: 5e8, publisher: 'Wire C', sourceUrl: 'https://d.test/4' }),
  ]);
  assert.equal(result.proposals.length, 0);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(result.conflicts[0].claims.map(c => c.value), [5e8, 9e8, 5e8]);
  assert.equal(applied.length, 0);
  assert.equal(d.companies[0].lastRound.postMoneyUsd, 1e8, 'the figure on file is untouched');
});

await test('agreeing sources become one change, citing the newest', async () => {
  const r = await reconcile(doc([company()]), [claim({ sourceDate: '2026-09-01' }), claim({ sourceUrl: 'https://e.test/5', sourceDate: '2026-09-05' })]);
  assert.equal(r.proposals.length, 1);
  assert.equal(r.proposals[0].sourceUrl, 'https://e.test/5');
});

await test('an unchanged value produces no proposal', async () => {
  const r = await reconcile(doc([company()]), [claim({ value: 1e8 })]);
  assert.equal(r.proposals.length, 0);
  assert.equal(r.conflicts.length, 0);
});

await test('a claim for an unknown company is dropped', async () => {
  const r = await reconcile(doc([company()]), [claim({ companyId: 'ghost' })]);
  assert.equal(r.proposals.length, 0);
  assert.equal(r.skipped[0].reason, 'unknown company');
});

await test('more than five changes to one company escalates', async () => {
  const fields = ['lastRound.postMoneyUsd', 'lastRound.amountUsd', 'lastRound.series',
                  'lastRound.date', 'metrics.totalRaisedUsd', 'traction'];
  const r = await reconcile(doc([company()]),
    fields.map((f, i) => claim({ field: f, value: `v${i}` })));
  assert.equal(r.escalations.length, 1);
  assert.equal(r.escalations[0].count, 6);
});

await test('trade press fills a blank but never replaces a figure; aggregators only discover', async () => {
  const d = doc([company({ lastRound: { ...company().lastRound, leads: [] } })]);
  const r = await reconcile(d, [
    claim({ tier: 2 }),
    claim({ tier: 2, field: 'lastRound.leads', value: ['Big Fund'] }),
    claim({ tier: 3, field: 'traction', value: '1M users' }),
  ]);
  assert.deepEqual(r.proposals.map(p => p.field), ['lastRound.leads']);
  assert.match(r.conflicts[0].reason, /tier-2 source would replace/);
  assert.match(r.skipped[0].reason, /discovery only/);
});

await test('a traction update never re-cites the round', async () => {
  const d = doc([company()]);
  run(d, [claim({ field: 'traction', value: '1M weekly users', sourceUrl: 'https://f.test/6' })]);
  const c = d.companies[0];
  assert.equal(c.traction, '1M weekly users');
  assert.equal(c.lastRound.source.url, 'https://a.test/1');
  assert.equal(c.news[0].url, 'https://f.test/6', 'its article joins the coverage');
});

await test('a funding total takes its own citation, not the round\'s', async () => {
  const d = doc([company()]);
  run(d, [claim({ field: 'metrics.totalRaisedUsd', value: 3e7, sourceUrl: 'https://g.test/7' })]);
  const c = d.companies[0];
  assert.deepEqual(c.metrics.totalRaisedSource, { url: 'https://g.test/7', publisher: 'New Wire', date: '2026-09-01' });
  assert.equal(c.metrics.totalRaisedConfidence, 'reported');
  assert.equal(c.lastRound.source.url, 'https://a.test/1');
});

await test('updating the round keeps the valuation on the citation that supports it', async () => {
  const d = doc([company({ lastRound: { ...company().lastRound, confidence: 'estimated', note: 'Secondary pricing.' } })]);
  run(d, [claim({ field: 'lastRound.amountUsd', value: 1.2e7, sourceUrl: 'https://h.test/8' })]);
  const round = d.companies[0].lastRound;
  assert.equal(round.source.url, 'https://h.test/8');
  assert.equal(round.postMoneySource.url, 'https://a.test/1');
  assert.equal(round.postMoneyConfidence, 'estimated', 'an estimate stays an estimate');
});

await test('a new round clears the old round\'s figures and says so in the PR', async () => {
  const d = doc([company()]);
  const { result, applied, cleared } = run(d, [
    claim({ field: 'lastRound.series', value: 'Series B', sourceUrl: 'https://i.test/9' }),
    claim({ field: 'lastRound.amountUsd', value: 4e7, sourceUrl: 'https://i.test/9' }),
    claim({ field: 'lastRound.date', value: '2026-09-01', sourceUrl: 'https://i.test/9' }),
  ]);
  const round = d.companies[0].lastRound;
  assert.equal(applied.length, 3);
  assert.equal(round.series, 'Series B');
  assert.equal(round.postMoneyUsd, null, 'the Series A valuation does not ride along');
  assert.deepEqual(round.leads, []);
  assert.equal(round.source.url, 'https://i.test/9');
  assert.deepEqual(cleared.map(x => x.field), ['lastRound.postMoneyUsd', 'lastRound.leads']);
  assert.match(prBody(d, result, { applied, cleared }), /previous round and was cleared/);
});

await test('a new round on a company with locked round fields escalates', async () => {
  const r = await reconcile(doc([company({ locked: ['lastRound.postMoneyUsd'] })]), [claim({ field: 'lastRound.series', value: 'Series B' })]);
  assert.equal(r.escalations.length, 1);
  assert.match(r.escalations[0].reason, /locked/);
});

await test('a reported source upgrades a rumored valuation that matches it', async () => {
  const rumored = { ...company().lastRound, postMoneyUsd: 1e9, postMoneyConfidence: 'rumored',
    postMoneySource: { url: 'https://scoop.test/talks', publisher: 'Scoop', date: '2026-08-01' } };
  const d = doc([company({ lastRound: rumored })]);
  const { result, applied, cleared } = run(d, [claim({ value: 1e9, sourceUrl: 'https://wire.test/closed', publisher: 'Wire' })]);
  const round = d.companies[0].lastRound;
  assert.equal(applied.length, 1);
  assert.equal(round.postMoneyConfidence, 'reported');
  assert.equal(round.postMoneySource.url, 'https://wire.test/closed');
  assert.match(prBody(d, result, { applied, cleared }), /confirmed at \*\*\$1B\*\*, now reported/);
  // Trade press does not upgrade it; only tier-1 reporting does.
  const again = reconcile(doc([company({ lastRound: rumored })]), [claim({ value: 1e9, tier: 2 })]);
  assert.equal(again.proposals.length, 0);
});

await test('a new round keeps a figure it restates instead of clearing it', async () => {
  const d = doc([company({ lastRound: { ...company().lastRound, postMoneyUsd: 1e9, postMoneyConfidence: 'rumored' } })]);
  const { cleared } = run(d, [
    claim({ field: 'lastRound.series', value: 'Series B', sourceUrl: 'https://wire.test/b' }),
    claim({ field: 'lastRound.postMoneyUsd', value: 1e9, sourceUrl: 'https://wire.test/b' }),
  ]);
  const round = d.companies[0].lastRound;
  assert.equal(round.series, 'Series B');
  assert.equal(round.postMoneyUsd, 1e9);
  assert.equal(round.postMoneyConfidence, 'reported');
  assert.ok(!cleared.some(x => x.field === 'lastRound.postMoneyUsd'));
});

await test('applied changes keep the file valid: the snapshot date moves, old coverage stays', async () => {
  const news = Array.from({ length: 5 }, (_, i) => ({ title: `Story ${i}`, url: `https://n.test/${i}`, publisher: 'Pub', date: '2026-08-0' + (i + 1) }));
  const d = doc([company({ news })]);
  run(d, [claim({ sourceDate: '2026-09-18' })], '2026-09-20');
  const c = d.companies[0];
  assert.equal(d.market.asOf, '2026-09-20');
  assert.equal(c.news.length, 6, 'no story was dropped');
  assert.equal(c.news[0].title, 'Acme is now worth $500M', 'coverage is titled with the headline');
  assert.deepEqual(validateMarket(d).errors, []);
});

await test('parses RSS and Atom feeds alike, keeping the feed summary', () => {
  const rss = `<rss><channel>
    <item><title>Acme raises $50M</title><link>https://a.test/x</link><pubDate>Mon, 01 Sep 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Acme raised <b>$50M</b>.</p>]]></description></item>
  </channel></rss>`;
  const atom = `<feed><entry><title>Beta launches</title><link href="https://b.test/y"/><updated>2026-09-02T00:00:00Z</updated></entry></feed>`;
  const a = parseFeed(rss), b = parseFeed(atom);
  assert.equal(a.length, 1);
  assert.equal(a[0].url, 'https://a.test/x');
  assert.equal(a[0].summary, 'Acme raised $50M .');
  assert.equal(b.length, 1);
  assert.equal(b[0].url, 'https://b.test/y');
});

console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}.\n`);
