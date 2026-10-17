import { store, isAdmin, addPetty, reviewPetty, deletePetty } from '../fb.js';
import {
  esc, icon, avatar, pill, cap, fmtMoney, fmtDateTime, toast, modal, confirmBox, promptBox, friendlyError, b64img, photoViewer, statusPill,
  dateKey, startOfMonth, addDays,
} from '../util.js';
import { pettySummary } from '../calc.js';
import { pettyReport, downloadReport } from '../report-lib.js';

const CATS = ['Fuel', 'Food', 'Travel', 'Materials', 'Tools', 'Other'];

export function mount(el, _p, { setHeader }) {
  if (!isAdmin()) { el.innerHTML = '<div class="card empty"><b>Accounts are restricted</b>Only admins can see petty cash.</div>'; return () => {}; }
  let emp = '', type = 'all';
  setHeader('Petty cash', 'Cash given to staff, expenses claimed and approvals',
    `<button class="btn ghost" id="pc-x">${icon('download', 16)} Statement</button>
     <button class="btn" id="pc-give">${icon('plus', 16)} Give cash / add expense</button>`);
  document.getElementById('pc-give').onclick = () => giveCash(emp);
  document.getElementById('pc-x').onclick = () => statementDialog(emp);

  function draw() {
    const all = store.petty;
    const total = pettySummary(all);
    const pending = all.filter((t) => t.status === 'pending');
    const byEmp = new Map();
    for (const t of all) { if (!byEmp.has(t.employeeId)) byEmp.set(t.employeeId, []); byEmp.get(t.employeeId).push(t); }
    const balances = [...byEmp.entries()].map(([id, list]) => ({ id, name: store.user(id)?.name || list[0].employeeName, s: pettySummary(list) }))
      .sort((a, b) => b.s.balance - a.s.balance);
    const filtered = all.filter((t) => (!emp || t.employeeId === emp) &&
      (type === 'all' || (type === 'credit' && t.type === 'credit') || (type === 'expense' && t.type !== 'credit') || (type === 'rejected' && t.status === 'rejected')));

    el.innerHTML = `
    <div class="grid kpis">
      ${k('Cash given (approved)', fmtMoney(total.credited), '', '#2E9E6A')}
      ${k('Spent (approved)', fmtMoney(total.spent), '', '#D64545')}
      ${k('Cash with staff', fmtMoney(total.balance), 'given − spent', '#D98A1A')}
      ${k('Pending approval', fmtMoney(total.pending), `${pending.length} entries`, '#E08E2B')}
    </div>
    ${pending.length ? `<div class="card mt"><div class="card-head"><h2>Waiting for approval</h2><span class="muted small">${pending.length}</span></div>
      <div class="table-wrap"><table class="t"><tr><th>Employee</th><th>Type</th><th>Details</th><th>Receipt</th><th class="num">Amount</th><th></th></tr>
      ${pending.map((t) => `<tr><td><div class="person">${avatar(t.employeeName, 28)}<span class="nm">${esc(t.employeeName)}</span></div><div class="small muted">${fmtDateTime(t.createdLocal)}</div></td>
        <td>${esc(t.type === 'credit' ? 'Cash received' : t.category)}</td><td class="small">${esc(t.note)}${t.siteName ? `<div class="muted">${esc(t.siteName)}</div>` : ''}</td>
        <td>${t.receipt ? `<img src="${b64img(t.receipt)}" data-photo style="width:44px;height:44px;object-fit:cover;border-radius:8px;cursor:zoom-in">` : '<span class="muted small">—</span>'}</td>
        <td class="num"><b style="color:${t.type === 'credit' ? '#2E9E6A' : '#D64545'}">${t.type === 'credit' ? '+' : '−'}${fmtMoney(t.amount)}</b></td>
        <td class="right nowrap"><button class="btn sm ghost" data-no="${t.id}">Reject</button> <button class="btn sm success" data-yes="${t.id}">Approve</button></td></tr>`).join('')}
      </table></div></div>` : ''}
    <div class="grid cols-2-1 mt" style="grid-template-columns:minmax(0,1fr) minmax(0,2fr)">
      <div class="card"><div class="card-head"><h2>Balance by employee</h2></div>
        ${balances.length ? balances.map((b) => `<div class="list-item" data-emp="${b.id}" style="cursor:pointer;${emp === b.id ? 'background:#eef6f7' : ''}">
          ${avatar(b.name, 30)}<div class="grow"><b>${esc(b.name)}</b><div class="small muted">Got ${fmtMoney(b.s.credited)} · spent ${fmtMoney(b.s.spent)}${b.s.pendingCount ? ` · ${b.s.pendingCount} pending` : ''}</div></div>
          <b style="color:${b.s.balance < 0 ? '#D64545' : 'inherit'}">${fmtMoney(b.s.balance)}</b></div>`).join('') : '<div class="empty">No petty cash yet</div>'}
      </div>
      <div class="card"><div class="card-head"><h2>${emp ? `Transactions · ${esc(store.user(emp)?.name || '')}` : 'All transactions'}</h2>
        ${emp ? '<button class="btn sm ghost" id="pc-all">Show all</button>' : ''}</div>
        <div class="card-pad" style="padding-bottom:0"><div class="chips">${[['all', 'All'], ['credit', 'Cash given'], ['expense', 'Expenses'], ['rejected', 'Rejected']]
          .map(([v, l]) => `<span class="chip ${type === v ? 'on' : ''}" data-t="${v}">${l}</span>`).join('')}</div></div>
        <div class="table-wrap" style="margin-top:10px"><table class="t"><tr><th>Date</th><th>Employee</th><th>Item</th><th class="num">Amount</th><th>Status</th><th></th></tr>
        ${filtered.slice(0, 300).map((t) => `<tr>
          <td class="small nowrap">${fmtDateTime(t.createdLocal)}</td><td>${esc(t.employeeName)}</td>
          <td>${esc(t.type === 'credit' ? 'Cash given' : t.category)}<div class="small muted">${esc([t.siteName, t.note].filter(Boolean).join(' · '))}</div></td>
          <td class="num" style="color:${t.type === 'credit' ? '#2E9E6A' : '#D64545'}">${t.type === 'credit' ? '+' : '−'}${fmtMoney(t.amount)}</td>
          <td>${statusPill(t.status)}${t.reviewNote ? `<div class="small muted">${esc(t.reviewNote)}</div>` : ''}</td>
          <td class="right"><button class="btn sm ghost icon" data-delp="${t.id}" title="Delete">${icon('trash', 14)}</button></td></tr>`).join('')
          || '<tr><td colspan="6"><div class="empty">Nothing here</div></td></tr>'}
        </table></div></div>
    </div>`;

    el.querySelectorAll('[data-photo]').forEach((i) => { i.onclick = () => photoViewer(i.src); });
    el.querySelectorAll('[data-yes]').forEach((b) => { b.onclick = () => reviewPetty(b.dataset.yes, true, store.me.name).then(() => toast('Approved')); });
    el.querySelectorAll('[data-no]').forEach((b) => {
      b.onclick = async () => {
        const r = await promptBox('Reject entry', 'Reason (shown to employee)', { ok: 'Reject' });
        if (r === null) return;
        await reviewPetty(b.dataset.no, false, store.me.name, r); toast('Rejected');
      };
    });
    el.querySelectorAll('[data-delp]').forEach((b) => {
      b.onclick = async () => {
        if (!await confirmBox('Delete entry?', 'This changes the employee balance.', { ok: 'Delete', danger: true })) return;
        await deletePetty(b.dataset.delp); toast('Deleted');
      };
    });
    el.querySelectorAll('[data-emp]').forEach((r) => { r.onclick = () => { emp = emp === r.dataset.emp ? '' : r.dataset.emp; draw(); }; });
    el.querySelectorAll('[data-t]').forEach((c) => { c.onclick = () => { type = c.dataset.t; draw(); }; });
    el.querySelector('#pc-all')?.addEventListener('click', () => { emp = ''; draw(); });
  }
  draw();
  return store.on(draw);
}

function giveCash(preselect) {
  const emps = store.activeEmployees;
  if (!emps.length) return toast('Add employees first', true);
  modal({
    title: 'Give cash / record expense',
    body: `<form id="gc"><div class="fields">
      <label class="f full"><span>Type</span><select name="type"><option value="credit">Cash given to employee (+)</option><option value="expense">Expense by employee (−)</option></select></label>
      <label class="f"><span>Employee</span><select name="emp">${emps.map((u) => `<option value="${u.id}" ${preselect === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
      <label class="f"><span>Amount (₹)</span><input name="amount" type="number" min="1" step="1" required></label>
      <label class="f" id="gc-cat"><span>Category</span><select name="cat">${CATS.map((c) => `<option>${c}</option>`).join('')}</select></label>
      <label class="f"><span>Site (optional)</span><select name="site"><option value="">— None —</option>${store.sites.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
      <label class="f full"><span>Note</span><input name="note"></label>
    </div><div class="error" id="gc-err"></div></form>`,
    foot: '<button class="btn ghost" data-cancel>Cancel</button><button class="btn" data-save>Save (approved)</button>',
    onMount: (m, close) => {
      const f = m.querySelector('#gc');
      const sync = () => { m.querySelector('#gc-cat').style.display = f.type.value === 'credit' ? 'none' : ''; };
      f.type.onchange = sync; sync();
      m.querySelector('[data-cancel]').onclick = close;
      m.querySelector('[data-save]').onclick = async () => {
        const amount = Number(f.amount.value);
        if (!(amount > 0)) { m.querySelector('#gc-err').textContent = 'Enter an amount.'; return; }
        try {
          await addPetty({
            emp: store.user(f.emp.value), type: f.type.value, amount,
            category: f.type.value === 'credit' ? 'Cash advance' : f.cat.value, note: f.note.value.trim(),
            site: f.site.value ? store.site(f.site.value) : null, me: store.me,
          });
          close(); toast('Saved');
        } catch (e) { m.querySelector('#gc-err').textContent = friendlyError(e); }
      };
    },
  });
}

function statementDialog(emp) {
  const t = new Date();
  modal({
    title: 'Download petty cash statement',
    body: `<div class="fields">
      <label class="f"><span>From</span><input type="date" id="ps-f" value="${dateKey(startOfMonth(t))}"></label>
      <label class="f"><span>To</span><input type="date" id="ps-t" value="${dateKey(t)}"></label>
      <label class="f full"><span>Employee</span><select id="ps-e"><option value="">All employees</option>${store.employees.map((u) => `<option value="${u.id}" ${emp === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label></div>`,
    foot: `<button class="btn ghost" data-f="csv">CSV</button><button class="btn ghost" data-f="pdf">PDF</button><button class="btn" data-f="xlsx">Excel</button>`,
    onMount: (m, close) => {
      m.querySelectorAll('[data-f]').forEach((b) => {
        b.onclick = async () => {
          try {
            await downloadReport(await pettyReport(m.querySelector('#ps-f').value, m.querySelector('#ps-t').value, m.querySelector('#ps-e').value || null), b.dataset.f);
            close();
          } catch (e) { toast(e.message, true); }
        };
      });
    },
  });
}

const k = (label, value, sub, color) => `<div class="card kpi"><div class="lbl"><i class="dot" style="color:${color}"></i>${esc(label)}</div><div class="val" style="font-size:22px">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;
