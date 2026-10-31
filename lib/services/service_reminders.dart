import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

import '../core/utils.dart';
import 'service_desk.dart';

/// Phone reminders for service visits assigned to me: the evening before (6 pm) and one hour before.
/// Scheduled on the phone, so they arrive even when the app is closed.
class ServiceReminders {
  ServiceReminders._();
  static final _p = FlutterLocalNotificationsPlugin();
  static bool _ready = false;
  static String _lastKey = '';

  static const _details = NotificationDetails(
    android: AndroidNotificationDetails(
      'svc_visits',
      'Service visits',
      channelDescription: 'Reminders for service visits assigned to you',
      importance: Importance.high,
      priority: Priority.high,
    ),
  );

  static Future<void> _init() async {
    if (_ready) return;
    tzdata.initializeTimeZones(); // times are absolute instants, so the UTC default is fine
    await _p.initialize(const InitializationSettings(android: AndroidInitializationSettings('@mipmap/ic_launcher')));
    await _p.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()?.requestNotificationsPermission();
    _ready = true;
  }

  static int _id(String ticketId, int k) => ((ticketId.hashCode & 0x0fffffff) << 2) + k;

  /// Keeps the phone's reminders in step with my open jobs.
  static Future<void> sync(List<ServiceTicket> mine) async {
    try {
      final now = DateTime.now();
      final plan = <int, (DateTime, String, String, String)>{};
      for (final t in mine) {
        final at = t.scheduledAt;
        if (at == null || !t.open || t.status == 'completed') continue;
        final where = '${t.clientName} – ${t.siteName}';
        final eve = DateTime(at.year, at.month, at.day - 1, 18);
        if (eve.isAfter(now)) {
          plan[_id(t.id, 1)] = (eve, 'Tomorrow at ${fmtTime(at)}: service visit', '$where\n${t.shortText}\nYou are responsible for this visit — please attend on time.', t.id);
        }
        final hour = at.subtract(const Duration(hours: 1));
        if (hour.isAfter(now)) {
          plan[_id(t.id, 2)] = (hour, 'Service visit in 1 hour (${fmtTime(at)})', '$where\n${t.shortText}', t.id);
        }
      }
      final key = plan.entries.map((e) => '${e.key}@${e.value.$1.millisecondsSinceEpoch}').join(',');
      if (key == _lastKey) return;
      await _init();
      final pending = await _p.pendingNotificationRequests();
      for (final r in pending) {
        if ((r.payload ?? '').startsWith('svc:') && !plan.containsKey(r.id)) await _p.cancel(r.id);
      }
      for (final e in plan.entries) {
        await _p.zonedSchedule(
          e.key,
          e.value.$2,
          e.value.$3,
          tz.TZDateTime.from(e.value.$1, tz.local),
          _details,
          androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
          uiLocalNotificationDateInterpretation: UILocalNotificationDateInterpretation.absoluteTime,
          payload: 'svc:${e.value.$4}',
        );
      }
      _lastKey = key;
    } catch (e) {
      debugPrint('service reminders: $e');
    }
  }

  /// Immediate notification (e.g. a job was just assigned to me).
  static Future<void> now(String title, String body, String ticketId) async {
    try {
      await _init();
      await _p.show(_id(ticketId, 3), title, body, _details, payload: 'svc:$ticketId');
    } catch (e) {
      debugPrint('service notify: $e');
    }
  }
}
