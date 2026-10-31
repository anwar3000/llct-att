// Service requests from clients (LLCT Service Desk): popup on the management dashboard
// whenever a new request comes in, plus a floating "Service desk" button with the open count.
import { db } from './fb.js';
import { collection, doc, getDoc, onSnapshot, query, where } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const PRIO = { critical: ['Critical', '#d64545'], high: ['High', '#e08e2b'], normal: ['Normal', '#3a7bd5'], low: ['Low', '#75757a'] };
const TYPES = {
  camera: 'CCTV camera not working', recording: 'NVR / DVR not recording', remote: 'No remote / mobile view', image: 'Image blurry, dark or no night vision',
  hdd: 'Hard disk / storage error', playback: 'Footage backup / playback needed', power: 'Power, cable or PoE issue', network: 'Network / Wi‑Fi / internet',
  access: 'Access control / door / intercom', ppm: 'Preventive maintenance (AMC visit)', install: 'New camera / relocation', other: 'Other',
};
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let unsub = null;
let deskUrl = '';

function beep() {
  try {
    const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
    const ctx = beep.c || (beep.c = new A()); if (ctx.state === 'suspended') ctx.resume();
    [0, 0.3, 0.6].forEach((d, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + d;
      o.frequency.value = i % 2 ? 660 : 880; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.26);
    });
  } catch (_) { /* ignore */ }
}

function fab(n) {
  let b = document.getElementById('svc-fab');
  if (!b) {
    b = document.createElement('a'); b.id = 'svc-fab'; b.target = '_blank'; b.rel = 'noopener';
    b.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:900;background:#2b2b2c;color:#fff;padding:10px 14px;border-radius:24px;font-weight:700;font-size:13px;box-shadow:0 6px 18px rgba(0,0,0,.25);display:flex;gap:8px;align-items:center;text-decoration:none';
    document.body.appendChild(b);
  }
  b.href = deskUrl || '#';
  b.style.display = deskUrl || n ? 'flex' : 'none';
  b.innerHTML = `<span>🛠 Service desk</span>${n ? `<span style="background:#d64545;border-radius:10px;padding:1px 7px">${n} new</span>` : ''}`;
}

function popup(t) {
  const [pl, pc] = PRIO[t.priority] || PRIO.normal;
  const o = document.createElement('div');
  o.style.cssText = 'position:fixed;inset:0;background:rgba(20,20,22,.45);z-index:1000;display:flex;align-items:center;justify-content:center;padding:14px';
  o.innerHTML = `<div style="background:#fff;border-radius:16px;max-width:460px;width:100%;border-top:6px solid ${pc};box-shadow:0 20px 50px rgba(0,0,0,.3);font-family:inherit">
    <div style="padding:16px 18px"><div style="display:flex;gap:8px;align-items:center"><span style="background:${pc};color:#fff;border-radius:20px;padding:2px 9px;font-size:12px;font-weight:700">${pl}</span>
      <b style="font-size:16px">New service request</b><span style="margin-left:auto;color:#75757a;font-family:monospace;font-size:12px">${esc(t.number || t.id)}</span></div>
      <div style="margin-top:12px;font-size:16px"><b>${esc(t.clientName)}</b><br>${esc(t.siteName)}</div>
      <div style="margin-top:8px"><b>${esc(TYPES[t.category] || t.category || '')}</b><div style="color:#75757a">${esc(t.description)}</div></div></div>
    <div style="padding:12px 18px;border-top:1px solid #ebe8e3;display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" data-x>Later</button>${deskUrl ? '<a class="btn primary" data-go target="_blank" rel="noopener">Open service desk</a>' : ''}</div></div>`;
  const go = o.querySelector('[data-go]'); if (go) { go.href = deskUrl; go.onclick = () => o.remove(); }
  o.addEventListener('click', (e) => { if (e.target === o || e.target.closest('[data-x]')) o.remove(); });
  document.body.appendChild(o);
}

export function startServiceAlerts() {
  if (unsub) return;
  getDoc(doc(db, 'settings', 'service')).then((s) => { deskUrl = (s.exists() && s.data().deskUrl) || ''; fab(0); }).catch(() => {});
  let first = true;
  unsub = onSnapshot(query(collection(db, 'svcTickets'), where('open', '==', true)), (q) => {
    if (!first) {
      q.docChanges().forEach((ch) => {
        if (ch.type === 'added' && ch.doc.data().status === 'new') { beep(); popup({ id: ch.doc.id, ...ch.doc.data() }); }
      });
    }
    first = false;
    fab(q.docs.filter((d) => d.data().status === 'new').length);
  }, () => { /* rules not published yet: stay quiet */ });
}

export function stopServiceAlerts() { if (unsub) { unsub(); unsub = null; } const b = document.getElementById('svc-fab'); if (b) b.remove(); }
