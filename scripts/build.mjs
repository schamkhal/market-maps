#!/usr/bin/env node
/**
 * Builds the static site into dist/.
 *
 *   dist/index.html                        the interactive map
 *   dist/<market>/<company>/index.html     one static page per company (SEO)
 *   dist/changelog/index.html              what changed, from git history
 *
 * Zero dependencies, runs in milliseconds. Deploy dist/ to Cloudflare Pages.
 *
 *   node scripts/build.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SITE_URL = process.env.SITE_URL || 'https://example.com';

// RELATIVE=1 emits relative links with explicit index.html, so the built site
// works from a file:// path, inside a subdirectory, or in a preview host that
// does not resolve directory URLs. Production deploys use root-relative links.
const REL = process.env.RELATIVE === '1';
const up = n => '../'.repeat(n);
const hrefHome = n => REL ? (up(n) || './') + 'index.html' : '/';
const hrefChangelog = n => REL ? up(n) + 'changelog/index.html' : '/changelog/';
const hrefCompany = (n, market, id) => REL ? up(n) + `${market}/${id}/index.html` : `/${market}/${id}/`;

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const usd = v => v == null ? 'Undisclosed'
  : v >= 1e9 ? '$' + (v / 1e9).toFixed(v / 1e9 >= 10 ? 0 : 2).replace(/\.00$/, '') + 'B'
  : v >= 1e6 ? '$' + (v / 1e6).toFixed(v < 1e7 ? 1 : 0).replace(/\.0$/, '') + 'M'
  : '$' + v.toLocaleString();
const day = d => d ? new Date(d + 'T00:00:00')
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const marketFiles = fs.readdirSync(path.join(ROOT, 'data/markets')).filter(f => f.endsWith('.json'));
const markets = marketFiles.map(f =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data/markets', f), 'utf8')));

/* ---------- 1. the interactive map ------------------------------------- */
// The canonical JSON keeps full provenance; the page gets a compact shape.
function toPagePayload(m) {
  // Product categories are a presentation layer for this first map. They are
  // deliberately kept separate from ownership class: a platform product can
  // still be an executive or knowledge agent.
  const category = {
    hark: 'executive', instinct: 'executive', town: 'executive', duckbill: 'executive',
    ohai: 'executive', pally: 'executive', martin: 'executive', cora: 'workflow',
    alexa: 'executive', siri: 'executive', chatgpt: 'executive',
    superhuman: 'workflow', motion: 'workflow', lindy: 'workflow', littlebird: 'knowledge',
    comet: 'workflow', cowork: 'workflow', spark: 'workflow', muse: 'executive', limitless: 'knowledge',
  };
  return m.companies.map(c => ({
    id: c.id, name: c.name, company: c.company, cls: c.class, cat: category[c.id] ?? 'executive', hq: c.hq,
    site: c.website, desc: c.description, founded: c.founded, aliases: c.aliases ?? [], verified: c.lastVerified,
    founders: (c.founders||[]).map(p=>({n:p.name,r:p.role,li:p.linkedin})), parent: c.parent??null, traction: c.traction,
    valuation: c.lastRound.postMoneyUsd, raised: c.metrics?.totalRaisedUsd ?? null,
    lastAmount: c.lastRound.amountUsd, lastSeries: c.lastRound.series,
    lastDate: c.lastRound.date, leads: c.lastRound.leads ?? [],
    others: c.lastRound.otherInvestors ?? [], conf: c.lastRound.confidence, valConf: c.lastRound.postMoneyConfidence ?? c.lastRound.confidence,
    valNote: c.lastRound.note ?? null,
    src: c.lastRound.source ? { p: c.lastRound.source.publisher, u: c.lastRound.source.url, d: c.lastRound.source.date } : null,
    autonomy: c.axes.autonomy.score, breadth: c.axes.breadth.score,
    distribution: c.axes.distribution.score, why: c.axes.autonomy.rationale,
    news: (c.news ?? []).map(n => ({ t: n.title, p: n.publisher, d: n.date, u: n.url })),
  }));
}

const primary = markets[0];
let page = fs.readFileSync(path.join(ROOT, 'templates/map.html'), 'utf8');
page = page.replace('/*__STYLES__*/', () => fs.readFileSync(path.join(ROOT, 'templates/map.css'), 'utf8'));
page = page.replace('/*__MODEL__*/', () => fs.readFileSync(path.join(ROOT, 'templates/map-model.mjs'), 'utf8'));
page = page.replace('/*__APP__*/', () => fs.readFileSync(path.join(ROOT, 'templates/map.js'), 'utf8'));
const inlineJSON = value => JSON.stringify(value).replace(/</g, '\\u003c');
page = page.replace('/*__DATA__*/[]', () => inlineJSON(toPagePayload(primary)));
page = page.replace('/*__SITE__*/null', () => inlineJSON({
  marketId: primary.market.id,
  asOf: primary.market.asOf,
  name: primary.market.name,
  scope: primary.market.scope,
  inclusion: primary.market.inclusion,
  exclusions: primary.market.exclusions,
  axes: primary.market.axes,
  home: hrefHome(0),
  companyHref: hrefCompany(0, primary.market.id, '__ID__'),
  changelog: hrefChangelog(0),
}));
fs.writeFileSync(path.join(DIST, 'index.html'), wrapDoc(page, {
  title: `${primary.market.name} — Market Map`,
  desc: primary.market.definition,
  url: SITE_URL,
}));

/* ---------- 2. one static page per company ----------------------------- */
let pageCount = 0;
for (const m of markets) {
  for (const c of m.companies) {
    const dir = path.join(DIST, m.market.id, c.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), companyPage(m, c));
    pageCount++;
  }
}

/* ---------- 3. changelog from git history ------------------------------ */
let commits = [];
try {
  const log = execSync(
    'git log --format=%H%x1f%ad%x1f%s --date=short -n 40 -- data/markets',
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  commits = log.trim().split('\n').filter(Boolean).map(l => {
    const [hash, date, subject] = l.split('\x1f');
    return { hash, date, subject };
  });
} catch { /* not a git repo yet — the changelog just renders empty */ }

fs.mkdirSync(path.join(DIST, 'changelog'), { recursive: true });
fs.writeFileSync(path.join(DIST, 'changelog/index.html'), changelogPage(commits));

/* ---------- 4. sitemap + robots ---------------------------------------- */
const urls = ['', 'changelog/',
  ...markets.flatMap(m => m.companies.map(c => `${m.market.id}/${c.id}/`))];
fs.writeFileSync(path.join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map(u => `  <url><loc>${SITE_URL}/${u}</loc></url>`).join('\n') + `\n</urlset>\n`);
fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);

console.log(`Built dist/ — 1 map, ${pageCount} company pages, ${commits.length} changelog entries.`);

/* ======================================================================= */

function wrapDoc(body, { title, desc, url }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="summary_large_image">
<style>html{color-scheme:light dark}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function shell(inner, { title, desc, url }) {
  return wrapDoc(`<style>
:root{--paper:#F4F5F9;--surface:#fff;--surface-2:#EBEDF4;--ink:#131826;--ink-2:#3E475E;--ink-3:#6B7490;
  --rule:#D6DAE6;--rule-soft:#E4E7F0;--accent:#2748CC;--accent-soft:#E5E9FA;--accent-ink:#1B3496;--ochre:#A2660D;--ochre-soft:#F7EDD9}
*{box-sizing:border-box}
body{background:var(--paper);color:var(--ink);font-family:"IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:15px;line-height:1.62;-webkit-font-smoothing:antialiased}
.wrap{max-width:760px;margin:0 auto;padding-inline:20px;padding-block:0 64px}
a{color:var(--accent);text-underline-offset:2px}
.back{display:inline-block;font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:11.5px;
  letter-spacing:.06em;color:var(--ink-3);text-decoration:none;padding-block:28px 0}
.back:hover{color:var(--accent)}
.eyebrow{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:10.5px;letter-spacing:.13em;
  text-transform:uppercase;color:var(--accent);margin:26px 0 10px}
h1{font-family:"Newsreader",Georgia,serif;font-weight:500;font-size:clamp(2rem,5vw,2.9rem);line-height:1.08;
  letter-spacing:-.015em;margin:0 0 8px;text-wrap:balance}
.sub{color:var(--ink-3);font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:12px;margin:0 0 22px}
.lede{font-size:1.06rem;color:var(--ink-2);margin:0 0 26px;max-width:64ch}
h2{font-family:"IBM Plex Sans",sans-serif;font-size:11px;font-weight:600;letter-spacing:.11em;text-transform:uppercase;
  color:var(--ink-3);margin:34px 0 12px;padding-bottom:9px;border-bottom:1px solid var(--rule)}
dl.kv{display:grid;grid-template-columns:auto 1fr;gap:10px 20px;margin:0;font-size:14.5px;align-items:baseline}
dl.kv dt{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:10.5px;letter-spacing:.08em;
  text-transform:uppercase;color:var(--ink-3);white-space:nowrap}
dl.kv dd{margin:0;font-variant-numeric:tabular-nums}
.src{display:block;font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:11px;color:var(--ink-3);margin-top:3px}
.src a{color:var(--ink-3)}
.src.manual{color:var(--ochre)}
.tag{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;
  padding:2px 7px;border-radius:3px;margin-left:7px;vertical-align:1px}
.tag.reported{background:var(--accent-soft);color:var(--accent-ink)}
.tag.estimated,.tag.manual{background:var(--ochre-soft);color:var(--ochre)}
.tag.undisclosed{background:var(--surface-2);color:var(--ink-3)}
.note{border-left:2px solid var(--ochre);background:var(--ochre-soft);padding:11px 14px;border-radius:0 4px 4px 0;
  font-size:13.5px;margin:14px 0;color:var(--ink)}
.invs{display:flex;flex-wrap:wrap;gap:5px}
.inv{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:10.5px;padding:3px 8px;
  background:var(--surface-2);border-radius:3px;color:var(--ink-2)}
.inv.lead{background:var(--accent-soft);color:var(--accent-ink);font-weight:500}
ul.news{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px}
ul.news a{color:var(--ink);text-decoration:none;display:block;line-height:1.4}
ul.news a:hover{color:var(--accent)}
ul.news .meta{display:block;font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:10.5px;color:var(--ink-3);margin-top:3px}
.axrow{display:grid;grid-template-columns:96px 1fr 30px;gap:11px;align-items:center;margin-bottom:8px;
  font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:.07em;
  text-transform:uppercase;color:var(--ink-3)}
.track{display:block;height:5px;background:var(--surface-2);border-radius:3px;overflow:hidden}
.fill{display:block;height:100%;background:var(--accent);border-radius:3px}
.axrow span:last-child{color:var(--ink);text-align:right;font-variant-numeric:tabular-nums}
.rationale{font-size:13.5px;color:var(--ink-3);font-style:italic;margin:10px 0 0;line-height:1.5}
.person{display:block;margin-bottom:10px}.person:last-child{margin-bottom:0}
.person a{color:var(--ink);text-decoration:none;font-weight:500;display:inline-flex;align-items:center;gap:6px}
.person a:hover{color:var(--accent)}
.person a:hover .li{background:var(--accent);color:var(--surface);border-color:var(--accent)}
.li{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:9px;font-weight:700;border:1px solid var(--rule);
  border-radius:2px;padding:1px 3px;color:var(--ink-3);line-height:1.25}
.noli{font-weight:500;color:var(--ink)}
.role{display:block;font-size:12px;color:var(--ink-3);line-height:1.45;margin-top:2px}
dd.parent{font-size:14px;color:var(--ink-2);line-height:1.55}
footer{margin-top:44px;padding-top:20px;border-top:1px solid var(--rule);font-size:12.5px;color:var(--ink-3)}
.cl{display:grid;grid-template-columns:104px 1fr;gap:14px;padding:13px 0;border-bottom:1px solid var(--rule-soft);font-size:14px}
.cl time{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--ink-3)}
@media (max-width:560px){dl.kv{grid-template-columns:1fr;gap:3px 0}dl.kv dd{margin-bottom:10px}.cl{grid-template-columns:1fr;gap:3px}}
:root,:root[data-theme="dark"]{color-scheme:light;--paper:#f5f5f1;--surface:#fff;--surface-2:#edf1e9;--ink:#222925;--ink-2:#4e5751;--ink-3:#747b75;--rule:#dfe3dc;--rule-soft:#e8ece4;--accent:#30634b;--accent-soft:#e9f0e4;--accent-ink:#30634b;--ochre:#9b6b25;--ochre-soft:#fbf7ed}
body{font-family:"DM Sans",system-ui,sans-serif}.wrap{max-width:850px}h1{font-size:clamp(2.6rem,5vw,3.6rem);font-weight:400;letter-spacing:-.03em}dl.kv{background:var(--surface);padding:23px;border:1px solid var(--rule);border-radius:10px}h2{font-family:"DM Sans",system-ui,sans-serif}ul.news li{background:var(--surface);border:1px solid var(--rule);border-radius:8px;padding:15px}.back{font-family:"DM Sans",system-ui,sans-serif;font-size:12px}
</style>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500&family=IBM+Plex+Mono:wght@400;500&family=DM+Sans:wght@400;500;600&display=swap">
<div class="wrap">${inner}</div>`, { title, desc, url });
}

function companyPage(m, c) {
  const r = c.lastRound;
  const valConf = r.postMoneyConfidence ?? r.confidence;
  const valLine = c.class === 'platform'
    ? `<span style="color:var(--ink-3)">Not comparable — product of ${esc(c.company)}</span>`
    : `${usd(r.postMoneyUsd)}<span class="tag ${valConf}">${valConf}</span>`;

  const inner = `
  <a class="back" href="${hrefHome(2)}">← ${esc(m.market.name)}</a>
  <p class="eyebrow">${c.class === 'platform' ? 'Product of a larger company'
      : c.class === 'acquired' ? 'Acquired' : 'Independent company'}</p>
  <h1>${esc(c.name)}</h1>
  <p class="sub">${c.company && !c.name.includes(c.company) ? esc(c.company) + (c.hq ? ' · ' : '') : ''}${c.hq ? esc(c.hq) : ''}${
      c.website ? ` · <a href="${esc(c.website)}" rel="noopener nofollow">${esc(c.website.replace(/^https?:\/\/(www\.)?/, ''))} ↗</a>` : ''}</p>
  <p class="lede">${esc(c.description)}</p>

  <h2>Funding</h2>
  <dl class="kv">
    <dt>Post-money</dt><dd>${valLine}${
      valConf === 'manual' ? `<span class="src manual">entered by hand · no public source</span>`
      : r.source ? `<span class="src">per <a href="${esc(r.source.url)}" rel="noopener nofollow">${esc(r.source.publisher)}</a>, ${day(r.source.date)}</span>`
      : `<span class="src">no public source found</span>`}</dd>
    ${c.class === 'platform' ? '' : `<dt>Total raised</dt><dd>${usd(c.metrics?.totalRaisedUsd)}</dd>`}
    <dt>Last round</dt><dd>${esc(r.series)}${r.amountUsd ? ' · ' + usd(r.amountUsd) : ''}<span class="src">${day(r.date)}${
      r.source ? ` · per <a href="${esc(r.source.url)}" rel="noopener nofollow">${esc(r.source.publisher)}</a>` : ''}</span></dd>
    ${r.leads?.length ? `<dt>Led by</dt><dd><div class="invs">${r.leads.map(i => `<span class="inv lead">${esc(i)}</span>`).join('')}</div></dd>` : ''}
    ${r.otherInvestors?.length ? `<dt>Also in</dt><dd><div class="invs">${r.otherInvestors.map(i => `<span class="inv">${esc(i)}</span>`).join('')}</div></dd>` : ''}
    ${c.founders?.length ? `<dt>${c.founders.length > 1 ? 'Founders' : 'Founder'}</dt><dd>${c.founders.map(p => `
      <span class="person">${p.linkedin
        ? `<a href="${esc(p.linkedin)}" rel="noopener nofollow">${esc(p.name)}<span class="li">in</span></a>`
        : `<span class="noli">${esc(p.name)}</span>`}${p.role ? `<span class="role">${esc(p.role)}</span>` : ''}</span>`).join('')}</dd>` : ''}
    ${c.parent ? `<dt>Parent</dt><dd class="parent">${esc(c.parent)}</dd>` : ''}
    ${c.founded ? `<dt>Founded</dt><dd>${c.founded}</dd>` : ''}
    ${c.traction ? `<dt>Traction</dt><dd>${esc(c.traction)}</dd>` : ''}
  </dl>
  ${r.note ? `<p class="note">${esc(r.note)}</p>` : ''}

  <h2>Position on the map</h2>
  ${['autonomy', 'breadth', 'distribution'].map(k => `
  <div class="axrow"><span>${k}</span><span class="track"><span class="fill" style="width:${c.axes[k].score}%"></span></span><span>${c.axes[k].score}</span></div>`).join('')}
  ${c.axes.autonomy.rationale ? `<p class="rationale">“${esc(c.axes.autonomy.rationale)}”</p>` : ''}

  ${c.news?.length ? `<h2>Latest news</h2><ul class="news">${c.news.map(n => `
    <li><a href="${esc(n.url)}" rel="noopener nofollow">${esc(n.title)}<span class="meta">${esc(n.publisher)} · ${day(n.date)}</span></a></li>`).join('')}</ul>` : ''}

  <footer>
    Last verified ${day(c.lastVerified)}. Figures compiled from public reporting and may be inaccurate or out of date.
    Educational use only; not investment advice.
    <a href="${hrefChangelog(2)}">What changed recently →</a>
  </footer>`;

  return shell(inner, {
    title: `${c.name} — ${m.market.name}`,
    desc: c.description.slice(0, 180),
    url: `${SITE_URL}/${m.market.id}/${c.id}/`,
  });
}

function changelogPage(commits) {
  const inner = `
  <a class="back" href="${hrefHome(1)}">← Back to the map</a>
  <p class="eyebrow">Changelog</p>
  <h1>What changed</h1>
  <p class="lede">Every change to the underlying data, straight from the commit history. Each entry is a merged pull request — proposed by the weekly agent, reviewed by a human.</p>
  ${commits.length
      ? commits.map(c => `<div class="cl"><time>${day(c.date)}</time><div>${esc(c.subject)}</div></div>`).join('')
      : `<p style="color:var(--ink-3)">No data commits yet. Entries appear here once changes to <code>data/markets</code> land on the main branch.</p>`}
  <footer>Generated from <code>git log -- data/markets</code> at build time.</footer>`;
  return shell(inner, { title: 'Changelog — Market Maps', desc: 'Recent changes to the market map data.', url: `${SITE_URL}/changelog/` });
}
