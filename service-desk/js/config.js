// Firebase web config for the LLCT Service Desk (same Firebase project as LLCT Attendance & Invoicing).
//
// It is taken from the attendance / invoicing web apps on GitHub Pages, trying each address in turn,
// so this folder needs no setup.
//
// To make this folder fully standalone, delete everything below and paste your config instead:
//   export const firebaseConfig = {
//     apiKey: '...', authDomain: '...', projectId: '...',
//     storageBucket: '...', messagingSenderId: '...', appId: '...',
//   };
// (Firebase console → Project settings → Your apps → Web app → Config.)
const SOURCES = [
  'https://anwar3000.github.io/llct-att/js/config.js',
  'https://anwar3000.github.io/llct-invoice/js/config.js',
  'https://llct.net/js/config.js',
];
let cfg = null;
for (const url of SOURCES) {
  try {
    const m = await import(url);
    if (m && m.firebaseConfig && m.firebaseConfig.apiKey) { cfg = m.firebaseConfig; break; }
  } catch (e) {
    console.warn('Firebase config not at', url, e && e.message);
  }
}
if (!cfg) throw new Error('Firebase config not found. Paste your Firebase web config into js/config.js.');
export const firebaseConfig = cfg;
