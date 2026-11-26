import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:geolocator/geolocator.dart';

/// Road distance of a recorded trip: the GPS route is matched to the road map (OpenStreetMap / OSRM), so GPS
/// jitter, parked drift and gaps (phone paused GPS) don't make the km wrong.
class RoadDistance {
  static const _host = 'router.project-osrm.org';

  /// Drops points closer than [minGap] metres to the last kept one (parked drift), keeps the last point.
  static List<({double lat, double lng})> thin(List<({double lat, double lng})> pts, {double minGap = 40}) {
    final out = <({double lat, double lng})>[];
    for (final p in pts) {
      if (out.isEmpty || Geolocator.distanceBetween(out.last.lat, out.last.lng, p.lat, p.lng) >= minGap) out.add(p);
    }
    if (pts.isNotEmpty && out.last != pts.last) out.add(pts.last);
    return out;
  }

  /// Straight-line sum of the thinned route (for sanity checks).
  static double straight(List<({double lat, double lng})> pts) {
    var d = 0.0;
    for (var i = 1; i < pts.length; i++) {
      d += Geolocator.distanceBetween(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
    }
    return d;
  }

  /// Road metres along the route, or null when the map service can't be reached / can't match it.
  static Future<double?> of(List<({double lat, double lng})> raw, {Duration timeout = const Duration(seconds: 12)}) async {
    final pts = thin(raw);
    if (pts.length < 2) return 0;
    try {
      var total = 0.0;
      // The public matcher takes up to 100 points per request: chunks overlap by one point.
      for (var i = 0; i < pts.length - 1; i += 89) {
        final chunk = pts.sublist(i, math.min(i + 90, pts.length));
        final d = await _match(chunk, timeout) ?? await _route(chunk, timeout);
        if (d == null) return null;
        total += d;
      }
      return total;
    } catch (_) {
      return null;
    }
  }

  static String _coords(List<({double lat, double lng})> c) =>
      c.map((p) => '${p.lng.toStringAsFixed(6)},${p.lat.toStringAsFixed(6)}').join(';');

  static Future<Map<String, dynamic>?> _get(String path, Duration timeout) async {
    final client = HttpClient()..connectionTimeout = timeout;
    try {
      final req = await client.getUrl(Uri.parse('https://$_host$path'));
      final res = await req.close().timeout(timeout);
      if (res.statusCode != 200) return null;
      final body = await res.transform(utf8.decoder).join().timeout(timeout);
      return jsonDecode(body) as Map<String, dynamic>;
    } finally {
      client.close(force: true);
    }
  }

  /// Map matching (snaps the GPS trace to roads, ignoring noise).
  static Future<double?> _match(List<({double lat, double lng})> c, Duration timeout) async {
    final r = List.filled(c.length, '30').join(';');
    final j = await _get('/match/v1/driving/${_coords(c)}?overview=false&tidy=true&gaps=ignore&radiuses=$r', timeout);
    if (j == null || j['code'] != 'Ok') return null;
    final m = (j['matchings'] as List?) ?? const [];
    if (m.isEmpty) return null;
    return m.fold<double>(0, (a, x) => a + ((x as Map)['distance'] as num).toDouble());
  }

  /// Road route through the points (when matching isn't possible).
  static Future<double?> _route(List<({double lat, double lng})> c, Duration timeout) async {
    final j = await _get('/route/v1/driving/${_coords(c)}?overview=false', timeout);
    if (j == null || j['code'] != 'Ok') return null;
    final r = (j['routes'] as List?) ?? const [];
    if (r.isEmpty) return null;
    return ((r.first as Map)['distance'] as num).toDouble();
  }

  /// Which km to use: the road km, unless it looks wrong compared with the GPS (then GPS).
  /// [directM] = straight line from pick-up to drop-off.
  static double pick({required double gpsM, required double? roadM, required double directM}) {
    if (roadM == null || roadM <= 0) return gpsM;
    if (roadM < directM * 0.95) return gpsM; // can't be shorter than the straight line
    if (gpsM > 1000 && roadM > gpsM * 2.2) return gpsM; // matcher went badly off
    return roadM;
  }
}
