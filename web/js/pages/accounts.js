// Accounts (admin only): income & expenditure. Manual entries plus automatic lines for
// petty cash given to staff and payments to drivers.
import {
  store, isAdmin, watchAcct, saveAcct, deleteAcct, removeAcctFile, readAcctFile, autoAcctLines,
  getAcctOpening, saveAcctOpening, acctBroughtForward, getAcctParties, saveAcctParty,
  ACCT_INCOME, ACCT_EXPENSE, ACCT_METHODS, isBankMethod,
} from '../fb.js';
import { downloadReport, saveBlob } from '../report-lib.js';
import { esc, icon, pill, fmtMoney, fmtDate, parseKey, dateKey, toast, modal, confirmBox, friendlyError, b64img, photoViewer } from '../util.js';

const GREEN = '#2E9E6A', RED = '#D64545';
const SRC = { manual: 'Manual', petty: 'Petty cash', driver: 'Driver payment' };
const projLabel = (p) => [p.code, p.name].filter(Boolean).join(' · ');
// Entries saved with only a site (the earlier "Site / project" box) take the project that site belongs to.
function projectOfSite(siteId) { const s = siteId ? store.site(siteId) : null; return s && s.projectId ? store.projects.find((x) => x.id === s.projectId) || null : null; }
function withProject(e) {
  if (e.projectId) return e;
  const p = projectOfSite(e.siteId);
  return p ? { ...e, projectId: p.id, projectName: projLabel(p) } : e;
}
const r2 = (n) => Math.round((n || 0) * 100) / 100;

export function mount(el, _p, { setHeader }) {
  if (!isAdmin()) { el.innerHTML = '<div class="card empty"><b>Admins only</b>Accounts are visible to admins.</div>'; return () => {}; }
  setHeader('Accounts', 'Income & expenditure — cheque / cash deposits, purchases, supplier payments; petty cash given and driver payments are added automatically',
    `<button class="btn" id="ac-inc" style="background:${GREEN};border-color:${GREEN}">${icon('plus', 16)} Income</button>
     <button class="btn" id="ac-exp" style="background:${RED};border-color:${RED}">${icon('plus', 16)} Expense</button>
     <button class="btn ghost" id="ac-open">Opening balance</button>
     <button class="btn ghost" id="ac-xlsx">${icon('download', 16)} Excel</button><button class="btn ghost" id="ac-pdf">PDF</button>`);

  const now = new Date();
  let from = dateKey(new Date(now.getFullYear(), now.getMonth(), 1)), to = dateKey(now);
  let manual = null, auto = [], unsub = null, err = null;
  let type = '', cat = '', method = '', q = '', showAuto = true;
  let opening = { date: '', cash: 0, bank: 0 }, bf = null;

  function load() {
    if (unsub) unsub();
    manual = null; err = null; draw();
    unsub = watchAcct(from, to, (l, e) => { manual = l || []; err = e || null; draw(); });
    autoAcctLines(from, to).then((l) => { auto = l; draw(); }).catch((e) => { console.error(e); auto = []; draw(); });
    loadBf();
  }
  async function loadBf() {
    bf = null;
    try { opening = await getAcctOpening(); bf = await acctBroughtForward(from, opening); } catch (e) { console.error(e); bf = { cash: 0, bank: 0 }; }
    draw();
  }

  function lines() {
    const ql = q.toLowerCase();
    return [...(manual || []), ...(showAuto ? auto : [])].map(withProject)
      .filter((e) => (!type || e.type === type) && (!cat || e.category === cat) && (!method || e.method === method)
        && (!ql || [e.category, e.party, e.note, e.reference, e.bank, e.siteName, e.projectName, e.method].join(' ').toLowerCase().includes(ql)))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  }

  function draw() {
    const list = lines();
    const inc = list.filter((e) => e.type === 'income'), exp = list.filter((e) => e.type === 'expense');
    const sum = (l) => r2(l.reduce((a, e) => a + e.amount, 0));
    const tIn = sum(inc), tOut = sum(exp), net = r2(tIn - tOut);
    const cashNet = r2(sum(inc.filter((e) => !isBankMethod(e.method))) - sum(exp.filter((e) => !isBankMethod(e.method))));
    const bankNet = r2(sum(inc.filter((e) => isBankMethod(e.method))) - sum(exp.filter((e) => isBankMethod(e.method))));
    // Balance brought forward + this period's net = closing balance (only meaningful with all lines included).
    const full = !type && !cat && !method && !q && showAuto;
    const bfT = bf ? r2(bf.cash + bf.bank) : null;
    const closeCash = bf ? r2(bf.cash + cashNet) : null, closeBank = bf ? r2(bf.bank + bankNet) : null;
    const byCat = (l) => {
      const m = new Map();
      l.forEach((e) => m.set(e.category || 'Uncategorised', (m.get(e.category || 'Uncategorised') || 0) + e.amount));
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const allCats = [...new Set([...ACCT_INCOME, ...ACCT_EXPENSE, 'Petty cash given', 'Driver payment', ...(manual || []).map((e) => e.category)])].filter(Boolean);
    const quick = [['month', 'This month'], ['last', 'Last month'], ['year', 'This year'], ['all', 'All time']];

    el.innerHTML = `
    <div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:12px">
      <div class="seg">${quick.map(([k, l]) => `<button class="btn sm ghost" data-quick="${k}">${l}</button>`).join('')}</div>
      <label class="row small" style="gap:6px;flex-wrap:nowrap">From <input type="date" id="ac-from" value="${from}" style="width:150px"></label>
      <label class="row small" style="gap:6px;flex-wrap:nowrap">To <input type="date" id="ac-to" value="${to}" style="width:150px"></label>
      <select id="ac-type" style="width:auto"><option value="">Income & expenses</option><option value="income" ${type === 'income' ? 'selected' : ''}>Income only</option><option value="expense" ${type === 'expense' ? 'selected' : ''}>Expenses only</option></select>
      <select id="ac-cat" style="width:auto;max-width:200px"><option value="">All categories</option>${allCats.map((c) => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select id="ac-method" style="width:auto"><option value="">All methods</option>${ACCT_METHODS.map((m) => `<option ${m === method ? 'selected' : ''}>${m}</option>`).join('')}</select>
      <input id="ac-q" placeholder="Search party, note, cheque no…" value="${esc(q)}" style="max-width:220px">
      <label class="row small" style="gap:6px"><input type="checkbox" id="ac-auto" ${showAuto ? 'checked' : ''}> Include petty cash & driver payments</label>
    </div>
    ${err ? `<div class="card pad" style="background:#fbe6e6;color:#8f2a2a;margin-bottom:12px">Could not load accounts: ${esc(err.code || err.message)}. Publish the latest Firestore rules (combined file).</div>` : ''}
    <div class="card" style="margin-bottom:12px;padding:14px 18px;display:flex;flex-wrap:wrap;gap:18px;align-items:center">
      <div><div class="small muted">Balance brought forward (${esc(from)})</div><b style="font-size:20px">${bf ? money(bfT) : '…'}</b>
        <div class="small muted">${bf ? `cash ${money(bf.cash)} · bank ${money(bf.bank)}` : ''}</div></div>
      <div style="font-size:22px;color:#aaa">+</div>
      <div><div class="small muted">Net this period</div><b style="font-size:20px;color:${net >= 0 ? GREEN : RED}">${money(net)}</b>
        <div class="small muted">income ${fmtMoney(tIn)} − expenses ${fmtMoney(tOut)}</div></div>
      <div style="font-size:22px;color:#aaa">=</div>
      <div><div class="small muted">Closing balance (${esc(to)})</div><b style="font-size:22px;color:${bf && bfT + net >= 0 ? GREEN : RED}">${bf ? money(r2(bfT + net)) : '…'}</b>
        <div class="small muted">${bf ? `cash ${money(closeCash)} · bank ${money(closeBank)}` : ''}</div></div>
      <span class="spacer"></span>
      <div class="small muted" style="max-width:260px">${opening.date ? `Opening balance ${money(r2(opening.cash + opening.bank))} on ${esc(opening.date)}.` : 'No opening balance set yet — click <b>Opening balance</b>.'}
        ${full ? '' : '<br><b style="color:#a8640f">Filters are on — closing balance uses only the entries shown.</b>'}</div>
    </div>
    <div class="grid kpis">
      ${kpi('Income', fmtMoney(tIn), `${inc.length} entr${inc.length === 1 ? 'y' : 'ies'}`, GREEN)}
      ${kpi('Expenses', fmtMoney(tOut), `${exp.length} entr${exp.length === 1 ? 'y' : 'ies'}`, RED)}
      ${kpi(net >= 0 ? 'Net surplus' : 'Net deficit', fmtMoney(Math.abs(net)), 'income − expenses', net >= 0 ? GREEN : RED)}
      ${kpi('Cash', `${cashNet < 0 ? '−' : ''}${fmtMoney(Math.abs(cashNet))}`, 'cash in − cash out', '#D98A1A')}
      ${kpi('Bank / cheque', `${bankNet < 0 ? '−' : ''}${fmtMoney(Math.abs(bankNet))}`, 'in − out (cheque, transfer, card, online)', '#3A7BD5')}
    </div>
    <div class="grid cols-2-1 mt">
      <div class="card"><div class="card-head"><h2>Entries</h2><span class="spacer"></span><span class="small muted">${manual == null ? 'Loading…' : `${list.length} entries`}</span></div>
        ${list.length ? `<div class="table-wrap"><table class="t tr-t"><thead><tr><th>Date</th><th>Category</th><th>Party / details</th><th>Method</th><th class="num">Amount</th><th></th></tr></thead><tbody>
        ${list.map((e) => `<tr class="click" data-row="${e.id}">
          <td class="nowrap">${esc(e.date)}</td>
          <td>${pill(e.type === 'income' ? 'Income' : 'Expense', e.type === 'income' ? 'green' : 'red')}<div class="small" style="margin-top:3px"><b>${esc(e.category)}</b></div>${e.source !== 'manual' ? `<div class="small muted">auto · ${SRC[e.source]}</div>` : ''}</td>
          <td class="small"><b>${esc(e.party || '')}</b>${e.note ? `<div class="muted">${esc(e.note)}</div>` : ''}${e.projectName ? `<div class="muted">Project: ${esc(e.projectName)}</div>` : ''}${e.siteName ? `<div class="muted">Site: ${esc(e.siteName)}</div>` : ''}</td>
          <td class="small">${esc(e.method)}${e.reference ? `<div class="muted">${e.method === 'Cheque' ? 'Chq ' : 'Ref '}${esc(e.reference)}${e.bank ? ` · ${esc(e.bank)}` : ''}</div>` : ''}${e.chequeDate ? `<div class="muted">Chq date ${esc(e.chequeDate)}</div>` : ''}</td>
          <td class="num"><b style="color:${e.type === 'income' ? GREEN : RED}">${e.type === 'income' ? '+' : '−'}${fmtMoney(e.amount)}</b></td>
          <td style="white-space:nowrap">${e.hasFile ? `<button class="btn sm ghost icon" data-file="${e.id}" title="Receipt / copy">${icon('idcard', 15)}</button>` : ''}${e.source === 'manual'
            ? `<button class="btn sm ghost icon" data-edit="${e.id}" title="Edit">${icon('edit', 15)}</button><button class="btn sm ghost icon" data-del="${e.id}" title="Delete">${icon('trash', 15)}</button>`
            : `<a class="btn sm ghost" href="#/${e.source === 'petty' ? 'petty' : 'trips'}" title="Change it on the ${SRC[e.source]} page">Open</a>`}</td>
        </tr>`).join('')}</tbody></table></div>`
        : `<div class="empty"><b>${manual == null ? 'Loading…' : 'No entries in this period'}</b>${manual == null ? '' : 'Use + Income or + Expense to add one.'}</div>`}
      </div>
      <div>
        <div class="card"><div class="card-head"><h2>Expenses by category</h2></div>
          ${byCat(exp).map(([c, v]) => bar(c, v, tOut, RED)).join('') || '<div class="empty">—</div>'}</div>
        <div class="card mt"><div class="card-head"><h2>Income by category</h2></div>
          ${byCat(inc).map(([c, v]) => bar(c, v, tIn, GREEN)).join('') || '<div class="empty">—</div>'}</div>
        <div class="small muted" style="padding:10px 4px">Petty cash is counted when it is <b>given</b> to staff. Staff expenses paid from that cash are not counted again. They're on the Petty cash page.</div>
      </div>
    </div>`;
    wire(list);
  }

  function wire(list) {
    const find = (id) => list.find((e) => e.id === id);
    el.querySelectorAll('[data-quick]').forEach((b) => {
      b.onclick = () => {
        const n = new Date();
        if (b.dataset.quick === 'month') { from = dateKey(new Date(n.getFullYear(), n.getMonth(), 1)); to = dateKey(n); }
        if (b.dataset.quick === 'last') { from = dateKey(new Date(n.getFullYear(), n.getMonth() - 1, 1)); to = dateKey(new Date(n.getFullYear(), n.getMonth(), 0)); }
        if (b.dataset.quick === 'year') { from = `${n.getFullYear()}-01-01`; to = dateKey(n); }
        if (b.dataset.quick === 'all') { from = '2000-01-01'; to = dateKey(n); }
        load();
      };
    });
    el.querySelector('#ac-from').onchange = (e) => { if (e.target.value) { from = e.target.value; if (to < from) to = from; load(); } };
    el.querySelector('#ac-to').onchange = (e) => { if (e.target.value) { to = e.target.value; if (to < from) from = to; load(); } };
    el.querySelector('#ac-type').onchange = (e) => { type = e.target.value; draw(); };
    el.querySelector('#ac-cat').onchange = (e) => { cat = e.target.value; draw(); };
    el.querySelector('#ac-method').onchange = (e) => { method = e.target.value; draw(); };
    el.querySelector('#ac-auto').onchange = (e) => { showAuto = e.target.checked; draw(); };
    const qi = el.querySelector('#ac-q');
    qi.oninput = () => { q = qi.value; draw(); const n = el.querySelector('#ac-q'); n.focus(); n.setSelectionRange(q.length, q.length); };
    el.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); entryDialog(find(b.dataset.edit)); }; });
    el.querySelectorAll('[data-row]').forEach((r) => {
      r.onclick = (ev) => { if (ev.target.closest('button, a')) return; const e = find(r.dataset.row); if (e && e.source === 'manual') entryDialog(e); };
    });
    el.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async (ev) => {
        ev.stopPropagation();
        const e = find(b.dataset.del);
        if (!e || !await confirmBox('Delete entry', `Delete ${e.type} of ${fmtMoney(e.amount)} (${e.category}${e.party ? `, ${e.party}` : ''}) on ${e.date}?`, { ok: 'Delete', danger: true })) return;
        try { await deleteAcct(e); toast('Deleted'); } catch (er) { toast(friendlyError(er), true); }
      };
    });
    el.querySelectorAll('[data-file]').forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); openFile(find(b.dataset.file)); }; });
  }

  document.getElementById('ac-open').onclick = () => openingDialog(opening, loadBf);
  document.getElementById('ac-inc').onclick = () => entryDialog(null, 'income');
  document.getElementById('ac-exp').onclick = () => entryDialog(null, 'expense');
  const exp = (fmt) => async () => {
    try { await downloadReport(report(lines(), from, to, bf), fmt); } catch (e) { toast(friendlyError(e), true); }
  };
  document.getElementById('ac-xlsx').onclick = exp('xlsx');
  document.getElementById('ac-pdf').onclick = exp('pdf');

  load();
  const off = store.on(() => {});
  return () => { off(); if (unsub) unsub(); };
}

const money = (v) => `${v < 0 ? '−' : ''}${fmtMoney(Math.abs(v))}`;

function openingDialog(o, onDone) {
  modal({
    title: 'Opening balance',
    body: `<p class="small muted" style="margin-top:0">The money the company had when you start using Accounts. Every period then starts with this plus everything entered before it (balance brought forward).</p>
      <div class="grid cols-2" style="gap:10px">
        <label class="f"><span>As at date</span><input id="ob-d" type="date" value="${esc(o.date || dateKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))}"></label>
        <span></span>
        <label class="f"><span>Cash in hand (AED)</span><input id="ob-c" type="number" step="0.01" value="${o.cash || ''}"></label>
        <label class="f"><span>Bank balance (AED)</span><input id="ob-b" type="number" step="0.01" value="${o.bank || ''}"></label>
      </div>
      <label class="f"><span>Note</span><input id="ob-n" value="${esc(o.note || '')}" placeholder="e.g. as per bank statement 30 Sep"></label><div class="error" id="ob-err"></div>`,
    foot: '<button class="btn ghost" data-no>Cancel</button><button class="btn" data-yes>Save</button>',
    onMount: (m, close) => {
      m.querySelector('[data-no]').onclick = close;
      m.querySelector('[data-yes]').onclick = async () => {
        const date = m.querySelector('#ob-d').value;
        if (!date) { m.querySelector('#ob-err').textContent = 'Choose the date.'; return; }
        try {
          await saveAcctOpening({ date, cash: m.querySelector('#ob-c').value, bank: m.querySelector('#ob-b').value, note: m.querySelector('#ob-n').value.trim() });
          toast('Opening balance saved'); close(); onDone && onDone();
        } catch (e) { m.querySelector('#ob-err').textContent = friendlyError(e); }
      };
    },
  });
}

function kpi(label, value, sub, color) {
  return `<div class="card kpi"><div class="lbl"><span class="ico" style="background:${color}1f;color:${color}">●</span>${esc(label)}</div>
    <div class="val" style="color:${color}">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;
}
function bar(label, v, total, color) {
  const pct = total ? Math.round((v / total) * 100) : 0;
  return `<div class="list-item" style="display:block"><div class="row" style="flex-wrap:nowrap"><span class="grow small"><b>${esc(label)}</b></span><b class="small">${fmtMoney(r2(v))}</b></div>
    <div style="height:6px;background:#f0ede8;border-radius:4px;margin-top:5px"><i style="display:block;height:6px;width:${pct}%;background:${color};border-radius:4px"></i></div></div>`;
}

// Receipt / cheque copies: images compressed, PDFs up to 700 KB (stored in Firestore).
const MAX_BYTES = 700 * 1024;
async function prepare(file) {
  const read = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_BYTES) throw new Error('PDF is larger than 700 KB. Upload a photo instead.');
    return { name: file.name, mime: 'application/pdf', base64: (await read(file)).split(',')[1] };
  }
  const url = await read(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Not an image')); i.src = url; });
  for (const [side, q] of [[1800, 0.75], [1400, 0.65], [1100, 0.55], [900, 0.5]]) {
    const s = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    const out = c.toDataURL('image/jpeg', q);
    if (out.length * 0.75 <= MAX_BYTES) return { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', mime: 'image/jpeg', base64: out.split(',')[1] };
  }
  throw new Error('Image is too large even after compressing.');
}
async function openFile(e) {
  try {
    const f = await readAcctFile(e.id);
    if (!f) { toast('File not found', true); return; }
    if (f.mime === 'application/pdf') {
      const bin = atob(f.base64), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      saveBlob(new Blob([arr], { type: 'application/pdf' }), f.name || 'receipt.pdf');
    } else photoViewer(b64img(f.base64));
  } catch (er) { toast(friendlyError(er), true); }
}

function entryDialog(e, kind = e?.type || 'expense') {
  const income = kind === 'income';
  const cats = income ? ACCT_INCOME : ACCT_EXPENSE;
  const color = income ? GREEN : RED;
  let file = null;
  modal({
    title: `${e ? 'Edit' : 'Add'} ${income ? 'income' : 'expense'}`,
    body: `<div class="grid cols-2" style="gap:10px">
      <label class="f"><span>Date *</span><input id="ae-date" type="date" value="${esc(e?.date || dateKey(new Date()))}"></label>
      <label class="f"><span>Amount (AED) *</span><input id="ae-amt" type="number" min="0" step="0.01" value="${e ? e.amount : ''}" style="font-weight:800;color:${color}"></label>
      <label class="f"><span>Category *</span><input id="ae-cat" list="ae-cats" value="${esc(e?.category || cats[0])}"><datalist id="ae-cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <label class="f"><span>${income ? 'Received from (client / bank / owner)' : 'Paid to (supplier / party)'}</span><input id="ae-party" list="ae-parties" autocomplete="off" value="${esc(e?.party || '')}" placeholder="Type or pick a saved name"><datalist id="ae-parties"></datalist></label>
      <label class="f"><span>Method</span><select id="ae-m">${ACCT_METHODS.map((m) => `<option ${m === (e?.method || (income ? 'Cheque' : 'Cash')) ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label class="f"><span id="ae-ref-l">Reference</span><input id="ae-ref" value="${esc(e?.reference || '')}"></label>
      <label class="f ae-chq"><span>Bank</span><input id="ae-bank" value="${esc(e?.bank || '')}" placeholder="e.g. Emirates NBD"></label>
      <label class="f ae-chq"><span>Cheque date</span><input id="ae-cdate" type="date" value="${esc(e?.chequeDate || '')}"></label>
      <label class="f"><span>Project (optional)</span><select id="ae-proj"><option value="">—</option>${[...store.projects].sort((a, b) => (a.status !== 'active') - (b.status !== 'active') || a.name.localeCompare(b.name)).map((p) => `<option value="${p.id}" ${p.id === (e?.projectId || projectOfSite(e?.siteId)?.id) ? 'selected' : ''}>${esc([p.code, p.name].filter(Boolean).join(' · '))}${p.status !== 'active' ? ` (${esc(p.status)})` : ''}</option>`).join('')}</select></label>
      <label class="f"><span>Site (optional)</span><select id="ae-site"><option value="">—</option>${store.sites.map((s) => `<option value="${s.id}" ${s.id === e?.siteId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <label class="f"><span>Receipt / invoice / cheque copy</span><input id="ae-file" type="file" accept="image/*,application/pdf">
        ${e?.hasFile ? `<span class="small muted">Attached: ${esc(e.fileName)} <a href="javascript:void 0" id="ae-rmfile" style="color:${RED}">remove</a></span>` : ''}</label>
    </div>
    <label class="f"><span>Note</span><input id="ae-note" value="${esc(e?.note || '')}" placeholder="${income ? 'e.g. Project ABC — 2nd payment' : 'e.g. Cement 50 bags, invoice 1234'}"></label>
    <div class="error" id="ae-err"></div>`,
    foot: `<button class="btn ghost" data-no>Cancel</button><button class="btn" data-yes style="background:${color};border-color:${color}">${e ? 'Save' : `Add ${income ? 'income' : 'expense'}`}</button>`,
    onMount: (m, close) => {
      const v = (id) => m.querySelector(id).value;
      const sync = () => {
        const chq = v('#ae-m') === 'Cheque';
        m.querySelectorAll('.ae-chq').forEach((x) => { x.style.display = chq ? '' : 'none'; });
        m.querySelector('#ae-ref-l').textContent = chq ? 'Cheque no.' : v('#ae-m') === 'Cash' ? 'Receipt / voucher no.' : 'Transaction ref.';
      };
      m.querySelector('#ae-m').onchange = sync; sync();
      m.querySelector('#ae-site').onchange = () => { const p = projectOfSite(v('#ae-site')); if (p && !v('#ae-proj')) m.querySelector('#ae-proj').value = p.id; };
      const partyKey = income ? 'receivedFrom' : 'paidTo';
      let saved = [];
      getAcctParties().then((p) => {
        saved = p[partyKey];
        const used = (store.acctNames || []);
        m.querySelector('#ae-parties').innerHTML = [...new Set([...saved, ...used])].map((n) => `<option value="${esc(n)}">`).join('');
      }).catch(() => {});
      m.querySelector('#ae-file').onchange = async (ev) => {
        const f = ev.target.files[0];
        if (!f) { file = null; return; }
        try { file = await prepare(f); } catch (er) { file = null; ev.target.value = ''; m.querySelector('#ae-err').textContent = er.message; }
      };
      m.querySelector('#ae-rmfile')?.addEventListener('click', async () => {
        try { await removeAcctFile(e); e.hasFile = false; m.querySelector('#ae-rmfile').parentElement.textContent = 'Removed'; } catch (er) { toast(friendlyError(er), true); }
      });
      m.querySelector('[data-no]').onclick = close;
      m.querySelector('[data-yes]').onclick = async () => {
        const amount = Number(v('#ae-amt')), date = v('#ae-date'), category = v('#ae-cat').trim();
        if (!(amount > 0) || !date || !category) { m.querySelector('#ae-err').textContent = 'Date, amount and category are required.'; return; }
        const chq = v('#ae-m') === 'Cheque';
        const btn = m.querySelector('[data-yes]'); btn.disabled = true;
        try {
          await saveAcct(e?.id || null, {
            type: kind, date, amount, category, party: v('#ae-party').trim(), method: v('#ae-m'), reference: v('#ae-ref').trim(),
            bank: chq ? v('#ae-bank').trim() : '', chequeDate: chq ? v('#ae-cdate') : '', siteId: v('#ae-site'), note: v('#ae-note').trim(),
            projectId: v('#ae-proj'), projectName: (() => { const p = store.projects.find((x) => x.id === v('#ae-proj')); return p ? [p.code, p.name].filter(Boolean).join(' · ') : ''; })(),
          }, file);
          const who = v('#ae-party').trim();
          if (who && !saved.some((n) => n.toLowerCase() === who.toLowerCase())) saveAcctParty(partyKey, who).catch(() => {});
          toast(e ? 'Saved' : `${income ? 'Income' : 'Expense'} added`); close();
        } catch (er) { m.querySelector('#ae-err').textContent = friendlyError(er); btn.disabled = false; }
      };
    },
  });
}

function report(list, from, to, bf) {
  const inc = list.filter((e) => e.type === 'income'), exp = list.filter((e) => e.type === 'expense');
  const sum = (l) => r2(l.reduce((a, e) => a + e.amount, 0));
  const groups = (l, key) => {
    const m = new Map();
    l.forEach((e) => m.set(key(e), (m.get(key(e)) || 0) + e.amount));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r2(v)]);
  };
  const months = new Map();
  list.forEach((e) => { const k = e.date.slice(0, 7); const c = months.get(k) || { i: 0, x: 0 }; if (e.type === 'income') c.i += e.amount; else c.x += e.amount; months.set(k, c); });
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
  const b0 = bf ? r2(bf.cash + bf.bank) : 0;
  let bal = b0;
  return {
    title: 'Accounts — income & expenditure',
    subtitle: `${from} to ${to} · brought forward AED ${b0} · income AED ${sum(inc)} · expenses AED ${sum(exp)} · closing AED ${r2(b0 + sum(inc) - sum(exp))}`,
    filename: `accounts-${from}-to-${to}`,
    orientation: 'landscape',
    pdfFont: 7.5,
    sheets: [
      { name: 'Summary', columns: ['Item', 'AED'], widths: [34, 16], rows: [
        ['Balance brought forward', b0], ['  of which cash', bf ? bf.cash : 0], ['  of which bank', bf ? bf.bank : 0],
        ['Income', sum(inc)], ['Expenses', sum(exp)], ['Net (income − expenses)', r2(sum(inc) - sum(exp))],
        ['Cash in', sum(inc.filter((e) => !isBankMethod(e.method)))], ['Cash out', sum(exp.filter((e) => !isBankMethod(e.method)))],
        ['Bank / cheque in', sum(inc.filter((e) => isBankMethod(e.method)))], ['Bank / cheque out', sum(exp.filter((e) => isBankMethod(e.method)))],
        ['Closing balance', r2(b0 + sum(inc) - sum(exp))],
      ] },
      { name: 'Ledger', columns: ['Date', 'Type', 'Category', 'Party', 'Method', 'Cheque / ref.', 'Bank', 'Project', 'Site', 'Note', 'Source', 'Income', 'Expense', 'Running balance'],
        widths: [11, 9, 18, 20, 12, 14, 14, 20, 16, 30, 12, 11, 11, 13],
        rows: [[from, '', 'Balance brought forward', '', '', '', '', '', '', '', '', '', '', b0], ...sorted.map((e) => { bal = r2(bal + (e.type === 'income' ? e.amount : -e.amount));
          return [e.date, e.type === 'income' ? 'Income' : 'Expense', e.category, e.party, e.method, e.reference, e.bank || '', e.projectName || '', e.siteName, e.note, SRC[e.source],
            e.type === 'income' ? e.amount : '', e.type === 'expense' ? e.amount : '', bal]; })],
        totals: ['CLOSING', '', '', '', '', '', '', '', '', '', '', sum(inc), sum(exp), r2(b0 + sum(inc) - sum(exp))] },
      { name: 'Expenses by category', columns: ['Category', 'AED'], widths: [30, 14], rows: groups(exp, (e) => e.category), totals: ['TOTAL', sum(exp)] },
      { name: 'Income by category', columns: ['Category', 'AED'], widths: [30, 14], rows: groups(inc, (e) => e.category), totals: ['TOTAL', sum(inc)] },
      { name: 'By month', columns: ['Month', 'Income', 'Expenses', 'Net'], widths: [12, 14, 14, 14],
        rows: [...months.entries()].sort().map(([k, c]) => [k, r2(c.i), r2(c.x), r2(c.i - c.x)]) },
      { name: 'Expenses by party', columns: ['Paid to', 'AED'], widths: [30, 14], rows: groups(exp, (e) => e.party || '—') },
    ],
  };
}
