import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CATEGORIES, configureCategories, configureAxes, AXES, AXIS_NAMES, bubbleRadius, legendReferences, MIN_RADIUS, MAX_RADIUS, UNDISCLOSED_RADIUS, LOG_FLOOR, valueLabel, valueConfidence, raisedConfidence, tooltipLines, readState, stateQuery, filterCompanies, sortCompanies, researchArticles, money, initials, labelFor, heroStats, safeUrl, rubricSteps, isCaveat, markRadius, RING_GAP } from './map-model.mjs';

// The same categories the dataset declares, so tests read like the live map.
const dataset = JSON.parse(fs.readFileSync(new URL('../data/markets/personal-ai-agents.json', import.meta.url), 'utf8'));
configureCategories(dataset.market.categories);
configureAxes(dataset.market.axes);

test('categories come from the dataset, with "all" kept first', () => {
  assert.deepEqual(Object.keys(CATEGORIES), ['all', ...dataset.market.categories.map(c => c.id)]);
  assert.equal(CATEGORIES.executive.name, 'Personal assistants');
  configureCategories([{ id: 'x', name: 'X', color: '#000000', description: 'Only X here.' }]);
  assert.deepEqual(Object.keys(CATEGORIES), ['all', 'x']);
  configureCategories(dataset.market.categories);
});
test('money rounds to one decimal place and never pads with zeros', () => {
  assert.equal(money(30e6), '$30M');
  assert.equal(money(5.2e6), '$5.2M');
  assert.equal(money(99.8e6), '$99.8M');
  assert.equal(money(2.5e9), '$2.5B');
  assert.equal(money(6e9), '$6B');
  assert.equal(money(53.62e6), '$53.6M');
  assert.equal(money(14.38e6), '$14.4M');
  assert.equal(money(59.72e6), '$59.7M');
  assert.equal(money(1.23e9), '$1.2B');
  assert.equal(money(null), 'Unknown');
});
test('bubble size follows orders of magnitude, each tenfold step a little bigger than the last', () => {
  const r = v => bubbleRadius({ valuation: v }, 'valuation', 1e10);
  assert.equal(r(1e10), MAX_RADIUS);
  assert.equal(r(LOG_FLOOR), MIN_RADIUS);
  const steps = [r(1e8) - r(1e7), r(1e9) - r(1e8), r(1e10) - r(1e9)];
  assert.ok(steps[0] > 0 && steps[1] > steps[0] && steps[2] > steps[1], `steps grow: ${steps.map(s => s.toFixed(2))}`);
  assert.ok(r(5e9) > r(1e9) && r(5e9) < r(1e10));
});
test('a disclosed figure never draws smaller than an undisclosed mark', () => {
  const tiny = bubbleRadius({ cls: 'independent', valuation: 2e6 }, 'valuation', 6e9);
  const unknown = bubbleRadius({ cls: 'independent', valuation: null }, 'valuation', 6e9);
  assert.equal(unknown, UNDISCLOSED_RADIUS);
  assert.equal(tiny, MIN_RADIUS, 'at or under the floor, a figure draws at the minimum');
  assert.ok(tiny > unknown);
  // A narrow chart shrinks the range but keeps the floor.
  assert.ok(bubbleRadius({ valuation: 1e10 }, 'valuation', 1e10, MAX_RADIUS * .55) < MAX_RADIUS);
  assert.equal(bubbleRadius({ valuation: 1e6 }, 'valuation', 1e10, MAX_RADIUS * .55), MIN_RADIUS);
});
test('legend references are the tenfold steps from the floor to the largest figure', () => {
  assert.deepEqual(legendReferences(1e10), [1e7, 1e8, 1e9, 1e10]);
  assert.deepEqual(legendReferences(8.2e9), [1e7, 1e8, 1e9]);
  assert.deepEqual(legendReferences(5e6), [5e6]);
  assert.deepEqual(legendReferences(0), []);
});
test('initials ignore parentheticals and punctuation', () => {
  const cases = [['Comet (Perplexity)', 'C'], ['Claude (Cowork)', 'C'], ['Wajo / Fo', 'WF'], ['Ohai.ai', 'O'], ['Alexa+', 'A'], ['Superhuman Mail', 'SM'], ['Hark', 'H']];
  for (const [name, expected] of cases) assert.equal(initials({ name }), expected, name);
  assert.equal(initials({ name: '()' }), '?');
});
test('map labels prefer a short name when the dataset gives one', () => {
  assert.equal(labelFor({ name: 'Comet (Perplexity)', shortName: 'Comet' }), 'Comet');
  assert.equal(labelFor({ name: 'Hark', shortName: null }), 'Hark');
});
test('undisclosed independent values are never labeled as platform products', () => {
  assert.equal(valueLabel({ cls: 'independent', valuation: null }), '', 'the empty circle says it on the chart');
  assert.equal(valueLabel({ cls: 'independent', valuation: null }, 'valuation', { verbose: true }), '', 'nor is it a word in the tooltip');
  assert.equal(valueLabel({ cls: 'platform', valuation: null }), 'Platform product');
});
test('platform labels use the dataset brand in every bubble-size mode, never parent financials', () => {
  const platforms = dataset.companies.filter(c => c.class === 'platform');
  assert.ok(platforms.length > 0);
  for (const c of platforms) {
    for (const size of ['valuation', 'raised', 'equal']) {
      assert.equal(valueLabel({ cls: 'platform', company: c.company, brand: c.brand, valuation: 1e12, raised: 1e9 }, size), c.brand);
    }
  }
  assert.equal(valueLabel({ cls: 'platform', company: 'Alphabet', brand: 'Google' }), 'Google');
  assert.equal(valueLabel({ cls: 'platform', company: '  OpenAI  ' }), 'OpenAI');
  assert.equal(valueLabel({ cls: 'platform', company: '  ' }), 'Platform product');
});
test('valuation confidence overrides round confidence and retains estimates', () => {
  const c = { cls: 'independent', valuation: 30e6, conf: 'reported', valConf: 'manual' };
  assert.equal(valueConfidence(c), 'manual');
  assert.equal(valueLabel(c), '$30M', 'a manual figure reads as a plain figure on the map');
  assert.equal(valueLabel({ ...c, valConf: 'estimated' }), '$30M', 'estimates are unmarked on the chart');
  assert.deepEqual(tooltipLines({ ...c, cat: 'executive', valConf: 'estimated' })[1], '$30M · Estimate', 'the tooltip says so');
  assert.equal(valueConfidence({ ...c, valuation: null }), 'undisclosed');
});
test('platform tooltips show the brand once and never repeat the generic ownership label', () => {
  for (const [brand, cat, category] of [['Google', 'workflow', 'Work & productivity'], ['Meta', 'executive', 'Personal assistants']]) {
    for (const size of ['valuation', 'raised', 'equal']) {
      assert.deepEqual(tooltipLines({ cls: 'platform', cat, brand }, size), [category, brand]);
    }
  }
  assert.deepEqual(tooltipLines({ cls: 'platform', cat: 'workflow' }), ['Work & productivity', 'Platform product']);
});
test('non-platform tooltips retain ownership, financial values, and confidence', () => {
  const company = { cls: 'independent', cat: 'executive', valuation: 30e6, raised: 5.2e6, conf: 'reported', valConf: 'manual' };
  assert.deepEqual(tooltipLines(company), ['Personal assistants · Independent', '$30M'], 'the manual note lives on the profile');
  assert.deepEqual(tooltipLines(company, 'raised'), ['Personal assistants · Independent', '$5.2M raised']);
  // An undisclosed figure leaves its line out: the hollow mark already says it.
  assert.deepEqual(tooltipLines({ ...company, cls: 'acquired', valuation: null }), ['Personal assistants · Acquired']);
  assert.deepEqual(tooltipLines({ ...company, raised: null }, 'raised'), ['Personal assistants · Independent']);
});
test('hero stats sum latest rounds in the snapshot year, count recent ones, and skip acquisitions', () => {
  const rows = [
    { cls: 'independent', lastDate: '2026-09-01', lastAmount: 10 },
    { cls: 'independent', lastDate: '2026-02-01', lastAmount: 5 },
    { cls: 'independent', lastDate: '2025-12-31', lastAmount: 100 },
    { cls: 'independent', lastDate: null, lastAmount: null },
    { cls: 'platform', lastDate: '2026-09-10', lastAmount: 1e9 },
    { cls: 'acquired', lastSeries: 'Acquired', lastDate: '2026-09-02', lastAmount: null },
  ];
  assert.deepEqual(heroStats(rows, '2026-09-26'), { tracked: 6, year: 2026, raisedThisYear: 15, roundsThisYear: 2, recentRounds: 1, platforms: 1 });
});
test('explicit views and all chart options survive a link opened on another device', () => {
  const state = readState('?view=map&cat=workflow&owner=independent&q=calendar&axis=distribution&size=raised&sort=valuation&company=motion', true);
  assert.deepEqual(readState('?' + stateQuery(state), false), state);
  assert.equal(readState('?' + stateQuery(state), true).view, 'map');
  assert.equal(readState('', true).view, 'table');
});
test('invalid URL settings recover to visible defaults', () => {
  const state = readState('?view=bad&axis=constructor&size=bad&cat=bad&owner=bad&sort=bad');
  assert.deepEqual([state.view, state.axis, state.size, state.category, state.ownership, state.sort], ['map', 'breadth', 'valuation', 'all', 'all', 'autonomy']);
  // A category retired from the dataset falls back to "all" rather than an empty view.
  assert.equal(readState('?cat=knowledge').category, 'all');
});
test('search supports aliases, brands and short names, combined with ownership and category', () => {
  const c = { id: 'c', name: 'Agent', company: 'Agent Co', brand: 'Brandly', shortName: 'Ag', desc: 'Memory and calendar', aliases: ['Old Name'], cls: 'independent', cat: 'workflow' };
  const state = { ...readState(''), category: 'workflow', ownership: 'independent', query: 'old calendar' };
  assert.deepEqual(filterCompanies([c], state), [c]);
  assert.deepEqual(filterCompanies([c], { ...state, query: 'brandly' }), [c]);
  assert.deepEqual(filterCompanies([c], { ...state, ownership: 'platform' }), []);
});
test('valuation sorting puts unknown and platform figures after stated values', () => {
  const rows = [{ id: 'unknown', name: 'A', valuation: null }, { id: 'small', name: 'B', valuation: 10 }, { id: 'large', name: 'C', valuation: 100 }, { id: 'platform', name: 'D', cls: 'platform', valuation: null }];
  assert.deepEqual(sortCompanies(rows, 'valuation').map(c => c.id), ['large', 'small', 'unknown', 'platform']);
});
test('research merges shared URLs and selects recent unique-company coverage', () => {
  const story = (u, d, t = 'Story') => ({ u, d, t, p: 'Source' });
  const companies = [
    { id: 'a', name: 'A', news: [story('https://example.org/older', '2026-01-01'), story('https://example.org/shared/', '2026-09-12')] },
    { id: 'b', name: 'B', news: [story('https://example.org/shared/?utm_source=test', '2026-09-12')] },
    { id: 'c', name: 'C', news: [story('https://example.org/other', '2026-09-10')] },
  ];
  const articles = researchArticles(companies);
  assert.equal(articles.length, 2);
  assert.deepEqual(articles[0].companies.map(c => c.id), ['a', 'b']);
  assert.equal(articles[0].d, '2026-09-12');
});
test('verification checks never reach the research feed', () => {
  const companies = [{ id: 'a', name: 'A', news: [{ u: 'https://example.org/story', d: '2026-09-01', t: 'Story', p: 'Source' }], checks: [{ u: 'https://a.example/', d: '2026-09-26', t: 'Product availability', p: 'A' }] }];
  assert.deepEqual(researchArticles(companies).map(a => a.t), ['Story']);
});
test('the dataset keeps verification visits out of news', () => {
  const CHECK = /\bchecked\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\s*$/;
  for (const c of dataset.companies) for (const n of c.news ?? []) assert.ok(!CHECK.test(n.title), `${c.id}: ${n.title}`);
});
test('axes come from the dataset: labels, defaults and URL state follow market.axes', () => {
  assert.equal(AXES.x, 'autonomy');
  assert.deepEqual(AXES.y, ['breadth', 'distribution']);
  assert.equal(AXIS_NAMES.distribution, 'Distribution', 'a short label wins over the long one');
  configureAxes({
    x: { key: 'speed', label: 'Speed' },
    y: { key: 'reach', label: 'Reach' },
  });
  const state = readState('?axis=breadth&sort=autonomy');
  assert.equal(state.axis, 'reach', 'an axis the market does not define falls back');
  assert.equal(state.sort, 'speed');
  assert.equal(stateQuery(state), 'view=map', 'defaults stay out of the URL');
  assert.equal(readState('?sort=reach').sort, 'reach');
  configureAxes(dataset.market.axes);
});
test('total funding carries its own provenance on the map', () => {
  const wajo = { cls: 'independent', cat: 'executive', raised: 10e6, raisedConf: 'manual', valuation: 40e6, valConf: 'manual' };
  assert.equal(valueLabel(wajo, 'raised'), '$10M', 'chart labels drop "raised" and any manual marker');
  assert.deepEqual(tooltipLines(wajo, 'raised'), ['Personal assistants · Independent', '$10M raised']);
  // No recorded provenance: the figure shows, with no confidence it has not earned.
  const plain = { ...wajo, raisedConf: null };
  assert.equal(raisedConfidence(plain), null);
  assert.equal(valueLabel(plain, 'raised'), '$10M');
  assert.equal(valueLabel(plain, 'raised', { verbose: true }), '$10M raised');
  assert.equal(raisedConfidence({ cls: 'platform', raised: 1e9 }), 'undisclosed');
  // The dataset's hand-entered total reaches the page labelled as such.
  const wajoData = dataset.companies.find(c => c.id === 'wajo');
  assert.equal(wajoData.metrics.totalRaisedConfidence, 'manual');
});
test('funding sorts like valuation: platforms after every stated or unknown figure', () => {
  const rows = [{ id: 'p', name: 'P', cls: 'platform', raised: 9e9 }, { id: 'u', name: 'U', raised: null }, { id: 'a', name: 'A', raised: 5 }, { id: 'b', name: 'B', raised: 50 }];
  assert.deepEqual(sortCompanies(rows, 'raised').map(c => c.id), ['b', 'a', 'u', 'p']);
});
test('only web links are ever rendered as links', () => {
  assert.equal(safeUrl('https://example.org/a'), 'https://example.org/a');
  assert.equal(safeUrl(' http://example.org '), 'http://example.org');
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', '//evil.test', '', null]) assert.equal(safeUrl(bad), null, String(bad));
});
test('an acquisition price is plain on the chart and a deal in its tooltip', () => {
  const company = { cls: 'independent', cat: 'executive', valuation: 8.2e9, conf: 'reported', valConf: 'reported', valBasis: 'acquisition' };
  assert.equal(valueLabel(company), '$8.2B');
  assert.equal(valueLabel(company, 'valuation', { verbose: true }), '$8.2B deal');
  assert.deepEqual(tooltipLines(company), ['Personal assistants · Independent', '$8.2B deal']);
  // A reported figure is plain on the map; a caveat still shows.
  assert.equal(tooltipLines({ ...company, valBasis: undefined, valConf: 'estimated' })[1], '$8.2B · Estimate');
  assert.equal(tooltipLines({ ...company, valBasis: undefined, valConf: 'rumored' })[1], '$8.2B · Rumored');
  // Funding and equal-size labels are not about the deal.
  assert.equal(valueLabel({ ...company, raised: 1.25e9 }, 'raised'), '$1.3B');
  assert.equal(valueLabel({ ...company, valBasis: undefined }), '$8.2B');
});

test('a rubric splits into its anchored steps, one row each', () => {
  const steps = rubricSteps('0 = two surfaces, such as mail and calendar; 50 = all of one part of life: work (mail, calendar) or home; 100 = whole life');
  assert.deepEqual(steps, [
    { score: 0, text: 'Two surfaces, such as mail and calendar' },
    { score: 50, text: 'All of one part of life: work (mail, calendar) or home' },
    { score: 100, text: 'Whole life' },
  ]);
  assert.deepEqual(rubricSteps('Scored by hand'), [], 'a rubric without anchors stays a sentence');
  // Every axis on every map is spelled out in five steps.
  const worldModels = JSON.parse(fs.readFileSync(new URL('../data/markets/world-models.json', import.meta.url), 'utf8'));
  for (const doc of [dataset, worldModels]) for (const axis of [doc.market.axes.x, doc.market.axes.y, doc.market.axes.yAlt]) {
    assert.deepEqual(rubricSteps(axis.rubric).map(step => step.score), [0, 25, 50, 75, 100], `${doc.market.id} ${axis.key}`);
  }
});
test('only an estimate or a rumour earns a word beside a figure', () => {
  assert.deepEqual(['reported', 'estimated', 'rumored', 'manual', 'undisclosed', null].map(isCaveat), [false, true, true, false, false, false]);
});

test('an acquired company says what its figure is, and its ring takes room on the chart', () => {
  const poke = { cls: 'acquired', cat: 'executive', valuation: 3e8, raised: 2.5e7, conf: 'reported', valConf: 'reported' };
  assert.equal(valueLabel(poke), '$300M', 'the chart label stays plain');
  assert.equal(valueLabel(poke, 'valuation', { verbose: true }), '$300M before acquisition');
  assert.equal(valueLabel({ ...poke, valuation: 8.2e9, valBasis: 'acquisition' }, 'valuation', { verbose: true }), '$8.2B deal');
  assert.equal(valueLabel(poke, 'raised', { verbose: true }), '$25M raised');
  assert.deepEqual(tooltipLines(poke), ['Personal assistants · Acquired', '$300M before acquisition']);
  assert.equal(markRadius(poke, 'valuation', 1e10), bubbleRadius(poke, 'valuation', 1e10) + RING_GAP + 1);
  assert.equal(markRadius({ ...poke, cls: 'independent' }, 'valuation', 1e10), bubbleRadius(poke, 'valuation', 1e10));
});
