import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/db.dart';
import 'staff_status.dart';

/// Live data shared by every dashboard tab (one set of Firestore listeners).
class AdminLive extends ChangeNotifier {
  List<AppUser> users = [];
  List<Site> sites = [];
  List<AttendanceSession> today = [];
  List<AttendanceSession> open = [];
  List<OffDay> monthOff = [];
  List<OffDay> pendingOff = [];
  List<Schedule> schedules = [];
  List<PettyTxn> pendingPetty = [];
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
    _subs.add(Db.pettyPending().listen((v) {
      pendingPetty = v;
      notifyListeners();
    }, onError: onErr));
  }

  List<AppUser> get employees => users.where((u) => !u.isAdmin).toList();
  List<AppUser> get activeEmployees => users.where((u) => !u.isAdmin && u.active).toList();

  List<StaffStatus> get statuses => computeStatuses(
        users: users,
        todaySessions: today,
        openSessions: open,
        monthOffDays: monthOff,
      );

  AppUser? userById(String id) => users.where((u) => u.id == id).firstOrNull;
  Site? siteById(String id) => sites.where((s) => s.id == id).firstOrNull;

  int get pendingCount => pendingOff.length + pendingPetty.length;

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    _ticker?.cancel();
    super.dispose();
  }
}
