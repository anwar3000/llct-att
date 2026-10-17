import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/db.dart';
import '../../services/location_service.dart';
import '../../widgets/common.dart';
import '../../widgets/map_widgets.dart';
import '../../widgets/month_view.dart';
import '../../widgets/petty_form.dart';
import '../../widgets/tiles.dart';
import 'admin_live.dart';
import 'approvals.dart';
import 'employee_form.dart';
import 'staff_status.dart';

class EmployeeDetailScreen extends StatefulWidget {
  final AppUser me;
  final String userId;
  final AdminLive live;
  final int initialTab;
  const EmployeeDetailScreen({
    super.key,
    required this.me,
    required this.userId,
    required this.live,
    this.initialTab = 0,
  });

  @override
  State<EmployeeDetailScreen> createState() => _EmployeeDetailScreenState();
}

class _EmployeeDetailScreenState extends State<EmployeeDetailScreen> {
  DateTime _month = startOfMonth(DateTime.now());

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.live,
      builder: (context, _) {
        final u = widget.live.userById(widget.userId);
        if (u == null) {
          return Scaffold(appBar: AppBar(), body: const Center(child: Text('Employee not found')));
        }
        final status = widget.live.statuses.where((s) => s.user.id == u.id).firstOrNull;
        final accounts = widget.me.isAdmin;
        return DefaultTabController(
          length: accounts ? 4 : 3,
          initialIndex: widget.initialTab.clamp(0, accounts ? 3 : 2),
          child: Scaffold(
            appBar: AppBar(
              title: Text(u.name),
              actions: [
                if (accounts)
                  IconButton(
                    tooltip: 'Edit profile',
                    icon: const Icon(Icons.edit_outlined),
                    onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => EmployeeFormScreen(existing: u))),
                  ),
              ],
              bottom: TabBar(
                isScrollable: true,
                tabAlignment: TabAlignment.start,
                indicatorColor: AppColors.accentDark,
                tabs: [
                  const Tab(text: 'Attendance'),
                  const Tab(text: 'Route & location'),
                  if (accounts) const Tab(text: 'Petty cash'),
                  const Tab(text: 'Site updates'),
                ],
              ),
            ),
            body: Column(children: [
              _header(u, status),
              Expanded(
                child: TabBarView(children: [
                  ListView(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
                    children: [
                      MonthSwitcher(month: _month, onChanged: (m) => setState(() => _month = m)),
                      const SizedBox(height: 12),
                      MonthAttendanceView(
                        key: ValueKey('${u.id}-${monthKey(_month)}'),
                        user: u,
                        month: _month,
                        onSessionTap: (s) => showSessionSheet(context, s, widget.live),
                      ),
                    ],
                  ),
                  _RouteView(user: u, live: widget.live),
                  if (accounts) _PettyView(me: widget.me, user: u),
                  _UpdatesView(user: u),
                ]),
              ),
            ]),
          ),
        );
      },
    );
  }

  Widget _header(AppUser u, StaffStatus? s) {
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Row(children: [
        Avatar(u.name, size: 52, ring: s?.color),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(
              [if (u.designation.isNotEmpty) u.designation, 'ID ${u.loginId}'].join(' · '),
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            if (u.phone.isNotEmpty)
              Text(u.phone, style: const TextStyle(color: AppColors.muted)),
            Text('Off: ${u.offDayLabel}',
                style: const TextStyle(color: AppColors.muted, fontSize: 12.5)),
          ]),
        ),
        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          if (!u.active)
            const Pill('Deactivated', color: AppColors.danger)
          else if (s != null)
            s.pill,
          if (s != null && s.worked > Duration.zero) ...[
            const SizedBox(height: 4),
            Text('Today ${fmtDuration(s.worked)}',
                style: const TextStyle(fontWeight: FontWeight.w800)),
          ],
        ]),
      ]),
    );
  }
}

// ---------------------------------------------------------------------------
// Session details (manager)
// ---------------------------------------------------------------------------

void showSessionSheet(BuildContext context, AttendanceSession s, AdminLive live) {
  final site = live.siteById(s.siteId);
  final pts = <LatLng>[
    if (s.inLat != null) LatLng(s.inLat!, s.inLng!),
    if (s.outLat != null) LatLng(s.outLat!, s.outLng!),
  ];
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (c) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.75,
      maxChildSize: 0.95,
      builder: (c, scroll) => ListView(
        controller: scroll,
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        children: [
          Text('${s.siteName} · ${fmtDate(s.checkIn)}',
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
          const SizedBox(height: 10),
          if (pts.isNotEmpty)
            ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: SizedBox(
                height: 220,
                child: FlutterMap(
                  options: MapOptions(initialCenter: pts.first, initialZoom: 16),
                  children: [
                    osmTiles(),
                    if (site != null) CircleLayer(circles: [siteCircle(site)]),
                    MarkerLayer(markers: [
                      if (s.inLat != null)
                        Marker(
                          point: LatLng(s.inLat!, s.inLng!),
                          width: 36,
                          height: 36,
                          alignment: Alignment.topCenter,
                          child: const Icon(Icons.location_on, color: AppColors.success, size: 36),
                        ),
                      if (s.outLat != null)
                        Marker(
                          point: LatLng(s.outLat!, s.outLng!),
                          width: 36,
                          height: 36,
                          alignment: Alignment.topCenter,
                          child: const Icon(Icons.location_on, color: AppColors.danger, size: 36),
                        ),
                    ]),
                    osmAttribution(),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 12),
          InfoRow(Icons.login, 'Check-in', '${fmtDateTime(s.inLocal)} ${tzLabel(s.tz)}', color: AppColors.success),
          InfoRow(Icons.social_distance_outlined, 'Distance',
              '${fmtDistance(s.inDistance)} from site · ±${(s.inAccuracy ?? 0).round()} m GPS'),
          if (s.inLat != null)
            InfoRow(Icons.pin_drop_outlined, 'Coordinates', latLngLabel(s.inLat!, s.inLng!)),
          const Divider(),
          InfoRow(Icons.logout, 'Check-out', s.isOpen ? 'Still checked in' : fmtDateTime(s.outLocal),
              color: AppColors.danger),
          if (!s.isOpen) ...[
            InfoRow(Icons.social_distance_outlined, 'Distance', '${fmtDistance(s.outDistance)} from site'),
            if (s.outLat != null)
              InfoRow(Icons.pin_drop_outlined, 'Coordinates', latLngLabel(s.outLat!, s.outLng!)),
          ],
          const Divider(),
          InfoRow(Icons.timer_outlined, 'Duration', fmtDuration(s.worked())),
          if (s.note.isNotEmpty) InfoRow(Icons.notes, 'Note', s.note),
          if (s.flagged) ...[
            const SizedBox(height: 8),
            Wrap(spacing: 6, children: [
              if (s.inOutside) const Pill('Checked in outside site', color: AppColors.warning),
              if (s.outOutside) const Pill('Checked out outside site', color: AppColors.warning),
              if (s.mocked) const Pill('Mock / fake GPS detected', color: AppColors.danger),
            ]),
          ],
          const SizedBox(height: 18),
          Row(children: [
            if (s.isOpen)
              Expanded(
                child: FilledButton.icon(
                  onPressed: () async {
                    final t = await showTimePicker(
                        context: c, initialTime: TimeOfDay.fromDateTime(DateTime.now()));
                    if (t == null) return;
                    final d = s.checkIn;
                    var at = DateTime(d.year, d.month, d.day, t.hour, t.minute);
                    if (!at.isAfter(d)) at = at.add(const Duration(days: 1));
                    await Db.adminCloseSession(s, at);
                    if (c.mounted) Navigator.pop(c);
                  },
                  icon: const Icon(Icons.logout),
                  label: const Text('Close session'),
                ),
              ),
            if (s.isOpen && live.canSeeAccounts) const SizedBox(width: 10),
            if (live.canSeeAccounts)
            Expanded(
              child: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(foregroundColor: AppColors.danger),
                onPressed: () async {
                  if (await confirm(c, 'Delete record?',
                      'Permanently delete this attendance record?', danger: true, ok: 'Delete')) {
                    await Db.deleteSession(s.id);
                    if (c.mounted) Navigator.pop(c);
                  }
                },
                icon: const Icon(Icons.delete_outline),
                label: const Text('Delete'),
              ),
            ),
          ]),
        ],
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Route & live location
// ---------------------------------------------------------------------------

class _RouteView extends StatefulWidget {
  final AppUser user;
  final AdminLive live;
  const _RouteView({required this.user, required this.live});

  @override
  State<_RouteView> createState() => _RouteViewState();
}

class _RouteViewState extends State<_RouteView> with AutomaticKeepAliveClientMixin {
  DateTime _day = DateTime.now();
  late Stream<List<TrackPoint>> _track;
  late Stream<List<AttendanceSession>> _sessions;
  MapController _map = MapController();

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    final k = dateKey(_day);
    _track = Db.trackForDay(widget.user.id, k);
    _sessions = Db.sessionsForEmployeeDay(widget.user.id, k);
    _map = MapController(); // fresh controller for the re-keyed map
  }

  void _shift(int days) {
    final n = _day.add(Duration(days: days));
    if (n.isAfter(DateTime.now())) return;
    setState(() {
      _day = n;
      _load();
    });
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final isToday = dateKey(_day) == dateKey(DateTime.now());
    final loc = widget.user.lastLocation;
    return StreamView<List<AttendanceSession>>(
      stream: _sessions,
      builder: (context, sessions) => StreamView<List<TrackPoint>>(
        stream: _track,
        builder: (context, track) {
          final line = track.map((p) => LatLng(p.lat, p.lng)).toList();
          double km = 0;
          for (var i = 1; i < line.length; i++) {
            km += LocationService.distance(
                line[i - 1].latitude, line[i - 1].longitude, line[i].latitude, line[i].longitude);
          }
          final sitesUsed = sessions
              .map((s) => widget.live.siteById(s.siteId))
              .whereType<Site>()
              .toSet()
              .toList();
          final all = <LatLng>[
            ...line,
            ...sessions.where((s) => s.inLat != null).map((s) => LatLng(s.inLat!, s.inLng!)),
            if (isToday && loc != null) LatLng(loc.lat, loc.lng),
          ];
          final center = all.isNotEmpty ? all.last : kDefaultCenter;

          return Column(children: [
            Container(
              color: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Row(children: [
                IconButton(onPressed: () => _shift(-1), icon: const Icon(Icons.chevron_left)),
                Expanded(
                  child: Text(isToday ? 'Today · ${fmtDateShort(_day)}' : fmtDate(_day),
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontWeight: FontWeight.w700)),
                ),
                IconButton(
                    onPressed: isToday ? null : () => _shift(1),
                    icon: const Icon(Icons.chevron_right)),
              ]),
            ),
            Expanded(
              child: Stack(children: [
                FlutterMap(
                  key: ValueKey(dateKey(_day)),
                  mapController: _map,
                  options: MapOptions(
                    initialCenter: center,
                    initialZoom: all.isEmpty ? 4 : 14,
                    onMapReady: () {
                      if (all.length > 1) {
                        _map.fitCamera(CameraFit.bounds(
                          bounds: LatLngBounds.fromPoints(all),
                          padding: const EdgeInsets.all(48),
                          maxZoom: 17,
                        ));
                      }
                    },
                  ),
                  children: [
                    osmTiles(),
                    CircleLayer(circles: sitesUsed.map(siteCircle).toList()),
                    if (line.length > 1)
                      PolylineLayer(polylines: [
                        Polyline(points: line, strokeWidth: 4, color: AppColors.info),
                      ]),
                    MarkerLayer(markers: [
                      ...sitesUsed.map((s) => siteMarker(s)),
                      for (final s in sessions) ...[
                        if (s.inLat != null)
                          Marker(
                            point: LatLng(s.inLat!, s.inLng!),
                            width: 30,
                            height: 30,
                            alignment: Alignment.topCenter,
                            child: const Icon(Icons.login, color: AppColors.success, size: 26),
                          ),
                        if (s.outLat != null)
                          Marker(
                            point: LatLng(s.outLat!, s.outLng!),
                            width: 30,
                            height: 30,
                            alignment: Alignment.topCenter,
                            child: const Icon(Icons.logout, color: AppColors.danger, size: 26),
                          ),
                      ],
                      if (isToday && loc != null) employeeMarker(widget.user, loc),
                    ]),
                    osmAttribution(),
                  ],
                ),
                Positioned(
                  left: 10,
                  right: 10,
                  bottom: 10,
                  child: Card(
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        Row(children: [
                          _metric('Worked', fmtDuration(totalWorked(sessions))),
                          _metric('Sites', '${sessions.map((s) => s.siteId).toSet().length}'),
                          _metric('Travelled', fmtDistance(km)),
                          _metric('GPS points', '${track.length}'),
                        ]),
                        if (isToday) ...[
                          const SizedBox(height: 6),
                          Text(lastSeenLabel(loc),
                              style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                        ],
                      ]),
                    ),
                  ),
                ),
              ]),
            ),
          ]);
        },
      ),
    );
  }

  Widget _metric(String l, String v) => Expanded(
        child: Column(children: [
          Text(v, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          Text(l, style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
        ]),
      );
}

// ---------------------------------------------------------------------------
// Petty cash for one employee
// ---------------------------------------------------------------------------

class _PettyView extends StatefulWidget {
  final AppUser me;
  final AppUser user;
  const _PettyView({required this.me, required this.user});

  @override
  State<_PettyView> createState() => _PettyViewState();
}

class _PettyViewState extends State<_PettyView> with AutomaticKeepAliveClientMixin {
  late final Stream<List<PettyTxn>> _stream = Db.pettyForEmployee(widget.user.id);

  @override
  bool get wantKeepAlive => true;

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return StreamView<List<PettyTxn>>(
      stream: _stream,
      builder: (context, txns) => ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [
          PettyBalanceCard(PettySummary.of(txns), title: '${widget.user.name} · balance'),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(
              child: FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: AppColors.success),
                onPressed: () => showPettyForm(context,
                    me: widget.me, employee: widget.user, type: 'credit', asManager: true),
                icon: const Icon(Icons.payments_outlined),
                label: const Text('Give cash'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () => showPettyForm(context,
                    me: widget.me, employee: widget.user, type: 'expense', asManager: true),
                icon: const Icon(Icons.receipt_long_outlined),
                label: const Text('Add expense'),
              ),
            ),
          ]),
          const SizedBox(height: 8),
          if (txns.isEmpty)
            const Card(
                child: EmptyState(
                    icon: Icons.account_balance_wallet_outlined, title: 'No transactions yet'))
          else
            ...txns.map((t) => Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: t.isPending
                      ? PettyApproval(t, me: widget.me)
                      : PettyTile(
                          t,
                          onTap: () async {
                            if (await confirm(context, 'Delete entry?',
                                'Delete this ${t.isCredit ? 'cash' : 'expense'} entry of ${fmtMoney(t.amount)}? This changes the balance.',
                                danger: true, ok: 'Delete')) {
                              await Db.deletePetty(t.id);
                            }
                          },
                        ),
                )),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Site updates by one employee
// ---------------------------------------------------------------------------

class _UpdatesView extends StatefulWidget {
  final AppUser user;
  const _UpdatesView({required this.user});

  @override
  State<_UpdatesView> createState() => _UpdatesViewState();
}

class _UpdatesViewState extends State<_UpdatesView> with AutomaticKeepAliveClientMixin {
  DateTime _month = startOfMonth(DateTime.now());
  late Stream<List<SiteUpdate>> _stream = Db.updatesForEmployeeMonth(widget.user.id, monthKey(_month));

  @override
  bool get wantKeepAlive => true;

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      children: [
        MonthSwitcher(
          month: _month,
          onChanged: (m) => setState(() {
            _month = m;
            _stream = Db.updatesForEmployeeMonth(widget.user.id, monthKey(m));
          }),
        ),
        const SizedBox(height: 10),
        StreamView<List<SiteUpdate>>(
          stream: _stream,
          builder: (context, list) => list.isEmpty
              ? const Card(
                  child: EmptyState(icon: Icons.construction_outlined, title: 'No updates this month'))
              : Column(
                  children: list
                      .map((u) => Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: UpdateCard(u, showName: false),
                          ))
                      .toList(),
                ),
        ),
      ],
    );
  }
}
