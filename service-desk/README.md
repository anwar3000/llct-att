# LLCT Service Desk

Client service requests (CCTV AMC and other call-outs) for Leaders Line, on the **same Firebase project** as LLCT Attendance and LLCT Invoicing.

| Page | Who | What |
|---|---|---|
| `index.html?c=<token>` | Clients (no login) | Raise a request: site, service type, priority, preferred visit time, photos, contact. Track every request live (status, technician, visit time, service report no.). |
| `desk.html` | Staff (attendance login) | All tickets with live popup + sound for new requests, assign the nearest technician, schedule the visit, status, timeline, WhatsApp updates, client links, per-client history, reports & CSV. |

The attendance app (Android) also shows a popup for every new request, a **Service requests** button (badge) with *New / My jobs / All open*, nearest-first assignment, Google Maps navigation to the site GPS, and *Make service report* (opens LLCT Invoicing pre-filled; the report number comes back to the ticket and the client sees it). The llct.net dashboard pops up new requests for management too.

## Install on the AWS server (a plain folder — no build, no Node)

1. Copy this folder to the web root, e.g.
   ```bash
   scp -r service-desk admin@52.221.223.27:/tmp/
   ssh admin@52.221.223.27 'sudo mkdir -p /var/www/html/service && sudo cp -r /tmp/service-desk/* /var/www/html/service/'
   ```
   Any web server works (nginx / Apache). Serve it over **HTTPS** (needed for "use my location" and copy buttons).
2. Publish the Firestore rules: copy the whole `firestore.rules` from the repo root → Firebase console → Firestore Database → Rules → **Publish**.
3. Open `https://<your-domain>/service/desk.html` as an **admin** once. It saves its own address so the attendance app and llct.net can link to it.
4. *Clients & links* → **Create link** for each client → Copy / WhatsApp it to the client.

### Firebase config
`js/config.js` takes the config from `https://llct.net/js/config.js` (same project), so nothing to fill in. To make the folder standalone, paste your Firebase web config into `js/config.js` instead (instructions inside). If your Firebase API key has *website restrictions*, add your AWS domain to them.

## How a ticket moves
`Received (new)` → `Assigned` (admin / manager / staff allowed to assign) or picked up directly by a technician → `Accepted` → `On the way` → `At site` → `Completed` (button, or automatically when the customer signs the service report) → `Closed` by the office. Every step is logged and the client sees a plain-English message for it.

Response times: Critical 4 h, High 24 h, Normal 48 h, Low 96 h (tickets past this show as *Overdue*).

## Data (Firestore)
- `svcTickets/{SR-yymmdd-nnnn}` — the ticket (staff only).
- `svcPortals/{token}` — one private link per client (client id, name, sites with GPS synced from the client's sites in Invoicing). Disable / replace any time.
- `svcPortals/{token}/tickets/{id}` — what the client sees for each ticket.
- `users/{uid}.canAssignService` — staff allowed to assign jobs (Settings page).
- `settings/service` — desk address.

Photos from clients are compressed (~150 KB) and stored inside the ticket — no Storage bucket needed.

## Notes
- Popups appear while the desk page / app is open. Background push notifications to phones need Firebase Cloud Messaging + Cloud Functions (Blaze plan) — can be added later.
- Clients and sites come from LLCT Invoicing (`inv_clients` and their sites). Add GPS to a site there and it reaches the client's link and the technicians' navigation automatically.
