import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/theme.dart';
import '../core/utils.dart';
import '../models/models.dart';
import '../services/db.dart';
import '../services/location_service.dart';
import '../services/photo_service.dart';
import '../services/trip_service.dart';
import 'common.dart';
import 'tiles.dart';
import 'trip_card.dart' show kDialogButton, TripCard, startDriverTrip;

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

  /// Staff + driver profile: "Are you the driver?" — yes starts his own driver trip, no goes on to the ride choices.
  Future<bool?> _askDriver() => showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          icon: const Icon(Icons.local_shipping_outlined, color: _rideColor, size: 34),
          title: const Text('Are you the driver?'),
          content: const Text('Yes — you are driving: your own driver trip (km and your charge go to your driver account).\n\n'
              'No — you are a passenger: taxi, RTA or another company driver.'),
          actionsAlignment: MainAxisAlignment.spaceBetween,
          actions: [
            OutlinedButton(onPressed: () => Navigator.pop(c, false), child: const Text('NO, RIDE')),
            FilledButton(
                style: FilledButton.styleFrom(backgroundColor: _rideColor, minimumSize: const Size(120, 44)),
                onPressed: () => Navigator.pop(c, true),
                child: const Text("YES, I'M DRIVING")),
          ],
        ),
      );

  Future<void> _start() async {
    if (widget.me.isDriver) {
      final driving = await _askDriver();
      if (driving == null || !mounted) return;
      if (driving) {
        setState(() => _busy = true);
        try {
          await startDriverTrip(context, widget.me, widget.sites);
        } finally {
          if (mounted) setState(() => _busy = false);
        }
        return;
      }
    }
    if (!mounted) return;
    final choice = await showModalBottomSheet<_RideChoice>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (c) => _RidePicker(),
    );
    if (choice == null || !mounted) return;
    setState(() => _busy = true);
    try {
      // Company driver: the ride is costed at that driver's rate per km.
      final rate = choice.driver == null ? null : await Db.tripRate(choice.driver!);
      await TripService.instance.start(
        user: widget.me,
        vehicle: choice.kind == 'taxi' ? (choice.mode == 'rta' ? 'RTA' : 'Taxi') : (choice.driver?.vehicle ?? ''),
        purpose: '',
        sites: widget.sites,
        kind: choice.kind,
        driver: choice.driver,
        ratePerKm: rate,
        extra: {
          if (choice.kind == 'taxi') 'mode': choice.mode,
          if (choice.actualDriver != null) ...{'byOther': true, 'actualDriver': choice.actualDriver},
        },
      );
      if (mounted) {
        showSnack(
            context,
            choice.kind == 'taxi'
                ? (choice.mode == 'rta' ? 'RTA ride started' : 'Taxi ride started')
                : 'Ride with ${choice.actualDriver ?? choice.driver?.name} started${choice.actualDriver != null ? ' (for ${choice.driver?.name})' : ''}');
      }
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
    String? taxiNo;
    String? receipt;
    if (t.isTaxi) {
      final r = await _askFare(t.isRta);
      if (r == null) return;
      fare = r.fare;
      taxiNo = r.taxiNo.isEmpty ? null : '${t.isRta ? 'RTA' : 'Taxi'} ${r.taxiNo}';
      receipt = r.receipt;
    } else {
      final km = TripService.instance.distance.value / 1000;
      if (!await confirm(
          context,
          'End ride',
          'End this ride with ${t.byOther ? '${t.actualDriver} (for ${t.driverName})' : (t.driverName.isEmpty ? 'the driver' : t.driverName)}?\n\n'
              '${km.toStringAsFixed(1)} km · the driver adds the charge, then admin approves it.',
          ok: 'End ride')) {
        return;
      }
    }
    setState(() => _busy = true);
    try {
      await TripService.instance.stop(user: widget.me, trip: t, sites: widget.sites, fare: fare, vehicle: taxiNo, receipt: receipt);
      if (mounted) showSnack(context, fare != null ? 'Ride saved · ${fmtMoney(fare)} added to your petty cash (waiting for approval)' : 'Ride saved');
    } catch (e) {
      if (mounted) showSnack(context, 'Could not end ride: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<({double fare, String taxiNo, String? receipt})?> _askFare(bool rta) async {
    final ctrl = TextEditingController();
    final taxi = TextEditingController();
    String? err;
    String? photo;
    return showDialog<({double fare, String taxiNo, String? receipt})>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, set) => AlertDialog(
          title: Text(rta ? 'RTA fare (metro / bus)' : 'Taxi fare'),
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
            const SizedBox(height: 10),
            TextField(
              controller: taxi,
              textCapitalization: TextCapitalization.characters,
              decoration: InputDecoration(
                  labelText: rta ? 'Line / route (optional)' : 'Taxi no. / company (optional)',
                  hintText: rta ? 'e.g. Red line, bus 27' : 'e.g. DXB T 12345, Careem',
                  prefixIcon: Icon(rta ? Icons.directions_subway_outlined : Icons.local_taxi_outlined)),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: () async {
                try {
                  final b = await PhotoService.pick();
                  if (b != null) set(() => photo = b);
                } catch (e) {
                  set(() => err = '$e');
                }
              },
              icon: Icon(photo == null ? Icons.receipt_long_outlined : Icons.check_circle, color: photo == null ? null : AppColors.success),
              label: Text(photo == null ? 'Photo of receipt (optional)' : 'Receipt added — retake'),
            ),
            const SizedBox(height: 6),
            const Text('The fare goes to your petty cash as an expense for approval.', style: TextStyle(fontSize: 12, color: AppColors.muted)),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c), child: const Text('Cancel')),
            FilledButton(
              style: kDialogButton,
              onPressed: () {
                final v = double.tryParse(ctrl.text.trim());
                if (v == null || v <= 0) {
                  set(() => err = 'Enter the fare');
                  return;
                }
                Navigator.pop(c, (fare: v, taxiNo: taxi.text.trim(), receipt: photo));
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
    // Staff + driver driving his own trip: the full driver trip card (km, cost, stop).
    if (t != null && !t.isRide && widget.me.isDriver) return TripCard(me: widget.me, sites: widget.sites);
    if (t == null) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(color: _rideColor.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
                child: const Icon(Icons.local_taxi_outlined, color: _rideColor),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(widget.me.isDriver ? 'Trip — driving or riding' : 'Taxi / RTA / company driver',
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                  const SizedBox(height: 2),
                  Text(widget.me.isDriver ? 'Driving yourself, or taxi / RTA / another driver' : 'Start when you get in, end when you arrive',
                      style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
                ]),
              ),
            ]),
            const SizedBox(height: 12),
            SizedBox(
              height: 48,
              child: FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: _rideColor),
                onPressed: _busy ? null : _start,
                icon: const Icon(Icons.play_arrow_rounded),
                label: Text(widget.me.isDriver ? 'START TRIP' : 'START RIDE', style: const TextStyle(fontWeight: FontWeight.w800, letterSpacing: 0.5)),
              ),
            ),
          ]),
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
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger, minimumSize: const Size(80, 40)),
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
                Text(t.isTaxi ? (t.isRta ? 'RTA ride in progress' : 'Taxi ride in progress') : 'Ride with ${t.byOther ? '${t.actualDriver} (for ${t.driverName})' : (t.driverName.isEmpty ? 'company driver' : t.driverName)}',
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

typedef _RideChoice = ({String kind, String mode, AppUser? driver, String? actualDriver});

/// Taxi / RTA (paid by the employee → petty cash), or a company driver / transport provider
/// (charged on their account) — who may have sent someone else.
class _RidePicker extends StatefulWidget {
  @override
  State<_RidePicker> createState() => _RidePickerState();
}

class _RidePickerState extends State<_RidePicker> {
  bool _drivers = false;

  Future<void> _who(AppUser d) async {
    final ctrl = TextEditingController();
    final r = await showDialog<String?>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, set) => AlertDialog(
          title: const Text('Who is driving?'),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            FilledButton.icon(
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
              onPressed: () => Navigator.pop(c, ''),
              icon: const Icon(Icons.person),
              label: Text('${d.name} himself'),
            ),
            const SizedBox(height: 14),
            Text('Someone else sent by ${d.name.split(' ').first}:', style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            TextField(
              controller: ctrl,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(labelText: "Driver's name (and car no.)", prefixIcon: Icon(Icons.badge_outlined)),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(44)),
              onPressed: () {
                if (ctrl.text.trim().isEmpty) return;
                Navigator.pop(c, ctrl.text.trim());
              },
              child: Text('Other driver — charge to ${d.name.split(' ').first}'),
            ),
          ]),
        ),
      ),
    );
    if (r == null || !mounted) return;
    Navigator.pop(context, (kind: 'withDriver', mode: '', driver: d, actualDriver: r.isEmpty ? null : r));
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: !_drivers
            ? Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                const Text('How are you travelling?', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                const SizedBox(height: 14),
                _option(Icons.directions_car, 'Company driver / transport provider', 'Choose the driver — the trip is charged on their account',
                    () => setState(() => _drivers = true)),
                const SizedBox(height: 10),
                _option(Icons.local_taxi, 'Taxi', 'You pay — enter the fare when you arrive (goes to your petty cash)',
                    () => Navigator.pop(context, (kind: 'taxi', mode: 'taxi', driver: null, actualDriver: null))),
                const SizedBox(height: 10),
                _option(Icons.directions_subway, 'RTA metro / bus', 'You pay — enter the fare when you arrive (goes to your petty cash)',
                    () => Navigator.pop(context, (kind: 'taxi', mode: 'rta', driver: null, actualDriver: null))),
              ])
            : ConstrainedBox(
                constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.6),
                child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Row(children: [
                    IconButton(onPressed: () => setState(() => _drivers = false), icon: const Icon(Icons.arrow_back)),
                    const Text('Choose the driver / provider', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
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
                        final list = s.data!.where((d) => d.id != CurrentUser.me?.id).toList();
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
                              onTap: () => _who(d),
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
