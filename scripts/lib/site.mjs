/**
 * Renders the whole static site from market documents. Pure: it takes the
 * markets, the template sources and options, and returns every output file as
 * a Map of path → contents. scripts/build.mjs writes that map to dist/; the
 * tests read it directly.
 *
 *   index.html                          the featured market's interactive map
 *   <market>/index.html                 every other market's map
 *   <market>/<company>/index.html       one static page per company (SEO)
 *   changelog/index.html                what changed, from git history
 *   404.html                            not-found page (production builds only)
 *   assets/site.css                     the shared stylesheet (map.css)
 *
 * Company pages and the map drawer render through templates/profile.mjs, so
 * the two never disagree.
 */
import fs from 'node:fs';
import path from 'node:path';
import { configureCategories, configureAxes, esc, date } from '../../templates/map-model.mjs';
import { renderProfile } from '../../templates/profile.mjs';

export const FONTS_URL = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;450;500;550;600;650;700&family=DM+Mono:wght@400;500&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap';

const TEMPLATE_FILES = {
  page: 'templates/map.html', styles: 'templates/map.css', model: 'templates/map-model.mjs',
  layout: 'templates/label-layout.mjs', profile: 'templates/profile.mjs', app: 'templates/map.js',
};
export function loadTemplates(root) {
  return Object.fromEntries(Object.entries(TEMPLATE_FILES).map(([key, file]) => [key, fs.readFileSync(path.join(root, file), 'utf8')]));
}

// The featured market is served at the root. Without an explicit flag the
// lowest edition wins, so adding a file never silently changes the home page.
export function orderMarkets(markets) {
  return [...markets].sort((a, b) =>
    (b.market.featured === true) - (a.market.featured === true)
    || (a.market.edition ?? Infinity) - (b.market.edition ?? Infinity)
    || a.market.id.localeCompare(b.market.id));
}

// The canonical JSON keeps full provenance; the page gets a compact shape.
// Scores are flat keys named after the market's axes (autonomy, breadth, …).
export function toPagePayload(m) {
  const axes = ['x', 'y', 'yAlt'].map(k => m.market.axes[k]?.key).filter(Boolean);
  const article = n => ({ t: n.title, p: n.publisher, d: n.date, u: n.url });
  const src = s => s ? { p: s.publisher, u: s.url, d: s.date } : null;
  return m.companies.map(c => {
    const rationales = Object.fromEntries(axes.slice(1).filter(k => c.axes[k]?.rationale).map(k => [k, c.axes[k].rationale]));
    return {
      id: c.id, name: c.name, shortName: c.shortName ?? null, company: c.company, brand: c.brand ?? null,
      cls: c.class, cat: c.category, hq: c.hq,
      site: c.website, desc: c.description, founded: c.founded, aliases: c.aliases ?? [], verified: c.lastVerified,
      founders: (c.founders || []).map(p => ({ n: p.name, r: p.role, li: p.linkedin })), parent: c.parent ?? null, traction: c.traction,
      valuation: c.lastRound.postMoneyUsd, raised: c.metrics?.totalRaisedUsd ?? null,
      raisedConf: c.metrics?.totalRaisedConfidence ?? null, raisedSrc: src(c.metrics?.totalRaisedSource),
      lastAmount: c.lastRound.amountUsd, lastSeries: c.lastRound.series,
      lastDate: c.lastRound.date, leads: c.lastRound.leads ?? [],
      others: c.lastRound.otherInvestors ?? [], conf: c.lastRound.confidence, valConf: c.lastRound.postMoneyConfidence ?? c.lastRound.confidence,
      valNote: c.lastRound.note ?? null,
      src: src(c.lastRound.source),
      ...(c.lastRound.postMoneySource ? { valSrc: src(c.lastRound.postMoneySource) } : {}),
      ...Object.fromEntries(axes.map(k => [k, c.axes[k]?.score ?? null])),
      why: c.axes[axes[0]]?.rationale ?? null,
      ...(Object.keys(rationales).length ? { rationales } : {}),
      news: (c.news ?? []).map(article),
      checks: (c.checks ?? []).map(article),
    };
  });
}

// Links: root-relative for production, or relative with explicit index.html
// (RELATIVE=1) so the site works from file://, a subdirectory, or a preview
// host that does not resolve directory URLs.
function linker(relative, featuredId) {
  const up = n => '../'.repeat(n);
  const home = n => relative ? (up(n) || './') + 'index.html' : '/';
  return {
    home,
    map: (n, id) => id === featuredId ? home(n) : relative ? `${up(n)}${id}/index.html` : `/${id}/`,
    changelog: n => relative ? `${up(n)}changelog/index.html` : '/changelog/',
    company: (n, market, id) => relative ? `${up(n)}${market}/${id}/index.html` : `/${market}/${id}/`,
    asset: (n, file) => relative ? `${up(n)}assets/${file}` : `/assets/${file}`,
  };
}

const clip = (text, n = 160) => {
  const s = String(text ?? '');
  if (s.length <= n) return s;
  const cut = s.lastIndexOf(' ', n - 1);
  return s.slice(0, cut > 40 ? cut : n - 1).replace(/[\s,;:.—–-]+$/, '') + '…';
};
const stripImports = source => source.replace(/^import\s[^;]+;\s*$/gm, '');
const inlineJSON = value => JSON.stringify(value).replace(/</g, '\\u003c');

export function wrapDoc(body, { title, desc, url }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="summary">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f5f5f1" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#121614" media="(prefers-color-scheme: dark)">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS_URL}">
<style>body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/**
 * @param markets   parsed data/markets/*.json documents
 * @param options   { templates, siteUrl, relative, commits: [{hash, date, subject}] }
 * @returns {{ files: Map<string, string>, pageCount: number, featured: object }}
 */
export function buildSite(markets, { templates, siteUrl = 'https://example.com', relative = false, commits = [] }) {
  const ordered = orderMarkets(markets);
  const featured = ordered[0];
  const link = linker(relative, featured.market.id);
  const files = new Map();
  files.set('assets/site.css', templates.styles);

  const mapsFor = depth => ordered.map(m => ({ id: m.market.id, name: m.market.name, edition: m.market.edition ?? null, href: link.map(depth, m.market.id) }));

  // Static pages share the map's stylesheet, masthead and footer, so a visitor
  // arriving from search sees the same product as one arriving from the map.
  const shell = (inner, { depth, title, desc, url, market }) => wrapDoc(`<link rel="stylesheet" href="${link.asset(depth, 'site.css')}">
<div class="page">
  <header class="masthead">
    <a class="wordmark" href="${link.home(depth)}"><span class="brand-icon" aria-hidden="true"><i></i><i></i><i></i><i></i></span>Market maps${market.edition ? `<span class="edition">/ ${String(market.edition).padStart(2, '0')}</span>` : ''}</a>
    <nav aria-label="Main navigation"><a href="${link.map(depth, market.id)}">← ${esc(market.name)}</a><a href="${link.changelog(depth)}">Changelog</a></nav>
  </header>
  <main class="doc-page">${inner}</main>
  <footer class="site-footer"><span class="footer-brand">Market maps / ${esc(market.name)}</span><span>Educational use only · not investment advice</span><a href="${link.changelog(depth)}">Changelog ↗</a></footer>
</div>`, { title, desc, url });

  /* ---------- 1. one interactive map per market -------------------------- */
  for (const m of ordered) {
    const isFeatured = m === featured;
    const depth = isFeatured ? 0 : 1;
    configureCategories(m.market.categories);
    configureAxes(m.market.axes);
    // Home and changelog links are right in the HTML itself, before any script runs.
    let page = templates.page
      .replaceAll('data-home href="./"', () => `data-home href="${link.home(depth)}"`)
      .replaceAll('data-changelog href="./changelog/"', () => `data-changelog href="${link.changelog(depth)}"`);
    page = page.replace('/*__STYLES__*/', () => templates.styles);
    page = page.replace('/*__MODEL__*/', () => templates.model);
    page = page.replace('/*__LAYOUT__*/', () => stripImports(templates.layout));
    page = page.replace('/*__PROFILE__*/', () => stripImports(templates.profile));
    page = page.replace('/*__APP__*/', () => templates.app);
    page = page.replace('/*__DATA__*/[]', () => inlineJSON(toPagePayload(m)));
    page = page.replace('/*__SITE__*/null', () => inlineJSON({
      marketId: m.market.id,
      asOf: m.market.asOf,
      name: m.market.name,
      tagline: m.market.tagline ?? '',
      edition: m.market.edition ?? null,
      author: m.market.author ?? null,
      scopeLabel: m.market.scopeLabel ?? null,
      scope: m.market.scope,
      inclusion: m.market.inclusion,
      exclusions: m.market.exclusions ?? [],
      excludedNonUS: m.market.excludedNonUS ?? [],
      judgedExcluded: m.market.judgedExcluded ?? [],
      axes: m.market.axes,
      categories: m.market.categories ?? [],
      quadrants: m.market.quadrants ?? {},
      home: link.home(depth),
      companyHref: link.company(depth, m.market.id, '__ID__'),
      changelog: link.changelog(depth),
      maps: ordered.length > 1 ? mapsFor(depth) : [],
    }));
    files.set(isFeatured ? 'index.html' : `${m.market.id}/index.html`, wrapDoc(page, {
      title: `${m.market.name} Market Map`,
      desc: m.market.definition,
      url: isFeatured ? `${siteUrl}/` : `${siteUrl}/${m.market.id}/`,
    }));
  }

  /* ---------- 2. one static page per company ----------------------------- */
  let pageCount = 0;
  for (const m of ordered) {
    configureCategories(m.market.categories);
    configureAxes(m.market.axes);
    for (const c of toPagePayload(m)) {
      const inner = `<article class="profile-page">${renderProfile(c, {
          variant: 'page',
          mapHref: `${link.map(2, m.market.id)}?view=map&company=${encodeURIComponent(c.id)}`,
        })}
    <p class="doc-disclaimer">Figures are compiled from public reporting and may be inaccurate or out of date. Educational use only; not investment advice.</p>
  </article>`;
      files.set(`${m.market.id}/${c.id}/index.html`, shell(inner, {
        depth: 2,
        title: `${c.name} — ${m.market.name}`,
        desc: clip(c.desc),
        url: `${siteUrl}/${m.market.id}/${c.id}/`,
        market: m.market,
      }));
      pageCount++;
    }
  }

  /* ---------- 3. changelog from git history ------------------------------ */
  const changelog = `<article class="doc-article">
  <p class="eyebrow">Changelog</p>
  <h1>What changed</h1>
  <p class="lede">Every change to the underlying data, straight from the commit history. Each entry is a merged pull request — proposed by the weekly agent, reviewed by a human.</p>
  ${commits.length
      ? `<ol class="changelog">${commits.map(c => `<li><time datetime="${esc(c.date)}">${date(c.date)}</time><span>${esc(c.subject)}</span></li>`).join('')}</ol>`
      : `<p class="doc-empty">No data commits yet. Entries appear here once changes to <code>data/markets</code> land on the main branch.</p>`}
  <p class="doc-disclaimer">Generated from <code>git log -- data/markets</code> at build time.</p>
  </article>`;
  files.set('changelog/index.html', shell(changelog, { depth: 1, title: 'Changelog — Market Maps', desc: 'Recent changes to the market map data.', url: `${siteUrl}/changelog/`, market: featured.market }));

  /* ---------- 4. not-found page ------------------------------------------ */
  // Cloudflare Pages serves a top-level 404.html for unknown paths. Without
  // one it treats the site as a single-page app and answers every unknown URL
  // with the home page. Relative builds skip it: their links assume a depth.
  if (!relative) {
    const notFound = `<article class="doc-article">
  <p class="eyebrow">Error 404</p>
  <h1>Page not found</h1>
  <p class="lede">There is no page at this address. A company page can move when the data is updated.</p>
  <p><a href="${link.home(0)}">Open the ${esc(featured.market.name)} map</a> · <a href="${link.changelog(0)}">See what changed</a></p>
  </article>`;
    files.set('404.html', shell(notFound, { depth: 0, title: 'Page not found — Market Maps', desc: 'This page does not exist.', url: `${siteUrl}/`, market: featured.market }));
  }

  /* ---------- 5. sitemap + robots ---------------------------------------- */
  const urls = ['', 'changelog/',
    ...ordered.filter(m => m !== featured).map(m => `${m.market.id}/`),
    ...ordered.flatMap(m => m.companies.map(c => `${m.market.id}/${c.id}/`))];
  files.set('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + urls.map(u => `  <url><loc>${esc(siteUrl)}/${u}</loc></url>`).join('\n') + `\n</urlset>\n`);
  files.set('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`);

  return { files, pageCount, featured };
}
