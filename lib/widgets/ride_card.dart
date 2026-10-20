import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/theme.dart';
import '../core/utils.dart';
import '../models/models.dart';
import '../services/db.dart';
import '../services/location_service.dart';
import '../services/trip_service.dart';
import 'common.dart';
import 'tiles.dart';

/// Below the check-in card for every employee: start / end a ride by taxi or with a company driver.
/// Employees see only the ride in progress (no history). Taxi fare is entered when the ride ends.
class RideCard extends StatefulWidget {
  final AppUser me;
  final List<Site> sites;
  const RideCard({super.key, required this.me, required this.sites});

  @override
  State<RideCard> createState() => _RideCardState();
}

class _RideCardState extends State<RideCard> {
  Trip? _active;
  bool _busy = false;
  StreamSubscription? _sub;

  static const _rideColor = Color(0xFF7B4FC9);

  @override
  void initState() {
    super.initState();
    _sub = Db.activeTrip(widget.me.id).listen((t) {
      if (!mounted) return;
      setState(() => _active = t);
      if (t != null) TripService.instance.resume(t);
    }, onError: (_) {});
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _start() async {
    final choice = await showModalBottomSheet<({String kind, AppUser? driver})>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (c) => _RidePicker(),
    );
    if (choice == null || !mounted) return;
    setState(() => _busy = true);
    try {
      await TripService.instance.start(
        user: widget.me,
        vehicle: choice.kind == 'taxi' ? 'Taxi' : (choice.driver?.vehicle ?? ''),
        purpose: '',
        sites: widget.sites,
        kind: choice.kind,
        driver: choice.driver,
      );
      if (mounted) showSnack(context, choice.kind == 'taxi' ? 'Taxi ride started' : 'Ride with ${choice.driver?.name} started');
    } on LocationException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } catch (e) {
      if (mounted) showSnack(context, 'Could not start ride: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _end(Trip t) async {
    double? fare;
    if (t.isTaxi) {
      fare = await _askFare();
      if (fare == null) return;
    } else if (!await confirm(context, 'End ride', 'End this ride with ${t.driverName.isEmpty ? 'the driver' : t.driverName}?', ok: 'End ride')) {
      return;
    }
    setState(() => _busy = true);
    try {
      await TripService.instance.stop(user: widget.me, trip: t, sites: widget.sites, fare: fare);
      if (mounted) showSnack(context, 'Ride saved${fare != null ? ' · ${fmtMoney(fare)}' : ''}');
    } catch (e) {
      if (mounted) showSnack(context, 'Could not end ride: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<double?> _askFare() async {
    final ctrl = TextEditingController();
    String? err;
    return showDialog<double>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, set) => AlertDialog(
          title: const Text('Taxi fare'),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            ValueListenableBuilder<double>(
              valueListenable: TripService.instance.distance,
              builder: (_, m, __) => Text('Distance ${(m / 1000).toStringAsFixed(1)} km · enter the amount you paid',
                  style: const TextStyle(color: AppColors.muted, fontSize: 13)),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: ctrl,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
              decoration: InputDecoration(labelText: 'Fare ($kCurrency)', prefixIcon: const Icon(Icons.payments_outlined), errorText: err),
            ),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c), child: const Text('Cancel')),
            FilledButton(
              onPressed: () {
                final v = double.tryParse(ctrl.text.trim());
                if (v == null || v <= 0) {
                  set(() => err = 'Enter the fare');
                  return;
                }
                Navigator.pop(c, v);
              },
              child: const Text('SAVE & END'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = _active;
    if (t == null) {
      return Card(
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: _busy ? null : _start,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
            child: Row(children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(color: _rideColor.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
                child: const Icon(Icons.local_taxi_outlined, color: _rideColor),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('Taxi / company driver', style: TextStyle(fontWeight: FontWeight.w800)),
                  Text('Start when you get in, end when you arrive', style: TextStyle(fontSize: 12.5, color: AppColors.muted)),
                ]),
              ),
              FilledButton(
                style: FilledButton.styleFrom(backgroundColor: _rideColor),
                onPressed: _busy ? null : _start,
                child: const Text('START RIDE', style: TextStyle(fontWeight: FontWeight.w800)),
              ),
            ]),
          ),
        ),
      );
    }
    if (!t.isRide) {
      // A driver-type trip open on a normal login (e.g. profile changed) — still let them stop it.
      return Card(
        child: ListTile(
          leading: const Icon(Icons.local_shipping, color: _rideColor),
          title: const Text('Trip in progress'),
          trailing: FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: _busy ? null : () => _end(t),
            child: const Text('STOP'),
          ),
        ),
      );
    }
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: _rideColor, width: 2)),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(t.isTaxi ? Icons.local_taxi : Icons.directions_car, color: _rideColor),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(t.isTaxi ? 'Taxi ride in progress' : 'Ride with ${t.driverName.isEmpty ? 'company driver' : t.driverName}',
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                Text('From ${t.startSiteName.isNotEmpty ? t.startSiteName : 'GPS location'} · ${fmtTime(t.startLocal)}',
                    style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
              ]),
            ),
          ]),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(
              child: _metric('Distance', ValueListenableBuilder<double>(
                valueListenable: TripService.instance.distance,
                builder: (_, m, __) => Text('${(m / 1000).toStringAsFixed(1)} km', style: _big),
              )),
            ),
            const SizedBox(width: 8),
            Expanded(child: _metric('Time', LiveTimer(since: t.startAt, style: _big))),
          ]),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
              onPressed: _busy ? null : () => _end(t),
              icon: const Icon(Icons.flag),
              label: Text(t.isTaxi ? 'END RIDE & ENTER FARE' : 'END RIDE', style: const TextStyle(fontWeight: FontWeight.w800)),
            ),
          ),
        ]),
      ),
    );
  }

  static const _big = TextStyle(fontSize: 20, fontWeight: FontWeight.w800, fontFeatures: [FontFeature.tabularFigures()]);

  Widget _metric(String label, Widget value) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(12)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
          value,
        ]),
      );
}

/// Taxi, or pick one of the company drivers.
class _RidePicker extends StatefulWidget {
  @override
  State<_RidePicker> createState() => _RidePickerState();
}

class _RidePickerState extends State<_RidePicker> {
  bool _drivers = false;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: !_drivers
            ? Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                const Text('How are you travelling?', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                const SizedBox(height: 14),
                _option(Icons.local_taxi, 'Taxi', 'Enter the fare when you arrive',
                    () => Navigator.pop(context, (kind: 'taxi', driver: null))),
                const SizedBox(height: 10),
                _option(Icons.directions_car, 'Company driver', 'Choose the driver',
                    () => setState(() => _drivers = true)),
              ])
            : ConstrainedBox(
                constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.6),
                child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Row(children: [
                    IconButton(onPressed: () => setState(() => _drivers = false), icon: const Icon(Icons.arrow_back)),
                    const Text('Choose the driver', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                  ]),
                  Flexible(
                    child: StreamBuilder<List<AppUser>>(
                      stream: Db.driversStream(),
                      builder: (c, s) {
                        if (s.hasError) {
                          return Padding(
                              padding: const EdgeInsets.all(16),
                              child: Text('Could not load drivers: ${s.error}', style: const TextStyle(color: AppColors.danger)));
                        }
                        if (!s.hasData) return const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()));
                        final list = s.data!;
                        if (list.isEmpty) {
                          return const EmptyState(icon: Icons.no_crash_outlined, title: 'No drivers registered', message: 'Ask management to add drivers.');
                        }
                        return ListView(shrinkWrap: true, children: [
                          for (final d in list)
                            ListTile(
                              leading: Avatar(d.name, size: 38),
                              title: Text(d.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                              subtitle: Text([d.vehicle, d.phone].where((x) => x.isNotEmpty).join(' · ')),
                              trailing: const Icon(Icons.chevron_right),
                              onTap: () => Navigator.pop(context, (kind: 'withDriver', driver: d)),
                            ),
                        ]);
                      },
                    ),
                  ),
                ]),
              ),
      ),
    );
  }

  Widget _option(IconData icon, String title, String sub, VoidCallback onTap) => Material(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(children: [
              Icon(icon, size: 34, color: const Color(0xFF7B4FC9)),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(title, style: const TextStyle(fontSize: 16.5, fontWeight: FontWeight.w800)),
                  Text(sub, style: const TextStyle(color: AppColors.muted, fontSize: 12.5)),
                ]),
              ),
              const Icon(Icons.chevron_right),
            ]),
          ),
        ),
      );
}
