const $ = selector => document.querySelector(selector);
const SVG_NS = 'http://www.w3.org/2000/svg';
const MOBILE = '(max-width:700px)';
configureCategories(SITE.categories);
configureAxes(SITE.axes);
const color = categoryColor;
const profileHref = company => SITE.companyHref.replace('__ID__', encodeURIComponent(company.id));
// Fixed dataset-wide maxima: a filter never rescales the bubbles.
const maximums = { valuation: Math.max(0, ...DATA.filter(c => c.cls !== 'platform').map(c => c.valuation || 0)), raised: Math.max(0, ...DATA.filter(c => c.cls !== 'platform').map(c => c.raised || 0)) };
const SIZE_NAMES = { valuation: 'Post-money valuation', raised: 'Total funding', equal: 'Equal size' };
const pad2 = n => String(n).padStart(2, '0');
let state = readState(location.search, matchMedia(MOBILE).matches);
let currentRows = [];
let selectedTrigger = null;
let mapSignature = '';
let layoutWidth = 0;
// A profile opened by the reader adds one history entry, so the Back button
// (or a phone's back gesture) closes it instead of leaving the page.
let profilePushed = false;
let closingFromHistory = false;
// The company whose row or mark should take focus back once the list has
// re-rendered after a history step.
let refocusId = null;
const dialog = $('#companyDialog');
const tooltip = $('#tooltip');
const plot = $('#plot');

// Returns whether the URL changed: an embedded or sandboxed page may refuse,
// and the map must keep working when it does.
function syncUrl(push = false) {
  const url = location.pathname + '?' + stateQuery(state) + location.hash;
  try {
    if (push) history.pushState({ profile: state.selected }, '', url);
    else history.replaceState(history.state, '', url);
    return true;
  } catch { return false; }
}
const muted = (text = '—') => `<span class="cell-muted">${text}</span>`;
function valuationMarkup(company) {
  if (company.cls === 'platform') return muted() + '<span class="cell-secondary">Parent value excluded</span>';
  if (company.valuation == null) return '<span class="cell-secondary">Undisclosed</span>';
  return `<span class="value-amount">${money(company.valuation)}</span><span class="cell-secondary">${confidenceChip(company)}</span>`;
}
function raisedMarkup(company) {
  if (company.cls === 'platform') return muted();
  if (company.raised == null) return '<span class="cell-secondary">Undisclosed</span>';
  const level = raisedConfidence(company);
  const chip = level && level !== 'reported' ? `<span class="cell-secondary"><span class="confidence ${level}">${esc(CONFIDENCE[level])}</span></span>` : '';
  return `<span class="value-amount">${money(company.raised)}</span>${chip}`;
}
const roundSignificant = (value, digits = 2) => { if (!value) return value; const p = 10 ** (Math.floor(Math.log10(value)) - digits + 1); return Math.round(value / p) * p; };

// Columns are data-driven: one score column per market axis.
const columns = () => [
  { key: 'name', label: 'Company', sort: 'name', dir: 'ascending' },
  { key: 'focus', label: 'Focus / ownership' },
  ...AXES.all.map(axis => ({ key: axis, label: AXIS_NAMES[axis], sort: axis, dir: 'descending', num: true })),
  { key: 'valuation', label: 'Post-money valuation', sort: 'valuation', dir: 'descending' },
  { key: 'raised', label: 'Total funding', sort: 'raised', dir: 'descending' },
  { key: 'round', label: 'Last round / event' },
];

function initialize() {
  const { edition, scopeLabel, author } = SITE;
  $('#pageTitle').textContent = SITE.name;
  if (SITE.tagline) $('#tagline').textContent = SITE.tagline; else $('#tagline').remove();
  const eyebrow = [edition ? `Market map ${pad2(edition)}` : 'Market map', scopeLabel].filter(Boolean).join(' · ');
  $('#eyebrow').textContent = eyebrow;
  if (edition) $('#edition').textContent = `/ ${pad2(edition)}`; else $('#edition').remove();
  if (author) $('#byline').innerHTML = `By <strong>${esc(author)}</strong>`; else $('#byline').remove();
  $('#footerBrand').textContent = `Market maps / ${SITE.name}`;
  $('#footerScope').textContent = scopeLabel ? `${scopeLabel} · ` : '';
  $('#updated').textContent = date(SITE.asOf);
  $('#footerDate').textContent = date(SITE.asOf);
  const stats = heroStats(DATA, SITE.asOf);
  $('#marketStats').innerHTML = [
    [stats.tracked, 'products tracked'],
    [money(stats.raisedThisYear), `raised in ${stats.year}`],
    [stats.recentRounds, 'rounds in the last 90 days'],
    [stats.platforms, 'big-platform products'],
  ].map(([value, label]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');
  $('#statsNote').textContent = `${stats.year} total sums the latest round of ${stats.roundsThisYear} companies that raised this year; earlier rounds are not included.`;
  document.querySelectorAll('[data-changelog]').forEach(link => link.href = SITE.changelog);
  document.querySelectorAll('[data-home]').forEach(link => link.href = SITE.home);
  if (SITE.maps?.length > 1) {
    $('#mapSwitch').hidden = false;
    $('#mapSelect').innerHTML = SITE.maps.map(map => `<option value="${esc(map.href)}"${map.id === SITE.marketId ? ' selected' : ''}>${map.edition ? pad2(map.edition) + ' · ' : ''}${esc(map.name)}</option>`).join('');
    $('#mapSelect').addEventListener('change', event => { location.href = event.target.value; });
  }
  $('#categoryFilters').innerHTML = Object.entries(CATEGORIES).map(([id, category]) => `<button data-category="${esc(id)}" aria-pressed="false" style="--category:${esc(category.color)}">${id !== 'all' ? '<i class="category-dot" aria-hidden="true"></i>' : ''}${esc(category.name)}<span class="count"></span></button>`).join('');
  $('#yAxis').innerHTML = AXES.y.map(axis => `<option value="${esc(axis)}">${esc(AXIS_NAMES[axis])}</option>`).join('');
  $('#sortBy').innerHTML = [...AXES.all.map(axis => [axis, `${AXIS_NAMES[axis]}: high to low`]), ['valuation', 'Valuation: high to low'], ['raised', 'Total funding: high to low'], ['name', 'Company: A–Z']]
    .map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
  $('#tableHead').innerHTML = columns().map(col => col.sort
    ? `<th scope="col" data-col="${esc(col.key)}"${col.num ? ' class="num"' : ''}><button class="sort-button" data-sort="${esc(col.sort)}">${esc(col.label)}<span class="sort-arrow" aria-hidden="true"></span></button></th>`
    : `<th scope="col">${esc(col.label)}</th>`).join('');
  $('#axisRubrics').innerHTML = [SITE.axes.x, SITE.axes.y, SITE.axes.yAlt].filter(Boolean).map(axis => `<div class="rubric"><strong>${esc(axis.label)}</strong><p>${esc(axis.rubric)}</p></div>`).join('');
  $('#scopeDetails').innerHTML = `<p>${esc(SITE.scope)}</p><ul>${SITE.inclusion.map(item => `<li>${esc(item)}</li>`).join('')}</ul>${SITE.exclusions.length ? `<p>Outside the target scope: ${esc(SITE.exclusions.join('; '))}.</p>` : ''}`;
  renderExclusions();

  $('#categoryFilters').addEventListener('click', event => {
    const button = event.target.closest('[data-category]');
    if (button) { state.category = button.dataset.category; render(); }
  });
  $('#search').addEventListener('input', event => { state.query = event.target.value; render(); });
  for (const [id, key] of [['ownership', 'ownership'], ['yAxis', 'axis'], ['sizeBy', 'size'], ['sortBy', 'sort']]) {
    $('#' + id).addEventListener('change', event => { state[key] = event.target.value; render(); });
  }
  $('#tableHead').addEventListener('click', event => {
    const button = event.target.closest('[data-sort]');
    if (button) { state.sort = button.dataset.sort; render(); }
  });
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { state.view = button.dataset.view; render(); }));
  for (const id of ['resetFilters', 'clearFilters']) $('#' + id).addEventListener('click', () => { state.category = 'all'; state.ownership = 'all'; state.query = ''; render(); });

  $('#closeDialog').addEventListener('click', () => dialog.close());
  $('#prevCompany').addEventListener('click', () => stepProfile(-1));
  $('#nextCompany').addEventListener('click', () => stepProfile(1));
  dialog.addEventListener('keydown', event => {
    if (event.target.closest('input, select, textarea') || event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); stepProfile(event.key === 'ArrowRight' ? 1 : -1); }
  });
  dialog.addEventListener('click', event => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  dialog.addEventListener('close', () => {
    const closedId = state.selected;
    state.selected = null;
    // Closing a profile the reader opened steps back over its history entry;
    // popstate then brings the URL back in line (and redraws, so focus is
    // restored again there).
    if (profilePushed && !closingFromHistory) {
      refocusId = closedId;
      const pending = location.href;
      history.back();
      // A browser may ignore a history step it did not see the reader ask
      // for; the URL still loses the closed profile either way.
      setTimeout(() => { if (location.href === pending && !dialog.open) { refocusId = null; syncUrl(); } }, 400);
    } else syncUrl();
    profilePushed = false;
    closingFromHistory = false;
    const target = selectedTrigger?.isConnected ? selectedTrigger : closedId && triggerFor(closedId);
    target?.focus({ preventScroll: true });
  });
  for (const selector of ['#tableRows', '#mobileRows']) $(selector).addEventListener('click', event => {
    const button = event.target.closest('[data-company]');
    if (button) openProfile(button.dataset.company, button);
  });
  window.addEventListener('popstate', () => {
    const next = readState(location.search, matchMedia(MOBILE).matches);
    const wanted = next.selected && DATA.some(c => c.id === next.selected) ? next.selected : null;
    state = { ...next, selected: null };
    // The dialog's close event fires later; the flag tells it the history
    // step has already happened.
    if (!wanted && dialog.open) { closingFromHistory = true; dialog.close(); }
    render();
    if (wanted) { openProfile(wanted, null, { push: false }); profilePushed = true; }
    else if (refocusId) triggerFor(refocusId)?.focus({ preventScroll: true });
    refocusId = null;
  });
  window.addEventListener('scroll', () => { tooltip.hidden = true; }, { passive: true });

  // Map interaction is delegated: the plot's contents are redrawn often.
  plot.addEventListener('click', event => {
    const node = event.target.closest('[data-company]');
    if (node) openProfile(node.dataset.company, node);
  });
  plot.addEventListener('keydown', event => {
    const node = event.target.closest('[role="button"][data-company]');
    if (node && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openProfile(node.dataset.company, node); }
  });
  plot.addEventListener('pointerover', event => highlight(event.target.closest('[data-company]')?.dataset.company ?? null));
  plot.addEventListener('pointerleave', () => { highlight(null); tooltip.hidden = true; });
  plot.addEventListener('pointermove', event => {
    const node = event.target.closest('[data-company]');
    if (event.pointerType === 'touch' || !node) { if (!node) tooltip.hidden = true; return; }
    showTooltip(node.dataset.company, event.clientX + 14, event.clientY + 15);
  });
  // Keyboard users get the same figures a mouse hover shows.
  plot.addEventListener('focusin', event => {
    const node = event.target.closest('[role="button"][data-company]');
    if (!node) return;
    highlight(node.dataset.company);
    const box = node.getBoundingClientRect();
    showTooltip(node.dataset.company, box.right + 8, box.top);
  });
  plot.addEventListener('focusout', () => { highlight(null); tooltip.hidden = true; });

  // Chart options stay open on desktop and fold away on phones, where they
  // would otherwise push the map below the fold.
  const mobile = matchMedia(MOBILE);
  const syncOptions = () => { $('#chartOptions').open = !mobile.matches; };
  syncOptions();
  mobile.addEventListener('change', syncOptions);
  // The map is drawn at the frame's real pixel width, so it re-lays out
  // (never scrolls sideways) when the frame changes size.
  new ResizeObserver(entries => {
    const width = Math.round(entries[0].contentRect.width);
    if (!width || Math.abs(width - layoutWidth) < 8) return;
    if (state.view === 'map' && currentRows.length) renderMap(currentRows);
  }).observe($('#plotFrame'));
  trackSections();
  const initialSelection = state.selected;
  state.selected = null;
  render();
  if (initialSelection && DATA.some(c => c.id === initialSelection)) openProfile(initialSelection, null, { push: false });
  document.fonts.ready.then(() => { mapSignature = ''; if (state.view === 'map' && currentRows.length) renderMap(currentRows); });
}

// The masthead marks the section being read, not a fixed "Landscape".
function trackSections() {
  const links = [...document.querySelectorAll('#mainNav a[href^="#"]')];
  const sections = links.map(link => document.getElementById(link.getAttribute('href').slice(1))).filter(Boolean);
  let frame = 0;
  const update = () => {
    frame = 0;
    let active = sections[0];
    for (const section of sections) if (section.getBoundingClientRect().top <= innerHeight * .35) active = section;
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) active = sections.at(-1);
    for (const link of links) {
      if (link.getAttribute('href') === '#' + active?.id) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
  };
  addEventListener('scroll', () => { frame ||= requestAnimationFrame(update); }, { passive: true });
  update();
}

function renderExclusions() {
  const judged = SITE.judgedExcluded || [], regional = SITE.excludedNonUS || [];
  if (!judged.length && !regional.length) return;
  $('#exclusionsPanel').hidden = false;
  $('#exclusionDetails').innerHTML = (judged.length ? `<p>Each candidate below fails a stated criterion, so the boundary can be argued with.</p><ul class="judged-list">${judged.map(item => `<li><strong>${esc(item.name)}</strong><span class="fails">Fails: ${esc(item.fails)}</span><p>${esc(item.why)}</p></li>`).join('')}</ul>` : '')
    + (regional.length ? `<p>Qualified on the criteria but outside the region scope: ${regional.map(item => `${esc(item.name)} (${esc(item.hq)})`).join(', ')}.</p>` : '');
}

function render() {
  tooltip.hidden = true;
  currentRows = sortCompanies(filterCompanies(DATA, state), state.sort);
  $('#search').value = state.query;
  $('#ownership').value = state.ownership;
  $('#yAxis').value = state.axis;
  $('#sizeBy').value = state.size;
  $('#sortBy').value = state.sort;
  for (const button of document.querySelectorAll('[data-category]')) {
    button.setAttribute('aria-pressed', String(state.category === button.dataset.category));
    button.querySelector('.count').textContent = filterCompanies(DATA, state, button.dataset.category).length;
  }
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(state.view === button.dataset.view)));
  $('#categoryCopy').textContent = CATEGORIES[state.category].description;
  $('#viewTitle').textContent = state.view === 'map' ? 'Capability landscape' : 'Company directory';
  $('#resultCount').textContent = `${currentRows.length} of ${DATA.length} products`;
  $('#chartSummary').textContent = `${AXIS_NAMES[state.axis]} · ${SIZE_NAMES[state.size]}`;
  $('#resetFilters').hidden = state.category === 'all' && state.ownership === 'all' && !state.query;
  $('#chartOptions').hidden = state.view !== 'map' || !currentRows.length;
  $('#listControls').hidden = state.view !== 'table' || !currentRows.length;
  $('#mapView').hidden = state.view !== 'map' || !currentRows.length;
  $('#listView').hidden = state.view !== 'table' || !currentRows.length;
  $('#emptyState').hidden = currentRows.length > 0;
  if (state.view === 'map' && currentRows.length) renderMap(currentRows);
  if (state.view === 'table') renderList(currentRows);
  renderResearch(currentRows);
  syncUrl();
}

/* ---------- map ---------------------------------------------------------- */

function highlight(id) {
  plot.classList.toggle('has-active', Boolean(id));
  for (const node of plot.querySelectorAll('.is-active')) node.classList.remove('is-active');
  if (id) for (const node of plot.querySelectorAll(`[data-company="${CSS.escape(id)}"]`)) node.classList.add('is-active');
}
function showTooltip(id, left, top) {
  const company = DATA.find(c => c.id === id);
  if (!company) return;
  tooltip.innerHTML = `<b>${esc(company.name)}</b>${tooltipLines(company, state.size).map(line => `<span>${esc(line)}</span>`).join('')}`;
  tooltip.hidden = false;
  const bounds = tooltip.getBoundingClientRect();
  tooltip.style.left = Math.max(8, Math.min(left, innerWidth - bounds.width - 8)) + 'px';
  tooltip.style.top = Math.max(8, Math.min(top, innerHeight - bounds.height - 8)) + 'px';
}

function renderMap(rows) {
  const frame = $('#plotFrame');
  layoutWidth = Math.round(frame.clientWidth) || 1160;
  const { compact, W, H, m, maxRadius } = chartFrame(layoutWidth, MAX_RADIUS);
  const signature = `${state.axis}|${state.size}|${W}|${rows.map(c => c.id).sort().join(',')}`;
  if (signature === mapSignature) return;
  mapSignature = signature;
  const xKey = AXES.x, yKey = state.axis, xDef = AXES.defs[xKey] || {}, yDef = AXES.defs[yKey] || {};
  const x = score => m.l + score / 100 * (W - m.l - m.r);
  const y = score => H - m.b - score / 100 * (H - m.t - m.b);
  const max = maximums[state.size] || 1;
  const nodes = rows.map(company => ({
    id: company.id, company, name: labelFor(company), value: valueLabel(company, state.size),
    x: x(company[xKey]), y: y(company[yKey]), r: bubbleRadius(company, state.size, max, maxRadius),
  }));
  const ticks = compact ? [0, 50, 100] : [0, 25, 50, 75, 100];
  let grid = `<rect class="region" x="${x(50)}" y="${m.t}" width="${x(100) - x(50)}" height="${y(50) - m.t}"/>`;
  for (const value of ticks) {
    grid += `<line class="grid-line ${value === 50 ? 'mid-line' : ''}" x1="${x(value)}" y1="${m.t}" x2="${x(value)}" y2="${H - m.b}"/><line class="grid-line ${value === 50 ? 'mid-line' : ''}" x1="${m.l}" y1="${y(value)}" x2="${W - m.r}" y2="${y(value)}"/><text class="tick" x="${x(value)}" y="${H - m.b + 16}" text-anchor="middle">${value}</text><text class="tick" x="${m.l - (compact ? 8 : 13)}" y="${y(value) + 3}" text-anchor="end">${value}</text>`;
  }
  const endY = compact ? H - m.b + 32 : H - 20;
  grid += `<text class="axis-title" x="${(m.l + W - m.r) / 2}" y="${compact ? H - 8 : H - 20}" text-anchor="middle">${esc(AXIS_NAMES[xKey].toUpperCase())} →</text>`;
  if (xDef.low) grid += `<text class="tick axis-end" x="${m.l}" y="${endY}">${esc(xDef.low)}</text>`;
  if (xDef.high) grid += `<text class="tick axis-end" x="${W - m.r}" y="${endY}" text-anchor="end">${esc(xDef.high)}</text>`;

  plot.setAttribute('viewBox', `0 0 ${W} ${H}`);
  plot.setAttribute('width', W);
  plot.setAttribute('height', H);
  plot.classList.toggle('compact', compact);
  plot.innerHTML = grid;

  // Measure with the SVG's own text engine, so whatever font actually
  // rendered (web font or fallback) is what the layout accounts for.
  const probe = document.createElementNS(SVG_NS, 'g');
  probe.setAttribute('visibility', 'hidden');
  plot.appendChild(probe);
  const measure = (text, className) => {
    const node = document.createElementNS(SVG_NS, 'text');
    node.setAttribute('class', className);
    node.textContent = text;
    probe.appendChild(node);
    const width = node.getComputedTextLength() || text.length * 7.2;
    node.remove();
    return width;
  };

  // The vertical title sits mid-axis; the axis ends read along the same line
  // when there is room for them beside it.
  const titleX = compact ? 12 : 19, midY = (m.t + H - m.b) / 2;
  const yTitle = `${AXIS_NAMES[yKey].toUpperCase()} →`;
  let yAxisText = `<text class="axis-title" transform="translate(${titleX} ${midY}) rotate(-90)" text-anchor="middle">${esc(yTitle)}</text>`;
  // On narrow charts the tick labels sit close to this line, so the ends step
  // in far enough to clear the 0 and 100 ticks.
  const endInset = compact ? 16 : 0;
  const room = (H - m.t - m.b) / 2 - measure(yTitle, 'axis-title') / 2 - 10 - endInset;
  const endClass = 'tick axis-end y-end';
  if (yDef.high && measure(yDef.high, endClass) <= room) yAxisText += `<text class="${endClass}" transform="translate(${titleX} ${m.t + endInset}) rotate(-90)" text-anchor="end">${esc(yDef.high)}</text>`;
  if (yDef.low && measure(yDef.low, endClass) <= room) yAxisText += `<text class="${endClass}" transform="translate(${titleX} ${H - m.b - endInset}) rotate(-90)" text-anchor="start">${esc(yDef.low)}</text>`;

  // Quadrant names are data, and they occupy space labels must avoid.
  const quads = quadrantLabels({ names: SITE.quadrants?.[yKey], W, H, m, compact, measure });
  const quadrants = quads.map(q => `<text class="quadrant-label" x="${q.x}" y="${q.y}" text-anchor="${q.anchor}">${esc(q.text)}</text>`).join('');
  const { labels, hidden } = placeLabels({ nodes, W, H, m, compact, measure, fixed: quads.map(q => q.box) });
  probe.remove();

  let markup = '', labelNodes = '';
  for (const node of nodes) {
    const c = node.company, label = labels.get(c.id), missing = state.size !== 'equal' && c[state.size] == null;
    const hue = `style="--c:${esc(color(c))}"`;
    const point = c.cls === 'platform'
      ? `<rect class="point square" x="${node.x - node.r}" y="${node.y - node.r}" width="${2 * node.r}" height="${2 * node.r}" rx="2" ${hue}/>`
      : `<circle class="point${missing ? ' hollow' : ''}" cx="${node.x}" cy="${node.y}" r="${node.r}" ${hue}/>`;
    markup += `<g class="map-node" data-company="${esc(c.id)}" role="button" tabindex="0" aria-label="${esc(c.name)}. ${esc(AXIS_NAMES[xKey])} ${c[xKey]}, ${esc(AXIS_NAMES[yKey])} ${c[yKey]}. ${esc(valueLabel(c, state.size))}. Open profile."><circle class="hit" cx="${node.x}" cy="${node.y}" r="${Math.max(node.r, 12)}"/>${point}</g>`;
    if (!label) continue;
    const box = label.box, end = leaderEnd(node, box);
    labelNodes += `${leaderShown(node, box, compact) ? `<line class="leader-line" data-company="${esc(c.id)}" x1="${node.x}" y1="${node.y}" x2="${end.x}" y2="${end.y}" pointer-events="none"/>` : ''}<g class="map-node map-label-group" data-company="${esc(c.id)}" aria-hidden="true"><rect class="label-bg" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="4"/><text class="map-label" x="${box.x + (label.full ? 6 : compact ? 4 : 5)}" y="${box.y + (label.full ? 15 : box.h / 2 + 4)}">${esc(label.name)}</text>${label.full ? `<text class="value-label" x="${box.x + 6}" y="${box.y + 30}">${esc(label.value)}</text>` : ''}</g>`;
  }
  plot.setAttribute('aria-label', `Companies by ${AXIS_NAMES[xKey].toLowerCase()} and ${AXIS_NAMES[yKey].toLowerCase()}. Use Tab to focus a company and Enter to open it.`);
  plot.insertAdjacentHTML('beforeend', yAxisText + quadrants + markup + labelNodes);
  renderLegend(max, maxRadius, compact, hidden);
}

// Nested reference circles drawn on the map's own scale, chosen from the data's
// range so the largest bubble on the chart has a reference near its size.
function renderLegend(max, maxRadius, compact, hiddenLabels = 0) {
  const legend = $('#sizeLegend'), note = $('#chartNote');
  const labelNote = compact ? 'On small screens labels show names only' + (hiddenLabels ? ` and ${hiddenLabels} are hidden to avoid overlap` : '') + '; tap any mark for its figures. '
    : hiddenLabels ? `${hiddenLabels} ${hiddenLabels === 1 ? 'label is' : 'labels are'} hidden to avoid overlap; hover or focus a mark for its figures. ` : '';
  note.innerHTML = labelNote + (state.size === 'valuation'
    ? '* Manual values have no public source. “est.” marks sourced estimates. Platform values are excluded. <a href="#methodology">Scoring &amp; data notes ↗</a>'
    : state.size === 'raised' ? 'Total funding is cumulative capital recorded in the dataset, not a company valuation. * Manual values have no public source. Platform parent funding is excluded. <a href="#methodology">Data notes ↗</a>'
    : 'Mark size is uniform. Position reflects editorial capability scores; it does not indicate financial scale.');
  if (state.size === 'equal') { legend.textContent = 'Equal marks · compare positions'; return; }
  const refs = legendReferences(max, maxRadius);
  const radii = refs.map(value => bubbleRadius({ [state.size]: value }, state.size, max, maxRadius));
  const R = Math.max(...radii), base = 2 * R + 3, labelX = 2 * R + 16;
  let lastY = Infinity;
  const items = refs.map((value, index) => {
    const r = radii[index], top = base - 2 * r;
    const textY = Math.min(top + 3.5, lastY - 11); lastY = textY;
    return { value, r, top, textY };
  }).reverse().map(({ value, r, top, textY }) => `<circle cx="${R + 2}" cy="${base - r}" r="${r}"/><line x1="${R + 2}" y1="${top}" x2="${labelX - 4}" y2="${textY - 3.5}"/><text x="${labelX}" y="${textY}">${money(value)}</text>`).join('');
  const threshold = roundSignificant(floorThreshold(max, maxRadius));
  const top = Math.min(0, lastY - 10), width = labelX + 46, height = base + 2 - top;
  legend.innerHTML = `<span class="legend-title">Bubble area<small>Under ${money(threshold)} drawn at minimum size</small></span><svg width="${width}" height="${height}" viewBox="0 ${top} ${width} ${height}" role="img" aria-label="Reference sizes ${refs.map(money).join(', ')}">${items}</svg>`;
}

/* ---------- list ----------------------------------------------------------- */

function renderList(rows) {
  for (const th of document.querySelectorAll('#tableHead th[data-col]')) {
    const col = columns().find(item => item.key === th.dataset.col);
    th.setAttribute('aria-sort', col.sort === state.sort ? col.dir : 'none');
  }
  const scoreCell = (c, axis) => `<td class="num"><span class="metric-score">${esc(c[axis])}<span class="mini-track" aria-hidden="true"><i style="width:${Number(c[axis]) || 0}%"></i></span></span></td>`;
  const roundCell = c => c.cls === 'platform'
    ? muted() + '<span class="cell-secondary">Parent company product</span>'
    : `${esc(c.lastSeries || 'Undisclosed')}<span class="cell-secondary">${c.lastDate ? date(c.lastDate) : 'Date undisclosed'}</span>`;
  $('#tableRows').innerHTML = rows.map(c => `<tr class="${c.cls === 'platform' ? 'is-platform' : ''}"><td><button class="company-button" data-company="${esc(c.id)}">${avatar(c)}<span>${esc(c.name)}${c.company && c.company !== c.name ? `<span class="cell-secondary">${esc(c.company)}</span>` : ''}</span></button></td><td><span class="focus-label" style="--category:${esc(color(c))}">${esc(CATEGORIES[c.cat].name)}</span><span class="cell-secondary">${OWNERSHIP[c.cls]}</span></td>${AXES.all.map(axis => scoreCell(c, axis)).join('')}<td>${valuationMarkup(c)}</td><td>${raisedMarkup(c)}</td><td>${roundCell(c)}</td></tr>`).join('');
  // Cards show the horizontal axis and whichever vertical axis the map uses.
  const cardAxes = [AXES.x, state.axis].filter((axis, index, all) => axis && all.indexOf(axis) === index);
  $('#mobileRows').innerHTML = rows.map(c => `<button class="company-card" data-company="${esc(c.id)}"><div class="card-top">${avatar(c)}<div><h3>${esc(c.name)}</h3><p>${esc(CATEGORIES[c.cat].name)} · ${OWNERSHIP[c.cls]}</p></div><span aria-hidden="true">↗</span></div><dl class="card-metrics">${cardAxes.map(axis => `<div><dt>${esc(AXIS_NAMES[axis])}</dt><dd><span class="card-score">${esc(c[axis])}</span><span class="mini-track" aria-hidden="true"><i style="width:${Number(c[axis]) || 0}%"></i></span></dd></div>`).join('')}<div><dt>Valuation</dt><dd>${c.cls === 'platform' ? '<span class="cell-muted">Platform</span>' : `<span class="card-value">${money(c.valuation)}</span>`}${c.cls !== 'platform' && c.valuation != null ? confidenceChip(c) : ''}</dd></div></dl></button>`).join('');
}

function renderResearch(rows) {
  const articles = researchArticles(rows);
  const byId = new Map(DATA.map(c => [c.id, c]));
  $('#researchSummary').textContent = rows.length === DATA.length ? 'Recent coverage across the landscape, grouped by article.' : `Recent coverage for the ${rows.length} products in this view.`;
  $('#researchItems').innerHTML = articles.map(article => {
    const lead = byId.get(article.companies[0]?.id);
    return externalLink(article.u, `<div class="article-companies" style="--category:${esc(lead ? color(lead) : CATEGORIES.all.color)}"><span><i class="category-dot" aria-hidden="true"></i>${esc(article.companies.map(labelFor).join(' · '))}</span><span aria-hidden="true">↗</span></div><h3>${esc(article.t)}</h3><div class="article-meta"><span>${esc(article.p)}</span><time datetime="${esc(article.d)}">${date(article.d)}</time></div>`, 'research-card');
  }).join('') || '<p class="research-empty">No linked research matches the current filters.</p>';
}

/* ---------- profile drawer ------------------------------------------------ */

// Previous / next walk the companies in the order the reader is looking at.
const profileRows = () => currentRows.some(c => c.id === state.selected) ? currentRows : DATA;
function triggerFor(id) {
  const selector = `[data-company="${CSS.escape(id)}"]`;
  if (state.view === 'map') return plot.querySelector(`[role="button"]${selector}`);
  return [...document.querySelectorAll(`#listView ${selector}`)].find(el => el.offsetParent !== null) || null;
}
function stepProfile(delta) {
  const rows = profileRows(), index = rows.findIndex(c => c.id === state.selected);
  if (index < 0 || rows.length < 2) return;
  openProfile(rows[(index + delta + rows.length) % rows.length].id, null, { push: false });
}
function openProfile(id, trigger, { push = true } = {}) {
  const company = DATA.find(c => c.id === id);
  if (!company) return;
  const wasOpen = dialog.open;
  state.selected = id;
  selectedTrigger = triggerFor(id) || trigger || selectedTrigger;
  tooltip.hidden = true;
  $('#companyContent').innerHTML = renderProfile(company, { variant: 'drawer', profileHref: profileHref(company) });
  const rows = profileRows(), index = rows.findIndex(c => c.id === id);
  $('#dialogPosition').textContent = index >= 0 ? `${index + 1} of ${rows.length}` : '';
  $('#prevCompany').disabled = $('#nextCompany').disabled = rows.length < 2;
  if (!wasOpen) dialog.showModal();
  dialog.scrollTop = 0;
  if (!wasOpen) $('#closeDialog').focus({ preventScroll: true });
  if (push && !wasOpen) profilePushed = syncUrl(true); else syncUrl();
}

initialize();
