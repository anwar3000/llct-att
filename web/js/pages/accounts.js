// Accounts (admin only): income & expenditure. Manual entries plus automatic lines for
// petty cash given to staff and payments to drivers.
import {
  store, isAdmin, watchAcct, saveAcct, deleteAcct, removeAcctFile, readAcctFile, autoAcctLines,
  watchAcctAll, watchPending, savePending, deletePending, payPending,
  getAcctOpening, saveAcctOpening, acctBroughtForward, getAcctParties, saveAcctParty,
  ACCT_INCOME, ACCT_EXPENSE, ACCT_METHODS, isBankMethod, convertCashToBank,
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
  setHeader('Accounts', 'Company position, money still to pay / receive, and the income & expenditure statement',
    `<button class="btn" id="ac-inc" style="background:${GREEN};border-color:${GREEN}">${icon('plus', 16)} Income</button>
     <button class="btn" id="ac-exp" style="background:${RED};border-color:${RED}">${icon('plus', 16)} Expense</button>
     <button class="btn ghost" id="ac-pend">${icon('pending', 16)} Pending payment</button>
     <button class="btn ghost" id="ac-open">Opening balance</button>
     <button class="btn ghost" id="ac-xlsx">${icon('download', 16)} Excel</button><button class="btn ghost" id="ac-pdf">PDF</button>`);

  const now = new Date();
  const today = dateKey(now);
  let from = dateKey(new Date(now.getFullYear(), now.getMonth(), 1)), to = today;
  let manual = null, auto = [], unsub = null, err = null;
  let all = null, allAuto = null, pending = null, pendErr = null;
  let type = '', cat = '', method = '', q = '', showAuto = true, pendTab = 'open';
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
  const loadAllAuto = () => autoAcctLines('2000-01-01', '2100-12-31').then((l) => { allAuto = l; draw(); }).catch(() => { allAuto = []; draw(); });

  function lines() {
    const ql = q.toLowerCase();
    return [...(manual || []), ...(showAuto ? auto : [])].map(withProject)
      .filter((e) => (!type || e.type === type) && (!cat || e.category === cat) && (!method || e.method === method)
        && (!ql || [e.category, e.party, e.note, e.reference, e.bank, e.siteName, e.projectName, e.method].join(' ').toLowerCase().includes(ql)))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  }

  // ---------------------------------------------------------------- overall position (all dates)
  function position() {
    if (!all || !allAuto) return null;
    const start = opening.date || '';
    const l = [...all, ...allAuto].filter((e) => !start || e.date >= start);
    const sum = (x) => r2(x.reduce((a, e) => a + e.amount, 0));
    const inc = l.filter((e) => e.type === 'income'), exp = l.filter((e) => e.type === 'expense');
    const cash = r2((opening.date ? opening.cash : 0) + sum(inc.filter((e) => !isBankMethod(e.method))) - sum(exp.filter((e) => !isBankMethod(e.method))));
    const bank = r2((opening.date ? opening.bank : 0) + sum(inc.filter((e) => isBankMethod(e.method))) - sum(exp.filter((e) => isBankMethod(e.method))));
    const open = (pending || []).filter((p) => p.status === 'open' && p.remaining > 0);
    const toPay = r2(open.filter((p) => p.type === 'pay').reduce((a, p) => a + p.remaining, 0));
    const toGet = r2(open.filter((p) => p.type === 'receive').reduce((a, p) => a + p.remaining, 0));
    const overdue = open.filter((p) => p.dueDate && p.dueDate < today);
    return { inc: sum(inc), exp: sum(exp), nIn: inc.length, nOut: exp.length, cash, bank, bal: r2(cash + bank), toPay, toGet, open, overdue, projected: r2(cash + bank - toPay + toGet) };
  }

  function positionHtml(P) {
    if (!P) return '<div class="ac-hero"><div class="ac-bal"><div class="ac-cap">Current balance</div><div class="ac-big">…</div></div></div>';
    const nPay = P.open.filter((p) => p.type === 'pay').length, nGet = P.open.filter((p) => p.type === 'receive').length;
    return `<div class="ac-hero">
      <div class="ac-bal">
        <div class="ac-cap">Current balance <span>· all dates${opening.date ? ` since ${esc(fmtDate(parseKey(opening.date)))}` : ''}</span></div>
        <div class="ac-big ${P.bal < 0 ? 'neg' : ''}">${money(P.bal)}</div>
        <div class="ac-split"><span><i style="background:#D98A1A"></i>Cash ${money(P.cash)}</span><span><i style="background:#6FA8FF"></i>Bank ${money(P.bank)}</span></div>
        <div class="ac-proj-line"><span>Projected after pending<br><span class="small">balance − to pay + to receive</span></span><b class="${P.projected < 0 ? 'neg' : ''}">${money(P.projected)}</b></div>
        ${opening.date ? '' : '<div class="ac-hint">No opening balance set — add it with <b>Opening balance</b> for a true figure.</div>'}
      </div>
      <div class="ac-tiles">
        ${tile('Total income', fmtMoney(P.inc), `${P.nIn} entr${P.nIn === 1 ? 'y' : 'ies'}`, GREEN, 'up')}
        ${tile('Total expenses', fmtMoney(P.exp), `${P.nOut} entr${P.nOut === 1 ? 'y' : 'ies'}`, RED, 'down')}
        ${tile('To pay', fmtMoney(P.toPay), `${nPay} pending${P.overdue.filter((p) => p.type === 'pay').length ? ` · <b style="color:${RED}">${P.overdue.filter((p) => p.type === 'pay').length} overdue</b>` : ''}`, '#C2557A', 'pay')}
        ${tile('To receive', fmtMoney(P.toGet), `${nGet} pending${P.overdue.filter((p) => p.type === 'receive').length ? ` · <b style="color:#a8640f">${P.overdue.filter((p) => p.type === 'receive').length} overdue</b>` : ''}`, '#3A7BD5', 'get')}
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------- pending payments & projection
  function pendingHtml(P) {
    if (pendErr) return `<div class="card mt pad" style="background:#fbe6e6;color:#8f2a2a">Pending payments can't load: ${esc(pendErr.code || pendErr.message)}. Publish the latest Firestore rules.</div>`;
    const listAll = (pending || []).slice().sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
    const shown = listAll.filter((p) => (pendTab === 'done' ? p.status === 'done' : p.status === 'open' && (pendTab === 'open' || p.type === pendTab)));
    const due = (p) => {
      if (p.status === 'done') return pill('Settled', 'green');
      if (!p.dueDate) return pill('No due date', 'gray');
      const n = Math.round((parseKey(p.dueDate) - parseKey(today)) / 86400000);
      return n < 0 ? pill(`Overdue ${-n} d`, 'red') : n === 0 ? pill('Due today', 'amber') : n <= 7 ? pill(`Due in ${n} d`, 'amber') : pill(`Due ${fmtDate(parseKey(p.dueDate))}`, 'gray');
    };
    // projection: balance now, then each open item by due date
    let run = P ? P.bal : 0;
    const proj = P ? listAll.filter((p) => p.status === 'open' && p.remaining > 0).map((p) => { run = r2(run + (p.type === 'receive' ? p.remaining : -p.remaining)); return { p, run }; }) : [];
    const lowest = proj.reduce((m, x) => (m == null || x.run < m.run ? x : m), null);
    const bucket = (lo, hi) => (P ? P.open : []).filter((p) => { const n = p.dueDate ? Math.round((parseKey(p.dueDate) - parseKey(today)) / 86400000) : 9999; return n >= lo && n <= hi; });
    const bsum = (l, t) => r2(l.filter((p) => p.type === t).reduce((a, p) => a + p.remaining, 0));
    const buckets = [['Overdue', -99999, -1], ['Next 7 days', 0, 7], ['8 – 30 days', 8, 30], ['31 – 90 days', 31, 90], ['Later / no date', 91, 99999]].map(([l, a, b]) => ({ l, pay: bsum(bucket(a, b), 'pay'), get: bsum(bucket(a, b), 'receive') }));
    return `<div class="grid cols-2-1 mt ac-pend">
      <div class="card"><div class="card-head"><h2>Pending payments</h2>
        <div class="seg">${[['open', 'All open'], ['pay', 'To pay'], ['receive', 'To receive'], ['done', 'Settled']].map(([k, l]) => `<button class="btn sm ${pendTab === k ? '' : 'ghost'}" data-ptab="${k}">${l}</button>`).join('')}</div>
        <span class="spacer"></span><button class="btn sm" data-padd="pay" style="background:${RED};border-color:${RED}">${icon('plus', 14)} Add to pay</button><button class="btn sm" data-padd="receive" style="background:${GREEN};border-color:${GREEN}">${icon('plus', 14)} Add to receive</button></div>
        ${pending == null ? '<div class="empty">Loading…</div>' : shown.length ? `<div class="table-wrap"><table class="t ac-t"><thead><tr><th>Due</th><th>Party</th><th>For</th><th class="num">Amount</th><th class="num">Paid</th><th class="num">Remaining</th><th></th></tr></thead><tbody>
          ${shown.map((p) => `<tr>
            <td class="nowrap">${p.dueDate ? esc(fmtDate(parseKey(p.dueDate))) : '—'}<div>${due(p)}</div></td>
            <td><b>${esc(p.party || '—')}</b><div class="small muted">${p.type === 'pay' ? 'We pay' : 'We receive'}</div></td>
            <td class="small">${esc(p.category || '')}${p.note ? `<div class="muted">${esc(p.note)}</div>` : ''}</td>
            <td class="num">${fmtMoney(p.amount)}</td>
            <td class="num small muted">${p.paid ? fmtMoney(p.paid) : '—'}</td>
            <td class="num"><b style="color:${p.type === 'pay' ? RED : GREEN}">${fmtMoney(p.remaining)}</b></td>
            <td class="nowrap">${p.status === 'open' ? `<button class="btn sm" data-ppay="${p.id}" style="background:${p.type === 'pay' ? RED : GREEN};border-color:${p.type === 'pay' ? RED : GREEN}">${p.type === 'pay' ? 'Pay' : 'Received'}</button>` : ''}
              <button class="btn sm ghost icon" data-pedit="${p.id}" title="Edit">${icon('edit', 14)}</button><button class="btn sm ghost icon" data-pdel="${p.id}" title="Delete">${icon('trash', 14)}</button></td></tr>`).join('')}
          </tbody></table></div>`
          : `<div class="empty"><b>${pendTab === 'done' ? 'Nothing settled yet' : 'No pending payments'}</b>Add salaries still to pay, supplier invoices, or client payments you expect — with a due date — to see the projection.</div>`}
      </div>
      <div class="card"><div class="card-head"><h2>Projection</h2></div>
        ${P ? `<div class="ac-proj">
          <div class="ac-proj-row head"><span>Now</span><b>${money(P.bal)}</b></div>
          ${proj.slice(0, 12).map((x) => `<div class="ac-proj-row"><span><span class="small muted">${x.p.dueDate ? esc(fmtDate(parseKey(x.p.dueDate))) : 'no date'}</span><br>${esc(x.p.party || x.p.category)} <b style="color:${x.p.type === 'pay' ? RED : GREEN}">${x.p.type === 'pay' ? '−' : '+'}${fmtMoney(x.p.remaining)}</b></span><b class="${x.run < 0 ? 'neg' : ''}">${money(x.run)}</b></div>`).join('')}
          ${proj.length > 12 ? `<div class="ac-proj-row"><span class="small muted">…${proj.length - 12} more</span><span></span></div>` : ''}
          <div class="ac-proj-row foot"><span>After all pending</span><b class="${P.projected < 0 ? 'neg' : ''}">${money(P.projected)}</b></div>
          ${lowest && lowest.run < 0 ? `<div class="ac-warn">⚠ Balance goes below zero around <b>${lowest.p.dueDate ? esc(fmtDate(parseKey(lowest.p.dueDate))) : 'the last item'}</b> (${money(lowest.run)}).</div>` : ''}
        </div>
        <table class="t ac-buckets"><thead><tr><th>When</th><th class="num">To pay</th><th class="num">To receive</th></tr></thead><tbody>
          ${buckets.map((b) => `<tr><td>${b.l}</td><td class="num" style="color:${b.pay ? RED : '#aaa'}">${b.pay ? fmtMoney(b.pay) : '—'}</td><td class="num" style="color:${b.get ? GREEN : '#aaa'}">${b.get ? fmtMoney(b.get) : '—'}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">Loading…</div>'}
      </div>
    </div>`;
  }

  function draw() {
    const list = lines();
    const inc = list.filter((e) => e.type === 'income'), exp = list.filter((e) => e.type === 'expense');
    const sum = (l) => r2(l.reduce((a, e) => a + e.amount, 0));
    const tIn = sum(inc), tOut = sum(exp), net = r2(tIn - tOut);
    const cashNet = r2(sum(inc.filter((e) => !isBankMethod(e.method))) - sum(exp.filter((e) => !isBankMethod(e.method))));
    const bankNet = r2(sum(inc.filter((e) => isBankMethod(e.method))) - sum(exp.filter((e) => isBankMethod(e.method))));
    const full = !type && !cat && !method && !q && showAuto;
    const bfT = bf ? r2(bf.cash + bf.bank) : null;
    const closeCash = bf ? r2(bf.cash + cashNet) : null, closeBank = bf ? r2(bf.bank + bankNet) : null;
    const byCat = (l) => {
      const m = new Map();
      l.forEach((e) => m.set(e.category || 'Uncategorised', (m.get(e.category || 'Uncategorised') || 0) + e.amount));
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const cashCount = list.filter((e) => e.method === 'Cash' && e.source !== 'petty').length;
    const allCats = [...new Set([...ACCT_INCOME, ...ACCT_EXPENSE, 'Petty cash given', 'Driver payment', ...(manual || []).map((e) => e.category)])].filter(Boolean);
    const quick = [['month', 'This month'], ['last', 'Last month'], ['year', 'This year'], ['all', 'All time']];
    const P = position();

    el.innerHTML = `
    ${positionHtml(P)}
    ${pendingHtml(P)}

    <div class="ac-sec"><h2>Statement for the period</h2><span class="small muted">${esc(fmtDate(parseKey(from)))} – ${esc(fmtDate(parseKey(to)))}</span></div>
    <div class="card ac-toolbar">
      <div class="seg">${quick.map(([k, l]) => `<button class="btn sm ghost" data-quick="${k}">${l}</button>`).join('')}</div>
      <label class="row small" style="gap:6px;flex-wrap:nowrap">From <input type="date" id="ac-from" value="${from}" style="width:150px"></label>
      <label class="row small" style="gap:6px;flex-wrap:nowrap">To <input type="date" id="ac-to" value="${to}" style="width:150px"></label>
      <select id="ac-type" style="width:auto"><option value="">Income & expenses</option><option value="income" ${type === 'income' ? 'selected' : ''}>Income only</option><option value="expense" ${type === 'expense' ? 'selected' : ''}>Expenses only</option></select>
      <select id="ac-cat" style="width:auto;max-width:200px"><option value="">All categories</option>${allCats.map((c) => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select id="ac-method" style="width:auto"><option value="">All methods</option>${ACCT_METHODS.map((m) => `<option ${m === method ? 'selected' : ''}>${m}</option>`).join('')}</select>
      <input id="ac-q" placeholder="Search party, note, cheque no…" value="${esc(q)}" style="max-width:220px">
      <label class="row small" style="gap:6px"><input type="checkbox" id="ac-auto" ${showAuto ? 'checked' : ''}> Include petty cash & driver payments</label>
    </div>
    ${cashCount ? `<div class="card pad" style="background:#fff4e2;border-color:#f3d7a6;margin-bottom:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <div class="grow"><b>${cashCount} ${cashCount === 1 ? 'entry is' : 'entries are'} marked as paid in Cash</b> in this period.
        <span class="small muted">Change every Cash entry and driver payment (all dates) to Bank transfer?</span></div>
      <button class="btn" id="ac-tobank">Change all Cash to Bank transfer</button></div>` : ''}
    ${err ? `<div class="card pad" style="background:#fbe6e6;color:#8f2a2a;margin-bottom:12px">Could not load accounts: ${esc(err.code || err.message)}. Publish the latest Firestore rules (combined file).</div>` : ''}
    <div class="ac-flow">
      <div class="ac-step"><div class="ac-cap">Brought forward</div><b>${bf ? money(bfT) : '…'}</b><span>${bf ? `cash ${money(bf.cash)} · bank ${money(bf.bank)}` : ''}</span></div>
      <div class="ac-op">+</div>
      <div class="ac-step"><div class="ac-cap">Income</div><b style="color:${GREEN}">${fmtMoney(tIn)}</b><span>${inc.length} entr${inc.length === 1 ? 'y' : 'ies'}</span></div>
      <div class="ac-op">−</div>
      <div class="ac-step"><div class="ac-cap">Expenses</div><b style="color:${RED}">${fmtMoney(tOut)}</b><span>${exp.length} entr${exp.length === 1 ? 'y' : 'ies'}</span></div>
      <div class="ac-op">=</div>
      <div class="ac-step strong"><div class="ac-cap">Closing balance</div><b class="${bf && bfT + net < 0 ? 'neg' : ''}">${bf ? money(r2(bfT + net)) : '…'}</b><span>${bf ? `cash ${money(closeCash)} · bank ${money(closeBank)}` : ''}</span></div>
      <div class="ac-step"><div class="ac-cap">${net >= 0 ? 'Surplus' : 'Deficit'} this period</div><b style="color:${net >= 0 ? GREEN : RED}">${money(net)}</b><span>${full ? 'income − expenses' : '<b style="color:#a8640f">filters on</b>'}</span></div>
    </div>
    <div class="grid cols-2-1 mt">
      <div class="card"><div class="card-head"><h2>Entries</h2><span class="spacer"></span><span class="small muted">${manual == null ? 'Loading…' : `${list.length} entries`}</span></div>
        ${list.length ? `<div class="table-wrap"><table class="t tr-t ac-t"><thead><tr><th>Date</th><th>Category</th><th>Party / details</th><th>Method</th><th class="num">Amount</th><th></th></tr></thead><tbody>
        ${list.map((e) => `<tr class="click" data-row="${e.id}">
          <td class="nowrap">${esc(fmtDate(parseKey(e.date)))}</td>
          <td><span class="ac-type ${e.type}">${e.type === 'income' ? 'IN' : 'OUT'}</span> <b class="small">${esc(e.category)}</b>${e.source !== 'manual' ? `<div class="small muted">auto · ${SRC[e.source]}</div>` : ''}</td>
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
    const findP = (id) => (pending || []).find((p) => p.id === id);
    el.querySelectorAll('[data-ptab]').forEach((b) => { b.onclick = () => { pendTab = b.dataset.ptab; draw(); }; });
    el.querySelectorAll('[data-padd]').forEach((b) => { b.onclick = () => pendingDialog(null, b.dataset.padd); });
    el.querySelectorAll('[data-pedit]').forEach((b) => { b.onclick = () => pendingDialog(findP(b.dataset.pedit)); });
    el.querySelectorAll('[data-ppay]').forEach((b) => { b.onclick = () => payDialog(findP(b.dataset.ppay), loadAllAuto); });
    el.querySelectorAll('[data-pdel]').forEach((b) => {
      b.onclick = async () => {
        const p = findP(b.dataset.pdel);
        if (!p || !await confirmBox('Delete pending payment', `Delete ${p.type === 'pay' ? 'payment to' : 'receipt from'} ${p.party || p.category} (${fmtMoney(p.remaining)} remaining)? Entries already recorded stay in the accounts.`, { ok: 'Delete', danger: true })) return;
        try { await deletePending(p.id); toast('Deleted'); } catch (er) { toast(friendlyError(er), true); }
      };
    });
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
    el.querySelector('#ac-tobank')?.addEventListener('click', async (ev) => {
      if (!await confirmBox('Change Cash to Bank transfer?', 'Every accounts entry and driver payment marked Cash (all dates) will be changed to Bank transfer.', { ok: 'Change all' })) return;
      ev.target.disabled = true;
      try { const n = await convertCashToBank(); toast(`${n} ${n === 1 ? 'entry' : 'entries'} changed to Bank transfer`); load(); loadAllAuto(); } catch (e) { toast(friendlyError(e), true); ev.target.disabled = false; }
    });
    el.querySelector('#ac-from').onchange = (e) => { if (e.target.value) { from = e.target.value; if (to < from) to = from; load(); } };
    el.querySelector('#ac-to').onchange = (e) => { if (e.target.value) { to = e.target.value; if (to < from) from = to; load(); } };
    el.querySelector('#ac-type').onchange = (e) => { type = e.target.value; draw(); };
    el.querySelector('#ac-cat').onchange = (e) => { cat = e.target.value; draw(); };
    el.querySelector('#ac-method').onchange = (e) => { method = e.target.value; draw(); };
    el.querySelector('#ac-auto').onchange = (e) => { showAuto = e.target.checked; draw(); };
    const qi = el.querySelector('#ac-q');
    qi.oninput = () => { q = qi.value; draw(); const n = el.querySelector('#ac-q'); n.focus(); n.setSelectionRange(q.length, q.length); };
    el.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); entryDialog(find(b.dataset.edit), undefined, all || []); }; });
    el.querySelectorAll('[data-row]').forEach((r) => {
      r.onclick = (ev) => { if (ev.target.closest('button, a')) return; const e = find(r.dataset.row); if (e && e.source === 'manual') entryDialog(e, undefined, all || []); };
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

  document.getElementById('ac-open').onclick = () => openingDialog(opening, () => { loadBf(); });
  document.getElementById('ac-inc').onclick = () => entryDialog(null, 'income', all || []);
  document.getElementById('ac-exp').onclick = () => entryDialog(null, 'expense', all || []);
  document.getElementById('ac-pend').onclick = () => pendingDialog(null, 'pay');
  const exp = (fmt) => async () => {
    try { await downloadReport(report(lines(), from, to, bf, position()), fmt); } catch (e) { toast(friendlyError(e), true); }
  };
  document.getElementById('ac-xlsx').onclick = exp('xlsx');
  document.getElementById('ac-pdf').onclick = exp('pdf');

  load();
  loadAllAuto();
  const unAll = watchAcctAll((l) => { all = l || []; draw(); });
  const unPend = watchPending((l, e) => { pending = l || []; pendErr = e || null; draw(); });
  const off = store.on(() => {});
  return () => { off(); if (unsub) unsub(); unAll(); unPend(); };
}

function tile(label, value, sub, color, kind) {
  const ic = { up: 'M12 19V5M5 12l7-7 7 7', down: 'M12 5v14M5 12l7 7 7-7', pay: 'M3 7h18v10H3zM7 12h.01M17 12h.01M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4', get: 'M4 4h16v16H4zM8 12l3 3 5-6', proj: 'M3 17l6-6 4 4 8-8M15 7h6v6' }[kind];
  return `<div class="ac-tile"><div class="ac-ti" style="background:${color}18;color:${color}"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ic}"/></svg></div>
    <div class="ac-cap">${esc(label)}</div><div class="ac-val" style="color:${color}">${esc(value)}</div><div class="ac-sub">${sub}</div></div>`;
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

function entryDialog(e, kind = e?.type || 'expense', allEntries = []) {
  const income = kind === 'income';
  const cats = income ? ACCT_INCOME : ACCT_EXPENSE;
  const color = income ? GREEN : RED;
  let file = null;
  modal({
    title: `${e ? 'Edit' : 'Add'} ${income ? 'income' : 'expense'}`,
    body: `<div class="grid cols-2" style="gap:10px">
      <label class="f"><span>Date *</span><input id="ae-date" type="date" value="${esc(e?.date || dateKey(new Date()))}"></label>
      <label class="f"><span>Amount (AED) *</span><input id="ae-amt" type="number" min="0" step="0.01" value="${e ? e.amount : ''}" style="font-weight:800;color:${color}"></label>
      <label class="f"><span>Category *</span><input id="ae-cat" autocomplete="off" value="${esc(e?.category || cats[0])}" placeholder="Pick or type a category"></label>
      <label class="f"><span>${income ? 'Received from (client / bank / owner)' : 'Paid to (supplier / party)'}</span><input id="ae-party" autocomplete="off" value="${esc(e?.party || '')}" placeholder="Pick a saved name or type a new one"></label>
      <label class="f"><span>Method</span><select id="ae-m">${ACCT_METHODS.map((m) => `<option ${m === (e?.method || 'Bank transfer') ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label class="f"><span id="ae-ref-l">Reference</span><input id="ae-ref" value="${esc(e?.reference || '')}"></label>
      <label class="f ae-chq"><span>Bank</span><input id="ae-bank" value="${esc(e?.bank || '')}" placeholder="e.g. Emirates NBD"></label>
      <label class="f ae-chq"><span>Cheque date</span><input id="ae-cdate" type="date" value="${esc(e?.chequeDate || '')}"></label>
      <label class="f"><span>Project (optional)</span><select id="ae-proj"><option value="">—</option>${[...store.projects].sort((a, b) => (a.status !== 'active') - (b.status !== 'active') || a.name.localeCompare(b.name)).map((p) => `<option value="${p.id}" ${p.id === (e?.projectId || projectOfSite(e?.siteId)?.id) ? 'selected' : ''}>${esc([p.code, p.name].filter(Boolean).join(' · '))}${p.status !== 'active' ? ` (${esc(p.status)})` : ''}</option>`).join('')}</select></label>
      <label class="f"><span>Site (optional)</span><select id="ae-site"><option value="">—</option>${store.sites.map((s) => `<option value="${s.id}" ${s.id === e?.siteId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <label class="f"><span>Receipt / invoice / cheque copy</span><input id="ae-file" type="file" accept="image/*,application/pdf">
        ${e?.hasFile ? `<span class="small muted">Attached: ${esc(e.fileName)} <a href="javascript:void 0" id="ae-rmfile" style="color:${RED}">remove</a></span>` : ''}</label>
    </div>
    <label class="f"><span>Note</span><input id="ae-note" value="${esc(e?.note || '')}" placeholder="${income ? 'e.g. Project ABC — 2nd payment' : 'e.g. Cement 50 bags, invoice 1234'}"></label>
    <div class="error" id="ae-err"></div><div class="ac-added" id="ae-added"></div>`,
    foot: `<button class="btn ghost" data-no>${e ? 'Cancel' : 'Close'}</button>${e ? '' : `<button class="btn ghost" data-next title="Save and keep this form open for the next one (Enter)">Save & add next</button>`}<button class="btn" data-yes style="background:${color};border-color:${color}">${e ? 'Save' : `Save ${income ? 'income' : 'expense'}`}</button>`,
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
      const usedParties = () => [...new Set([...saved, ...allEntries.filter((x) => x.type === kind).map((x) => x.party)].filter(Boolean))].sort((a, b) => a.localeCompare(b));
      getAcctParties().then((p) => { saved = p[partyKey]; }).catch(() => {});
      // Show the choices as soon as the box is clicked (a typed name filters them; a new name is fine too).
      combo(m.querySelector('#ae-cat'), () => [...new Set([...cats, ...allEntries.filter((x) => x.type === kind).map((x) => x.category)].filter(Boolean))]);
      combo(m.querySelector('#ae-party'), usedParties);
      m.querySelector('#ae-file').onchange = async (ev) => {
        const f = ev.target.files[0];
        if (!f) { file = null; return; }
        try { file = await prepare(f); } catch (er) { file = null; ev.target.value = ''; m.querySelector('#ae-err').textContent = er.message; }
      };
      m.querySelector('#ae-rmfile')?.addEventListener('click', async () => {
        try { await removeAcctFile(e); e.hasFile = false; m.querySelector('#ae-rmfile').parentElement.textContent = 'Removed'; } catch (er) { toast(friendlyError(er), true); }
      });
      m.querySelector('[data-no]').onclick = close;
      let added = 0, addedSum = 0;
      const save = async (next) => {
        const amount = Number(v('#ae-amt')), date = v('#ae-date'), category = v('#ae-cat').trim();
        if (!(amount > 0) || !date || !category) { m.querySelector('#ae-err').textContent = 'Date, amount and category are required.'; return; }
        m.querySelector('#ae-err').textContent = '';
        const chq = v('#ae-m') === 'Cheque';
        const btns = m.querySelectorAll('[data-yes], [data-next]'); btns.forEach((b) => { b.disabled = true; });
        try {
          await saveAcct(e?.id || null, {
            type: kind, date, amount, category, party: v('#ae-party').trim(), method: v('#ae-m'), reference: v('#ae-ref').trim(),
            bank: chq ? v('#ae-bank').trim() : '', chequeDate: chq ? v('#ae-cdate') : '', siteId: v('#ae-site'), note: v('#ae-note').trim(),
            projectId: v('#ae-proj'), projectName: (() => { const p = store.projects.find((x) => x.id === v('#ae-proj')); return p ? [p.code, p.name].filter(Boolean).join(' · ') : ''; })(),
          }, file);
          const who = v('#ae-party').trim();
          if (who && !saved.some((n) => n.toLowerCase() === who.toLowerCase())) { saved.push(who); saveAcctParty(partyKey, who).catch(() => {}); }
          if (next) {
            // Keep everything except the amount (and the attached copy) for the next entry.
            added++; addedSum = r2(addedSum + amount);
            m.querySelector('#ae-added').innerHTML = `✓ Saved ${added} ${income ? 'income' : 'expense'}${added === 1 ? '' : 's'} · total ${fmtMoney(addedSum)} — last: ${esc(category)}${who ? `, ${esc(who)}` : ''} ${fmtMoney(amount)}`;
            m.querySelector('#ae-amt').value = '';
            m.querySelector('#ae-file').value = ''; file = null;
            btns.forEach((b) => { b.disabled = false; });
            m.querySelector('#ae-amt').focus();
          } else {
            toast(e ? 'Saved' : `${income ? 'Income' : 'Expense'} added${added ? ` (${added + 1} in total)` : ''}`); close();
          }
        } catch (er) { m.querySelector('#ae-err').textContent = friendlyError(er); btns.forEach((b) => { b.disabled = false; }); }
      };
      m.querySelector('[data-yes]').onclick = () => save(false);
      m.querySelector('[data-next]')?.addEventListener('click', () => save(true));
      m.querySelector('#ae-amt').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); save(!e); } });
      setTimeout(() => m.querySelector('#ae-amt').focus(), 50);
    },
  });
}

/** Drop-down list under a text box: opens on click / focus, filters as you type, arrow keys + Enter to pick. */
function combo(input, getOptions) {
  const wrap = input.parentElement;
  wrap.classList.add('combo');
  const list = document.createElement('div');
  list.className = 'combo-list';
  wrap.appendChild(list);
  let items = [], hi = -1, showAll = false;
  const render = () => {
    const q = input.value.trim().toLowerCase();
    const opts = getOptions();
    items = showAll || !q ? opts : opts.filter((o) => o.toLowerCase().includes(q));
    if (!items.length) { list.style.display = 'none'; return; }
    list.innerHTML = items.slice(0, 60).map((o, i) => `<div class="combo-i ${i === hi ? 'hi' : ''} ${o === input.value ? 'cur' : ''}" data-i="${i}">${esc(o)}</div>`).join('');
    list.style.display = 'block';
  };
  const pick = (i) => { if (items[i] != null) { input.value = items[i]; input.dispatchEvent(new Event('change')); } list.style.display = 'none'; };
  input.addEventListener('focus', () => { showAll = true; hi = -1; render(); });
  input.addEventListener('click', () => { showAll = true; render(); });
  input.addEventListener('input', () => { showAll = false; hi = -1; render(); });
  input.addEventListener('blur', () => setTimeout(() => { list.style.display = 'none'; }, 150));
  input.addEventListener('keydown', (ev) => {
    if (list.style.display !== 'block') return;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); hi = Math.min(items.length - 1, hi + 1); render(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); hi = Math.max(0, hi - 1); render(); }
    else if (ev.key === 'Enter' && hi >= 0) { ev.preventDefault(); pick(hi); }
    else if (ev.key === 'Escape') list.style.display = 'none';
  });
  list.addEventListener('mousedown', (ev) => { const it = ev.target.closest('[data-i]'); if (it) { ev.preventDefault(); pick(Number(it.dataset.i)); } });
}

/** Add / edit money still to pay (salaries, supplier invoices…) or to receive (client payments). */
function pendingDialog(p, kind = p?.type || 'pay') {
  const pay = kind === 'pay';
  const color = pay ? RED : GREEN;
  modal({
    title: `${p ? 'Edit' : 'Add'} pending ${pay ? 'payment (to pay)' : 'receipt (to receive)'}`,
    body: `<div class="seg" style="margin-bottom:10px">${[['pay', 'To pay'], ['receive', 'To receive']].map(([k, l]) => `<button class="btn sm ${k === kind ? '' : 'ghost'}" data-k="${k}" ${p ? 'disabled' : ''}>${l}</button>`).join('')}</div>
      <div class="grid cols-2" style="gap:10px">
        <label class="f"><span>${pay ? 'Pay to' : 'Receive from'} *</span><input id="pp-party" autocomplete="off" value="${esc(p?.party || '')}" placeholder="${pay ? 'Supplier, employee…' : 'Client…'}"></label>
        <label class="f"><span>For (category)</span><input id="pp-cat" autocomplete="off" value="${esc(p?.category || (pay ? 'Supplier payment' : 'Client payment'))}"></label>
        <label class="f"><span>Total amount (AED) *</span><input id="pp-amt" type="number" min="0" step="0.01" value="${p ? p.amount : ''}" style="font-weight:800;color:${color}"></label>
        <label class="f"><span>Due date</span><input id="pp-due" type="date" value="${esc(p?.dueDate || '')}"></label>
        <label class="f"><span>Method (expected)</span><select id="pp-m">${ACCT_METHODS.map((x) => `<option ${x === (p?.method || 'Bank transfer') ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="f"><span>Reference (invoice / cheque no.)</span><input id="pp-ref" value="${esc(p?.reference || '')}"></label>
      </div>
      <label class="f"><span>Note</span><input id="pp-note" value="${esc(p?.note || '')}" placeholder="${pay ? 'e.g. October salary balance, invoice 4521' : 'e.g. Project ABC — 2nd payment'}"></label>
      ${p && p.paid ? `<div class="small muted">Already ${pay ? 'paid' : 'received'}: <b>${fmtMoney(p.paid)}</b> — remaining ${fmtMoney(p.remaining)}</div>` : ''}
      <div class="error" id="pp-err"></div>`,
    foot: `<button class="btn ghost" data-no>Cancel</button><button class="btn" data-yes style="background:${color};border-color:${color}">${p ? 'Save' : 'Add'}</button>`,
    onMount: (m, close) => {
      const v = (id) => m.querySelector(id).value;
      m.querySelectorAll('[data-k]').forEach((b) => { b.onclick = () => { close(); pendingDialog(null, b.dataset.k); }; });
      let parties = [];
      getAcctParties().then((x) => { parties = pay ? x.paidTo : x.receivedFrom; }).catch(() => {});
      combo(m.querySelector('#pp-party'), () => parties);
      combo(m.querySelector('#pp-cat'), () => (pay ? ACCT_EXPENSE : ACCT_INCOME));
      m.querySelector('[data-no]').onclick = close;
      m.querySelector('[data-yes]').onclick = async () => {
        const amount = Number(v('#pp-amt')), party = v('#pp-party').trim();
        if (!(amount > 0) || !party) { m.querySelector('#pp-err').textContent = 'Who and how much are required.'; return; }
        if (p && amount < p.paid) { m.querySelector('#pp-err').textContent = `Already ${pay ? 'paid' : 'received'} ${fmtMoney(p.paid)} — the total can't be less.`; return; }
        try {
          await savePending(p?.id || null, { type: kind, party, category: v('#pp-cat').trim(), amount, dueDate: v('#pp-due'), method: v('#pp-m'), reference: v('#pp-ref').trim(), note: v('#pp-note').trim(),
            ...(p ? { status: amount - p.paid > 0.005 ? 'open' : 'done' } : {}) });
          toast(p ? 'Saved' : 'Pending payment added'); close();
        } catch (er) { m.querySelector('#pp-err').textContent = friendlyError(er); }
      };
      setTimeout(() => m.querySelector('#pp-party').focus(), 50);
    },
  });
}

/** Pay / receive all or part of a pending item — it is added to the accounts as an entry. */
function payDialog(p, onDone) {
  if (!p) return;
  const pay = p.type === 'pay';
  const color = pay ? RED : GREEN;
  modal({
    title: `${pay ? 'Pay' : 'Receive'} — ${p.party}`,
    body: `<p class="small muted" style="margin-top:0">${esc(p.category)}${p.note ? ` · ${esc(p.note)}` : ''}. Remaining <b>${fmtMoney(p.remaining)}</b> of ${fmtMoney(p.amount)}. A part payment keeps the rest pending.</p>
      <div class="grid cols-2" style="gap:10px">
        <label class="f"><span>Amount (AED) *</span><input id="py-amt" type="number" min="0" step="0.01" value="${p.remaining}" style="font-weight:800;color:${color}"></label>
        <label class="f"><span>Date *</span><input id="py-date" type="date" value="${dateKey(new Date())}"></label>
        <label class="f"><span>Method</span><select id="py-m">${ACCT_METHODS.map((x) => `<option ${x === (p.method || 'Bank transfer') ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="f"><span>Reference</span><input id="py-ref" value="${esc(p.reference || '')}"></label>
      </div><div class="error" id="py-err"></div>`,
    foot: `<button class="btn ghost" data-no>Cancel</button><button class="btn" data-yes style="background:${color};border-color:${color}">${pay ? 'Record payment' : 'Record receipt'}</button>`,
    onMount: (m, close) => {
      const v = (id) => m.querySelector(id).value;
      m.querySelector('[data-no]').onclick = close;
      m.querySelector('[data-yes]').onclick = async (ev) => {
        const amount = Number(v('#py-amt'));
        if (!(amount > 0) || !v('#py-date')) { m.querySelector('#py-err').textContent = 'Enter the amount and date.'; return; }
        if (amount > p.remaining + 0.005) { m.querySelector('#py-err').textContent = `More than the remaining ${fmtMoney(p.remaining)} — edit the pending total first.`; return; }
        ev.currentTarget.disabled = true;
        try {
          await payPending(p, { amount, date: v('#py-date'), method: v('#py-m'), reference: v('#py-ref').trim() });
          toast(amount < p.remaining - 0.005 ? `Part ${pay ? 'payment' : 'receipt'} recorded — ${fmtMoney(r2(p.remaining - amount))} still pending` : `${pay ? 'Paid' : 'Received'} in full`);
          close(); onDone && onDone();
        } catch (er) { m.querySelector('#py-err').textContent = friendlyError(er); ev.currentTarget.disabled = false; }
      };
    },
  });
}

function report(list, from, to, bf, P = null) {
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
        ...(P ? [['', ''], ['OVERALL (all dates)', ''], ['Current balance', P.bal], ['  cash', P.cash], ['  bank', P.bank], ['Total income', P.inc], ['Total expenses', P.exp],
          ['Pending to pay', P.toPay], ['Pending to receive', P.toGet], ['Projected balance', P.projected]] : []),
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
