import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyEdits, editableFields } from './edit-company.mjs';
import { validateMarket } from './validate-market.mjs';

const dataset = JSON.parse(fs.readFileSync(new URL('../../data/markets/personal-ai-agents.json', import.meta.url), 'utf8'));
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
// What the browser posts when nothing is touched: every field's current value.
const untouched = (doc, id) => {
  const c = doc.companies.find(x => x.id === id);
  return Object.fromEntries(editableFields(doc.market).map(f => [f.path, get(c, f.path) == null ? '' : String(get(c, f.path))]));
};
const save = (id, change = {}, locked) => {
  const doc = structuredClone(dataset);
  const c = doc.companies.find(x => x.id === id);
  const result = applyEdits(doc, { id, values: { ...untouched(doc, id), ...change }, locked: locked ?? c.locked }, { today: '2026-09-26' });
  return { doc, company: result.company, notes: result.notes, errors: validateMarket(doc).errors };
};

test('saving a company unchanged leaves the file valid and the company as it was', () => {
  for (const c of dataset.companies) {
    const { company, errors } = save(c.id);
    assert.deepEqual(errors, [], c.id);
    assert.deepEqual({ ...company, lastVerified: c.lastVerified }, c, `${c.id} changed on an untouched save`);
  }
});
test('a sourceless company never gains a hollow source object', () => {
  // The bug this module replaced: saving a company with no source wrote { url: null, publisher: null, date: null }.
  for (const id of ['lindy', 'wajo']) assert.equal(save(id).company.lastRound.source, null, id);
});
test('a valuation typed by hand is marked manual and locked, and needs its note', () => {
  const { company, notes, errors } = save('hark', { 'lastRound.postMoneyUsd': '7000000000', 'lastRound.note': '' });
  assert.equal(company.lastRound.postMoneyConfidence, 'manual');
  assert.ok(company.locked.includes('lastRound.postMoneyUsd'));
  assert.match(notes.join('\n'), /marked manual/);
  assert.match(errors.map(e => e.msg).join('\n'), /manual valuation must carry a note/, 'validation still asks what the figure is based on');
  const explained = save('hark', { 'lastRound.postMoneyUsd': '7000000000', 'lastRound.note': 'Founder told us directly.' });
  assert.deepEqual(explained.errors, []);
});
test('a new figure that arrives with its own source keeps its confidence', () => {
  const { company, notes } = save('hark', {
    'lastRound.postMoneyUsd': '7000000000',
    'lastRound.source.url': 'https://news.example/hark-7b', 'lastRound.source.publisher': 'Wire', 'lastRound.source.date': '2026-09-20',
  });
  assert.equal(company.lastRound.postMoneyConfidence, null);
  assert.ok(!company.locked.includes('lastRound.postMoneyUsd'));
  assert.deepEqual(notes, []);
});
test('a hand-typed funding total is manual and locked too', () => {
  const { company } = save('folk', { 'metrics.totalRaisedUsd': '80000000' });
  assert.equal(company.metrics.totalRaisedConfidence, 'manual');
  assert.ok(company.locked.includes('metrics.totalRaisedUsd'));
});
test('clearing every source field removes the source', () => {
  const { company } = save('hark', { 'lastRound.source.url': '', 'lastRound.source.publisher': '', 'lastRound.source.date': '' });
  assert.equal(company.lastRound.source, null);
});
test('score fields follow the market axes', () => {
  const paths = editableFields(dataset.market).map(f => f.path);
  for (const axis of ['autonomy', 'breadth', 'distribution']) {
    assert.ok(paths.includes(`axes.${axis}.score`));
    assert.ok(paths.includes(`axes.${axis}.rationale`));
  }
});
