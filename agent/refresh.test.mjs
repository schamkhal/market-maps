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
import { reconcile, parseFeed } from './refresh.mjs';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
};

const company = (over = {}) => ({
  id: 'acme', name: 'Acme', company: 'Acme', class: 'independent',
  description: 'A personal agent that does things for you across your life.',
  axes: { autonomy: { score: 50 }, breadth: { score: 50 }, distribution: { score: 50 } },
  lastRound: { series: 'Series A', amountUsd: 1e7, postMoneyUsd: 1e8, date: '2026-01-01',
               leads: [], otherInvestors: [], confidence: 'reported',
               source: { url: 'https://a.test/1', publisher: 'Old Wire', date: '2026-01-01' } },
  metrics: { totalRaisedUsd: 1e7 }, news: [], locked: [], lastVerified: '2026-01-01',
  ...over,
});
const doc = cs => ({ schemaVersion: 1, market: { asOf: '2026-09-12' }, companies: cs });
const claim = (over = {}) => ({
  companyId: 'acme', field: 'lastRound.postMoneyUsd', value: 5e8,
  sourceUrl: 'https://b.test/2', publisher: 'New Wire', sourceDate: '2026-09-01', ...over,
});

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

await test('conflicting sources are flagged, never silently picked', async () => {
  const r = await reconcile(doc([company()]), [
    claim({ value: 5e8, publisher: 'Wire A' }),
    claim({ value: 9e8, publisher: 'Wire B' }),
  ]);
  assert.equal(r.proposals.length, 1);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].a.value, 5e8);
  assert.equal(r.conflicts[0].b.value, 9e8);
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

await test('parses RSS and Atom feeds alike', () => {
  const rss = `<rss><channel>
    <item><title>Acme raises $50M</title><link>https://a.test/x</link><pubDate>Mon, 01 Sep 2026 10:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const atom = `<feed><entry><title>Beta launches</title><link href="https://b.test/y"/><updated>2026-09-02T00:00:00Z</updated></entry></feed>`;
  const a = parseFeed(rss), b = parseFeed(atom);
  assert.equal(a.length, 1);
  assert.equal(a[0].url, 'https://a.test/x');
  assert.equal(b.length, 1);
  assert.equal(b[0].url, 'https://b.test/y');
});

console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}.\n`);
