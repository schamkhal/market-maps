#!/usr/bin/env node
/**
 * Renders README.md into docs.html — the handbook page.
 *
 *   npm run docs
 *
 * The README stays the single source of truth; this only re-skins it, so the
 * hosted handbook can never drift from what is in the repo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const md = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/markets/personal-ai-agents.json'), 'utf8'));
const tpl = fs.readFileSync(path.join(ROOT, 'docs.html'), 'utf8');

const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const inline = s => esc(s)
  .replace(/`([^`]+)`/g,'<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
  .replace(/(^|[\s(])\*([^*]+)\*/g,'$1<em>$2</em>')
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2">$1</a>');
const slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

const lines = md.split('\n'); const out = []; const toc = []; let i = 0;
while (i < lines.length) {
  const l = lines[i];
  if (l.startsWith('```')) { const buf=[]; i++;
    while (i<lines.length && !lines[i].startsWith('```')) { buf.push(lines[i]); i++; } i++;
    out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue; }
  if (/^\|/.test(l)) { const rows=[];
    while (i<lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i++; }
    const cells = r => r.split('|').slice(1,-1).map(c=>c.trim());
    out.push(`<div class="tw"><table><thead><tr>${cells(rows[0]).map(h=>`<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${
      rows.slice(2).map(r=>`<tr>${cells(r).map(c=>`<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    continue; }
  if (/^- /.test(l)) { const it=[];
    while (i<lines.length && /^- /.test(lines[i])) { it.push(lines[i].slice(2)); i++; }
    out.push(`<ul>${it.map(x=>`<li>${inline(x)}</li>`).join('')}</ul>`); continue; }
  if (/^\d+\. /.test(l)) { const it=[];
    while (i<lines.length && /^\d+\. /.test(lines[i])) { it.push(lines[i].replace(/^\d+\. /,'')); i++; }
    out.push(`<ol>${it.map(x=>`<li>${inline(x)}</li>`).join('')}</ol>`); continue; }
  const h = l.match(/^(#{1,3}) (.+)$/);
  if (h) { const lv=h[1].length, t=h[2];
    if (lv===2) toc.push({ t, id: slug(t) });
    out.push(lv===1 ? `<h1>${inline(t)}</h1>` : `<h${lv} id="${slug(t)}">${inline(t)}</h${lv}>`);
    i++; continue; }
  if (l.trim()==='---') { out.push('<hr>'); i++; continue; }
  if (l.trim()==='') { i++; continue; }
  const p=[]; while (i<lines.length && lines[i].trim()!=='' && !/^[#\-|>]|^\d+\.|^```/.test(lines[i])) { p.push(lines[i]); i++; }
  out.push(`<p>${inline(p.join(' '))}</p>`);
}

const today = new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
let page = tpl
  .replace(/(<nav class="toc"><p>Contents<\/p><ol>)[\s\S]*?(<\/ol><\/nav>)/,
           (_,a,b)=>a+toc.map(t=>`<li><a href="#${t.id}">${t.t}</a></li>`).join('')+b)
  .replace(/(<main>)[\s\S]*?(<\/main>)/, (_,a,b)=>a+out.join('\n')+b)
  .replace(/(<p class="eyebrow">Project handbook · updated )[^<]*(<\/p>)/, `$1${today}$2`)
  .replace(/(<div><dt>Companies<\/dt><dd>)\d+(<\/dd><\/div>)/, `$1${doc.companies.length}$2`);
fs.writeFileSync(path.join(ROOT,'docs.html'), page);
console.log(`docs.html rebuilt from README — ${toc.length} sections, ${doc.companies.length} companies.`);
