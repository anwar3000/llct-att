import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/db.dart';
import '../../widgets/common.dart';
import '../../widgets/map_widgets.dart';
import '../../widgets/trip_card.dart' show kDialogButton;
import 'admin_live.dart';

const _purple = Color(0xFF7B4FC9);

/// Management: every driver trip and staff ride with details — by period and type,
/// expense by site and by person, and (admin) driver accounts & payments.
class TripsTab extends StatefulWidget {
  final AppUser me;
  final AdminLive live;
  const TripsTab({super.key, required this.me, required this.live});

  @override
  State<TripsTab> createState() => _TripsTabState();
}

class _TripsTabState extends State<TripsTab> {
  String _period = 'month';
  String _kind = '';
  String _view = 'list';
  StreamSubscription? _sub;
  List<Trip> _trips = [];
  bool _loading = true;
  Object? _error;

  bool get _money => widget.me.isAdmin;

  @override
  void initState() {
    super.initState();
    _load();
  }

  ({String from, String to}) _range() {
    final n = DateTime.now();
    switch (_period) {
      case 'today':
        return (from: dateKey(n), to: dateKey(n));
      case 'yday':
        final y = n.subtract(const Duration(days: 1));
        return (from: dateKey(y), to: dateKey(y));
      case '7':
        return (from: dateKey(n.subtract(const Duration(days: 6))), to: dateKey(n));
      case 'last':
        final f = DateTime(n.year, n.month - 1, 1), t = DateTime(n.year, n.month, 0);
        return (from: dateKey(f), to: dateKey(t));
      default:
        return (from: dateKey(DateTime(n.year, n.month, 1)), to: dateKey(n));
    }
  }

  void _load() {
    _sub?.cancel();
    setState(() {
      _loading = true;
      _error = null;
    });
    final r = _range();
    _sub = Db.tripsInRange(r.from, r.to).listen((l) {
      if (mounted) setState(() {
        _trips = l;
        _loading = false;
      });
    }, onError: (e) {
      if (mounted) setState(() {
        _error = e;
        _loading = false;
      });
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  /// Driver trip: km × driver's rate. Company-driver ride: km × that driver's rate. Taxi: the fare.
  double _costOf(Trip t) {
    if (t.cost != null) return t.cost!;
    if (t.isTaxi) return 0;
    final u = widget.live.userById(t.isWithDriver ? t.driverId : t.employeeId);
    return t.km * (t.ratePerKm ?? u?.tripRatePerKm ?? 0);
  }

  /// "Company driver: Basheer · DXB 1234" / "Taxi: DXB T 12345" / "Driver trip · DXB 777".
  String _who(Trip t) => t.isWithDriver
      ? 'Company driver: ${t.driverName.isEmpty ? '—' : t.driverName}${t.vehicle.isEmpty ? '' : ' · ${t.vehicle}'}'
      : t.isTaxi
          ? (t.vehicle.isEmpty || t.vehicle == 'Taxi' ? 'Taxi' : t.vehicle)
          : 'Driver trip${t.vehicle.isEmpty ? '' : ' · ${t.vehicle}'}';

  @override
  Widget build(BuildContext context) {
    final list = _trips.where((t) => _kind.isEmpty || t.kind == _kind).toList();
    final km = list.fold<double>(0, (a, t) => a + t.km);
    final cost = list.fold<double>(0, (a, t) => a + _costOf(t));
    final taxi = list.where((t) => t.isTaxi).fold<double>(0, (a, t) => a + _costOf(t));
    final drv = list.where((t) => !t.isRide).fold<double>(0, (a, t) => a + _costOf(t));

    Widget chip(String label, bool on, VoidCallback tap) => Padding(
          padding: const EdgeInsets.only(right: 6),
          child: ChoiceChip(label: Text(label), selected: on, onSelected: (_) => tap()),
        );

    final header = <Widget>[
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: [
          for (final p in const [('today', 'Today'), ('yday', 'Yesterday'), ('7', '7 days'), ('month', 'This month'), ('last', 'Last month')])
            chip(p.$2, _period == p.$1, () {
              _period = p.$1;
              _load();
            }),
        ]),
      ),
      const SizedBox(height: 6),
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: [
          for (final k in const [('', 'All types'), ('driver', 'Driver trips'), ('taxi', 'Taxi'), ('withDriver', 'With driver')])
            chip(k.$2, _kind == k.$1, () => setState(() => _kind = k.$1)),
        ]),
      ),
      const SizedBox(height: 10),
      StatGrid(children: [
        StatTile(label: 'Trips & rides', value: '${list.length}', icon: Icons.route, color: _purple,
            sub: '${list.where((t) => !t.isRide).length} driver · ${list.where((t) => t.isTaxi).length} taxi · ${list.where((t) => t.isWithDriver).length} with driver'),
        StatTile(label: 'Distance', value: '${km.toStringAsFixed(1)} km', icon: Icons.straighten, color: AppColors.success,
            sub: list.isEmpty ? '—' : 'avg ${(km / list.length).toStringAsFixed(1)} km'),
        if (_money)
          StatTile(label: 'Cost', value: fmtMoney((cost * 100).round() / 100), icon: Icons.payments_outlined, color: AppColors.accentDark,
              sub: 'drivers ${fmtMoney((drv * 100).round() / 100)} · taxi ${fmtMoney((taxi * 100).round() / 100)}'),
        StatTile(label: 'In progress', value: '${widget.live.activeTrips.length}', icon: Icons.local_shipping_outlined,
            color: AppColors.info, sub: 'driving now'),
      ]),
      const SizedBox(height: 10),
      SegmentedButton<String>(
        style: const ButtonStyle(visualDensity: VisualDensity.compact),
        segments: [
          const ButtonSegment(value: 'list', label: Text('Trips'), icon: Icon(Icons.list_alt)),
          const ButtonSegment(value: 'site', label: Text('By site'), icon: Icon(Icons.location_city_outlined)),
          const ButtonSegment(value: 'person', label: Text('By person'), icon: Icon(Icons.person_outline)),
          if (_money) const ButtonSegment(value: 'acct', label: Text('Accounts'), icon: Icon(Icons.account_balance_wallet_outlined)),
        ],
        selected: {_view},
        onSelectionChanged: (v) => setState(() => _view = v.first),
      ),
      const SizedBox(height: 10),
    ];

    List<Widget> body;
    if (_error != null) {
      body = [Card(child: Padding(padding: const EdgeInsets.all(16), child: Text('Could not load trips: $_error', style: const TextStyle(color: AppColors.danger))))];
    } else if (_loading) {
      body = [const Padding(padding: EdgeInsets.all(30), child: Center(child: CircularProgressIndicator()))];
    } else if (_view == 'acct') {
      body = [_Accounts(me: widget.me, live: widget.live)];
    } else if (list.isEmpty) {
      body = [const Card(child: EmptyState(icon: Icons.route_outlined, title: 'No trips or rides in this period'))];
    } else if (_view == 'site') {
      body = [_groupCard(list, (t) => t.siteId.isNotEmpty ? t.siteId : (t.isActive ? t.startSiteId : ''),
          (t) => t.siteName.isNotEmpty ? t.siteName : (t.isActive && t.startSiteName.isNotEmpty ? t.startSiteName : 'Not at a site'), Icons.location_city)];
    } else if (_view == 'person') {
      body = [_groupCard(list, (t) => t.employeeId, (t) => t.employeeName, Icons.person)];
    } else {
      body = [for (final t in list) _tripTile(t)];
    }

    return LayoutBuilder(builder: (context, c) {
      final pad = c.maxWidth >= 700 ? 24.0 : 16.0;
      return RefreshIndicator(
        onRefresh: () async => _load(),
        child: ListView(padding: EdgeInsets.fromLTRB(pad, 6, pad, 32), children: [...header, ...body]),
      );
    });
  }

  Widget _kindPill(Trip t) => Pill(t.isTaxi ? 'Taxi' : (t.isWithDriver ? 'With driver' : 'Driver'),
      color: t.isTaxi ? AppColors.accentDark : (t.isWithDriver ? AppColors.info : _purple));

  Widget _tripTile(Trip t) {
    final cost = _costOf(t);
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => _details(t),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Avatar(t.employeeName, size: 34, ring: t.isActive ? AppColors.success : _purple),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(t.employeeName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800)),
                  Row(children: [
                    Icon(t.isTaxi ? Icons.local_taxi : (t.isWithDriver ? Icons.directions_car : Icons.local_shipping), size: 14, color: _purple),
                    const SizedBox(width: 4),
                    Flexible(
                      child: Text(_who(t), maxLines: 1, overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: _purple)),
                    ),
                  ]),
                  Text('${fmtDateShort(t.startLocal)} · ${fmtTime(t.startLocal)}–${t.isActive ? 'now' : fmtTime(t.endLocal)} · ${fmtDuration(t.duration)}',
                      style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                ]),
              ),
              _kindPill(t),
            ]),
            const SizedBox(height: 8),
            Row(children: [
              const Icon(Icons.trip_origin, size: 14, color: AppColors.success),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  '${t.startSiteName.isEmpty ? 'GPS location' : t.startSiteName}  →  ${t.isActive ? 'driving…' : (t.endSiteName.isEmpty ? 'GPS location' : t.endSiteName)}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13),
                ),
              ),
            ]),
            const SizedBox(height: 6),
            Row(children: [
              Expanded(
                child: Text(
                  [
                    if (t.siteName.isNotEmpty) 'Charged to ${t.siteName}',

                    if (t.purpose.isNotEmpty) t.purpose,
                  ].join(' · '),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ),
              Text('${t.km.toStringAsFixed(1)} km', style: const TextStyle(fontWeight: FontWeight.w800)),
              if (_money) ...[
                const SizedBox(width: 10),
                Text(fmtMoney((cost * 100).round() / 100), style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.accentDark)),
              ],
            ]),
            if (t.costEntered)
              const Padding(
                padding: EdgeInsets.only(top: 4),
                child: Text('Cost entered by driver', style: TextStyle(fontSize: 11.5, color: AppColors.warning)),
              ),
          ]),
        ),
      ),
    );
  }

  Widget _groupCard(List<Trip> list, String Function(Trip) key, String Function(Trip) name, IconData icon) {
    final m = <String, ({String name, int n, double km, double cost})>{};
    for (final t in list) {
      final k = key(t);
      final p = m[k];
      m[k] = (name: p?.name ?? name(t), n: (p?.n ?? 0) + 1, km: (p?.km ?? 0) + t.km, cost: (p?.cost ?? 0) + _costOf(t));
    }
    final rows = m.values.toList()..sort((a, b) => b.cost == a.cost ? b.km.compareTo(a.km) : b.cost.compareTo(a.cost));
    return Card(
      child: Column(children: [
        for (var i = 0; i < rows.length; i++) ...[
          if (i > 0) const Divider(height: 1, indent: 56),
          ListTile(
            leading: CircleAvatar(backgroundColor: _purple.withValues(alpha: 0.1), child: Icon(icon, color: _purple, size: 20)),
            title: Text(rows[i].name, style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text('${rows[i].n} trip${rows[i].n == 1 ? '' : 's'} · ${rows[i].km.toStringAsFixed(1)} km'),
            trailing: _money
                ? Text(fmtMoney((rows[i].cost * 100).round() / 100), style: const TextStyle(fontWeight: FontWeight.w800))
                : null,
          ),
        ],
      ]),
    );
  }

  Future<void> _delete(Trip t) async {
    if (!await confirm(context, 'Delete trip',
        'Delete ${t.employeeName}\'s ${t.kindLabel.toLowerCase()} on ${fmtDateShort(t.startLocal)} (${t.km.toStringAsFixed(1)} km)? This cannot be undone.',
        ok: 'Delete', danger: true)) {
      return;
    }
    try {
      await Db.deleteTrip(t.id);
      if (mounted) showSnack(context, 'Trip deleted');
    } catch (e) {
      if (mounted) showSnack(context, 'Could not delete: $e', error: true);
    }
  }

  Future<void> _edit(Trip t) async {
    final kmC = TextEditingController(text: t.km.toStringAsFixed(2));
    final costC = TextEditingController(text: _costOf(t).toStringAsFixed(2));
    final purposeC = TextEditingController(text: t.purpose);
    final noteC = TextEditingController(text: t.note);
    final user = widget.live.userById(t.employeeId);
    final rate = t.ratePerKm ?? (t.isWithDriver ? widget.live.userById(t.driverId)?.tripRatePerKm : user?.tripRatePerKm);
    String siteId = t.siteId;
    final sites = widget.live.sites.where((x) => x.approved || x.id == t.siteId).toList();
    String? err;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, set) => AlertDialog(
          title: Text('Edit ${t.kindLabel.toLowerCase()}'),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text('${t.employeeName} · ${fmtDateShort(t.startLocal)}', style: const TextStyle(color: AppColors.muted)),
              const SizedBox(height: 10),
              TextField(
                controller: kmC,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Distance (km)', prefixIcon: Icon(Icons.straighten)),
              ),
              const SizedBox(height: 10),
              ...[
                TextField(
                  controller: costC,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(
                      labelText: t.isTaxi ? 'Taxi fare ($kCurrency)' : 'Cost ($kCurrency)',
                      prefixIcon: const Icon(Icons.payments_outlined),
                      errorText: err),
                ),
                if (!t.isTaxi && rate != null && rate > 0)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton(
                      onPressed: () {
                        final km = double.tryParse(kmC.text.trim()) ?? 0;
                        set(() => costC.text = (km * rate).toStringAsFixed(2));
                      },
                      child: Text('Use km × ${fmtMoney(rate)}/km'),
                    ),
                  ),
                const SizedBox(height: 6),
              ],
              DropdownButtonFormField<String>(
                value: sites.any((x) => x.id == siteId) ? siteId : '',
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Charge to site', prefixIcon: Icon(Icons.location_city_outlined)),
                items: [
                  const DropdownMenuItem(value: '', child: Text('— No site —')),
                  for (final x in sites) DropdownMenuItem(value: x.id, child: Text(x.name, overflow: TextOverflow.ellipsis)),
                ],
                onChanged: (v) => set(() => siteId = v ?? ''),
              ),
              const SizedBox(height: 10),
              TextField(controller: purposeC, decoration: const InputDecoration(labelText: 'Purpose')),
              const SizedBox(height: 10),
              TextField(controller: noteC, decoration: const InputDecoration(labelText: 'Note (reason for change)')),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
            FilledButton(
              style: kDialogButton,
              onPressed: () {
                final km = double.tryParse(kmC.text.trim());
                final cost = double.tryParse(costC.text.trim());
                if (km == null || km < 0 || cost == null || cost < 0) {
                  set(() => err = 'Enter valid numbers');
                  return;
                }
                Navigator.pop(c, true);
              },
              child: const Text('SAVE'),
            ),
          ],
        ),
      ),
    );
    if (ok != true) return;
    try {
      await Db.adminEditTrip(
        trip: t,
        km: double.parse(kmC.text.trim()),
        cost: double.parse(costC.text.trim()),
        site: widget.live.siteById(siteId),
        purpose: purposeC.text.trim(),
        note: noteC.text.trim(),
        by: widget.me,
      );
      if (mounted) showSnack(context, 'Trip updated');
    } catch (e) {
      if (mounted) showSnack(context, 'Could not save: $e', error: true);
    }
  }

  void _details(Trip t) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (c) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.85,
        maxChildSize: 0.95,
        builder: (c, scroll) => ListView(controller: scroll, padding: const EdgeInsets.fromLTRB(16, 0, 16, 24), children: [
          Row(children: [
            Expanded(child: Text(t.employeeName, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800))),
            _kindPill(t),
          ]),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: SizedBox(height: 260, child: _RouteMap(t)),
          ),
          if (!t.isActive && t.pointsCount <= 2)
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text('Very few GPS points: the ride was very short, or the phone’s location was off during the ride.',
                  style: TextStyle(fontSize: 12, color: AppColors.warning)),
            ),
          const SizedBox(height: 10),
          InfoRow(Icons.event, 'Date', '${fmtDate(t.startLocal)} ${tzLabel(t.tz)}'),
          InfoRow(Icons.schedule, 'Time', '${fmtTime(t.startLocal)} – ${t.isActive ? 'in progress' : fmtTime(t.endLocal)} (${fmtDuration(t.duration)})'),
          InfoRow(Icons.trip_origin, 'Pick-up', t.startSiteName.isEmpty ? 'GPS location' : t.startSiteName),
          InfoRow(Icons.flag_outlined, 'Drop-off', t.isActive ? '—' : (t.endSiteName.isEmpty ? 'GPS location' : t.endSiteName)),
          InfoRow(Icons.location_city_outlined, 'Charged to', t.siteName.isEmpty ? '—' : t.siteName),
          InfoRow(Icons.straighten, 'Distance', '${t.km.toStringAsFixed(2)} km (${t.pointsCount} GPS points)'),
          if (t.isWithDriver) InfoRow(Icons.person_pin, 'Company driver', '${t.driverName}${t.vehicle.isEmpty ? '' : ' · ${t.vehicle}'}'),
          if (t.isTaxi) InfoRow(Icons.local_taxi, 'Taxi', t.vehicle.isEmpty || t.vehicle == 'Taxi' ? 'Not entered' : t.vehicle),
          if (!t.isRide && t.vehicle.isNotEmpty) InfoRow(Icons.directions_car_outlined, 'Vehicle', t.vehicle),
          if (t.purpose.isNotEmpty) InfoRow(Icons.notes, 'Purpose', t.purpose),
          if (_money) ...[
            if (!t.isTaxi && t.ratePerKm != null) InfoRow(Icons.speed, 'Rate', '${fmtMoney(t.ratePerKm!)} / km'),
            InfoRow(Icons.payments_outlined, 'Cost',
                '${fmtMoney((_costOf(t) * 100).round() / 100)}${t.costEntered ? ' (entered by driver)' : (t.isActive ? ' (estimate)' : '')}'),
          ],
          if (t.note.isNotEmpty) InfoRow(Icons.sticky_note_2_outlined, 'Note', t.note),
          if (t.editedBy.isNotEmpty) InfoRow(Icons.edit_note, 'Edited by', t.editedBy),
          const SizedBox(height: 14),
          if (t.isActive)
            OutlinedButton.icon(
              onPressed: () async {
                Navigator.pop(c);
                if (!await confirm(context, 'End trip', 'End ${t.employeeName}\'s trip now at the last GPS point (${t.km.toStringAsFixed(1)} km)?', ok: 'End trip')) return;
                try {
                  await Db.adminEndTrip(t, widget.me, widget.live.userById(t.employeeId)?.tripRatePerKm ?? await Db.tripRate(widget.live.userById(t.employeeId) ?? widget.me));
                  if (mounted) showSnack(context, 'Trip ended');
                } catch (e) {
                  if (mounted) showSnack(context, 'Could not end: $e', error: true);
                }
              },
              icon: const Icon(Icons.stop_circle_outlined),
              label: const Text('End this trip now'),
            ),
          if (widget.me.isAdmin) ...[
            const SizedBox(height: 8),
            Row(children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: () {
                    Navigator.pop(c);
                    _edit(t);
                  },
                  icon: const Icon(Icons.edit_outlined),
                  label: const Text('Edit'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(foregroundColor: AppColors.danger, side: const BorderSide(color: AppColors.danger)),
                  onPressed: () {
                    Navigator.pop(c);
                    _delete(t);
                  },
                  icon: const Icon(Icons.delete_outline),
                  label: const Text('Delete'),
                ),
              ),
            ]),
          ],
        ]),
      ),
    );
  }
}

class _RouteMap extends StatefulWidget {
  final Trip t;
  const _RouteMap(this.t);
  @override
  State<_RouteMap> createState() => _RouteMapState();
}

class _RouteMapState extends State<_RouteMap> {
  List<LatLng>? _pts;

  @override
  void initState() {
    super.initState();
    Db.tripPoints(widget.t.id).then((l) {
      if (mounted) setState(() => _pts = l.map((p) => LatLng(p.lat, p.lng)).toList());
    }).catchError((_) {
      if (mounted) setState(() => _pts = []);
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.t;
    final pts = [...?_pts];
    // Always show pick-up, and drop-off (or where the ride is now), even with few GPS points.
    final start = t.startLat != null ? LatLng(t.startLat!, t.startLng!) : null;
    if (start != null && (pts.isEmpty || Distance()(pts.first, start) > 5)) pts.insert(0, start);
    final end = t.endLat != null && t.endLng != null
        ? LatLng(t.endLat!, t.endLng!)
        : (t.isActive && t.lastLat != null && t.lastLng != null ? LatLng(t.lastLat!, t.lastLng!) : null);
    if (end != null && (pts.isEmpty || Distance()(pts.last, end) > 5)) pts.add(end);
    if (_pts == null) return const Center(child: CircularProgressIndicator());
    if (pts.isEmpty) return const Center(child: Text('No GPS points'));
    return FlutterMap(
      options: MapOptions(
        initialCameraFit: pts.length > 1
            ? CameraFit.bounds(bounds: LatLngBounds.fromPoints(pts), padding: const EdgeInsets.all(30), maxZoom: 16)
            : null,
        initialCenter: pts.first,
        initialZoom: 15,
      ),
      children: [
        osmTiles(),
        if (pts.length > 1) PolylineLayer(polylines: [Polyline(points: pts, strokeWidth: 5, color: _purple)]),
        MarkerLayer(markers: [
          // Pick-up and drop-off at the same spot (very short ride) → one combined pin, so neither hides the other.
          if (pts.length == 1 || Distance()(pts.first, pts.last) < 30)
            Marker(point: pts.first, width: 150, height: 46, alignment: Alignment.topCenter,
                child: _pin(t.isActive ? 'Pick-up · now' : 'Pick-up & drop-off', AppColors.success))
          else
            Marker(point: pts.first, width: 90, height: 46, alignment: Alignment.topCenter, child: _pin('Pick-up', AppColors.success)),
          if (pts.length > 1 && Distance()(pts.first, pts.last) >= 30)
            Marker(point: pts.last, width: 90, height: 46, alignment: Alignment.topCenter,
                child: _pin(t.isActive ? 'Now' : 'Drop-off', t.isActive ? _purple : AppColors.danger)),
        ]),
        osmAttribution(),
      ],
    );
  }

  Widget _pin(String label, Color c) => Column(mainAxisSize: MainAxisSize.min, children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(6)),
          child: Text(label, style: const TextStyle(color: Colors.white, fontSize: 10.5, fontWeight: FontWeight.w800)),
        ),
        Container(
          width: 16,
          height: 16,
          decoration: BoxDecoration(color: c, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 3),
              boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 3)]),
        ),
      ]);
}

/// Admin: per driver — earned (finished trip costs) − paid = balance; record payments.
class _Accounts extends StatefulWidget {
  final AppUser me;
  final AdminLive live;
  const _Accounts({required this.me, required this.live});
  @override
  State<_Accounts> createState() => _AccountsState();
}

class _AccountsState extends State<_Accounts> {
  List<Trip> _done = [];
  List<DriverPayment> _pays = [];
  final List<StreamSubscription> _subs = [];
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _subs.add(Db.doneTripsAll().listen((l) {
      if (mounted) setState(() {
        _done = l.where((t) => !t.isTaxi).toList();
        _loaded = true;
      });
    }, onError: (_) {
      if (mounted) setState(() => _loaded = true);
    }));
    _subs.add(Db.allDriverPayments().listen((l) {
      if (mounted) setState(() => _pays = l);
    }, onError: (_) {}));
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    super.dispose();
  }

  Future<void> _pay(AppUser d, double balance) async {
    final amt = TextEditingController(text: balance > 0 ? balance.toStringAsFixed(2) : '');
    final note = TextEditingController();
    String method = 'Cash';
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, set) => AlertDialog(
          title: Text('Payment to ${d.name}'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            Text('Balance due: ${fmtMoney(balance)}', style: const TextStyle(color: AppColors.muted)),
            const SizedBox(height: 10),
            TextField(controller: amt, keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Amount ($kCurrency)')),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              value: method,
              decoration: const InputDecoration(labelText: 'Method'),
              items: const ['Cash', 'Bank transfer', 'Cheque', 'Other'].map((m) => DropdownMenuItem(value: m, child: Text(m))).toList(),
              onChanged: (v) => set(() => method = v ?? 'Cash'),
            ),
            const SizedBox(height: 10),
            TextField(controller: note, decoration: const InputDecoration(labelText: 'Note / reference')),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
            FilledButton(style: kDialogButton, onPressed: () => Navigator.pop(c, true), child: const Text('SAVE')),
          ],
        ),
      ),
    );
    if (ok != true) return;
    final v = double.tryParse(amt.text.trim());
    if (v == null || v <= 0) {
      if (mounted) showSnack(context, 'Enter the amount', error: true);
      return;
    }
    try {
      await Db.addDriverPayment(driver: d, amount: v, date: dateKey(DateTime.now()), method: method, note: note.text.trim(), by: widget.me);
      if (mounted) showSnack(context, 'Payment saved — it shows in ${d.name}\'s app');
    } catch (e) {
      if (mounted) showSnack(context, 'Could not save: $e', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_loaded) return const Padding(padding: EdgeInsets.all(30), child: Center(child: CircularProgressIndicator()));
    final drivers = widget.live.users.where((u) => u.isDriver).toList();
    if (drivers.isEmpty) return const Card(child: EmptyState(icon: Icons.no_crash_outlined, title: 'No drivers yet'));
    final rows = drivers.map((u) {
      // Driver's own trips + staff rides with this driver (costed at the driver's rate).
      final tr = _done.where((t) => (!t.isRide && t.employeeId == u.id) || (t.isWithDriver && t.driverId == u.id)).toList();
      final pays = _pays.where((p) => p.employeeId == u.id).toList();
      final earned = tr.fold<double>(0, (a, t) => a + (t.cost ?? 0));
      final paid = pays.fold<double>(0, (a, p) => a + p.amount);
      return (u: u, trips: tr.length, earned: earned, paid: paid, bal: ((earned - paid) * 100).round() / 100, pays: pays);
    }).toList()
      ..sort((a, b) => b.bal.compareTo(a.bal));
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      for (final r in rows)
        Card(
          margin: const EdgeInsets.only(bottom: 8),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Avatar(r.u.name, size: 34, ring: _purple),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(r.u.name, style: const TextStyle(fontWeight: FontWeight.w800)),
                    Text('${r.trips} trips${r.u.vehicle.isEmpty ? '' : ' · ${r.u.vehicle}'}', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                  ]),
                ),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(minimumSize: const Size(0, 38)),
                  onPressed: () => _pay(r.u, r.bal),
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Payment'),
                ),
              ]),
              const SizedBox(height: 10),
              Row(children: [
                _box('Earned', fmtMoney((r.earned * 100).round() / 100), AppColors.primary),
                const SizedBox(width: 6),
                _box('Paid', fmtMoney((r.paid * 100).round() / 100), AppColors.success),
                const SizedBox(width: 6),
                _box(r.bal >= 0 ? 'Balance' : 'Overpaid', fmtMoney(r.bal.abs()), r.bal > 0 ? AppColors.warning : AppColors.success),
              ]),
              for (final p in r.pays.take(3))
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Row(children: [
                    const Icon(Icons.check_circle, size: 15, color: AppColors.success),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text('${p.date} · ${p.method}${p.note.isEmpty ? '' : ' · ${p.note}'}',
                          maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5)),
                    ),
                    Text(fmtMoney(p.amount), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                  ]),
                ),
            ]),
          ),
        ),
      const Padding(
        padding: EdgeInsets.all(8),
        child: Text('Full statements (Excel / PDF): web dashboard → Trips & rides → Driver accounts.',
            style: TextStyle(fontSize: 12, color: AppColors.muted)),
      ),
    ]);
  }

  Widget _box(String l, String v, Color c) => Expanded(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          decoration: BoxDecoration(color: c.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(l, style: const TextStyle(fontSize: 11, color: AppColors.muted)),
            FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(v, style: TextStyle(fontWeight: FontWeight.w800, color: c))),
          ]),
        ),
      );
}
