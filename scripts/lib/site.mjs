/**
 * Renders the whole static site from market documents. Pure: it takes the
 * markets, the template sources and options, and returns every output file as
 * a Map of path → contents. scripts/build.mjs writes that map to dist/; the
 * tests read it directly.
 *
 *   index.html                          the maps hub: every map, newest first
 *   <market>/index.html                 each market's interactive map
 *   <market>/<company>/index.html       a forward to that company's profile on its map
 *   404.html                            not-found page (production builds only)
 *   assets/site.css                     the shared stylesheet (map.css)
 *   assets/logos/<market>/<file>        company logos for the list and profiles
 *   assets/previews/<name>.png          link-preview images (og:image), see scripts/lib/previews.mjs
 *   favicon.svg, favicon.ico, apple-touch-icon.png   the site icon
 *
 * A company's profile lives in its map's drawer (templates/profile.mjs). Its
 * own address forwards there, so links shared before the drawer was the only
 * profile still land on the same company.
 */
import fs from 'node:fs';
import path from 'node:path';
import { configureCategories, configureAxes, esc } from '../../templates/map-model.mjs';
import { renderHub } from './hub.mjs';
import { PREVIEW } from './previews.mjs';

export const FONTS_URL = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;450;500;550;600;650;700&family=DM+Mono:wght@400;500&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap';

const TEMPLATE_FILES = {
  page: 'templates/map.html', styles: 'templates/map.css', model: 'templates/map-model.mjs',
  layout: 'templates/label-layout.mjs', profile: 'templates/profile.mjs', app: 'templates/map.js',
};
export function loadTemplates(root) {
  return Object.fromEntries(Object.entries(TEMPLATE_FILES).map(([key, file]) => [key, fs.readFileSync(path.join(root, file), 'utf8')]));
}

// Company logos live in data/logos/<market>/<company>.<ext> (scripts/fetch-logos.mjs
// fetches them), with an optional <company>-dark.<ext> for dark pages.
// Returns { market: { company: { light: { name, bytes }, dark? } } }.
export function loadLogos(root) {
  const base = path.join(root, 'data/logos'), logos = {};
  if (!fs.existsSync(base)) return logos;
  for (const market of fs.readdirSync(base)) {
    const dir = path.join(base, market);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir).filter(f => /\.(png|jpe?g|svg|webp|ico|gif)$/i.test(f)).sort()) {
      const [, id, dark] = name.match(/^(.+?)(-dark)?\.[a-z]+$/i);
      ((logos[market] ??= {})[id] ??= {})[dark ? 'dark' : 'light'] = { name, bytes: fs.readFileSync(path.join(dir, name)) };
    }
  }
  return logos;
}

// Before the maps hub, the featured market was served at the site root, and
// links from that time (/?company=…) still open it. Without an explicit flag
// the lowest edition wins, so adding a file never changes where they land.
export function orderMarkets(markets) {
  return [...markets].sort((a, b) =>
    (b.market.featured === true) - (a.market.featured === true)
    || (a.market.edition ?? Infinity) - (b.market.edition ?? Infinity)
    || a.market.id.localeCompare(b.market.id));
}
// Reading order for menus: map 01, 02, …
export const byEdition = markets => [...markets].sort((a, b) =>
  (a.market.edition ?? Infinity) - (b.market.edition ?? Infinity) || a.market.id.localeCompare(b.market.id));

// The canonical JSON keeps full provenance; the page gets a compact shape.
// Scores are flat keys named after the market's axes (autonomy, breadth, …).
export function toPagePayload(m, { logo = () => null } = {}) {
  const axes = ['x', 'y', 'yAlt'].map(k => m.market.axes[k]?.key).filter(Boolean);
  const article = n => ({ t: n.title, p: n.publisher, d: n.date, u: n.url });
  const src = s => s ? { p: s.publisher, u: s.url, d: s.date } : null;
  return m.companies.map(c => {
    const rationales = Object.fromEntries(axes.filter(k => c.axes[k]?.rationale).map(k => [k, c.axes[k].rationale]));
    return {
      id: c.id, name: c.name, shortName: c.shortName ?? null, company: c.company, brand: c.brand ?? null,
      cls: c.class, cat: c.category, hq: c.hq,
      site: c.website, desc: c.description, founded: c.founded, aliases: c.aliases ?? [],
      founders: (c.founders || []).map(p => ({ n: p.name, r: p.role, li: p.linkedin })), parent: c.parent ?? null, traction: c.traction,
      valuation: c.lastRound.postMoneyUsd, raised: c.metrics?.totalRaisedUsd ?? null,
      raisedConf: c.metrics?.totalRaisedConfidence ?? null, raisedSrc: src(c.metrics?.totalRaisedSource),
      lastAmount: c.lastRound.amountUsd, lastSeries: c.lastRound.series,
      lastDate: c.lastRound.date, leads: c.lastRound.leads ?? [],
      others: c.lastRound.otherInvestors ?? [], conf: c.lastRound.confidence, valConf: c.lastRound.postMoneyConfidence ?? c.lastRound.confidence,
      valNote: c.lastRound.note ?? null,
      src: src(c.lastRound.source),
      ...(c.lastRound.postMoneySource ? { valSrc: src(c.lastRound.postMoneySource) } : {}),
      ...(c.lastRound.postMoneyBasis === 'acquisition' ? { valBasis: 'acquisition' } : {}),
      ...Object.fromEntries(axes.map(k => [k, c.axes[k]?.score ?? null])),
      ...(Object.keys(rationales).length ? { rationales } : {}),
      news: (c.news ?? []).map(article),
      checks: (c.checks ?? []).map(article),
      ...logo(c.id),
    };
  });
}

// Links: root-relative for production, or relative with explicit index.html
// (RELATIVE=1) so the site works from file://, a subdirectory, or a preview
// host that does not resolve directory URLs. `n` is the linking page's depth.
function linker(relative) {
  const up = n => '../'.repeat(n);
  return {
    home: n => relative ? (up(n) || './') + 'index.html' : '/',
    map: (n, id) => relative ? `${up(n)}${id}/index.html` : `/${id}/`,
    asset: (n, file) => relative ? `${up(n)}assets/${file}` : `/assets/${file}`,
    root: (n, file) => relative ? `${up(n)}${file}` : `/${file}`,
  };
}

const stripImports = source => source.replace(/^import\s[^;]+;\s*$/gm, '');
const inlineJSON = value => JSON.stringify(value).replace(/</g, '\\u003c');
const BRAND_ICON = '<span class="brand-icon" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';

// A shared link previews as `image` ({ url, alt }, an absolute URL) when the
// page has one: LinkedIn, Slack and iMessage read og:image, X twitter:image.
export const previewTags = image => image
  ? `<meta property="og:image" content="${esc(image.url)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="${PREVIEW.width}">
<meta property="og:image:height" content="${PREVIEW.height}">
<meta property="og:image:alt" content="${esc(image.alt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(image.url)}">`
  : '<meta name="twitter:card" content="summary">';

export function wrapDoc(body, { title, desc, url, head = '', image = null }) {
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
<meta property="og:site_name" content="Market Maps">
${previewTags(image)}
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f5f5f1" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#121614" media="(prefers-color-scheme: dark)">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS_URL}">
<style>body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
${head}</head>
<body>
${body}
</body>
</html>
`;
}

/**
 * @param markets   parsed data/markets/*.json documents
 * @param options   { templates, siteUrl, relative }
 * @returns {{ files: Map<string, string>, pageCount: number, legacy: object }}
 */
export function buildSite(markets, { templates, siteUrl = 'https://example.com', relative = false, logos = {}, previews = {} }) {
  const maps = byEdition(markets);
  const legacy = orderMarkets(markets)[0];
  const link = linker(relative);
  const files = new Map();
  files.set('assets/site.css', templates.styles);
  // Link-preview images and the site icon, where scripts/previews.mjs has made them.
  const { previews: images = {}, brand = {} } = previews;
  for (const [name, bytes] of Object.entries(images)) files.set(`assets/previews/${name}.png`, bytes);
  const preview = (name, alt) => images[name] ? { url: `${siteUrl}/assets/previews/${name}.png`, alt } : null;
  const mapAlt = m => `${m.market.name} market map: ${m.companies.length} companies placed by ${m.market.axes.x.label.toLowerCase()} and ${m.market.axes.y.label.toLowerCase()}`;
  const hubAlt = `Market maps: ${maps.map(m => m.market.name).join(' and ')}`;
  const ICON_FILES = { 'icon.svg': 'favicon.svg', 'favicon.ico': 'favicon.ico', 'apple-touch-icon.png': 'apple-touch-icon.png' };
  for (const [source, target] of Object.entries(ICON_FILES)) if (brand[source]) files.set(target, brand[source]);
  const icons = depth => [
    brand['icon.svg'] ? `<link rel="icon" href="${link.root(depth, 'favicon.svg')}" type="image/svg+xml">` : '',
    brand['favicon.ico'] ? `<link rel="icon" href="${link.root(depth, 'favicon.ico')}" sizes="32x32">` : '',
    brand['apple-touch-icon.png'] ? `<link rel="apple-touch-icon" href="${link.root(depth, 'apple-touch-icon.png')}">` : '',
  ].filter(Boolean).map(tag => tag + '\n').join('');
  // Logos: a light file, and a dark one where the company publishes one. The
  // map page links them from one level down (<market>/index.html).
  const logoHrefs = {};
  for (const m of maps) for (const [id, variants] of Object.entries(logos[m.market.id] ?? {})) {
    if (!variants.light) continue;
    const href = variant => { files.set(`assets/logos/${m.market.id}/${variant.name}`, variant.bytes); return link.asset(1, `logos/${m.market.id}/${variant.name}`); };
    (logoHrefs[m.market.id] ??= {})[id] = { logo: href(variants.light), ...(variants.dark ? { logoDark: href(variants.dark) } : {}) };
  }

  const mapsFor = depth => maps.map(m => ({ id: m.market.id, name: m.market.name, edition: m.market.edition ?? null, href: link.map(depth, m.market.id) }));

  // Static pages share the map's stylesheet, masthead and footer, so a visitor
  // arriving from search sees the same product as one arriving from the map.
  // The wordmark always leads to the hub.
  const shell = (inner, { depth, title, desc, url, nav = '', mainClass = 'doc-page', head = '', image = null }) => wrapDoc(`<link rel="stylesheet" href="${link.asset(depth, 'site.css')}">
<div class="page">
  <header class="masthead">
    <a class="wordmark" href="${link.home(depth)}">${BRAND_ICON}Market maps</a>
    ${nav ? `<nav aria-label="Main navigation">${nav}</nav>` : ''}
  </header>
  <main class="${mainClass}">${inner}</main>
  <footer class="site-footer"><span>Educational use only · not investment advice</span></footer>
</div>`, { title, desc, url, head: icons(depth) + head, image });
  const backToMaps = depth => `<a href="${link.home(depth)}">← All maps</a>`;

  /* ---------- 1. the hub ------------------------------------------------- */
  // Before the hub, the legacy map lived at the root. Its links (/?company=…,
  // /?view=map, /#methodology) are forwarded before the hub ever paints.
  const forward = `<script>
(function () {
  var state = /[?&](view|cat|owner|q|axis|size|sort|company)=/, section = /^#(landscape|research|methodology)$/;
  if (state.test(location.search) || section.test(location.hash)) location.replace(${inlineJSON(link.map(0, legacy.market.id))} + location.search + location.hash);
  if (/[?&]card(=|&|$)/.test(location.search)) document.documentElement.className += ' card';
})();
</script>
`;
  files.set('index.html', shell(renderHub(maps, { link }), {
    depth: 0,
    title: 'Market Maps',
    desc: `Sourced, scored maps of emerging AI markets: ${maps.map(m => m.market.name).join(', ')}.`,
    url: `${siteUrl}/`,
    mainClass: 'hub-page',
    head: forward,
    image: preview('index', hubAlt),
  }));

  /* ---------- 2. one interactive map per market -------------------------- */
  for (const m of maps) {
    configureCategories(m.market.categories, m.market.allDescription);
    configureAxes(m.market.axes);
    // The home link and the title are right in the HTML itself, before any script runs.
    let page = templates.page
      .replaceAll('data-home href="./"', () => `data-home href="${link.home(1)}"`)
      .replace('<h1 id="pageTitle"></h1>', () => `<h1 id="pageTitle">${esc(m.market.name)}</h1>`);
    page = page.replace('/*__STYLES__*/', () => templates.styles);
    page = page.replace('/*__MODEL__*/', () => templates.model);
    page = page.replace('/*__LAYOUT__*/', () => stripImports(templates.layout));
    page = page.replace('/*__PROFILE__*/', () => stripImports(templates.profile));
    page = page.replace('/*__APP__*/', () => templates.app);
    page = page.replace('/*__DATA__*/[]', () => inlineJSON(toPagePayload(m, { logo: id => logoHrefs[m.market.id]?.[id] ?? null })));
    page = page.replace('/*__SITE__*/null', () => inlineJSON({
      marketId: m.market.id,
      asOf: m.market.asOf,
      name: m.market.name,
      tagline: m.market.tagline ?? '',
      allDescription: m.market.allDescription ?? null,
      edition: m.market.edition ?? null,
      author: m.market.author ?? null,
      scope: m.market.scope,
      inclusion: m.market.inclusion,
      exclusions: m.market.exclusions ?? [],
      excludedNonUS: m.market.excludedNonUS ?? [],
      judgedExcluded: m.market.judgedExcluded ?? [],
      axes: m.market.axes,
      categories: m.market.categories ?? [],
      quadrants: m.market.quadrants ?? {},
      home: link.home(1),
      maps: maps.length > 1 ? mapsFor(1) : [],
    }));
    files.set(`${m.market.id}/index.html`, wrapDoc(page, {
      title: `${m.market.name} Market Map`,
      desc: m.market.definition,
      url: `${siteUrl}/${m.market.id}/`,
      head: icons(1),
      image: preview(m.market.id, mapAlt(m)),
    }));
  }

  /* ---------- 3. company addresses forward to their profile --------------- */
  // A company's profile is its map's drawer. Its old address, already shared
  // and indexed, opens that drawer; the forward itself stays out of search.
  // Shared, it previews as its map.
  let pageCount = 0;
  for (const m of maps) {
    for (const c of m.companies) {
      const target = `${link.map(2, m.market.id)}?company=${encodeURIComponent(c.id)}`;
      const title = `${c.name} — ${m.market.name}`, canonical = `${siteUrl}/${m.market.id}/?company=${encodeURIComponent(c.id)}`;
      files.set(`${m.market.id}/${c.id}/index.html`, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="description" content="${esc(c.description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(c.description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="Market Maps">
${previewTags(preview(m.market.id, mapAlt(m)))}
${icons(2)}</head>
<body>
<p><a href="${esc(target)}">${esc(c.name)} on the ${esc(m.market.name)} map</a></p>
</body>
</html>
`);
      pageCount++;
    }
  }

  /* ---------- 4. not-found page ------------------------------------------ */
  // Cloudflare Pages serves a top-level 404.html for unknown paths. Without
  // one it treats the site as a single-page app and answers every unknown URL
  // with the home page. Relative builds skip it: their links assume a depth.
  if (!relative) {
    const notFound = `<article class="doc-article">
  <p class="eyebrow">Error 404</p>
  <h1>Page not found</h1>
  <p class="lede">There is no page at this address. A company can leave a map when the data is updated.</p>
  <ul class="doc-maps">${maps.map(m => `<li><a href="${link.map(0, m.market.id)}">${esc(m.market.name)}</a></li>`).join('')}</ul>
  <p><a href="${link.home(0)}">See all maps</a></p>
  </article>`;
    files.set('404.html', shell(notFound, {
      depth: 0, title: 'Page not found — Market Maps', desc: 'This page does not exist.', url: `${siteUrl}/`,
      nav: backToMaps(0), image: preview('index', hubAlt),
    }));
  }

  /* ---------- 5. sitemap + robots ---------------------------------------- */
  const urls = ['', ...maps.map(m => `${m.market.id}/`)];
  files.set('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + urls.map(u => `  <url><loc>${esc(siteUrl)}/${u}</loc></url>`).join('\n') + `\n</urlset>\n`);
  files.set('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`);

  return { files, pageCount, legacy };
}
