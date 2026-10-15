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

const app = document.getElementById('app');
window.__appStarted = true;

const NAV = [
  { path: '', label: 'Dashboard', icon: 'dashboard', page: dashboard },
  { path: 'map', label: 'Live map', icon: 'map', page: livemap },
  { sep: 'Work' },
  { path: 'projects', label: 'Projects', icon: 'project', page: projects },
  { path: 'sites', label: 'Sites', icon: 'site', page: sites },
  { path: 'schedule', label: 'Schedule', icon: 'calendar', page: schedule },
  { path: 'updates', label: 'Site updates', icon: 'updates', page: updates },
  { sep: 'People' },
  { path: 'employees', label: 'Employees', icon: 'people', page: employees },
  { path: 'attendance', label: 'Attendance', icon: 'clock', page: attendance },
  { path: 'petty', label: 'Petty cash', icon: 'wallet', page: petty, badge: () => store.pendingPetty.length, adminOnly: true },
  { sep: 'Output' },
  { path: 'reports', label: 'Reports', icon: 'report', page: reports },
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
      <div class="content" id="content"></div>
    </div>
  </div>`;
  document.getElementById('logout').onclick = () => logout();
  document.getElementById('menu').onclick = () => document.getElementById('sidebar').classList.toggle('open');
  renderNav();
  if (navSub) navSub();
  navSub = store.on(renderNav);
  route();
}

function currentPath() {
  const h = location.hash.replace(/^#\/?/, '');
  const [base, ...rest] = h.split('/');
  return { base: base || '', params: rest.map(decodeURIComponent) };
}

function renderNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const { base } = currentPath();
  nav.innerHTML = NAV.filter((n) => !n.adminOnly || isAdmin()).map((n) => {
    if (n.sep) return `<div class="sep">${n.sep}</div>`;
    const b = n.badge ? n.badge() : 0;
    return `<a href="#/${n.path}" class="${n.path === base ? 'active' : ''}">${icon(n.icon)}<span>${n.label}</span>${b ? `<span class="badge">${b}</span>` : ''}</a>`;
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
      loginError = 'This dashboard is for managers only. Staff should use the mobile app.';
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
