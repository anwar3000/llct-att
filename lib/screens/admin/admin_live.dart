import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/db.dart';
import 'staff_status.dart';

/// Live data shared by every dashboard tab (one set of Firestore listeners).
class AdminLive extends ChangeNotifier {
  AdminLive({this.canSeeAccounts = true});

  /// Managers can't read petty cash (Firestore rules), so don't subscribe.
  final bool canSeeAccounts;

  List<AppUser> users = [];
  List<Site> sites = [];
  List<AttendanceSession> today = [];
  List<AttendanceSession> open = [];
  List<OffDay> monthOff = [];
  List<OffDay> pendingOff = [];
  List<Schedule> schedules = [];
  List<PettyTxn> pendingPetty = [];
  List<GeoAlert> alerts = [];
  /// Set when external-worker data can't be read (usually: Firestore rules not published).
  String? externalError;
  List<Trip> _tToday = [];
  List<Trip> activeTrips = [];
  List<WorkerEntry> _wToday = [];
  List<WorkerEntry> _wOpen = [];

  /// Today's external-worker entries plus any still open from earlier (e.g. checked in before midnight).
  List<WorkerEntry> get workersToday {
    final m = <String, WorkerEntry>{for (final e in _wToday) e.id: e};
    for (final e in _wOpen) {
      m[e.id] = e;
    }
    return m.values.toList();
  }
  /// Today's driver trips plus any still running from before midnight (newest first).
  List<Trip> get tripsToday {
    final m = <String, Trip>{for (final t in _tToday) t.id: t};
    for (final t in activeTrips) {
      m[t.id] = t;
    }
    return m.values.toList()..sort((a, b) => b.startAt.compareTo(a.startAt));
  }

  bool loaded = false;
  Object? error;

  final List<StreamSubscription> _subs = [];
  Timer? _ticker;
  String _day = dateKey(DateTime.now());

  void start() {
    _listen();
    // Refresh "time ago" labels / timers and roll over at midnight.
    _ticker = Timer.periodic(const Duration(seconds: 30), (_) {
      final k = dateKey(DateTime.now());
      if (k != _day) {
        _day = k;
        _listen();
      }
      notifyListeners();
    });
  }

  void _listen() {
    for (final s in _subs) {
      s.cancel();
    }
    _subs.clear();
    final now = DateTime.now();
    void onErr(Object e) {
      error = e;
      notifyListeners();
    }

    _subs.add(Db.employeesStream().listen((v) {
      users = v;
      loaded = true;
      notifyListeners();
    }, onError: onErr));
    _subs.add(Db.sitesStream().listen((v) {
      sites = v;
      notifyListeners();
    }, onError: onErr));
    _subs.add(Db.sessionsForDate(dateKey(now)).listen((v) {
      today = v;
      notifyListeners();
    }, onError: onErr));
    _subs.add(Db.allOpenSessions().listen((v) {
      open = v;
      notifyListeners();
    }, onError: onErr));
    _subs.add(Db.offDaysForMonth(monthKey(now)).listen((v) {
      monthOff = v;
      notifyListeners();
    }, onError: onErr));
    _subs.add(Db.offDaysPending().listen((v) {
      pendingOff = v;
      notifyListeners();
    }, onError: onErr));
    _subs.add(Db.schedulesForDate(dateKey(now)).listen((v) {
      schedules = v;
      notifyListeners();
    }, onError: onErr));
    _subs.add(Db.openAlerts().listen((v) {
      alerts = v;
      notifyListeners();
    }, onError: onErr));
    void extErr(Object e) {
      externalError = '$e';
      notifyListeners();
    }

    _subs.add(Db.workersForDate(dateKey(now)).listen((v) {
      _wToday = v;
      externalError = null;
      notifyListeners();
    }, onError: extErr));
    _subs.add(Db.openWorkerEntries().listen((v) {
      _wOpen = v;
      notifyListeners();
    }, onError: extErr));
    _subs.add(Db.tripsForDate(dateKey(now)).listen((v) {
      _tToday = v;
      notifyListeners();
    }, onError: (_) {}));
    _subs.add(Db.activeTripsAll().listen((v) {
      activeTrips = v;
      notifyListeners();
    }, onError: (_) {}));
    if (canSeeAccounts) _subs.add(Db.pettyPending().listen((v) {
      pendingPetty = v;
      notifyListeners();
    }, onError: onErr));
  }

  List<AppUser> get employees => users.where((u) => u.isEmployee).toList();
  List<AppUser> get activeEmployees => users.where((u) => u.isEmployee && u.active).toList();

  List<StaffStatus> get statuses => computeStatuses(
        users: users,
        todaySessions: today,
        openSessions: open,
        monthOffDays: monthOff,
      );

  AppUser? userById(String id) => users.where((u) => u.id == id).firstOrNull;
  Site? siteById(String id) => sites.where((s) => s.id == id).firstOrNull;

  /// External workers on site right now (open entries; any date, catches forgotten check-outs).
  List<WorkerEntry> get externalOnSite => workersToday.where((e) => e.open).toList();

  /// One entry per external worker who worked today: latest entry + total time.
  List<({WorkerEntry e, Duration time, bool onSite})> get externalToday {
    final by = <String, List<WorkerEntry>>{};
    for (final e in workersToday) {
      by.putIfAbsent(e.workerId, () => []).add(e);
    }
    final out = by.values.map((l) {
      l.sort((a, b) => a.checkIn.compareTo(b.checkIn));
      return (e: l.last, time: l.fold(Duration.zero, (a, x) => a + x.worked()), onSite: l.any((x) => x.open));
    }).toList()
      ..sort((a, b) => a.onSite == b.onSite ? a.e.workerName.compareTo(b.e.workerName) : (a.onSite ? -1 : 1));
    return out;
  }

  List<Site> get pendingSites => sites.where((s) => !s.approved && s.status != 'rejected').toList();

  int get pendingCount => pendingOff.length + pendingPetty.length + pendingSites.length;

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    _ticker?.cancel();
    super.dispose();
  }
}
