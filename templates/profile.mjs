// One company profile, rendered from the compact page payload into the map's
// profile drawer. It is the whole profile: every figure, caveat and source.
//
// The build strips these import lines when it inlines this file after
// map-model.mjs in the page's single module script.
import { CATEGORIES, OWNERSHIP, CONFIDENCE, CONFIDENCE_MEANING, AXES, AXIS_NAMES, esc, date, money, initials, valueConfidence, raisedConfidence, isDealPrice, safeUrl } from './map-model.mjs';

export const categoryColor = company => CATEGORIES[company.cat]?.color || CATEGORIES.all.color;
// The company's logo where the dataset has one (a dark-page version too, when
// the company publishes it); otherwise its initials on a tile in its focus colour.
const logoImg = (src, cls) => `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" decoding="async">`;
export const avatar = company => company.logo
  ? `<span class="avatar has-logo${company.logoDark ? ' has-dark' : ''}" aria-hidden="true">${logoImg(company.logo, 'logo-light')}${company.logoDark ? logoImg(company.logoDark, 'logo-dark') : ''}</span>`
  : `<span class="avatar" aria-hidden="true" style="--category:${esc(categoryColor(company))}">${esc(initials(company))}</span>`;
// A link that is not http(s) renders as plain text rather than a live href.
export const externalLink = (url, label, classes = '') => safeUrl(url)
  ? `<a href="${esc(safeUrl(url))}"${classes ? ` class="${classes}"` : ''} target="_blank" rel="noopener noreferrer nofollow">${label}</a>`
  : `<span${classes ? ` class="${classes}"` : ''}>${label}</span>`;
export const confidenceChip = company => { const level = valueConfidence(company); return `<span class="confidence ${level}">${esc(CONFIDENCE[level])}</span>`; };

function valuationBlock(c) {
  if (c.cls === 'platform') {
    return `<div class="parent-note"><strong>No standalone valuation</strong><br>This is a product of ${esc(c.company)}. Parent-company valuations and funding are excluded from the map.${c.parent ? `<p class="value-note">${esc(c.parent)}</p>` : ''}</div>`;
  }
  const level = valueConfidence(c);
  const source = c.src ? externalLink(c.src.u, esc(c.src.p) + ' ↗') : null;
  // The valuation may cite its own source; otherwise it shares the round's.
  const valSrc = c.valSrc ?? c.src;
  const sourceLine = c.valuation == null ? 'No valuation disclosed in this dataset.'
    : level === 'manual' ? 'Source not public'
    : valSrc ? `${externalLink(valSrc.u, esc(valSrc.p) + ' ↗')} · ${date(valSrc.d)}` : 'No public source recorded';
  const why = [
    CONFIDENCE_MEANING[level],
    isDealPrice(c)
      ? 'It is the price of an announced acquisition, not the price of a funding round, so it is not comparable with the round valuations beside it. On the map, bubble size grows with it on a log scale.'
      : level === 'rumored'
      ? 'It is the price reported for a round still being negotiated, so it may change or never close. On the map, bubble size grows with it on a log scale.'
      : 'Post-money valuation is the price implied by the last priced round, not a current market value. On the map, bubble size grows with it on a log scale.',
    c.cls === 'acquired' && !isDealPrice(c) ? 'For an acquired company this is the last private-round valuation, not the acquisition price.' : null,
  ].filter(Boolean);
  return `<div class="valuation-box ${level}"><span>${isDealPrice(c) ? 'Valuation · announced acquisition price' : 'Post-money valuation'}</span>`
    + `<div class="big-value">${money(c.valuation)}${c.valuation != null ? confidenceChip(c) : ''}</div>`
    + `<div class="source-line">${sourceLine}</div>`
    + (c.valNote ? `<p class="value-note">${esc(c.valNote)}</p>` : '')
    + `<details class="why-figure"><summary>Why this figure?</summary>${why.map(line => `<p>${esc(line)}</p>`).join('')}</details></div>`
    + `<dl class="profile-facts"><div><dt>${c.cls === 'acquired' ? 'Last funding / acquisition event' : 'Last round'}</dt><dd>${esc(c.lastSeries || 'Unknown')}${c.lastAmount ? ' · ' + money(c.lastAmount) : ''}<small>${date(c.lastDate)}</small>${source ? `<small>${esc(CONFIDENCE[c.conf] || c.conf)} · ${source}</small>` : ''}</dd></div>`
    + `<div><dt>Total funding</dt><dd>${money(c.raised)}${raisedLine(c)}</dd></div></dl>`;
}

// Total funding is its own claim with its own provenance, labelled the same
// way as a valuation: a citation, "entered manually", or an honest blank.
function raisedLine(c) {
  if (c.raised == null) return '<small>Cumulative figure in dataset</small>';
  const level = raisedConfidence(c);
  if (level === 'manual') return `<small>Cumulative figure · <span class="confidence manual">${esc(CONFIDENCE.manual)}</span></small>`;
  if (c.raisedSrc) return `<small>Cumulative figure · ${esc(CONFIDENCE[level] || 'Reported')} · ${externalLink(c.raisedSrc.u, esc(c.raisedSrc.p) + ' ↗')}</small>`;
  return '<small>Cumulative figure · source not recorded</small>';
}

const section = (title, body) => `<section class="profile-section"><h3>${title}</h3>${body}</section>`;

export function renderProfile(c) {
  const meta = [OWNERSHIP[c.cls], c.company && c.company !== c.name ? c.company : null, c.hq].filter(Boolean).join(' · ');
  const links = c.site ? externalLink(c.site, 'Visit website ↗') : '';

  // One row per market axis, each with the reasoning behind its score right under it.
  const scores = AXES.all.map(axis => `<div class="score-row"><span>${esc(AXIS_NAMES[axis])}</span><span class="track" aria-hidden="true"><i class="fill" style="width:${Number(c[axis]) || 0}%"></i></span><strong>${esc(c[axis])}</strong></div>`
      + (c.rationales?.[axis] ? `<p class="score-note">${esc(c.rationales[axis])}</p>` : '')).join('');

  const founders = c.founders || [];
  const context = c.founded || founders.length || c.traction
    ? section('Company context', (c.founded ? `<p>Founded ${c.founded}.</p>` : '')
      + (founders.length ? `<ul class="people">${founders.map(person => `<li>${person.li ? externalLink(person.li, esc(person.n) + ' <span class="li" aria-hidden="true">in</span><span class="visually-hidden"> (LinkedIn)</span>') : esc(person.n)}${person.r ? `<small>${esc(person.r)}</small>` : ''}</li>`).join('')}</ul>` : '')
      + (c.traction ? `<p>${esc(c.traction)}</p>` : ''))
    : '';

  // The four latest stories show; the rest wait one click away.
  const news = [...(c.news || [])].sort((a, b) => (b.d || '').localeCompare(a.d || ''));
  const story = article => externalLink(article.u, `${esc(article.t)}<small>${esc(article.p)} · ${date(article.d)}</small>`);
  const rest = news.slice(4);
  const coverage = section('Coverage &amp; sources', `<div class="profile-news">${news.slice(0, 4).map(story).join('') || '<p class="cell-secondary">No linked coverage in the dataset.</p>'}</div>`
    + (rest.length ? `<details class="more-news"><summary>${rest.length} older ${rest.length === 1 ? 'source' : 'sources'}</summary><div class="profile-news">${rest.map(story).join('')}</div></details>` : ''));

  const checks = [...(c.checks || [])].sort((a, b) => (b.d || '').localeCompare(a.d || ''));
  const log = checks.length
    ? `<details class="check-log"><summary>Verification log · ${checks.length} ${checks.length === 1 ? 'check' : 'checks'}</summary><p>Pages an editor visited to confirm facts on this profile. These are evidence, not news.</p><ul>${checks.map(check => `<li>${externalLink(check.u, esc(check.t) + ' ↗')}<small>${esc(check.p)} · checked ${date(check.d)}</small></li>`).join('')}</ul></details>`
    : '';

  return `<div class="profile" style="--category:${esc(categoryColor(c))}">`
    + `<div class="profile-heading">${avatar(c)}<div><h2 id="companyTitle">${esc(c.name)}</h2><p>${esc(meta)}</p></div></div>`
    + `<span class="profile-category"><i class="category-dot" aria-hidden="true"></i>${esc(CATEGORIES[c.cat]?.name ?? '')}</span>`
    + `<p class="profile-description">${esc(c.desc)}</p>`
    + (links ? `<div class="profile-links">${links}</div>` : '')
    + valuationBlock(c)
    + section('Capability scores · out of 100', scores)
    + context + coverage + log + '</div>';
}
