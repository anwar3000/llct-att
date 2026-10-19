import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

/// One shared GPS stream for the whole app.
///
/// Android's geolocator keeps a single position stream per app, so on-duty
/// tracking and driver trips both listen here instead of opening their own.
/// While a trip is running the stream switches to a finer setting (every few
/// seconds / 10 m) so the distance driven is measured accurately.
class PositionHub {
  PositionHub._();
  static final instance = PositionHub._();

  final Map<String, void Function(Position)> _listeners = {};
  final Set<String> _fine = {};
  StreamSubscription<Position>? _sub;
  bool _isFine = false;
  Future<void> _pending = Future.value();

  bool has(String key) => _listeners.containsKey(key);

  Future<void> add(String key, void Function(Position) onPosition, {bool fine = false}) {
    _listeners[key] = onPosition;
    if (fine) {
      _fine.add(key);
    } else {
      _fine.remove(key);
    }
    return _queue();
  }

  Future<void> remove(String key) {
    _listeners.remove(key);
    _fine.remove(key);
    return _queue();
  }

  Future<void> _queue() => _pending = _pending.then((_) => _refresh()).catchError((_) {});

  Future<void> _refresh() async {
    if (_listeners.isEmpty) {
      await _sub?.cancel();
      _sub = null;
      return;
    }
    final wantFine = _fine.isNotEmpty;
    if (_sub != null && wantFine == _isFine) return;
    await _sub?.cancel();
    _sub = null;
    _isFine = wantFine;
    final settings = AndroidSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: wantFine ? 10 : 25,
      intervalDuration: Duration(seconds: wantFine ? 5 : 60),
      foregroundNotificationConfig: ForegroundNotificationConfig(
        notificationTitle: wantFine ? 'Trip in progress' : 'On duty',
        notificationText: wantFine
            ? 'Your route and distance are being recorded for this trip.'
            : 'Your work location is being shared while checked in.',
        enableWakeLock: true,
        setOngoing: true,
      ),
    );
    _sub = Geolocator.getPositionStream(locationSettings: settings).listen(
      (p) {
        for (final cb in List.of(_listeners.values)) {
          try {
            cb(p);
          } catch (e) {
            debugPrint('position listener failed: $e');
          }
        }
      },
      onError: (e) => debugPrint('GPS stream error: $e'),
    );
  }
}
