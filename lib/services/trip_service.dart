import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import '../models/models.dart';
import 'db.dart';
import 'location_service.dart';
import 'position_hub.dart';
import 'road_distance.dart';

/// Records a driver's car trip: start → stop, GPS route, distance driven.
///
/// Distance is the sum of GPS steps along the route. Poor fixes (accuracy worse
/// than 50 m), tiny jitter steps and impossible jumps (> 250 km/h) are ignored,
/// so a parked car does not add distance.
class TripService {
  TripService._();
  static final instance = TripService._();

  /// Live distance in metres for the trip in progress (for the UI).
  final ValueNotifier<double> distance = ValueNotifier(0);

  Trip? _trip;
  int _points = 0;
  Position? _last;
  DateTime? _lastSavedAt;
  double _savedDist = 0;
  bool _saving = false;
  DateTime? _lastFixAt;
  Timer? _fallback;
  bool _probing = false;

  String? get activeId => _trip?.id;
  bool get isRunning => _trip != null;

  /// Pick-up / drop-off site: the nearest site whose area (plus 200 m for parking) contains the point.
  static Site? siteAt(double lat, double lng, List<Site> sites) {
    Site? best;
    double bestD = double.infinity;
    for (final s in sites) {
      final d = Geolocator.distanceBetween(lat, lng, s.lat, s.lng);
      if (d <= s.radius + 200 && d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  }

  Future<String> start({
    required AppUser user,
    required String vehicle,
    required String purpose,
    required List<Site> sites,
    String kind = 'driver',
    AppUser? driver,
    double? ratePerKm,
    Map<String, dynamic> extra = const {},
  }) async {
    final p = await LocationService.current();
    final site = siteAt(p.latitude, p.longitude, sites);
    final id = await Db.startTrip(
      user: user,
      vehicle: vehicle,
      purpose: purpose,
      lat: p.latitude,
      lng: p.longitude,
      site: site,
      kind: kind,
      driver: driver,
      ratePerKm: ratePerKm,
      extra: extra,
    );
    _trip = Trip(
      id: id,
      employeeId: user.id,
      employeeName: user.name,
      vehicle: vehicle,
      purpose: purpose,
      startAt: DateTime.now(),
      startLat: p.latitude,
      startLng: p.longitude,
      startSiteId: site?.id ?? '',
      startSiteName: site?.name ?? '',
      kind: kind,
      driverId: driver?.id ?? '',
      driverName: driver?.name ?? '',
      ratePerKm: ratePerKm,
    );
    _points = 1;
    _last = p;
    _savedDist = 0;
    _lastSavedAt = DateTime.now();
    distance.value = 0;
    _lastFixAt = DateTime.now();
    await PositionHub.instance.add('trip', _onPosition, fine: true);
    _startFallback();
    return id;
  }

  /// Picks up a trip that is still open (e.g. after the app was closed).
  Future<void> resume(Trip t) async {
    if (_trip?.id == t.id && PositionHub.instance.has('trip')) return;
    _trip = t;
    _points = t.pointsCount;
    _savedDist = t.distanceM;
    distance.value = t.distanceM;
    _lastSavedAt = DateTime.now();
    _last = null;
    final lat = t.lastLat ?? t.startLat, lng = t.lastLng ?? t.startLng;
    if (lat != null && lng != null) {
      _last = Position(
        latitude: lat,
        longitude: lng,
        timestamp: DateTime.now().subtract(const Duration(minutes: 1)),
        accuracy: 20,
        altitude: 0,
        altitudeAccuracy: 0,
        heading: 0,
        headingAccuracy: 0,
        speed: 0,
        speedAccuracy: 0,
      );
    }
    try {
      await LocationService.ensureReady();
    } catch (_) {}
    await PositionHub.instance.add('trip', _onPosition, fine: true);
    _startFallback();
  }

  /// Distance this fix adds to the trip, or null if it should be ignored.
  /// The last counted fix is kept until a step counts, so slow movement still adds up — only drift doesn't.
  double? _step(Position p) {
    if (p.isMocked || p.accuracy > 35) return null;
    final last = _last;
    if (last == null) return 0;
    final d = Geolocator.distanceBetween(last.latitude, last.longitude, p.latitude, p.longitude);
    final jitter = (p.accuracy + last.accuracy) / 2;
    if (d < jitter.clamp(10, 30)) return null;
    // Standing still (GPS speed under ~3 km/h): a short jump is drift, not driving.
    if (p.speed < 0.8 && d < math.max(40, p.accuracy * 2)) return null;
    final secs = p.timestamp.difference(last.timestamp).inMilliseconds / 1000;
    if (secs > 0 && d / secs > 70) return null; // > 250 km/h — a GPS jump
    return d;
  }

  void _onPosition(Position p) {
    final trip = _trip;
    if (trip == null) return;
    _lastFixAt = DateTime.now();
    final d = _step(p);
    if (d != null) {
      _last = p;
      if (d > 0) {
        _points++;
        distance.value += d;
      }
    }
    // Save the route / current position: every 30 s while moving (or each 250 m),
    // every minute while standing — so the office always sees where the ride is.
    final now = DateTime.now();
    final moved = distance.value - _savedDist;
    final every = Duration(seconds: moved > 0 ? 30 : 60);
    final due = _lastSavedAt == null || now.difference(_lastSavedAt!) >= every || moved >= 250;
    if (due && !_saving && !p.isMocked && p.accuracy <= 100) _save(trip.id, p);
  }

  /// If the GPS stream goes quiet (some phones pause it), ask for a fix directly.
  Future<void> _fallbackTick() async {
    if (_trip == null || _probing) return;
    final last = _lastFixAt;
    if (last != null && DateTime.now().difference(last) < const Duration(seconds: 45)) return;
    _probing = true;
    try {
      final p = await Geolocator.getCurrentPosition(
        locationSettings: AndroidSettings(accuracy: LocationAccuracy.high, timeLimit: const Duration(seconds: 20)),
      );
      _onPosition(p);
    } catch (_) {
    } finally {
      _probing = false;
    }
  }

  void _startFallback() {
    _fallback?.cancel();
    _fallback = Timer.periodic(const Duration(seconds: 30), (_) => _fallbackTick());
  }

  Future<void> _save(String id, Position p) async {
    _saving = true;
    try {
      await Db.addTripPoint(id, p.latitude, p.longitude, distance.value, _points);
      _savedDist = distance.value;
      _lastSavedAt = DateTime.now();
    } catch (e) {
      debugPrint('trip point failed: $e');
    } finally {
      _saving = false;
    }
  }

  /// Ends the trip, works out the drop-off site and the cost.
  /// Driver trip: the cost the driver entered ([fare]), else km × rate. Taxi ride: the [fare] the employee entered. With a company driver: no cost
  /// here (the driver's own trip is what gets paid), so it isn't counted twice.
  Future<Trip> stop(
      {required AppUser user,
      required Trip trip,
      required List<Site> sites,
      String note = '',
      double? fare,
      String? vehicle,
      String? receipt}) async {
    if (_trip?.id != trip.id) {
      _trip = trip;
      distance.value = trip.distanceM;
      _points = trip.pointsCount;
    }
    Position? p;
    try {
      p = await LocationService.current();
      final d = _step(p);
      if (d != null && d > 0) distance.value += d;
    } catch (_) {}
    final site = p == null ? null : siteAt(p.latitude, p.longitude, sites);
    // Road km: the saved route matched to the road map — fixes GPS jitter, parked drift and gaps.
    final gpsM = distance.value;
    double? roadM;
    try {
      final end = p;
      final r = await () async {
        final route = <({double lat, double lng})>[
          if (trip.startLat != null && trip.startLng != null) (lat: trip.startLat!, lng: trip.startLng!),
          ...await Db.tripPoints(trip.id),
          if (end != null) (lat: end.latitude, lng: end.longitude),
        ];
        final road = route.length < 3 ? null : await RoadDistance.of(route); // needs a real route, not just pick-up & drop-off
        final direct = route.length < 2 ? 0.0 : Geolocator.distanceBetween(route.first.lat, route.first.lng, route.last.lat, route.last.lng);
        return (road: road, direct: direct);
      }()
          .timeout(const Duration(seconds: 15)); // no signal: keep the GPS km, don't hold up the stop
      roadM = r.road;
      distance.value = RoadDistance.pick(gpsM: gpsM, roadM: roadM, directM: r.direct);
    } catch (_) {}
    // Ride with a company driver: km × that driver's rate (saved when the ride started).
    final rate = trip.isTaxi ? null : (trip.isWithDriver ? (trip.ratePerKm ?? 0) : await Db.tripRate(user));
    // Taxi / RTA fare paid by the employee → a petty cash expense (approved by admin like any other).
    String? pettyId;
    if (trip.isTaxi && fare != null && fare > 0) {
      final from = trip.startSiteName.isNotEmpty ? trip.startSiteName : 'GPS';
      final to = site?.name ?? 'GPS';
      final rta = trip.mode == 'rta';
      pettyId = await Db.addPetty(
        employeeId: user.id,
        employeeName: user.name,
        type: 'expense',
        amount: fare,
        category: rta ? 'Transport - RTA' : 'Transport - Taxi',
        note: '${rta ? 'RTA (metro / bus)' : 'Taxi'}: $from → $to${vehicle != null && vehicle.isNotEmpty ? ' · $vehicle' : ''} · ${(distance.value / 1000).toStringAsFixed(1)} km',
        status: 'pending',
        createdBy: user.id,
        createdByName: user.name,
        site: site,
        receipt: receipt,
        tripId: trip.id,
      );
    }
    // Both measurements, for the office — written while the trip is still open (needs the latest Firestore rules;
    // skipped quietly if they aren't published yet).
    try {
      await Db.tripKmDetail(trip.id, gpsM: gpsM, roadM: roadM, source: distance.value == gpsM ? 'gps' : 'road')
          .timeout(const Duration(seconds: 6));
    } catch (_) {}
    await Db.endTrip(
      trip: trip,
      distanceM: distance.value,
      points: _points,
      ratePerKm: rate,
      // Staff ride with a driver / provider: no cost here — the provider adds the charge, admin approves.
      cost: fare ?? (trip.isTaxi || trip.isWithDriver ? 0 : null),
      vehicle: vehicle,
      costEntered: !trip.isRide && fare != null,
      lat: p?.latitude,
      lng: p?.longitude,
      site: site,
      note: note,
      pettyId: pettyId,
    );
    await PositionHub.instance.remove('trip');
    _fallback?.cancel();
    _fallback = null;
    _trip = null;
    _last = null;
    return trip;
  }

  /// Stops listening without closing the trip (sign-out).
  Future<void> detach() async {
    _fallback?.cancel();
    _fallback = null;
    await PositionHub.instance.remove('trip');
    _trip = null;
    _last = null;
  }
}
