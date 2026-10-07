/**
 * The maps hub: the site's front page. One card per map, newest edition
 * first, each with a small static preview of the map drawn from its data.
 * Pure: takes market documents and a linker, returns the page's inner HTML.
 */
import { esc, LOG_FLOOR, LOG_BEND } from '../../templates/map-model.mjs';

const axisName = def => def.short || def.label;

// A thumbnail of the map in its default view: the horizontal axis against the
// first vertical one, marks sized by valuation on the map's log scale. It is
// decorative; the card's text carries the meaning.
export function mapPreview({ market, companies }, { width = 360, height = 210 } = {}) {
  const xKey = market.axes.x.key, yKey = market.axes.y.key;
  const m = { l: 24, r: 10, t: 10, b: 24 };
  const x = s => m.l + s / 100 * (width - m.l - m.r);
  const y = s => height - m.b - s / 100 * (height - m.t - m.b);
  const colors = Object.fromEntries((market.categories ?? []).map(c => [c.id, c.color]));
  const value = c => c.class === 'platform' ? 0 : c.lastRound.postMoneyUsd || 0;
  const max = Math.max(0, ...companies.map(value));
  const decades = Math.log10(max / LOG_FLOOR);
  const step = c => decades > 0 ? Math.min(1, Math.max(0, Math.log10(value(c) / LOG_FLOOR) / decades)) : 1;
  const radius = c => c.class === 'platform' ? 4.6 : value(c) > 0 ? 3.2 + 4.8 * step(c) ** LOG_BEND : 2.8;
  const n = v => +v.toFixed(1);
  // Largest first, so the small marks stay visible on top.
  const marks = [...companies].sort((a, b) => radius(b) - radius(a)).map(c => {
    const cx = n(x(c.axes[xKey]?.score ?? 0)), cy = n(y(c.axes[yKey]?.score ?? 0)), r = n(radius(c));
    const hue = `style="--c:${esc(colors[c.category] ?? '#30634b')}"`;
    if (c.class === 'platform') return `<rect class="preview-mark square" x="${n(cx - r)}" y="${n(cy - r)}" width="${n(2 * r)}" height="${n(2 * r)}" rx="1" ${hue}/>`;
    return `<circle class="preview-mark${value(c) > 0 ? '' : ' hollow'}" cx="${cx}" cy="${cy}" r="${r}" ${hue}/>`
      + (c.class === 'acquired' ? `<circle class="preview-ring" cx="${cx}" cy="${cy}" r="${n(r + 2)}" ${hue}/>` : '');
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">`
    + `<rect class="preview-region" x="${n(x(50))}" y="${m.t}" width="${n(x(100) - x(50))}" height="${n(y(50) - m.t)}"/>`
    + `<rect class="preview-frame" x="${m.l}" y="${m.t}" width="${width - m.l - m.r}" height="${height - m.t - m.b}"/>`
    + `<line class="preview-mid" x1="${n(x(50))}" y1="${m.t}" x2="${n(x(50))}" y2="${height - m.b}"/>`
    + `<line class="preview-mid" x1="${m.l}" y1="${n(y(50))}" x2="${width - m.r}" y2="${n(y(50))}"/>`
    + marks
    + `<text class="preview-axis" x="${width - m.r}" y="${height - 7}" text-anchor="end">${esc(axisName(market.axes.x).toUpperCase())} →</text>`
    + `<text class="preview-axis" transform="translate(14 ${m.t}) rotate(-90)" text-anchor="end">${esc(axisName(market.axes.y).toUpperCase())} →</text>`
    + `</svg>`;
}

/**
 * @param docs   market documents, in any order
 * @param link   the site's linker (scripts/lib/site.mjs)
 */
export function renderHub(docs, { link }) {
  const newestFirst = [...docs].sort((a, b) => (b.market.edition ?? 0) - (a.market.edition ?? 0) || a.market.id.localeCompare(b.market.id));
  const newest = newestFirst[0]?.market.edition;
  const authors = [...new Set(docs.map(d => d.market.author).filter(Boolean))];

  const cards = newestFirst.map(doc => {
    const { market } = doc;
    const categories = (market.categories ?? []).map(c => `<li style="--category:${esc(c.color)}"><i class="category-dot" aria-hidden="true"></i>${esc(c.name)}</li>`).join('');
    const axes = [market.axes.x, market.axes.y].map(axisName).join(' × ');
    return `<li class="map-card">
      <div class="map-card-preview">${mapPreview(doc)}</div>
      <div class="map-card-body">
        <div class="map-card-heading"><h3><a href="${link.map(0, market.id)}">${esc(market.name)}</a></h3>${docs.length > 1 && market.edition === newest ? '<span class="map-card-new">Latest</span>' : ''}</div>
        ${market.tagline ? `<p class="map-card-tagline">${esc(market.tagline)}</p>` : ''}
        ${categories ? `<ul class="map-card-categories" aria-label="Focus groups">${categories}</ul>` : ''}
        <dl class="map-card-stats">
          <div><dt>Companies</dt><dd>${doc.companies.length}</dd></div>
          <div><dt>Axes</dt><dd>${esc(axes)}</dd></div>
        </dl>
        <span class="map-card-cta" aria-hidden="true">Open map →</span>
      </div>
    </li>`;
  }).join('\n    ');

  return `<section class="hero hub-hero" aria-labelledby="hubTitle">
    <div class="hero-copy">
      <p class="eyebrow">Independent research</p>
      <h1 id="hubTitle">Market maps</h1>
      <p class="lede">Sourced, scored maps of emerging AI markets. Every valuation and funding figure cites its source, or says plainly that it has none.</p>
      ${authors.length === 1 ? `<p class="byline">By <strong>${esc(authors[0])}</strong></p>` : ''}
    </div>
  </section>
  <section class="hub-maps" id="maps" aria-labelledby="mapsTitle">
    <h2 id="mapsTitle" class="visually-hidden">The maps</h2>
    <ol class="map-cards">
    ${cards}
    </ol>
  </section>
  <section class="hub-method" aria-label="How the maps are made">
    <div><h3>Sourced</h3><p>Every valuation and funding total cites the page it came from, or is labeled as having no public source.</p></div>
    <div><h3>Scored</h3><p>Positions are editorial judgments against rubrics published on each map, and every company profile explains its scores.</p></div>
    <div><h3>Kept current</h3><p>Each map is re-checked against new reporting, and figures and scores change when the evidence does.</p></div>
  </section>`;
}
