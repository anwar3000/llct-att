// Makes the Service Desk installable as an app. Always loads fresh files from the server
// (no offline cache), so updates show up straight away.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui;padding:40px;text-align:center;color:#0E1F45"><h2>No internet connection</h2><p>Connect to the internet and try again.</p>',
    { headers: { 'Content-Type': 'text/html' } })));
});
