import test from 'node:test';
import assert from 'node:assert/strict';
import { bubbleRadius, valueLabel, valueConfidence, tooltipLines, readState, stateQuery, filterCompanies, sortCompanies, researchArticles } from './map-model.mjs';

test('bubble areas preserve a 60:1 valuation ratio, without saturating', () => {
  const big = bubbleRadius({ valuation: 6e9 }, 'valuation', 6e9);
  const small = bubbleRadius({ valuation: 1e8 }, 'valuation', 6e9);
  assert.ok(Math.abs((big * big) / (small * small) - 60) < 1e-10);
  assert.notEqual(big, bubbleRadius({ valuation: 1e9 }, 'valuation', 6e9));
});
test('undisclosed independent values are never labeled as platform products', () => {
  assert.equal(valueLabel({ cls: 'independent', valuation: null }), 'Undisclosed');
  assert.equal(valueLabel({ cls: 'platform', valuation: null }), 'Platform product');
});
test('map labels use platform names in every bubble-size mode without displaying parent financials', () => {
  const platforms = [
    ['Alphabet', 'Google'], ['Meta Platforms', 'Meta'], ['Perplexity', 'Perplexity'],
    ['OpenAI', 'OpenAI'], ['Anthropic', 'Anthropic'], ['Amazon', 'Amazon'],
    ['Apple', 'Apple'], ['SpaceXAI', 'SpaceXAI'],
  ];
  for (const [company, label] of platforms) {
    for (const size of ['valuation', 'raised', 'equal']) {
      assert.equal(valueLabel({ cls: 'platform', company, valuation: 1e12, raised: 1e9 }, size), label);
    }
  }
  assert.equal(valueLabel({ cls: 'platform', company: '  OpenAI  ' }), 'OpenAI');
  assert.equal(valueLabel({ cls: 'platform', company: '  ' }), 'Platform product');
});
test('valuation confidence overrides round confidence and retains estimates', () => {
  const c = { cls: 'independent', valuation: 30e6, conf: 'reported', valConf: 'manual' };
  assert.equal(valueConfidence(c), 'manual');
  assert.equal(valueLabel(c), '$30M *');
  assert.equal(valueLabel({ ...c, valConf: 'estimated' }), '$30M est.');
  assert.equal(valueConfidence({ ...c, valuation: null }), 'undisclosed');
});
test('platform tooltips show the platform name once and never repeat the generic ownership label', () => {
  const platforms = [
    ['Alphabet', 'Google'], ['Meta Platforms', 'Meta'], ['Perplexity', 'Perplexity'],
    ['OpenAI', 'OpenAI'], ['Anthropic', 'Anthropic'], ['Amazon', 'Amazon'],
    ['Apple', 'Apple'], ['SpaceXAI', 'SpaceXAI'],
  ];
  for (const [company, label] of platforms) {
    for (const size of ['valuation', 'raised', 'equal']) {
      assert.deepEqual(tooltipLines({ cls: 'platform', cat: 'executive', company }, size), ['Personal assistants', label]);
    }
  }
  assert.deepEqual(tooltipLines({ cls: 'platform', cat: 'workflow' }), ['Work & productivity', 'Platform product']);
});
test('non-platform tooltips retain ownership, financial values, and confidence', () => {
  const company = { cls: 'independent', cat: 'executive', valuation: 30e6, raised: 5.2e6, conf: 'reported', valConf: 'manual' };
  assert.deepEqual(tooltipLines(company), ['Personal assistants · Independent', '$30M * · Manual · no source']);
  assert.deepEqual(tooltipLines(company, 'raised'), ['Personal assistants · Independent', '$5.2M raised']);
  assert.deepEqual(tooltipLines({ ...company, cls: 'acquired', valuation: null }), ['Personal assistants · Acquired', 'Undisclosed']);
});
test('explicit views and all chart options survive a link opened on another device', () => {
  const state = readState('?view=map&cat=workflow&owner=independent&q=calendar&axis=distribution&size=raised&sort=valuation&company=motion', true);
  assert.deepEqual(readState('?' + stateQuery(state), false), state);
  assert.equal(readState('?' + stateQuery(state), true).view, 'map');
  assert.equal(readState('', true).view, 'table');
});
test('invalid URL settings recover to visible defaults', () => {
  const state = readState('?view=bad&axis=constructor&size=bad&cat=bad&owner=bad&sort=bad');
  assert.deepEqual([state.view,state.axis,state.size,state.category,state.ownership,state.sort], ['map','breadth','valuation','all','all','autonomy']);
});
test('search supports aliases and combines terms with ownership and category', () => {
  const c = { id:'c', name:'Agent', company:'Agent Co', desc:'Memory and calendar', aliases:['Old Name'], cls:'independent', cat:'knowledge' };
  const state = { ...readState(''), category:'knowledge', ownership:'independent', query:'old calendar' };
  assert.deepEqual(filterCompanies([c], state), [c]);
  assert.deepEqual(filterCompanies([c], { ...state, ownership:'platform' }), []);
});
test('valuation sorting puts unknown and platform figures after stated values', () => {
  const rows = [{id:'unknown',name:'A',valuation:null},{id:'small',name:'B',valuation:10},{id:'large',name:'C',valuation:100},{id:'platform',name:'D',cls:'platform',valuation:null}];
  assert.deepEqual(sortCompanies(rows,'valuation').map(c=>c.id), ['large','small','unknown','platform']);
});
test('research merges shared URLs and selects recent unique-company coverage', () => {
  const story = (u,d,t='Story') => ({u,d,t,p:'Source'});
  const companies = [
    {id:'a',name:'A',news:[story('https://example.org/older','2026-01-01'),story('https://example.org/shared/','2026-09-12')]},
    {id:'b',name:'B',news:[story('https://example.org/shared/?utm_source=test','2026-09-12')]},
    {id:'c',name:'C',news:[story('https://example.org/other','2026-09-10')]},
  ];
  const articles = researchArticles(companies);
  assert.equal(articles.length,2);
  assert.deepEqual(articles[0].companies.map(c=>c.id),['a','b']);
  assert.equal(articles[0].d,'2026-09-12');
});
