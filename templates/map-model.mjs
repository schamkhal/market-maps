export const CATEGORIES = {
  all: { name: 'All companies', color: '#30634b', description: 'Compare autonomy, context, and reach across the full landscape.' },
  executive: { name: 'Personal assistants', color: '#456cd3', description: 'Assistants for everyday life, household coordination, and personal admin.' },
  workflow: { name: 'Work & productivity', color: '#25806a', description: 'Agents focused on email, planning, browsers, and work across connected tools.' },
  knowledge: { name: 'Knowledge & memory', color: '#a5722a', description: 'Products that capture and recall your personal context.' },
};
export const OWNERSHIP = { independent: 'Independent', platform: 'Platform product', acquired: 'Acquired' };
export const CONFIDENCE = { reported: 'Reported', estimated: 'Estimate', rumored: 'Rumored', manual: 'Manual · no source', undisclosed: 'Undisclosed' };
export const AXIS_NAMES = { autonomy: 'Autonomy', breadth: 'Context breadth', distribution: 'Distribution' };
export const money = value => value == null ? 'Undisclosed' : new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2,
}).format(value);
export function valueConfidence(company) {
  if (company.cls === 'platform' || company.valuation == null) return 'undisclosed';
  return company.valConf || company.conf || 'undisclosed';
}
export function valueLabel(company, size = 'valuation') {
  if (company.cls === 'platform') {
    const platform = company.company?.trim();
    return platform === 'Alphabet' ? 'Google' : platform === 'Meta Platforms' ? 'Meta' : platform || 'Platform product';
  }
  if (size === 'equal') return OWNERSHIP[company.cls];
  if (company[size] == null) return 'Undisclosed';
  const value = money(company[size]);
  if (size === 'raised') return value + ' raised';
  const status = valueConfidence(company);
  return value + (status === 'manual' ? ' *' : status === 'estimated' ? ' est.' : status === 'rumored' ? ' rumored' : '');
}
export function tooltipLines(company, size = 'valuation') {
  const category = CATEGORIES[company.cat].name;
  if (company.cls === 'platform') return [category, valueLabel(company, size)];
  const confidence = size === 'valuation' && company.valuation != null
    ? ' · ' + CONFIDENCE[valueConfidence(company)] : '';
  return [category + ' · ' + OWNERSHIP[company.cls], valueLabel(company, size) + confidence];
}
export function bubbleRadius(company, size, maximum) {
  if (company.cls === 'platform') return 6;
  if (size === 'equal') return 8;
  if (company[size] == null || company[size] <= 0 || maximum <= 0) return 5;
  // Area, not radius, tracks value. The maximum is computed over the full dataset.
  return 40 * Math.sqrt(company[size] / maximum);
}
export function readState(search, mobile = false) {
  const params = new URLSearchParams(search);
  const valid = (key, choices, fallback) => choices.includes(params.get(key)) ? params.get(key) : fallback;
  return {
    category: valid('cat', Object.keys(CATEGORIES), 'all'),
    ownership: valid('owner', ['all', ...Object.keys(OWNERSHIP)], 'all'),
    query: params.get('q') || '',
    view: valid('view', ['map', 'table'], mobile ? 'table' : 'map'),
    axis: valid('axis', ['breadth', 'distribution'], 'breadth'),
    size: valid('size', ['valuation', 'raised', 'equal'], 'valuation'),
    sort: valid('sort', ['autonomy', 'breadth', 'valuation', 'name'], 'autonomy'),
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
  if (state.axis !== 'breadth') params.set('axis', state.axis);
  if (state.size !== 'valuation') params.set('size', state.size);
  if (state.sort !== 'autonomy') params.set('sort', state.sort);
  if (state.selected) params.set('company', state.selected);
  return params.toString();
}
export function filterCompanies(companies, state, category = state.category) {
  const terms = state.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return companies.filter(company => {
    const text = [company.name, company.company, company.desc, ...(company.aliases || []), CATEGORIES[company.cat]?.name].join(' ').toLowerCase();
    return (category === 'all' || company.cat === category)
      && (state.ownership === 'all' || state.ownership === company.cls)
      && terms.every(term => text.includes(term));
  });
}
export function sortCompanies(companies, sort) {
  return [...companies].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    const av = sort === 'valuation' && a.cls === 'platform' ? null : a[sort];
    const bv = sort === 'valuation' && b.cls === 'platform' ? null : b[sort];
    return (bv ?? -Infinity) - (av ?? -Infinity) || a.name.localeCompare(b.name);
  });
}
export function researchArticles(companies, limit = 6) {
  const grouped = new Map();
  for (const company of companies) for (const article of company.news || []) {
    let key;
    try { const url = new URL(article.u); url.hash = ''; for (const k of [...url.searchParams.keys()]) if (k.startsWith('utm_')) url.searchParams.delete(k); key = url.href.replace(/\/$/, ''); }
    catch { continue; }
    if (!grouped.has(key)) grouped.set(key, { ...article, companies: [] });
    const item = grouped.get(key);
    if (!item.companies.some(c => c.id === company.id)) item.companies.push({ id: company.id, name: company.name });
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
