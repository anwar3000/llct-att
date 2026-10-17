import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/db.dart';
import '../../services/location_service.dart';
import '../../services/tracking_service.dart';
import '../../widgets/common.dart';
import '../../widgets/tiles.dart';
import 'worker_picker_screen.dart';

class HomeTab extends StatefulWidget {
  final AppUser me;
  final AttendanceSession? open;
  final ValueChanged<int>? onNavigate;
  const HomeTab({super.key, required this.me, required this.open, this.onNavigate});

  @override
  State<HomeTab> createState() => _HomeTabState();
}

class _HomeTabState extends State<HomeTab> {
  String _today = dateKey(DateTime.now());
  final List<StreamSubscription> _subs = [];
  Timer? _dayWatcher;

  List<Schedule> _schedules = [];
  List<AttendanceSession> _sessions = [];
  List<Site> _sites = [];
  List<OffDay> _offDays = [];
  bool _loaded = false;
  bool _busy = false;
  int _workerCount = -1; // -1 = not loaded yet / could not load
  List<WorkerEntry> _sessionWorkers = [];
  StreamSubscription? _sessionWorkersSub;
  String? _sessionWorkersFor;
  String _busyText = '';

  @override
  void initState() {
    super.initState();
    _subscribe();
    _dayWatcher = Timer.periodic(const Duration(minutes: 1), (_) {
      final k = dateKey(DateTime.now());
      if (k != _today) {
        _today = k;
        _subscribe();
      }
    });
  }

  void _subscribe() {
    for (final s in _subs) {
      s.cancel();
    }
    _subs.clear();
    final uid = widget.me.id;
    _subs.add(Db.schedulesForEmployee(uid, _today).listen((l) {
      if (mounted) setState(() => _schedules = l);
    }));
    _subs.add(Db.sessionsForEmployeeDay(uid, _today).listen((l) {
      if (mounted) setState(() {
        _sessions = l;
        _loaded = true;
      });
    }));
    _subs.add(Db.sitesStream(activeOnly: true).listen((l) {
      if (mounted) setState(() => _sites = l);
    }));
    _subs.add(Db.offDaysForEmployeeMonth(uid, monthKey(DateTime.now())).listen((l) {
      if (mounted) setState(() => _offDays = l);
    }));
    _subs.add(Db.activeWorkersStream().listen((l) {
      if (mounted) setState(() => _workerCount = l.length);
    }, onError: (_) {}));
  }

  /// Keeps the "workers with you" list in sync with the open check-in.
  void _watchSessionWorkers() {
    final id = widget.open?.id;
    if (id == _sessionWorkersFor) return;
    _sessionWorkersFor = id;
    _sessionWorkersSub?.cancel();
    _sessionWorkers = [];
    if (id == null) return;
    _sessionWorkersSub = Db.workersForSession(id, widget.me.id).listen((l) {
      if (mounted) setState(() => _sessionWorkers = l);
    }, onError: (_) {});
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    _dayWatcher?.cancel();
    _sessionWorkersSub?.cancel();
    super.dispose();
  }

  bool get _isOffToday =>
      widget.me.isWeeklyOff(DateTime.now()) ||
      _offDays.any((o) => o.date == _today && o.status == 'approved');

  Duration get _closedToday =>
      totalWorked(_sessions.where((s) => !s.isOpen));

  Site? _siteById(String id) {
    for (final s in _sites) {
      if (s.id == id) return s;
    }
    return null;
  }

  // ------------------------------------------------------------ actions

  Future<Position?> _locate(String text) async {
    setState(() {
      _busy = true;
      _busyText = text;
    });
    try {
      return await LocationService.current();
    } on LocationException catch (e) {
      if (!mounted) return null;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.message),
        behavior: SnackBarBehavior.floating,
        action: e.openSettings
            ? SnackBarAction(label: 'Settings', onPressed: LocationService.openSettings)
            : null,
      ));
      return null;
    } catch (e) {
      if (mounted) showSnack(context, 'Location error: $e', error: true);
      return null;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _startCheckIn([Site? preselected]) async {
    if (widget.open != null) {
      showSnack(context, 'Check out from ${widget.open!.siteName} first.');
      return;
    }
    final pos = await _locate('Getting your GPS location…');
    if (pos == null || !mounted) return;

    // No site anywhere near (or none exist yet) → offer to create one here.
    if (pos.isMocked) {
      await _blocked('Fake GPS detected',
          'A mock-location app is active on this phone. Turn it off to check in.');
      return;
    }
    final tol = TrackingService.tolerance(pos.accuracy);
    final nearby = _visibleSites.any((s) =>
        LocationService.distance(pos.latitude, pos.longitude, s.lat, s.lng) <= s.radius + tol);
    Site? site = preselected;
    if (site == null) {
      site = (!nearby && _visibleSites.isEmpty)
          ? _newSiteMarker
          : await _pickSite(pos, offerNew: !nearby);
    }
    if (site == null || !mounted) return;
    if (identical(site, _newSiteMarker)) {
      site = await _createSiteHere(pos);
      if (site == null || !mounted) return;
    }

    final dist = LocationService.distance(pos.latitude, pos.longitude, site.lat, site.lng);
    // Strict geofence: check-in only inside the site's radius (set by management).
    if (dist > site.radius + tol) {
      await _blocked(
        'Outside the site area',
        'You are ${fmtDistance(dist)} from ${site.name}.\n'
            'Check-in is allowed only within ${site.radius.round()} m of the site.\n\n'
            'Move closer to the site and try again. (GPS accuracy now: ±${pos.accuracy.round()} m)',
      );
      return;
    }

    setState(() {
      _busy = true;
      _busyText = 'Checking in…';
    });
    final picked = site;
    String? sessionId;
    final start = DateTime.now();
    try {
      sessionId = await Db.checkIn(
        user: widget.me,
        site: site,
        lat: pos.latitude,
        lng: pos.longitude,
        accuracy: pos.accuracy,
        distance: dist,
        mocked: pos.isMocked,
        at: start,
      );
      await TrackingService.instance
          .pushOnce(widget.me.id, pos, checkedIn: true, siteName: site.name);
      if (mounted) showSnack(context, 'Checked in at ${site.name} · ${fmtTime(start)}');
    } catch (e) {
      if (mounted) showSnack(context, 'Check-in failed: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    // Next step: pick the external workers who are with you (skippable).
    final sid = sessionId;
    if (sid != null && mounted && _workerCount != 0 && await _askAboutWorkers(picked.name) && mounted) {
      await Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => WorkerPickerScreen(
          me: widget.me,
          sessionId: sid,
          siteId: picked.id,
          siteName: picked.name,
          sessionStart: start,
          afterCheckIn: true,
        ),
      ));
    }
  }

  /// "Any external workers with you?" — one tap for No, or Yes to pick names.
  Future<bool> _askAboutWorkers(String siteName) async {
    final yes = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (c) => AlertDialog(
        icon: Container(
          width: 56,
          height: 56,
          decoration: const BoxDecoration(color: AppColors.accentSoft, shape: BoxShape.circle),
          child: const Icon(Icons.engineering, color: AppColors.accentDark, size: 30),
        ),
        title: const Text('Any external workers with you?'),
        content: Text('Checked in at $siteName.\nSelect the labour working with you today, if any.',
            textAlign: TextAlign.center),
        actionsAlignment: MainAxisAlignment.center,
        actionsPadding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        actions: [
          Row(children: [
            Expanded(
              child: SizedBox(
                height: 54,
                child: OutlinedButton(
                  onPressed: () => Navigator.pop(c, false),
                  style: OutlinedButton.styleFrom(
                      textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                  child: const Text('NO'),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: SizedBox(
                height: 54,
                child: FilledButton(
                  onPressed: () => Navigator.pop(c, true),
                  style: FilledButton.styleFrom(
                      backgroundColor: AppColors.accent,
                      foregroundColor: AppColors.primaryDark,
                      textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                  child: const Text('YES, SELECT'),
                ),
              ),
            ),
          ]),
        ],
      ),
    );
    return yes == true;
  }

  void _openWorkers(AttendanceSession open) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => WorkerPickerScreen(
        me: widget.me,
        sessionId: open.id,
        siteId: open.siteId,
        siteName: open.siteName,
        sessionStart: open.checkIn,
      ),
    ));
  }

  int get _onSiteWorkers => _sessionWorkers.where((e) => e.open).length;

  Future<void> _checkOut() async {
    final open = widget.open;
    if (open == null) return;
    final ok = await confirm(
      context,
      'Check out?',
      'Check out from ${open.siteName}.\nTime on this site: ${fmtDuration(open.worked())}'
          '${_onSiteWorkers == 0 ? '' : '\n\n$_onSiteWorkers external worker${_onSiteWorkers == 1 ? '' : 's'} will be checked out with you.'}',
      ok: 'Check out',
    );
    if (!ok || !mounted) return;
    final pos = await _locate('Getting your GPS location…');
    if (pos == null || !mounted) return;

    final site = _siteById(open.siteId);
    final dist = site == null
        ? null
        : LocationService.distance(pos.latitude, pos.longitude, site.lat, site.lng);

    setState(() {
      _busy = true;
      _busyText = 'Checking out…';
    });
    try {
      await Db.checkOut(
        session: open,
        lat: pos.latitude,
        lng: pos.longitude,
        accuracy: pos.accuracy,
        distance: dist,
        radius: site?.radius ?? kDefaultSiteRadius,
        mocked: pos.isMocked,
      );
      await TrackingService.instance
          .pushOnce(widget.me.id, pos, checkedIn: false, siteName: '');
      if (mounted) {
        showSnack(context,
            'Checked out · ${fmtDuration(DateTime.now().difference(open.checkIn))} at ${open.siteName}');
      }
    } catch (e) {
      if (mounted) showSnack(context, 'Check-out failed: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  static final _newSiteMarker = Site(id: '__new__', name: '', lat: 0, lng: 0);

  /// Approved sites, plus any site this employee added that is still awaiting approval.
  List<Site> get _visibleSites =>
      _sites.where((s) => s.approved || s.createdBy == widget.me.id).toList();

  Future<void> _blocked(String title, String message) => showDialog<void>(
        context: context,
        builder: (c) => AlertDialog(
          icon: const Icon(Icons.wrong_location_outlined, color: AppColors.danger, size: 36),
          title: Text(title),
          content: Text(message),
          actions: [
            FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size(100, 42)),
              onPressed: () => Navigator.pop(c),
              child: const Text('OK'),
            ),
          ],
        ),
      );

  /// Asks for a name and saves the employee's current GPS position as a new site.
  Future<Site?> _createSiteHere(Position pos) async {
    final name = TextEditingController();
    final address = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        icon: const Icon(Icons.add_location_alt, color: AppColors.accentDark, size: 36),
        title: const Text('New site at your location'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text('No registered site was found here. Give this place a name and it will be '
              'added as a new site (management will see it).'),
          const SizedBox(height: 14),
          TextField(
            controller: name,
            autofocus: true,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(labelText: 'Site name *', hintText: 'e.g. Marina Tower Block B'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: address,
            decoration: const InputDecoration(labelText: 'Landmark / address (optional)'),
          ),
          const SizedBox(height: 8),
          Text('GPS ${pos.latitude.toStringAsFixed(5)}, ${pos.longitude.toStringAsFixed(5)} · ±${pos.accuracy.round()} m',
              style: const TextStyle(fontSize: 12, color: AppColors.muted)),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(120, 42)),
            onPressed: () {
              if (name.text.trim().isEmpty) return;
              Navigator.pop(c, true);
            },
            child: const Text('Add & check in'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return null;
    setState(() {
      _busy = true;
      _busyText = 'Adding site…';
    });
    try {
      return await Db.createSiteByEmployee(
        user: widget.me,
        name: name.text.trim(),
        address: address.text.trim(),
        lat: pos.latitude,
        lng: pos.longitude,
      );
    } catch (e) {
      if (mounted) showSnack(context, 'Could not add site: $e', error: true);
      return null;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<Site?> _pickSite(Position pos, {bool offerNew = true}) {
    final scheduledIds = _schedules.map((s) => s.siteId).toSet();
    final doneIds = _sessions.where((s) => !s.isOpen).map((s) => s.siteId).toSet();
    final items = _visibleSites
        .map((s) => (
              site: s,
              dist: LocationService.distance(pos.latitude, pos.longitude, s.lat, s.lng),
            ))
        .toList()
      ..sort((a, b) {
        final sa = scheduledIds.contains(a.site.id) ? 0 : 1;
        final sb = scheduledIds.contains(b.site.id) ? 0 : 1;
        if (sa != sb) return sa - sb;
        return a.dist.compareTo(b.dist);
      });

    return showModalBottomSheet<Site>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (c) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.6,
        maxChildSize: 0.9,
        builder: (c, scroll) => Column(children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text('Select site to check in',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            ),
          ),
          Expanded(
            child: ListView.separated(
              controller: scroll,
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 24),
              itemCount: items.length + 1,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (c, i) {
                if (i == 0) {
                  return Card(
                    color: offerNew ? AppColors.accentSoft : null,
                    child: ListTile(
                      onTap: () => Navigator.pop(c, _newSiteMarker),
                      leading: const CircleAvatar(
                        backgroundColor: AppColors.accent,
                        child: Icon(Icons.add_location_alt, color: AppColors.primaryDark),
                      ),
                      title: const Text('Add this place as a new site',
                          style: TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: Text(offerNew
                          ? 'No registered site is near you'
                          : 'Use if your site is not in the list'),
                      trailing: const Icon(Icons.chevron_right),
                    ),
                  );
                }
                final it = items[i - 1];
                final inside = it.dist <= it.site.radius + TrackingService.tolerance(pos.accuracy);
                final scheduled = scheduledIds.contains(it.site.id);
                return Card(
                  child: ListTile(
                    onTap: () => Navigator.pop(c, it.site),
                    leading: CircleAvatar(
                      backgroundColor: (inside ? AppColors.success : AppColors.muted)
                          .withValues(alpha: 0.12),
                      child: Icon(inside ? Icons.where_to_vote : Icons.location_on_outlined,
                          color: inside ? AppColors.success : AppColors.muted),
                    ),
                    title: Text(it.site.name,
                        style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(
                          '${fmtDistance(it.dist)} away${it.site.address.isEmpty ? '' : ' · ${it.site.address}'}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis),
                      const SizedBox(height: 4),
                      Wrap(spacing: 4, runSpacing: 4, children: [
                        inside
                            ? const Pill('Inside', color: AppColors.success)
                            : const Pill('Too far', color: AppColors.danger),
                        if (scheduled) const Pill('Scheduled', color: AppColors.info),
                        if (doneIds.contains(it.site.id))
                          const Pill('Visited', color: AppColors.muted),
                        if (!it.site.approved)
                          const Pill('Awaiting approval', color: AppColors.warning),
                      ]),
                    ]),
                    trailing: const Icon(Icons.chevron_right),
                  ),
                );
              },
            ),
          ),
        ]),
      ),
    );
  }

  // ------------------------------------------------------------ UI

  @override
  Widget build(BuildContext context) {
    final open = widget.open;
    _watchSessionWorkers();
    return Stack(children: [
      RefreshIndicator(
        onRefresh: () async => _subscribe(),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
          children: [
            _statusCard(open),
            const SizedBox(height: 14),
            _actionButton(open),
            const SizedBox(height: 12),
            open != null ? _workersCard(open) : _workersHint(),
            const SizedBox(height: 12),
            _quickActions(open),
            if (_isOffToday) ...[
              const SizedBox(height: 12),
              Card(
                color: const Color(0xFFFFF6E8),
                child: const ListTile(
                  leading: Icon(Icons.beach_access, color: AppColors.warning),
                  title: Text('Today is your off day'),
                  subtitle: Text('You can still check in if you are working today.'),
                ),
              ),
            ],
            SectionTitle("Today's schedule",
                trailing: Text('${_schedules.length} site${_schedules.length == 1 ? '' : 's'}',
                    style: const TextStyle(color: AppColors.muted))),
            if (_schedules.isEmpty)
              const Card(
                child: EmptyState(
                  icon: Icons.event_available_outlined,
                  title: 'No sites scheduled for today',
                  message: 'You can still check in at any active site.',
                ),
              )
            else
              ..._schedules.map(_scheduleCard),
            SectionTitle('Check-ins today',
                trailing: Text(fmtDuration(totalWorked(_sessions)),
                    style: const TextStyle(fontWeight: FontWeight.w700))),
            Card(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                child: !_loaded
                    ? const Padding(
                        padding: EdgeInsets.all(16),
                        child: Center(child: CircularProgressIndicator()))
                    : _sessions.isEmpty
                        ? const EmptyState(
                            icon: Icons.fingerprint, title: 'No check-ins yet today')
                        : Column(
                            children: [
                              for (var i = 0; i < _sessions.length; i++) ...[
                                if (i > 0) const Divider(height: 1),
                                SessionTile(_sessions[i]),
                              ]
                            ],
                          ),
              ),
            ),
          ],
        ),
      ),
      if (_busy)
        Positioned.fill(
          child: Container(
            color: Colors.black26,
            alignment: Alignment.center,
            child: Card(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 22),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  const SizedBox(
                      width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5)),
                  const SizedBox(width: 16),
                  Text(_busyText),
                ]),
              ),
            ),
          ),
        ),
    ]);
  }

  Widget _statusCard(AttendanceSession? open) {
    final now = DateTime.now();
    final greeting = now.hour < 12 ? 'Good morning' : (now.hour < 17 ? 'Good afternoon' : 'Good evening');
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [AppColors.primaryDark, AppColors.primary],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(22),
        border: Border(
          bottom: BorderSide(
              color: open != null ? AppColors.success : AppColors.accent, width: 4),
        ),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('$greeting, ${widget.me.name.split(' ').first}',
            style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700)),
        Text(fmtDate(now), style: TextStyle(color: Colors.white.withValues(alpha: 0.75))),
        const SizedBox(height: 18),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: (open != null ? AppColors.success : AppColors.accent).withValues(alpha: 0.18),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.circle, color: open != null ? const Color(0xFF5FD49A) : AppColors.accent, size: 10),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                open != null ? 'On duty · ${open.siteName}' : 'Not checked in',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
              ),
            ),
          ]),
        ),
        if (open != null)
          Padding(
            padding: const EdgeInsets.only(top: 6, left: 4),
            child: Text('Since ${fmtTime(open.inLocal)}',
                style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 12.5)),
          ),
        const SizedBox(height: 14),
        Text('Total work time today',
            style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 12.5)),
        open != null
            ? LiveTimer(
                // Open sessions that started before midnight still count fully.
                since: open.checkIn,
                base: _closedToday,
                style: const TextStyle(
                    color: AppColors.accent,
                    fontSize: 40,
                    fontWeight: FontWeight.w800,
                    fontFeatures: [FontFeature.tabularFigures()]),
              )
            : Text(fmtClock(_closedToday),
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 38,
                    fontWeight: FontWeight.w800,
                    fontFeatures: [FontFeature.tabularFigures()])),
      ]),
    );
  }

  Widget _quickActions(AttendanceSession? open) {
    Widget tile(IconData icon, String label, VoidCallback onTap) => Expanded(
          child: Card(
            child: InkWell(
              borderRadius: BorderRadius.circular(16),
              onTap: onTap,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Column(children: [
                  Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(
                        color: AppColors.accentSoft, borderRadius: BorderRadius.circular(11)),
                    child: Icon(icon, color: AppColors.accentDark, size: 21),
                  ),
                  const SizedBox(height: 6),
                  Text(label,
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600)),
                ]),
              ),
            ),
          ),
        );
    return Row(children: [
      tile(Icons.engineering_outlined, 'Workers', () {
        if (open != null) {
          _openWorkers(open);
        } else {
          showSnack(context, 'Check in first, then add the workers with you.');
        }
      }),
      const SizedBox(width: 8),
      tile(Icons.add_a_photo_outlined, 'Site update', () => widget.onNavigate?.call(2)),
      const SizedBox(width: 8),
      tile(Icons.calendar_month_outlined, 'History', () => widget.onNavigate?.call(1)),
      const SizedBox(width: 8),
      tile(Icons.receipt_long_outlined, 'Expense', () => widget.onNavigate?.call(3)),
    ]);
  }

  Widget _workersHint() => Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
            color: AppColors.accentSoft, borderRadius: BorderRadius.circular(14)),
        child: const Row(children: [
          Icon(Icons.engineering, color: AppColors.accentDark, size: 20),
          SizedBox(width: 10),
          Expanded(
            child: Text('External workers: check in first, then tick the labour working with you.',
                style: TextStyle(fontSize: 12.5, color: AppColors.primary)),
          ),
        ]),
      );

  Widget _workersCard(AttendanceSession open) {
    final onSite = _sessionWorkers.where((e) => e.open).toList();
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => _openWorkers(open),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 12, 14),
          child: Row(children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                  color: AppColors.accentSoft, borderRadius: BorderRadius.circular(12)),
              child: const Icon(Icons.engineering, color: AppColors.accentDark),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(
                    onSite.isEmpty
                        ? 'No external workers added'
                        : '${onSite.length} external worker${onSite.length == 1 ? '' : 's'} with you',
                    style: const TextStyle(fontWeight: FontWeight.w700)),
                const SizedBox(height: 2),
                Text(
                  onSite.isEmpty
                      ? 'Tap to add labour working with you at this site'
                      : onSite.map((e) => e.workerName).join(', '),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppColors.muted, fontSize: 12.5),
                ),
              ]),
            ),
            TextButton(onPressed: () => _openWorkers(open), child: Text(onSite.isEmpty ? 'Add' : 'Manage')),
          ]),
        ),
      ),
    );
  }

  Widget _actionButton(AttendanceSession? open) {
    final checkedIn = open != null;
    return SizedBox(
      height: 64,
      child: FilledButton.icon(
        style: FilledButton.styleFrom(
          backgroundColor: checkedIn ? AppColors.danger : AppColors.accent,
          foregroundColor: checkedIn ? Colors.white : AppColors.primaryDark,
          elevation: 2,
          shadowColor: (checkedIn ? AppColors.danger : AppColors.accentDark).withValues(alpha: 0.4),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
          textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, letterSpacing: 1),
        ),
        onPressed: _busy ? null : (checkedIn ? _checkOut : () => _startCheckIn()),
        icon: Icon(checkedIn ? Icons.logout : Icons.fingerprint, size: 28),
        label: Text(checkedIn ? 'CHECK OUT' : 'CHECK IN'),
      ),
    );
  }

  Widget _scheduleCard(Schedule s) {
    final sessions = _sessions.where((x) => x.siteId == s.siteId).toList();
    final isOpenHere = widget.open?.siteId == s.siteId;
    final done = sessions.isNotEmpty && !isOpenHere;
    final site = _siteById(s.siteId);
    final color = isOpenHere ? AppColors.success : (done ? AppColors.primary : AppColors.muted);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Card(
        child: ListTile(
          leading: CircleAvatar(
            backgroundColor: color.withValues(alpha: 0.12),
            child: Icon(
                isOpenHere ? Icons.timelapse : (done ? Icons.check : Icons.location_on_outlined),
                color: color),
          ),
          title: Text(s.siteName, style: const TextStyle(fontWeight: FontWeight.w700)),
          subtitle: Text([
            s.timeLabel,
            if (s.note.isNotEmpty) s.note,
            if (sessions.isNotEmpty) 'Worked ${fmtDuration(totalWorked(sessions))}',
          ].join(' · ')),
          trailing: isOpenHere
              ? const Pill('Now', color: AppColors.success)
              : (widget.open == null && site != null
                  ? TextButton(
                      onPressed: _busy ? null : () => _startCheckIn(site),
                      child: Text(done ? 'Again' : 'Check in'),
                    )
                  : (done ? const Pill('Done', color: AppColors.primary) : null)),
        ),
      ),
    );
  }
}
