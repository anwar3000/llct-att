import 'dart:async';

import 'package:geolocator/geolocator.dart';

class LocationException implements Exception {
  final String message;
  final bool openSettings;
  LocationException(this.message, {this.openSettings = false});
  @override
  String toString() => message;
}

class LocationService {
  LocationService._();

  /// Makes sure GPS is on and permission granted. Throws [LocationException].
  static Future<void> ensureReady() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw LocationException('Location (GPS) is turned off. Please turn it on.',
          openSettings: true);
    }
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) {
      perm = await Geolocator.requestPermission();
    }
    if (perm == LocationPermission.denied) {
      throw LocationException('Location permission is required to check in.');
    }
    if (perm == LocationPermission.deniedForever) {
      throw LocationException(
          'Location permission is blocked. Enable it in App settings > Permissions.',
          openSettings: true);
    }
  }

  /// Gets a fresh, high-accuracy fix.
  static Future<Position> current() async {
    await ensureReady();
    try {
      return await Geolocator.getCurrentPosition(
        locationSettings: AndroidSettings(
          accuracy: LocationAccuracy.best,
          timeLimit: const Duration(seconds: 25),
        ),
      );
    } on TimeoutException {
      final last = await Geolocator.getLastKnownPosition();
      if (last != null) return last;
      throw LocationException('Could not get your location. Move to an open area and try again.');
    }
  }

  static double distance(double lat1, double lng1, double lat2, double lng2) =>
      Geolocator.distanceBetween(lat1, lng1, lat2, lng2);

  static Future<void> openSettings() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      await Geolocator.openLocationSettings();
    } else {
      await Geolocator.openAppSettings();
    }
  }
}
