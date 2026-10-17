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
      if (s.user.lastLocation == null) return false;
      if (_onDutyOnly) return s.state == StaffState.onDuty;
      return true;
    }).toList();
  }

  List<LatLng> _allPoints(List<StaffStatus> staff) => [
        ...staff.map((s) => LatLng(s.user.lastLocation!.lat, s.user.lastLocation!.lng)),
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

  void _focus(StaffStatus s) {
    final l = s.user.lastLocation!;
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
            InfoRow(Icons.gps_fixed, 'Last GPS', lastSeenLabel(l)),
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
              MarkerLayer(
                markers: staff
                    .map((s) => employeeMarker(s.user, s.user.lastLocation!,
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
                        final l = s.user.lastLocation!;
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
