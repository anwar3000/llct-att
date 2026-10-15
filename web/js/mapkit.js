// Leaflet helpers (OpenStreetMap tiles — no API key needed).
import { esc, initials, colorFor } from './util.js';

const L = window.L;
export const DEFAULT_CENTER = [20.5937, 78.9629];

export function makeMap(el, { center = DEFAULT_CENTER, zoom = 5 } = {}) {
  const map = L.map(el, { zoomControl: true }).setView(center, zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  setTimeout(() => map.invalidateSize(), 50);
  return map;
}

export function siteLayer(site) {
  const g = L.layerGroup();
  L.circle([site.lat, site.lng], {
    radius: site.radius, color: '#D98A1A', weight: 1.5, fillColor: '#D98A1A', fillOpacity: 0.08,
  }).addTo(g);
  L.marker([site.lat, site.lng], {
    icon: L.divIcon({
      className: '',
      html: `<div class="pin-label" style="color:#D98A1A">🏗 ${esc(site.name)}</div>`,
      iconSize: null, iconAnchor: [0, 10],
    }),
  }).addTo(g);
  return g;
}

export function employeeMarker(user, loc, { live = true } = {}) {
  const fresh = loc.at && Date.now() - loc.at.getTime() < 15 * 60000;
  const color = loc.checkedIn && fresh ? '#2E9E6A' : loc.checkedIn ? '#E08E2B' : '#8a96a0';
  return L.marker([loc.lat, loc.lng], {
    icon: L.divIcon({
      className: '',
      html: `<div style="display:flex;flex-direction:column;align-items:center">
        <div class="emp-pin" style="background:${live ? color : colorFor(user.name)}">${esc(initials(user.name))}</div>
        <div class="pin-label" style="margin-top:2px">${esc(user.name.split(' ')[0])}</div></div>`,
      iconSize: [80, 56], iconAnchor: [40, 17],
    }),
    zIndexOffset: loc.checkedIn ? 1000 : 0,
  });
}

export function fitTo(map, points, maxZoom = 16) {
  if (!points.length) return;
  if (points.length === 1) { map.setView(points[0], 15); return; }
  map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom });
}
