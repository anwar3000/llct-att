import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import '../models/models.dart';
import 'db.dart';
import 'position_hub.dart';
import 'violation_service.dart';

/// Runs while an employee is checked in:
///  * streams their position to Firestore (live map + GPS trail)
///  * records a GPS point at least every hour
///  * raises a management alert if they leave the site's geofence without
///    checking out (at most once per hour, while they stay outside)
///
/// On Android this is a foreground service (persistent "On duty" notification)
/// so it keeps working with the app in the background or the screen off.
class TrackingService {
  TrackingService._();
  static final instance = TrackingService._();

  bool _running = false;
  DateTime? _lastPushAt;
  /// Last time this phone got any GPS fix (or the start of the current no-GPS gap).
  DateTime? _lastFixAt;
  Timer? _watchdog;
  Timer? _hourly;
  String? _uid;
  String _name = '';
  AttendanceSession? _session;
  Site? _site;
  DateTime? _lastTrackPoint;
  Position? _lastTrackPos;
  Position? _lastPos;
  DateTime? _lastAlertAt;
  bool _wasOutside = false;

  bool get isRunning => _running;
  String? get sessionId => _session?.id;

  static const _trackEvery = Duration(minutes: 2);
  static const _trackMinMeters = 75.0;
  static const _hourlyCheck = Duration(hours: 1);
  static const _alertEvery = Duration(hours: 1);

  /// Extra metres allowed beyond the site radius to absorb GPS jitter.
  static double tolerance(double accuracy) => accuracy.clamp(10, 40).toDouble();

  Future<void> start({
    required String uid,
    required String name,
    required AttendanceSession session,
    Site? site,
  }) async {
    if (_running && _uid == uid && _session?.id == session.id) {
      if (site != null) _site = site;
      return;
    }
    await stop(markStopped: false);
    _uid = uid;
    _name = name;
    _session = session;
    _site = site ?? await Db.getSite(session.siteId).catchError((_) => null);
    _wasOutside = false;
    _lastAlertAt = null;

    _running = true;
    _lastFixAt = session.checkIn;
    // App reopened after being closed / phone off: count the hours with no GPS since the last location.
    try {
      final u = await Db.users.doc(uid).get();
      final ll = u.data()?['lastLocation'];
      final at = ll is Map && ll['at'] is Timestamp ? (ll['at'] as Timestamp).toDate() : null;
      if (at != null && at.isAfter(session.checkIn)) _lastFixAt = at;
      await ViolationService.recordGap(uid: uid, name: name, session: session, gapStart: _lastFixAt!);
    } catch (e) {
      debugPrint('gap check failed: $e');
    }
    await PositionHub.instance.add('duty', _onPosition);
    _hourly = Timer.periodic(_hourlyCheck, (_) => _hourlyTick());
    _watchdog = Timer.periodic(const Duration(minutes: 5), (_) => _watch());
  }

  Future<void> _onPosition(Position p) async {
    final uid = _uid;
    if (uid == null) return;
    _lastPos = p;
    final now = DateTime.now();
    _lastFixAt = now;
    // During a driver trip the shared GPS runs every few seconds — keep duty updates to ~1 per 30 s.
    if (_lastPushAt != null && now.difference(_lastPushAt!) < const Duration(seconds: 30)) return;
    _lastPushAt = now;
    var addPoint = _lastTrackPoint == null || now.difference(_lastTrackPoint!) >= _trackEvery;
    if (!addPoint && _lastTrackPos != null) {
      final moved = Geolocator.distanceBetween(
          _lastTrackPos!.latitude, _lastTrackPos!.longitude, p.latitude, p.longitude);
      addPoint = moved >= _trackMinMeters;
    }
    try {
      await Db.pushLocation(
        uid: uid,
        lat: p.latitude,
        lng: p.longitude,
        accuracy: p.accuracy,
        checkedIn: true,
        siteName: _session?.siteName ?? '',
        addTrackPoint: addPoint,
      );
      if (addPoint) {
        _lastTrackPoint = now;
        _lastTrackPos = p;
      }
    } catch (e) {
      debugPrint('pushLocation failed: $e');
    }
    await _checkGeofence(p);
  }

  /// Every 5 min: if no GPS for 15 min, ask for a fresh fix (a phone standing still sends none);
  /// if there has been no GPS for an hour or more, record "no activity" violations.
  Future<void> _watch() async {
    final uid = _uid, session = _session, since = _lastFixAt;
    if (uid == null || session == null || since == null) return;
    final gap = DateTime.now().difference(since);
    if (gap < const Duration(minutes: 15)) return;
    try {
      final p = await Geolocator.getCurrentPosition(
        locationSettings: AndroidSettings(accuracy: LocationAccuracy.high, timeLimit: const Duration(seconds: 30)),
      );
      _lastPushAt = null; // make sure this fix is saved
      await _onPosition(p);
      return;
    } catch (_) {}
    if (gap.inMinutes >= ViolationService.kNoGpsMinutes) {
      await ViolationService.recordGap(uid: uid, name: _name, session: session, gapStart: since);
    }
  }

  /// Hourly: take a fresh fix, store it, and re-check the geofence.
  Future<void> _hourlyTick() async {
    final uid = _uid;
    final session = _session;
    if (uid == null || session == null) return;
    Position? p;
    try {
      p = await Geolocator.getCurrentPosition(
        locationSettings: AndroidSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: const Duration(seconds: 30),
        ),
      );
    } catch (_) {
      p = _lastPos;
    }
    if (p == null) return; // counted by the no-GPS watchdog
    try {
      await Db.pushLocation(
        uid: uid,
        lat: p.latitude,
        lng: p.longitude,
        accuracy: p.accuracy,
        checkedIn: true,
        siteName: session.siteName,
      );
      _lastTrackPoint = DateTime.now();
      _lastTrackPos = p;
    } catch (_) {}
    await _checkGeofence(p);
  }

  Future<void> _checkGeofence(Position p) async {
    final site = _site;
    final session = _session;
    final uid = _uid;
    if (site == null || session == null || uid == null) return;
    final d = Geolocator.distanceBetween(p.latitude, p.longitude, site.lat, site.lng);
    final outside = d > site.radius + tolerance(p.accuracy);
    if (!outside) {
      _wasOutside = false;
      return;
    }
    final now = DateTime.now();
    final due = !_wasOutside || _lastAlertAt == null || now.difference(_lastAlertAt!) >= _alertEvery;
    _wasOutside = true;
    if (!due) return;
    _lastAlertAt = now;
    try {
      await Db.addAlert(
        uid: uid,
        name: _name,
        session: session,
        type: 'left_site',
        lat: p.latitude,
        lng: p.longitude,
        distance: d,
      );
    } catch (e) {
      debugPrint('addAlert failed: $e');
    }
  }

  /// Push a one-off location (used at check-in/out so the map updates instantly).
  Future<void> pushOnce(String uid, Position p,
      {required bool checkedIn, required String siteName}) async {
    try {
      await Db.pushLocation(
        uid: uid,
        lat: p.latitude,
        lng: p.longitude,
        accuracy: p.accuracy,
        checkedIn: checkedIn,
        siteName: siteName,
      );
      _lastTrackPoint = DateTime.now();
      _lastTrackPos = p;
    } catch (e) {
      debugPrint('pushOnce failed: $e');
    }
  }

  Future<void> stop({bool markStopped = true}) async {
    if (_running) await PositionHub.instance.remove('duty');
    _running = false;
    _hourly?.cancel();
    _hourly = null;
    _watchdog?.cancel();
    _watchdog = null;
    _lastFixAt = null;
    final uid = _uid;
    if (markStopped && uid != null) {
      try {
        await Db.markTrackingStopped(uid);
      } catch (_) {}
    }
    _session = null;
    _site = null;
    _lastTrackPoint = null;
    _lastTrackPos = null;
    _lastPos = null;
  }
}
