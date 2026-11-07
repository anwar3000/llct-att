# LLCT Service Desk

Client service requests (CCTV AMC and other call-outs) for Leaders Line, on the **same Firebase project** as LLCT Attendance and LLCT Invoicing.

| Page | Who | What |
|---|---|---|
| `index.html` | Any customer (walk-in) | Public request form: brand, store/location, contact, the request; gets a tracking link `index.html?t=…`. |
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
`js/config.js` loads the config from the attendance / invoicing web apps on GitHub Pages (same project), so nothing to fill in. To make the folder standalone, paste your Firebase web config into `js/config.js` instead (instructions inside). If your Firebase API key has *website restrictions*, add your AWS domain to them.

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

## Customer documents on this server (files.php)

Documents clients upload (trade licence, SIRA, SPC drawings…) are saved on this server in

    files/<Customer name>/<Document type>/<id>_<file name>

when `files.php` can run here (PHP). Without PHP they are kept in Firestore instead (8 MB per file).

Setup on the server (once):

    sudo apt install -y php libapache2-mod-php php-curl     # if PHP is not installed yet
    cd /var/www/html/<this folder>                            # e.g. the support.llct.ae folder
    sudo mkdir -p files && sudo chown -R www-data:www-data files && sudo chmod 775 files
    sudo systemctl restart apache2

Check: open `https://<this site>/files.php?a=ping` → `{"ok":true,…,"writable":true}`,
and `https://<this site>/files/` must answer **403 Forbidden** (the folder is never served directly).
If `/files/` is not 403, Apache ignores .htaccess here: add `AllowOverride All` for this folder in the site config.

Up to 25 MB per file (`.user.ini` / `.htaccess` raise PHP's upload limit; with php-fpm restart it after the first copy).
Access is checked against Firestore with the caller's own rights (the client's link, or the staff member's sign-in),
so the Firestore rules decide who can open what. Optional `config.php`:
`<?php return ['apiKey' => '…', 'projectId' => '…'];` — otherwise read from the web app's config automatically.

### Documents password

The client's Documents tab asks for a sign-in (checked by files.php):
- **Master password** (Leaders Line): stored as a hash in `docpass.php` (not in Git — it is in the deployed zip).
  To change it: `php -r "echo password_hash('NEW-PASSWORD', PASSWORD_DEFAULT);"` and paste the result into docpass.php.
- **Client users**: per customer in `files/<Customer>/.users.json` (passwords hashed). Users marked "can add and remove users"
  manage the others; staff manage them from the desk (Customers → Documents → Client login for documents).
- **Password required** can be switched off per customer (desk, or a client user who manages users).
