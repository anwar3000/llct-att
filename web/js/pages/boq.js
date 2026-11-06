// BOQ (bill of quantities) pushed to a project or to particular sites.
// Admin and people with the "push BOQs" permission create / edit them (from Excel, paste or a quotation);
// staff see them in the phone app for their site, print them and load the lines into a service report / delivery note.
import {
  store, canPushBoq, isLimited, watchBoqs, watchProjectsOnly, watchSitesOnly, saveBoq, deleteBoq, listQuotations,
} from '../fb.js';
import { esc, icon, pill, toast, modal, confirmBox, friendlyError, fmtDate, fmtDateTime } from '../util.js';
import { downloadReport } from '../report-lib.js';

let BOQS = null;
let PROJECTS = [];
let SITES = [];

export function mount(el, params, { setHeader }) {
  const subs = [];
  let draw = () => {};
  const refresh = () => draw();
  // Managers / admins already have projects & sites in the store; people with only this permission load them here.
  if (isLimited()) {
    subs.push(watchProjectsOnly((l) => { PROJECTS = l || []; refresh(); }));
    subs.push(watchSitesOnly((l) => { SITES = l || []; refresh(); }));
  } else {
    const sync = () => { PROJECTS = store.projects; SITES = store.sites; };
    sync();
    subs.push(store.on(() => { sync(); refresh(); }));
  }
  subs.push(watchBoqs((l, e) => {
    if (e) { el.innerHTML = `<div class="card card-pad error">Could not load BOQs: ${esc(friendlyError(e))}<br><span class="small">Publish the latest Firestore rules (they add the <b>boqs</b> collection).</span></div>`; return; }
    BOQS = l; refresh();
  }));
  // #/boq/p:<projectId> = the list for one project
  if (params[0]?.startsWith('p:')) { filterProject = params[0].slice(2); params = []; }
  draw = params[0] ? () => detail(el, params[0], setHeader) : () => list(el, setHeader, params);
  draw();
  return () => subs.forEach((u) => { try { u(); } catch { /* */ } });
}

const project = (id) => PROJECTS.find((p) => p.id === id) || null;
const site = (id) => SITES.find((s) => s.id === id) || null;

/** Where a BOQ applies, as text. */
export function boqTarget(b) {
  const p = project(b.projectId);
  const names = b.siteIds.length ? b.siteIds.map((id) => site(id)?.name || b.siteNames[b.siteIds.indexOf(id)] || 'Site') : [];
  if (p || b.projectName) {
    return `${p?.name || b.projectName}${names.length ? ` · ${names.join(', ')}` : ' · all sites'}`;
  }
  return names.length ? names.join(', ') : 'Not linked to a site';
}

function qtyTxt(q) { return Number.isInteger(q) ? String(q) : String(Math.round(q * 1000) / 1000); }

// ------------------------------------------------------------------ list
let filterProject = '';
let q = '';
function list(el, setHeader, params) {
  const can = canPushBoq();
  setHeader('BOQ', 'Bill of quantities pushed to projects and sites — staff print it and load it into their service report or delivery note',
    can ? `<button class="btn" id="b-new">${icon('plus', 16)} New BOQ</button>` : '');
  document.getElementById('b-new')?.addEventListener('click', () => editBoq(null, { projectId: filterProject }));
  if (BOQS == null) { el.innerHTML = '<div class="card card-pad muted">Loading…</div>'; return; }
  const projIds = [...new Set([filterProject, ...BOQS.map((b) => b.projectId)].filter(Boolean))];
  const ql = q.toLowerCase();
  const rows = BOQS.filter((b) => (!filterProject || b.projectId === filterProject)
    && (!ql || `${b.title} ${b.ref} ${b.client} ${boqTarget(b)} ${b.items.map((i) => i.name).join(' ')}`.toLowerCase().includes(ql)));
  el.innerHTML = `
    <div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:14px">
      <input id="b-q" placeholder="Search title, ref, client, site, item…" value="${esc(q)}" style="flex:1;min-width:220px">
      <select id="b-p" style="max-width:280px">
        <option value="">All projects (${BOQS.length})</option>
        ${projIds.map((id) => `<option value="${id}" ${filterProject === id ? 'selected' : ''}>${esc(project(id)?.name || BOQS.find((b) => b.projectId === id)?.projectName || 'Project')}</option>`).join('')}
      </select>
    </div>
    ${rows.length ? `<div class="grid cols-3">${rows.map(card).join('')}</div>` : `
    <div class="card empty"><b>${BOQS.length ? 'No BOQ matches' : 'No BOQ yet'}</b>
      ${can ? 'Push a BOQ to a project or site — import it from Excel, paste it, or start from a quotation in LLCT Invoicing.<br><br><button class="btn" data-new>' + icon('plus', 16) + ' New BOQ</button>' : 'Admin pushes the BOQ for a project or site here.'}</div>`}`;
  const qi = el.querySelector('#b-q');
  qi.oninput = () => { q = qi.value; const pos = qi.selectionStart; list(el, setHeader, params); const n = el.querySelector('#b-q'); n.focus(); n.setSelectionRange(pos, pos); };
  el.querySelector('#b-p').onchange = (e) => { filterProject = e.target.value; list(el, setHeader, params); };
  el.querySelector('[data-new]')?.addEventListener('click', () => editBoq(null, { projectId: filterProject }));
}

function card(b) {
  const lines = b.items.filter((i) => i.name || i.desc).length;
  return `<a class="card card-pad boq-card" href="#/boq/${b.id}" style="color:inherit;display:block">
    <div class="row between" style="gap:8px;align-items:flex-start">
      <h2 style="margin:0;font-size:16px">${esc(b.title)}</h2>
      ${pill(`${lines} line${lines === 1 ? '' : 's'}`, 'blue')}
    </div>
    <div class="small" style="margin-top:6px">${icon('site', 14)} ${esc(boqTarget(b))}</div>
    ${b.client || b.ref ? `<div class="small muted" style="margin-top:3px">${esc([b.client, b.ref && `Ref ${b.ref}`].filter(Boolean).join(' · '))}</div>` : ''}
    <div class="small muted" style="margin-top:10px">Updated ${b.updatedAt ? fmtDate(b.updatedAt) : '—'}${b.updatedBy ? ` by ${esc(b.updatedBy)}` : ''}</div>
  </a>`;
}

// ------------------------------------------------------------------ detail
function detail(el, id, setHeader) {
  if (BOQS == null) { el.innerHTML = '<div class="card card-pad muted">Loading…</div>'; return; }
  const b = BOQS.find((x) => x.id === id);
  if (!b) { el.innerHTML = '<div class="card empty"><b>BOQ not found</b><a href="#/boq">Back to BOQ</a></div>'; return; }
  const can = canPushBoq();
  setHeader(b.title, `<a href="#/boq">BOQ</a> · ${esc(boqTarget(b))}`, `
    <button class="btn ghost" id="b-pdf">${icon('download', 16)} PDF</button>
    <button class="btn ghost" id="b-xls">${icon('download', 16)} Excel</button>
    ${can ? `<button class="btn ghost" id="b-dup">${icon('copy', 16)} Duplicate</button><button class="btn" id="b-edit">${icon('edit', 16)} Edit</button>` : ''}`);
  let n = 0;
  el.innerHTML = `
    <div class="grid cols-4" style="margin-bottom:14px">
      ${[['Project', b.projectName || project(b.projectId)?.name || '—'], ['Sites', b.siteIds.length ? boqTarget(b).split(' · ').pop() : (b.projectId ? 'All sites of the project' : '—')],
        ['Client', b.client || '—'], ['Reference', b.ref || '—']].map(([k, v]) => `<div class="card card-pad"><div class="small muted">${k}</div><b>${esc(v)}</b></div>`).join('')}
    </div>
    ${b.notes ? `<div class="card card-pad" style="margin-bottom:14px;white-space:pre-wrap">${esc(b.notes)}</div>` : ''}
    <div class="card"><div class="table-wrap"><table class="t boq-table">
      <thead><tr><th style="width:48px">#</th><th>Item</th><th>Description</th><th class="num" style="width:80px">Qty</th><th style="width:80px">Unit</th></tr></thead>
      <tbody>${b.items.map((i) => (i.section && !i.name && !i.desc
        ? `<tr class="boq-sec"><td colspan="5">${esc(i.section)}</td></tr>`
        : `<tr><td class="muted">${++n}</td><td><b>${esc(i.name)}</b>${i.section ? `<div class="small muted">${esc(i.section)}</div>` : ''}</td><td class="small">${esc(i.desc)}</td><td class="num">${qtyTxt(i.qty)}</td><td>${esc(i.unit)}</td></tr>`)).join('')
        || '<tr><td colspan="5" class="muted" style="text-align:center">No lines</td></tr>'}</tbody>
    </table></div></div>
    <div class="small muted" style="margin-top:10px">Updated ${b.updatedAt ? fmtDateTime(b.updatedAt) : '—'}${b.updatedBy ? ` by ${esc(b.updatedBy)}` : ''}
      ${can ? ` · <a href="javascript:void 0" id="b-del" style="color:#D64545">Delete this BOQ</a>` : ''}</div>`;
  const run = (fmt) => downloadReport(boqReport(b), fmt).catch((e) => toast(friendlyError(e), true));
  document.getElementById('b-pdf').onclick = () => run('pdf');
  document.getElementById('b-xls').onclick = () => run('xlsx');
  document.getElementById('b-edit')?.addEventListener('click', () => editBoq(b));
  document.getElementById('b-dup')?.addEventListener('click', () => editBoq({ ...b, id: null, title: `${b.title} (copy)` }));
  el.querySelector('#b-del')?.addEventListener('click', async () => {
    if (!await confirmBox('Delete BOQ', `Delete “${b.title}”? Staff will no longer see it. Reports already made from it are not affected.`, { ok: 'Delete', danger: true })) return;
    try { await deleteBoq(b.id); toast('BOQ deleted'); location.hash = '#/boq'; } catch (e) { toast(friendlyError(e), true); }
  });
}

export function boqReport(b) {
  let n = 0;
  const rows = [];
  for (const i of b.items) {
    if (i.section && !i.name && !i.desc) { rows.push(['', i.section.toUpperCase(), '', '', '']); continue; }
    rows.push([++n, i.name, i.desc, qtyTxt(i.qty), i.unit]);
  }
  const summary = [['BOQ', b.title], ['Project', b.projectName || project(b.projectId)?.name || ''], ['Site(s)', boqTarget(b)],
    ['Client', b.client], ['Reference', b.ref], ['Notes', b.notes], ['Updated', `${b.updatedAt ? fmtDateTime(b.updatedAt) : ''} ${b.updatedBy}`.trim()]]
    .filter((r) => r[1]);
  return {
    title: `BOQ — ${b.title}`,
    subtitle: [b.projectName || project(b.projectId)?.name, b.client, b.ref && `Ref ${b.ref}`].filter(Boolean).join('  ·  '),
    filename: `BOQ_${b.title.replace(/[^\w-]+/g, '_').slice(0, 60)}`,
    sheets: [
      { name: 'Details', columns: ['Item', 'Value'], widths: [16, 70], rows: summary },
      { name: 'Bill of quantities', columns: ['#', 'Item', 'Description', 'Qty', 'Unit'], widths: [5, 34, 60, 8, 8], rows },
    ],
  };
}

// ------------------------------------------------------------------ import helpers
const HEAD = {
  section: /^(section|group|category|system|area|location)$/i,
  name: /^(item|items|item name|product|material|model|part|part no\.?|model no\.?|equipment|item description)$/i,
  desc: /(desc|particular|specification|spec|details|scope|remarks?)/i,
  qty: /^(qty|qnty|quantity|qty\.|no\.? of units|nos?)$/i,
  unit: /^(unit|units|uom|u\/m)$/i,
};
/** Turns spreadsheet rows (arrays) into BOQ lines: finds the header row, maps the columns, keeps section headings. */
export function rowsToItems(rows) {
  rows = rows.map((r) => (r || []).map((c) => String(c ?? '').trim())).filter((r) => r.some(Boolean));
  if (!rows.length) return [];
  let hi = -1;
  const col = {};
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const m = {};
    rows[r].forEach((c, i) => {
      for (const [k, re] of Object.entries(HEAD)) if (m[k] == null && re.test(c)) { m[k] = i; break; }
    });
    if (m.qty != null && (m.name != null || m.desc != null)) { hi = r; Object.assign(col, m); break; }
  }
  if (hi < 0) {
    // No header: first text column = item, next text column = description, first number column after it = qty, then unit.
    const sample = rows.slice(0, 20);
    const width = Math.max(...sample.map((r) => r.length));
    const isNum = (i) => sample.filter((r) => r[i]).every((r) => /^[\d.,]+$/.test(r[i])) && sample.some((r) => r[i]);
    const isSerial = (i) => isNum(i) && sample.filter((r) => r[i]).every((r, k) => Number(r[i]) === k + 1);
    const text = [...Array(width).keys()].filter((i) => !isNum(i));
    const nums = [...Array(width).keys()].filter((i) => isNum(i) && !isSerial(i));
    col.name = text[0];
    if (text[1] != null && text[1] < (nums[0] ?? 99)) col.desc = text[1];
    col.qty = nums[0];
    if (col.qty != null && text.find((i) => i > col.qty) != null) col.unit = text.find((i) => i > col.qty);
  }
  const get = (r, k) => (col[k] == null ? '' : r[col[k]] || '');
  const out = [];
  let section = '';
  for (const r of rows.slice(hi + 1)) {
    let name = get(r, 'name');
    let desc = get(r, 'desc');
    if (!name && desc) { name = desc; desc = ''; }
    if (name && desc && name === desc) desc = '';
    const qtyRaw = get(r, 'qty').replace(/,/g, '');
    const qty = Number(qtyRaw);
    if (/^(sub[ -]?)?total|grand total|vat\b/i.test(name)) continue;
    if (name && !qtyRaw && !get(r, 'unit')) {
      // A line with text only is a heading ("CCTV SYSTEM", "Network").
      section = name; out.push({ section, name: '', desc: '', qty: 0, unit: '' }); continue;
    }
    if (!name) continue;
    out.push({ section: get(r, 'section') || '', name, desc, qty: Number.isFinite(qty) ? qty : 0, unit: get(r, 'unit') || 'pcs' });
  }
  return out;
}

async function fileRows(file) {
  await (window.__libs || 0); // Excel / PDF / ZIP libraries load in the background after start
  const XLSX = window.XLSX;
  if (!XLSX) throw new Error('Excel library did not load — check your internet connection.');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
}

function quotationPicker() {
  return new Promise((resolve) => {
    let all = null;
    const m = modal({
      title: 'Start from a quotation',
      wide: true,
      body: `<input id="qp-q" placeholder="Search number, client, subject…" style="width:100%;margin-bottom:10px">
        <div id="qp-l" style="max-height:55vh;overflow:auto"><div class="muted">Loading quotations…</div></div>`,
      onMount(root, close) {
        const box = root.querySelector('#qp-l');
        const draw = () => {
          const ql = root.querySelector('#qp-q').value.trim().toLowerCase();
          const l = (all || []).filter((d) => !ql || `${d.number} ${d.client?.name || ''} ${d.subject || ''} ${d.ref || ''}`.toLowerCase().includes(ql))
            .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 150);
          box.innerHTML = l.length ? l.map((d) => `<button class="qp-row" data-id="${d.id}">
              <b>${esc(d.number || '—')}</b> <span>${esc(d.client?.name || 'No client')}</span>
              <span class="small muted">${esc(d.date || '')} · ${(d.items || []).length} lines${d.subject ? ` · ${esc(d.subject)}` : ''}${d.status ? ` · ${esc(d.status)}` : ''}</span></button>`).join('')
            : '<div class="muted">No quotations found.</div>';
          box.querySelectorAll('[data-id]').forEach((b) => { b.onclick = () => { close(); resolve(all.find((d) => d.id === b.dataset.id)); }; });
        };
        root.querySelector('#qp-q').oninput = draw;
        listQuotations().then((l) => { all = l; draw(); })
          .catch((e) => { box.innerHTML = `<div class="error">Could not load quotations: ${esc(friendlyError(e))}</div>`; });
        root.querySelector('[data-x]').addEventListener('click', () => resolve(null));
      },
    });
    m.el.addEventListener('mousedown', (e) => { if (e.target === m.el) resolve(null); });
  });
}

// ------------------------------------------------------------------ editor
export function editBoq(b, preset = {}) {
  const isNew = !b?.id;
  const st = {
    title: b?.title || '', ref: b?.ref || '', projectId: b?.projectId ?? preset.projectId ?? '', client: b?.client || '',
    clientId: b?.clientId || '', clientSnap: b?.clientSnap || null, notes: b?.notes || '', source: b?.source || '',
    siteIds: new Set(b?.siteIds || preset.siteIds || []),
    items: (b?.items || []).map((i) => ({ ...i })),
  };
  if (!st.items.length) st.items.push({ section: '', name: '', desc: '', qty: 1, unit: 'pcs' });
  if (st.projectId && !st.client) st.client = project(st.projectId)?.client || '';

  modal({
    title: isNew ? 'New BOQ' : `Edit ${b.title}`,
    wide: true,
    body: `<form id="bf" class="boq-ed">
      <div class="fields">
        <label class="f"><span>BOQ title *</span><input name="title" required value="${esc(st.title)}" placeholder="e.g. CCTV — Phase 1"></label>
        <label class="f"><span>Reference (quotation / LPO)</span><input name="ref" value="${esc(st.ref)}"></label>
        <label class="f"><span>Project</span><select name="projectId"><option value="">— No project (pick sites) —</option>
          ${PROJECTS.map((p) => `<option value="${p.id}" ${st.projectId === p.id ? 'selected' : ''}>${esc(p.name)}${p.code ? ` (${esc(p.code)})` : ''}</option>`).join('')}</select></label>
        <label class="f"><span>Client</span><input name="client" value="${esc(st.client)}"></label>
        <div class="f full"><span>Sites</span><div id="bf-sites" class="boq-sites"></div></div>
        <label class="f full"><span>Notes for site staff</span><textarea name="notes" rows="2">${esc(st.notes)}</textarea></label>
      </div>
      <div class="row between" style="margin:14px 0 6px;flex-wrap:wrap;gap:8px">
        <b>Lines <span class="muted small" id="bf-n"></span></b>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          <button type="button" class="btn ghost sm" id="bf-quo">${icon('doc', 15)} From quotation</button>
          <button type="button" class="btn ghost sm" id="bf-xls">${icon('upload', 15)} Import Excel / CSV</button>
          <button type="button" class="btn ghost sm" id="bf-paste">${icon('copy', 15)} Paste from Excel</button>
          <input type="file" id="bf-file" accept=".xlsx,.xls,.csv" hidden>
        </div>
      </div>
      <div class="table-wrap boq-lines"><table class="t">
        <thead><tr><th style="width:26px"></th><th style="width:16%">Section</th><th style="width:26%">Item *</th><th>Description</th><th style="width:72px">Qty</th><th style="width:72px">Unit</th><th style="width:34px"></th></tr></thead>
        <tbody id="bf-rows"></tbody></table></div>
      <div class="row" style="gap:8px;margin-top:8px">
        <button type="button" class="btn ghost sm" id="bf-add">${icon('plus', 15)} Add line</button>
        <button type="button" class="btn ghost sm" id="bf-head">${icon('plus', 15)} Add heading</button>
        <button type="button" class="btn ghost sm" id="bf-clear" style="margin-left:auto">Clear all lines</button>
      </div>
      <div class="error" id="bf-err"></div></form>`,
    foot: `<button class="btn ghost" data-cancel>Cancel</button><button class="btn" data-save>${icon('check', 16)} ${isNew ? 'Push BOQ' : 'Save changes'}</button>`,
    onMount(root, close) {
      const f = root.querySelector('#bf');
      root.querySelector('[data-cancel]').onclick = close;

      const drawSites = () => {
        const pid = f.projectId.value;
        const p = project(pid);
        const box = root.querySelector('#bf-sites');
        const pool = p ? SITES.filter((s) => p.siteIds.includes(s.id) || s.projectId === p.id) : SITES.filter((s) => s.active !== false);
        // keep only sites that still belong to the pool
        [...st.siteIds].forEach((id) => { if (!pool.some((s) => s.id === id)) st.siteIds.delete(id); });
        box.innerHTML = `${p ? `<label class="chip ${st.siteIds.size ? '' : 'on'}" data-all>All sites of this project (${pool.length})</label>` : ''}
          ${pool.map((s) => `<label class="chip ${st.siteIds.has(s.id) ? 'on' : ''}" data-s="${s.id}">${esc(s.name)}</label>`).join('')
            || `<span class="small muted">${p ? 'This project has no sites yet — staff will see the BOQ under the project once sites are linked.' : 'No sites.'}</span>`}`;
        if (!p && pool.length > 40) box.classList.add('scroll'); else box.classList.remove('scroll');
        box.querySelector('[data-all]')?.addEventListener('click', () => { st.siteIds.clear(); drawSites(); });
        box.querySelectorAll('[data-s]').forEach((c) => {
          c.onclick = () => { const id = c.dataset.s; if (st.siteIds.has(id)) st.siteIds.delete(id); else st.siteIds.add(id); drawSites(); };
        });
      };
      f.projectId.onchange = () => {
        const p = project(f.projectId.value);
        if (p && !f.client.value.trim()) f.client.value = p.client || '';
        drawSites();
      };

      const tbody = root.querySelector('#bf-rows');
      const read = () => {
        tbody.querySelectorAll('tr[data-i]').forEach((tr) => {
          const it = st.items[Number(tr.dataset.i)];
          tr.querySelectorAll('[data-f]').forEach((inp) => { it[inp.dataset.f] = inp.dataset.f === 'qty' ? Number(inp.value) || 0 : inp.value; });
        });
      };
      const drawRows = () => {
        let no = 0;
        tbody.innerHTML = st.items.map((i, k) => {
          const head = i.section && !i.name && !i.desc && i.qty === 0;
          return head
            ? `<tr data-i="${k}" class="boq-sec"><td class="muted">${icon('menu', 14)}</td><td colspan="5"><input data-f="section" value="${esc(i.section)}" placeholder="Heading, e.g. CCTV SYSTEM" style="font-weight:700"></td>
               <td><button type="button" class="btn ghost icon sm" data-rm="${k}" title="Remove">${icon('close', 14)}</button></td></tr>`
            : `<tr data-i="${k}"><td class="muted small">${++no}</td>
              <td><input data-f="section" value="${esc(i.section)}"></td>
              <td><input data-f="name" value="${esc(i.name)}"></td>
              <td><textarea data-f="desc" rows="1">${esc(i.desc)}</textarea></td>
              <td><input data-f="qty" type="number" step="any" min="0" value="${esc(i.qty)}"></td>
              <td><input data-f="unit" value="${esc(i.unit)}" list="boq-units"></td>
              <td><button type="button" class="btn ghost icon sm" data-rm="${k}" title="Remove">${icon('close', 14)}</button></td></tr>`;
        }).join('') + '<datalist id="boq-units"><option>pcs<option>nos<option>set<option>lot<option>m<option>roll<option>box<option>job</datalist>';
        root.querySelector('#bf-n').textContent = `(${st.items.filter((i) => i.name).length} items)`;
        tbody.querySelectorAll('[data-rm]').forEach((x) => { x.onclick = () => { read(); st.items.splice(Number(x.dataset.rm), 1); drawRows(); }; });
        tbody.querySelectorAll('[data-f="name"]').forEach((x) => { x.oninput = () => { root.querySelector('#bf-n').textContent = ''; }; });
      };
      const blankOnly = () => st.items.every((i) => !i.name && !i.desc && !i.section);
      const addItems = async (items, what) => {
        if (!items.length) { toast(`No lines found in the ${what}.`, true); return; }
        read();
        let replace = blankOnly();
        if (!replace) {
          replace = await confirmBox('Replace or add?', `The BOQ already has lines. Replace them with the ${items.length} lines from the ${what}? (Cancel adds them at the end.)`, { ok: 'Replace' });
        }
        st.items = replace ? items : [...st.items.filter((i) => i.name || i.desc || i.section), ...items];
        drawRows();
        toast(`${items.length} lines from the ${what}`);
      };

      root.querySelector('#bf-add').onclick = () => { read(); st.items.push({ section: '', name: '', desc: '', qty: 1, unit: 'pcs' }); drawRows(); tbody.querySelector('tr:last-child [data-f="name"]')?.focus(); };
      root.querySelector('#bf-head').onclick = () => { read(); st.items.push({ section: 'New heading', name: '', desc: '', qty: 0, unit: '' }); drawRows(); tbody.querySelector('tr:last-child [data-f="section"]')?.select(); };
      root.querySelector('#bf-clear').onclick = () => { st.items = [{ section: '', name: '', desc: '', qty: 1, unit: 'pcs' }]; drawRows(); };
      const fileIn = root.querySelector('#bf-file');
      root.querySelector('#bf-xls').onclick = () => fileIn.click();
      fileIn.onchange = async () => {
        const file = fileIn.files[0]; fileIn.value = '';
        if (!file) return;
        try { await addItems(rowsToItems(await fileRows(file)), 'file'); if (!f.title.value.trim()) f.title.value = file.name.replace(/\.[^.]+$/, ''); st.source = st.source || 'excel'; } catch (e) { toast(friendlyError(e), true); }
      };
      root.querySelector('#bf-paste').onclick = () => {
        modal({
          title: 'Paste from Excel',
          wide: true,
          body: `<p class="small muted" style="margin-top:0">Copy the rows in Excel (with the header row: Item / Description / Qty / Unit) and paste them here. Rows with text only become headings.</p>
            <textarea id="pp" rows="12" style="width:100%;font-family:monospace;font-size:12px" placeholder="Item&#9;Description&#9;Qty&#9;Unit"></textarea>`,
          foot: '<button class="btn" data-ok>Use these lines</button>',
          onMount(r2, close2) {
            r2.querySelector('#pp').focus();
            r2.querySelector('[data-ok]').onclick = async () => {
              const rows = r2.querySelector('#pp').value.split(/\r?\n/).map((l) => (l.includes('\t') ? l.split('\t') : l.split(/\s{2,}|,(?=\S)/)));
              close2();
              st.source = st.source || 'paste';
              await addItems(rowsToItems(rows), 'pasted rows');
            };
          },
        });
      };
      root.querySelector('#bf-quo').onclick = async () => {
        const d = await quotationPicker();
        if (!d) return;
        const items = (d.items || []).filter((i) => i && (i.name || i.desc)).map((i) => ({
          section: '', name: String(i.name || i.desc || ''), desc: i.name ? String(i.desc || '') : '', qty: Number(i.qty) || 0, unit: String(i.unit || 'pcs'),
        }));
        await addItems(items, `quotation ${d.number || ''}`.trim());
        if (!f.ref.value.trim()) f.ref.value = d.number || '';
        if (!f.title.value.trim()) f.title.value = d.subject || `BOQ ${d.number || ''}`.trim();
        if (d.client?.name) { f.client.value = d.client.name; st.clientId = d.clientId || ''; st.clientSnap = d.client; }
        st.source = `quotation:${d.number || d.id}`;
      };

      root.querySelector('[data-save]').onclick = async () => {
        const err = root.querySelector('#bf-err');
        err.textContent = '';
        read();
        const title = f.title.value.trim();
        if (!title) { err.textContent = 'Enter a BOQ title.'; return; }
        const pid = f.projectId.value;
        if (!pid && !st.siteIds.size) { err.textContent = 'Choose a project or at least one site, so staff can find the BOQ.'; return; }
        const items = st.items.filter((i) => i.name || i.desc || i.section);
        if (!items.some((i) => i.name || i.desc)) { err.textContent = 'Add at least one line.'; return; }
        const bad = items.findIndex((i) => !i.name && i.desc);
        if (bad >= 0) items[bad].name = items[bad].desc;
        const p = project(pid);
        const ids = [...st.siteIds];
        const btn = root.querySelector('[data-save]');
        btn.disabled = true;
        try {
          if (f.client.value.trim() !== (st.clientSnap?.name || '')) { st.clientId = ''; st.clientSnap = null; }
          const id = await saveBoq(isNew ? null : b.id, {
            title, ref: f.ref.value.trim(), projectId: pid, projectName: p?.name || '', client: f.client.value.trim(),
            clientId: st.clientId || '', clientSnap: st.clientSnap || null,
            siteIds: ids, siteNames: ids.map((x) => site(x)?.name || ''), items, notes: f.notes.value.trim(), source: st.source || 'manual',
          });
          close();
          toast(isNew ? 'BOQ pushed — staff can see it in the app' : 'BOQ saved');
          location.hash = `#/boq/${id}`;
        } catch (e) { btn.disabled = false; err.textContent = friendlyError(e); }
      };

      drawSites();
      drawRows();
    },
  });
}
