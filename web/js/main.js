import { auth, onAuthStateChanged, login, logout, getMe, store, isAdmin, ROLE_LABEL } from './fb.js';
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

const NAV = [
  { path: '', label: 'Dashboard', icon: 'dashboard', page: dashboard },
  { path: 'working', label: 'Working now', icon: 'people', page: working, badge: () => store.open.length + store.extOnSite.length, badgeColor: 'green' },
  { path: 'map', label: 'Live map', icon: 'map', page: livemap },
  { sep: 'Work' },
  { path: 'projects', label: 'Projects', icon: 'project', page: projects },
  { path: 'sites', label: 'Sites', icon: 'site', page: sites },
  { path: 'schedule', label: 'Schedule', icon: 'calendar', page: schedule },
  { path: 'updates', label: 'Site updates', icon: 'updates', page: updates },
  { path: 'trips', label: 'Trips & rides', icon: 'car', page: trips, badge: () => store.tripsActive.length, badgeColor: 'green' },
  { sep: 'People' },
  { path: 'employees', label: 'Employees', icon: 'people', page: employees },
  { path: 'workers', label: 'External workers', icon: 'worker', page: workers },
  { path: 'attendance', label: 'Attendance', icon: 'clock', page: attendance },
  { path: 'documents', label: 'ID documents', icon: 'idcard', page: documents },
  { path: 'company', label: 'Company documents', icon: 'folder', page: company },
  { path: 'requests', label: 'Change requests', icon: 'pending', page: requests, badge: () => store.requests.length },
  { path: 'petty', label: 'Petty cash', icon: 'wallet', page: petty, badge: () => store.pendingPetty.length, adminOnly: true },
  { path: 'accounts', label: 'Accounts', icon: 'bank', page: accounts, adminOnly: true },
  { sep: 'Output' },
  { path: 'reports', label: 'Reports', icon: 'report', page: reports },
  { path: 'backup', label: 'Backup & storage', icon: 'download', page: backup, adminOnly: true },
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

function renderNav() {
  renderWarn();
  const nav = document.getElementById('nav');
  if (!nav) return;
  const { base } = currentPath();
  nav.innerHTML = NAV.filter((n) => !n.adminOnly || isAdmin()).map((n) => {
    if (n.sep) return `<div class="sep">${n.sep}</div>`;
    const b = n.badge ? n.badge() : 0;
    return `<a href="#/${n.path}" class="${n.path === base ? 'active' : ''}">${icon(n.icon)}<span>${n.label}</span>${b ? `<span class="badge${n.badgeColor ? ` ${n.badgeColor}` : ''}">${b}</span>` : ''}</a>`;
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
  const entry = NAV.find((n) => !n.sep && n.path === base && (!n.adminOnly || isAdmin())) || NAV[0];
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
    if (!['admin', 'manager'].includes(me.role) || !me.active) {
      loginError = me.role === 'docs' ? 'Document clerks use the Documents Portal: open portal.html on this site.' : 'This dashboard is for managers only. Staff should use the mobile app.';
      await logout();
      return;
    }
    store.me = me;
    store.start();
    renderShell();
  } catch (e) {
    loginError = friendlyError(e);
    await logout().catch(() => {});
  }
});
