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

/// Driver trips (purple, so they stand apart from staff blue and external orange).
const kTripColor = Color(0xFF7B4FC9);

class LiveMapTab extends StatefulWidget {
  final AppUser me;
  final AdminLive live;
  /// Small map inside another screen (big-screen overview): no filters, roster or side panel.
  final bool embedded;
  const LiveMapTab({super.key, required this.me, required this.live, this.embedded = false});

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

  /// Drivers on a trip, at the trip's latest GPS point.
  List<Marker> _tripMarkers() => [
        for (final t in widget.live.activeTrips)
          if ((t.lastLat ?? t.startLat) != null)
            Marker(
              point: LatLng(t.lastLat ?? t.startLat!, t.lastLng ?? t.startLng!),
              width: 90,
              height: 50,
              child: GestureDetector(
                onTap: () => _showTrip(t),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Container(
                    width: 30,
                    height: 30,
                    decoration: BoxDecoration(
                      color: kTripColor,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 3),
                      boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 4)],
                    ),
                    child: const Icon(Icons.local_shipping, color: Colors.white, size: 15),
                  ),
                  Container(
                    margin: const EdgeInsets.only(top: 1),
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(4)),
                    child: Text('${t.employeeName.split(' ').first} ${t.km.toStringAsFixed(1)}km',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 9.5, color: kTripColor, fontWeight: FontWeight.w800)),
                  ),
                ]),
              ),
            ),
      ];

  void _showTrip(Trip t) {
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (_) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const CircleAvatar(backgroundColor: kTripColor, child: Icon(Icons.local_shipping, color: Colors.white)),
              title: Text(t.employeeName, style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text('${t.kindLabel}${t.vehicle.isEmpty ? '' : ' · ${t.vehicle}'}${t.purpose.isEmpty ? '' : ' · ${t.purpose}'}'),
            ),
            InfoRow(Icons.trip_origin, 'From', t.startSiteName.isEmpty ? 'GPS location' : t.startSiteName),
            InfoRow(Icons.schedule, 'Started', '${fmtTime(t.startLocal)} · ${fmtDuration(t.duration)} ago'),
            InfoRow(Icons.route, 'Distance so far', '${t.km.toStringAsFixed(2)} km'),
          ]),
        ),
      ),
    );
  }

  void _focusPoint(LatLng p) {
    if (_ready) _map.move(p, 16);
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

        final map = FlutterMap(
          mapController: _map,
          options: MapOptions(
            initialCenter: pts.isNotEmpty ? pts.first : kDefaultCenter,
            initialZoom: pts.isNotEmpty ? 12 : 4,
            // The small map on the Overview is a preview: no dragging, so the page scrolls normally.
            interactionOptions: InteractionOptions(
                flags: widget.embedded ? InteractiveFlag.none : InteractiveFlag.all & ~InteractiveFlag.rotate),
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
                  .map((s) => employeeMarker(s.user, _locOf(s)!, onTap: () => _showStaff(s)))
                  .toList(),
            ),
            MarkerLayer(markers: _tripMarkers()),
            osmAttribution(),
          ],
        );

        final filters = Positioned(
          top: 10,
          left: 10,
          right: 10,
          child: Row(children: [
            if (!widget.embedded) ...[
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
            ] else
              _legend(onDuty.length, widget.live.externalOnSite.length, widget.live.activeTrips.length),
            const Spacer(),
            FloatingActionButton.small(
              heroTag: widget.embedded ? 'fit-embedded' : 'fit',
              backgroundColor: Colors.white,
              onPressed: () => _fit(pts),
              child: const Icon(Icons.fit_screen_outlined, color: AppColors.primary),
            ),
          ]),
        );

        return LayoutBuilder(builder: (context, c) {
          final wide = !widget.embedded && c.maxWidth >= 700;
          if (widget.embedded) return Stack(children: [map, filters]);
          if (wide) {
            return Row(children: [
              Expanded(child: Stack(children: [map, filters])),
              const VerticalDivider(width: 1),
              SizedBox(width: c.maxWidth >= 1100 ? 380 : 320, child: _sidePanel(onDuty)),
            ]);
          }
          return Stack(children: [map, filters, _roster(staff, onDuty)]);
        });
      },
    );
  }

  Widget _legend(int staff, int ext, int trips) => Material(
        color: Colors.white,
        elevation: 2,
        borderRadius: BorderRadius.circular(20),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            _dot(AppColors.info), Text(' $staff staff  ', style: _lg),
            _dot(kExtColor), Text(' $ext external', style: _lg),
            if (trips > 0) ...[_dot(kTripColor), Text('  $trips driving', style: _lg)],
          ]),
        ),
      );
  static const _lg = TextStyle(fontSize: 12, fontWeight: FontWeight.w700);
  Widget _dot(Color c) => Container(width: 9, height: 9, decoration: BoxDecoration(color: c, shape: BoxShape.circle));

  /// Big screens (tablet / unfolded Fold): live list beside the map.
  Widget _sidePanel(List<StaffStatus> onDuty) {
    final live = widget.live;
    final ext = live.externalOnSite;
    final trips = live.activeTrips;
    final orphans = ext.where((e) => !onDuty.any((s) => s.open?.id == e.sessionId)).toList();
    return Container(
      color: Colors.white,
      child: ListView(padding: const EdgeInsets.only(bottom: 20), children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
          child: Row(children: [
            const Text('Live now', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
            const Spacer(),
            Pill('${onDuty.length + ext.length} on site', color: AppColors.success),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Text('${onDuty.length} staff · ${ext.length} external · ${trips.length} driving · updated ${fmtTime(DateTime.now())}',
              style: const TextStyle(fontSize: 12, color: AppColors.muted)),
        ),
        if (trips.isNotEmpty) ...[
          _panelHead('DRIVING NOW', kTripColor),
          for (final t in trips)
            ListTile(
              dense: true,
              leading: const CircleAvatar(radius: 17, backgroundColor: kTripColor, child: Icon(Icons.local_shipping, color: Colors.white, size: 17)),
              title: Text(t.employeeName, style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text('${t.kindLabel} · ${t.startSiteName.isEmpty ? 'GPS' : t.startSiteName} → … · ${fmtDuration(t.duration)}',
                  maxLines: 1, overflow: TextOverflow.ellipsis),
              trailing: Text('${t.km.toStringAsFixed(1)} km', style: const TextStyle(fontWeight: FontWeight.w800)),
              onTap: () {
                final lat = t.lastLat ?? t.startLat, lng = t.lastLng ?? t.startLng;
                if (lat != null && lng != null) _focusPoint(LatLng(lat, lng));
                _showTrip(t);
              },
            ),
        ],
        _panelHead('ON DUTY', AppColors.info),
        if (onDuty.isEmpty && orphans.isEmpty)
          const Padding(
            padding: EdgeInsets.all(16),
            child: Text('Nobody is on duty right now.', style: TextStyle(color: AppColors.muted)),
          ),
        for (final s in onDuty) ...[
          ListTile(
            dense: true,
            leading: Avatar(s.user.name, size: 34, ring: _locOf(s)!.isFresh ? AppColors.success : AppColors.warning),
            title: Text(s.user.name, style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text('${s.open?.siteName ?? ''} · ${fmtDuration(s.worked)}',
                maxLines: 1, overflow: TextOverflow.ellipsis),
            trailing: Text(s.user.lastLocation == null ? 'No GPS' : timeAgo(s.user.lastLocation!.at),
                style: TextStyle(
                    fontSize: 11.5,
                    color: s.user.lastLocation == null || !_locOf(s)!.isFresh ? AppColors.warning : AppColors.success)),
            onTap: () => _focus(s),
          ),
          for (final e in ext.where((e) => e.sessionId == s.open?.id))
            Padding(
              padding: const EdgeInsets.only(left: 28),
              child: ListTile(
                dense: true,
                visualDensity: VisualDensity.compact,
                leading: Avatar(e.workerName, size: 26, ring: kExtColor),
                title: Text(e.workerName, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                subtitle: Text('External · since ${fmtTime(e.inLocal)} · ${fmtDuration(e.worked())}',
                    style: const TextStyle(fontSize: 11.5)),
              ),
            ),
        ],
        for (final e in orphans)
          ListTile(
            dense: true,
            leading: Avatar(e.workerName, size: 30, ring: kExtColor),
            title: Text(e.workerName, style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: Text('External · ${e.siteName} · with ${e.employeeName}', maxLines: 1, overflow: TextOverflow.ellipsis),
            trailing: Text(fmtDuration(e.worked()), style: const TextStyle(fontWeight: FontWeight.w700)),
          ),
      ]),
    );
  }

  Widget _panelHead(String t, Color c) => Container(
        margin: const EdgeInsets.only(top: 8),
        padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
        color: c.withValues(alpha: 0.07),
        child: Text(t, style: TextStyle(color: c, fontSize: 11.5, fontWeight: FontWeight.w800, letterSpacing: 0.6)),
      );

  Widget _roster(List<StaffStatus> staff, List<StaffStatus> onDuty) => Positioned(
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
                              Avatar(s.user.name, size: 40, ring: l.isFresh ? AppColors.success : AppColors.warning),
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
                                        maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12)),
                                    Text('${fmtDuration(s.worked)} · ${timeAgo(l.at)}',
                                        style: TextStyle(
                                            fontSize: 11.5, color: l.isFresh ? AppColors.success : AppColors.warning)),
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
      );

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
