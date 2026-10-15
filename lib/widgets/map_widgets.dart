import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../core/theme.dart';
import '../core/utils.dart';
import '../models/models.dart';

/// Must match your Android applicationId (OpenStreetMap tile usage policy).
const kAppPackage = 'com.attendancepro.attendance_pro';

/// Fallback map centre (India) when there is nothing to show yet.
final kDefaultCenter = LatLng(20.5937, 78.9629);

TileLayer osmTiles() => TileLayer(
      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      userAgentPackageName: kAppPackage,
      maxZoom: 19,
    );

Widget osmAttribution() => const RichAttributionWidget(
      attributions: [TextSourceAttribution('OpenStreetMap contributors')],
    );

CircleMarker siteCircle(Site s) => CircleMarker(
      point: LatLng(s.lat, s.lng),
      radius: s.radius,
      useRadiusInMeter: true,
      color: AppColors.primary.withValues(alpha: 0.10),
      borderColor: AppColors.primary.withValues(alpha: 0.6),
      borderStrokeWidth: 1.5,
    );

Marker siteMarker(Site s, {VoidCallback? onTap}) => Marker(
      point: LatLng(s.lat, s.lng),
      width: 140,
      height: 44,
      child: GestureDetector(
        onTap: onTap,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(6),
              boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 3)],
            ),
            child: Text(s.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    fontSize: 10.5, fontWeight: FontWeight.w700, color: AppColors.primary)),
          ),
          const Icon(Icons.location_city, size: 20, color: AppColors.primary),
        ]),
      ),
    );

/// Round avatar pin for an employee's live location.
Marker employeeMarker(AppUser u, LiveLocation loc, {VoidCallback? onTap}) {
  final live = loc.checkedIn && loc.isFresh;
  final color = live
      ? AppColors.success
      : (loc.checkedIn ? AppColors.warning : AppColors.muted);
  return Marker(
    point: LatLng(loc.lat, loc.lng),
    width: 120,
    height: 66,
    alignment: Alignment.topCenter,
    child: GestureDetector(
      onTap: onTap,
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Container(
          width: 38,
          height: 38,
          decoration: BoxDecoration(
            color: color,
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white, width: 3),
            boxShadow: const [BoxShadow(color: Colors.black38, blurRadius: 4)],
          ),
          alignment: Alignment.center,
          child: Text(initials(u.name),
              style: const TextStyle(
                  color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13)),
        ),
        const SizedBox(height: 2),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.92),
            borderRadius: BorderRadius.circular(5),
          ),
          child: Text(u.name.split(' ').first,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700)),
        ),
      ]),
    ),
  );
}

/// Map location picker used by the site editor.
class LocationPicker extends StatefulWidget {
  final LatLng? initial;
  final double radius;
  final ValueChanged<LatLng> onPicked;
  const LocationPicker({super.key, this.initial, required this.radius, required this.onPicked});

  @override
  State<LocationPicker> createState() => LocationPickerState();
}

class LocationPickerState extends State<LocationPicker> {
  final _map = MapController();
  LatLng? _point;
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    _point = widget.initial;
  }

  void moveTo(LatLng p) {
    setState(() => _point = p);
    if (_ready) _map.move(p, 17);
  }

  @override
  Widget build(BuildContext context) {
    final p = _point;
    return ClipRRect(
      borderRadius: BorderRadius.circular(14),
      child: SizedBox(
        height: 260,
        child: FlutterMap(
          mapController: _map,
          options: MapOptions(
            initialCenter: p ?? kDefaultCenter,
            initialZoom: p == null ? 4 : 17,
            onMapReady: () => _ready = true,
            onTap: (_, latLng) {
              setState(() => _point = latLng);
              widget.onPicked(latLng);
            },
          ),
          children: [
            osmTiles(),
            if (p != null)
              CircleLayer(circles: [
                CircleMarker(
                  point: p,
                  radius: widget.radius,
                  useRadiusInMeter: true,
                  color: AppColors.primary.withValues(alpha: 0.15),
                  borderColor: AppColors.primary,
                  borderStrokeWidth: 2,
                ),
              ]),
            if (p != null)
              MarkerLayer(markers: [
                Marker(
                  point: p,
                  width: 40,
                  height: 40,
                  alignment: Alignment.topCenter,
                  child: const Icon(Icons.location_on, size: 40, color: AppColors.danger),
                ),
              ]),
            osmAttribution(),
          ],
        ),
      ),
    );
  }
}

String latLngLabel(double lat, double lng) =>
    '${lat.toStringAsFixed(5)}, ${lng.toStringAsFixed(5)}';

String lastSeenLabel(LiveLocation? l) =>
    l == null ? 'No location yet' : 'Updated ${timeAgo(l.at)} · ±${(l.accuracy ?? 0).round()} m';
