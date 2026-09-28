// Pure, DOM-free helpers shared by the map (inlined into the page), the
// profile renderer, the build, and the node:test suite.

// Focus categories come from market.categories in the dataset. `all` is the
// only built-in entry; configureCategories() fills in the rest at startup.
export const CATEGORIES = {
  all: { name: 'All companies', color: '#30634b', description: 'Compare autonomy, context, and reach across the full landscape.' },
};
export function configureCategories(list = []) {
  for (const key of Object.keys(CATEGORIES)) if (key !== 'all') delete CATEGORIES[key];
  for (const { id, name, color, description } of list) CATEGORIES[id] = { name, color, description };
  return CATEGORIES;
}
export const OWNERSHIP = { independent: 'Independent', platform: 'Platform product', acquired: 'Acquired' };
export const CONFIDENCE = { reported: 'Reported', estimated: 'Estimate', rumored: 'Rumored', manual: 'Manual · no source', undisclosed: 'Undisclosed' };
// What each confidence level means, in one sentence, for the "Why this figure?" note.
export const CONFIDENCE_MEANING = {
  reported: 'Stated in the cited reporting or company announcement.',
  estimated: 'An estimate published by the cited source, not a disclosed price.',
  rumored: 'Reported as under discussion; not confirmed by the company.',
  manual: 'Entered by hand with no public source. Treat it as an editorial estimate.',
  undisclosed: 'No figure has been disclosed publicly.',
};

// Axes are data too (market.axes). AXES.x is the horizontal key, AXES.y the
// vertical choices in order, AXES.all every scored key; AXIS_NAMES holds the
// compact label for each. configureAxes() replaces these defaults at startup.
export const AXIS_NAMES = {};
export const AXES = { x: '', y: [], all: [], defs: {} };
export function configureAxes(axes) {
  const defs = [axes?.x, axes?.y, axes?.yAlt].filter(Boolean);
  for (const key of Object.keys(AXIS_NAMES)) delete AXIS_NAMES[key];
  for (const def of defs) AXIS_NAMES[def.key] = def.short || def.label;
  AXES.x = axes?.x?.key ?? '';
  AXES.y = [axes?.y?.key, axes?.yAlt?.key].filter(Boolean);
  AXES.all = defs.map(def => def.key);
  AXES.defs = Object.fromEntries(defs.map(def => [def.key, def]));
  return AXES;
}
configureAxes({
  x: { key: 'autonomy', label: 'Autonomy' },
  y: { key: 'breadth', label: 'Context breadth' },
  yAlt: { key: 'distribution', label: 'Distribution surface', short: 'Distribution' },
});

export const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Only web links are ever rendered as links; the schema enforces the same rule,
// this is the second lock for anything that reaches the page another way.
export const safeUrl = url => /^https?:\/\//i.test(String(url ?? '').trim()) ? String(url).trim() : null;
export const date = value => value ? new Date(value + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date undisclosed';
// minimumFractionDigits keeps ICU from padding compact values ("$30.00M").
export const money = value => value == null ? 'Undisclosed' : new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 2,
}).format(value);

// The label a crowded chart can afford: "Comet", not "Comet (Perplexity)".
export const labelFor = company => company.shortName || company.name;
// Parenthetical qualifiers and punctuation are not initials: "Comet (Perplexity)" → C,
// "Wajo / Fo" → WF, "Ohai.ai" → O, "Alexa+" → A.
export function initials(company) {
  const words = String(company.name ?? '').replace(/\([^)]*\)/g, ' ').split(/[\s/+&]+/)
    .map(word => word.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  return words.slice(0, 2).map(word => word[0]).join('').toUpperCase() || '?';
}

export function valueConfidence(company) {
  if (company.cls === 'platform' || company.valuation == null) return 'undisclosed';
  return company.valConf || company.conf || 'undisclosed';
}
// Total funding carries its own provenance. null means none was recorded: the
// figure is shown, but never with a confidence it has not earned.
export function raisedConfidence(company) {
  if (company.cls === 'platform' || company.raised == null) return 'undisclosed';
  return company.raisedConf || null;
}
const MARKER = { manual: ' *', estimated: ' est.', rumored: ' rumored' };
// Platform products are labelled with their consumer brand, never a parent financial.
export const platformLabel = company => company.brand?.trim() || company.company?.trim() || 'Platform product';
export function valueLabel(company, size = 'valuation') {
  if (company.cls === 'platform') return platformLabel(company);
  if (size === 'equal') return OWNERSHIP[company.cls];
  if (company[size] == null) return 'Undisclosed';
  const value = money(company[size]);
  if (size === 'raised') return value + ' raised' + (MARKER[raisedConfidence(company)] ?? '');
  return value + (MARKER[valueConfidence(company)] ?? '');
}
export function tooltipLines(company, size = 'valuation') {
  const category = CATEGORIES[company.cat]?.name ?? '';
  if (company.cls === 'platform') return [category, valueLabel(company, size)];
  const level = size === 'valuation' && company.valuation != null ? valueConfidence(company)
    : size === 'raised' && company.raised != null ? raisedConfidence(company) : null;
  return [category + ' · ' + OWNERSHIP[company.cls], valueLabel(company, size) + (level ? ' · ' + CONFIDENCE[level] : '')];
}

// Bubble geometry. Area, not radius, tracks value on a fixed dataset-wide scale.
// Tiny disclosed values are floored at MIN_RADIUS so a real figure never draws
// smaller than a hollow "undisclosed" mark; the legend states the threshold.
export const MAX_RADIUS = 40;
export const MIN_RADIUS = 4;
export const UNDISCLOSED_RADIUS = MIN_RADIUS;
export function bubbleRadius(company, size, maximum, maxRadius = MAX_RADIUS) {
  const scale = maxRadius / MAX_RADIUS;
  if (company.cls === 'platform') return 6 * Math.max(scale, .8);
  if (size === 'equal') return 8 * Math.max(scale, .8);
  if (company[size] == null || company[size] <= 0 || maximum <= 0) return UNDISCLOSED_RADIUS;
  return Math.max(MIN_RADIUS, maxRadius * Math.sqrt(company[size] / maximum));
}
// Values below this draw at the floor rather than at true area.
export const floorThreshold = (maximum, maxRadius = MAX_RADIUS) => maximum * (MIN_RADIUS / maxRadius) ** 2;

// Three 1-2-5 reference values that span the data actually on the scale:
// the largest nice value under the maximum, the smallest above the floor,
// and the nice value nearest their geometric mean.
export function legendReferences(maximum, maxRadius = MAX_RADIUS) {
  if (!(maximum > 0)) return [];
  const nice = [];
  for (let exp = Math.floor(Math.log10(maximum)) - 4; exp <= Math.ceil(Math.log10(maximum)); exp++) {
    for (const m of [1, 2, 5]) nice.push(m * 10 ** exp);
  }
  const floor = floorThreshold(maximum, maxRadius);
  const high = [...nice].reverse().find(v => v <= maximum) ?? maximum;
  const low = nice.find(v => v >= floor && v < high) ?? high;
  if (low === high) return [high];
  // Nearest to the geometric mean, with a small preference for round powers
  // of ten ($1B reads faster than $500M when the two are equally central).
  const mean = Math.sqrt(low * high);
  const distance = v => Math.abs(Math.log(v / mean)) - (Math.abs(Math.log10(v) % 1) < 1e-9 ? .05 : 0);
  const mid = nice.filter(v => v > low && v < high).sort((a, b) => distance(a) - distance(b))[0];
  return mid ? [low, mid, high] : [low, high];
}

// Headline numbers for the hero. Rounds are each company's latest round only,
// so the sum is a floor on capital raised, never a double count. For an
// acquired company the latest event is the acquisition, not a funding round,
// and a platform's "round" belongs to its parent — so only independents count.
export function heroStats(companies, asOf) {
  const end = new Date(asOf + 'T00:00:00');
  const year = end.getFullYear();
  const funded = companies.filter(c => c.cls === 'independent' && c.lastDate);
  const thisYear = funded.filter(c => new Date(c.lastDate + 'T00:00:00').getFullYear() === year);
  const recent = funded.filter(c => { const days = (end - new Date(c.lastDate + 'T00:00:00')) / 864e5; return days >= 0 && days <= 90; });
  return {
    tracked: companies.length,
    year,
    raisedThisYear: thisYear.reduce((sum, c) => sum + (c.lastAmount || 0), 0),
    roundsThisYear: thisYear.filter(c => c.lastAmount).length,
    recentRounds: recent.length,
    platforms: companies.filter(c => c.cls === 'platform').length,
  };
}

export const SIZES = ['valuation', 'raised', 'equal'];
export const sortKeys = () => [...AXES.all, 'valuation', 'raised', 'name'];
export function readState(search, mobile = false) {
  const params = new URLSearchParams(search);
  const valid = (key, choices, fallback) => choices.includes(params.get(key)) ? params.get(key) : fallback;
  return {
    category: valid('cat', Object.keys(CATEGORIES), 'all'),
    ownership: valid('owner', ['all', ...Object.keys(OWNERSHIP)], 'all'),
    query: params.get('q') || '',
    view: valid('view', ['map', 'table'], mobile ? 'table' : 'map'),
    axis: valid('axis', AXES.y, AXES.y[0]),
    size: valid('size', SIZES, 'valuation'),
    sort: valid('sort', sortKeys(), AXES.x),
    selected: params.get('company') || null,
  };
}
export function stateQuery(state) {
  const params = new URLSearchParams();
  // Explicitly serialize the view so a link behaves the same on every screen size.
  params.set('view', state.view);
  if (state.category !== 'all') params.set('cat', state.category);
  if (state.ownership !== 'all') params.set('owner', state.ownership);
  if (state.query.trim()) params.set('q', state.query.trim());
  if (state.axis !== AXES.y[0]) params.set('axis', state.axis);
  if (state.size !== 'valuation') params.set('size', state.size);
  if (state.sort !== AXES.x) params.set('sort', state.sort);
  if (state.selected) params.set('company', state.selected);
  return params.toString();
}
export function filterCompanies(companies, state, category = state.category) {
  const terms = state.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return companies.filter(company => {
    const text = [company.name, company.shortName, company.company, company.brand, company.desc, ...(company.aliases || []), CATEGORIES[company.cat]?.name].join(' ').toLowerCase();
    return (category === 'all' || company.cat === category)
      && (state.ownership === 'all' || state.ownership === company.cls)
      && terms.every(term => text.includes(term));
  });
}
export function sortCompanies(companies, sort) {
  // A platform has no financial figure of its own, so it sorts after every
  // stated or undisclosed one rather than borrowing its parent's.
  const financial = sort === 'valuation' || sort === 'raised';
  const rank = c => financial && c.cls === 'platform' ? -2 : c[sort] == null ? -1 : 0;
  return [...companies].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    return rank(b) - rank(a) || (rank(a) === 0 ? b[sort] - a[sort] : 0) || a.name.localeCompare(b.name);
  });
}
// Only `news` feeds research. Verification visits live in `checks` and never appear here.
export function researchArticles(companies, limit = 6) {
  const grouped = new Map();
  for (const company of companies) for (const article of company.news || []) {
    let key;
    try { const url = new URL(article.u); url.hash = ''; for (const k of [...url.searchParams.keys()]) if (k.startsWith('utm_')) url.searchParams.delete(k); key = url.href.replace(/\/$/, ''); }
    catch { continue; }
    if (!grouped.has(key)) grouped.set(key, { ...article, companies: [] });
    const item = grouped.get(key);
    if (!item.companies.some(c => c.id === company.id)) item.companies.push({ id: company.id, name: company.name, shortName: company.shortName });
  }
  const sorted = [...grouped.values()].sort((a, b) => (b.d || '').localeCompare(a.d || '') || a.t.localeCompare(b.t));
  const covered = new Set();
  const varied = sorted.filter(article => {
    if (article.companies.every(c => covered.has(c.id))) return false;
    article.companies.forEach(c => covered.add(c.id));
    return true;
  });
  return varied.slice(0, limit);
}
