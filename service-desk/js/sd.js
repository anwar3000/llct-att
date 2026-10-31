// LLCT Service Desk — shared Firebase setup, constants and helpers (client portal + staff desk).
// Same Firebase project as LLCT Attendance and LLCT Invoicing.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, query, where, orderBy, limit,
  serverTimestamp, Timestamp, writeBatch, arrayUnion, deleteField,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './config.js';

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, query, where, orderBy, limit,
  serverTimestamp, Timestamp, writeBatch, arrayUnion, deleteField,
};

export const COMPANY = { name: 'Leaders Line Trading LLC', phone: '04 880 5577', email: 'service@llct.net', web: 'www.llct.net' };
export const INVOICING_URL = 'https://anwar3000.github.io/llct-invoice/';

// ------------------------------------------------------------------ catalogue
export const SERVICE_TYPES = [
  { k: 'camera', t: 'CCTV camera not working', i: '📷' },
  { k: 'recording', t: 'NVR / DVR not recording', i: '💽' },
  { k: 'remote', t: 'No remote / mobile view', i: '📱' },
  { k: 'image', t: 'Image blurry, dark or no night vision', i: '🌙' },
  { k: 'hdd', t: 'Hard disk / storage error', i: '🗄️' },
  { k: 'playback', t: 'Footage backup / playback needed', i: '⏪' },
  { k: 'power', t: 'Power, cable or PoE issue', i: '🔌' },
  { k: 'network', t: 'Network / Wi‑Fi / internet', i: '🌐' },
  { k: 'access', t: 'Access control / door / intercom', i: '🚪' },
  { k: 'ppm', t: 'Preventive maintenance (AMC visit)', i: '🛠️' },
  { k: 'install', t: 'New camera / relocation', i: '➕' },
  { k: 'other', t: 'Other', i: '💬' },
];
export const typeLabel = (k) => (SERVICE_TYPES.find((x) => x.k === k) || { t: k || 'Service' }).t;

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
  { k: 'any', t: 'Any time that day' },
];
export const slotLabel = (k) => (SLOTS.find((s) => s.k === k) || { t: '' }).t;

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
  const when = t.scheduledAt ? ` on ${fmtDT(t.scheduledAt)}` : t.preferredDate ? ` on ${fmtDate(t.preferredDate)}${t.preferredSlot && t.preferredSlot !== 'asap' ? ' (' + slotLabel(t.preferredSlot).split(' (')[0].toLowerCase() + ')' : ''}` : ' at the earliest';
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

/** Fields of a ticket the client may see (svcPortals/{token}/tickets/{id}). */
export function publicView(t) {
  const o = {
    number: t.number, siteName: t.siteName || '', siteAddress: t.siteAddress || '', category: t.category || '',
    description: t.description || '', priority: t.priority || 'normal', preferredDate: t.preferredDate || '',
    preferredSlot: t.preferredSlot || '', contactName: t.contactName || '', status: t.status || 'new',
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
