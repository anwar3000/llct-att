// Report builders + Excel / PDF / CSV export.
import {
  store, isAdmin, alertsInRange, alertLabel, sessionsInRange, offDaysInRange, updatesInRange, sessionsForSites, updatesForSites, sessionMinutes, sessionFlagged,
} from './fb.js';
import {
  dateKey, parseKey, startOfMonth, endOfMonth, daysInMonth, fmtMonth, fmtMins, hoursDec, fmtDate, cap, WEEKDAYS,
} from './util.js';
import { employeeSummary, employeeDays, pettySummary, flagText } from './calc.js';

const t2 = (d) => (d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '');
const d2 = (d) => (d ? dateKey(d) : '');
const round = (n) => (n == null ? '' : Math.round(n));

// ================================================================== builders
export async function monthlySummaryReport(month, onlyIds = null) {
  const from = dateKey(startOfMonth(month)), to = dateKey(endOfMonth(month));
  const [sessions, offs] = await Promise.all([sessionsInRange(from, to), offDaysInRange(from, to)]);
  const users = store.employees.filter((u) => (onlyIds ? onlyIds.includes(u.id) : u.active || sessions.some((s) => s.employeeId === u.id)));
  const rows = users.map((u) => {
    const s = employeeSummary(u, sessions, offs, from, to);
    return [u.name, u.loginId, u.designation, s.workedDays, s.offDays, s.absentDays, fmtMins(s.minutes), hoursDec(s.minutes),
      fmtMins(s.avgMinutes), s.visits, s.sites.join(', '), s.flagged, s.avgStart,
      u.weeklyOffDays.length ? u.weeklyOffDays.map((w) => WEEKDAYS[w]).join('/') : 'Flexible'];
  });
  const tot = rows.reduce((a, r) => { a[0] += r[3]; a[1] += r[4]; a[2] += r[5]; a[3] += r[7]; a[4] += r[9]; a[5] += r[11]; return a; }, [0, 0, 0, 0, 0, 0]);
  return {
    title: `Monthly attendance summary — ${fmtMonth(month)}`,
    subtitle: `${users.length} employees · period ${from} to ${to}`,
    filename: `attendance-summary-${from.slice(0, 7)}`,
    sheets: [{
      name: 'Summary',
      columns: ['Employee', 'Login ID', 'Designation', 'Days worked', 'Off days', 'Absent', 'Total time', 'Hours (decimal)',
        'Avg / day', 'Site visits', 'Sites', 'Flagged', 'Avg start', 'Weekly off'],
      widths: [22, 12, 16, 11, 9, 8, 11, 13, 10, 10, 30, 8, 10, 12],
      rows,
      totals: ['TOTAL', '', '', tot[0], tot[1], tot[2], fmtMins(tot[3] * 60), Math.round(tot[3] * 100) / 100, '', tot[4], '', tot[5], '', ''],
    }],
  };
}

export async function dailyMatrixReport(month) {
  const from = dateKey(startOfMonth(month)), to = dateKey(endOfMonth(month));
  const [sessions, offs] = await Promise.all([sessionsInRange(from, to), offDaysInRange(from, to)]);
  const n = daysInMonth(month);
  const users = store.employees.filter((u) => u.active || sessions.some((s) => s.employeeId === u.id));
  const rows = users.map((u) => {
    const days = employeeDays(u, sessions, offs, from, to);
    const cells = days.map((d) => (d.kind === 'worked' || (d.kind === 'today' && d.minutes) ? hoursDec(d.minutes)
      : d.kind === 'off' ? 'OFF' : d.kind === 'absent' ? 'A' : ''));
    const worked = days.filter((d) => d.sessions.length).length;
    const mins = days.reduce((a, d) => a + d.minutes, 0);
    return [u.name, ...cells, worked, days.filter((d) => d.kind === 'off').length, days.filter((d) => d.kind === 'absent').length, hoursDec(mins)];
  });
  const cols = ['Employee'];
  for (let i = 1; i <= n; i++) {
    const d = new Date(month.getFullYear(), month.getMonth(), i);
    cols.push(`${i} ${WEEKDAYS[d.getDay() === 0 ? 7 : d.getDay()][0]}`);
  }
  cols.push('Worked', 'Off', 'Absent', 'Hours');
  return {
    title: `Daily attendance register — ${fmtMonth(month)}`,
    subtitle: 'Numbers are hours worked · OFF = off day · A = absent',
    filename: `attendance-register-${from.slice(0, 7)}`,
    orientation: 'landscape',
    pdfFont: 6,
    sheets: [{ name: 'Register', columns: cols, widths: [22, ...Array(n).fill(5), 7, 5, 7, 8], rows }],
  };
}

export async function attendanceLogReport(from, to, empId = null, siteId = null) {
  const all = await sessionsInRange(from, to);
  const list = all.filter((s) => (!empId || s.employeeId === empId) && (!siteId || s.siteId === siteId));
  const rows = list.map((s) => [
    s.date, s.employeeName, s.siteName, t2(s.checkIn), s.checkOut ? t2(s.checkOut) : 'OPEN', fmtMins(sessionMinutes(s)),
    hoursDec(sessionMinutes(s)), round(s.inDistance), round(s.outDistance), round(s.inAccuracy), sessionFlagged(s) ? flagText(s) : 'OK',
    s.inLat != null ? `${s.inLat.toFixed(6)}, ${s.inLng.toFixed(6)}` : '', s.outLat != null ? `${s.outLat.toFixed(6)}, ${s.outLng.toFixed(6)}` : '', s.note,
  ]);
  const mins = list.reduce((a, s) => a + sessionMinutes(s), 0);
  const who = empId ? store.user(empId)?.name : null;
  const where = siteId ? store.site(siteId)?.name : null;
  return {
    title: `Attendance log${who ? ` — ${who}` : ''}${where ? ` — ${where}` : ''}`,
    subtitle: `${from} to ${to} · ${list.length} check-ins · ${fmtMins(mins)} total`,
    filename: `attendance-log-${from}-to-${to}`,
    orientation: 'landscape',
    sheets: [{
      name: 'Attendance log',
      columns: ['Date', 'Employee', 'Site', 'Check-in', 'Check-out', 'Duration', 'Hours', 'In dist (m)', 'Out dist (m)', 'GPS ± (m)', 'GPS check', 'Check-in location', 'Check-out location', 'Note'],
      widths: [11, 20, 20, 9, 10, 9, 7, 10, 11, 9, 22, 22, 22, 20],
      rows,
      totals: ['TOTAL', '', '', '', '', fmtMins(mins), hoursDec(mins), '', '', '', '', '', '', ''],
      pdfColumns: [0, 1, 2, 3, 4, 5, 6, 7, 8, 10],
    }],
  };
}

export async function pettyReport(from, to, empId = null) {
  if (!isAdmin()) throw new Error('Only admins can export accounts.');
  const inRange = (t) => { const k = t.date || d2(t.createdAt); return k >= from && k <= to; };
  const list = store.petty.filter((t) => inRange(t) && (!empId || t.employeeId === empId)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const rows = list.map((t) => [
    t.date || d2(t.createdAt), t.employeeName, t.type === 'credit' ? 'Cash given' : 'Expense', t.type === 'credit' ? 'Cash advance' : t.category,
    t.siteName, t.note, t.type === 'credit' ? t.amount : '', t.type !== 'credit' ? t.amount : '', cap(t.status), t.reviewedBy || t.createdByName, t.reviewNote,
  ]);
  const byEmp = new Map();
  for (const t of store.petty.filter((x) => !empId || x.employeeId === empId)) {
    if (!byEmp.has(t.employeeId)) byEmp.set(t.employeeId, { name: t.employeeName, all: [], period: [] });
    byEmp.get(t.employeeId).all.push(t);
    if (inRange(t)) byEmp.get(t.employeeId).period.push(t);
  }
  const bal = [...byEmp.values()].map((v) => {
    const p = pettySummary(v.period), a = pettySummary(v.all);
    return [v.name, p.credited, p.spent, p.pending, a.balance];
  }).sort((a, b) => a[0].localeCompare(b[0]));
  const ps = pettySummary(list);
  return {
    title: `Petty cash statement${empId ? ` — ${store.user(empId)?.name || ''}` : ''}`,
    subtitle: `${from} to ${to} · received ${Math.round(ps.credited)} · spent ${Math.round(ps.spent)} · pending ${Math.round(ps.pending)} (₹)`,
    filename: `petty-cash-${from}-to-${to}`,
    orientation: 'landscape',
    sheets: [
      {
        name: 'Balances',
        columns: ['Employee', 'Cash given in period (₹)', 'Spent in period (₹)', 'Pending (₹)', 'Current balance (₹)'],
        widths: [24, 22, 20, 14, 20],
        rows: bal,
        totals: ['TOTAL', ...[1, 2, 3, 4].map((i) => bal.reduce((a, r) => a + r[i], 0))],
      },
      {
        name: 'Transactions',
        columns: ['Date', 'Employee', 'Type', 'Category', 'Site', 'Note', 'Cash given (₹)', 'Spent (₹)', 'Status', 'By', 'Review note'],
        widths: [11, 20, 11, 13, 18, 28, 14, 11, 10, 16, 20],
        rows,
        totals: ['TOTAL', '', '', '', '', '', rows.reduce((a, r) => a + (r[6] || 0), 0), rows.reduce((a, r) => a + (r[7] || 0), 0), '', '', ''],
      },
    ],
  };
}

export async function updatesReport(from, to, siteId = null) {
  const list = (await updatesInRange(from, to)).filter((u) => !siteId || u.siteId === siteId).reverse();
  return {
    title: `Site updates${siteId ? ` — ${store.site(siteId)?.name || ''}` : ''}`,
    subtitle: `${from} to ${to} · ${list.length} updates`,
    filename: `site-updates-${from}-to-${to}`,
    orientation: 'landscape',
    sheets: [{
      name: 'Site updates',
      columns: ['Date', 'Time', 'Site', 'Employee', 'Category', 'Progress %', 'Note', 'Photos', 'Location'],
      widths: [11, 7, 20, 20, 11, 10, 60, 7, 22],
      rows: list.map((u) => [u.date || d2(u.createdAt), t2(u.createdAt), u.siteName, u.employeeName, u.category, u.progress ?? '', u.note, u.photos.length,
        u.lat != null ? `${u.lat.toFixed(6)}, ${u.lng.toFixed(6)}` : '']),
    }],
  };
}

export async function alertsReport(from, to, empId = null) {
  const list = (await alertsInRange(from, to)).filter((a) => !empId || a.employeeId === empId);
  return {
    title: 'Geofence alerts — left site without checking out',
    subtitle: `${from} to ${to} · ${list.length} alerts`,
    filename: `geofence-alerts-${from}-to-${to}`,
    orientation: 'landscape',
    sheets: [{
      name: 'Alerts',
      columns: ['Date', 'Time', 'Employee', 'Site', 'Alert', 'Distance (m)', 'GPS location', 'Status', 'Resolved by'],
      widths: [11, 7, 20, 20, 40, 12, 24, 10, 16],
      rows: list.map((a) => [a.date || d2(a.at), t2(a.at), a.employeeName, a.siteName, alertLabel(a), round(a.distance),
        a.lat != null ? `${a.lat.toFixed(6)}, ${a.lng.toFixed(6)}` : '', a.resolved ? 'Resolved' : 'Open', a.resolvedBy]),
    }],
  };
}

export async function projectReport(p) {
  const sites = p.siteIds.map((id) => store.site(id)).filter(Boolean);
  const [sessions, updates] = await Promise.all([sessionsForSites(p.siteIds), updatesForSites(p.siteIds)]);
  const mins = sessions.reduce((a, s) => a + sessionMinutes(s), 0);
  const prog = sites.length ? Math.round(sites.reduce((a, s) => a + s.progress, 0) / sites.length) : 0;
  const staff = new Map();
  for (const s of sessions) {
    const c = staff.get(s.employeeId) || { name: s.employeeName, mins: 0, days: new Set(), first: s.checkIn, last: s.checkIn };
    c.mins += sessionMinutes(s); c.days.add(s.date); c.last = s.checkIn;
    staff.set(s.employeeId, c);
  }
  const summary = [
    ['Project', p.name], ['Code', p.code], ['Client', p.client], ['Project manager', p.manager], ['Status', cap(p.status)],
    ['Start date', p.startDate], ['Target end date', p.endDate], ['Work progress (avg of sites)', `${prog}%`],
    ['Sites', sites.length], ['Man-hours', fmtMins(mins)], ['Man-hours (decimal)', hoursDec(mins)], ['Staff involved', staff.size],
    ['Site visits', sessions.length], ['Site updates', updates.length], ['Description', p.description],
  ];
  const sheets = [
    { name: 'Summary', columns: ['Item', 'Value'], widths: [28, 60], rows: summary },
    {
      name: 'Sites', columns: ['Site', 'Address', 'Status', 'Progress %', 'Hours', 'Visits'], widths: [24, 30, 12, 11, 10, 8],
      rows: sites.map((s) => {
        const ss = sessions.filter((x) => x.siteId === s.id);
        return [s.name, s.address, cap(s.status), s.progress, hoursDec(ss.reduce((a, x) => a + sessionMinutes(x), 0)), ss.length];
      }),
    },
    {
      name: 'Team effort', columns: ['Employee', 'Days on project', 'Total time', 'Hours', 'First visit', 'Last visit'], widths: [22, 15, 12, 9, 12, 12],
      rows: [...staff.values()].sort((a, b) => b.mins - a.mins).map((v) => [v.name, v.days.size, fmtMins(v.mins), hoursDec(v.mins), d2(v.first), d2(v.last)]),
      totals: ['TOTAL', '', fmtMins(mins), hoursDec(mins), '', ''],
    },
    {
      name: 'Attendance', columns: ['Date', 'Employee', 'Site', 'In', 'Out', 'Hours', 'GPS check'], widths: [11, 20, 20, 8, 8, 8, 24],
      rows: sessions.map((s) => [s.date, s.employeeName, s.siteName, t2(s.checkIn), s.checkOut ? t2(s.checkOut) : 'OPEN', hoursDec(sessionMinutes(s)), sessionFlagged(s) ? flagText(s) : 'OK']),
    },
    {
      name: 'Site updates', columns: ['Date', 'Site', 'Employee', 'Category', 'Progress %', 'Note'], widths: [11, 20, 18, 11, 10, 60],
      rows: updates.map((u) => [u.date || d2(u.createdAt), u.siteName, u.employeeName, u.category, u.progress ?? '', u.note]),
    },
  ];
  if (isAdmin()) {
    const petty = store.petty.filter((t) => p.siteIds.includes(t.siteId));
    const ps = pettySummary(petty);
    summary.splice(8, 0, ['Budget (₹)', p.budget || ''], ['Spent — approved petty (₹)', ps.spent], ['Pending petty (₹)', ps.pending],
      ['Budget used', p.budget ? `${Math.round((ps.spent / p.budget) * 100)}%` : '']);
    sheets.push({
      name: 'Expenses', columns: ['Date', 'Employee', 'Type', 'Category', 'Site', 'Note', 'Amount (₹)', 'Status'], widths: [11, 18, 11, 12, 18, 30, 12, 10],
      rows: petty.map((t) => [t.date || d2(t.createdAt), t.employeeName, t.type === 'credit' ? 'Cash given' : 'Expense', t.category, t.siteName, t.note, t.amount, cap(t.status)]),
    });
  }
  return {
    title: `Project report — ${p.name}`,
    subtitle: `${p.client ? `${p.client} · ` : ''}generated ${fmtDate(new Date())}`,
    filename: `project-${(p.code || p.name).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    orientation: 'landscape',
    sheets,
  };
}

export async function projectsOverviewReport() {
  const ids = store.projects.flatMap((p) => p.siteIds);
  const sessions = await sessionsForSites([...new Set(ids)]);
  const rows = store.projects.map((p) => {
    const sites = p.siteIds.map((id) => store.site(id)).filter(Boolean);
    const prog = sites.length ? Math.round(sites.reduce((a, s) => a + s.progress, 0) / sites.length) : 0;
    const ss = sessions.filter((s) => p.siteIds.includes(s.siteId));
    const mins = ss.reduce((a, s) => a + sessionMinutes(s), 0);
    const row = [p.code, p.name, p.client, p.manager, cap(p.status), p.startDate, p.endDate, sites.length, prog, hoursDec(mins), new Set(ss.map((s) => s.employeeId)).size];
    if (isAdmin()) {
      const spent = store.petty.filter((t) => p.siteIds.includes(t.siteId) && t.type !== 'credit' && t.status === 'approved').reduce((a, t) => a + t.amount, 0);
      row.push(p.budget || '', spent);
    }
    return row;
  });
  const cols = ['Code', 'Project', 'Client', 'Manager', 'Status', 'Start', 'End', 'Sites', 'Progress %', 'Man-hours', 'Staff'];
  if (isAdmin()) cols.push('Budget (₹)', 'Spent (₹)');
  return {
    title: 'Projects overview', subtitle: `${rows.length} projects · generated ${fmtDate(new Date())}`, filename: 'projects-overview', orientation: 'landscape',
    sheets: [{ name: 'Projects', columns: cols, widths: [12, 26, 18, 16, 10, 11, 11, 7, 10, 10, 7, 12, 12], rows }],
  };
}

// ================================================================== keyword search
/** "Rahul  fuel" → ['rahul', 'fuel'];  quoted phrases stay together: "marina tower" */
export function keywordTerms(q) {
  const out = [];
  String(q || '').toLowerCase().replace(/"([^"]+)"|(\S+)/g, (_, a, b) => { out.push((a || b).trim()); return ''; });
  return out.filter(Boolean);
}

/**
 * Returns a copy of the report keeping only rows where ALL keywords appear in
 * some column. Numeric totals are recalculated for the filtered rows.
 */
export function filterReport(rep, q) {
  const terms = keywordTerms(q);
  if (!terms.length) return rep;
  const sheets = rep.sheets.map((sh) => {
    const rows = sh.rows.filter((r) => {
      const text = r.map((c) => (c == null ? '' : String(c))).join(' \u0001 ').toLowerCase();
      return terms.every((t) => text.includes(t));
    });
    let totals = sh.totals;
    if (totals) {
      totals = totals.map((v, i) => {
        if (i === 0) return 'TOTAL (filtered)';
        if (typeof v !== 'number') return '';
        const sum = rows.reduce((a, r) => a + (typeof r[i] === 'number' ? r[i] : 0), 0);
        return Math.round(sum * 100) / 100;
      });
    }
    return { ...sh, rows, totals };
  });
  const n = sheets.reduce((a, s) => a + s.rows.length, 0);
  return {
    ...rep,
    sheets,
    subtitle: `${rep.subtitle || ''} · filtered by “${String(q).trim()}” (${n} rows)`,
    filename: `${rep.filename}-filtered`,
  };
}

// ================================================================== export
function safeSheetName(n, used) {
  let s = n.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet';
  let i = 2;
  while (used.has(s)) s = `${n.slice(0, 28)} ${i++}`;
  used.add(s);
  return s;
}

function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export async function downloadReport(rep, format = 'xlsx') {
  if (format === 'xlsx') return toXlsx(rep);
  if (format === 'csv') return toCsv(rep);
  if (format === 'pdf') return toPdf(rep);
  throw new Error(`Unknown format ${format}`);
}

function toXlsx(rep) {
  const XLSX = window.XLSX;
  if (!XLSX) throw new Error('Excel library did not load — check your internet connection.');
  const wb = XLSX.utils.book_new();
  const used = new Set();
  for (const sh of rep.sheets) {
    const aoa = [[rep.title], [rep.subtitle || ''], [], sh.columns, ...sh.rows];
    if (sh.totals) aoa.push(sh.totals);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = sh.columns.map((_, i) => ({ wch: (sh.widths && sh.widths[i]) || 14 }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: 3 + sh.rows.length, c: sh.columns.length - 1 } }) };
    ws['!freeze'] = { xSplit: 0, ySplit: 4 };
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(sh.name, used));
  }
  XLSX.writeFile(wb, `${rep.filename}.xlsx`);
}

function toCsv(rep) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const parts = [];
  rep.sheets.forEach((sh, i) => {
    if (rep.sheets.length > 1) parts.push(`${i ? '\n' : ''}${esc(sh.name)}`);
    parts.push(sh.columns.map(esc).join(','));
    sh.rows.forEach((r) => parts.push(r.map(esc).join(',')));
    if (sh.totals) parts.push(sh.totals.map(esc).join(','));
  });
  saveBlob(new Blob(['﻿' + parts.join('\n')], { type: 'text/csv;charset=utf-8' }), `${rep.filename}.csv`);
}

let logoData = null;
async function loadLogo() {
  if (logoData !== null) return logoData;
  try {
    const blob = await (await fetch('img/logo.png')).blob();
    logoData = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  } catch { logoData = ''; }
  return logoData;
}

async function toPdf(rep) {
  const jsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDF) throw new Error('PDF library did not load — check your internet connection.');
  const doc = new jsPDF({ orientation: rep.orientation || 'portrait', unit: 'pt', format: 'a4' });
  if (typeof doc.autoTable !== 'function') throw new Error('PDF table plugin did not load.');
  // The built-in PDF fonts have no ₹ glyph.
  const clean = (v) => (v == null ? '' : String(v).replace(/₹/g, 'Rs.').replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ]/g, ''));
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  doc.setFillColor(64, 64, 65);
  doc.rect(0, 0, W, 58, 'F');
  doc.setFillColor(252, 176, 64);
  doc.rect(0, 58, W, 4, 'F');
  const logo = await loadLogo();
  let tx = 32;
  if (logo) { doc.addImage(logo, 'PNG', 32, 11, 76, 36); tx = 122; }
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(clean(rep.title), tx, 28);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  doc.setTextColor(252, 176, 64);
  doc.text(clean(rep.subtitle || ''), tx, 44);
  doc.setTextColor(28, 42, 51);
  let y = 82;
  rep.sheets.forEach((sh, idx) => {
    const pick = sh.pdfColumns || sh.columns.map((_, i) => i);
    if (rep.sheets.length > 1) {
      if (y > H - 100) { doc.addPage(); y = 40; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5);
      doc.text(clean(sh.name), 32, y); y += 8;
    }
    const body = sh.rows.map((r) => pick.map((i) => clean(r[i])));
    doc.autoTable({
      startY: y + 4,
      head: [pick.map((i) => clean(sh.columns[i]))],
      body: body.length ? body : [[{ content: 'No data', colSpan: pick.length, styles: { halign: 'center', textColor: [120, 130, 140] } }]],
      foot: sh.totals ? [pick.map((i) => clean(sh.totals[i]))] : undefined,
      showFoot: 'lastPage',
      margin: { left: 32, right: 32 },
      styles: { fontSize: rep.pdfFont || 8, cellPadding: 3.5, overflow: 'linebreak', lineColor: [227, 232, 235], lineWidth: 0.5 },
      headStyles: { fillColor: [64, 64, 65], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [237, 242, 244], textColor: [28, 42, 51], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 251] },
      didParseCell: (d) => {
        if (d.section === 'body' && rep.pdfFont && typeof d.cell.raw === 'string') {
          if (d.cell.raw === 'A') d.cell.styles.textColor = [214, 69, 69];
          if (d.cell.raw === 'OFF') d.cell.styles.textColor = [224, 142, 43];
        }
      },
    });
    y = doc.lastAutoTable.finalY + 26;
    if (idx < rep.sheets.length - 1 && y > H - 80) { doc.addPage(); y = 40; }
  });
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(120, 130, 140);
    doc.text(`LLCT Attendance · generated ${new Date().toLocaleString('en-IN')}`, 32, H - 16);
    doc.text(`Page ${i} of ${pages}`, W - 32, H - 16, { align: 'right' });
  }
  doc.save(`${rep.filename}.pdf`);
}
