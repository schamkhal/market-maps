import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateMarket } from './validate-market.mjs';

const MARKETS = new URL('../../data/markets/', import.meta.url);
const published = fs.readdirSync(MARKETS).filter(f => f.endsWith('.json')).map(f => [f, JSON.parse(fs.readFileSync(new URL(f, MARKETS), 'utf8'))]);

// The smallest document every rule is happy with; each test breaks one thing.
const company = (over = {}) => ({
  id: 'acme', name: 'Acme', company: 'Acme', class: 'independent', category: 'work', region: 'US',
  description: 'A personal agent that does things for you across your life.',
  axes: { autonomy: { score: 50, rationale: 'Acts on delegated tasks.' }, breadth: { score: 50, rationale: 'Mail and calendar.' } },
  lastRound: {
    series: 'Seed', amountUsd: 5e6, postMoneyUsd: 2e7, date: '2026-01-01', leads: [], otherInvestors: [],
    confidence: 'reported', source: { url: 'https://news.test/acme', publisher: 'Wire', date: '2026-01-01' },
  },
  metrics: { totalRaisedUsd: 5e6 }, news: [], checks: [], locked: [], lastVerified: '2026-09-20',
  ...over,
});
const doc = (companies = [company()], market = {}) => ({
  schemaVersion: 1,
  market: {
    id: 'test-map', name: 'Test map', definition: 'Agents that act for one person.', inclusion: ['Acts for you'],
    regions: ['US'], asOf: '2026-09-26',
    axes: {
      x: { key: 'autonomy', label: 'Autonomy', rubric: '0 = prompted every time; 100 = acts unprompted' },
      y: { key: 'breadth', label: 'Breadth', rubric: '0 = one surface; 100 = the whole of a life' },
    },
    categories: [{ id: 'work', name: 'Work', color: '#25806a', description: 'Agents for work and planning.' }],
    ...market,
  },
  companies,
});
const errorsOf = d => validateMarket(d).errors.map(e => e.msg);
const round = over => ({ ...company().lastRound, ...over });

test('every published dataset passes every rule', () => {
  for (const [file, doc] of published) assert.deepEqual(validateMarket(doc).errors, [], file);
  assert.deepEqual(errorsOf(doc()), []);
});
test('a reported figure without a source fails (rule 1)', () => {
  assert.match(errorsOf(doc([company({ lastRound: round({ source: null }) })])).join('\n'), /no source is attached/);
});
test('a hand-entered valuation must be explained and locked (rules 4, 4b)', () => {
  const manual = company({ lastRound: round({ postMoneyConfidence: 'manual' }) });
  const errs = errorsOf(doc([manual])).join('\n');
  assert.match(errs, /manual valuation must carry a note/);
  assert.match(errs, /must be locked/);
  const fixed = company({ lastRound: round({ postMoneyConfidence: 'manual', note: 'Founder-provided.' }), locked: ['lastRound'] });
  assert.deepEqual(errorsOf(doc([fixed])), [], 'a lock on the parent path counts');
});
test('only http(s) links can be published', () => {
  const bad = company({ news: [{ title: 'Story', url: 'javascript:alert(1)', publisher: 'X', date: '2026-01-01' }] });
  assert.match(errorsOf(doc([bad])).join('\n'), /must match pattern/);
  assert.match(errorsOf(doc([company({ website: 'data:text/html,hi' })])).join('\n'), /website/);
});
test('an empty source object is rejected rather than read as a citation', () => {
  // What the admin editor used to write when a sourceless company was saved.
  const hollow = company({ lastRound: round({ confidence: 'undisclosed', source: { url: null, publisher: null, date: null } }) });
  assert.match(errorsOf(doc([hollow])).join('\n'), /source\/url must be string/);
});
test('scores must match the market axes exactly (rule 12)', () => {
  const missing = company({ axes: { autonomy: { score: 10, rationale: 'x' } } });
  assert.match(errorsOf(doc([missing])).join('\n'), /no score for axis breadth/);
  const extra = company({ axes: { ...company().axes, vibes: { score: 90 } } });
  assert.match(errorsOf(doc([extra])).join('\n'), /scores axis vibes/);
});
test('companies outside the region scope fail (rule 13)', () => {
  assert.match(errorsOf(doc([company({ region: 'SG' })])).join('\n'), /outside the map's scope \(US\)/);
});
test('total funding obeys the same provenance rules as a valuation (rules 14, 15)', () => {
  const small = company({ metrics: { totalRaisedUsd: 1e6 } });
  assert.match(errorsOf(doc([small])).join('\n'), /smaller than the last round/);
  const manual = company({ metrics: { totalRaisedUsd: 9e6, totalRaisedConfidence: 'manual' } });
  assert.match(errorsOf(doc([manual])).join('\n'), /manual total funding must be locked/);
  assert.deepEqual(errorsOf(doc([{ ...manual, locked: ['metrics.totalRaisedUsd'] }])), []);
  const claimed = company({ metrics: { totalRaisedUsd: 9e6, totalRaisedConfidence: 'reported' } });
  assert.match(errorsOf(doc([claimed])).join('\n'), /no totalRaisedSource/);
  const unsourced = validateMarket(doc([company()])).warnings.map(w => w.msg).join('\n');
  assert.match(unsourced, /1 total-funding figures have no recorded source \(acme\)/);
});
test('platforms carry neither a valuation nor their parent\'s funding (rule 3)', () => {
  const platform = company({ class: 'platform', parent: 'Big Co — public.', brand: 'Big', metrics: { totalRaisedUsd: 1e9 } });
  const errs = errorsOf(doc([platform])).join('\n');
  assert.match(errs, /must not carry a post-money valuation/);
  assert.match(errs, /must not carry total funding/);
});
test('dates after the snapshot fail, including the round source (rule 6)', () => {
  const late = company({ lastRound: round({ source: { url: 'https://news.test/x', publisher: 'Wire', date: '2026-10-01' } }) });
  assert.match(errorsOf(doc([late])).join('\n'), /lastRound.source.date 2026-10-01 is after market.asOf/);
});
test('a verification visit filed as news fails (rule 10)', () => {
  const check = company({ news: [{ title: 'Pricing page — checked September 26, 2026', url: 'https://acme.test/', publisher: 'Acme', date: '2026-09-26' }] });
  assert.match(errorsOf(doc([check])).join('\n'), /is a verification check/);
});
test('an acquisition price must be stated and explained (rule 16)', () => {
  const deal = over => company({ lastRound: round({ postMoneyBasis: 'acquisition', postMoneyUsd: 8.2e9, ...over }) });
  assert.match(errorsOf(doc([deal()])).join('\n'), /acquisition price must carry a note/);
  assert.match(errorsOf(doc([deal({ postMoneyUsd: null, note: 'AMD deal.' })])).join('\n'), /no valuation is stated/);
  assert.deepEqual(errorsOf(doc([deal({ note: 'AMD agreed to buy it; not yet closed.' })])), []);
});
test('every score carries its reasoning (rule 8)', () => {
  const bare = company({ axes: { ...company().axes, breadth: { score: 50 } } });
  assert.match(errorsOf(doc([bare])).join('\n'), /no rationale on the breadth score/);
  const blank = company({ axes: { ...company().axes, autonomy: { score: 50, rationale: '  ' } } });
  assert.match(errorsOf(doc([blank])).join('\n'), /no rationale on the autonomy score/);
});
