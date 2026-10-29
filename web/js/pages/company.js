// Company documents: LLCT trade license, Abu Dhabi trade license, Chamber of Commerce, WC insurance…
// plus additional documents with their own heading. Numbers, issue / expiry dates and copies (photo or PDF, max 2 MB).
import {
  COMPANY_DOC_TYPES, watchCompanyDocs, watchCompanyFiles, saveCompanyDoc, uploadCompanyFile, readCompanyFile,
  deleteCompanyFile, deleteCompanyDoc, companyDueState, daysUntil,
} from '../fb.js';
import { esc, icon, pill, toast, modal, confirmBox, friendlyError, fmtDate, parseKey, dateKey } from '../util.js';
import { prepareFile, chooseFile, askHeading, b64ToBlob, pdfThumb } from '../iddocs.js';
import { saveBlob } from '../report-lib.js';
import { readDocInfo } from '../docread.js';

const cache = new Map();
const bytes = (f) => {
  if (!cache.has(f.id)) cache.set(f.id, readCompanyFile(f).catch((e) => { cache.delete(f.id); throw e; }));
  return cache.get(f.id);
};
const isImg = (f) => f.mime.startsWith('image/');
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'document';
const ext = (f) => (f.mime === 'application/pdf' ? 'pdf' : f.mime === 'image/png' ? 'png' : 'jpg');
const fmtD = (v) => (v ? fmtDate(parseKey(v)) : '');

/** Company documents: reminder 15 days before expiry. */
const dueState = (exp) => companyDueState(exp);
function statusPill(exp) {
  const s = dueState(exp);
  if (!s) return '';
  const n = daysUntil(exp);
  return s === 'expired' ? pill(`Expired ${fmtD(exp)}`, 'red') : s === 'soon' ? pill(n === 0 ? 'Expires today' : `Expires in ${n} d`, 'amber') : pill(`Valid to ${fmtD(exp)}`, 'green');
}

async function viewFile(f, title) {
  try {
    const b64 = await bytes(f);
    const blob = b64ToBlob(b64, f.mime);
    if (isImg(f)) {
      modal({ title, wide: true, body: `<img src="data:${f.mime};base64,${b64}" style="width:100%;border-radius:10px">`,
        foot: `<button class="btn" data-dl>${icon('download', 16)} Download</button>`,
        onMount: (m) => { m.querySelector('[data-dl]').onclick = () => saveBlob(blob, `${safe(title)}.${ext(f)}`); } });
    } else {
      const w = window.open(URL.createObjectURL(blob), '_blank');
      if (!w) saveBlob(blob, `${safe(title)}.${ext(f)}`);
    }
  } catch (e) { toast(friendlyError(e), true); }
}

export function mount(el, _p, { setHeader }) {
  setHeader('Company documents', 'Trade licenses, Chamber of Commerce, WC insurance and more — numbers, expiry dates and copies',
    `<button class="btn" id="cd-add">${icon('plus', 16)} Additional document</button>
     <button class="btn ghost" id="cd-read" title="Fill empty numbers and expiry dates from the uploaded copies">🔍 Read numbers from copies</button>
     <button class="btn ghost" id="cd-zip">${icon('download', 16)} Download all (ZIP)</button>`);
  let docs = null, files = null, err = null;

  const entries = () => {
    const std = COMPANY_DOC_TYPES.map((t) => {
      const d = docs.find((x) => x.id === t.key);
      return { id: t.key, key: t.key, title: d?.title || t.label, doc: d || null, custom: false };
    });
    const keys = new Set(COMPANY_DOC_TYPES.map((t) => t.key));
    const add = docs.filter((d) => !keys.has(d.id)).sort((a, b) => a.title.localeCompare(b.title))
      .map((d) => ({ id: d.id, key: d.key, title: d.title, doc: d, custom: true }));
    return { std, add };
  };
  const filesOf = (id) => files.filter((f) => f.docId === id);

  async function upload(e) {
    const file = await chooseFile();
    if (!file) return;
    try {
      const p = await prepareFile(file);
      if (!e.doc) await saveCompanyDoc({ id: e.id, key: e.key, title: e.title, custom: e.custom });
      await uploadCompanyFile({ docId: e.id, name: `${safe(e.title)}.${p.mime === 'application/pdf' ? 'pdf' : 'jpg'}`, mime: p.mime, base64: p.base64 });
      toast(`${e.title} uploaded`);
      // Read the number / dates from the copy and ask to confirm them if any are missing.
      if (!e.doc?.number || !e.doc?.expiry) {
        toast('Reading number & expiry from the document…');
        const found = await readDocInfo(p, e.key || 'company');
        edit({ ...e, doc: e.doc || null }, found);
      }
    } catch (x) { toast(friendlyError(x), true); }
  }

  /** Reads the latest copy of a document and opens the details with what was found. */
  async function readFromCopy(e) {
    const fl = filesOf(e.id);
    if (!fl.length) { toast('Upload a copy first'); return; }
    toast('Reading the document…');
    const f = fl[fl.length - 1];
    try {
      const found = await readDocInfo({ mime: f.mime, base64: await bytes(f) }, e.key || 'company');
      if (!found.number && !found.expiry && !found.issue) { toast('Could not read a number or date from this copy — type them in.', true); }
      edit(e, found, true);
    } catch (x) { toast(friendlyError(x), true); }
  }

  /** Fills empty numbers / dates of every document from its copies. */
  async function fillAll() {
    const { std, add } = entries();
    const todo = [...std, ...add].filter((e) => filesOf(e.id).length && (!e.doc?.number || !e.doc?.expiry));
    if (!todo.length) { toast('Every document with a copy already has its number and expiry.'); return; }
    const btn = document.getElementById('cd-read');
    btn.disabled = true;
    const filled = [];
    try {
      for (let n = 0; n < todo.length; n++) {
        const e = todo[n];
        btn.textContent = `Reading ${n + 1}/${todo.length}…`;
        const d = e.doc || {};
        const found = { number: '', expiry: '', issue: '' };
        for (const f of [...filesOf(e.id)].reverse()) {
          const r = await readDocInfo({ mime: f.mime, base64: await bytes(f) }, e.key || 'company');
          for (const k of Object.keys(found)) if (!found[k] && r[k]) found[k] = r[k];
          if (found.number && found.expiry) break;
        }
        const upd = { number: d.number || found.number, expiry: d.expiry || found.expiry, issueDate: d.issueDate || found.issue };
        if (upd.number !== (d.number || '') || upd.expiry !== (d.expiry || '') || upd.issueDate !== (d.issueDate || '')) {
          await saveCompanyDoc({ id: e.id, key: e.key, title: e.title, notes: d.notes || '', custom: e.custom, ...upd });
          filled.push(`${e.title}: ${[upd.number !== (d.number || '') && `no. ${upd.number}`, upd.expiry !== (d.expiry || '') && `expiry ${fmtD(upd.expiry)}`].filter(Boolean).join(', ') || 'issue date'}`);
        }
      }
      modal({ title: 'Read from copies', body: filled.length
        ? `<p style="margin-top:0">Filled in — please check:</p><ul>${filled.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
        : '<p style="margin:0">Nothing new found — the copies may not be clear enough to read. Type the numbers in with <b>Number & dates</b>.</p>' });
    } catch (x) { toast(friendlyError(x), true); }
    btn.disabled = false; btn.innerHTML = '🔍 Read numbers from copies';
  }

  function edit(e, found = null, preferFound = false) {
    const d0 = e.doc || {};
    // Fill empty boxes with what was read from the document (or replace, when asked to read again).
    const pick = (cur, got) => (preferFound ? got || cur : cur || got) || '';
    const d = found ? { ...d0, number: pick(d0.number, found.number), expiry: pick(d0.expiry, found.expiry), issueDate: pick(d0.issueDate, found.issue) } : d0;
    const read = found && ((found.number && d.number === found.number && d.number !== d0.number) || (found.expiry && d.expiry === found.expiry && d.expiry !== d0.expiry) || (found.issue && d.issueDate === found.issue && d.issueDate !== d0.issueDate));
    const mark = (k) => (found && d[k] && d[k] !== (d0[k] || '') ? ' class="auto-read"' : '');
    modal({
      title: e.title,
      body: `<div class="fields">
        ${e.custom ? `<label class="f full"><span>Heading</span><input name="title" value="${esc(e.title)}"></label>` : ''}
        ${read ? '<div class="full small" style="background:#fff8e6;border-radius:8px;padding:8px 10px">🔍 Highlighted boxes were read from the document — please check them before saving.</div>' : ''}
        <label class="f full"><span>Number (license / policy / certificate no.)</span><input name="number"${mark('number')} value="${esc(d.number || '')}"></label>
        <label class="f"><span>Issue date</span><input type="date" name="issueDate"${mark('issueDate')} value="${esc(d.issueDate || '')}"></label>
        <label class="f"><span>Expiry date</span><input type="date" name="expiry"${mark('expiry')} value="${esc(d.expiry || '')}"></label>
        <label class="f full"><span>Notes</span><input name="notes" value="${esc(d.notes || '')}"></label></div>`,
      foot: '<button class="btn ghost" data-no>Cancel</button><button class="btn" data-yes>Save</button>',
      onMount: (m, close) => {
        m.querySelector('[data-no]').onclick = close;
        m.querySelector('[data-yes]').onclick = async () => {
          const v = (n) => (m.querySelector(`[name=${n}]`)?.value || '').trim();
          try {
            await saveCompanyDoc({ id: e.id, key: e.key, title: (e.custom && v('title')) || e.title, number: v('number'),
              issueDate: v('issueDate'), expiry: v('expiry'), notes: v('notes'), custom: e.custom });
            toast('Saved'); close();
          } catch (x) { toast(friendlyError(x), true); }
        };
      },
    });
  }

  async function addAdditional() {
    const title = await askHeading('Additional company document', ['ISO certificate', 'Bank letter', 'Civil defence certificate', 'Municipality approval', 'Vehicle registration', 'Owner passport']);
    if (!title) return;
    try {
      const id = await saveCompanyDoc({ title, custom: true });
      await upload({ id, key: '', title, doc: { id }, custom: true });
    } catch (x) { toast(friendlyError(x), true); }
  }

  async function zipAll() {
    if (!window.JSZip) { toast('ZIP library did not load — reload the page.', true); return; }
    if (!files?.length) { toast('No files uploaded yet'); return; }
    const { std, add } = entries();
    const zip = new window.JSZip();
    const rows = [['Document', 'Number', 'Issue date', 'Expiry date', 'Status', 'Files', 'Notes']];
    toast('Preparing ZIP…');
    try {
      for (const e of [...std, ...add]) {
        const fl = filesOf(e.id);
        for (let i = 0; i < fl.length; i++) zip.file(`${safe(e.title)}${fl.length > 1 ? ` ${i + 1}` : ''}.${ext(fl[i])}`, await bytes(fl[i]), { base64: true });
        const d = e.doc || {};
        const st = dueState(d.expiry);
        rows.push([e.title, d.number || '', d.issueDate || '', d.expiry || '', { expired: 'Expired', soon: 'Expiring', ok: 'Valid' }[st] || '', fl.length, d.notes || '']);
      }
      if (window.XLSX) {
        const ws = window.XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [{ wch: 40 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 6 }, { wch: 40 }];
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, 'Company documents');
        zip.file('Company documents list.xlsx', window.XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
      }
      saveBlob(await zip.generateAsync({ type: 'blob' }), `LLCT company documents-${dateKey(new Date())}.zip`);
    } catch (x) { toast(friendlyError(x), true); }
  }

  const card = (e) => {
    const fl = filesOf(e.id);
    const d = e.doc || {};
    const info = `<span class="cd-kv"><span>DOC NO.</span><b class="mono">${esc(d.number || '—')}</b></span>
      <span class="cd-kv"><span>EXPIRY</span><b>${esc(d.expiry ? fmtD(d.expiry) : '—')}</b></span>
      ${d.issueDate ? `<span class="cd-kv"><span>ISSUED</span><b>${esc(fmtD(d.issueDate))}</b></span>` : ''}
      ${!d.number || !d.expiry ? `<a href="javascript:void 0" class="small" data-ed="${esc(e.id)}">+ Add number & expiry</a>` : ''}`;
    return `<div class="slot ${fl.length ? 'has' : ''}" data-e="${esc(e.id)}" style="grid-template-columns:1fr auto">
      <div class="slot-main">
        <div class="row" style="gap:8px"><span class="slot-t">${esc(e.title.toUpperCase())}</span>${statusPill(d.expiry)}</div>
        <div class="cd-info">${info}</div>${d.notes ? `<div class="small muted">${esc(d.notes)}</div>` : ''}
        <div class="row" style="gap:8px;margin-top:8px">${fl.map((f, i) => `<div class="slot-th cd-th" data-view="${f.id}" title="${esc(e.title)} ${i + 1} — click to view">${isImg(f) ? '' : '<b>PDF</b>'}
            <button class="x" data-delf="${f.id}" title="Delete file">${icon('close', 11)}</button></div>`).join('')}
          ${fl.length ? '' : '<span class="small red-t">Not uploaded</span>'}</div>
      </div>
      <div class="slot-act" style="flex-direction:column;align-items:stretch">
        <button class="btn sm" data-up="${esc(e.id)}">${icon('upload', 14)} Upload</button>
        <button class="btn sm ghost" data-ed="${esc(e.id)}">${icon('edit', 14)} Number & dates</button>
        ${fl.length ? `<button class="btn sm ghost" data-rd="${esc(e.id)}" title="Read the number and dates from the uploaded copy">🔍 Read from copy</button>` : ''}
        ${e.custom ? `<button class="btn sm ghost" data-rm="${esc(e.id)}">${icon('trash', 14)} Delete</button>` : ''}
      </div></div>`;
  };

  function draw() {
    if (err) { el.innerHTML = `<div class="card empty"><b>Could not load company documents</b>${esc(String(err.message || err).includes('permission') ? 'Publish the latest firestore.rules in Firebase (it adds company documents).' : friendlyError(err))}</div>`; return; }
    if (!docs || !files) { el.innerHTML = '<div class="card empty">Loading…</div>'; return; }
    const { std, add } = entries();
    const all = [...std, ...add];
    const bad = all.filter((e) => ['expired', 'soon'].includes(dueState(e.doc?.expiry)));
    el.innerHTML = `
      ${bad.length ? `<div class="card" style="background:#fff4e2;border-color:#f3d7a6"><b>${icon('warn', 16, '#D98A1A')} Renew soon:</b>
        ${bad.map((e) => `${esc(e.title)} ${statusPill(e.doc.expiry)}`).join(' &nbsp; ')}</div>` : ''}
      <div class="card ${bad.length ? 'mt' : ''}"><div class="card-head"><h2>Company documents</h2><span class="small muted">${files.length} file${files.length === 1 ? '' : 's'}</span></div>
        <div class="slots">${std.map(card).join('')}</div></div>
      <div class="card mt"><div class="card-head"><h2>Additional documents</h2><button class="btn sm ghost" id="cd-add2">${icon('plus', 14)} Add with heading</button></div>
        ${add.length ? `<div class="slots">${add.map(card).join('')}</div>` : '<div class="empty small">ISO certificate, bank letter, civil defence… add each one with its own heading.</div>'}</div>`;
    const find = (id) => all.find((x) => x.id === id);
    el.querySelectorAll('[data-up]').forEach((b) => { b.onclick = () => upload(find(b.dataset.up)); });
    el.querySelectorAll('[data-ed]').forEach((b) => { b.onclick = () => edit(find(b.dataset.ed)); });
    el.querySelectorAll('[data-rd]').forEach((b) => { b.onclick = () => readFromCopy(find(b.dataset.rd)); });
    el.querySelectorAll('[data-rm]').forEach((b) => {
      b.onclick = async () => {
        const e = find(b.dataset.rm);
        if (!await confirmBox(`Delete ${e.title}?`, 'The document and all its files will be deleted.', { ok: 'Delete', danger: true })) return;
        try { await deleteCompanyDoc(e.id, files); toast('Deleted'); } catch (x) { toast(friendlyError(x), true); }
      };
    });
    el.querySelectorAll('[data-view]').forEach(async (t) => {
      const f = files.find((x) => x.id === t.dataset.view);
      const e = find(f.docId);
      t.onclick = (ev) => { if (!ev.target.closest('[data-delf]')) viewFile(f, e?.title || f.name); };
      try {
        const b64 = await bytes(f);
        if (isImg(f)) t.insertAdjacentHTML('afterbegin', `<img src="data:${f.mime};base64,${b64}" alt="">`);
        else {
          const src = await pdfThumb(`co_${f.id}`, b64);
          t.querySelector('b')?.remove();
          t.insertAdjacentHTML('afterbegin', `<img src="${src}" alt="" style="object-position:top"><span class="pdf-badge">PDF</span>`);
        }
      } catch { /* keep the PDF label */ }
    });
    el.querySelectorAll('[data-delf]').forEach((b) => {
      b.onclick = async () => {
        const f = files.find((x) => x.id === b.dataset.delf);
        if (!f || !await confirmBox('Delete file?', 'Delete this copy?', { ok: 'Delete', danger: true })) return;
        try { await deleteCompanyFile(f); cache.delete(f.id); toast('Deleted'); } catch (x) { toast(friendlyError(x), true); }
      };
    });
    el.querySelector('#cd-add2').onclick = addAdditional;
  }

  document.getElementById('cd-add').onclick = addAdditional;
  document.getElementById('cd-zip').onclick = zipAll;
  document.getElementById('cd-read').onclick = fillAll;
  draw();
  const u1 = watchCompanyDocs((l, e) => { docs = l || []; if (e) err = e; draw(); });
  const u2 = watchCompanyFiles((l, e) => { files = l || []; if (e) err = e; draw(); });
  return () => { u1(); u2(); };
}
