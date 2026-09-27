#!/usr/bin/env node
/**
 * Validates every data/markets/*.json against schema/market.schema.json,
 * then applies the editorial rules a JSON Schema cannot express.
 *
 * This runs in CI on every pull request, so a malformed agent PR fails
 * before you ever open it.
 *
 *   node scripts/validate.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';   // the schema is draft 2020-12
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema/market.schema.json'), 'utf8'));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(SCHEMA);

const errors = [];
const warnings = [];

function fail(file, msg) { errors.push(`${file}: ${msg}`); }
function warn(file, msg) { warnings.push(`${file}: ${msg}`); }

const dir = path.join(ROOT, 'data/markets');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
if (!files.length) fail('data/markets', 'no market files found');

for (const f of files) {
  const rel = `data/markets/${f}`;
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  } catch (e) {
    fail(rel, `invalid JSON — ${e.message}`);
    continue;
  }

  if (!validate(doc)) {
    for (const e of validate.errors) fail(rel, `${e.instancePath || '/'} ${e.message}`);
    continue;
  }

  // ---- editorial rules the schema can't express -------------------------

  const ids = new Set();
  for (const c of doc.companies) {
    const at = `${rel} › ${c.id}`;

    if (ids.has(c.id)) fail(at, 'duplicate company id');
    ids.add(c.id);

    // Rule 1: every figure that is not "undisclosed" must carry a source.
    // This is the rule the whole product rests on.
    if (c.lastRound.confidence !== 'undisclosed' && !c.lastRound.source) {
      fail(at, `confidence is "${c.lastRound.confidence}" but no source is attached`);
    }

    // The valuation is its own claim: a round can be well reported while the
    // post-money next to it was typed in by hand.
    const valConf = c.lastRound.postMoneyConfidence ?? c.lastRound.confidence;

    // Rule 2: a stated post-money needs a source — unless it is openly hand-entered,
    // in which case it must instead be marked, noted and locked (rules 4 and 4b).
    if (c.lastRound.postMoneyUsd != null && valConf !== 'manual' && !c.lastRound.source) {
      fail(at, 'has a post-money valuation with no source');
    }

    // Rule 3: platforms must not carry a valuation — a parent's market cap
    // is not a bet on one product and is not comparable to a startup's.
    if (c.class === 'platform' && c.lastRound.postMoneyUsd != null) {
      fail(at, 'platform class must not carry a post-money valuation');
    }

    // Rule 4: a figure that is not straight reporting must say what it actually is.
    if (['estimated', 'manual'].includes(valConf) &&
        c.lastRound.postMoneyUsd != null && !c.lastRound.note) {
      fail(at, `${valConf} valuation must carry a note explaining the basis`);
    }

    // Rule 4b: a hand-entered figure must be locked, or the weekly agent will
    // quietly replace it with whatever the press says next.
    if (valConf === 'manual' && c.lastRound.postMoneyUsd != null &&
        !(c.locked ?? []).some(p => p === 'lastRound.postMoneyUsd' || p === 'lastRound')) {
      fail(at, 'manual valuation must be locked against the refresh agent');
    }

    // Rule 5: locked paths must point at something real.
    for (const p of c.locked ?? []) {
      const ok = p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), c) !== undefined;
      if (!ok) fail(at, `locked path "${p}" does not resolve`);
    }

    // Rule 6: dates must not be in the future.
    const future = d => d && new Date(d) > new Date(doc.market.asOf);
    if (future(c.lastRound.date)) fail(at, `lastRound.date ${c.lastRound.date} is after market.asOf`);
    for (const n of c.news ?? []) {
      if (future(n.date)) fail(at, `news item dated ${n.date} is after market.asOf`);
    }

    // Rule 7: a platform has no founders of its own — it needs a parent description
    // instead, so its page is as informative as an independent's.
    if (c.class === 'platform' && !c.parent) {
      fail(at, 'platform must carry a `parent` description');
    }
    if (c.class !== 'platform' && c.parent) {
      warn(at, 'non-platform carries a parent description');
    }

    // Rule 8: every axis needs a rationale on the primary axis at least.
    if (!c.axes.autonomy.rationale) warn(at, 'no rationale on the autonomy score');

    // Staleness is a warning, not an error — it is what the agent exists to fix.
    const days = (new Date(doc.market.asOf) - new Date(c.lastVerified)) / 864e5;
    if (days > 60) warn(at, `not verified in ${Math.round(days)} days`);
  }

  const withVal = doc.companies.filter(c => c.lastRound.postMoneyUsd != null);
  const manual = withVal.filter(c => (c.lastRound.postMoneyConfidence ?? c.lastRound.confidence) === 'manual').length;
  console.log(`✓ ${rel} — ${doc.companies.length} companies, ${withVal.length - manual} sourced post-money` +
              (manual ? `, ${manual} entered by hand` : ''));
}

for (const w of warnings) console.warn(`  warn  ${w}`);
if (errors.length) {
  console.error(`\n✗ ${errors.length} error${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`\nAll market files valid${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'})` : ''}.`);
