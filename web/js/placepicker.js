// Map + address search used when adding / editing a site.
//
// * With a Google Maps API key (secret GOOGLE_MAPS_API_KEY) → Google Maps with
//   Google Places address autocomplete.
// * Without a key, or if Google fails → OpenStreetMap map with free address
//   autocomplete (Photon / Nominatim).
// * Always accepts a pasted Google Maps link or "lat, lng" coordinates.
import * as cfg from './config.js';
import { esc, toast, icon } from './util.js';
import { DEFAULT_CENTER } from './mapkit.js';

const GOOGLE_KEY = cfg.googleMapsApiKey || '';
const ORANGE = '#D98A1A';

// ------------------------------------------------------------------ Google loader
let gPromise = null;
let gAuthFailed = false;
let gLastError = '';
const gFailListeners = new Set();
window.gm_authFailure = () => {
  gAuthFailed = true;
  console.warn('Google Maps key rejected');
  setTimeout(() => gFailListeners.forEach((fn) => fn()), 50);
};
// Google prints the real reason (RefererNotAllowedMapError, ApiNotActivatedMapError, …) to the console.
const origErr = console.error.bind(console);
console.error = (...a) => {
  const t = a.map((x) => String(x && x.message ? x.message : x)).join(' ');
  const m = t.match(/Google Maps JavaScript API (?:error|warning): (\w+)/);
  if (m) gLastError = m[1];
  origErr(...a);
};
const REASONS = {
  RefererNotAllowedMapError: 'this website address is not allowed on the key — add https://anwar3000.github.io/* under Website restrictions',
  ApiNotActivatedMapError: 'Maps JavaScript API is not enabled for this project',
  BillingNotEnabledMapError: 'billing is not enabled on the Google Cloud project',
  InvalidKeyMapError: 'the key is invalid (check the GOOGLE_MAPS_API_KEY secret)',
  ApiTargetBlockedMapError: 'the key\'s API restrictions block Maps JavaScript API',
  MissingKeyMapError: 'no key was sent',
};
export function googleStatus() {
  if (!GOOGLE_KEY) return 'No Google Maps key configured — using free OpenStreetMap search.';
  if (gAuthFailed || gLastError) return `Google Maps rejected the key${gLastError ? ` (${gLastError}): ${REASONS[gLastError] || 'see Google Cloud console'}` : ''} — using free map instead.`;
  return '';
}

function loadGoogle() {
  if (!GOOGLE_KEY || gAuthFailed) return Promise.resolve(null);
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  if (!gPromise) {
    gPromise = new Promise((resolve, reject) => {
      window.__gmapsReady = () => resolve(window.google.maps);
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_KEY)}&v=weekly&libraries=places&loading=async&callback=__gmapsReady`;
      s.async = true;
      s.onerror = () => reject(new Error('Google Maps failed to load'));
      document.head.appendChild(s);
      setTimeout(() => reject(new Error('Google Maps timed out')), 12000);
    }).catch((e) => { console.warn(e); gPromise = null; return null; });
  }
  return gPromise;
}

// ------------------------------------------------------------------ helpers
/** Extract coordinates from a pasted Google Maps URL or "lat, lng" text. */
export function parseCoords(text) {
  const t = String(text || '').trim();
  const pats = [
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,           // google place data
    /@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/,             // .../@10.01,76.31,17z
    /[?&](?:q|query|ll|destination)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /^(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)$/,       // 10.01, 76.31
  ];
  for (const p of pats) {
    const m = t.match(p);
    if (m) {
      const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

async function freeSuggest(q, near) {
  try {
    const bias = near ? `&lat=${near.lat}&lon=${near.lng}` : '&lat=20.6&lon=78.9';
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en${bias}`);
    const j = await r.json();
    const out = (j.features || []).map((f) => {
      const p = f.properties || {};
      const main = p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.city || '';
      const sub = [p.street && p.name ? p.street : '', p.district, p.city, p.state, p.country].filter(Boolean)
        .filter((x, i, a) => a.indexOf(x) === i && x !== main).join(', ');
      return { main, sub, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
    }).filter((x) => x.main);
    if (out.length) return out;
  } catch (e) { console.warn('photon', e); }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q)}`);
    const j = await r.json();
    return j.map((x) => {
      const parts = x.display_name.split(',');
      return { main: parts[0], sub: parts.slice(1, 4).join(',').trim(), lat: parseFloat(x.lat), lng: parseFloat(x.lon) };
    });
  } catch (e) { console.warn('nominatim', e); return []; }
}

async function googleSuggest(gm, q, near, token) {
  const { AutocompleteSuggestion } = await gm.importLibrary('places');
  const req = { input: q, sessionToken: token };
  if (near) req.locationBias = { center: near, radius: 50000 };
  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
  return suggestions.filter((s) => s.placePrediction).map((s) => {
    const p = s.placePrediction;
    return {
      main: p.mainText ? p.mainText.toString() : p.text.toString(),
      sub: p.secondaryText ? p.secondaryText.toString() : '',
      prediction: p,
    };
  });
}

// ------------------------------------------------------------------ picker
/**
 * Mounts the picker into `root`.
 * opts: { lat, lng, radius, onPick(lat, lng, label) }
 * returns { setRadius(r), destroy() }
 */
export function createPlacePicker(root, opts) {
  let lat = opts.lat ?? null, lng = opts.lng ?? null;
  let radius = opts.radius ?? 200;
  root.innerHTML = `
    <div class="ac-wrap">
      <div class="row" style="margin-bottom:8px;flex-wrap:nowrap">
        <div style="position:relative;flex:1">
          <input class="pp-q" autocomplete="off" placeholder="Search address or place — or paste a Google Maps link / coordinates">
          <div class="ac-list hidden"></div>
        </div>
        <button type="button" class="btn ghost sm pp-me" title="Use my current location">${icon('pin', 14)} My location</button>
      </div>
      <div class="pp-map map small"><div class="boot" style="height:100%"><div class="spinner"></div></div></div>
      <div class="small muted pp-hint" style="margin-top:6px">Click the map or drag the pin to fine-tune the exact spot.</div>
    </div>`;
  const input = root.querySelector('.pp-q');
  const list = root.querySelector('.ac-list');
  const mapEl = root.querySelector('.pp-map');
  let engine = null; // { setPoint(lat,lng,move), setRadius(r), center(), destroy() }
  let gm = null, token = null;
  let items = [], active = -1, timer = null, seq = 0;

  const pick = (la, ln, label, move = true) => {
    lat = la; lng = ln;
    engine?.setPoint(la, ln, move);
    opts.onPick?.(la, ln, label || '');
  };

  // ---------- map engines
  function leafletEngine() {
    const L = window.L;
    mapEl.innerHTML = '';
    const map = L.map(mapEl).setView(lat != null ? [lat, lng] : DEFAULT_CENTER, lat != null ? 17 : 5);
    const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' });
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery &copy; Esri' });
    street.addTo(map);
    L.control.layers({ Map: street, Satellite: sat }, null, { position: 'topright' }).addTo(map);
    setTimeout(() => map.invalidateSize(), 60);
    let marker = null, circle = null;
    const setPoint = (la, ln, move) => {
      if (!marker) {
        marker = L.marker([la, ln], { draggable: true }).addTo(map);
        marker.on('dragend', () => { const p = marker.getLatLng(); pick(p.lat, p.lng, '', false); });
        circle = L.circle([la, ln], { radius, color: ORANGE, fillColor: ORANGE, fillOpacity: 0.12 }).addTo(map);
      } else { marker.setLatLng([la, ln]); circle.setLatLng([la, ln]); }
      if (move) map.setView([la, ln], 17);
    };
    map.on('click', (e) => pick(e.latlng.lat, e.latlng.lng, '', false));
    return {
      setPoint, setRadius: (r) => circle?.setRadius(r),
      center: () => { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; },
      destroy: () => map.remove(),
    };
  }

  async function googleEngine(g) {
    const { Map, Circle } = await g.importLibrary('maps');
    const { Marker } = await g.importLibrary('marker');
    mapEl.innerHTML = '';
    const map = new Map(mapEl, {
      center: lat != null ? { lat, lng } : { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] },
      zoom: lat != null ? 17 : 5, mapTypeControl: true, streetViewControl: false, fullscreenControl: true, gestureHandling: 'greedy',
    });
    let marker = null, circle = null;
    const setPoint = (la, ln, move) => {
      const pos = { lat: la, lng: ln };
      if (!marker) {
        marker = new Marker({ map, position: pos, draggable: true });
        marker.addListener('dragend', (e) => pick(e.latLng.lat(), e.latLng.lng(), '', false));
        circle = new Circle({ map, center: pos, radius, strokeColor: ORANGE, strokeWeight: 2, fillColor: ORANGE, fillOpacity: 0.12, clickable: false });
      } else { marker.setPosition(pos); circle.setCenter(pos); }
      if (move) { map.panTo(pos); map.setZoom(17); }
    };
    map.addListener('click', (e) => pick(e.latLng.lat(), e.latLng.lng(), '', false));
    return {
      setPoint, setRadius: (r) => circle?.setRadius(r),
      center: () => { const c = map.getCenter(); return { lat: c.lat(), lng: c.lng() }; },
      destroy: () => { mapEl.innerHTML = ''; },
    };
  }

  const hint = root.querySelector('.pp-hint');
  const useFree = (why) => {
    gm = null;
    engine?.destroy();
    engine = leafletEngine();
    if (lat != null) engine.setPoint(lat, lng, false);
    hint.innerHTML = `<span style="color:#a8640f">⚠ ${esc(why || googleStatus())}</span><br>Click the map or drag the pin to fine-tune the exact spot.`;
  };
  const onFail = () => useFree(googleStatus());
  gFailListeners.add(onFail);
  (async () => {
    gm = await loadGoogle();
    if (gm && !gAuthFailed) {
      try {
        engine = await googleEngine(gm);
        const { AutocompleteSessionToken } = await gm.importLibrary('places');
        token = new AutocompleteSessionToken();
        hint.textContent = 'Google Maps · click the map or drag the pin to fine-tune the exact spot.';
        if (lat != null) engine.setPoint(lat, lng, false);
        return;
      } catch (e) { console.warn(e); useFree(`Google Maps could not start: ${e.message || e}`); return; }
    }
    useFree(GOOGLE_KEY ? (googleStatus() || 'Google Maps did not load (blocked or offline)') : googleStatus());
  })();

  // ---------- search box
  function render() {
    if (!items.length) { list.classList.add('hidden'); return; }
    list.innerHTML = items.map((it, i) => `<div class="ac-item ${i === active ? 'on' : ''}" data-i="${i}">
      <div class="ac-main">${esc(it.main)}</div>${it.sub ? `<div class="ac-sub">${esc(it.sub)}</div>` : ''}</div>`).join('') +
      `<div class="ac-foot">${gm ? 'Powered by Google' : 'Search © OpenStreetMap contributors'}</div>`;
    list.classList.remove('hidden');
    list.querySelectorAll('[data-i]').forEach((el) => { el.onmousedown = (e) => { e.preventDefault(); choose(Number(el.dataset.i)); }; });
  }

  async function choose(i) {
    const it = items[i];
    items = []; render();
    if (!it) return;
    const label = [it.main, it.sub].filter(Boolean).join(', ');
    input.value = label;
    if (it.prediction) {
      try {
        const place = it.prediction.toPlace();
        await place.fetchFields({ fields: ['location', 'formattedAddress', 'displayName'] });
        const { AutocompleteSessionToken } = await gm.importLibrary('places');
        token = new AutocompleteSessionToken();
        pick(place.location.lat(), place.location.lng(), place.formattedAddress || label);
      } catch (e) { console.warn(e); toast('Could not get that place — try another result', true); }
    } else {
      pick(it.lat, it.lng, label);
    }
  }

  async function suggest(q) {
    const my = ++seq;
    const near = engine?.center() || null;
    let res = [];
    if (gm) {
      try { res = await googleSuggest(gm, q, lat != null ? { lat, lng } : near, token); }
      catch (e) {
        console.warn('Google Places unavailable, using free search', e);
        gm = null;
        hint.innerHTML = `<span style="color:#a8640f">⚠ Google address search failed: ${esc((e && e.message) || e)}. Check that “Places API (New)” is enabled and allowed for this key. Using free search.</span>`;
      }
    }
    if (!gm) res = await freeSuggest(q, lat != null ? { lat, lng } : null);
    if (my !== seq) return;
    items = res; active = -1; render();
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(timer);
    const c = parseCoords(q);
    if (c) { items = [{ main: `Go to ${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`, sub: 'From pasted link / coordinates', lat: c.lat, lng: c.lng }]; active = 0; render(); return; }
    if (/maps\.app\.goo\.gl|goo\.gl\/maps/.test(q)) {
      items = []; render();
      toast('Short links can’t be read. Open the link, then copy the full URL from the address bar (it contains @lat,lng).', true);
      return;
    }
    if (q.length < 3) { items = []; render(); return; }
    timer = setTimeout(() => suggest(q), 300);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items.length) choose(active >= 0 ? active : 0); }
    else if (e.key === 'Escape') { items = []; render(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { items = []; render(); }, 150));

  root.querySelector('.pp-me').onclick = () => {
    if (!navigator.geolocation) return toast('Location not available in this browser', true);
    navigator.geolocation.getCurrentPosition((p) => pick(p.coords.latitude, p.coords.longitude, ''),
      () => toast('Could not get your location', true), { enableHighAccuracy: true, timeout: 15000 });
  };

  return {
    setRadius: (r) => { radius = r; engine?.setRadius(r); },
    setPoint: (la, ln) => { lat = la; lng = ln; engine?.setPoint(la, ln, true); },
    destroy: () => { clearTimeout(timer); gFailListeners.delete(onFail); engine?.destroy(); },
  };
}
