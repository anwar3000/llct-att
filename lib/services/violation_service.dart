import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

import '../core/utils.dart';
import '../models/models.dart';

/// GPS "no activity" rules:
///  * checked in and no GPS location for an hour or more → one violation per full hour;
///  * a working day with more than [kMaxDailyViolations] violations → the next check-in is
///    allowed but carries a violation mark;
///  * if that happens again (two working days in a row) → check-in is blocked and admin is
///    flagged, until admin taps "Allow check-in".
class ViolationService {
  ViolationService._();

  static const kNoGpsMinutes = 60;
  static const kMaxDailyViolations = 5;

  static final _fs = FirebaseFirestore.instance;
  static CollectionReference<Map<String, dynamic>> get _alerts => _fs.collection('alerts');

  /// Last check-in event shown as an in-app popup (set when this phone records a violation).
  static final ValueNotifier<int> recorded = ValueNotifier(0);

  /// Records "no activity" for a gap with no GPS since [gapStart]. One alert per full hour, with
  /// stable IDs so the same gap is never counted twice (by this phone or another).
  static Future<int> recordGap({
    required String uid,
    required String name,
    required AttendanceSession session,
    required DateTime gapStart,
  }) async {
    final now = DateTime.now();
    final start = gapStart.isBefore(session.checkIn) ? session.checkIn : gapStart;
    final hours = now.difference(start).inMinutes ~/ kNoGpsMinutes;
    if (hours < 1) return 0;
    final bucket = start.millisecondsSinceEpoch ~/ 600000; // 10-minute bucket: same gap → same IDs
    var added = 0;
    for (var n = 1; n <= hours && n <= 24; n++) {
      final ref = _alerts.doc('${session.id}_na_${bucket}_$n');
      try {
        // Create only: if this hour was already recorded, the rules reject the overwrite.
        final at = start.add(Duration(minutes: kNoGpsMinutes * n));
        await ref.set({
          'employeeId': uid,
          'employeeName': name,
          'siteId': session.siteId,
          'siteName': session.siteName,
          'sessionId': session.id,
          'type': 'no_activity',
          'fromAt': Timestamp.fromDate(start),
          'minutes': kNoGpsMinutes * n,
          'date': dateKey(at),
          'month': monthKey(at),
          'at': Timestamp.fromDate(at),
          'tz': now.timeZoneOffset.inMinutes,
          'resolved': false,
        });
        added++;
      } catch (_) {
        // already recorded (or offline) — fine
      }
    }
    if (added > 0) recorded.value++;
    return added;
  }

  /// Decides whether this employee may check in today.
  static Future<({bool blocked, bool mark, int lastCount, String lastDate})> gate(AppUser u) async {
    final now = DateTime.now();
    final today = dateKey(now);
    final months = {monthKey(now), monthKey(DateTime(now.year, now.month - 1, 1))};
    final dates = <String>{};
    for (final m in months) {
      final q = await _fs
          .collection('attendance')
          .where('employeeId', isEqualTo: u.id)
          .where('month', isEqualTo: m)
          .get();
      for (final d in q.docs) {
        final k = d.data()['date'];
        if (k is String && k.compareTo(today) < 0) dates.add(k);
      }
    }
    final last = dates.toList()..sort((a, b) => b.compareTo(a));
    if (last.isEmpty) return (blocked: false, mark: false, lastCount: 0, lastDate: '');
    final check = last.take(2).toList();
    final q = await _alerts.where('employeeId', isEqualTo: u.id).where('date', whereIn: check).get();
    final count = <String, int>{};
    for (final d in q.docs) {
      final a = GeoAlert.fromDoc(d);
      if (!a.isGpsViolation) continue;
      if (u.violationsClearedAt != null && a.at != null && !a.at!.isAfter(u.violationsClearedAt!)) continue;
      final k = d.data()['date'] as String? ?? '';
      count[k] = (count[k] ?? 0) + 1;
    }
    bool over(String d) => (count[d] ?? 0) > kMaxDailyViolations;
    final c1 = count[check.first] ?? 0;
    if (over(check.first) && check.length > 1 && over(check[1])) {
      return (blocked: true, mark: true, lastCount: c1, lastDate: check.first);
    }
    return (blocked: false, mark: over(check.first), lastCount: c1, lastDate: check.first);
  }

  /// Flags admin when a blocked employee tries to check in (once per day).
  static Future<void> recordBlocked(AppUser u, int count, String lastDate) async {
    final now = DateTime.now();
    final ref = _alerts.doc('${u.id}_blocked_${dateKey(now)}');
    try {
      await ref.set({
        'employeeId': u.id,
        'employeeName': u.name,
        'siteId': '',
        'siteName': '',
        'sessionId': '',
        'type': 'checkin_blocked',
        'minutes': 0,
        'note': '$count GPS violations on $lastDate (and the working day before)',
        'date': dateKey(now),
        'month': monthKey(now),
        'at': FieldValue.serverTimestamp(),
        'tz': now.timeZoneOffset.inMinutes,
        'resolved': false,
      });
    } catch (e) {
      debugPrint('blocked alert failed: $e');
    }
  }
}
