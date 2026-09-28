#!/usr/bin/env node
/**
 * The weekly refresh agent.
 *
 *   node agent/refresh.mjs --dry-run     write proposals to .agent-cache/, change nothing
 *   node agent/refresh.mjs               apply proposals to data/ and write a PR body
 *
 * Five stages; the two model stages each make narrow calls:
 *   1 discover   RSS, company blogs, SEC EDGAR Form D   Haiku 4.5 triages headlines
 *   2 extract    read articles → typed claims            Sonnet 5
 *   3 reconcile  diff against live data, guardrails       local rules, no model
 *   4 propose    write JSON + PR body                    local
 *   5 publish    you merge; CI validates and deploys     human
 *
 * Cost: URLs come from free RSS/EDGAR, never paid web search. The system
 * blocks carry cache_control, but caching only engages once a block passes the
 * model's minimum cacheable length (1,024 tokens on Sonnet 5, 4,096 on Haiku
 * 4.5); today's prompts are shorter, so it is a no-op until they grow. The
 * Batch API (50% off, fine for a weekly job) is not wired in yet.
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
  discover: 'claude-haiku-4-5',   // cheap triage: most calls, little of the cost
  extract: 'claude-sonnet-5',     // structured extraction is its sweet spot; never Opus here
};

const SOURCES = JSON.parse(fs.readFileSync(path.join(ROOT, 'agent/sources.json'), 'utf8'));
const RECENT_DAYS = 8;   // the cron runs weekly; one day of overlap catches stragglers
const MAX_ARTICLES_PER_COMPANY = 3;
const MAX_CHANGES_PER_COMPANY = 5;

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
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const blank = v => v == null || (Array.isArray(v) && !v.length);
const usd = v => v == null ? 'undisclosed'
  : v >= 1e9 ? '$' + (v / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B'
  : '$' + Math.round(v / 1e6) + 'M';
// A lock on a parent path ("lastRound") covers every field beneath it.
const isLocked = (c, field) => (c.locked ?? []).some(p => field === p || field.startsWith(p + '.'));
const lockedUnder = (c, prefix) => (c.locked ?? []).some(p => p === prefix || p.startsWith(prefix + '.'));
// Where each field's citation lives. Traction has none of its own: its
// article joins the company's coverage.
const provenanceOf = field => field === 'lastRound.postMoneyUsd' ? 'lastRound.postMoneySource'
  : field.startsWith('lastRound.') ? 'lastRound.source'
  : field === 'metrics.totalRaisedUsd' ? 'metrics.totalRaisedSource' : null;
const incumbentDate = (c, field) => {
  const prov = provenanceOf(field);
  if (prov === 'lastRound.postMoneySource') return (c.lastRound.postMoneySource ?? c.lastRound.source)?.date;
  return prov ? get(c, prov)?.date : undefined;
};
const startsNewRound = (c, p) => (p.field === 'lastRound.series' || p.field === 'lastRound.date') && !same(get(c, p.field), p.value);
// A tier-1 report of a figure already on file still counts when the figure
// was only rumored, estimated or unsourced: it upgrades the label and citation.
const WEAK = ['rumored', 'estimated', 'undisclosed'];
function upgradesProvenance(c, claim) {
  if ((claim.tier ?? 1) !== 1) return false;
  if (claim.field === 'lastRound.postMoneyUsd') return WEAK.includes(c.lastRound.postMoneyConfidence ?? c.lastRound.confidence);
  if (claim.field === 'metrics.totalRaisedUsd') return !c.metrics?.totalRaisedSource || WEAK.includes(c.metrics?.totalRaisedConfidence);
  return false;
}

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
// RSS, company blogs and EDGAR are free. Every URL that reaches the extractor
// comes from here, so the web-search line stays at zero.

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
    // The feed's own summary: all a paywalled outlet gives us to read.
    const summary = pick(/<(?:description|summary)[^>]*>([\s\S]*?)<\/(?:description|summary)>/)
      ?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200);
    if (title && link) items.push({ title, url: link, published: date ? new Date(date) : null, summary: summary || null });
  }
  return items;
}

async function discover(companies) {
  const blogs = Object.entries(SOURCES.companyBlogs ?? {})
    .map(([id, url]) => ({ id, url, company: companies.find(c => c.id === id) }))
    .filter(b => b.company);
  log(`stage 1 — discover: polling ${SOURCES.feeds.length} feeds, ${blogs.length} company blogs, SEC EDGAR`);
  const cutoff = daysAgo(RECENT_DAYS);
  const seen = new Set();
  const items = [];
  const add = (it, extra) => {
    if (it.published && it.published < cutoff) return;
    if (seen.has(it.url)) return;
    seen.add(it.url);
    items.push({ ...it, ...extra });
  };
  for (const feed of SOURCES.feeds) {
    for (const it of parseFeed(await fetchText(feed.url))) add(it, { publisher: feed.publisher, tier: feed.tier });
  }
  // A company's own blog is a primary source for its own news.
  for (const blog of blogs) {
    for (const it of parseFeed(await fetchText(blog.url))) add(it, { publisher: blog.company.name, tier: 1, companyHint: blog.id });
  }
  log(`  ${items.length} items in the last ${RECENT_DAYS} days`);

  // SEC EDGAR full-text search — free, and it surfaces US raises before the press.
  // A hit is a filing index, not an article, and a name like "Motion" matches
  // strangers' filings, so hits go to the PR for a human to confirm rather
  // than to the extractor.
  const filings = [];
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
        filings.push({ companyId: c.id, name: c.name, url, filer: h._source.display_names?.[0] ?? null });
      }
    } catch { /* EDGAR shape changes; skip rather than fail the run */ }
  }

  if (!items.length) return { candidates: [], filings };

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

  const candidates = (out.keep ?? [])
    .filter(k => items[k.index])
    .map(k => ({ ...items[k.index], companyId: k.companyId }));
  log(`  ${candidates.length} candidates after triage, ${filings.length} Form D filings to review`);
  return { candidates, filings };
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
  const paywalled = new Set(SOURCES.paywalled ?? []);

  for (const [companyId, arts] of Object.entries(byCompany)) {
    for (const a of arts.slice(0, MAX_ARTICLES_PER_COMPANY)) {
      // Paywalled outlets: headline and feed summary only. Never circumvent.
      const body = paywalled.has(a.publisher) ? null : await fetchText(a.url);
      const text = (body || [a.title, a.summary].filter(Boolean).join('\n\n'))
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
        // The article's own headline and tier travel with each claim: the
        // headline titles the coverage entry, the tier decides what it may change.
        claims.push(...(out.claims ?? []).map(claim => ({ ...claim, headline: a.title, tier: a.tier ?? 1 })));
      } catch (e) { log(`  extract failed for ${a.url}: ${e.message}`); }
    }
  }
  log(`  ${claims.length} claims extracted`);
  return claims;
}

/* ===================== stage 3 — reconcile ============================= */
// Pure rules over the live data. Nothing here calls a model.

function reconcile(doc, claims) {
  log('stage 3 — reconcile');
  const proposals = [], conflicts = [], skipped = [], escalations = [];
  // Companies reporting a new round this run. Their round figures are judged
  // against the new round, so one that happens to equal the old round's is
  // still proposed rather than cleared with the old round.
  const newRound = new Set(claims.filter(cl => {
    const c = doc.companies.find(x => x.id === cl.companyId);
    return c && startsNewRound(c, cl);
  }).map(cl => cl.companyId));
  // Claims are grouped by company and field first, so agreement and
  // disagreement are judged across every source at once, never by arrival order.
  const groups = new Map();
  for (const claim of claims) {
    const c = doc.companies.find(x => x.id === claim.companyId);
    if (!c) { skipped.push({ claim, reason: 'unknown company' }); continue; }
    // Hard guardrail: locked fields are never touched. This is what keeps a
    // hand-entered number alive through Monday's run.
    if (isLocked(c, claim.field)) { skipped.push({ claim, reason: 'field is locked' }); continue; }
    // Platforms carry no round data or funding by construction.
    if (c.class === 'platform' && (claim.field.startsWith('lastRound.') || claim.field.startsWith('metrics.'))) {
      skipped.push({ claim, reason: 'platform class carries no round data' });
      continue;
    }
    const tier = claim.tier ?? 1;
    if (tier >= 3) { skipped.push({ claim, reason: 'tier-3 sources are for discovery only' }); continue; }
    const current = get(c, claim.field);
    const restatesNewRound = newRound.has(c.id) && claim.field.startsWith('lastRound.');
    if (same(current, claim.value) && !restatesNewRound && !upgradesProvenance(c, claim)) continue;
    // Only accept a newer source than the one already behind this figure.
    const incumbent = incumbentDate(c, claim.field);
    if (incumbent && claim.sourceDate < incumbent) {
      skipped.push({ claim, reason: `source older than incumbent (${incumbent})` });
      continue;
    }
    // Trade press may fill a blank, but only tier-1 reporting replaces a figure.
    if (tier === 2 && !blank(current)) {
      conflicts.push({ companyId: c.id, field: claim.field, current, claims: [claim], reason: 'a tier-2 source would replace a figure already on file' });
      continue;
    }
    const key = `${c.id}\u0000${claim.field}`;
    if (!groups.has(key)) groups.set(key, { companyId: c.id, field: claim.field, current, claims: [] });
    groups.get(key).claims.push(claim);
  }

  for (const group of groups.values()) {
    const values = [...new Set(group.claims.map(cl => JSON.stringify(cl.value)))];
    // Two sources that disagree: flag, never pick. Neither value is applied.
    if (values.length > 1) { conflicts.push({ ...group, reason: 'sources disagree' }); continue; }
    // Sources agree: cite the most recent, most primary one.
    const best = [...group.claims].sort((a, b) => (b.sourceDate || '').localeCompare(a.sourceDate || '') || (a.tier ?? 1) - (b.tier ?? 1))[0];
    proposals.push({ ...best, current: group.current });
  }

  const perCompany = {};
  for (const p of proposals) (perCompany[p.companyId] ??= []).push(p);
  for (const [id, ps] of Object.entries(perCompany)) {
    const c = doc.companies.find(x => x.id === id);
    // More than five field changes to one company is a rewrite, not an update.
    if (ps.length > MAX_CHANGES_PER_COMPANY) escalations.push({ companyId: id, count: ps.length, reason: `${ps.length} field changes proposed at once` });
    // A new round clears the old one's figures; if any are locked, a human decides.
    else if (ps.some(p => startsNewRound(c, p)) && lockedUnder(c, 'lastRound')) {
      escalations.push({ companyId: id, count: ps.length, reason: 'a new round was reported, but fields of the current round are locked' });
    }
  }

  log(`  ${proposals.length} proposals, ${conflicts.length} conflicts, ${skipped.length} skipped, ${escalations.length} escalated`);
  return { proposals, conflicts, skipped, escalations };
}

/* ===================== stage 4 — propose =============================== */

/**
 * Applies proposals to the document in place. Pure apart from mutating `doc`.
 * @returns {{ applied: object[], cleared: object[] }}
 */
function applyProposals(doc, { proposals, escalations }, { today = iso(Date.now()) } = {}) {
  const escalated = new Set(escalations.map(e => e.companyId));
  const applied = [], cleared = [];
  const byCompany = new Map();
  for (const p of proposals) if (!escalated.has(p.companyId)) {
    if (!byCompany.has(p.companyId)) byCompany.set(p.companyId, []);
    byCompany.get(p.companyId).push(p);
  }

  for (const [id, ps] of byCompany) {
    const c = doc.companies.find(x => x.id === id);
    const round = c.lastRound;
    const valuationProposed = ps.some(p => p.field === 'lastRound.postMoneyUsd');
    // A new series or date is a new round: nothing from the previous round may
    // ride along under the new round's citation.
    if (ps.some(p => startsNewRound(c, p))) {
      const reproposed = new Set(ps.map(p => p.field));
      for (const key of ['amountUsd', 'postMoneyUsd', 'leads', 'otherInvestors', 'note']) {
        if (!blank(round[key]) && !reproposed.has(`lastRound.${key}`)) cleared.push({ companyId: id, field: `lastRound.${key}`, value: round[key] });
      }
      c.lastRound = { series: round.series, amountUsd: null, postMoneyUsd: null, date: null, leads: [], otherInvestors: [], confidence: 'reported', postMoneyConfidence: null, note: null, source: null };
    } else if (!valuationProposed && c.lastRound.postMoneyUsd != null && !c.lastRound.postMoneySource && c.lastRound.source
      && ps.some(p => provenanceOf(p.field) === 'lastRound.source')) {
      // The round is about to take a new citation. Pin the valuation to the
      // one it already had, at the confidence it already had.
      c.lastRound.postMoneySource = { ...c.lastRound.source };
      c.lastRound.postMoneyConfidence = c.lastRound.postMoneyConfidence ?? c.lastRound.confidence;
    }

    for (const p of ps) {
      const source = { url: p.sourceUrl, publisher: p.publisher, date: p.sourceDate };
      set(c, p.field, p.value);
      const prov = provenanceOf(p.field);
      if (prov === 'lastRound.postMoneySource') {
        c.lastRound.postMoneySource = source;
        c.lastRound.postMoneyConfidence = 'reported';
        if (!c.lastRound.source) { c.lastRound.source = source; c.lastRound.confidence = 'reported'; }
      } else if (prov === 'lastRound.source') {
        c.lastRound.source = source;
        c.lastRound.confidence = 'reported';
      } else if (prov === 'metrics.totalRaisedSource') {
        c.metrics.totalRaisedSource = source;
        c.metrics.totalRaisedConfidence = 'reported';
      }
      // Coverage grows; the agent never deletes an older story.
      if (!c.news?.some(n => n.url === p.sourceUrl)) {
        c.news = [{ title: p.headline || p.quote?.slice(0, 140) || `Update from ${p.publisher}`,
          url: p.sourceUrl, publisher: p.publisher, date: p.sourceDate }, ...(c.news ?? [])];
      }
      applied.push(p);
    }
    c.lastVerified = today;
  }
  // The snapshot date moves with the data, so no new date is ever "after" it.
  if (applied.length && today > doc.market.asOf) doc.market.asOf = today;
  return { applied, cleared };
}

function prBody(doc, { conflicts, skipped, escalations }, { applied, cleared }, filings = [], today = iso(Date.now())) {
  const nameOf = id => doc.companies.find(x => x.id === id)?.name ?? id;
  const fmt = (f, v) => f.endsWith('Usd') ? usd(v) : Array.isArray(v) ? v.join(', ') : String(v);
  return [
    `## Weekly data refresh — ${today}`,
    '',
    applied.length ? `### ${applied.length} change${applied.length === 1 ? '' : 's'}` : '### No changes',
    ...(applied.length ? applied.map(p =>
      `- **${nameOf(p.companyId)}** — \`${p.field}\` ` +
      (same(p.current, p.value) ? `confirmed at **${fmt(p.field, p.value)}**, now reported ` : `${fmt(p.field, p.current)} → **${fmt(p.field, p.value)}** `) +
      `([${p.publisher}](${p.sourceUrl}), ${p.sourceDate})`) : ['Nothing to update this week.']),
    '',
    ...(cleared.length ? ['### A new round replaced the previous one', ...cleared.map(x =>
      `- **${nameOf(x.companyId)}** — \`${x.field}\` ${fmt(x.field, x.value)} belonged to the previous round and was cleared`), ''] : []),
    ...(conflicts.length ? ['### ⚠️ Needs your judgment — left unchanged', ...conflicts.map(x =>
      `- **${nameOf(x.companyId)}** \`${x.field}\` (now ${fmt(x.field, x.current)}): ${x.reason}. ` +
      x.claims.map(cl => `${cl.publisher} says ${fmt(x.field, cl.value)}`).join('; ') + '.'), ''] : []),
    ...(escalations.length ? ['### ⚠️ Escalated — review by hand', ...escalations.map(e =>
      `- **${nameOf(e.companyId)}**: ${e.reason}. Left unchanged.`), ''] : []),
    ...(filings.length ? ['### SEC Form D filings to confirm', ...filings.map(f =>
      `- **${f.name}** — [${f.filer ?? 'filing index'}](${f.url}). EDGAR matches by name; check it is this company before using it.`), ''] : []),
    ...(skipped.length ? ['<details><summary>' + skipped.length + ' claims skipped</summary>', '',
      ...skipped.map(s => `- \`${s.claim.companyId}.${s.claim.field}\` — ${s.reason}`), '', '</details>', ''] : []),
    '---',
    'Proposed by the weekly refresh agent. Every figure above carries its source.',
    'Merging deploys the site and adds these lines to the public changelog.',
  ].join('\n');
}

function applyAndWritePR(file, doc, result, filings = []) {
  const outcome = applyProposals(doc, result);
  const pr = prBody(doc, result, outcome, filings);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(path.join(CACHE, 'pr-body.md'), pr);
  if (DRY) {
    fs.writeFileSync(path.join(CACHE, 'proposed.json'), JSON.stringify(doc, null, 2) + '\n');
    log(`dry run — wrote .agent-cache/proposed.json and .agent-cache/pr-body.md, data/ untouched`);
  } else {
    fs.writeFileSync(path.join(ROOT, 'data/markets', file), JSON.stringify(doc, null, 2) + '\n');
    log(`applied ${outcome.applied.length} changes to data/markets/${file}`);
  }
  return { applied: outcome.applied.length, pr };
}

/* ===================== main ============================================ */

export { discover, extract, reconcile, applyProposals, prBody, applyAndWritePR, parseFeed };

async function main() {
  const file = process.env.MARKET_FILE || 'personal-ai-agents.json';
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/markets', file), 'utf8'));

  log(`refreshing ${file} — ${doc.companies.length} companies${DRY ? ' (dry run)' : ''}`);
  const { candidates, filings } = await discover(doc.companies);
  const claims = candidates.length ? await extract(candidates) : [];
  const result = reconcile(doc, claims);
  const { applied, pr } = applyAndWritePR(file, doc, result, filings);
  console.log('\n' + pr);
  console.log(`\nDone. ${applied} change${applied === 1 ? '' : 's'}${DRY ? ' proposed (nothing written to data/)' : ' applied'}.`);
}

// Only run when invoked directly, so the guardrails can be unit-tested.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('refresh failed:', e.message); process.exit(1); });
}
