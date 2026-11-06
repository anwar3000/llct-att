// LLCT Service Desk — shared Firebase setup, constants and helpers (client portal + staff desk).
// Same Firebase project as LLCT Attendance and LLCT Invoicing.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, collection, collectionGroup, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit,
  serverTimestamp, Timestamp, writeBatch, arrayUnion, deleteField,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './config.js';

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export {
  collection, collectionGroup, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit,
  serverTimestamp, Timestamp, writeBatch, arrayUnion, deleteField,
};

export const COMPANY = { name: 'Leaders Line Trading LLC', phone: '04 880 5577', email: 'service@llct.net', web: 'www.llct.net' };
export const INVOICING_URL = 'https://anwar3000.github.io/llct-invoice/';

// ------------------------------------------------------------------ catalogue
// Default options for "What needs attention". The admin can change, hide, reorder and add options
// in the desk (Settings → Service options); those are kept in svcConfig/public.
export const DEFAULT_TYPES = [
  { k: 'camera', t: 'CCTV camera not working', i: 'camera' },
  { k: 'recording', t: 'NVR / DVR not recording', i: 'recording' },
  { k: 'remote', t: 'No remote / mobile view', i: 'remote' },
  { k: 'image', t: 'Image blurry, dark or no night vision', i: 'image' },
  { k: 'hdd', t: 'Hard disk / storage error', i: 'hdd' },
  { k: 'playback', t: 'Footage backup / playback needed', i: 'playback' },
  { k: 'power', t: 'Power, cable or PoE issue', i: 'power' },
  { k: 'network', t: 'Network / Wi‑Fi / internet', i: 'network' },
  { k: 'access', t: 'Access control / door / intercom', i: 'access' },
  { k: 'o2device', t: 'Oxygen O2 device not working', i: 'o2' },
  { k: 'o2switch', t: 'O2IOT switching issue', i: 'switch' },
  { k: 'o2connect', t: 'O2IOT device not connecting', i: 'signal' },
  { k: 'ppm', t: 'Preventive maintenance (AMC visit)', i: 'ppm' },
  { k: 'install', t: 'New camera / relocation', i: 'install' },
  { k: 'other', t: 'Other', i: 'other' },
];
export let SERVICE_TYPES = DEFAULT_TYPES.map((x) => ({ ...x, on: true }));
/** Options shown to customers, in the admin's order. */
export const activeTypes = () => SERVICE_TYPES.filter((x) => x.on !== false);
/** Loads the admin's option list (falls back to the defaults). */
export async function loadTypes() {
  try {
    const d = await getDoc(doc(db, 'svcConfig', 'public'));
    const l = d.exists() && Array.isArray(d.data().types) ? d.data().types : null;
    if (l && l.length) {
      SERVICE_TYPES = l.filter((x) => x && x.k && x.t).map((x) => ({ k: String(x.k), t: String(x.t), i: String(x.i || x.k), on: x.on !== false }));
      // keep labels of retired defaults for old tickets
      DEFAULT_TYPES.forEach((x) => { if (!SERVICE_TYPES.some((y) => y.k === x.k)) SERVICE_TYPES.push({ ...x, on: false, retired: true }); });
    }
  } catch (_) { /* rules not published yet: defaults */ }
  return SERVICE_TYPES;
}
export async function saveTypes(list) {
  await setDoc(doc(db, 'svcConfig', 'public'), { types: list.map((x) => ({ k: x.k, t: x.t, i: x.i || 'other', on: x.on !== false })), updatedAt: serverTimestamp() });
  SERVICE_TYPES = list.map((x) => ({ ...x }));
}
export const typeLabel = (k) => (SERVICE_TYPES.find((x) => x.k === k) || { t: k || 'Service' }).t;
/** All selected service types of a ticket (several can be chosen), as labels. */
export const typesOf = (t) => {
  if (t && Array.isArray(t.categoryLabels) && t.categoryLabels.length) return t.categoryLabels.map(String);
  const ks = Array.isArray(t && t.categories) && t.categories.length ? t.categories : [t && t.category].filter(Boolean);
  return ks.length ? ks.map(typeLabel) : ['Service'];
};
export const typesText = (t) => typesOf(t).join(', ');

// Line icons (24×24, stroke) for the service types.
const IC = {
  camera: 'M3 8.5h11.5l3-2v9l-3-2H3z M6 13.5v3.5h4 M14.5 10.5h0',
  recording: 'M4 6.5h16v11H4z M8 10.5h8 M8 13.5h5 M17 13.5h.01',
  remote: 'M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3z M11 18h2 M4 4l16 16',
  image: 'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z M4 20L20 4',
  hdd: 'M4 5.5h16v5H4z M4 13.5h16v5H4z M16.5 8h.01 M16.5 16h.01',
  playback: 'M11 7l-6 5 6 5z M19 7l-6 5 6 5z',
  power: 'M9 3v5 M15 3v5 M6.5 8h11v3a5.5 5.5 0 0 1-11 0z M12 16.5V21',
  network: 'M2.5 9.5a14 14 0 0 1 19 0 M5.5 12.8a9.5 9.5 0 0 1 13 0 M8.6 16a5 5 0 0 1 6.8 0 M12 19.2h.01',
  access: 'M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21 M3.5 21h17 M14.5 12.5h.01',
  ppm: 'M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z',
  install: 'M3 8.5h11.5l3-2v9l-3-2H3z M19.5 3v5 M17 5.5h5',
  other: 'M4 5.5h16v10H10l-4 3.5v-3.5H4z M8.5 10.5h.01 M12 10.5h.01 M15.5 10.5h.01',
  o2: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  switch: 'M3 8h18v8H3z M7 12h.01 M3 8l4-4h10l4 4 M15 12h3',
  signal: 'M4 18v-3 M9 18v-6 M14 18V9 M19 18V5 M3 3l18 18',
  alarm: 'M12 4a6 6 0 0 0-6 6v4l-2 3h16l-2-3v-4a6 6 0 0 0-6-6z M10 20a2 2 0 0 0 4 0',
  fire: 'M12 21a6 6 0 0 1-6-6c0-4 4-6 4-10 3 2 4 4 4 6 1-1 1.5-2 1.5-3 2 2 2.5 4.5 2.5 7a6 6 0 0 1-6 6z',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  tv: 'M3 5h18v12H3z M8 21h8 M12 17v4',
  server: 'M4 4h16v6H4z M4 14h16v6H4z M8 7h.01 M8 17h.01',
};
export const ICON_KEYS = Object.keys(IC);
export const icon = (k, size = 24) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${IC[k] || IC.other}"/></svg>`;

export const PRIORITIES = [
  { k: 'critical', t: 'Critical', s: 'System down / security risk', c: '#d64545', hrs: 4 },
  { k: 'high', t: 'High', s: 'Several cameras or recording affected', c: '#e08e2b', hrs: 24 },
  { k: 'normal', t: 'Normal', s: 'One camera or minor issue', c: '#3a7bd5', hrs: 48 },
  { k: 'low', t: 'Low', s: 'Routine / when convenient', c: '#75757a', hrs: 96 },
];
export const prio = (k) => PRIORITIES.find((p) => p.k === k) || PRIORITIES[2];

export const SLOTS = [
  { k: 'asap', t: 'As soon as possible' },
  { k: 'morning', t: 'Morning (8 am – 12 pm)' },
  { k: 'afternoon', t: 'Afternoon (12 – 4 pm)' },
  { k: 'evening', t: 'Evening (4 – 8 pm)' },
  { k: 'night', t: 'Night (10 pm – 1 am)' },
  { k: 'latenight', t: 'Late night (1 – 5 am)' },
  { k: 'any', t: 'Any time' },
];
export const slotLabel = (k) => (k === 'exact' ? 'Exact time' : (SLOTS.find((s) => s.k === k) || { t: '' }).t);
const t12 = (hm) => { const [h, m] = String(hm || '').split(':').map(Number); if (Number.isNaN(h)) return ''; return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`; };
/** "As soon as possible" / "2 Nov 2026, morning" / "2 Nov 2026 at 3:30 pm" */
export function prefText(t) {
  if (!t || t.preferredSlot === 'asap' || !t.preferredSlot) return 'As soon as possible';
  if (t.preferredSlot === 'exact' && t.preferredTime) return `${fmtDate(t.preferredDate)} at ${t.preferredTime} (${t12(t.preferredTime)})`;
  return `${fmtDate(t.preferredDate)}, ${slotLabel(t.preferredSlot).split(' (')[0].toLowerCase()}`;
}

// Ticket life cycle. open == true until completed / closed / cancelled.
export const STATUS = {
  new: { t: 'Received', c: '#d64545', staff: 'New — not assigned' },
  assigned: { t: 'Assigned', c: '#8e5cc4', staff: 'Assigned — waiting for technician' },
  accepted: { t: 'Confirmed', c: '#3a7bd5', staff: 'Accepted by technician' },
  on_way: { t: 'On the way', c: '#e08e2b', staff: 'Technician on the way' },
  on_site: { t: 'At site', c: '#d98a1a', staff: 'Technician at site' },
  completed: { t: 'Completed', c: '#2e9e6a', staff: 'Work completed' },
  closed: { t: 'Closed', c: '#404041', staff: 'Closed' },
  cancelled: { t: 'Cancelled', c: '#75757a', staff: 'Cancelled' },
};
export const OPEN_STATUSES = ['new', 'assigned', 'accepted', 'on_way', 'on_site'];
export const st = (k) => STATUS[k] || { t: k, c: '#75757a', staff: k };

/** What the client is told about their ticket right now. */
export function clientMessage(t) {
  const who = t.assignedName ? `Technician ${t.assignedName}` : 'Our technician';
  const when = t.scheduledAt ? ` on ${fmtDT(t.scheduledAt)}` : t.preferredSlot && t.preferredSlot !== 'asap' ? ` on ${prefText(t)}` : ' at the earliest';
  switch (t.status) {
    case 'new': return 'We have received your request. Our team is assigning a technician and will confirm the visit shortly.';
    case 'assigned': return `Your request has been assigned to our technical team. ${who} will visit${when}.`;
    case 'accepted': return `${who} has confirmed the job and will visit${when}.`;
    case 'on_way': return `${who} is on the way to your site.`;
    case 'on_site': return `${who} has arrived at your site and is working on it.`;
    case 'completed': return `The work is completed${t.reportNo ? ` — service report ${t.reportNo}` : ''}. Thank you!`;
    case 'closed': return 'This request is closed. Thank you for choosing Leaders Line.';
    case 'cancelled': return 'This request was cancelled.';
    default: return '';
  }
}

// ------------------------------------------------------------------ helpers
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const toDate = (v) => (v && typeof v.toDate === 'function' ? v.toDate() : v instanceof Date ? v : typeof v === 'string' && v ? new Date(v.length === 10 ? v + 'T00:00:00' : v) : null);
const pad = (n) => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(v) { const d = toDate(v); return d && !isNaN(d) ? `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}` : ''; }
export function fmtTime(v) { const d = toDate(v); if (!d || isNaN(d)) return ''; let h = d.getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}:${pad(d.getMinutes())} ${ap}`; }
export function fmtDT(v) { const d = toDate(v); return d && !isNaN(d) ? `${fmtDate(d)}, ${fmtTime(d)}` : ''; }
export function ago(v) {
  const d = toDate(v); if (!d) return '';
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return `${Math.floor(s / 86400)} d ago`;
}
export const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localInput = (v) => { const d = toDate(v); return d && !isNaN(d) ? `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}` : ''; };
export const hasGPS = (p) => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0);
export function distM(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export const fmtDist = (m) => (m == null ? '' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);
export const mapsLink = (t) => (hasGPS(t) ? `https://www.google.com/maps/dir/?api=1&destination=${t.lat},${t.lng}` : t.siteAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.siteAddress)}` : '');
export const telLink = (p) => `tel:${String(p || '').replace(/[^\d+]/g, '')}`;
export function waLink(phone, text) {
  let p = String(phone || '').replace(/\D/g, '');
  if (p.startsWith('00')) p = p.slice(2);
  if (p.startsWith('0')) p = '971' + p.slice(1); // UAE local number
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}
export function randToken(n = 22) {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => a[x % a.length]).join('');
}
/** SR-261031-4821 — date + 4 random digits; the doc id is the number. */
export function newTicketNo() {
  const d = new Date();
  const r = crypto.getRandomValues(new Uint16Array(1))[0] % 10000;
  return `SR-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${String(r).padStart(4, '0')}`;
}
export const reportLink = (ticketId) => `${INVOICING_URL}#/edit?${encodeURIComponent(JSON.stringify({ type: 'delivery', rt: 'service', tk: ticketId }))}`;
export const reportViewLink = (reportId) => `${INVOICING_URL}#/view?${encodeURIComponent(JSON.stringify({ id: reportId }))}`;

// ------------------------------------------------------------------ equipment under maintenance
/** What the technician found for each faulty item (also used in the service report). */
export const RESULTS = ['Rectified', 'Working', 'Need replacement', 'Replaced', 'Pending parts', 'Not checked'];
export const RESULT_COLOR = { Rectified: '#1F8A5B', Working: '#1F8A5B', Replaced: '#1F8A5B', 'Need replacement': '#B4372B', 'Pending parts': '#C27A12', 'Not checked': '#75757a' };
/** "NVR 1 – Main office" / "Camera 05 – Main gate (NVR 1, ch 5)" */
export function faultLabel(f) {
  if (!f) return '';
  const name = String(f.name || '').trim();
  if (f.kind === 'nvr') return f.no ? `NVR ${f.no}${name ? ` – ${name}` : ''}` : /^(nvr|dvr|xvr)/i.test(name) ? name : `NVR – ${name}`;
  if (f.kind === 'other') {
    const ty = String(f.type || '').trim();
    if (!ty || ty === 'Other' || name.toLowerCase().startsWith(ty.toLowerCase().split(/[ /]/)[0])) return name || ty || 'Device';
    return `${ty}${name ? ` – ${name}` : ''}`;
  }
  const where = f.nvr ? ` (NVR ${f.nvr}${f.ch ? `, ch ${f.ch}` : ''})` : '';
  const base = f.no ? `Camera ${f.no}${name ? ` – ${name}` : ''}` : /^(cam|camera)\b/i.test(name) ? name : `Camera – ${name}`;
  return `${base}${where}`.trim();
}
/** The device lists of a customer profile: one text box each, one device per line. */
export const DEVICE_LISTS = [
  { k: 'cameras', s: 'Camera', t: 'Cameras', ph: 'R01 C01 Entrance\nR01 C02 Reception\nR02 C03 Parking', cat: 'camera' },
  { k: 'nvrs', s: 'NVR', t: 'NVR / DVR', ph: 'NVR 1 Main rack 32ch', cat: 'recording' },
  { k: 'hdd', s: 'HDD', t: 'Hard disks (HDD)', type: 'Hard disk', ph: 'NVR 1 HDD 1 – 6TB\nNVR 1 HDD 2 – 6TB', cat: 'hdd' },
  { k: 'ups', s: 'UPS', t: 'UPS', type: 'UPS', ph: 'Server room UPS 3kVA', cat: 'power' },
  { k: 'network', s: 'Network', t: 'Network – switches, routers', type: 'Network switch', ph: 'PoE switch 16 port – rack\nRouter – Etisalat', cat: 'network' },
  { k: 'other', s: 'Other', t: 'Other devices', type: 'Other', ph: 'Monitor 43" – security room\nAccess control – main door', cat: 'other' },
];
/** Which list an existing "other" device belongs to. */
export const listOfOther = (x) => (x.type === 'Hard disk' ? 'hdd' : x.type === 'UPS' ? 'ups' : /switch|router|wi-?fi|network/i.test(x.type || '') ? 'network' : 'other');
/** Other equipment covered by the AMC, besides NVRs and cameras. */
export const OTHER_TYPES = ['Network switch', 'Hard disk', 'Monitor / TV', 'UPS', 'Router / Wi-Fi', 'Access control', 'Intercom', 'Fire alarm panel', 'Oxygen O2 device', 'O2IOT switch', 'Other'];
/** Client-visible copy of a site's equipment (no serials / IPs). */
export const leanEquipment = (e) => ({
  nvrs: (e && e.nvrs || []).map((n) => ({ id: n.id, no: n.no || '', name: n.name || '' })),
  cameras: (e && e.cameras || []).map((c) => ({ id: c.id, no: c.no || '', name: c.name || '', nvr: c.nvr || '', ch: c.ch || '' })),
  others: (e && e.others || []).map((o) => ({ id: o.id, type: o.type || '', name: o.name || '' })),
});
/** AMC contract status: { text, tone: 'ok' | 'warn' | 'bad' | '' }. */
export function amcStatus(a) {
  if (!a || !(a.end || a.no)) return { text: '', tone: '' };
  const end = a.end ? new Date(a.end + 'T23:59:59') : null;
  if (!end || isNaN(end)) return { text: `AMC ${a.no || ''}`.trim(), tone: 'ok' };
  const days = Math.ceil((end - new Date()) / 86400000);
  const d = end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (days < 0) return { text: `AMC expired on ${d}`, tone: 'bad' };
  return { text: `AMC active until ${d}`, tone: days <= 30 ? 'warn' : 'ok' };
}

/** Where the customer's view of a ticket lives: their client link, or the walk-in tracking page. */
export const mirrorPath = (t) => (t.portal ? ['svcPortals', t.portal, 'tickets', t.id || t.number] : t.publicId ? ['svcPublic', t.publicId] : null);
export const hasClientPage = (t) => !!(t && (t.portal || t.publicId));

/** Fields of a ticket the client may see (svcPortals/{token}/tickets/{id}). */
export function publicView(t) {
  const o = {
    number: t.number, siteName: t.siteName || '', siteAddress: t.siteAddress || '', category: t.category || '',
    categories: Array.isArray(t.categories) ? t.categories : (t.category ? [t.category] : []),
    description: t.description || '', priority: t.priority || 'normal', preferredDate: t.preferredDate || '',
    preferredSlot: t.preferredSlot || '', preferredTime: t.preferredTime || '', contactName: t.contactName || '', status: t.status || 'new',
    faults: Array.isArray(t.faults) ? t.faults.map((f) => ({ kind: f.kind, id: f.id, no: f.no || '', name: f.name || '', nvr: f.nvr || '', ch: f.ch || '', result: f.result || '', note: f.note || '' })) : [],
    photosCount: Array.isArray(t.photos) ? t.photos.length : 0,
  };
  if (t.cameras) o.cameras = t.cameras;
  return o;
}

/** Shrinks a photo to a small JPEG data URL (stored inside the ticket, no Storage bucket needed). */
export function compressImage(file, max = 1100, quality = 0.62) {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      let q = quality, out = c.toDataURL('image/jpeg', q);
      while (out.length > 190000 && q > 0.3) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
      res(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read that image')); };
    img.src = url;
  });
}

export function toast(msg, err = false) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(t._h); t._h = setTimeout(() => (t.className = 'toast'), 3600);
}

export function friendly(e) {
  const c = (e && e.code) || '';
  if (c.includes('permission-denied')) return 'Not allowed. Check that the latest Firestore rules are published, and that you have permission.';
  if (c.includes('unavailable')) return 'No connection. Check the internet and try again.';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'Login ID or password is wrong.';
  if (c.includes('too-many-requests')) return 'Too many attempts. Wait a minute and try again.';
  return (e && e.message) || String(e);
}

/** Short beep without an audio file (new-ticket alert). */
export function beep(times = 3) {
  try {
    const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
    const ctx = beep.ctx || (beep.ctx = new A());
    if (ctx.state === 'suspended') ctx.resume();
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain(); const t0 = ctx.currentTime + i * 0.32;
      o.type = 'sine'; o.frequency.value = i % 2 ? 660 : 880;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
      o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + 0.27);
    }
  } catch (_) { /* ignore */ }
}

// ------------------------------------------------------------------ customer documents (trade licence, SIRA, drawings…)
// Files are kept in Firestore itself: a document per file (svcPortals/{token}/docs/{id}) and the file in
// pieces of 700 000 base64 characters (…/docs/{id}/chunks/{n}), like the ID documents of the staff app.
export const DOC_TYPES = [
  { k: 'tl', t: 'Trade licence', exp: true, num: 'Licence number' },
  { k: 'sira_cert', t: 'SIRA certificate', exp: true, num: 'Certificate number' },
  { k: 'sira_noc', t: 'SIRA NOC', exp: true, num: 'NOC number' },
  { k: 'drawing', t: 'Property drawing', exp: false, num: 'Drawing number' },
  { k: 'spc', t: 'SPC approved drawing', exp: true, num: 'Approval number' },
  { k: 'cd', t: 'Civil Defence certificate', exp: true, num: 'Certificate number' },
  { k: 'contract', t: 'AMC contract / LPO', exp: true, num: 'Contract / LPO number' },
  { k: 'other', t: 'Other document', exp: true, num: 'Reference number' },
];
export const docTypeOf = (k) => DOC_TYPES.find((d) => d.k === k) || DOC_TYPES[DOC_TYPES.length - 1];
export const DOC_MAX = 8 * 1024 * 1024; // 8 MB per file when kept in Firestore
export const DOC_MAX_SERVER = 25 * 1024 * 1024; // 25 MB per file when kept on the server (files.php)
// ---- files on the server: files.php next to the pages saves them in files/<Customer>/<Document type>/
const FILES_URL = new URL('../files.php', import.meta.url).href;
let serverOk = null;
/** Does this server keep document files (files.php present and PHP running)? Checked once. */
export async function fileServer() {
  if (serverOk !== null) return serverOk;
  try { const r = await fetch(`${FILES_URL}?a=ping`, { cache: 'no-store' }); const j = r.ok ? await r.json() : null; serverOk = !!(j && j.ok && j.writable !== false); }
  catch (_) { serverOk = false; }
  return serverOk;
}
let idTokenFn = null;
/** The desk passes a function giving the signed-in staff member's Firebase ID token (sent to files.php). */
export const setIdTokenProvider = (fn) => { idTokenFn = fn; };
const authHeaders = async () => { try { const t = idTokenFn ? await idTokenFn() : ''; return t ? { 'X-Id-Token': t } : {}; } catch (_) { return {}; } };
/** Space used per customer on the server (staff). */
export async function serverUsage() {
  if (!(await fileServer())) return null;
  const r = await fetch(`${FILES_URL}?a=usage`, { headers: await authHeaders(), cache: 'no-store' }); return r.ok ? r.json() : null;
}
function xhrUpload(form, onProgress, headers) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest(); x.open('POST', `${FILES_URL}?a=up`);
    Object.entries(headers || {}).forEach(([k, v]) => x.setRequestHeader(k, v));
    x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    x.onload = () => { let j = null; try { j = JSON.parse(x.responseText); } catch (_) { /* not JSON */ } if (x.status === 200 && j && j.ok) res(j); else rej(new Error((j && j.error) || `Upload failed (${x.status})`)); };
    x.onerror = () => rej(new Error('Upload failed — check the connection'));
    x.send(form);
  });
}
const DOC_CHUNK = 700000;
/** Expiry state of a document: { text, tone: 'ok' | 'warn' | 'bad' | '' }. */
export function expiryStatus(exp) {
  if (!exp) return { text: '', tone: '' };
  const end = new Date(exp + 'T23:59:59'); if (isNaN(end)) return { text: '', tone: '' };
  const days = Math.ceil((end - new Date()) / 86400000);
  const d = end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (days < 0) return { text: `Expired ${d}`, tone: 'bad', days };
  if (days <= 30) return { text: `Expires ${d} (${days} day${days === 1 ? '' : 's'})`, tone: 'warn', days };
  return { text: `Valid until ${d}`, tone: 'ok', days };
}
const fileToB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('Could not read the file')); r.readAsDataURL(blob); });
/** Upload one file with its details. base = path of the docs collection, e.g. ['svcPortals', token, 'docs']. */
export async function uploadDocFile(base, meta, file, onProgress) {
  let blob = file, mime = file.type || 'application/octet-stream', name = file.name || 'document';
  if (/^image\/(jpeg|png|webp|heic|heif)/i.test(mime) && file.size > 600 * 1024) {
    try { const du = await compressImage(file, 2000, 0.8); blob = await (await fetch(du)).blob(); mime = 'image/jpeg'; name = name.replace(/\.[a-z0-9]+$/i, '') + '.jpg'; } catch (_) { /* keep the original */ }
  }
  const onServer = base[0] === 'svcPortals' && (await fileServer());
  const max = onServer ? DOC_MAX_SERVER : DOC_MAX;
  if (blob.size > max) throw new Error(`The file is ${(blob.size / 1048576).toFixed(1)} MB — the limit is ${max / 1048576} MB. Please send a smaller scan or PDF.`);
  if (onServer) {
    const ref = doc(collection(db, ...base)); // id first, so the file on the server carries it
    const fd = new FormData(); fd.append('t', base[1]); fd.append('d', ref.id); fd.append('type', meta.typeLabel || meta.type || 'Documents'); fd.append('file', blob, name);
    const up = await xhrUpload(fd, onProgress, await authHeaders());
    await setDoc(ref, { ...meta, name, mime, size: blob.size, chunks: 0, storage: 'server', path: up.path, complete: true, at: serverTimestamp() });
    return ref.id;
  }
  const b64 = await fileToB64(blob);
  const n = Math.max(1, Math.ceil(b64.length / DOC_CHUNK));
  const ref = doc(collection(db, ...base));
  await setDoc(ref, { ...meta, name, mime, size: blob.size, chunks: n, complete: false, at: serverTimestamp() });
  for (let i = 0; i < n; i += 8) { // a write may carry at most 10 MB, so send 8 pieces at a time
    const b = writeBatch(db);
    for (let k = i; k < Math.min(n, i + 8); k++) b.set(doc(db, ...base, ref.id, 'chunks', String(k)), { d: b64.slice(k * DOC_CHUNK, (k + 1) * DOC_CHUNK) });
    await b.commit(); if (onProgress) onProgress(Math.min(n, i + 8) / n);
  }
  await updateDoc(ref, { complete: true });
  return ref.id;
}
/** The file of a document as a Blob. */
export async function loadDocFile(base, d) {
  if (d.storage === 'server') {
    const r = await fetch(`${FILES_URL}?a=get&t=${encodeURIComponent(base[1])}&d=${encodeURIComponent(d.id)}`, { headers: await authHeaders() });
    if (!r.ok) { let m = ''; try { m = (await r.json()).error; } catch (_) { /* file, not JSON */ } throw new Error(m || `Could not open the file (${r.status})`); }
    return r.blob();
  }
  const q = await getDocs(collection(db, ...base, d.id, 'chunks'));
  const parts = q.docs.sort((a, b) => +a.id - +b.id).map((x) => x.data().d || '').join('');
  const bin = atob(parts); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: d.mime || 'application/octet-stream' });
}
/** Open (view) or save a document's file. Call straight from a click so the new tab is allowed. */
export function openDocFile(base, d, download) {
  const w = download ? null : window.open('', '_blank');
  if (w) w.document.write('<p style="font:16px system-ui;padding:20px">Opening document…</p>');
  return loadDocFile(base, d).then((blob) => {
    const url = URL.createObjectURL(blob);
    if (w) { w.location.href = url; } else { const a = document.createElement('a'); a.href = url; a.download = d.name || 'document'; document.body.appendChild(a); a.click(); a.remove(); }
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }, (e) => { if (w) w.close(); throw e; });
}
export async function deleteDocFile(base, d) {
  if (d.storage === 'server') {
    await deleteDoc(doc(db, ...base, d.id)); // first the record, then the server removes the file it no longer belongs to
    const fd = new FormData(); fd.append('t', base[1]); fd.append('d', d.id);
    await fetch(`${FILES_URL}?a=del`, { method: 'POST', body: fd, headers: await authHeaders() }).catch(() => {});
    return;
  }
  const q = await getDocs(collection(db, ...base, d.id, 'chunks'));
  const b = writeBatch(db); q.docs.forEach((x) => b.delete(x.ref)); b.delete(doc(db, ...base, d.id)); await b.commit();
}
export const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
/** Documents grouped: the files of one document (e.g. the pages of a drawing) share a group id. */
export function groupDocs(list) {
  const m = new Map();
  (list || []).forEach((d) => { const k = d.group || d.id; if (!m.has(k)) m.set(k, []); m.get(k).push(d); });
  return [...m.entries()].map(([key, docs]) => {
    docs.sort((a, b) => (a.page || 0) - (b.page || 0) || String(a.name).localeCompare(String(b.name)));
    const head = docs[0];
    return { key, docs, head, size: docs.reduce((n, d) => n + (d.size || 0), 0), verified: docs.every((d) => d.verified), complete: docs.every((d) => d.complete !== false) };
  });
}
/** Short label for one file of a document: "Page 2" or its name. */
export const fileLabel = (d, i, n) => (n > 1 ? `Page ${d.page || i + 1}` : 'View');
export const newGroupId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
