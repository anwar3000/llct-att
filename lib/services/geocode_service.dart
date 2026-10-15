import 'dart:convert';
import 'dart:io';

/// Free address search (OpenStreetMap / Photon) — no API key needed.
class PlaceResult {
  final String title;
  final String subtitle;
  final double lat;
  final double lng;
  PlaceResult(this.title, this.subtitle, this.lat, this.lng);
  String get label => subtitle.isEmpty ? title : '$title, $subtitle';
}

class GeocodeService {
  GeocodeService._();

  /// Pasted Google Maps link or "lat, lng" → coordinates.
  static (double, double)? parseCoords(String text) {
    final t = text.trim();
    final pats = [
      RegExp(r'!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)'),
      RegExp(r'@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)'),
      RegExp(r'[?&](?:q|query|ll|destination)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)'),
      RegExp(r'^(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)$'),
    ];
    for (final p in pats) {
      final m = p.firstMatch(t);
      if (m != null) {
        final lat = double.parse(m.group(1)!), lng = double.parse(m.group(2)!);
        if (lat.abs() <= 90 && lng.abs() <= 180) return (lat, lng);
      }
    }
    return null;
  }

  static Future<List<PlaceResult>> search(String query, {double? nearLat, double? nearLng}) async {
    final q = query.trim();
    if (q.isEmpty) return [];
    final c = parseCoords(q);
    if (c != null) {
      return [PlaceResult('Pinned location', '${c.$1.toStringAsFixed(6)}, ${c.$2.toStringAsFixed(6)}', c.$1, c.$2)];
    }
    final bias = nearLat != null ? '&lat=$nearLat&lon=$nearLng' : '&lat=20.6&lon=78.9';
    final uri = Uri.parse('https://photon.komoot.io/api/?q=${Uri.encodeQueryComponent(q)}&limit=8&lang=en$bias');
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 10);
    try {
      final req = await client.getUrl(uri);
      req.headers.set(HttpHeaders.userAgentHeader, 'LLCT-Attendance/1.0');
      final res = await req.close().timeout(const Duration(seconds: 15));
      final body = await res.transform(utf8.decoder).join();
      final data = jsonDecode(body) as Map<String, dynamic>;
      final out = <PlaceResult>[];
      for (final f in (data['features'] as List? ?? [])) {
        final p = (f['properties'] as Map?) ?? {};
        final coords = (f['geometry']?['coordinates'] as List?) ?? [];
        if (coords.length < 2) continue;
        final title = (p['name'] ??
                [p['housenumber'], p['street']].where((e) => e != null).join(' '))
            .toString();
        if (title.trim().isEmpty) continue;
        final sub = <String>{
          for (final k in ['street', 'district', 'city', 'state', 'country'])
            if (p[k] != null && p[k].toString() != title) p[k].toString()
        }.join(', ');
        out.add(PlaceResult(title, sub, (coords[1] as num).toDouble(), (coords[0] as num).toDouble()));
      }
      return out;
    } finally {
      client.close();
    }
  }
}
