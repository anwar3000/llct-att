import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../widgets/common.dart';
import '../../widgets/map_widgets.dart';
import 'admin_live.dart';
import 'employee_detail_screen.dart';
import 'staff_status.dart';
import '../../widgets/site_workforce.dart' show kExtColor;

class LiveMapTab extends StatefulWidget {
  final AppUser me;
  final AdminLive live;
  const LiveMapTab({super.key, required this.me, required this.live});

  @override
  State<LiveMapTab> createState() => _LiveMapTabState();
}

class _LiveMapTabState extends State<LiveMapTab> {
  final _map = MapController();
  bool _ready = false;
  bool _onDutyOnly = false;
  bool _showSites = true;
  bool _fitted = false;

  List<StaffStatus> _visible() {
    return widget.live.statuses.where((s) {
      if (_locOf(s) == null) return false;
      if (_onDutyOnly) return s.state == StaffState.onDuty;
      return true;
    }).toList();
  }

  /// Phone GPS, or — if on duty but no GPS has arrived yet — the site they checked in at.
  LiveLocation? _locOf(StaffStatus s) {
    final l = s.user.lastLocation;
    if (l != null) return l;
    if (s.open == null) return null;
    final site = widget.live.siteById(s.open!.siteId);
    if (site == null) return null;
    return LiveLocation(lat: site.lat, lng: site.lng, checkedIn: true, siteName: site.name);
  }

  List<LatLng> _allPoints(List<StaffStatus> staff) => [
        ...staff.map((s) => LatLng(_locOf(s)!.lat, _locOf(s)!.lng)),
        if (_showSites)
          ...widget.live.sites.where((s) => s.active).map((s) => LatLng(s.lat, s.lng)),
      ];

  void _fit(List<LatLng> pts) {
    if (!_ready || pts.isEmpty) return;
    if (pts.length == 1) {
      _map.move(pts.first, 15);
      return;
    }
    _map.fitCamera(CameraFit.bounds(
      bounds: LatLngBounds.fromPoints(pts),
      padding: const EdgeInsets.fromLTRB(50, 80, 50, 170),
      maxZoom: 16,
    ));
  }

  /// External workers have no phone of their own — show them around the employee who checked them in
  /// (or at the site if that employee has no GPS yet).
  List<Marker> _workerMarkers() {
    final bySession = <String, StaffStatus>{
      for (final s in widget.live.statuses)
        if (s.open != null && _locOf(s) != null) s.open!.id: s,
    };
    final groups = <String, List<WorkerEntry>>{};
    for (final e in widget.live.externalOnSite) {
      groups.putIfAbsent(e.sessionId, () => []).add(e);
    }
    final out = <Marker>[];
    groups.forEach((sid, list) {
      final emp = bySession[sid];
      LatLng? base;
      if (emp != null) {
        base = LatLng(_locOf(emp)!.lat, _locOf(emp)!.lng);
      } else {
        final site = widget.live.siteById(list.first.siteId);
        if (site != null) base = LatLng(site.lat, site.lng);
      }
      if (base == null) return;
      for (var i = 0; i < list.length; i++) {
        final a = 2 * math.pi * i / list.length - math.pi / 2;
        final r = 0.00017 * (1 + (i ~/ 8) * 0.6);
        final p = LatLng(base.latitude + r * math.sin(a),
            base.longitude + r * math.cos(a) / math.cos(base.latitude * math.pi / 180));
        final e = list[i];
        out.add(Marker(
          point: p,
          width: 70,
          height: 44,
          child: GestureDetector(
            onTap: () => showModalBottomSheet(
              context: context,
              showDragHandle: true,
              builder: (_) => SafeArea(
                child: ListTile(
                  leading: Avatar(e.workerName, ring: kExtColor),
                  title: Text(e.workerName, style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text('External worker · ${e.siteName}\nWith ${e.employeeName} · since ${fmtTime(e.inLocal)}\n'
                      'Location = ${emp != null ? "${e.employeeName}'s phone" : 'site (no GPS from employee yet)'}'),
                  isThreeLine: true,
                ),
              ),
            ),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Container(
                width: 24,
                height: 24,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: kExtColor,
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white, width: 2),
                  boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 3)],
                ),
                child: Text(initials(e.workerName),
                    style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.w800)),
              ),
              Container(
                margin: const EdgeInsets.only(top: 1),
                padding: const EdgeInsets.symmetric(horizontal: 4),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(4)),
                child: Text(e.workerName.split(' ').first,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 9.5, color: kExtColor, fontWeight: FontWeight.w700)),
              ),
            ]),
          ),
        ));
      }
    });
    return out;
  }

  void _focus(StaffStatus s) {
    final l = _locOf(s)!;
    if (_ready) _map.move(LatLng(l.lat, l.lng), 16);
    _showStaff(s);
  }

  void _showStaff(StaffStatus s) {
    final l = s.user.lastLocation;
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Row(children: [
              Avatar(s.user.name, size: 48, ring: s.color),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(s.user.name,
                      style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                  if (s.user.phone.isNotEmpty)
                    Text(s.user.phone, style: const TextStyle(color: AppColors.muted)),
                ]),
              ),
              s.pill,
            ]),
            const SizedBox(height: 12),
            if (s.open != null) ...[
              InfoRow(Icons.location_city_outlined, 'Site', s.open!.siteName),
              InfoRow(Icons.login, 'Checked in', '${fmtDateTime(s.open!.inLocal)} ${tzLabel(s.open!.tz)}'),
            ],
            InfoRow(Icons.timer_outlined, 'Today', fmtDuration(s.worked)),
            InfoRow(Icons.gps_fixed, 'Last GPS',
                l == null ? 'No GPS from phone yet — shown at the site. Check location permission / battery.' : lastSeenLabel(l)),
            if (l != null) InfoRow(Icons.pin_drop_outlined, 'Coordinates', latLngLabel(l.lat, l.lng)),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: () {
                Navigator.pop(c);
                Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => EmployeeDetailScreen(
                      me: widget.me, userId: s.user.id, live: widget.live, initialTab: 1),
                ));
              },
              icon: const Icon(Icons.route_outlined),
              label: const Text("View today's route & details"),
            ),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.live,
      builder: (context, _) {
        final staff = _visible();
        final sites = widget.live.sites.where((s) => s.active).toList();
        final pts = _allPoints(staff);
        if (_ready && !_fitted && pts.isNotEmpty) {
          _fitted = true;
          WidgetsBinding.instance.addPostFrameCallback((_) => _fit(pts));
        }
        final onDuty = staff.where((s) => s.state == StaffState.onDuty).toList();

        return Stack(children: [
          FlutterMap(
            mapController: _map,
            options: MapOptions(
              initialCenter: pts.isNotEmpty ? pts.first : kDefaultCenter,
              initialZoom: pts.isNotEmpty ? 12 : 4,
              onMapReady: () {
                _ready = true;
                if (pts.isNotEmpty) {
                  _fitted = true;
                  _fit(pts);
                }
              },
            ),
            children: [
              osmTiles(),
              if (_showSites) CircleLayer(circles: sites.map(siteCircle).toList()),
              if (_showSites) MarkerLayer(markers: sites.map((s) => siteMarker(s)).toList()),
              MarkerLayer(markers: _workerMarkers()),
              MarkerLayer(
                markers: staff
                    .map((s) => employeeMarker(s.user, _locOf(s)!,
                        onTap: () => _showStaff(s)))
                    .toList(),
              ),
              osmAttribution(),
            ],
          ),

          // Filters
          Positioned(
            top: 10,
            left: 10,
            right: 10,
            child: Row(children: [
              _chip(
                _onDutyOnly ? 'On duty only' : 'All staff',
                _onDutyOnly,
                () => setState(() {
                  _onDutyOnly = !_onDutyOnly;
                  _fitted = false;
                }),
                Icons.people_alt_outlined,
              ),
              const SizedBox(width: 8),
              _chip('Sites', _showSites, () => setState(() => _showSites = !_showSites),
                  Icons.location_city_outlined),
              const Spacer(),
              FloatingActionButton.small(
                heroTag: 'fit',
                backgroundColor: Colors.white,
                onPressed: () => _fit(pts),
                child: const Icon(Icons.fit_screen_outlined, color: AppColors.primary),
              ),
            ]),
          ),

          // Bottom roster
          Positioned(
            left: 0,
            right: 0,
            bottom: 10,
            child: SizedBox(
              height: 92,
              child: onDuty.isEmpty
                  ? Center(
                      child: Card(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                          child: Text(
                            staff.isEmpty
                                ? 'No staff locations yet. Locations appear once staff check in.'
                                : 'Nobody is on duty right now.',
                            style: const TextStyle(color: AppColors.muted),
                          ),
                        ),
                      ),
                    )
                  : ListView.separated(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      itemCount: onDuty.length,
                      separatorBuilder: (_, __) => const SizedBox(width: 8),
                      itemBuilder: (c, i) {
                        final s = onDuty[i];
                        final l = _locOf(s)!;
                        return SizedBox(
                          width: 220,
                          child: Card(
                            clipBehavior: Clip.antiAlias,
                            child: InkWell(
                              onTap: () => _focus(s),
                              child: Padding(
                                padding: const EdgeInsets.all(10),
                                child: Row(children: [
                                  Avatar(s.user.name,
                                      size: 40,
                                      ring: l.isFresh ? AppColors.success : AppColors.warning),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      mainAxisAlignment: MainAxisAlignment.center,
                                      children: [
                                        Text(s.user.name,
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: const TextStyle(fontWeight: FontWeight.w700)),
                                        Text(s.open?.siteName ?? '',
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: const TextStyle(fontSize: 12)),
                                        Text(
                                            '${fmtDuration(s.worked)} · ${timeAgo(l.at)}',
                                            style: TextStyle(
                                                fontSize: 11.5,
                                                color: l.isFresh
                                                    ? AppColors.success
                                                    : AppColors.warning)),
                                      ],
                                    ),
                                  ),
                                ]),
                              ),
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ),
        ]);
      },
    );
  }

  Widget _chip(String label, bool on, VoidCallback onTap, IconData icon) => Material(
        color: on ? AppColors.primary : Colors.white,
        elevation: 2,
        borderRadius: BorderRadius.circular(20),
        child: InkWell(
          borderRadius: BorderRadius.circular(20),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Icon(icon, size: 16, color: on ? Colors.white : AppColors.ink),
              const SizedBox(width: 6),
              Text(label,
                  style: TextStyle(
                      color: on ? Colors.white : AppColors.ink, fontWeight: FontWeight.w600)),
            ]),
          ),
        ),
      );
}
