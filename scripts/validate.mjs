#!/usr/bin/env node
/**
 * Validates every data/markets/*.json against schema/market.schema.json,
 * then applies the editorial rules a JSON Schema cannot express.
 * The rules live in scripts/lib/validate-market.mjs so the admin editor and
 * the tests enforce exactly the same thing.
 *
 * This runs in CI on every pull request, so a malformed agent PR fails
 * before you ever open it.
 *
 *   node scripts/validate.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMarket, summarize } from './lib/validate-market.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(ROOT, 'data/markets');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

const errors = [];
const warnings = [];
const where = (rel, at) => at ? `${rel} › ${at}` : rel;
if (!files.length) errors.push('data/markets: no market files found');

const seen = new Map();   // market id → file, across files
const featured = [];
for (const f of files) {
  const rel = `data/markets/${f}`;
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  } catch (e) {
    errors.push(`${rel}: invalid JSON — ${e.message}`);
    continue;
  }
  const result = validateMarket(doc);
  for (const e of result.errors) errors.push(`${where(rel, e.at)}: ${e.msg}`);
  for (const w of result.warnings) warnings.push(`${where(rel, w.at)}: ${w.msg}`);
  if (!doc?.market?.id) continue;

  // Market ids become URL paths, so two files may not claim the same one.
  if (seen.has(doc.market.id)) errors.push(`${rel}: market id "${doc.market.id}" is also used by ${seen.get(doc.market.id)}`);
  seen.set(doc.market.id, rel);
  if (doc.market.featured) featured.push(rel);

  if (!result.errors.length) {
    const s = summarize(doc);
    console.log(`✓ ${rel} — ${s.companies} companies, ${s.sourced} sourced post-money` + (s.manual ? `, ${s.manual} entered by hand` : ''));
  }
}
// The featured map is served at the site root; two would fight over it.
if (featured.length > 1) errors.push(`only one market may be featured: ${featured.join(', ')}`);

for (const w of warnings) console.warn(`  warn  ${w}`);
if (errors.length) {
  console.error(`\n✗ ${errors.length} error${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`\nAll market files valid${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'})` : ''}.`);
