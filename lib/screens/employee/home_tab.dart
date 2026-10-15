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

class HomeTab extends StatefulWidget {
  final AppUser me;
  final AttendanceSession? open;
  const HomeTab({super.key, required this.me, required this.open});

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
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    _dayWatcher?.cancel();
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
    if (_sites.isEmpty) {
      showSnack(context, 'No sites have been set up yet. Ask management to add a site.',
          error: true);
      return;
    }
    final pos = await _locate('Getting your GPS location…');
    if (pos == null || !mounted) return;

    final site = preselected ?? await _pickSite(pos);
    if (site == null || !mounted) return;

    final dist = LocationService.distance(pos.latitude, pos.longitude, site.lat, site.lng);
    if (pos.isMocked) {
      final ok = await confirm(context, 'Fake GPS detected',
          'A mock-location app seems to be active. This check-in will be flagged for management.',
          ok: 'Continue');
      if (!ok || !mounted) return;
    }
    if (dist > site.radius) {
      final ok = await confirm(
        context,
        'You are outside the site',
        'You are ${fmtDistance(dist)} from ${site.name} (allowed: ${site.radius.round()} m).\n\n'
            'You can still check in, but it will be flagged for management.',
        ok: 'Check in anyway',
      );
      if (!ok || !mounted) return;
    }

    setState(() {
      _busy = true;
      _busyText = 'Checking in…';
    });
    try {
      await Db.checkIn(
        user: widget.me,
        site: site,
        lat: pos.latitude,
        lng: pos.longitude,
        accuracy: pos.accuracy,
        distance: dist,
        mocked: pos.isMocked,
      );
      await TrackingService.instance
          .pushOnce(widget.me.id, pos, checkedIn: true, siteName: site.name);
      if (mounted) showSnack(context, 'Checked in at ${site.name} · ${fmtTime(DateTime.now())}');
    } catch (e) {
      if (mounted) showSnack(context, 'Check-in failed: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _checkOut() async {
    final open = widget.open;
    if (open == null) return;
    final ok = await confirm(
      context,
      'Check out?',
      'Check out from ${open.siteName}.\nTime on this site: ${fmtDuration(open.worked())}',
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

  Future<Site?> _pickSite(Position pos) {
    final scheduledIds = _schedules.map((s) => s.siteId).toSet();
    final doneIds = _sessions.where((s) => !s.isOpen).map((s) => s.siteId).toSet();
    final items = _sites
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
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (c, i) {
                final it = items[i];
                final inside = it.dist <= it.site.radius;
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
                    subtitle: Text(
                        '${fmtDistance(it.dist)} away${it.site.address.isEmpty ? '' : ' · ${it.site.address}'}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis),
                    trailing: Wrap(spacing: 4, direction: Axis.vertical, children: [
                      if (scheduled) const Pill('Scheduled', color: AppColors.info),
                      if (doneIds.contains(it.site.id))
                        const Pill('Visited', color: AppColors.muted),
                      if (inside) const Pill('Inside', color: AppColors.success),
                    ]),
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
    return Stack(children: [
      RefreshIndicator(
        onRefresh: () async => _subscribe(),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
          children: [
            _statusCard(open),
            const SizedBox(height: 14),
            _actionButton(open),
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
        gradient: LinearGradient(
          colors: open != null
              ? const [Color(0xFF14704F), AppColors.success]
              : const [AppColors.primaryDark, AppColors.primary],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('$greeting, ${widget.me.name.split(' ').first}',
            style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700)),
        Text(fmtDate(now), style: TextStyle(color: Colors.white.withValues(alpha: 0.75))),
        const SizedBox(height: 18),
        Row(children: [
          Icon(open != null ? Icons.radio_button_checked : Icons.radio_button_off,
              color: Colors.white, size: 16),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              open != null ? 'On duty at ${open.siteName}' : 'Not checked in',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
            ),
          ),
        ]),
        if (open != null)
          Padding(
            padding: const EdgeInsets.only(top: 2, left: 22),
            child: Text('Since ${fmtTime(open.checkIn)}',
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
                    color: Colors.white,
                    fontSize: 38,
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

  Widget _actionButton(AttendanceSession? open) {
    final checkedIn = open != null;
    return SizedBox(
      height: 64,
      child: FilledButton.icon(
        style: FilledButton.styleFrom(
          backgroundColor: checkedIn ? AppColors.danger : AppColors.primary,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
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
