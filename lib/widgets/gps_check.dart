import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart' as ph;

import '../core/theme.dart';

/// One phone setting that affects GPS distance, with a way to fix it.
class GpsItem {
  final String title, why;
  final bool ok;
  final Future<void> Function()? fix;
  const GpsItem(this.title, this.why, this.ok, this.fix);
}

/// Checks the phone settings that matter for accurate trip km and live location.
class GpsCheck {
  static Future<List<GpsItem>> run() async {
    final out = <GpsItem>[];
    final on = await Geolocator.isLocationServiceEnabled();
    out.add(GpsItem('Location (GPS) is ON', 'Without it no distance is recorded.', on, Geolocator.openLocationSettings));

    final perm = await Geolocator.checkPermission();
    final granted = perm == LocationPermission.whileInUse || perm == LocationPermission.always;
    out.add(GpsItem('Location permission allowed', 'Choose “Allow while using the app” (or “Allow all the time”).', granted, () async {
      final p = await Geolocator.requestPermission();
      if (p == LocationPermission.deniedForever || p == LocationPermission.denied) await Geolocator.openAppSettings();
    }));

    var precise = true;
    if (on && granted) {
      try {
        precise = await Geolocator.getLocationAccuracy() == LocationAccuracyStatus.precise;
      } catch (_) {}
    }
    out.add(GpsItem('Precise location ON', 'Approximate location is off by up to 3 km — distance becomes wrong.', precise,
        Geolocator.openAppSettings));

    var notif = true;
    try {
      notif = await ph.Permission.notification.isGranted;
    } catch (_) {}
    out.add(GpsItem('Notifications allowed', 'The “Trip in progress” notification keeps GPS running when the screen is off.', notif, () async {
      final s = await ph.Permission.notification.request();
      if (!s.isGranted) await ph.openAppSettings();
    }));

    var battery = true;
    try {
      battery = await ph.Permission.ignoreBatteryOptimizations.isGranted;
    } catch (_) {}
    out.add(GpsItem('Battery: Unrestricted', 'Battery saver stops GPS in the background and the trip loses km.', battery, () async {
      final s = await ph.Permission.ignoreBatteryOptimizations.request();
      if (!s.isGranted) await ph.openAppSettings();
    }));
    return out;
  }
}

/// Red banner when something needs fixing (hidden when all is fine). Tap → the full check.
class GpsCheckBanner extends StatefulWidget {
  const GpsCheckBanner({super.key});
  @override
  State<GpsCheckBanner> createState() => _GpsCheckBannerState();
}

class _GpsCheckBannerState extends State<GpsCheckBanner> with WidgetsBindingObserver {
  int _bad = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _refresh() async {
    try {
      final l = await GpsCheck.run();
      if (mounted) setState(() => _bad = l.where((x) => !x.ok).length);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    if (_bad == 0) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: const Color(0xFFFBE6E6),
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: () async {
            await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const GpsCheckScreen()));
            _refresh();
          },
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(children: [
              const Icon(Icons.gps_off, color: AppColors.danger),
              const SizedBox(width: 10),
              Expanded(
                child: Text('$_bad phone setting${_bad == 1 ? '' : 's'} can make trip km wrong — tap to fix',
                    style: const TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF8F2A2A))),
              ),
              const Icon(Icons.chevron_right, color: Color(0xFF8F2A2A)),
            ]),
          ),
        ),
      ),
    );
  }
}

/// Full checklist: what the app can check (with Fix buttons) and the phone-specific tips it can't.
class GpsCheckScreen extends StatefulWidget {
  const GpsCheckScreen({super.key});
  @override
  State<GpsCheckScreen> createState() => _GpsCheckScreenState();
}

class _GpsCheckScreenState extends State<GpsCheckScreen> with WidgetsBindingObserver {
  List<GpsItem>? _items;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.resumed) _load();
  }

  Future<void> _load() async {
    final l = await GpsCheck.run();
    if (mounted) setState(() => _items = l);
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    const tips = [
      ('Google Location Accuracy ON', 'Settings → Location → Location services → Google Location Accuracy.'),
      ('Don’t swipe the app away during a trip', 'Pressing Home is fine; closing it from recent apps can stop GPS on some phones.'),
      ('Samsung: Never sleeping apps', 'Settings → Battery → Background usage limits → Never sleeping apps → add LLCT Attendance.'),
      ('Xiaomi / Redmi / Oppo / Vivo: Autostart ON', 'App info → Autostart (or Auto-launch) ON, and Battery saver → No restrictions.'),
      ('Start when you start driving, stop at arrival', 'Start the trip before moving off and stop it only after you park.'),
      ('Phone on the dashboard / window side', 'GPS needs a view of the sky; deep pockets and metal boxes reduce accuracy.'),
      ('Mobile data ON', 'Distance is still measured offline, but data keeps the live map and saving up to date.'),
    ];
    return Scaffold(
      appBar: AppBar(title: const Text('GPS check for accurate km')),
      body: items == null
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
                Card(
                  child: Column(children: [
                    for (final i in items)
                      ListTile(
                        leading: Icon(i.ok ? Icons.check_circle : Icons.error, color: i.ok ? AppColors.success : AppColors.danger),
                        title: Text(i.title, style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text(i.why),
                        trailing: i.ok || i.fix == null
                            ? null
                            : FilledButton(
                                style: FilledButton.styleFrom(minimumSize: const Size(64, 38)),
                                onPressed: () async {
                                  await i.fix!();
                                  await _load();
                                },
                                child: const Text('FIX'),
                              ),
                      ),
                  ]),
                ),
                const SizedBox(height: 14),
                const Text('Also check on the phone', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                const SizedBox(height: 6),
                Card(
                  child: Column(children: [
                    for (final t in tips)
                      ListTile(
                        leading: const Icon(Icons.tips_and_updates_outlined, color: AppColors.accentDark),
                        title: Text(t.$1, style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text(t.$2),
                      ),
                  ]),
                ),
                const SizedBox(height: 8),
                OutlinedButton.icon(onPressed: ph.openAppSettings, icon: const Icon(Icons.settings), label: const Text('Open app settings')),
              ]),
            ),
    );
  }
}
