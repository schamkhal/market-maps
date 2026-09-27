#!/usr/bin/env node
/**
 * The weekly refresh agent — Phase 3.
 *
 *   node agent/refresh.mjs --dry-run     write proposals to .agent-cache/, change nothing
 *   node agent/refresh.mjs               apply proposals to data/ and write a PR body
 *
 * Five stages, each a separate model call with a narrow job:
 *   1 discover   RSS + SEC EDGAR Form D          Haiku 4.5   (free sources, no search fees)
 *   2 extract    read articles → typed claims    Sonnet 5
 *   3 reconcile  diff against live data          Sonnet 5
 *   4 propose    write JSON + PR body            local
 *   5 publish    you merge; CI deploys           human
 *
 * Cost control, in order of impact: prompt caching on the schema and company
 * list, the Batch API (this is not latency-sensitive), and fetching URLs
 * discovered from free RSS/EDGAR rather than paying per web search.
 *
 * Requires ANTHROPIC_API_KEY. Run the first two weeks with --dry-run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.agent-cache');
const DRY = process.argv.includes('--dry-run');
const API_KEY = process.env.ANTHROPIC_API_KEY;
const API = 'https://api.anthropic.com/v1/messages';

const MODELS = {
  discover: 'claude-haiku-4-5',   // cheap triage: 80% of calls, 20% of cost
  extract: 'claude-sonnet-5',     // structured extraction is its sweet spot
  reconcile: 'claude-sonnet-5',   // never Opus here — 2.5x the cost, no gain
};

const SOURCES = JSON.parse(fs.readFileSync(path.join(ROOT, 'agent/sources.json'), 'utf8'));
const RECENT_DAYS = 8;   // the cron runs weekly; one day of overlap catches stragglers
const MAX_ARTICLES_PER_COMPANY = 3;

/* ===================== helpers ========================================= */

const log = (...a) => console.log('•', ...a);
const daysAgo = n => new Date(Date.now() - n * 864e5);
const iso = d => new Date(d).toISOString().slice(0, 10);
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function set(o, p, v) {
  const k = p.split('.'), last = k.pop();
  let cur = o;
  for (const key of k) { if (cur[key] == null || typeof cur[key] !== 'object') cur[key] = {}; cur = cur[key]; }
  cur[last] = v;
}
const usd = v => v == null ? 'undisclosed'
  : v >= 1e9 ? '$' + (v / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B'
  : '$' + Math.round(v / 1e6) + 'M';

async function claude(model, system, user, { schema, maxTokens = 4000 } = {}) {
  if (!API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const body = {
    model,
    max_tokens: maxTokens,
    // Cache the system block: the schema, rubric and company list are resent on
    // every call, and cache reads bill at 0.1x input. Biggest single lever.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  };
  if (schema) {
    body.tools = [{ name: 'emit', description: 'Return the result.', input_schema: schema }];
    body.tool_choice = { type: 'tool', name: 'emit' };
  }
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const json = await res.json();
  if (schema) {
    const tool = json.content.find(c => c.type === 'tool_use');
    if (!tool) throw new Error('model returned no tool_use block');
    return tool.input;
  }
  return json.content.filter(c => c.type === 'text').map(c => c.text).join('');
}

/* ===================== stage 1 — discover =============================== */
// RSS and EDGAR are free. Every URL that reaches the extractor comes from
// here, so the web-search line stays at zero.

async function fetchText(url, ms = 15000) {
  const ctl = AbortController ? new AbortController() : null;
  const t = ctl && setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctl?.signal,
      headers: { 'user-agent': SOURCES.userAgent },
    });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; } finally { if (t) clearTimeout(t); }
}

function parseFeed(xml) {
  if (!xml) return [];
  const items = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/g) || [];
  for (const b of blocks) {
    const pick = re => (b.match(re) || [])[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/);
    const link = pick(/<link[^>]*>([\s\S]*?)<\/link>/) || (b.match(/<link[^>]*href="([^"]+)"/) || [])[1];
    const date = pick(/<(?:pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated|dc:date)>/);
    if (title && link) items.push({ title, url: link, published: date ? new Date(date) : null });
  }
  return items;
}

async function discover(companies) {
  log(`stage 1 — discover: polling ${SOURCES.feeds.length} feeds + SEC EDGAR`);
  const cutoff = daysAgo(RECENT_DAYS);
  const seen = new Set();
  const items = [];

  for (const feed of SOURCES.feeds) {
    const xml = await fetchText(feed.url);
    for (const it of parseFeed(xml)) {
      if (it.published && it.published < cutoff) continue;
      if (seen.has(it.url)) continue;
      seen.add(it.url);
      items.push({ ...it, publisher: feed.publisher, tier: feed.tier });
    }
  }
  log(`  ${items.length} items in the last ${RECENT_DAYS} days`);

  // SEC EDGAR full-text search — free, and it surfaces US raises before the press.
  for (const c of companies) {
    if (c.class === 'platform') continue;
    const q = encodeURIComponent(`"${c.company || c.name}"`);
    const j = await fetchText(
      `https://efts.sec.gov/LATEST/search-index?q=${q}&forms=D&dateRange=custom&startdt=${iso(cutoff)}&enddt=${iso(Date.now())}`);
    if (!j) continue;
    try {
      const hits = JSON.parse(j)?.hits?.hits ?? [];
      for (const h of hits.slice(0, 2)) {
        const acc = h._source?.adsh?.replace(/-/g, '');
        if (!acc) continue;
        const url = `https://www.sec.gov/Archives/edgar/data/${h._source.ciks?.[0]}/${acc}/`;
        if (seen.has(url)) continue;
        seen.add(url);
        items.push({ title: `Form D filing — ${c.name}`, url, publisher: 'SEC EDGAR', tier: 1, published: new Date(), companyHint: c.id });
      }
    } catch { /* EDGAR shape changes; skip rather than fail the run */ }
  }

  if (!items.length) return [];

  // Haiku decides which items plausibly concern a company on the map.
  const names = companies.map(c => `${c.id}: ${c.name} (${c.company})`).join('\n');
  const out = await claude(MODELS.discover,
    `You triage news headlines for a market map of US personal AI agent companies.
Companies on the map:
${names}

Return only headlines that plausibly concern one of these companies AND concern
funding, valuation, acquisition, launch, usage milestones or shutdown. Reject
everything else. Be strict: a false positive costs a wasted extraction call.`,
    `Headlines:\n${items.map((it, i) => `[${i}] ${it.title} — ${it.publisher}`).join('\n')}`,
    {
      schema: {
        type: 'object',
        properties: {
          keep: {
            type: 'array',
            items: {
              type: 'object',
              required: ['index', 'companyId'],
              properties: {
                index: { type: 'integer' },
                companyId: { type: 'string' },
                why: { type: 'string' },
              },
            },
          },
        },
        required: ['keep'],
      },
    });

  const kept = (out.keep ?? [])
    .filter(k => items[k.index])
    .map(k => ({ ...items[k.index], companyId: k.companyId }));
  log(`  ${kept.length} candidates after triage`);
  return kept;
}

/* ===================== stage 2 — extract =============================== */

const CLAIM_SCHEMA = {
  type: 'object',
  required: ['claims'],
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        required: ['companyId', 'field', 'value', 'sourceUrl', 'publisher', 'sourceDate'],
        properties: {
          companyId: { type: 'string' },
          field: {
            type: 'string',
            enum: ['lastRound.postMoneyUsd', 'lastRound.amountUsd', 'lastRound.series',
                   'lastRound.date', 'lastRound.leads', 'metrics.totalRaisedUsd', 'traction'],
          },
          value: { description: 'The extracted value, correctly typed.' },
          sourceUrl: { type: 'string' },
          publisher: { type: 'string' },
          sourceDate: { type: 'string' },
          quote: { type: 'string', description: 'The sentence the value came from.' },
        },
      },
    },
  },
};

async function extract(candidates) {
  log(`stage 2 — extract: reading ${candidates.length} articles`);
  const claims = [];
  const byCompany = {};
  for (const c of candidates) (byCompany[c.companyId] ??= []).push(c);

  for (const [companyId, arts] of Object.entries(byCompany)) {
    for (const a of arts.slice(0, MAX_ARTICLES_PER_COMPANY)) {
      const body = await fetchText(a.url);
      // Paywalled outlets: headline and feed summary only. Never circumvent.
      const text = (body || a.title)
        .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ')
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 12000);

      try {
        const out = await claude(MODELS.extract,
          `Extract funding facts for a market map. Rules:
- Only extract what the text states. Never infer, never estimate, never round.
- A claim with no explicit value in the text must not be emitted.
- Amounts in USD as integers (e.g. "$55 million" → 55000000).
- Dates as YYYY-MM-DD.
- "Post-money" means the valuation after the round. A "valued at" figure counts.
- If the text is only a headline or paywall stub, emit nothing.`,
          `Company id: ${companyId}\nPublisher: ${a.publisher}\nURL: ${a.url}\n\n${text}`,
          { schema: CLAIM_SCHEMA });
        claims.push(...(out.claims ?? []));
      } catch (e) { log(`  extract failed for ${a.url}: ${e.message}`); }
    }
  }
  log(`  ${claims.length} claims extracted`);
  return claims;
}

/* ===================== stage 3 — reconcile ============================= */

async function reconcile(doc, claims) {
  log('stage 3 — reconcile');
  const proposals = [], conflicts = [], skipped = [];

  for (const claim of claims) {
    const c = doc.companies.find(x => x.id === claim.companyId);
    if (!c) { skipped.push({ claim, reason: 'unknown company' }); continue; }

    // Hard guardrail: locked fields are never touched. This is what keeps a
    // hand-entered number alive through Monday's run.
    if ((c.locked ?? []).some(p => claim.field === p || claim.field.startsWith(p + '.'))) {
      skipped.push({ claim, reason: 'field is locked' });
      continue;
    }
    // Platforms carry no valuation by construction.
    if (c.class === 'platform' && claim.field.startsWith('lastRound.')) {
      skipped.push({ claim, reason: 'platform class carries no round data' });
      continue;
    }
    const current = get(c, claim.field);
    if (JSON.stringify(current) === JSON.stringify(claim.value)) continue;

    // Only accept a newer source than the one already on file.
    const incumbent = c.lastRound.source?.date;
    if (incumbent && claim.sourceDate < incumbent) {
      skipped.push({ claim, reason: `source older than incumbent (${incumbent})` });
      continue;
    }
    // Two claims for the same field with different values: flag, never pick.
    const rival = proposals.find(p => p.companyId === claim.companyId && p.field === claim.field);
    if (rival && JSON.stringify(rival.value) !== JSON.stringify(claim.value)) {
      conflicts.push({ field: claim.field, companyId: claim.companyId, a: rival, b: claim });
      continue;
    }
    if (rival) continue;

    proposals.push({ ...claim, current });
  }

  // >5 field changes to one company is a rewrite, not an update. Escalate.
  const perCompany = {};
  for (const p of proposals) (perCompany[p.companyId] ??= []).push(p);
  const escalations = Object.entries(perCompany)
    .filter(([, ps]) => ps.length > 5)
    .map(([id, ps]) => ({ companyId: id, count: ps.length }));

  log(`  ${proposals.length} proposals, ${conflicts.length} conflicts, ${skipped.length} skipped`);
  return { proposals, conflicts, skipped, escalations };
}

/* ===================== stage 4 — propose =============================== */

function applyAndWritePR(file, doc, result) {
  const { proposals, conflicts, skipped, escalations } = result;
  const escalated = new Set(escalations.map(e => e.companyId));
  const applied = [];

  for (const p of proposals) {
    if (escalated.has(p.companyId)) continue;
    const c = doc.companies.find(x => x.id === p.companyId);
    set(c, p.field, p.value);
    set(c, 'lastRound.confidence', 'reported');
    set(c, 'lastRound.source', { url: p.sourceUrl, publisher: p.publisher, date: p.sourceDate });
    c.lastVerified = iso(Date.now());
    if (!c.news?.some(n => n.url === p.sourceUrl)) {
      (c.news ??= []).unshift({ title: p.quote?.slice(0, 140) || `Update from ${p.publisher}`,
        url: p.sourceUrl, publisher: p.publisher, date: p.sourceDate });
      c.news = c.news.slice(0, 5);
    }
    applied.push(p);
  }

  const fmt = (f, v) => f.endsWith('Usd') ? usd(v) : Array.isArray(v) ? v.join(', ') : String(v);
  const lines = applied.map(p => {
    const c = doc.companies.find(x => x.id === p.companyId);
    return `- **${c.name}** — \`${p.field}\` ${fmt(p.field, p.current)} → **${fmt(p.field, p.value)}** ` +
           `([${p.publisher}](${p.sourceUrl}), ${p.sourceDate})`;
  });

  const pr = [
    `## Weekly data refresh — ${iso(Date.now())}`,
    '',
    applied.length ? `### ${applied.length} change${applied.length === 1 ? '' : 's'}` : '### No changes',
    ...(applied.length ? lines : ['Nothing to update this week.']),
    '',
    ...(conflicts.length ? ['### ⚠️ Needs your judgment — sources disagree', ...conflicts.map(x =>
      `- **${x.companyId}** \`${x.field}\`: ${x.a.publisher} says ${fmt(x.field, x.a.value)}, ` +
      `${x.b.publisher} says ${fmt(x.field, x.b.value)}. Left unchanged.`), ''] : []),
    ...(escalations.length ? ['### ⚠️ Escalated — too many changes at once', ...escalations.map(e =>
      `- **${e.companyId}**: ${e.count} field changes proposed. Left unchanged; review manually.`), ''] : []),
    ...(skipped.length ? ['<details><summary>' + skipped.length + ' claims skipped</summary>', '',
      ...skipped.map(s => `- \`${s.claim.companyId}.${s.claim.field}\` — ${s.reason}`), '', '</details>', ''] : []),
    '---',
    'Proposed by the weekly refresh agent. Every figure above carries its source.',
    'Merging deploys the site and adds these lines to the public changelog.',
  ].join('\n');

  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(path.join(CACHE, 'pr-body.md'), pr);

  if (DRY) {
    fs.writeFileSync(path.join(CACHE, 'proposed.json'), JSON.stringify(doc, null, 2) + '\n');
    log(`dry run — wrote .agent-cache/proposed.json and .agent-cache/pr-body.md, data/ untouched`);
  } else {
    fs.writeFileSync(path.join(ROOT, 'data/markets', file), JSON.stringify(doc, null, 2) + '\n');
    log(`applied ${applied.length} changes to data/markets/${file}`);
  }
  return { applied: applied.length, pr };
}

/* ===================== main ============================================ */

export { discover, extract, reconcile, applyAndWritePR, parseFeed };

async function main() {
  const file = process.env.MARKET_FILE || 'personal-ai-agents.json';
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/markets', file), 'utf8'));

  log(`refreshing ${file} — ${doc.companies.length} companies${DRY ? ' (dry run)' : ''}`);
  const candidates = await discover(doc.companies);
  const claims = candidates.length ? await extract(candidates) : [];
  const result = await reconcile(doc, claims);
  const { applied, pr } = applyAndWritePR(file, doc, result);
  console.log('\n' + pr);
  console.log(`\nDone. ${applied} change${applied === 1 ? '' : 's'}${DRY ? ' proposed (nothing written to data/)' : ' applied'}.`);
}

// Only run when invoked directly, so the guardrails can be unit-tested.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('refresh failed:', e.message); process.exit(1); });
}
