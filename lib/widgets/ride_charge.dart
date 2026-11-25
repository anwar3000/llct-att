import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/theme.dart';
import '../core/utils.dart';
import '../models/models.dart';
import '../services/db.dart';
import 'common.dart';
import 'trip_card.dart' show kDialogButton;

/// Two trips overlap in time (10 minutes either side allowed) → same car journey.
bool tripsOverlap(Trip a, Trip b) {
  const slack = Duration(minutes: 10);
  final ae = a.endAt ?? a.startAt, be = b.endAt ?? b.startAt;
  return !a.startAt.isAfter(be.add(slack)) && !b.startAt.isAfter(ae.add(slack));
}

String tripRoute(Trip t) =>
    '${t.startSiteName.isEmpty ? 'GPS' : t.startSiteName} → ${t.endSiteName.isEmpty ? 'GPS' : t.endSiteName}';

/// Small coloured approval label.
Widget approvalPill(Trip t) {
  final (txt, c) = t.isApproved
      ? ('Approved', AppColors.success)
      : t.isRejected
          ? ('Rejected', AppColors.danger)
          : ('Unapproved', AppColors.warning);
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
    decoration: BoxDecoration(color: c.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(6)),
    child: Text(txt, style: TextStyle(color: c, fontSize: 10.5, fontWeight: FontWeight.w800)),
  );
}

/// The driver / transport provider (or admin) adds the charge for a staff ride.
/// Other staff rides of the same car journey are linked to it (charged once); if the driver recorded the
/// journey as his own trip, the ride is linked to that trip instead.
Future<void> chargeRideDialog(BuildContext context, Trip ride,
    {required List<Trip> rides, List<Trip> ownTrips = const [], required String by}) async {
  final same = rides.where((r) => r.id != ride.id && r.driverId == ride.driverId && r.needsCharge && tripsOverlap(r, ride)).toList();
  final own = ownTrips.where((t) => !t.isActive && tripsOverlap(t, ride)).toList();
  final pick = {for (final r in same) r.id: true};
  final amount = TextEditingController(text: ride.costEntered && (ride.cost ?? 0) > 0 ? ride.cost!.toStringAsFixed(2) : '');
  final note = TextEditingController(text: ride.costNote);
  final who = TextEditingController(text: ride.actualDriver);
  String? err;
  var busy = false;
  var saved = false;
  await showDialog<void>(
    context: context,
    builder: (c) => StatefulBuilder(
      builder: (c, set) => AlertDialog(
        title: const Text('Charge for this trip'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tripRoute(ride), style: const TextStyle(fontWeight: FontWeight.w800)),
            Text('${fmtDate(ride.startLocal)} · ${fmtTime(ride.startLocal)}–${ride.endLocal == null ? '…' : fmtTime(ride.endLocal!)} · ${ride.km.toStringAsFixed(1)} km',
                style: const TextStyle(color: AppColors.muted, fontSize: 12.5)),
            Text('Staff: ${ride.employeeName}', style: const TextStyle(fontSize: 12.5)),
            if (own.isNotEmpty) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: const Color(0xFFEAF3FF), borderRadius: BorderRadius.circular(10)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text('You recorded a trip at the same time (${fmtTime(own.first.startLocal)}, ${tripRoute(own.first)}).',
                      style: const TextStyle(fontSize: 12.5)),
                  TextButton(
                    onPressed: busy
                        ? null
                        : () async {
                            set(() => busy = true);
                            try {
                              await Db.linkRideToTrip(ride, own.first.id, by: by);
                              saved = true;
                              if (c.mounted) Navigator.pop(c);
                            } catch (e) {
                              set(() {
                                busy = false;
                                err = '$e';
                              });
                            }
                          },
                    child: const Text('Already in my trip — no extra charge'),
                  ),
                ]),
              ),
            ],
            const SizedBox(height: 12),
            TextField(
              controller: amount,
              autofocus: own.isEmpty,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
              decoration: InputDecoration(labelText: 'Charge ($kCurrency)', prefixIcon: const Icon(Icons.payments_outlined), errorText: err),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: who,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                  labelText: 'Driven by someone else? Name (optional)', prefixIcon: Icon(Icons.badge_outlined)),
            ),
            const SizedBox(height: 8),
            TextField(controller: note, decoration: const InputDecoration(labelText: 'Note (optional)', prefixIcon: Icon(Icons.notes))),
            if (same.isNotEmpty) ...[
              const SizedBox(height: 12),
              const Text('Same car journey — charged once:', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
              for (final r in same)
                CheckboxListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  value: pick[r.id],
                  onChanged: (v) => set(() => pick[r.id] = v ?? false),
                  title: Text(r.employeeName, style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text('${fmtTime(r.startLocal)} · ${tripRoute(r)}', maxLines: 1, overflow: TextOverflow.ellipsis),
                ),
            ],
            const SizedBox(height: 6),
            const Text('Admin approves the charge before it counts in your balance.', style: TextStyle(fontSize: 12, color: AppColors.muted)),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: const Text('Cancel')),
          FilledButton(
            style: kDialogButton,
            onPressed: busy
                ? null
                : () async {
                    final v = double.tryParse(amount.text.trim());
                    if (v == null || v < 0) {
                      set(() => err = 'Enter the charge');
                      return;
                    }
                    set(() => busy = true);
                    try {
                      await Db.chargeRide(ride, v,
                          note: note.text.trim(),
                          grouped: same.where((r) => pick[r.id] == true).toList(),
                          by: by,
                          actualDriver: who.text.trim().isEmpty ? null : who.text.trim());
                      saved = true;
                      if (c.mounted) Navigator.pop(c);
                    } catch (e) {
                      set(() {
                        busy = false;
                        err = 'Could not save: $e';
                      });
                    }
                  },
            child: const Text('SAVE'),
          ),
        ],
      ),
    ),
  );
  if (saved && context.mounted) showSnack(context, 'Saved — waiting for admin approval');
}
