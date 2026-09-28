/**
 * Schema + editorial rules for one market document.
 *
 * Shared by the CLI (scripts/validate.mjs), the admin editor (which refuses to
 * write a file that fails), and the tests, so a rule is enforced the same way
 * wherever data changes. No file I/O beyond reading the schema once.
 */
import fs from 'node:fs';
import Ajv from 'ajv/dist/2020.js';   // the schema is draft 2020-12
import addFormats from 'ajv-formats';

const SCHEMA_URL = new URL('../../schema/market.schema.json', import.meta.url);
let compiled = null;
export function schemaValidator() {
  if (!compiled) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    compiled = ajv.compile(JSON.parse(fs.readFileSync(SCHEMA_URL, 'utf8')));
  }
  return compiled;
}

// A verification visit reads like "… — checked September 26, 2026". It is
// evidence for the editor, not news for the reader, so it lives in `checks`.
export const CHECK_TITLE = /\bchecked\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\s*$/;

// Axis scores travel to the page as flat fields named after the axis, so an
// axis may not take a name the page payload already uses (scripts/lib/site.mjs).
export const RESERVED_AXIS_KEYS = ['id', 'name', 'shortName', 'company', 'brand', 'cls', 'cat', 'hq', 'site', 'desc', 'founded', 'aliases',
  'verified', 'founders', 'parent', 'traction', 'valuation', 'raised', 'raisedConf', 'raisedSrc', 'lastAmount', 'lastSeries', 'lastDate',
  'leads', 'others', 'conf', 'valConf', 'valNote', 'src', 'valSrc', 'why', 'rationales', 'news', 'checks'];
export const axisKeys = market => ['x', 'y', 'yAlt'].map(k => market.axes?.[k]?.key).filter(Boolean);
export const valuationConfidence = round => round.postMoneyConfidence ?? round.confidence;
// The valuation may carry its own citation; otherwise it shares the round's.
export const valuationSource = round => round.postMoneySource ?? round.source ?? null;
// A lock on a parent path ("lastRound") covers every field beneath it.
export const isLocked = (company, path) => (company.locked ?? []).some(p => path === p || path.startsWith(p + '.'));
const resolve = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const usd = v => v >= 1e9 ? `$${+(v / 1e9).toFixed(2)}B` : `$${+(v / 1e6).toFixed(1)}M`;

/**
 * @returns {{ errors: {at: string, msg: string}[], warnings: {at: string, msg: string}[] }}
 * `at` is a company id, or '' for the file as a whole.
 */
export function validateMarket(doc) {
  const errors = [], warnings = [];
  const validate = schemaValidator();
  if (!validate(doc)) {
    for (const e of validate.errors) errors.push({ at: '', msg: `${e.instancePath || '/'} ${e.message}` });
    return { errors, warnings };
  }
  const fail = (at, msg) => errors.push({ at, msg });
  const warn = (at, msg) => warnings.push({ at, msg });
  const { market } = doc;

  const categoryIds = new Set((market.categories ?? []).map(k => k.id));
  if (categoryIds.size !== (market.categories ?? []).length) fail('', 'duplicate id in market.categories');
  const axes = axisKeys(market);
  if (new Set(axes).size !== axes.length) fail('', 'market.axes reuses an axis key');
  for (const key of axes) if (RESERVED_AXIS_KEYS.includes(key)) fail('', `axis key "${key}" collides with a page field; rename the axis`);
  const after = d => d && new Date(d) > new Date(market.asOf);

  const ids = new Set();
  const unsourcedTotals = [];
  for (const c of doc.companies) {
    const at = c.id;
    const round = c.lastRound;
    const totalRaised = c.metrics?.totalRaisedUsd ?? null;
    const totalConf = c.metrics?.totalRaisedConfidence ?? null;

    if (ids.has(c.id)) fail(at, 'duplicate company id');
    ids.add(c.id);

    // Rule 1: every figure that is not "undisclosed" must carry a source.
    // This is the rule the whole product rests on.
    if (round.confidence !== 'undisclosed' && !round.source) {
      fail(at, `confidence is "${round.confidence}" but no source is attached`);
    }

    // The valuation is its own claim: a round can be well reported while the
    // post-money next to it was typed in by hand.
    const valConf = valuationConfidence(round);

    // Rule 2: a stated post-money needs a source — unless it is openly hand-entered,
    // in which case it must instead be marked, noted and locked (rules 4 and 4b).
    if (round.postMoneyUsd != null && valConf !== 'manual' && !valuationSource(round)) {
      fail(at, 'has a post-money valuation with no source');
    }

    // Rule 3: platforms must not carry a valuation — a parent's market cap
    // is not a bet on one product and is not comparable to a startup's.
    if (c.class === 'platform' && round.postMoneyUsd != null) {
      fail(at, 'platform class must not carry a post-money valuation');
    }
    // …nor the parent's funding, for the same reason.
    if (c.class === 'platform' && totalRaised != null) {
      fail(at, 'platform class must not carry total funding — a parent\'s capital is not this product\'s');
    }

    // Rule 4: a figure that is not straight reporting must say what it actually is.
    if (['estimated', 'manual'].includes(valConf) && round.postMoneyUsd != null && !round.note) {
      fail(at, `${valConf} valuation must carry a note explaining the basis`);
    }

    // Rule 4b: a hand-entered figure must be locked, or the weekly agent will
    // quietly replace it with whatever the press says next.
    if (valConf === 'manual' && round.postMoneyUsd != null && !isLocked(c, 'lastRound.postMoneyUsd')) {
      fail(at, 'manual valuation must be locked against the refresh agent');
    }

    // Rule 5: locked paths must point at something real.
    for (const p of c.locked ?? []) {
      if (resolve(c, p) === undefined) fail(at, `locked path "${p}" does not resolve`);
    }

    // Rule 6: no date may be later than the snapshot the site says it shows.
    if (after(round.date)) fail(at, `lastRound.date ${round.date} is after market.asOf`);
    if (after(round.source?.date)) fail(at, `lastRound.source.date ${round.source.date} is after market.asOf`);
    if (after(round.postMoneySource?.date)) fail(at, `lastRound.postMoneySource.date ${round.postMoneySource.date} is after market.asOf`);
    if (after(c.metrics?.totalRaisedSource?.date)) fail(at, `metrics.totalRaisedSource.date ${c.metrics.totalRaisedSource.date} is after market.asOf`);
    for (const n of c.news ?? []) if (after(n.date)) fail(at, `news item dated ${n.date} is after market.asOf`);
    for (const n of c.checks ?? []) if (after(n.date)) fail(at, `check dated ${n.date} is after market.asOf`);

    // Rule 7: a platform has no founders of its own — it needs a parent description
    // instead, so its page is as informative as an independent's.
    if (c.class === 'platform' && !c.parent) fail(at, 'platform must carry a `parent` description');
    if (c.class !== 'platform' && c.parent) warn(at, 'non-platform carries a parent description');

    // Rule 8: the primary axis needs a rationale at least.
    if (axes[0] && c.axes[axes[0]] && !c.axes[axes[0]].rationale) warn(at, `no rationale on the ${axes[0]} score`);

    // Rule 9: categories are data, so a typo would silently drop a company
    // from every filter tab. Membership is checked, not assumed.
    if (categoryIds.size) {
      if (!categoryIds.has(c.category)) fail(at, `category "${c.category ?? ''}" is not one of market.categories (${[...categoryIds].join(', ')})`);
    } else if (c.category) {
      fail(at, 'has a category but market.categories is not defined');
    }

    // Rule 10: verification visits are not news. They belong in `checks`,
    // or they crowd real reporting out of the research feed.
    for (const n of c.news ?? []) {
      if (CHECK_TITLE.test(n.title)) fail(at, `news item "${n.title}" is a verification check — move it to \`checks\``);
    }

    // Rule 11: a platform is labelled with its consumer brand on the map.
    // Without one the map falls back to the legal parent name (Alphabet, not Google).
    if (c.class === 'platform' && !c.brand) warn(at, 'platform has no `brand`; the map will show the parent company name');

    // Rule 12: scores are keyed by the market's own axes. A missing score would
    // plot at 0; an extra one would never be shown.
    const have = Object.keys(c.axes);
    const missing = axes.filter(k => !have.includes(k)), extra = have.filter(k => !axes.includes(k));
    if (missing.length) fail(at, `no score for axis ${missing.join(', ')}`);
    if (extra.length) fail(at, `scores axis ${extra.join(', ')}, which market.axes does not define`);

    // Rule 13: the scope is data, so it is checked rather than trusted.
    if (market.regions && !market.regions.includes(c.region)) {
      fail(at, `region "${c.region ?? ''}" is outside the map's scope (${market.regions.join(', ')})`);
    }

    // Rule 14: cumulative funding cannot be smaller than the one round inside it.
    if (c.class === 'independent' && totalRaised != null && round.amountUsd != null && totalRaised < round.amountUsd) {
      fail(at, `total funding ${usd(totalRaised)} is smaller than the last round (${usd(round.amountUsd)})`);
    }

    // Rule 15: total funding follows the valuation's provenance rules. A sourced
    // label needs its source; a hand-entered total must be locked.
    if (totalRaised != null && ['reported', 'estimated', 'rumored'].includes(totalConf) && !c.metrics.totalRaisedSource) {
      fail(at, `total funding is "${totalConf}" but no totalRaisedSource is attached`);
    }
    if (totalRaised != null && totalConf === 'manual' && !isLocked(c, 'metrics.totalRaisedUsd')) {
      fail(at, 'manual total funding must be locked against the refresh agent');
    }
    if (totalRaised != null && !totalConf && !c.metrics.totalRaisedSource) unsourcedTotals.push(c.id);

    // Staleness is a warning, not an error — it is what the agent exists to fix.
    // Two thresholds: long-unverified, and lagging the snapshot date the site shows,
    // which would otherwise imply every row was checked on that day.
    const days = (new Date(market.asOf) - new Date(c.lastVerified)) / 864e5;
    if (days > 60) warn(at, `not verified in ${Math.round(days)} days`);
    else if (days > 7) warn(at, `last verified ${c.lastVerified}, ${Math.round(days)} days before the ${market.asOf} snapshot — re-verify`);
  }

  // One line rather than one per company: this is a backlog, not an alarm.
  if (unsourcedTotals.length) {
    warn('', `${unsourcedTotals.length} total-funding figures have no recorded source (${unsourcedTotals.join(', ')}); the site labels them "source not recorded"`);
  }
  return { errors, warnings };
}

export function summarize(doc) {
  const withVal = doc.companies.filter(c => c.lastRound.postMoneyUsd != null);
  const manual = withVal.filter(c => valuationConfidence(c.lastRound) === 'manual').length;
  return { companies: doc.companies.length, sourced: withVal.length - manual, manual };
}
