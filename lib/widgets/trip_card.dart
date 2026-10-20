import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/theme.dart';
import '../core/utils.dart';
import '../models/models.dart';
import '../services/db.dart';
import '../services/location_service.dart';
import '../services/trip_service.dart';
import 'tiles.dart';

/// Driver trips on the home screen: Start trip / Stop trip, live km, today's trips.
class TripCard extends StatefulWidget {
  final AppUser me;
  final List<Site> sites;
  const TripCard({super.key, required this.me, required this.sites});

  @override
  State<TripCard> createState() => _TripCardState();
}

class _TripCardState extends State<TripCard> {
  Trip? _active;
  List<Trip> _today = [];
  bool _busy = false;
  final List<StreamSubscription> _subs = [];
  String _day = dateKey(DateTime.now());
  Timer? _dayTimer;
  double _rate = 0;

  @override
  void initState() {
    super.initState();
    _listen();
    Db.tripRate(widget.me).then((r) {
      if (mounted) setState(() => _rate = r);
    });
    _dayTimer = Timer.periodic(const Duration(minutes: 1), (_) {
      final k = dateKey(DateTime.now());
      if (k != _day) {
        _day = k;
        _listen();
      }
    });
  }

  void _listen() {
    for (final s in _subs) {
      s.cancel();
    }
    _subs
      ..clear()
      ..add(Db.activeTrip(widget.me.id).listen((t) {
        if (!mounted) return;
        setState(() => _active = t);
        if (t != null) TripService.instance.resume(t);
      }, onError: (_) {}))
      ..add(Db.tripsForDay(widget.me.id, _day).listen((l) {
        if (mounted) setState(() => _today = l.where((t) => !t.isActive).toList());
      }, onError: (_) {}));
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    _dayTimer?.cancel();
    super.dispose();
  }

  Future<void> _start() async {
    final vehicle = TextEditingController(text: widget.me.vehicle);
    final purpose = TextEditingController();
    const presets = ['Pick up workers', 'Drop workers', 'Material delivery', 'Site visit', 'Office'];
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, set) => AlertDialog(
          title: const Text('Start trip'),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              TextField(
                controller: vehicle,
                textCapitalization: TextCapitalization.characters,
                decoration: const InputDecoration(labelText: 'Vehicle / plate no.', prefixIcon: Icon(Icons.directions_car)),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: purpose,
                decoration: const InputDecoration(labelText: 'Purpose', prefixIcon: Icon(Icons.flag_outlined)),
              ),
              const SizedBox(height: 8),
              Wrap(spacing: 6, runSpacing: 6, children: [
                for (final p in presets)
                  ActionChip(label: Text(p), onPressed: () => set(() => purpose.text = p)),
              ]),
              const SizedBox(height: 10),
              const Text('Distance is measured by GPS until you tap Stop trip. Keep location on.',
                  style: TextStyle(fontSize: 12, color: AppColors.muted)),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('START')),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await TripService.instance.start(
        user: widget.me,
        vehicle: vehicle.text.trim(),
        purpose: purpose.text.trim(),
        sites: widget.sites,
      );
      if (mounted) showSnack(context, 'Trip started — drive safe.');
    } on LocationException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } catch (e) {
      if (mounted) showSnack(context, 'Could not start trip: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  double _estimate() => (TripService.instance.distance.value / 1000 * _rate * 100).round() / 100;

  /// During the trip: enter (or change) the cost now.
  Future<void> _enterCost(Trip t) async {
    final v = await askTripCost(context,
        initial: t.costEntered ? t.cost : _estimate(), km: TripService.instance.distance.value / 1000, rate: _rate);
    if (v == null) return;
    try {
      await Db.setTripCost(t.id, v);
      if (mounted) showSnack(context, 'Cost saved: ${fmtMoney(v)}');
    } catch (e) {
      if (mounted) showSnack(context, 'Could not save cost: $e', error: true);
    }
  }

  Future<void> _stop(Trip t) async {
    // End of trip: confirm the cost (km × rate filled in, or what was entered during the trip).
    final cost = await askTripCost(context,
        title: 'End trip — cost',
        okLabel: 'SAVE & END TRIP',
        initial: t.costEntered ? t.cost : _estimate(),
        km: TripService.instance.distance.value / 1000,
        rate: _rate);
    if (cost == null) return;
    setState(() => _busy = true);
    try {
      await TripService.instance.stop(user: widget.me, trip: t, sites: widget.sites, fare: cost);
      if (mounted) showSnack(context, 'Trip saved: ${fmtDistance(TripService.instance.distance.value)} · ${fmtMoney(cost)}');
    } catch (e) {
      if (mounted) showSnack(context, 'Could not stop trip: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = _active;
    final km = _today.fold<double>(0, (a, x) => a + x.km);
    final cost = _today.fold<double>(0, (a, x) => a + (x.cost ?? 0));
    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: t != null ? AppColors.success : const Color(0xFFEAE7E1), width: t != null ? 2 : 1),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: (t != null ? AppColors.success : AppColors.info).withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(Icons.local_shipping_outlined, color: t != null ? AppColors.success : AppColors.info),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(t != null ? 'Trip in progress' : 'Driver trips',
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15.5)),
                Text(
                  t != null
                      ? 'From ${t.startSiteName.isNotEmpty ? t.startSiteName : 'GPS location'} · ${fmtTime(t.startLocal)}'
                      : 'Today: ${_today.length} trip${_today.length == 1 ? '' : 's'} · ${km.toStringAsFixed(1)} km${cost > 0 ? ' · ${fmtMoney(cost)}' : ''}',
                  style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
                ),
              ]),
            ),
          ]),
          if (t != null) ...[
            const SizedBox(height: 12),
            Row(children: [
              Expanded(
                child: _metric(
                  'Distance',
                  ValueListenableBuilder<double>(
                    valueListenable: TripService.instance.distance,
                    builder: (_, m, __) => Text('${(m / 1000).toStringAsFixed(2)} km', style: _big),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(child: _metric('Time', LiveTimer(since: t.startAt, style: _big))),
              const SizedBox(width: 8),
              Expanded(
                child: InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: () => _enterCost(t),
                  child: _metric(
                    t.costEntered ? 'Cost ✎' : 'Cost (est.) ✎',
                    t.costEntered
                        ? Text(fmtMoney(t.cost ?? 0), style: _big)
                        : ValueListenableBuilder<double>(
                            valueListenable: TripService.instance.distance,
                            builder: (_, m, __) => Text(fmtMoney((m / 1000 * _rate * 100).round() / 100), style: _big),
                          ),
                  ),
                ),
              ),
            ]),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: () => _enterCost(t),
                icon: const Icon(Icons.edit_outlined, size: 18),
                label: Text(t.costEntered ? 'Change cost' : 'Enter cost now'),
              ),
            ),
            if (t.vehicle.isNotEmpty || t.purpose.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text([t.vehicle, t.purpose].where((x) => x.isNotEmpty).join(' · '),
                    style: const TextStyle(fontSize: 12.5)),
              ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              height: 50,
              child: FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
                onPressed: _busy ? null : () => _stop(t),
                icon: const Icon(Icons.stop_circle_outlined),
                label: const Text('STOP TRIP', style: TextStyle(fontWeight: FontWeight.w800, letterSpacing: 1)),
              ),
            ),
          ] else ...[
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              height: 50,
              child: FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: AppColors.info),
                onPressed: _busy ? null : _start,
                icon: const Icon(Icons.play_circle_outline),
                label: const Text('START TRIP', style: TextStyle(fontWeight: FontWeight.w800, letterSpacing: 1)),
              ),
            ),
          ],
          if (_today.isNotEmpty) ...[
            const SizedBox(height: 8),
            for (final x in _today.take(5))
              InkWell(
                onTap: x.isRide ? null : () => editTripCost(context, x),
                child: Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Row(children: [
                  const Icon(Icons.route, size: 16, color: AppColors.muted),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      '${fmtTime(x.startLocal)} ${x.startSiteName.isNotEmpty ? x.startSiteName : 'GPS'} → ${x.endSiteName.isNotEmpty ? x.endSiteName : 'GPS'}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12.5),
                    ),
                  ),
                  Text('${x.km.toStringAsFixed(1)} km${x.cost != null ? ' · ${fmtMoney(x.cost!)}' : ''}',
                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                ]),
              ),
              ),
          ],
        ]),
      ),
    );
  }

  static const _big = TextStyle(fontSize: 19, fontWeight: FontWeight.w800, fontFeatures: [FontFeature.tabularFigures()]);

  Widget _metric(String label, Widget value) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(12)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
          value,
        ]),
      );
}

/// Asks the driver for a trip cost. Returns null if cancelled.
Future<double?> askTripCost(BuildContext context,
    {double? initial, double? km, double? rate, String title = 'Trip cost', String okLabel = 'SAVE'}) {
  final ctrl = TextEditingController(text: initial == null || initial == 0 ? '' : initial.toStringAsFixed(2));
  String? err;
  return showDialog<double>(
    context: context,
    builder: (c) => StatefulBuilder(
      builder: (c, set) => AlertDialog(
        title: Text(title),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (km != null)
            Text(
                '${km.toStringAsFixed(1)} km'
                '${rate != null && rate > 0 ? ' × ${fmtMoney(rate)}/km = ${fmtMoney((km * rate * 100).round() / 100)}' : ''}',
                style: const TextStyle(color: AppColors.muted, fontSize: 13)),
          const SizedBox(height: 12),
          TextField(
            controller: ctrl,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
            decoration: InputDecoration(labelText: 'Cost ($kCurrency)', prefixIcon: const Icon(Icons.payments_outlined), errorText: err),
          ),
          const SizedBox(height: 6),
          const Text('You can change it later from your trip list.', style: TextStyle(color: AppColors.muted, fontSize: 12)),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              final v = double.tryParse(ctrl.text.trim());
              if (v == null || v < 0) {
                set(() => err = 'Enter the cost');
                return;
              }
              Navigator.pop(c, v);
            },
            child: Text(okLabel),
          ),
        ],
      ),
    ),
  );
}

/// Change the cost of a finished trip.
Future<void> editTripCost(BuildContext context, Trip t) async {
  final v = await askTripCost(context, initial: t.cost, km: t.km, rate: t.ratePerKm, title: 'Edit trip cost');
  if (v == null) return;
  try {
    await Db.setTripCost(t.id, v);
    if (context.mounted) showSnack(context, 'Cost updated: ${fmtMoney(v)}');
  } catch (e) {
    if (context.mounted) showSnack(context, 'Could not update: $e', error: true);
  }
}
