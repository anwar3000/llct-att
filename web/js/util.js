// Small helpers shared by every page.
export const CURRENCY = 'AED';
// Workforce colours used everywhere: our staff vs external workers (labour).
export const STAFF_COLOR = '#3A7BD5';
export const EXT_COLOR = '#D98A1A';
export const WEEKDAYS = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };
export const WEEKDAYS_LONG = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday' };

const pad = (n) => String(n).padStart(2, '0');
export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d || 1); };
export const daysInMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
export const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

// ------------------------------------------------------------------ time zones
// Times are stored as instants plus the phone's UTC offset (minutes) at that moment,
// so a check-in in Dubai shows 08:00 even when the manager is in India.
/** Shift an instant so the browser's local getters show the wall-clock time at offset `tz`. Display only. */
export const atTz = (d, tz) => (d && tz != null ? new Date(d.getTime() + (tz + d.getTimezoneOffset()) * 60000) : d);
/** Inverse of atTz: a wall-clock Date (entered in a form) at offset `tz` → real instant. */
export const fromTz = (wall, tz) => (wall && tz != null ? new Date(wall.getTime() - (tz + wall.getTimezoneOffset()) * 60000) : wall);
export const tzLabel = (tz) => {
  if (tz == null) return '';
  const a = Math.abs(tz);
  return `UTC${tz < 0 ? '−' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
};
export const fmtTime = (d) => (d ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—');
export const fmtDate = (d) => (d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtDay = (d) => (d ? d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : '—');
export const fmtDateTime = (d) => (d ? `${fmtDate(d)}, ${fmtTime(d)}` : '—');
export const fmtMonth = (d) => d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
export const fmtMoney = (v) => {
  const n = Number(v) || 0;
  return `${CURRENCY} ${n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
};
export const fmtMins = (m) => {
  m = Math.max(0, Math.round(m || 0));
  const h = Math.floor(m / 60), mm = m % 60;
  return h ? `${h}h ${pad(mm)}m` : `${mm}m`;
};
export const hoursDec = (m) => Math.round(((m || 0) / 60) * 100) / 100;
export const fmtDist = (m) => (m == null ? '—' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
export const timeAgo = (d) => {
  if (!d) return 'never';
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function initials(name) {
  const p = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  return (p.length === 1 ? p[0][0] : p[0][0] + p[p.length - 1][0]).toUpperCase();
}
const PALETTE = ['#D98A1A', '#3A7BD5', '#8E5CC4', '#C2557A', '#E08E2B', '#2E9E6A'];
export function colorFor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}
export const avatar = (name, size = 34, ring = '') =>
  `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px;background:${colorFor(name)};${ring ? `box-shadow:0 0 0 2.5px #fff,0 0 0 4.5px ${ring}` : ''}">${esc(initials(name))}</span>`;
export const pill = (text, color = 'gray', dot = false) => `<span class="pill ${color}">${dot ? '<i class="dot"></i>' : ''}${esc(text)}</span>`;
export const statusPill = (s) => pill(cap(s), { approved: 'green', rejected: 'red', pending: 'amber' }[s] || 'gray');
export const progressBar = (p) => `<div class="progress"><i style="width:${Math.max(0, Math.min(100, p || 0))}%"></i></div>`;

export const ICONS = {
  dashboard: '<path d="M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z"/>',
  map: '<path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11z"/>',
  project: '<path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8z"/>',
  site: '<path d="M15 11V5l-3-3-3 3v2H3v14h18V11zm-8 8H5v-2h2zm0-4H5v-2h2zm0-4H5V9h2zm6 8h-2v-2h2zm0-4h-2v-2h2zm0-4h-2V9h2zm0-4h-2V5h2zm6 12h-2v-2h2zm0-4h-2v-2h2z"/>',
  people: '<path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>',
  calendar: '<path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-2 .9-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14z"/>',
  clock: '<path d="M12 2a10 10 0 100 20 10 10 0 000-20zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7z"/>',
  wallet: '<path d="M21 18v1c0 1.1-.9 2-2 2H5a2 2 0 01-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9a2 2 0 00-2 2v8a2 2 0 002 2zm-9-2h10V8H12zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>',
  updates: '<path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/>',
  report: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2zm4 0h-2V7h2zm4 0h-2v-4h2z"/>',
  search: '<path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>',
  logout: '<path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4z"/>',
  menu: '<path d="M3 18h18v-2H3zm0-5h18v-2H3zm0-7v2h18V6z"/>',
  plus: '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/>',
  download: '<path d="M19 9h-4V3H9v6H5l7 7zM5 18v2h14v-2z"/>',
  check: '<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>',
  close: '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>',
  edit: '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75z"/>',
  trash: '<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/>',
  pin: '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z"/>',
  warn: '<path d="M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z"/>',
  pending: '<path d="M17 12c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm1.65 7.35L16.5 17.2V14h1v2.79l1.85 1.85zM18 3h-3.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H6c-1.1 0-2 .9-2 2v15c0 1.1.9 2 2 2h6.11a6.74 6.74 0 01-1.42-2H6V5h2v3h8V5h2v5.08c.71.1 1.38.31 2 .6V5c0-1.1-.9-2-2-2zm-6 2c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/>',
};
Object.assign(ICONS, {
  worker: '<path d="M12 1a4 4 0 00-4 4v1H6v2h12V6h-2V5a4 4 0 00-4-4zm-1 2.1V6h2V3.1A2 2 0 0114 5v1h-4V5a2 2 0 011-1.9zM12 9a3 3 0 100 6 3 3 0 000-6zm0 7c-3.3 0-8 1.7-8 4v2h16v-2c0-2.3-4.7-4-8-4z"/>',
  car: '<path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11z"/>',
  idcard: '<path d="M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zM8 7.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5zM13 17H3v-.75C3 14.5 6.3 13.5 8 13.5s5 1 5 2.75zm8-2h-6v-1.5h6zm0-3h-6v-1.5h6zm0-3h-6V7.5h6z"/>',
});
export const icon = (name, size = 18, color = 'currentColor') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// ------------------------------------------------------------------ toast / modal
export function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = `toast${err ? ' err' : ''}`;
  el.textContent = msg;
  document.getElementById('toast-root').appendChild(el);
  setTimeout(() => el.remove(), err ? 6000 : 3200);
}

/**
 * Opens a modal. `body` is HTML. Returns {el, close}. onMount(el, close) wires events.
 */
export function modal({ title, body, foot = '', wide = false, onMount }) {
  const root = document.getElementById('modal-root');
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="btn ghost icon" data-x>${icon('close')}</button></div>
    <div class="modal-body">${body}</div>
    ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
  </div>`;
  const close = () => back.remove();
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  back.querySelector('[data-x]').onclick = close;
  root.appendChild(back);
  if (onMount) onMount(back, close);
  return { el: back, close };
}

export function confirmBox(title, message, { ok = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    modal({
      title,
      body: `<p style="margin:0">${esc(message)}</p>`,
      foot: `<button class="btn ghost" data-no>Cancel</button><button class="btn ${danger ? 'danger' : ''}" data-yes>${esc(ok)}</button>`,
      onMount: (el, close) => {
        el.querySelector('[data-no]').onclick = () => { close(); resolve(false); };
        el.querySelector('[data-yes]').onclick = () => { close(); resolve(true); };
      },
    });
  });
}

export function promptBox(title, label, { ok = 'OK', value = '', type = 'text' } = {}) {
  return new Promise((resolve) => {
    modal({
      title,
      body: `<label class="f"><span>${esc(label)}</span><input data-v type="${type}" value="${esc(value)}"></label>`,
      foot: `<button class="btn ghost" data-no>Cancel</button><button class="btn" data-yes>${esc(ok)}</button>`,
      onMount: (el, close) => {
        const inp = el.querySelector('[data-v]');
        inp.focus();
        el.querySelector('[data-no]').onclick = () => { close(); resolve(null); };
        el.querySelector('[data-yes]').onclick = () => { close(); resolve(inp.value); };
      },
    });
  });
}

export function photoViewer(src) {
  modal({ title: 'Photo', wide: true, body: `<img src="${src}" style="width:100%;border-radius:10px">` });
}
export const b64img = (b) => (b && b.startsWith('data:') ? b : `data:image/jpeg;base64,${b}`);

export function friendlyError(e) {
  const code = e?.code || '';
  const map = {
    'auth/invalid-credential': 'Wrong login ID or password.',
    'auth/wrong-password': 'Wrong login ID or password.',
    'auth/user-not-found': 'Wrong login ID or password.',
    'auth/invalid-email': 'That login ID is not valid.',
    'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
    'auth/email-already-in-use': 'That login ID is already taken.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/network-request-failed': 'No internet connection.',
    'auth/unauthorized-domain': 'This website is not authorised in Firebase. Add it under Authentication → Settings → Authorized domains.',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'Firebase API key not accepted for web. See README → Web dashboard.',
    'permission-denied': 'Permission denied — check the Firestore rules are published and your role is admin.',
  };
  return map[code] || e?.message || String(e);
}
