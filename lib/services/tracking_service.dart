import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import '../models/models.dart';
import 'db.dart';

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

  StreamSubscription<Position>? _sub;
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

  bool get isRunning => _sub != null;
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
    if (_sub != null && _uid == uid && _session?.id == session.id) {
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

    final settings = AndroidSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: 25,
      intervalDuration: const Duration(seconds: 60),
      foregroundNotificationConfig: const ForegroundNotificationConfig(
        notificationTitle: 'On duty',
        notificationText: 'Your work location is being shared while checked in.',
        enableWakeLock: true,
        setOngoing: true,
      ),
    );

    _sub = Geolocator.getPositionStream(locationSettings: settings).listen(
      _onPosition,
      onError: (e) => debugPrint('Tracking error: $e'),
    );
    _hourly = Timer.periodic(_hourlyCheck, (_) => _hourlyTick());
  }

  Future<void> _onPosition(Position p) async {
    final uid = _uid;
    if (uid == null) return;
    _lastPos = p;
    final now = DateTime.now();
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
    if (p == null) {
      try {
        await Db.addAlert(uid: uid, name: _name, session: session, type: 'gps_off');
      } catch (_) {}
      return;
    }
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
    await _sub?.cancel();
    _sub = null;
    _hourly?.cancel();
    _hourly = null;
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
