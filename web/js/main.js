import { auth, onAuthStateChanged, login, logout, getMe, store, isAdmin, isLimited, canSeeAccounts, ROLE_LABEL } from './fb.js';
import { esc, icon, avatar, friendlyError } from './util.js';
import * as dashboard from './pages/dashboard.js';
import * as livemap from './pages/livemap.js';
import * as projects from './pages/projects.js';
import * as sites from './pages/sites.js';
import * as employees from './pages/employees.js';
import * as schedule from './pages/schedule.js';
import * as attendance from './pages/attendance.js';
import * as petty from './pages/petty.js';
import * as updates from './pages/updates.js';
import * as reports from './pages/reports.js';
import * as workers from './pages/workers.js';
import * as documents from './pages/documents.js';
import * as requests from './pages/requests.js';
import * as working from './pages/working.js';
import * as trips from './pages/trips.js';
import * as accounts from './pages/accounts.js';
import * as backup from './pages/backup.js';
import * as company from './pages/company.js';

const app = document.getElementById('app');
window.__appStarted = true;

// Sidebar icons: one outline set, drawn at 24×24 with rounded strokes.
const NAV_ICONS = {
  dashboard: '<rect x="3" y="3" width="7.5" height="9" rx="1.8"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.8"/><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="1.8"/><rect x="3" y="15" width="7.5" height="6" rx="1.8"/>',
  working: '<circle cx="9" cy="8" r="3.6"/><path d="M2.6 20.2c.8-3.6 3.3-5.6 6.4-5.6s5.6 2 6.4 5.6"/><path d="m15.6 10.6 2.1 2.1 4.1-4.2"/>',
  map: '<path d="M9 4 3.5 6.2v13.6L9 17.6l6 2.4 5.5-2.2V4.2L15 6.4z"/><path d="M9 4v13.6M15 6.4V20"/>',
  projects: '<rect x="3" y="7" width="18" height="13.5" rx="2.2"/><path d="M8.5 7V5.6A1.6 1.6 0 0 1 10.1 4h3.8a1.6 1.6 0 0 1 1.6 1.6V7"/><path d="M3 12.8h18"/><path d="M10.5 12.8v1.6h3v-1.6"/>',
  sites: '<path d="M3.5 21V8.6l6-4.1V21"/><path d="M9.5 21V10.5h11V21"/><path d="M2 21h20"/><path d="M13.2 14h3.6M13.2 17.5h3.6M6 11.5h.9M6 15h.9"/>',
  schedule: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.2"/><path d="M3 9.5h18M8 2.8v3.6M16 2.8v3.6"/><path d="M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2"/>',
  updates: '<path d="M4.2 7.6h2.9l1.5-2.2a1.4 1.4 0 0 1 1.2-.6h4.4a1.4 1.4 0 0 1 1.2.6l1.5 2.2h2.9A1.2 1.2 0 0 1 21 8.8v10a1.2 1.2 0 0 1-1.2 1.2H4.2A1.2 1.2 0 0 1 3 18.8v-10a1.2 1.2 0 0 1 1.2-1.2z"/><circle cx="12" cy="13.4" r="3.6"/>',
  trips: '<path d="M3.6 16.6v-3.9a2 2 0 0 1 .5-1.3L6 9.2l1.4-3.3A1.5 1.5 0 0 1 8.8 5h6.4a1.5 1.5 0 0 1 1.4.9L18 9.2l1.9 2.2a2 2 0 0 1 .5 1.3v3.9a1 1 0 0 1-1 1H4.6a1 1 0 0 1-1-1z"/><path d="M6 9.2h12M6 17.6v2M18 17.6v2"/><circle cx="7.6" cy="13.4" r="1.1"/><circle cx="16.4" cy="13.4" r="1.1"/>',
  employees: '<circle cx="9" cy="8" r="3.6"/><path d="M2.6 20.2c.8-3.6 3.3-5.6 6.4-5.6s5.6 2 6.4 5.6"/><path d="M15.8 4.6a3.6 3.6 0 0 1 0 6.9M18.3 14.9c1.7.9 2.7 2.6 3.1 5.3"/>',
  workers: '<path d="M3 17.2h18"/><path d="M5.2 17.2v-3.4a6.8 6.8 0 0 1 13.6 0v3.4"/><path d="M10 7.3v3.4M14 7.3v3.4"/><path d="M4 17.2v1.6A1.2 1.2 0 0 0 5.2 20h13.6a1.2 1.2 0 0 0 1.2-1.2v-1.6"/>',
  attendance: '<circle cx="12" cy="12.5" r="8.5"/><path d="M12 7.8v4.7l3.1 1.9"/><path d="M9.5 2.5h5"/>',
  idcard: '<rect x="2.5" y="4.8" width="19" height="14.4" rx="2.2"/><circle cx="8.5" cy="10.8" r="2.3"/><path d="M5.3 16c.5-1.7 1.7-2.7 3.2-2.7s2.7 1 3.2 2.7"/><path d="M14.5 9.8h4.2M14.5 13.2h3"/>',
  company: '<path d="M14 2.8H7.2A2.2 2.2 0 0 0 5 5v14a2.2 2.2 0 0 0 2.2 2.2h9.6A2.2 2.2 0 0 0 19 19V7.8z"/><path d="M14 2.8v5h5"/><path d="M8.8 12.5h6.4M8.8 16h4.2"/>',
  requests: '<path d="M3 13.2h4.8l1.6 2.8h5.2l1.6-2.8H21"/><path d="M5.6 5h12.8L21 13.2v5.4a2.2 2.2 0 0 1-2.2 2.2H5.2A2.2 2.2 0 0 1 3 18.6v-5.4z"/>',
  petty: '<path d="M18.5 7.2V5.6A1.6 1.6 0 0 0 16.9 4H5.4a2.2 2.2 0 0 0 0 4.4h14.4a1.2 1.2 0 0 1 1.2 1.2v3.2"/><path d="M3.2 6.2v12.2a2.2 2.2 0 0 0 2.2 2.2h14.4a1.2 1.2 0 0 0 1.2-1.2v-3.2"/><path d="M21 12h-3.8a2 2 0 0 0 0 4H21z"/>',
  accounts: '<path d="M4.5 4.6A1.6 1.6 0 0 1 6.1 3H19.5v15.2H6.1a1.6 1.6 0 0 0-1.6 1.6z"/><path d="M4.5 19.8A1.6 1.6 0 0 0 6.1 21.4h13.4v-3.2"/><path d="M8.5 7.2h7M8.5 10.6h7M8.5 14h4"/>',
  reports: '<path d="M3 20.5h18"/><rect x="4.8" y="11" width="3.6" height="6.8" rx="1"/><rect x="10.2" y="5.5" width="3.6" height="12.3" rx="1"/><rect x="15.6" y="13.6" width="3.6" height="4.2" rx="1"/>',
  backup: '<ellipse cx="12" cy="5.6" rx="7.8" ry="2.8"/><path d="M4.2 5.6v6.2c0 1.6 3.5 2.8 7.8 2.8s7.8-1.2 7.8-2.8V5.6"/><path d="M4.2 11.8V18c0 1.6 3.5 2.8 7.8 2.8s7.8-1.2 7.8-2.8v-6.2"/>',
};
const navIcon = (k) => `<span class="ni"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${NAV_ICONS[k] || ''}</svg></span>`;

const NAV = [
  { path: '', label: 'Dashboard', icon: 'dashboard', page: dashboard },
  { path: 'working', label: 'Working now', icon: 'working', page: working, badge: () => store.open.length + store.extOnSite.length, badgeColor: 'green' },
  { path: 'map', label: 'Live map', icon: 'map', page: livemap },
  { sep: 'Work' },
  { path: 'projects', label: 'Projects', icon: 'projects', page: projects },
  { path: 'sites', label: 'Sites', icon: 'sites', page: sites },
  { path: 'schedule', label: 'Schedule', icon: 'schedule', page: schedule },
  { path: 'updates', label: 'Site updates', icon: 'updates', page: updates },
  { path: 'trips', label: 'Trips & rides', icon: 'trips', page: trips, badge: () => store.tripsActive.length, badgeColor: 'green' },
  { sep: 'People' },
  { path: 'employees', label: 'Employees', icon: 'employees', page: employees },
  { path: 'workers', label: 'External workers', icon: 'workers', page: workers },
  { path: 'attendance', label: 'Attendance', icon: 'attendance', page: attendance },
  { path: 'documents', label: 'ID documents', icon: 'idcard', page: documents },
  { path: 'company', label: 'Company documents', icon: 'company', page: company },
  { path: 'requests', label: 'Change requests', icon: 'requests', page: requests, badge: () => store.requests.length },
  { sep: 'Finance', adminOnly: true, accounts: true },
  { path: 'petty', label: 'Petty cash', icon: 'petty', page: petty, badge: () => store.pendingPetty.length, adminOnly: true },
  { path: 'accounts', label: 'Accounts', icon: 'accounts', page: accounts, adminOnly: true, accounts: true },
  { sep: 'Output' },
  { path: 'reports', label: 'Reports', icon: 'reports', page: reports },
  { path: 'backup', label: 'Backup & storage', icon: 'backup', page: backup, adminOnly: true },
];

let cleanup = null;
let loginError = '';
let navSub = null;

// ------------------------------------------------------------------ login
function renderLogin(error = '') {
  store.stop();
  app.innerHTML = `
  <div class="login-wrap">
    <form class="login-card" id="login-form">
      <img class="logo" src="img/logo.png" alt="LLCT">
      <h1>LLCT Attendance</h1>
      <p class="muted">Management dashboard — sign in with your manager ID.</p>
      <label class="f"><span>Login ID or email</span><input name="id" autocomplete="username" required placeholder="admin"></label>
      <label class="f"><span>Password</span><input name="pw" type="password" autocomplete="current-password" required></label>
      <div class="error">${esc(error)}</div>
      <button class="btn block" type="submit">Sign in</button>
    </form>
  </div>`;
  const form = document.getElementById('login-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      await login(form.id.value, form.pw.value);
    } catch (err) {
      renderLogin(friendlyError(err));
    }
  };
}

// ------------------------------------------------------------------ shell
function renderShell() {
  const me = store.me;
  app.innerHTML = `
  <div class="shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><img class="mark" src="img/icon-192.png" alt="LLCT"><div><b>LLCT Attendance</b><span>Management</span></div></div>
      <div class="gsearch"><span class="gs-ico">${icon('search', 15)}</span><input id="gs" placeholder="Search…   ( / )" title="Search people, workers, sites, projects, pages" autocomplete="off"><kbd>/</kbd>
        <div class="gs-list" id="gs-list"></div></div>
      <nav class="nav" id="nav"></nav>
      <div class="me">${avatar(me.name, 32)}<div class="who"><b>${esc(me.name)}</b><span class="small">${ROLE_LABEL[me.role] || ''}</span></div>
        <button id="logout" title="Sign out">${icon('logout')}</button></div>
    </aside>
    <div class="main">
      <div class="topbar">
        <button class="btn ghost icon menu-btn" id="menu">${icon('menu')}</button>
        <div class="title"><h1 id="page-title"></h1><div class="muted" id="page-sub"></div></div>
        <div id="page-actions" class="row"></div>
      </div>
      <div id="data-warn"></div>
      <div class="content" id="content"></div>
    </div>
  </div>`;
  document.getElementById('logout').onclick = () => logout();
  document.getElementById('menu').onclick = () => document.getElementById('sidebar').classList.toggle('open');
  wireSearch();
  renderNav();
  if (navSub) navSub();
  navSub = store.on(renderNav);
  route();
}

// ------------------------------------------------------------------ global search
function wireSearch() {
  const input = document.getElementById('gs');
  const list = document.getElementById('gs-list');
  let hits = [], sel = 0;
  const go = (h) => { if (!h) return; location.hash = h.href; input.value = ''; list.classList.remove('open'); input.blur(); };
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { list.classList.remove('open'); return; }
    const has = (...v) => v.join(' ').toLowerCase().includes(q);
    hits = [
      ...store.users.filter((u) => has(u.name, u.loginId, u.phone, u.designation)).map((u) => ({ t: u.name, s: `${ROLE_LABEL[u.role] || 'Staff'} · ${u.loginId}`, href: `#/employees/${u.id}`, k: 'Staff' })),
      ...store.workers.filter((w) => has(w.name, w.phone, w.company, w.trade, w.code, store.info(w.id)?.passportNo, store.info(w.id)?.eidNo))
        .map((w) => ({ t: w.name, s: [w.company, w.trade].filter(Boolean).join(' · ') || 'External worker', href: `#/workers/${w.id}`, k: 'Worker' })),
      ...store.sites.filter((x) => has(x.name, x.address)).map((x) => ({ t: x.name, s: x.address || 'Site', href: `#/sites/${x.id}`, k: 'Site' })),
      ...store.projects.filter((x) => has(x.name, x.code, x.client)).map((x) => ({ t: x.name, s: x.client || 'Project', href: `#/projects/${x.id}`, k: 'Project' })),
      ...NAV.filter((n) => !n.sep && (!n.adminOnly || isAdmin()) && has(n.label)).map((n) => ({ t: n.label, s: 'Page', href: `#/${n.path}`, k: 'Page' })),
    ].slice(0, 12);
    sel = 0;
    list.innerHTML = hits.length ? hits.map((h, i) => `<a href="${h.href}" class="${i === sel ? 'on' : ''}" data-i="${i}"><span class="k">${h.k}</span><b>${esc(h.t)}</b><span class="s">${esc(h.s)}</span></a>`).join('')
      : '<div class="none">No matches</div>';
    list.classList.add('open');
    list.querySelectorAll('a').forEach((a) => { a.onmousedown = (e) => { e.preventDefault(); go(hits[Number(a.dataset.i)]); }; });
  };
  input.oninput = draw;
  input.onfocus = draw;
  input.onblur = () => setTimeout(() => list.classList.remove('open'), 150);
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % Math.max(1, hits.length);
      list.querySelectorAll('a').forEach((a, i) => a.classList.toggle('on', i === sel));
    } else if (e.key === 'Enter') { e.preventDefault(); go(hits[sel]); } else if (e.key === 'Escape') { input.value = ''; draw(); input.blur(); }
  };
}
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) {
    const i = document.getElementById('gs');
    if (i) { e.preventDefault(); document.getElementById('sidebar')?.classList.add('open'); i.focus(); }
  }
});

function currentPath() {
  const h = location.hash.replace(/^#\/?/, '');
  const [base, ...rest] = h.split('/');
  return { base: base || '', params: rest.map(decodeURIComponent) };
}

function renderWarn() {
  const box = document.getElementById('data-warn');
  if (!box) return;
  const errs = Object.values(store.errors || {});
  box.innerHTML = errs.length ? `<div class="data-warn">${icon('warn', 18)}<div><b>Some data could not be loaded</b> — ${esc(errs.join(' · '))}
    ${errs.some((e) => /permission/i.test(e)) ? '<br>This usually means the latest <b>Firestore rules are not published</b>. Copy them from <a href="https://raw.githubusercontent.com/anwar3000/llct-att/main/firestore.rules" target="_blank" rel="noopener">firestore.rules</a> → Firebase → Firestore Database → Rules → Publish, then reload.' : ''}</div></div>` : '';
}

/** Which menu items this person sees: managers everything but admin pages; Accounts also for people allowed to view it. */
function navAllowed(n) {
  if (isLimited()) return !!n.accounts && canSeeAccounts();
  if (n.accounts) return canSeeAccounts();
  return !n.adminOnly || isAdmin();
}

function renderNav() {
  renderWarn();
  const nav = document.getElementById('nav');
  if (!nav) return;
  const { base } = currentPath();
  nav.innerHTML = NAV.filter(navAllowed).map((n) => {
    if (n.sep) return `<div class="sep">${n.sep}</div>`;
    const b = n.badge ? n.badge() : 0;
    return `<a href="#/${n.path}" class="${n.path === base ? 'active' : ''}" title="${n.label}">${navIcon(n.icon)}<span class="nl">${n.label}</span>${b ? `<span class="badge${n.badgeColor ? ` ${n.badgeColor}` : ''}">${b}</span>` : ''}</a>`;
  }).join('');
}

export function setHeader(title, sub = '', actions = '') {
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-sub').innerHTML = sub;
  document.getElementById('page-actions').innerHTML = actions;
  document.title = `${title} · LLCT Attendance`;
}

function route() {
  const content = document.getElementById('content');
  if (!content) return;
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  document.getElementById('sidebar')?.classList.remove('open');
  const { base, params } = currentPath();
  const entry = NAV.find((n) => !n.sep && n.path === base && navAllowed(n)) || NAV.find((n) => !n.sep && navAllowed(n)) || NAV[0];
  renderNav();
  content.innerHTML = '';
  setHeader(entry.label);
  try {
    cleanup = entry.page.mount(content, params, { setHeader }) || null;
  } catch (e) {
    console.error(e);
    content.innerHTML = `<div class="card card-pad error">Something went wrong: ${esc(e.message)}</div>`;
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => { if (store.me) route(); });

// ------------------------------------------------------------------ auth gate
onAuthStateChanged(auth, async (user) => {
  if (!user) { store.me = null; renderLogin(loginError); loginError = ''; return; }
  try {
    const me = await getMe(user.uid);
    if (!me) {
      loginError = `No staff profile for this login. Create Firestore document users/${user.uid} with role = admin.`;
      await logout();
      return;
    }
    const viewer = me.active && (me.canViewAccounts === true || me.canEditAccounts === true);
    if ((!['admin', 'manager'].includes(me.role) || !me.active) && !viewer) {
      loginError = me.role === 'docs' ? 'Document clerks use the Documents Portal: open portal.html on this site.' : 'This dashboard is for managers only. Staff should use the mobile app.';
      await logout();
      return;
    }
    store.me = me;
    // Staff with only the Accounts permission get just that page (no other dashboard data).
    if (['admin', 'manager'].includes(me.role)) store.start();
    else if (!location.hash.startsWith('#/accounts')) location.hash = '#/accounts';
    renderShell();
  } catch (e) {
    loginError = friendlyError(e);
    await logout().catch(() => {});
  }
});
