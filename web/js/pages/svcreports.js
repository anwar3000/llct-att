// Service reports, call-out reports and delivery notes — the same documents as LLCT Invoicing (inv_docs)
// and the attendance app. Open / create them in LLCT Invoicing; the Service Desk link is next to them.
import { db } from '../fb.js';
import { collection, doc, getDoc, onSnapshot, query, where } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { esc, pill, fmtDate } from '../util.js';

const INV = 'https://anwar3000.github.io/llct-invoice/';
const inv = (view, p) => `${INV}#/${view}?${encodeURIComponent(JSON.stringify(p))}`;
const KINDS = { service: 'Service report', callout: 'Call-out report', delivery: 'Delivery note' };
const kindOf = (d) => (d.reportType === 'service' || d.reportType === 'callout' ? d.reportType : 'delivery');
const dateOf = (s) => (s ? fmtDate(new Date(String(s).length <= 10 ? `${s}T00:00:00` : s)) : '—');

let tab = 'service';
let q = '';

export function mount(el, params, { setHeader }) {
  let docs = null, err = '', deskUrl = '';
  const head = () => setHeader('Service & delivery reports', 'Same documents as LLCT Invoicing and the attendance app',
    `<a class="btn" target="_blank" rel="noopener" href="${inv('edit', { type: 'delivery', rt: 'service' })}">+ Service report</a>
     <a class="btn ghost" target="_blank" rel="noopener" href="${inv('edit', { type: 'delivery' })}">+ Delivery note</a>
     ${deskUrl ? `<a class="btn ghost" target="_blank" rel="noopener" href="${esc(deskUrl)}">Service desk</a>` : ''}`);
  head();
  getDoc(doc(db, 'settings', 'service')).then((s) => { deskUrl = (s.exists() && s.data().deskUrl) || ''; head(); }).catch(() => {});

  const draw = () => {
    if (err) {
      el.innerHTML = `<div class="card card-pad"><b>Reports could not be loaded.</b><div class="muted">${esc(err)}</div>
        <div class="muted small" style="margin-top:6px">Managers need access in LLCT Invoicing → Staff & access (delivery notes).</div></div>`;
      return;
    }
    if (!docs) { el.innerHTML = '<div class="card card-pad muted">Loading…</div>'; return; }
    const count = (k) => docs.filter((d) => kindOf(d) === k).length;
    const s = q.toLowerCase();
    const list = docs.filter((d) => tab === 'all' || kindOf(d) === tab).filter((d) => !s || [d.number, d.client && d.client.name, d.deliveryAddress, d.siteName, d.subject, d.ref, d.createdByName,
      ...(d.items || []).flatMap((i) => i.serials || [])].join(' ').toLowerCase().includes(s));
    el.innerHTML = `<div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <div class="seg">${[['service', 'Service'], ['callout', 'Call-out'], ['delivery', 'Delivery'], ['all', 'All']].map(([k, l]) =>
          `<button class="btn sm ${tab === k ? '' : 'ghost'}" data-tab="${k}">${l} <span style="opacity:.7">${k === 'all' ? docs.length : count(k)}</span></button>`).join('')}</div>
        <input id="sr-q" placeholder="Search number, client, site, serial…" value="${esc(q)}" style="flex:1;min-width:200px;max-width:420px">
      </div>
      <div class="card" style="overflow:auto"><table class="t"><thead><tr><th>Number</th><th>Date</th><th>Type</th><th>Client</th><th>Site</th><th>Made by</th><th>Status</th></tr></thead><tbody>
      ${list.map((d) => `<tr style="cursor:pointer" data-open="${esc(d.id)}">
        <td class="mono"><b>${esc(d.number)}</b>${d.ticketNo ? `<div class="small muted">Ticket ${esc(d.ticketNo)}</div>` : ''}</td>
        <td class="nowrap">${dateOf(d.date)}</td><td>${KINDS[kindOf(d)]}</td>
        <td>${esc((d.client && d.client.name) || '—')}</td><td>${esc(String(d.deliveryAddress || d.siteName || '').split('\n')[0])}</td>
        <td>${esc(d.createdByName || '')}</td>
        <td>${d.delivery && d.delivery.signedAt ? pill(kindOf(d) === 'delivery' ? 'Delivered' : 'Signed off', 'green') : pill('Waiting for signature', 'amber')}</td></tr>`).join('')
        || '<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">No reports.</td></tr>'}
      </tbody></table></div>
      <p class="muted small">Click a report to open it in LLCT Invoicing (PDF, edit, sign). Staff can also make and sign reports in the attendance app.</p>`;
    el.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; draw(); }; });
    const qi = el.querySelector('#sr-q');
    qi.oninput = () => { q = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { draw(); const n = el.querySelector('#sr-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
    el.querySelectorAll('[data-open]').forEach((r) => { r.onclick = () => window.open(inv('view', { id: r.dataset.open }), '_blank', 'noopener'); });
  };
  draw();
  const unsub = onSnapshot(query(collection(db, 'inv_docs'), where('type', '==', 'delivery')), (s) => {
    docs = s.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    err = ''; draw();
  }, (e) => { err = e.code || e.message; draw(); });
  return () => unsub();
}
