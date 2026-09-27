const $ = selector => document.querySelector(selector);
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = value => value ? new Date(value + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date undisclosed';
const color = company => CATEGORIES[company.cat]?.color || CATEGORIES.all.color;
const initials = company => company.name.split(/[\s+]+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
const displayName = company => company.name === 'Comet (Perplexity)' ? 'Comet' : company.name;
const profileHref = company => SITE.companyHref.replace('__ID__', encodeURIComponent(company.id));
const avatar = company => `<span class="avatar" aria-hidden="true" style="--category:${color(company)}">${esc(initials(company))}</span>`;
const externalLink = (url, label, classes = '') => `<a href="${esc(url)}" class="${classes}" target="_blank" rel="noopener noreferrer">${label}</a>`;
const maximums = { valuation: Math.max(0, ...DATA.filter(c => c.cls !== 'platform').map(c => c.valuation || 0)), raised: Math.max(0, ...DATA.filter(c => c.cls !== 'platform').map(c => c.raised || 0)) };
let state = readState(location.search, matchMedia('(max-width:700px)').matches);
let currentRows = [];
let selectedTrigger = null;
let mapSignature = '';
const dialog = $('#companyDialog');
const tooltip = $('#tooltip');

function syncUrl() { history.replaceState(null, '', location.pathname + '?' + stateQuery(state) + location.hash); }
function confidenceMarkup(company) {
  const confidence = valueConfidence(company);
  return `<span class="confidence ${confidence}">${esc(CONFIDENCE[confidence])}</span>`;
}
function valuationMarkup(company) {
  if (company.cls === 'platform') return '<span class="cell-secondary">Not applicable</span><span class="cell-secondary">Parent value excluded</span>';
  if (company.valuation == null) return '<span class="cell-secondary">Undisclosed</span>';
  return `<span class="value-amount">${money(company.valuation)}</span><span class="cell-secondary">${confidenceMarkup(company)}</span>`;
}

function initialize() {
  $('#pageTitle').textContent = SITE.name;
  $('#updated').textContent = date(SITE.asOf);
  $('#footerDate').textContent = date(SITE.asOf);
  $('#marketStats').innerHTML = [[DATA.length, 'tracked'], [DATA.filter(c => c.cls === 'independent').length, 'independent'], [DATA.filter(c => c.cls === 'platform').length, 'platforms'], [DATA.filter(c => c.cls === 'acquired').length, 'acquired']].map(([count, label]) => `<div><strong>${count}</strong><span>${label}</span></div>`).join('');
  document.querySelectorAll('[data-changelog]').forEach(link => link.href = SITE.changelog);
  document.querySelectorAll('[data-home]').forEach(link => link.href = SITE.home);
  $('#categoryFilters').innerHTML = Object.entries(CATEGORIES).map(([id, category]) => `<button data-category="${id}" aria-pressed="false" style="--category:${category.color}">${id !== 'all' ? '<i class="category-dot" aria-hidden="true"></i>' : ''}${esc(category.name)}<span class="count"></span></button>`).join('');
  $('#axisRubrics').innerHTML = [SITE.axes.x, SITE.axes.y, SITE.axes.yAlt].map(axis => `<div class="rubric"><strong>${esc(axis.label)}</strong><p>${esc(axis.rubric)}</p></div>`).join('');
  $('#scopeDetails').innerHTML = `<p>${esc(SITE.scope)}</p><ul>${SITE.inclusion.map(item => `<li>${esc(item)}</li>`).join('')}</ul><p>Outside the target scope: ${esc(SITE.exclusions.join('; '))}.</p>`;
  $('#categoryFilters').addEventListener('click', event => {
    const button = event.target.closest('[data-category]');
    if (button) { state.category = button.dataset.category; render(); }
  });
  $('#search').addEventListener('input', event => { state.query = event.target.value; render(); });
  for (const [id, key] of [['ownership', 'ownership'], ['yAxis', 'axis'], ['sizeBy', 'size'], ['sortBy', 'sort']]) {
    $('#' + id).addEventListener('change', event => { state[key] = event.target.value; render(); });
  }
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { state.view = button.dataset.view; render(); }));
  for (const id of ['resetFilters', 'clearFilters']) $('#' + id).addEventListener('click', () => { state.category = 'all'; state.ownership = 'all'; state.query = ''; render(); });
  $('#closeDialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  dialog.addEventListener('close', () => { state.selected = null; syncUrl(); selectedTrigger?.isConnected && selectedTrigger.focus({ preventScroll: true }); });
  for (const selector of ['#tableRows', '#mobileRows']) $(selector).addEventListener('click', event => {
    const button = event.target.closest('[data-company]');
    if (button) openProfile(button.dataset.company, button);
  });
  window.addEventListener('popstate', () => { if (dialog.open) dialog.close(); state = readState(location.search, matchMedia('(max-width:700px)').matches); render(); });
  window.addEventListener('scroll', () => { tooltip.hidden = true; }, { passive: true });
  $('.plot-scroll').addEventListener('scroll', () => { tooltip.hidden = true; }, { passive: true });
  const initialSelection = state.selected;
  state.selected = null;
  render();
  if (initialSelection && DATA.some(c => c.id === initialSelection)) openProfile(initialSelection);
  document.fonts.ready.then(() => { mapSignature = ''; if (state.view === 'map') renderMap(currentRows); });
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
  $('#resetFilters').hidden = state.category === 'all' && state.ownership === 'all' && !state.query;
  $('#chartControls').hidden = state.view !== 'map' || !currentRows.length;
  $('#listControls').hidden = state.view !== 'table' || !currentRows.length;
  $('#mapView').hidden = state.view !== 'map' || !currentRows.length;
  $('#listView').hidden = state.view !== 'table' || !currentRows.length;
  $('#emptyState').hidden = currentRows.length > 0;
  if (state.view === 'map' && currentRows.length) renderMap(currentRows);
  if (state.view === 'table') renderList(currentRows);
  renderResearch(currentRows);
  syncUrl();
}

function renderMap(rows) {
  const signature = `${state.axis}|${state.size}|${rows.map(c => c.id).sort().join(',')}`;
  if (signature === mapSignature) return;
  mapSignature = signature;
  const W = 1160, H = 530, m = { l: 74, r: 62, t: 39, b: 74 };
  const x = score => m.l + score / 100 * (W - m.l - m.r);
  const y = score => H - m.b - score / 100 * (H - m.t - m.b);
  const max = maximums[state.size] || 1;
  const nodes = rows.map(company => ({ company, x: x(company.autonomy), y: y(company[state.axis]), r: bubbleRadius(company, state.size, max) }));
  let grid = `<rect x="${x(50)}" y="${m.t}" width="${x(100)-x(50)}" height="${y(50)-m.t}" fill="#f7faf4"/>`;
  for (const value of [0, 25, 50, 75, 100]) {
    grid += `<line class="grid-line ${value === 50 ? 'mid-line' : ''}" x1="${x(value)}" y1="${m.t}" x2="${x(value)}" y2="${H-m.b}"/><line class="grid-line ${value === 50 ? 'mid-line' : ''}" x1="${m.l}" y1="${y(value)}" x2="${W-m.r}" y2="${y(value)}"/><text class="tick" x="${x(value)}" y="${H-m.b+18}" text-anchor="middle">${value}</text><text class="tick" x="${m.l-13}" y="${y(value)+3}" text-anchor="end">${value}</text>`;
  }
  grid += `<text class="axis-title" x="${(m.l+W-m.r)/2}" y="${H-20}" text-anchor="middle">AUTONOMY →</text><text class="tick" x="${m.l}" y="${H-20}">Prompted</text><text class="tick" x="${W-m.r}" y="${H-20}" text-anchor="end">Acts within your guardrails</text><text class="axis-title" transform="translate(19 ${(m.t+H-m.b)/2}) rotate(-90)" text-anchor="middle">${AXIS_NAMES[state.axis].toUpperCase()} →</text><text class="plot-region-label" x="${W-m.r-8}" y="${m.t-12}" text-anchor="end">${state.axis === 'breadth' ? 'BROADER CONTEXT · MORE AUTONOMY' : 'GREATER REACH · MORE AUTONOMY'}</text>`;

  const context = document.createElement('canvas').getContext('2d');
  const measure = (text, font) => { context.font = font; return context.measureText(text).width; };
  const occupied = [];
  const overlap = (a, b) => Math.max(0, Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)) * Math.max(0, Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
  const labels = new Map();
  // Place crowded labels first. Candidate boxes use measured type and avoid both labels and marks.
  const ordered = [...nodes].sort((a,b) => {
    const nearby = n => nodes.filter(other => other !== n && Math.hypot(other.x-n.x, other.y-n.y) < 120).length;
    return nearby(b)-nearby(a) || b.r-a.r;
  });
  for (const node of ordered) {
    const name = displayName(node.company), value = valueLabel(node.company, state.size);
    // Match the map-label/value-label type sizes and padding in map.css.
    const width = Math.max(measure(name,'600 12.5px "DM Sans"'),measure(value,'11px "DM Mono"')) + 12;
    const height = 36, gap = Math.max(node.r, 6) + 7;
    const candidates = [];
    for (const extra of [0, 8, 16, 24, 36, 52, 72, 96, 128]) {
      const offsets = [[gap+extra,-height/2],[-width-gap-extra,-height/2],[-width/2,-height-gap-extra],[-width/2,gap+extra], [gap+extra,-height-gap-extra],[-width-gap-extra,-height-gap-extra],[gap+extra,gap+extra],[-width-gap-extra,gap+extra]];
      offsets.forEach(([dx,dy],index) => candidates.push({ x: node.x+dx, y: node.y+dy, w: width, h: height, preference: extra*.2+index*.35 }));
    }
    let best, cost = Infinity;
    for (const box of candidates) {
      let value = box.preference;
      const clamped = { x: Math.max(m.l+2,Math.min(box.x,W-m.r-box.w-2)), y: Math.max(m.t+2,Math.min(box.y,H-m.b-box.h-2)) };
      value += Math.abs(box.x-clamped.x)*3 + Math.abs(box.y-clamped.y)*3;
      box.x = clamped.x; box.y = clamped.y;
      for (const prior of occupied) value += overlap(box,prior)*20;
      for (const point of nodes) value += overlap(box,{x:point.x-point.r-3,y:point.y-point.r-3,w:2*point.r+6,h:2*point.r+6})*12;
      if (value < cost) { best = box; cost = value; }
    }
    occupied.push(best);
    labels.set(node.company.id, { ...best, name, value });
  }
  let marks = '', labelNodes = '';
  for (const node of nodes) {
    const c = node.company, label = labels.get(c.id), missing = state.size !== 'equal' && c[state.size] == null;
    const point = c.cls === 'platform'
      ? `<rect class="point" x="${node.x-6}" y="${node.y-6}" width="12" height="12" rx="2" fill="${color(c)}" stroke="white" stroke-width="1.5"/>`
      : `<circle class="point" cx="${node.x}" cy="${node.y}" r="${node.r}" fill="${missing?'white':color(c)}" fill-opacity="${missing?1:.86}" stroke="${missing?color(c):'white'}" stroke-width="${missing?1.7:1.5}"/>`;
    marks += `<g class="map-node" data-company="${c.id}" role="button" tabindex="0" aria-label="${esc(c.name)}. ${AXIS_NAMES.autonomy} ${c.autonomy}, ${AXIS_NAMES[state.axis]} ${c[state.axis]}. ${esc(valueLabel(c,state.size))}. Open profile."><circle cx="${node.x}" cy="${node.y}" r="${Math.max(node.r,12)}" fill="transparent"/>${point}</g>`;
    const endX = Math.max(label.x,Math.min(node.x,label.x+label.w)), endY = Math.max(label.y,Math.min(node.y,label.y+label.h));
    const distance = Math.hypot(endX-node.x,endY-node.y);
    labelNodes += `${distance>node.r+17?`<line class="leader-line" x1="${node.x}" y1="${node.y}" x2="${endX}" y2="${endY}" pointer-events="none"/>`:''}<g class="map-node" data-company="${c.id}" aria-hidden="true"><rect class="label-bg" x="${label.x}" y="${label.y}" width="${label.w}" height="${label.h}" rx="4"/><text class="map-label" x="${label.x+6}" y="${label.y+15}">${esc(label.name)}</text><text class="value-label" x="${label.x+6}" y="${label.y+30}">${esc(label.value)}</text></g>`;
  }
  const plot = $('#plot');
  plot.setAttribute('aria-label', `Companies by autonomy and ${AXIS_NAMES[state.axis].toLowerCase()}. Use Tab to focus a company and Enter to open it.`);
  plot.innerHTML = grid + marks + labelNodes;
  for (const node of plot.querySelectorAll('[data-company]')) {
    node.addEventListener('click', () => openProfile(node.dataset.company, node));
    node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openProfile(node.dataset.company,node); } });
    node.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch') return;
      const company = DATA.find(c => c.id === node.dataset.company);
      tooltip.innerHTML = `<b>${esc(company.name)}</b>${tooltipLines(company,state.size).map(line => `<span>${esc(line)}</span>`).join('')}`;
      tooltip.hidden = false;
      const bounds = tooltip.getBoundingClientRect();
      tooltip.style.left = Math.max(8,Math.min(event.clientX+14,innerWidth-bounds.width-8))+'px';
      tooltip.style.top = Math.max(8,Math.min(event.clientY+15,innerHeight-bounds.height-8))+'px';
    });
    node.addEventListener('pointerleave', () => tooltip.hidden = true);
  }
  if (state.size === 'equal') $('#sizeLegend').textContent = 'Equal marks · compare positions';
  else {
    const refs = state.size === 'valuation' ? [1e8,5e8,1e9] : [1e7,5e7,1e8];
    $('#sizeLegend').innerHTML = `<span>Area scale</span><svg width="178" height="48" aria-label="${refs.map(money).join(', ')}"><g>${refs.map((value,index)=>{ const r=bubbleRadius({[state.size]:value},state.size,max);return `<circle cx="${26+index*59}" cy="18" r="${r}" fill="none" stroke="#91a38d"/><text x="${26+index*59}" y="46" text-anchor="middle" fill="#747b75" font-size="8" font-family="monospace">${money(value)}</text>`; }).join('')}</g></svg>`;
  }
  $('#chartNote').innerHTML = state.size === 'valuation'
    ? '* Manual values have no public source. “est.” marks sourced estimates. Platform values are excluded. <a href="#methodology">Scoring &amp; data notes ↗</a>'
    : state.size === 'raised' ? 'Total funding is cumulative capital recorded in the dataset, not a company valuation. Platform parent funding is excluded. <a href="#methodology">Data notes ↗</a>'
    : 'Mark size is uniform. Position reflects editorial capability scores; it does not indicate financial scale.';
}

function renderList(rows) {
  $('#tableRows').innerHTML = rows.map(c => `<tr><td><button class="company-button" data-company="${c.id}">${avatar(c)}<span>${esc(c.name)}${c.company&&c.company!==c.name?`<span class="cell-secondary">${esc(c.company)}</span>`:''}</span></button></td><td><span class="focus-label" style="--category:${color(c)}">${esc(CATEGORIES[c.cat].name)}</span><span class="cell-secondary">${OWNERSHIP[c.cls]}</span></td>${['autonomy','breadth'].map(axis=>`<td><span class="metric-score">${c[axis]}<span class="mini-track" aria-hidden="true"><i style="width:${c[axis]}%"></i></span></span></td>`).join('')}<td>${valuationMarkup(c)}</td><td>${c.cls==='platform'?'—':esc(c.lastSeries||'Undisclosed')}<span class="cell-secondary">${c.cls==='platform'?'Parent company product':c.lastDate?date(c.lastDate):'Date undisclosed'}</span></td></tr>`).join('');
  $('#mobileRows').innerHTML = rows.map(c => `<button class="company-card" data-company="${c.id}"><div class="card-top">${avatar(c)}<div><h3>${esc(c.name)}</h3><p>${esc(CATEGORIES[c.cat].name)} · ${OWNERSHIP[c.cls]}</p></div><span aria-hidden="true">↗</span></div><dl class="card-metrics"><div><dt>Autonomy</dt><dd>${c.autonomy}<span class="cell-secondary">/ 100</span></dd></div><div><dt>Breadth</dt><dd>${c.breadth}<span class="cell-secondary">/ 100</span></dd></div><div><dt>Valuation</dt><dd>${c.cls==='platform'?'Not applicable':money(c.valuation)}${c.valuation!=null?confidenceMarkup(c):''}</dd></div></dl></button>`).join('');
}

function renderResearch(rows) {
  const articles = researchArticles(rows);
  $('#researchSummary').textContent = rows.length === DATA.length ? 'Recent sources across the landscape, grouped by article.' : `Recent sources for the ${rows.length} products in this view.`;
  $('#researchItems').innerHTML = articles.map(article => externalLink(article.u, `<div class="article-companies"><span>${esc(article.companies.map(c=>displayName(c)).join(' · '))}</span><span aria-hidden="true">↗</span></div><h3>${esc(article.t)}</h3><div class="article-meta"><span>${esc(article.p)}</span><time datetime="${esc(article.d)}">${date(article.d)}</time></div>`, 'research-card')).join('') || '<p class="research-empty">No linked research matches the current filters.</p>';
}

function openProfile(id, trigger) {
  const company = DATA.find(c => c.id === id);
  if (!company) return;
  state.selected = id;
  selectedTrigger = trigger?.closest('#plot') ? $(`#plot [role="button"][data-company="${id}"]`) : trigger || null;
  tooltip.hidden = true;
  const c = company, confidence = valueConfidence(c), source = c.src ? externalLink(c.src.u, esc(c.src.p)+' ↗') : null;
  const valuation = c.cls === 'platform'
    ? `<div class="parent-note"><strong>No standalone valuation</strong><br>This is a product of ${esc(c.company)}. Parent-company valuations and funding are excluded from the map.${c.parent?`<p class="value-note">${esc(c.parent)}</p>`:''}</div>`
    : `<div class="valuation-box ${confidence}"><span>Post-money valuation</span><div class="big-value">${money(c.valuation)}${c.valuation!=null?confidenceMarkup(c):''}</div><div class="source-line">${c.valuation==null?'No valuation disclosed in this dataset.':confidence==='manual'?'Entered by hand · no public source':source?`${source} · ${date(c.src.d)}`:'No public source recorded'}</div>${c.valNote?`<p class="value-note">${esc(c.valNote)}</p>`:''}</div><dl class="profile-facts"><div><dt>${c.cls==='acquired'?'Last funding / acquisition event':'Last round'}</dt><dd>${esc(c.lastSeries||'Undisclosed')}${c.lastAmount?' · '+money(c.lastAmount):''}<small>${date(c.lastDate)}</small>${source?`<small>${esc(CONFIDENCE[c.conf]||c.conf)} · ${source}</small>`:''}</dd></div><div><dt>Total funding</dt><dd>${money(c.raised)}<small>Cumulative figure in dataset</small></dd></div></dl>`;
  $('#companyContent').innerHTML = `<div style="--category:${color(c)}"><div class="profile-heading">${avatar(c)}<div><h2 id="companyTitle">${esc(c.name)}</h2><p>${esc([OWNERSHIP[c.cls],c.company!==c.name?c.company:null,c.hq].filter(Boolean).join(' · '))}</p></div></div><span class="profile-category"><i class="category-dot" aria-hidden="true"></i>${esc(CATEGORIES[c.cat].name)}</span><p class="profile-description">${esc(c.desc)}</p><div class="profile-links">${c.site?externalLink(c.site,'Visit website ↗'):''}<a href="${esc(profileHref(c))}">Full research profile ↗</a></div>${valuation}<section class="profile-section"><h3>Capability scores · out of 100</h3>${['autonomy','breadth','distribution'].map(axis=>`<div class="score-row"><span>${AXIS_NAMES[axis]}</span><span class="track" aria-hidden="true"><i class="fill" style="width:${c[axis]}%"></i></span><strong>${c[axis]}</strong></div>`).join('')}${c.why?`<blockquote class="rationale">${esc(c.why)}</blockquote>`:''}</section>${c.founders.length||c.founded||c.traction?`<section class="profile-section"><h3>Company context</h3>${c.founded?`<p>Founded ${c.founded}.</p>`:''}${c.founders.length?`<ul class="people">${c.founders.map(person=>`<li>${person.li?externalLink(person.li,esc(person.n)+' ↗'):esc(person.n)}${person.r?`<small>${esc(person.r)}</small>`:''}</li>`).join('')}</ul>`:''}${c.traction?`<p>${esc(c.traction)}</p>`:''}</section>`:''}${c.leads.length||c.others.length?`<section class="profile-section"><h3>Round investors</h3><div class="investors">${c.leads.map(name=>`<span>${esc(name)} · lead</span>`).join('')}${c.others.map(name=>`<span>${esc(name)}</span>`).join('')}</div></section>`:''}<section class="profile-section"><h3>Source reading</h3><div class="profile-news">${[...c.news].sort((a,b)=>(b.d||'').localeCompare(a.d||'')).slice(0,4).map(article=>externalLink(article.u,`${esc(article.t)}<small>${esc(article.p)} · ${date(article.d)}</small>`)).join('')||'<p class="cell-secondary">No linked articles in the dataset.</p>'}</div></section><p class="verified-note">Last checked in dataset · ${date(c.verified)}</p></div>`;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  $('#closeDialog').focus({ preventScroll: true });
  syncUrl();
}

initialize();
