#!/usr/bin/env node
/**
 * Local admin editor — Phase 2.
 *
 * Runs a tiny server on 127.0.0.1 only. Never deploy this; it writes to
 * your working copy so your edits show up as a normal git diff you commit.
 *
 *   npm run admin      →  http://127.0.0.1:4321
 *
 * Locking: tick the padlock on a field and its dot-path is added to the
 * company's `locked` array. The weekly agent is forbidden from overwriting
 * anything listed there — that is how a hand-entered number survives Monday.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data/markets');
const PORT = Number(process.env.PORT || 4321);

const EDITABLE = [
  { path: 'name',                      label: 'Name',            type: 'text' },
  { path: 'company',                   label: 'Company',         type: 'text' },
  { path: 'website',                   label: 'Website',         type: 'text' },
  { path: 'hq',                        label: 'HQ',              type: 'text' },
  { path: 'description',               label: 'Description',     type: 'textarea' },
  { path: 'founded',                   label: 'Founded',         type: 'number' },
  { path: 'parent',                    label: 'Parent (platforms)', type: 'textarea' },
  { path: 'traction',                  label: 'Traction',        type: 'text' },
  { path: 'class',                     label: 'Class',           type: 'select', options: ['independent', 'platform', 'acquired'] },
  { path: 'axes.autonomy.score',       label: 'Autonomy',        type: 'range' },
  { path: 'axes.autonomy.rationale',   label: 'Autonomy why',    type: 'textarea' },
  { path: 'axes.breadth.score',        label: 'Breadth',         type: 'range' },
  { path: 'axes.distribution.score',   label: 'Distribution',    type: 'range' },
  { path: 'lastRound.series',          label: 'Round',           type: 'text' },
  { path: 'lastRound.amountUsd',       label: 'Round size (USD)', type: 'number' },
  { path: 'lastRound.postMoneyUsd',    label: 'Post-money (USD)', type: 'number' },
  { path: 'lastRound.date',            label: 'Round date',      type: 'date' },
  { path: 'lastRound.confidence',      label: 'Confidence',      type: 'select', options: ['reported', 'estimated', 'rumored', 'manual', 'undisclosed'] },
  { path: 'lastRound.note',            label: 'Valuation note',  type: 'textarea' },
  { path: 'lastRound.source.url',      label: 'Source URL',      type: 'text' },
  { path: 'lastRound.source.publisher', label: 'Source publisher', type: 'text' },
  { path: 'lastRound.source.date',     label: 'Source date',     type: 'date' },
  { path: 'metrics.totalRaisedUsd',    label: 'Total raised (USD)', type: 'number' },
];

const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function set(o, p, v) {
  const keys = p.split('.');
  const last = keys.pop();
  let cur = o;
  for (const k of keys) { if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k]; }
  if (v === '' || v == null) cur[last] = null; else cur[last] = v;
}
const files = () => fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
const load = f => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
const save = (f, doc) => fs.writeFileSync(path.join(DATA_DIR, f), JSON.stringify(doc, null, 2) + '\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(html());
  }

  if (req.method === 'GET' && url.pathname === '/api/markets') {
    const out = files().map(f => ({ file: f, doc: load(f) }));
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(out));
  }

  if (req.method === 'POST' && url.pathname === '/api/save') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const { file, id, values, locked } = JSON.parse(body);
      if (!files().includes(file)) throw new Error('unknown market file');
      const doc = load(file);
      const c = doc.companies.find(x => x.id === id);
      if (!c) throw new Error('unknown company');

      for (const [p, raw] of Object.entries(values)) {
        const field = EDITABLE.find(f => f.path === p);
        if (!field) continue;
        let v = raw;
        if (field.type === 'number' || field.type === 'range') v = raw === '' || raw == null ? null : Number(raw);
        set(c, p, v);
        // Typing a value by hand means you vouch for it. Mark it manual unless
        // a real source is attached, so the UI never implies a citation exists.
        if (p === 'lastRound.postMoneyUsd' && v != null && !get(c, 'lastRound.source.url')) {
          set(c, 'lastRound.confidence', 'manual');
        }
      }
      c.locked = [...new Set(locked ?? [])];
      c.lastVerified = new Date().toISOString().slice(0, 10);

      save(file, doc);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, lastVerified: c.lastVerified }));
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  res.writeHead(404).end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Admin editor  →  http://127.0.0.1:${PORT}`);
  console.log(`Edits write straight to data/markets/. Review with \`git diff\`, then commit.`);
});

function html() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Market map admin</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
:root{--paper:#F4F5F9;--surface:#fff;--surface-2:#EBEDF4;--ink:#131826;--ink-2:#3E475E;--ink-3:#6B7490;
 --rule:#D6DAE6;--rule-soft:#E4E7F0;--accent:#2748CC;--accent-soft:#E5E9FA;--accent-ink:#1B3496;--ochre:#A2660D;--ochre-soft:#F7EDD9;--ok:#1B6844;--ok-soft:#DCEFE4}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--paper:#0D1119;--surface:#151A26;--surface-2:#1D2331;
 --ink:#EDEFF5;--ink-2:#B4BBCD;--ink-3:#828BA3;--rule:#2A3242;--rule-soft:#222937;--accent:#7D95F5;--accent-soft:#1C2647;--accent-ink:#A8B9FF;--ochre:#D9A448;--ochre-soft:#2E2413;--ok:#6FC79A;--ok-soft:#15301F}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:"IBM Plex Sans",system-ui,sans-serif;font-size:14px;line-height:1.55}
header{padding:18px 22px;border-bottom:1px solid var(--rule);background:var(--surface);display:flex;gap:16px;align-items:center;flex-wrap:wrap;position:sticky;top:0;z-index:5}
header h1{font-size:15px;margin:0;font-weight:600}
header .hint{font-family:"IBM Plex Mono",monospace;font-size:11px;color:var(--ink-3)}
.layout{display:grid;grid-template-columns:246px minmax(0,1fr);gap:0;min-height:calc(100vh - 61px)}
@media (max-width:760px){.layout{grid-template-columns:1fr}}
aside{border-right:1px solid var(--rule);background:var(--surface);padding:12px 0;overflow-y:auto}
aside button{display:block;width:100%;text-align:left;padding:9px 20px;border:0;background:none;cursor:pointer;
 color:var(--ink-2);font-family:inherit;font-size:13.5px;border-left:2px solid transparent}
aside button:hover{background:var(--surface-2)}
aside button[aria-current=true]{background:var(--accent-soft);color:var(--accent-ink);border-left-color:var(--accent);font-weight:600}
aside .lk{font-family:"IBM Plex Mono",monospace;font-size:10px;color:var(--ochre);margin-left:6px}
main{padding:22px 26px;max-width:760px}
main h2{font-size:19px;margin:0 0 4px}
main .sub{font-family:"IBM Plex Mono",monospace;font-size:11.5px;color:var(--ink-3);margin:0 0 22px}
.f{display:grid;grid-template-columns:172px minmax(0,1fr) 30px;gap:12px;align-items:start;padding:9px 0;border-bottom:1px solid var(--rule-soft)}
.f > label{font-family:"IBM Plex Mono",monospace;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);padding-top:8px}
.f input[type=text],.f input[type=number],.f input[type=date],.f select,.f textarea{
 width:100%;padding:7px 10px;border:1px solid var(--rule);border-radius:4px;background:var(--paper);
 color:var(--ink);font-family:inherit;font-size:13.5px}
.f textarea{min-height:62px;resize:vertical;line-height:1.5}
.f input:focus,.f select:focus,.f textarea:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:transparent}
.rangewrap{display:flex;align-items:center;gap:11px}
.rangewrap input[type=range]{flex:1;accent-color:var(--accent)}
.rangewrap output{font-family:"IBM Plex Mono",monospace;font-size:12.5px;width:28px;text-align:right;font-variant-numeric:tabular-nums}
.lockbtn{border:1px solid var(--rule);background:var(--paper);border-radius:4px;width:30px;height:30px;cursor:pointer;
 font-size:13px;line-height:1;margin-top:4px;color:var(--ink-3)}
.lockbtn[aria-pressed=true]{background:var(--ochre-soft);border-color:var(--ochre);color:var(--ochre)}
.bar{position:sticky;bottom:0;background:var(--surface);border-top:1px solid var(--rule);padding:14px 26px;
 margin:26px -26px 0;display:flex;gap:14px;align-items:center}
.bar button{padding:9px 20px;border:0;border-radius:4px;background:var(--accent);color:#fff;font-family:inherit;
 font-size:13.5px;font-weight:600;cursor:pointer}
.bar button:disabled{opacity:.45;cursor:default}
.bar .msg{font-family:"IBM Plex Mono",monospace;font-size:11.5px;color:var(--ink-3)}
.bar .msg.ok{color:var(--ok)}.bar .msg.err{color:#9C2B2B}
.locknote{background:var(--ochre-soft);color:var(--ochre);border-left:2px solid var(--ochre);padding:10px 13px;
 border-radius:0 4px 4px 0;font-size:12.5px;margin:0 0 20px}
</style></head><body>
<header>
  <h1>Market map admin</h1>
  <span class="hint">writes to data/markets/ · review with git diff · 🔒 = agent may never overwrite</span>
</header>
<div class="layout"><aside id="list"></aside><main id="pane"></main></div>
<script>
const EDITABLE = ${JSON.stringify(EDITABLE)};
const get=(o,p)=>p.split('.').reduce((a,k)=>a==null?undefined:a[k],o);
let markets=[], cur=null, locked=new Set();

async function boot(){
  markets = await (await fetch('/api/markets')).json();
  renderList();
  const first = markets[0]?.doc.companies[0];
  if(first) select(markets[0].file, first.id);
}
function renderList(){
  document.getElementById('list').innerHTML = markets.map(m=>
    m.doc.companies.map(c=>
      \`<button data-file="\${m.file}" data-id="\${c.id}" aria-current="\${cur&&cur.id===c.id}">\${c.name}\${
        (c.locked||[]).length?'<span class="lk">🔒'+c.locked.length+'</span>':''}</button>\`).join('')).join('');
  document.querySelectorAll('#list button').forEach(b=>
    b.onclick=()=>select(b.dataset.file,b.dataset.id));
}
function select(file,id){
  const m = markets.find(x=>x.file===file);
  const c = m.doc.companies.find(x=>x.id===id);
  cur = { file, id, c };
  locked = new Set(c.locked||[]);
  renderList(); renderPane();
}
function renderPane(){
  const {c} = cur;
  document.getElementById('pane').innerHTML = \`
    <h2>\${c.name}</h2>
    <p class="sub">\${c.id} · \${c.class} · last verified \${c.lastVerified}</p>
    <p class="locknote">Lock a field when you have entered a number the agent will not find publicly. Locked paths go into the company's <code>locked</code> array and the weekly refresh skips them entirely.</p>
    \${EDITABLE.map(f=>field(f,c)).join('')}
    <div class="bar"><button id="save">Save to JSON</button><span class="msg" id="msg"></span></div>\`;
  document.querySelectorAll('.lockbtn').forEach(b=>b.onclick=()=>{
    const p=b.dataset.p;
    if(locked.has(p))locked.delete(p);else locked.add(p);
    b.setAttribute('aria-pressed',locked.has(p));
  });
  document.querySelectorAll('input[type=range]').forEach(r=>
    r.oninput=()=>r.nextElementSibling.value=r.value);
  document.getElementById('save').onclick=saveCompany;
}
function field(f,c){
  const v = get(c,f.path);
  const val = v==null?'':String(v);
  let input;
  if(f.type==='textarea') input=\`<textarea data-p="\${f.path}">\${val.replace(/</g,'&lt;')}</textarea>\`;
  else if(f.type==='select') input=\`<select data-p="\${f.path}">\${
    f.options.map(o=>\`<option\${o===val?' selected':''}>\${o}</option>\`).join('')}</select>\`;
  else if(f.type==='range') input=\`<div class="rangewrap"><input type="range" min="0" max="100" value="\${val||0}" data-p="\${f.path}"><output>\${val||0}</output></div>\`;
  else input=\`<input type="\${f.type}" value="\${val.replace(/"/g,'&quot;')}" data-p="\${f.path}">\`;
  return \`<div class="f"><label>\${f.label}</label>\${input}
    <button class="lockbtn" data-p="\${f.path}" aria-pressed="\${locked.has(f.path)}" title="Lock this field against the agent">🔒</button></div>\`;
}
async function saveCompany(){
  const btn=document.getElementById('save'), msg=document.getElementById('msg');
  btn.disabled=true; msg.className='msg'; msg.textContent='saving…';
  const values={};
  document.querySelectorAll('[data-p]').forEach(el=>{
    if(el.classList.contains('lockbtn'))return;
    values[el.dataset.p]=el.value;
  });
  const r = await (await fetch('/api/save',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({file:cur.file,id:cur.id,values,locked:[...locked]})})).json();
  if(r.ok){
    msg.className='msg ok'; msg.textContent='saved · verified '+r.lastVerified+' · now run npm run validate';
    markets = await (await fetch('/api/markets')).json();
    const m=markets.find(x=>x.file===cur.file);
    cur.c=m.doc.companies.find(x=>x.id===cur.id);
    renderList();
  } else { msg.className='msg err'; msg.textContent='error: '+r.error; }
  btn.disabled=false;
}
boot();
</script></body></html>`;
}
