import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import 'db.dart';

/// Streams the employee's position to Firestore while they are checked in, so
/// management can see live work locations.
///
/// On Android this runs as a foreground service (with a persistent
/// notification) so updates continue when the app is in the background.
class TrackingService {
  TrackingService._();
  static final instance = TrackingService._();

  StreamSubscription<Position>? _sub;
  String? _uid;
  String _siteName = '';
  DateTime? _lastTrackPoint;
  Position? _lastTrackPos;

  bool get isRunning => _sub != null;

  /// Minimum gap between stored trail points.
  static const _trackEvery = Duration(minutes: 2);
  static const _trackMinMeters = 75.0;

  Future<void> start({required String uid, required String siteName}) async {
    if (_sub != null && _uid == uid) {
      _siteName = siteName;
      return;
    }
    await stop(markStopped: false);
    _uid = uid;
    _siteName = siteName;

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
  }

  Future<void> _onPosition(Position p) async {
    final uid = _uid;
    if (uid == null) return;
    final now = DateTime.now();
    var addPoint = _lastTrackPoint == null ||
        now.difference(_lastTrackPoint!) >= _trackEvery;
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
        siteName: _siteName,
        addTrackPoint: addPoint,
      );
      if (addPoint) {
        _lastTrackPoint = now;
        _lastTrackPos = p;
      }
    } catch (e) {
      debugPrint('pushLocation failed: $e');
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
    final uid = _uid;
    if (markStopped && uid != null) {
      try {
        await Db.markTrackingStopped(uid);
      } catch (_) {}
    }
    _lastTrackPoint = null;
    _lastTrackPos = null;
  }
}
