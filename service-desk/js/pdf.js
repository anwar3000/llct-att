// PDF reports for the staff desk: a branded print page the browser saves as PDF
// (Print → Save as PDF). No server software or PDF library needed.
import { esc, fmtDate, fmtDT, prio, st, typesText, slotLabel, COMPANY, toDate, clientMessage } from './sd.js';

// The logo is embedded in the PDF page (data URL), so it always prints.
let logoData = '';
fetch('img/shield-256.png').then((r) => r.blob()).then((b) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }))
  .then((d) => { logoData = d; }).catch(() => {});
const logo = () => logoData || new URL('img/shield-256.png', location.href).href;

const CSS = `
  @page { size: A4 PORTRAIT; margin: 14mm 12mm 16mm; }
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.45 Arial, Helvetica, sans-serif; color: #18202E; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .bar { height: 5px; background: linear-gradient(90deg, #1C47AE 0 70%, #B4372B 70% 100%); margin-bottom: 14px; }
  .hd { display: flex; align-items: center; gap: 14px; padding-bottom: 12px; border-bottom: 1px solid #D5D9E0; margin-bottom: 14px; }
  .hd img { width: 54px; }
  .hd .co b { font-size: 13pt; color: #0E1F45; letter-spacing: .04em; }
  .hd .co div { color: #5B6472; font-size: 9pt; }
  .hd .dt { margin-left: auto; text-align: right; }
  .hd .dt h1 { margin: 0; font-size: 16pt; color: #0E1F45; }
  .hd .dt div { color: #5B6472; font-size: 9pt; }
  h2 { font-size: 11.5pt; color: #0E1F45; margin: 16px 0 6px; padding-bottom: 3px; border-bottom: 2px solid #1C47AE; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  th { text-align: left; background: #0E1F45; color: #fff; padding: 5px 6px; font-weight: 600; }
  td { padding: 5px 6px; border-bottom: 1px solid #E3E6EB; vertical-align: top; }
  tr:nth-child(even) td { background: #F7F8FA; }
  .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 4px 0 6px; }
  .kpi { border: 1px solid #D5D9E0; border-radius: 6px; padding: 7px 9px; }
  .kpi b { display: block; font-size: 15pt; color: #0E1F45; }
  .kpi span { color: #5B6472; font-size: 8.5pt; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .kv { display: grid; grid-template-columns: 34mm 1fr; gap: 3px 10px; }
  .kv span:nth-child(odd) { color: #5B6472; }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 8.5pt; font-weight: 700; }
  .box { border: 1px solid #D5D9E0; border-radius: 6px; padding: 9px 11px; }
  .msg { background: #F2F4F7; border-left: 3px solid #1C47AE; padding: 7px 10px; }
  .photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .photos figure { margin: 0; break-inside: avoid; }
  .photos img { width: 100%; height: 48mm; object-fit: cover; border: 1px solid #D5D9E0; border-radius: 4px; }
  .photos figcaption { font-size: 8.5pt; color: #5B6472; }
  .sig img { max-height: 22mm; }
  .ft { position: fixed; bottom: 0; left: 0; right: 0; font-size: 8pt; color: #5B6472; display: flex; justify-content: space-between; border-top: 1px solid #D5D9E0; padding-top: 4px; }
  .muted { color: #5B6472; }
  .pre { white-space: pre-line; }
  .tip { font: 13px Arial; background: #FFF6E0; border: 1px solid #F0D48A; padding: 8px 12px; margin-bottom: 12px; border-radius: 6px; }
  @media print { .tip { display: none; } }
  tr, .box { break-inside: avoid; }
`;

/** Opens the print page; the person chooses "Save as PDF". */
export function printDoc(title, subtitle, body, { landscape = false } = {}) {
  const w = window.open('', '_blank');
  if (!w) { alert('Allow pop-ups for this site to make PDFs.'); return; }
  const now = new Date();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>${CSS.replace('PORTRAIT', landscape ? 'landscape' : 'portrait')}</style></head><body>
    <div class="tip">In the print window choose <b>Save as PDF</b> as the printer.</div>
    <div class="bar"></div>
    <div class="hd"><img src="${logo()}" alt=""><div class="co"><b>LEADERS LINE TRADING LLC</b><div>Airport Road, Dubai · ${esc(COMPANY.phone)} · ${esc(COMPANY.email)} · ${esc(COMPANY.web)}</div></div>
      <div class="dt"><h1>${esc(title)}</h1><div>${esc(subtitle || '')}</div></div></div>
    ${body}
    <div class="ft"><span>Leaders Line Service Desk</span><span>Printed ${esc(fmtDT(now))}</span></div>
    <script>
      window.onload = function () {
        var imgs = Array.prototype.slice.call(document.images);
        Promise.all(imgs.map(function (i) { return i.complete ? 0 : new Promise(function (r) { i.onload = i.onerror = r; }); }))
          .then(function () { setTimeout(function () { window.print(); }, 250); });
      };
    <\/script></body></html>`);
  w.document.close();
}

const pill = (s) => `<span class="pill" style="background:${s.c}22;color:${s.c}">${esc(s.t)}</span>`;
const mins = (a, b) => { const x = toDate(a), y = toDate(b); return x && y ? (y - x) / 60000 : null; };
const fmtMins = (v) => (v == null || isNaN(v) ? '—' : v < 60 ? `${Math.round(v)} min` : v < 1440 ? `${(v / 60).toFixed(1)} h` : `${(v / 1440).toFixed(1)} d`);
const avg = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

function ticketsTable(ts, { client = true } = {}) {
  return `<table><thead><tr><th>Ticket</th><th>Raised</th>${client ? '<th>Client</th>' : ''}<th>Site</th><th>Service</th><th>Priority</th><th>Status</th><th>Technician</th><th>Visit</th><th>Report</th></tr></thead><tbody>
    ${ts.map((t) => `<tr><td><b>${esc(t.number || t.id)}</b></td><td>${esc(fmtDate(t.createdAt))}</td>${client ? `<td>${esc(t.clientName)}</td>` : ''}<td>${esc(t.siteName)}</td>
      <td>${esc(typesText(t))}</td><td>${esc(prio(t.priority).t)}</td><td>${pill(st(t.status))}</td><td>${esc(t.assignedName || '—')}</td>
      <td>${esc(t.scheduledAt ? fmtDT(t.scheduledAt) : '—')}</td><td>${esc(t.reportNo || '')}</td></tr>`).join('') || '<tr><td colspan="10" class="muted">No tickets.</td></tr>'}
  </tbody></table>`;
}

function kpis(ts) {
  return `<div class="kpis">
    <div class="kpi"><b>${ts.length}</b><span>Tickets</span></div>
    <div class="kpi"><b>${ts.filter((t) => ['completed', 'closed'].includes(t.status)).length}</b><span>Completed</span></div>
    <div class="kpi"><b>${ts.filter((t) => t.open).length}</b><span>Still open</span></div>
    <div class="kpi"><b>${fmtMins(avg(ts.map((t) => mins(t.createdAt, t.assignedAt))))}</b><span>Average time to assign</span></div>
    <div class="kpi"><b>${fmtMins(avg(ts.map((t) => mins(t.createdAt, t.arrivedAt))))}</b><span>Average time to reach site</span></div>
    <div class="kpi"><b>${fmtMins(avg(ts.map((t) => mins(t.createdAt, t.completedAt))))}</b><span>Average time to complete</span></div>
  </div>`;
}

function groupTable(title, ts, keyFn) {
  const o = {}; ts.forEach((t) => { (keyFn(t) || ['—']).forEach((k) => { o[k] = (o[k] || 0) + 1; }); });
  const rows = Object.entries(o).sort((a, b) => b[1] - a[1]);
  return `<div><h2>${esc(title)}</h2><table><tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td style="text-align:right"><b>${v}</b></td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</tbody></table></div>`;
}

/** Period report: totals, breakdowns and every ticket. */
export function periodPdf(ts, { from, to, clientName = '', techName = '' }) {
  const sub = `${fmtDate(from)} to ${fmtDate(to)}${clientName ? ` · ${clientName}` : ''}${techName ? ` · ${techName}` : ''}`;
  const types = (t) => (Array.isArray(t.categories) && t.categories.length ? typesText(t).split(', ') : [typesText(t)]);
  printDoc('Service report', sub, `${kpis(ts)}
    <div class="grid2">${groupTable('By client', ts, (t) => [t.clientName])}${groupTable('By technician', ts, (t) => [t.assignedName || 'Not assigned'])}</div>
    <div class="grid2">${groupTable('By service type', ts, types)}${groupTable('By priority', ts, (t) => [prio(t.priority).t])}</div>
    <h2>Tickets</h2>${ticketsTable(ts)}`, { landscape: true });
}

/** One client's ticket history. */
export function clientPdf(clientName, ts) {
  const bySite = {}; ts.forEach((t) => { bySite[t.siteName] = (bySite[t.siteName] || 0) + 1; });
  printDoc('Service history', clientName, `${kpis(ts)}
    <h2>By site</h2><table><tbody>${Object.entries(bySite).map(([k, v]) => `<tr><td>${esc(k)}</td><td style="text-align:right"><b>${v}</b></td></tr>`).join('')}</tbody></table>
    <h2>Tickets</h2>${ticketsTable(ts, { client: false })}`, { landscape: true });
}

/** Job sheet for one ticket: details, progress, service report, photos. */
export function ticketPdf(t, { report = null, photos = [] } = {}) {
  const p = prio(t.priority), s = st(t.status);
  const items = report && Array.isArray(report.items) ? report.items : [];
  printDoc('Service ticket', `${t.number || t.id} · ${s.staff}`, `
    <div class="grid2">
      <div class="box"><div class="kv">
        <span>Client</span><b>${esc(t.clientName)}</b>
        <span>Site</span><span>${esc(t.siteName)}${t.siteAddress ? `<br><span class="muted">${esc(t.siteAddress)}</span>` : ''}</span>
        <span>Contact</span><span>${esc(t.contactName || '')} ${esc(t.contactPhone || '')}</span>
        ${Number.isFinite(t.lat) ? `<span>GPS</span><span>${t.lat.toFixed(5)}, ${t.lng.toFixed(5)}</span>` : ''}
      </div></div>
      <div class="box"><div class="kv">
        <span>Priority</span><span>${pill({ t: p.t, c: p.c })}</span>
        <span>Status</span><span>${pill(s)}</span>
        <span>Raised</span><span>${esc(fmtDT(t.createdAt))}</span>
        <span>Preferred</span><span>${esc(fmtDate(t.preferredDate))}, ${esc((slotLabel(t.preferredSlot) || '').toLowerCase())}</span>
        <span>Technician</span><span>${esc(t.assignedName || 'Not assigned')}</span>
        <span>Visit</span><span>${esc(t.scheduledAt ? fmtDT(t.scheduledAt) : '—')}</span>
      </div></div>
    </div>
    <h2>Request</h2>
    <p><b>${esc(typesText(t))}</b>${t.cameras ? ` · ${esc(t.cameras)} device(s)` : ''}</p>
    <p class="pre">${esc(t.description || '')}</p>
    <div class="msg">${esc(clientMessage(t))}</div>
    ${report ? `<h2>${esc(report.kind || 'Service report')} ${esc(report.number || '')}</h2>
      <p class="muted">${esc(fmtDate(report.date))}${report.technician ? ` · Technician ${esc(report.technician)}` : ''}${report.timeIn || report.timeOut ? ` · ${esc(report.timeIn || '–')} to ${esc(report.timeOut || '–')}` : ''}</p>
      ${report.complaint ? `<p><b>Complaint</b><br><span class="pre">${esc(report.complaint)}</span></p>` : ''}
      ${report.workDone ? `<p><b>Work carried out</b><br><span class="pre">${esc(report.workDone)}</span></p>` : ''}
      ${items.length ? `<table><thead><tr><th>Item</th><th>Qty</th><th>Status</th><th>Serial numbers</th></tr></thead><tbody>${items.map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.qty)} ${esc(i.unit || '')}</td><td>${esc(i.status || '')}</td><td>${esc((i.serials || []).join(', '))}</td></tr>`).join('')}</tbody></table>` : ''}
      <p>${report.signedAt ? `Signed by <b>${esc(report.receiver || 'customer')}</b> on ${esc(fmtDT(report.signedAt))}` : '<span class="muted">Not signed yet.</span>'}</p>`
      : (t.reportNo ? `<h2>Service report</h2><p>${esc(t.reportNo)}</p>` : '')}
    <h2>Progress</h2>
    <table><thead><tr><th style="width:42mm">When</th><th>What happened</th><th style="width:40mm">By</th></tr></thead><tbody>
      ${(t.log || []).map((l) => `<tr><td>${esc(fmtDT(l.at))}</td><td>${esc(l.t)}</td><td>${esc(l.byName || '')}</td></tr>`).join('')}
    </tbody></table>
    ${photos.length ? `<h2>Photos</h2><div class="photos">${photos.map((ph, i) => `<figure><img src="${ph.data}" alt=""><figcaption>${String(i + 1).padStart(2, '0')} ${esc(ph.caption || '')}</figcaption></figure>`).join('')}</div>` : ''}
  `);
}
