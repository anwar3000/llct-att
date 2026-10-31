// Firebase web config for the LLCT Service Desk.
//
// By default it is taken from the attendance dashboard (llct.net), which uses the SAME
// Firebase project — so this folder needs no setup.
//
// To make this folder fully standalone, replace the line below with your config, e.g.
//   export const firebaseConfig = {
//     apiKey: '...', authDomain: '...', projectId: '...',
//     storageBucket: '...', messagingSenderId: '...', appId: '...',
//   };
// (Firebase console → Project settings → Your apps → Web app → Config.)
export { firebaseConfig } from 'https://llct.net/js/config.js';
