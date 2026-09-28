/**
 * What the admin editor does to a company when you press Save, as a pure
 * function over the parsed market document so it can be tested.
 *
 * Three rules keep hand edits honest:
 *  - A figure typed by hand is marked `manual` and locked, unless the same
 *    save attaches a new source or sets its confidence explicitly — so the
 *    site never cites an article for a number the article does not contain.
 *  - A source whose fields are all empty is removed rather than written as a
 *    hollow object that would read as a citation.
 *  - A field the file never had is not added just because the form showed it.
 */

const CONFIDENCE = ['reported', 'estimated', 'rumored', 'manual', 'undisclosed'];
const IDENTITY = [
  { path: 'name', label: 'Name', type: 'text' },
  { path: 'shortName', label: 'Short map label', type: 'text' },
  { path: 'company', label: 'Company', type: 'text' },
  { path: 'brand', label: 'Brand (platforms)', type: 'text' },
  { path: 'category', label: 'Category', type: 'select', options: 'categories' },
  { path: 'class', label: 'Class', type: 'select', options: ['independent', 'platform', 'acquired'] },
  { path: 'region', label: 'Region', type: 'text' },
  { path: 'website', label: 'Website', type: 'text' },
  { path: 'hq', label: 'HQ', type: 'text' },
  { path: 'description', label: 'Description', type: 'textarea' },
  { path: 'founded', label: 'Founded', type: 'number' },
  { path: 'parent', label: 'Parent (platforms)', type: 'textarea' },
  { path: 'traction', label: 'Traction', type: 'text' },
];
const ROUND = [
  { path: 'lastRound.series', label: 'Round', type: 'text' },
  { path: 'lastRound.amountUsd', label: 'Round size (USD)', type: 'number' },
  { path: 'lastRound.postMoneyUsd', label: 'Post-money (USD)', type: 'number' },
  { path: 'lastRound.date', label: 'Round date', type: 'date' },
  { path: 'lastRound.confidence', label: 'Round confidence', type: 'select', options: CONFIDENCE },
  { path: 'lastRound.postMoneyConfidence', label: 'Valuation confidence', type: 'select', options: [['', '— same as the round'], ...CONFIDENCE] },
  { path: 'lastRound.note', label: 'Valuation note', type: 'textarea' },
  { path: 'lastRound.source.url', label: 'Round source URL', type: 'text' },
  { path: 'lastRound.source.publisher', label: 'Round source publisher', type: 'text' },
  { path: 'lastRound.source.date', label: 'Round source date', type: 'date' },
  { path: 'lastRound.postMoneySource.url', label: 'Valuation source URL (if not the round\'s)', type: 'text' },
  { path: 'lastRound.postMoneySource.publisher', label: 'Valuation source publisher', type: 'text' },
  { path: 'lastRound.postMoneySource.date', label: 'Valuation source date', type: 'date' },
];
const METRICS = [
  { path: 'metrics.totalRaisedUsd', label: 'Total raised (USD)', type: 'number' },
  { path: 'metrics.totalRaisedConfidence', label: 'Total raised confidence', type: 'select', options: [['', '— not recorded'], ...CONFIDENCE] },
  { path: 'metrics.totalRaisedSource.url', label: 'Total raised source URL', type: 'text' },
  { path: 'metrics.totalRaisedSource.publisher', label: 'Total raised publisher', type: 'text' },
  { path: 'metrics.totalRaisedSource.date', label: 'Total raised source date', type: 'date' },
];

// Score fields follow the market's own axes.
export function editableFields(market) {
  const axes = [market.axes?.x, market.axes?.y, market.axes?.yAlt].filter(Boolean);
  const scores = axes.flatMap(axis => [
    { path: `axes.${axis.key}.score`, label: axis.short || axis.label, type: 'range' },
    { path: `axes.${axis.key}.rationale`, label: `${axis.short || axis.label} — why`, type: 'textarea' },
  ]);
  return [...IDENTITY, ...scores, ...ROUND, ...METRICS];
}

const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function set(o, p, v) {
  const keys = p.split('.'), last = keys.pop();
  let cur = o;
  for (const k of keys) { if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k]; }
  cur[last] = v;
}
function remove(o, p) {
  const keys = p.split('.'), last = keys.pop();
  const parent = get(o, keys.join('.')) ?? (keys.length ? undefined : o);
  if (parent && typeof parent === 'object') delete parent[last];
}
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * @param doc     parsed market document (mutated in place)
 * @param edit    { id, values: { [path]: string }, locked: string[] }
 * @returns {{ company, notes: string[] }}
 */
export function applyEdits(doc, { id, values = {}, locked }, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const c = doc.companies.find(x => x.id === id);
  if (!c) throw new Error('unknown company');
  const fields = editableFields(doc.market);
  const before = structuredClone(c);
  const notes = [];

  for (const [p, raw] of Object.entries(values)) {
    const field = fields.find(f => f.path === p);
    if (!field) continue;
    let v = raw;
    if (field.type === 'number' || field.type === 'range') v = raw === '' || raw == null ? null : Number(raw);
    else if (v === '' || v == null) v = null;
    // Leave absent what was absent: an untouched empty input is not a new null field.
    if (v == null && get(before, p) === undefined) continue;
    set(c, p, v);
  }
  // A source with nothing in it is no source at all.
  for (const p of ['lastRound.source', 'lastRound.postMoneySource', 'metrics.totalRaisedSource']) {
    const src = get(c, p);
    if (src && typeof src === 'object' && !src.url && !src.publisher && !src.date) {
      if (get(before, p) === undefined) remove(c, p); else set(c, p, null);
    }
  }

  const changed = p => !same(get(before, p), get(c, p));
  const lockSet = new Set(locked ?? c.locked ?? []);
  // Typing a figure by hand means you vouch for it: it is manual unless this
  // save also attaches a new source or states its confidence.
  const vouch = (value, confidence, sourceUrls, lockPath, label) => {
    if (!changed(value) || get(c, value) == null) return;
    if (!sourceUrls.some(changed) && !changed(confidence)) {
      set(c, confidence, 'manual');
      notes.push(`${label} marked manual: no new source came with the new figure`);
    }
    if (get(c, confidence) === 'manual' && !lockSet.has(lockPath)) {
      lockSet.add(lockPath);
      notes.push(`${label} locked so the weekly agent cannot overwrite it`);
    }
  };
  vouch('lastRound.postMoneyUsd', 'lastRound.postMoneyConfidence', ['lastRound.source.url', 'lastRound.postMoneySource.url'], 'lastRound.postMoneyUsd', 'Valuation');
  vouch('metrics.totalRaisedUsd', 'metrics.totalRaisedConfidence', ['metrics.totalRaisedSource.url'], 'metrics.totalRaisedUsd', 'Total raised');

  c.locked = [...lockSet];
  c.lastVerified = today;
  return { company: c, notes };
}
