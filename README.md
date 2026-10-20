# LLCT Attendance

A Flutter + Firebase Android app for field staff attendance, with a management dashboard built into the same app. Staff and managers use one APK, and the role on each login decides which screens open.

## What's inside

### Staff app (4 tabs)
| Tab | What it does |
|---|---|
| **Today** | Big **CHECK IN / CHECK OUT** button. It records GPS coordinates, accuracy and distance from the site, plus the time. A live timer shows today's total work time. Sites are listed nearest-first and scheduled sites come first. Staff can check in at **several sites per day**. Today's schedule and today's check-ins are shown below the button. |
| **History** | A month switcher with total hours, days worked, average per day, off days and absences. It also shows a colour calendar and an expandable day-by-day log. The **off-day panel** shows how many of the 4 monthly off days are used and lets staff request an off day. |
| **Site Update** | Pick a site, choose a category (Progress / Issue / Material / Safety), write a note, set progress %, add up to 3 photos. GPS is attached when available. Lists this month's updates. |
| **Petty** | Balance card showing received, spent, pending and balance. Staff can **add an expense** (with a receipt photo) or **record cash received**. Both stay *Pending* until a manager approves them. The history can be filtered. |

### Management dashboard (5 tabs)
| Tab | What it does |
|---|---|
| **Overview** | KPIs: on duty now, present, work time today, active sites, pending approvals, flagged check-ins. Also shows a "Needs attention" list (forgotten check-outs, out-of-area or fake-GPS check-ins), approvals, team status, schedule coverage, site progress and the latest site updates. |
| **Live Map** | OpenStreetMap with every staff member's **live location** (green = live, amber = stale, grey = off duty) and site geofence circles. A roster of on-duty staff sits along the bottom; tap anyone to see details and their route. |
| **Team** | Search and filter staff by status, and add employees (creates their login). Each employee has a detail page with a monthly attendance calendar, **today's GPS route** on a map (with distance travelled), their petty-cash account and their site updates. |
| **Sites** | Sites: add or edit with a map picker or "use my current location", geofence radius, status and progress. Schedule: assign one or more sites to one or more employees, with an optional repeat for N days (weekly offs are skipped). Updates: a feed of site updates you can filter. |
| **Petty** | Totals, approvals, balance per employee and all transactions. **Give cash** records an advance to an employee. |

### Rules built in
- **Geofence:** each site has a radius (50–1000 m). Checking in outside it is allowed but **flagged**.
- **Fake GPS:** mock-location apps are detected and the check-in is flagged.
- **Live tracking:** this runs only while an employee is checked in. It uses an Android foreground service (an "On duty" notification), so it keeps working with the app in the background. A trail point is stored every 2 minutes or every 75 m of movement.
- **Off days:** each employee gets a monthly quota (default **4**). Set a weekly off day (Sunday, Friday or any day) or leave it **flexible** so staff request their own days for approval.
- **Forgotten check-outs** appear on the Overview, and a manager can close them with the correct time.
- **No paid Firebase services needed.** Photos are compressed and stored inside Firestore, so the free *Spark* plan is enough.

---

## What's new
- **Driver costs and payments (v1.5.2):** drivers can enter or change a trip's cost at any time: during the trip, when they stop (it starts at km × rate), or later by tapping the trip in their list. Admin sees these trips marked *entered*. On the web, admin records payments to drivers under **Trips & rides → Driver accounts & payments**. Each driver's account shows earned (trip costs) − paid = balance due, with a statement you can download (Excel/PDF). Drivers see the same tally and the payments they received in their app.
- **Rides and driver profile (v1.5.1):**
  - **Every employee** has a **Start ride** button under the check-in card. They choose **Taxi** or **Company driver** (picked from the list of drivers). When a taxi ride ends, they enter the fare. Employees don't see ride history.
  - **Driver (taxi) work profile:** choose it when adding a person (web: Employees → Work profile; app: Team → Add person). A driver's login opens a separate driver app with Start / Stop trip, their rate per km, and their trips and earnings for the month. It has no attendance check-in, and drivers are left out of attendance lists.
  - **Costs:** a driver trip costs km × rate. A taxi ride costs the fare entered. A ride with a company driver costs nothing on its own, because it is paid through the driver's trip, so nothing is counted twice.
  - **Dashboard:** the **Trips & rides** page shows all three types, with filters and the daily report.
- **Driver trips (v1.5.0):** tick *Driver* on an employee (web: Employees → Edit; app: Team → person → Edit). They get **Start trip / Stop trip** in the app. The phone records the GPS route and adds up the distance. Bad fixes, jitter and impossible jumps are ignored. Cost = km × rate. The rate is the driver's own rate, or the company rate set on the **Driver trips** page. Each trip is charged to the site where it ends; if it doesn't end at a site, it is charged to the site where it started. The dashboard has a **Driver trips** tab: trips running now (live), route map, admin corrections, and expense by site and by driver. Running trips also show on the live map. Each site page shows its transport cost, and project reports include transport. **Reports → Driver trips — daily report** gives an Excel/PDF/CSV with daily totals per driver, totals by site, and the full trip log. On iPhone, GPS runs only while the web app is open, so the screen is kept awake during a trip.
- **Big screens (Galaxy Fold, tablets):** when unfolded, the management app shows a side menu. The Overview gets a live map, an on-site list by site, and driver trips beside the dashboard. The Live map gets a live side panel. The Team tab shows the person's details beside the list. The staff home screen uses two columns.
- **Web dashboard** for managers (`web/` folder). It's published free on GitHub Pages and includes projects, live map, attendance, petty cash and downloadable reports in Excel, PDF and CSV.
- **Roles:** `admin` has full access. `manager` sees everything except accounts (petty cash and budgets) and can't create logins. `employee` uses the mobile app.
- **Strict geofence:** staff can only check in inside a site's radius, which you set per site. Fake-GPS check-ins are blocked.
- **New sites from the field:** if no site is near, an employee can add their current location as a new site. It shows as *Awaiting approval* until an admin or manager approves it.
- **Hourly location check:** while an employee is checked in, the phone records a GPS point at least every hour. It raises a **geofence alert** if they leave the site area without checking out, and management sees and resolves alerts on the dashboard.
- **Stay signed in:** staff stay logged in on their phone until they sign out.
- **LLCT branding:** logo, app icon and orange/charcoal colours.
- **External workers (labour):** management registers each worker on the web dashboard (**External workers → Register worker**) with their phone number, passport copy and Emirates ID. Workers don't punch in. Right after an employee checks in, the app opens a **workers page** where they tick who is with them, and they can add or remove workers later with the **Manage** button. A worker can be on only one check-in at a time, so they can't be counted twice. Their time ends when they're removed or when the employee checks out. Reports: **External workers attendance** (hours per worker plus a daily log) and **External workers register** (month grid).
- **Local time at each site:** the phone saves its time zone with every check-in, check-out, update, alert and expense. The dashboard and reports show the time at the site (for example 08:00 in Dubai, even if the manager is in India), with a *Time zone* column. Hours are calculated from the exact moments, so they're correct in any zone. Records made before v1.2 show in the viewer's time.
- **One workforce, staff plus external workers:** the dashboard counts both, in **blue** for staff and **orange** for external workers: on site now, workforce today, man-hours, and a stacked chart. Click a site to see everyone who worked there, with staff and external subtotals, a consolidated total, who is on site now, and man-hours per day. You can download it as Excel or PDF. New reports: **Workforce by site** and **Site workforce**. The project report includes external man-hours. The managers' app shows the same on each site screen.
- **iPhone / web app for staff:** `https://anwar3000.github.io/llct-att/app.html`. In Safari, tap **Share → Add to Home Screen**. It uses the same logins and data as the Android app and covers check-in/out with the GPS geofence, the external-workers popup and picker (including adding new workers), history and off-day requests, site updates with photos, petty cash expenses and *My ID documents*. iPhones only share location **while the app is open**: browsers can't run background tracking, so the hourly geofence check works only when the app is opened.
- **Documents Portal** (separate link: `https://anwar3000.github.io/llct-att/portal.html`): for **Document clerk** logins, which an admin creates under Employees → Add person → Role, and for managers. It lets them view and download everyone's IDs (ZIP, PDF pack or Excel), add new LLCT staff or external workers, and edit names, phone numbers, ID numbers, expiry dates and copies (max 2 MB each). **Nothing changes until an admin approves it** under **Change requests** on the dashboard. That page shows current and proposed values side by side, and creating the app login for a new staff member is part of approving them. Clerks follow each request's status under *My requests*.
- **Minimum working day & short days:** admins set the minimum hours per day (default **8 h**) at the top of **Reports**. Any finished day below it is marked **short**: red on employee calendars and external-worker pages, and marked with `*` or SHORT (red in PDFs) on attendance registers and reports, for staff and external workers alike.
- **External workers: days & pay:** each worker has a **daily rate (AED)**, set when you register or edit them. It's visible to admins only. The report **External workers — days & pay** covers any period, optionally for one company. It shows per worker: days worked, full days, short days, total hours and average per day, plus the daily rate, the amount (days × rate) and a pro-rata amount for short days. It includes an attendance sheet with short days marked.
- **Admin corrections (web dashboard):** admins can **edit the check-in and check-out times** of any record. Use the ✎ button on Attendance or on an employee's page. Times are entered in the site's local time, external workers on that check-in are adjusted too, and the record is marked *edited* with the reason and the original times kept. Admins can also **delete a whole working day** from the employee's page (select the day, then **Delete day**), and **delete a person** under **Employees → Edit → Delete person**, with or without their records. Petty cash is always kept.
- **Everyone on duty, staff and external:** a new **Working now** page shows everyone on site right now, grouped by site: staff in blue, each with the external workers they checked in (in orange) underneath, plus who has finished today. The **Live map** shows external workers too, placed around the employee who checked them in (their location comes from that employee's phone, or the site if there's no GPS yet). The Employees list, the dashboard, and the managers' app (Overview, Team and Live map) all include external workers.
- **Staff can add a missing worker:** in the worker list in the app, tap **New** and enter the name and phone. The worker is ticked straight away. On the dashboard they're marked *Added by …*, so management can complete their documents.
- **Employees update their own documents:** in the app, tap your profile picture and then **My ID documents** to add or change passport, Emirates ID, SIRA, visa and labour card numbers and expiry dates, and to upload copies as a photo or PDF. Each copy can be up to **2 MB**, in the app and on the dashboard. Management sees the changes straight away on the dashboard.
- **Edit or delete site updates:** the person who posted an update can edit or delete it (the ⋮ menu on the update), and so can admins and managers, in the app and on the web.
- **ID documents:** passport, Emirates ID, SIRA card, visa and labour card numbers, expiry dates and scanned copies for both staff and workers. **ID documents** lists everyone and flags expired or expiring IDs. To send IDs to a customer, select people and download a **ZIP** (a folder per person plus an Excel list), a **PDF ID pack**, or Excel only.

> **After every update, re-publish `firestore.rules`** in Firebase Console → Firestore → Rules. New collections (`projects`, `alerts`) and roles depend on it.

## Going back to a saved version (if an update breaks something)
Saved versions are kept as branches. The first one is **`stable-2026-10-17`**, which is the app before external workers and ID documents were added.

- **App:** go to **Actions → Build APK → Run workflow**, type `stable-2026-10-17` in **version** and run it. The APK appears under **Releases** as `LLCT-Attendance-stable-2026-10-17.apk` and is kept permanently. Install it over the current app.
- **Web dashboard:** go to **Actions → Deploy web dashboard → Run workflow**, type the same version and run it.
- **Back to the latest:** run both workflows again with **version** left blank.

Data is never deleted by going back. Older versions simply ignore the newer collections.

## Web dashboard setup (one time)
1. In the GitHub repo, go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Go to **Actions → Deploy web dashboard → Run workflow**. The site appears at `https://<your-github-user>.github.io/<repo>/`.
3. In Firebase, go to **Authentication → Settings → Authorized domains → Add domain** and add `<your-github-user>.github.io`.
4. If login says the API key is not valid for web, register a Web app in Firebase (Project settings → Add app → Web). Copy its `firebaseConfig` into a repo secret named `FIREBASE_WEB_CONFIG`, then re-run the deploy.

## Optional: Google Maps address search (web dashboard)
By default, site address search uses free OpenStreetMap data. To use **Google Maps with Google address suggestions** instead:
1. Go to <https://console.cloud.google.com>, pick the same project as Firebase, and open **APIs & Services → Library**. Enable **Maps JavaScript API** and **Places API (New)**. Google requires a billing account; normal use for a dashboard like this usually stays within the free monthly usage.
2. Go to **APIs & Services → Credentials → Create credentials → API key**. Under **Website restrictions**, add `https://llct.net/*` (or your dashboard domain).
3. In the GitHub repo, go to **Settings → Secrets and variables → Actions → New secret**. Name it `GOOGLE_MAPS_API_KEY` and paste the key.
4. Go to **Actions → Deploy web dashboard → Run workflow**.

In both modes you can also paste a Google Maps link (the long URL containing `@lat,lng`) or plain `lat, lng` into the search box.

## Fastest way to get the APK: build on GitHub (no Flutter install)
1. Do **Setup step 1** below (create the Firebase project, enable Email/Password, create Firestore, paste the rules).
2. In Firebase go to **Project settings → General → Add app → Android**. Package name: **`com.attendancepro.attendance_pro`**. Click *Register app*, then **download `google-services.json`**.
3. On <https://github.com>, create a **private** repository and upload everything in this folder, including the hidden `.github` folder.
4. In the repo, open **Settings → Secrets and variables → Actions → New repository secret**. Name: `GOOGLE_SERVICES_JSON`. Value: paste the whole contents of `google-services.json`.
5. Open **Actions → Build APK → Run workflow**. After about 10 minutes, open the finished run and download **AttendancePro-apk** under *Artifacts*. Unzip it to get `app-release.apk`.
6. Copy the APK to the phones and install it (allow "Install unknown apps"). Then do **Setup step 3** to create the first manager.

---

## Setup (about 20 minutes)

### 0. Install the tools
- [Flutter SDK](https://docs.flutter.dev/get-started/install) (stable channel) with Android Studio / Android SDK
- Node.js / firebase-tools are **not needed**: just put `google-services.json` in the project folder before running `setup.sh`

### 1. Create the Firebase project
1. Go to <https://console.firebase.google.com> and choose **Add project**. Google Analytics is optional.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable**.
3. **Build → Firestore Database → Create database** in production mode. Pick a location near you (e.g. `asia-south1` for India).
4. In **Firestore → Rules**, replace everything with the contents of [`firestore.rules`](firestore.rules) and click **Publish**.

### 2. Generate the project and connect Firebase
From this folder:

```bash
# macOS / Linux
bash setup.sh
```
```powershell
# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

The script:
1. runs `flutter create` to add the Android files (your `lib/` and `AndroidManifest.xml` are kept)
2. sets `minSdk` to 24
3. runs `flutter pub get`
4. runs `flutterfire configure`. Pick the project you created and Android. This writes `lib/firebase_options.dart` and `google-services.json`.

### 3. Create the first manager account
New accounts are normally created from inside the app, but the very first manager has to be created by hand:

1. **Authentication → Users → Add user**
   - Email: `admin@staff.attendance.app` (lets you log in with the ID **admin**)
   - Password: choose one
   - Copy the **User UID** that appears.
2. **Firestore → Start collection** → Collection ID `users` → Document ID = *paste the UID* → add these fields:

| Field | Type | Value |
|---|---|---|
| `name` | string | Your name |
| `loginId` | string | `admin` |
| `email` | string | `admin@staff.attendance.app` |
| `role` | string | `admin` |
| `active` | boolean | `true` |

### 4. Run it
```bash
flutter run                    # on a connected phone
flutter build apk --release    # APK in build/app/outputs/flutter-apk/app-release.apk
```
Sign in with **admin** and your password. Then:
1. **Sites → Add site.** Stand at the site and tap *Use my current location*, or tap the map.
2. **Team → Add employee.** Give them an ID such as `EMP001` and a password, and choose their weekly off day.
3. **Sites → Schedule → Assign site** (optional).
4. Install the same APK on the staff phones. They sign in with their ID and password.

---

## Tips for reliable GPS tracking
- On first check-in, staff must allow **Location → "While using the app"** (or "Allow all the time"). On Android 13+ also allow notifications so the *On duty* notice is visible.
- Some brands (Xiaomi, Oppo, Vivo, Realme, Samsung) kill background apps aggressively. On those phones set **Battery → App battery saver → Attendance Pro → No restrictions**, and on Xiaomi also turn on **Autostart**.
- Check-in uses the best available GPS fix with a 25-second timeout. Indoors, accuracy can be ±50 m or worse. The radius slider on each site handles this.

## Changing things
| Want to change… | Edit |
|---|---|
| Currency symbol (₹) | `kCurrency` in `lib/core/utils.dart` |
| Default monthly off days (4) | `kDefaultMonthlyOffQuota` in `lib/core/utils.dart` |
| Default geofence radius | `kDefaultSiteRadius` in `lib/core/utils.dart` |
| Brand colours | `AppColors` in `lib/core/theme.dart` |
| Tracking frequency | `_trackEvery`, `_trackMinMeters` and `AndroidSettings` in `lib/services/tracking_service.dart` |
| Expense categories | `expenseCategories` in `lib/widgets/petty_form.dart` |
| App name | `android:label` in `android/app/src/main/AndroidManifest.xml` |

## Project structure
```
lib/
  main.dart                     auth gate → staff app or dashboard
  core/        theme.dart, utils.dart
  models/      models.dart       users, sites, schedules, attendance, updates, petty, off days
  services/    db.dart           all Firestore reads/writes (no composite indexes needed)
               auth_service.dart sign-in, create staff logins without logging the manager out
               location_service.dart, tracking_service.dart, photo_service.dart
  widgets/     common.dart, tiles.dart, month_view.dart, petty_form.dart, map_widgets.dart
  screens/
    auth/      login_screen.dart
    employee/  employee_shell.dart, home_tab.dart, history_tab.dart, site_update_tab.dart, petty_tab.dart
    admin/     admin_shell.dart, admin_live.dart, overview_tab.dart, live_map_tab.dart, team_tab.dart,
               employee_detail_screen.dart, employee_form.dart, sites_tab.dart, site_editor.dart,
               petty_admin_tab.dart, approvals.dart, staff_status.dart
firestore.rules                 security rules (staff only see their own data)
```

## Firestore collections
`users` (+ `users/{uid}/track` GPS trail) · `sites` · `projects` · `schedules` · `attendance` · `siteUpdates` · `petty` · `offDays` · `alerts` ·
`extWorkers` (registered labour) · `workerLocks` (who has which worker right now) · `workerAttendance` (worker time per check-in) ·
`idInfo` (ID numbers and expiry dates) · `idFiles` (+ `chunks`: scanned copies, management only) ·
`trips` (+ `points`: driver trips with GPS route, distance and cost)

## Known limits
- **Password reset:** staff log in with IDs rather than real emails, so reset passwords in *Firebase Console → Authentication → (user) → Reset password*. You can also delete the user there and recreate them in the app.
- **Android only.** iOS would also need location keys added to `Info.plist` and `flutterfire configure --platforms=ios`.
- **Timestamps:** check-in times come from the phone clock. The server time is also stored (`checkInServer` / `checkOutServer`) for auditing.
- **Version conflicts:** if `flutter pub get` reports them on a much newer Flutter, run `flutter pub upgrade --major-versions`.
