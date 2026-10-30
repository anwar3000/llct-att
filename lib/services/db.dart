import 'dart:convert';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/utils.dart';
import '../models/models.dart';

/// All Firestore access lives here.
///
/// Queries deliberately use only equality filters (or a single orderBy) so the
/// app works without creating any composite indexes. Sorting is done on device.
class Db {
  Db._();
  static final _fs = FirebaseFirestore.instance;

  static CollectionReference<Map<String, dynamic>> get users => _fs.collection('users');
  static CollectionReference<Map<String, dynamic>> get sites => _fs.collection('sites');
  static CollectionReference<Map<String, dynamic>> get schedules => _fs.collection('schedules');
  static CollectionReference<Map<String, dynamic>> get attendance => _fs.collection('attendance');
  static CollectionReference<Map<String, dynamic>> get siteUpdates => _fs.collection('siteUpdates');
  static CollectionReference<Map<String, dynamic>> get petty => _fs.collection('petty');
  static CollectionReference<Map<String, dynamic>> get offDays => _fs.collection('offDays');
  static CollectionReference<Map<String, dynamic>> track(String uid) =>
      users.doc(uid).collection('track');

  // ---------------------------------------------------------------- users
  static Stream<AppUser?> userStream(String uid) =>
      users.doc(uid).snapshots().map((d) => d.exists ? AppUser.fromDoc(d) : null);

  static Stream<List<AppUser>> employeesStream() => users.snapshots().map((q) {
        final l = q.docs.map(AppUser.fromDoc).toList()
          ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
        return l;
      });

  static Future<void> updateUser(String uid, Map<String, dynamic> data) =>
      users.doc(uid).set(data, SetOptions(merge: true));

  // ---------------------------------------------------------------- sites
  static Stream<List<Site>> sitesStream({bool activeOnly = false}) =>
      sites.snapshots().map((q) {
        var l = q.docs.map(Site.fromDoc).toList();
        if (activeOnly) l = l.where((s) => s.active).toList();
        l.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
        return l;
      });

  static Future<void> saveSite(Site s) async {
    if (s.id.isEmpty) {
      await sites.add({...s.toMap(), 'createdAt': FieldValue.serverTimestamp()});
    } else {
      await sites.doc(s.id).set(s.toMap(), SetOptions(merge: true));
    }
  }

  static Future<void> deleteSite(String id) => sites.doc(id).delete();

  /// Employee found no registered site where they are working → create one at their GPS spot.
  static CollectionReference<Map<String, dynamic>> get siteKeys => _fs.collection('siteKeys');

  /// ~220 m grid cell used to stop two people adding the same place twice.
  static String _cell(double lat, double lng, [int dy = 0, int dx = 0]) =>
      'g_${(lat / 0.002).floor() + dy}_${(lng / 0.002).floor() + dx}';
  static String _nameKey(String name) => 'n_${name.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '')}';

  /// Adds a site from the field. If someone already added a site at this place
  /// (or with the same name), nothing is created and that existing site is returned
  /// with `existing: true` — the first one submitted wins.
  static Future<({Site site, bool existing})> createSiteByEmployee({
    required AppUser user,
    required String name,
    required String address,
    required double lat,
    required double lng,
  }) {
    final keyRefs = [
      for (var dy = -1; dy <= 1; dy++)
        for (var dx = -1; dx <= 1; dx++) siteKeys.doc(_cell(lat, lng, dy, dx)),
      siteKeys.doc(_nameKey(name)),
    ];
    return _fs.runTransaction<({Site site, bool existing})>((tx) async {
      // 1) read every key (all reads must come before writes)
      final keys = <DocumentSnapshot<Map<String, dynamic>>>[];
      for (final r in keyRefs) {
        keys.add(await tx.get(r));
      }
      for (final k in keys.where((k) => k.exists)) {
        final sid = k.data()?['siteId'];
        if (sid is! String || sid.isEmpty) continue;
        final sd = await tx.get(sites.doc(sid));
        if (!sd.exists) continue;
        final existing = Site.fromDoc(sd);
        if (existing.active && existing.status != 'rejected') return (site: existing, existing: true);
      }
      // 2) nobody has it — create the site and claim this place + name
      final ref = sites.doc();
      final data = {
        'name': name,
        'address': address,
        'lat': lat,
        'lng': lng,
        'radius': kDefaultSiteRadius,
        'active': true,
        'progress': 0,
        'status': 'active',
        'notes': 'Added from the field by ${user.name}',
        'approved': false,
        'createdBy': user.id,
        'createdByName': user.name,
        'addedByEmployee': true,
        'createdAt': FieldValue.serverTimestamp(),
      };
      tx.set(ref, data);
      final claim = {'siteId': ref.id, 'by': user.id, 'at': FieldValue.serverTimestamp()};
      tx.set(siteKeys.doc(_cell(lat, lng)), claim);
      tx.set(siteKeys.doc(_nameKey(name)), claim);
      return (
        site: Site(
          id: ref.id,
          name: name,
          address: address,
          lat: lat,
          lng: lng,
          radius: kDefaultSiteRadius,
          status: 'active',
          notes: 'Added from the field by ${user.name}',
          createdByName: user.name,
          createdBy: user.id,
          approved: false,
        ),
        existing: false,
      );
    });
  }

  static Future<Site?> getSite(String id) async {
    final d = await sites.doc(id).get();
    return d.exists ? Site.fromDoc(d) : null;
  }

  static Future<void> approveSite(String id, bool approve) => sites.doc(id).update(
      approve ? {'approved': true} : {'approved': false, 'active': false, 'status': 'rejected'});

  // --------------------------------------------------------------- alerts
  static CollectionReference<Map<String, dynamic>> get alerts => _fs.collection('alerts');

  static Future<void> addAlert({
    required String uid,
    required String name,
    required AttendanceSession session,
    required String type,
    double? lat,
    double? lng,
    double? distance,
  }) =>
      alerts.add({
        'employeeId': uid,
        'employeeName': name,
        'siteId': session.siteId,
        'siteName': session.siteName,
        'sessionId': session.id,
        'type': type,
        'lat': lat,
        'lng': lng,
        'distance': distance,
        'date': dateKey(DateTime.now()),
        'at': FieldValue.serverTimestamp(),
        'tz': DateTime.now().timeZoneOffset.inMinutes,
        'resolved': false,
      });

  /// One employee's alerts on a day (for the "no activity" popup and the check-out count).
  static Stream<List<GeoAlert>> alertsForEmployeeDay(String uid, String date) => alerts
      .where('employeeId', isEqualTo: uid)
      .where('date', isEqualTo: date)
      .snapshots()
      .map((q) => q.docs.map(GeoAlert.fromDoc).toList());

  /// Admin "Allow check-in": earlier GPS violations stop counting towards the block.
  static Future<void> clearViolations(String uid, String by) => users.doc(uid).update({
        'violationsClearedAt': FieldValue.serverTimestamp(),
        'violationsClearedBy': by,
      });

  static Stream<List<GeoAlert>> openAlerts() => alerts
      .where('resolved', isEqualTo: false)
      .snapshots()
      .map((q) => q.docs.map(GeoAlert.fromDoc).toList()
        ..sort((a, b) => (b.at ?? DateTime(2100)).compareTo(a.at ?? DateTime(2100))));

  static Future<void> resolveAlert(String id, String by) =>
      alerts.doc(id).update({'resolved': true, 'resolvedBy': by, 'resolvedAt': FieldValue.serverTimestamp()});

  /// Employees may only touch these two fields on a site (enforced by rules).
  static Future<void> updateSiteProgress(String id, int progress) => sites.doc(id).update({
        'progress': progress,
        'progressUpdatedAt': FieldValue.serverTimestamp(),
      });

  // ------------------------------------------------------------ schedules
  static Stream<List<Schedule>> schedulesForEmployee(String uid, String date) => schedules
      .where('employeeId', isEqualTo: uid)
      .where('date', isEqualTo: date)
      .snapshots()
      .map((q) => q.docs.map(Schedule.fromDoc).toList()
        ..sort((a, b) => a.startTime.compareTo(b.startTime)));

  static Stream<List<Schedule>> schedulesForDate(String date) =>
      schedules.where('date', isEqualTo: date).snapshots().map((q) =>
          q.docs.map(Schedule.fromDoc).toList()
            ..sort((a, b) {
              final c = a.employeeName.compareTo(b.employeeName);
              return c != 0 ? c : a.startTime.compareTo(b.startTime);
            }));

  static Future<void> addSchedule({
    required AppUser employee,
    required Site site,
    required DateTime date,
    String startTime = '',
    String endTime = '',
    String note = '',
  }) =>
      schedules.add({
        'employeeId': employee.id,
        'employeeName': employee.name,
        'siteId': site.id,
        'siteName': site.name,
        'date': dateKey(date),
        'month': monthKey(date),
        'startTime': startTime,
        'endTime': endTime,
        'note': note,
        'createdAt': FieldValue.serverTimestamp(),
      });

  static Future<void> deleteSchedule(String id) => schedules.doc(id).delete();

  // ----------------------------------------------------------- attendance
  static Stream<List<AttendanceSession>> sessionsForEmployeeDay(String uid, String date) =>
      attendance
          .where('employeeId', isEqualTo: uid)
          .where('date', isEqualTo: date)
          .snapshots()
          .map(_sortSessions);

  static Stream<List<AttendanceSession>> sessionsForEmployeeMonth(String uid, String month) =>
      attendance
          .where('employeeId', isEqualTo: uid)
          .where('month', isEqualTo: month)
          .snapshots()
          .map(_sortSessions);

  static Stream<List<AttendanceSession>> sessionsForDate(String date) =>
      attendance.where('date', isEqualTo: date).snapshots().map(_sortSessions);

  static Stream<List<AttendanceSession>> sessionsForMonth(String month) =>
      attendance.where('month', isEqualTo: month).snapshots().map(_sortSessions);

  static Stream<AttendanceSession?> openSession(String uid) => attendance
      .where('employeeId', isEqualTo: uid)
      .where('status', isEqualTo: 'open')
      .snapshots()
      .map((q) {
        final l = _sortSessions(q);
        return l.isEmpty ? null : l.last;
      });

  /// Everyone currently checked in (any date — catches forgotten check-outs).
  static Stream<List<AttendanceSession>> allOpenSessions() =>
      attendance.where('status', isEqualTo: 'open').snapshots().map(_sortSessions);

  static List<AttendanceSession> _sortSessions(QuerySnapshot<Map<String, dynamic>> q) =>
      q.docs.map(AttendanceSession.fromDoc).toList()
        ..sort((a, b) => a.checkIn.compareTo(b.checkIn));

  static Future<String> checkIn({
    required AppUser user,
    required Site site,
    required double lat,
    required double lng,
    required double accuracy,
    required double distance,
    required bool mocked,
    String note = '',
    DateTime? at,
    bool violationMark = false,
    String violationNote = '',
  }) async {
    final now = at ?? DateTime.now();
    final ref = await attendance.add({
      if (violationMark) 'violationMark': true,
      if (violationMark) 'violationNote': violationNote,
      'employeeId': user.id,
      'employeeName': user.name,
      'siteId': site.id,
      'siteName': site.name,
      'date': dateKey(now),
      'month': monthKey(now),
      'checkIn': Timestamp.fromDate(now),
      'checkInServer': FieldValue.serverTimestamp(),
      // UTC offset of the phone at check-in → reports show the site's local time.
      'tz': now.timeZoneOffset.inMinutes,
      'tzName': now.timeZoneName,
      'inLat': lat,
      'inLng': lng,
      'inAccuracy': accuracy,
      'inDistance': distance,
      'inOutside': distance > site.radius,
      'mocked': mocked,
      'status': 'open',
      'note': note,
    });
    return ref.id;
  }

  static Future<void> checkOut({
    required AttendanceSession session,
    required double lat,
    required double lng,
    required double accuracy,
    required double? distance,
    required double radius,
    required bool mocked,
    String note = '',
    bool closeWorkers = true,
  }) async {
    final now = DateTime.now();
    await attendance.doc(session.id).update({
      'checkOut': Timestamp.fromDate(now),
      'checkOutServer': FieldValue.serverTimestamp(),
      'outTz': now.timeZoneOffset.inMinutes,
      'outLat': lat,
      'outLng': lng,
      'outAccuracy': accuracy,
      'outDistance': distance,
      'outOutside': distance != null && distance > radius,
      'durationMin': now.difference(session.checkIn).inMinutes,
      'status': 'closed',
      if (mocked) 'mocked': true,
      if (note.isNotEmpty) 'note': note,
    });
    if (closeWorkers) await _closeWorkersSafely(session, now);
  }

  /// Admin: force-close a session someone forgot to check out of.
  static Future<void> adminCloseSession(AttendanceSession s, DateTime at) async {
    await attendance.doc(s.id).update({
      'checkOut': Timestamp.fromDate(at),
      'durationMin': at.difference(s.checkIn).inMinutes,
      'status': 'closed',
      'note': '${s.note} [closed by management]'.trim(),
    });
    await _closeWorkersSafely(s, at);
  }

  static Future<void> _closeWorkersSafely(AttendanceSession s, DateTime at) async {
    try {
      await closeWorkersForSession(s.id, s.employeeId, at);
    } catch (_) {
      // Never block a check-out; management can release workers from the dashboard.
    }
  }

  // ---------------------------------------------------------------- external workers
  static CollectionReference<Map<String, dynamic>> get extWorkers => _fs.collection('extWorkers');
  static CollectionReference<Map<String, dynamic>> get workerLocks => _fs.collection('workerLocks');
  static CollectionReference<Map<String, dynamic>> get workerAttendance =>
      _fs.collection('workerAttendance');

  static Stream<List<ExtWorker>> activeWorkersStream() => extWorkers.snapshots().map((q) =>
      q.docs.map(ExtWorker.fromDoc).where((w) => w.active).toList()
        ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase())));

  /// External workers this employee put on site and hasn't punched out yet (any check-in).
  static Stream<List<WorkerEntry>> myOpenWorkers(String uid) => workerAttendance
      .where('employeeId', isEqualTo: uid)
      .where('open', isEqualTo: true)
      .snapshots()
      .map((q) => q.docs.map(WorkerEntry.fromDoc).toList()
        ..sort((a, b) => a.workerName.toLowerCase().compareTo(b.workerName.toLowerCase())));

  /// All external-worker entries for a day (management).
  static Stream<List<WorkerEntry>> workersForDate(String date) => workerAttendance
      .where('date', isEqualTo: date)
      .snapshots()
      .map((q) => q.docs.map(WorkerEntry.fromDoc).toList()..sort((a, b) => a.workerName.compareTo(b.workerName)));

  /// External workers still on site (any date — survives midnight).
  static Stream<List<WorkerEntry>> openWorkerEntries() => workerAttendance
      .where('open', isEqualTo: true)
      .snapshots()
      .map((q) => q.docs.map(WorkerEntry.fromDoc).toList());

  /// This month's staff sessions and external-worker entries at one site.
  static Stream<List<AttendanceSession>> siteSessionsMonth(String siteId, String month) => attendance
      .where('siteId', isEqualTo: siteId)
      .where('month', isEqualTo: month)
      .snapshots()
      .map(_sortSessions);
  static Stream<List<WorkerEntry>> siteWorkersMonth(String siteId, String month) => workerAttendance
      .where('siteId', isEqualTo: siteId)
      .where('month', isEqualTo: month)
      .snapshots()
      .map((q) => q.docs.map(WorkerEntry.fromDoc).toList());

  /// Everything ever worked at one site (for the "total to date" figure).
  static Stream<List<AttendanceSession>> siteSessionsAll(String siteId) =>
      attendance.where('siteId', isEqualTo: siteId).snapshots().map(_sortSessions);
  static Stream<List<WorkerEntry>> siteWorkersAll(String siteId) => workerAttendance
      .where('siteId', isEqualTo: siteId)
      .snapshots()
      .map((q) => q.docs.map(WorkerEntry.fromDoc).toList());

  /// Employee adds a worker who isn't registered yet. Returns the new worker.
  static Future<ExtWorker> addWorkerByEmployee({
    required AppUser me,
    required String name,
    required String phone,
    String company = '',
    String trade = '',
  }) async {
    final ref = await extWorkers.add({
      'name': name,
      'phone': phone,
      'company': company,
      'trade': trade,
      'active': true,
      'addedByEmployee': true,
      'createdBy': me.name,
      'createdById': me.id,
      'createdAt': FieldValue.serverTimestamp(),
    });
    return ExtWorker(id: ref.id, name: name, phone: phone, company: company, trade: trade);
  }

  static Stream<Map<String, WorkerLock>> workerLocksStream() => workerLocks
      .snapshots()
      .map((q) => {for (final d in q.docs) d.id: WorkerLock.fromDoc(d)});

  /// Workers on this employee's session (open and finished).
  static Stream<List<WorkerEntry>> workersForSession(String sessionId, String uid) =>
      workerAttendance
          .where('sessionId', isEqualTo: sessionId)
          .where('employeeId', isEqualTo: uid)
          .snapshots()
          .map((q) => q.docs.map(WorkerEntry.fromDoc).toList()
            ..sort((a, b) => a.workerName.toLowerCase().compareTo(b.workerName.toLowerCase())));

  /// Adds workers to the employee's open session. Each worker can be on only one
  /// site at a time (enforced with a lock document). Returns a message for every
  /// worker that could not be added because someone else already has them.
  static Future<List<String>> addWorkersToSession({
    required AppUser user,
    required String sessionId,
    required String siteId,
    required String siteName,
    required DateTime sessionStart,
    required List<ExtWorker> workers,
  }) async {
    final now = DateTime.now();
    // Picked right after checking in → they arrived with the employee.
    final start = now.difference(sessionStart) <= const Duration(minutes: 15) ? sessionStart : now;
    final busy = <String>[];
    for (final w in workers) {
      final lockRef = workerLocks.doc(w.id);
      final msg = await _fs.runTransaction<String?>((tx) async {
        final lock = await tx.get(lockRef);
        if (lock.exists) {
          final m = lock.data() ?? {};
          if (m['sessionId'] == sessionId) return null; // already on this check-in
          return '${w.name} is already with ${m['employeeName'] ?? 'someone'} at ${m['siteName'] ?? 'another site'}';
        }
        final rec = workerAttendance.doc();
        tx.set(rec, {
          'workerId': w.id,
          'workerName': w.name,
          'company': w.company,
          'trade': w.trade,
          'sessionId': sessionId,
          'employeeId': user.id,
          'employeeName': user.name,
          'siteId': siteId,
          'siteName': siteName,
          'date': dateKey(start),
          'month': monthKey(start),
          'checkIn': Timestamp.fromDate(start),
          'tz': start.timeZoneOffset.inMinutes,
          'open': true,
          'createdAt': FieldValue.serverTimestamp(),
        });
        tx.set(lockRef, {
          'recordId': rec.id,
          'sessionId': sessionId,
          'employeeId': user.id,
          'employeeName': user.name,
          'siteId': siteId,
          'siteName': siteName,
          'since': Timestamp.fromDate(start),
        });
        return null;
      });
      if (msg != null) busy.add(msg);
    }
    return busy;
  }

  /// Ends one worker's time on site and frees them for another check-in.
  static Future<void> endWorkerEntry(WorkerEntry e, DateTime at) async {
    final end = at.isBefore(e.checkIn) ? e.checkIn : at;
    final lockRef = workerLocks.doc(e.workerId);
    await _fs.runTransaction((tx) async {
      final lock = await tx.get(lockRef);
      tx.update(workerAttendance.doc(e.id), {
        'checkOut': Timestamp.fromDate(end),
        'durationMin': end.difference(e.checkIn).inMinutes,
        'open': false,
      });
      if (lock.exists && lock.data()?['recordId'] == e.id) tx.delete(lockRef);
    });
  }

  static Future<void> closeWorkersForSession(String sessionId, String employeeId, DateTime at) async {
    final q = await workerAttendance
        .where('sessionId', isEqualTo: sessionId)
        .where('employeeId', isEqualTo: employeeId)
        .where('open', isEqualTo: true)
        .get();
    for (final d in q.docs) {
      await endWorkerEntry(WorkerEntry.fromDoc(d), at);
    }
  }

  static Future<void> deleteSession(String id) async {
    await attendance.doc(id).delete();
    final q = await workerAttendance.where('sessionId', isEqualTo: id).get();
    for (final d in q.docs) {
      final lockRef = workerLocks.doc(_str(d.data()['workerId']));
      final lock = await lockRef.get();
      if (lock.exists && lock.data()?['recordId'] == d.id) await lockRef.delete();
      await d.reference.delete();
    }
  }

  static String _str(dynamic v) => v is String ? v : '';

  // --------------------------------------------------------- site updates
  static Stream<List<SiteUpdate>> recentUpdates({int limit = 60}) => siteUpdates
      .orderBy('createdAt', descending: true)
      .limit(limit)
      .snapshots()
      .map((q) => q.docs.map(SiteUpdate.fromDoc).toList());

  static Stream<List<SiteUpdate>> updatesForSite(String siteId) => siteUpdates
      .where('siteId', isEqualTo: siteId)
      .snapshots()
      .map(_sortUpdates);

  static Stream<List<SiteUpdate>> updatesForEmployeeMonth(String uid, String month) =>
      siteUpdates
          .where('employeeId', isEqualTo: uid)
          .where('month', isEqualTo: month)
          .snapshots()
          .map(_sortUpdates);

  static List<SiteUpdate> _sortUpdates(QuerySnapshot<Map<String, dynamic>> q) =>
      q.docs.map(SiteUpdate.fromDoc).toList()
        ..sort((a, b) => (b.createdAt ?? DateTime(2100)).compareTo(a.createdAt ?? DateTime(2100)));

  static Future<void> addSiteUpdate({
    required AppUser user,
    required Site site,
    required String category,
    required String note,
    int? progress,
    List<String> photos = const [],
    double? lat,
    double? lng,
  }) async {
    final now = DateTime.now();
    await siteUpdates.add({
      'siteId': site.id,
      'siteName': site.name,
      'employeeId': user.id,
      'employeeName': user.name,
      'category': category,
      'note': note,
      'progress': progress,
      'photos': photos,
      'lat': lat,
      'lng': lng,
      'date': dateKey(now),
      'month': monthKey(now),
      'tz': now.timeZoneOffset.inMinutes,
      'createdAt': FieldValue.serverTimestamp(),
    });
  }

  static Future<void> deleteSiteUpdate(String id) => siteUpdates.doc(id).delete();

  /// Edit an update (by the person who posted it, or management).
  static Future<void> editSiteUpdate(
    String id, {
    required String category,
    required String note,
    required int? progress,
    required List<String> photos,
    required String editedBy,
  }) =>
      siteUpdates.doc(id).update({
        'category': category,
        'note': note,
        'progress': progress,
        'photos': photos,
        'editedAt': FieldValue.serverTimestamp(),
        'editedBy': editedBy,
      });

  // ---------------------------------------------------------------- petty
  static Stream<List<PettyTxn>> pettyForEmployee(String uid) => petty
      .where('employeeId', isEqualTo: uid)
      .snapshots()
      .map(_sortPetty);

  static Stream<List<PettyTxn>> pettyAll({int limit = 300}) => petty
      .orderBy('createdAt', descending: true)
      .limit(limit)
      .snapshots()
      .map((q) => q.docs.map(PettyTxn.fromDoc).toList());

  static Stream<List<PettyTxn>> pettyPending() =>
      petty.where('status', isEqualTo: 'pending').snapshots().map(_sortPetty);

  static List<PettyTxn> _sortPetty(QuerySnapshot<Map<String, dynamic>> q) =>
      q.docs.map(PettyTxn.fromDoc).toList()
        ..sort((a, b) => (b.createdAt ?? DateTime(2100)).compareTo(a.createdAt ?? DateTime(2100)));

  static Future<void> addPetty({
    required String employeeId,
    required String employeeName,
    required String type,
    required double amount,
    required String category,
    required String note,
    required String status,
    required String createdBy,
    required String createdByName,
    Site? site,
    String? receipt,
  }) async {
    final now = DateTime.now();
    await petty.add({
      'employeeId': employeeId,
      'employeeName': employeeName,
      'type': type,
      'amount': amount,
      'category': category,
      'note': note,
      'siteId': site?.id ?? '',
      'siteName': site?.name ?? '',
      'receipt': receipt ?? '',
      'status': status,
      'createdBy': createdBy,
      'createdByName': createdByName,
      'date': dateKey(now),
      'month': monthKey(now),
      'tz': now.timeZoneOffset.inMinutes,
      'createdAt': FieldValue.serverTimestamp(),
    });
  }

  static Future<void> reviewPetty(String id, bool approve, String reviewer, {String note = ''}) =>
      petty.doc(id).update({
        'status': approve ? 'approved' : 'rejected',
        'reviewedBy': reviewer,
        'reviewNote': note,
        'reviewedAt': FieldValue.serverTimestamp(),
      });

  static Future<void> deletePetty(String id) => petty.doc(id).delete();

  // ------------------------------------------------------------- off days
  static Stream<List<OffDay>> offDaysForEmployeeMonth(String uid, String month) => offDays
      .where('employeeId', isEqualTo: uid)
      .where('month', isEqualTo: month)
      .snapshots()
      .map((q) => q.docs.map(OffDay.fromDoc).toList()..sort((a, b) => a.date.compareTo(b.date)));

  static Stream<List<OffDay>> offDaysForMonth(String month) => offDays
      .where('month', isEqualTo: month)
      .snapshots()
      .map((q) => q.docs.map(OffDay.fromDoc).toList()..sort((a, b) => a.date.compareTo(b.date)));

  static Stream<List<OffDay>> offDaysPending() => offDays
      .where('status', isEqualTo: 'pending')
      .snapshots()
      .map((q) => q.docs.map(OffDay.fromDoc).toList()..sort((a, b) => a.date.compareTo(b.date)));

  static Future<void> requestOffDay(AppUser user, DateTime day, String reason,
          {String status = 'pending'}) =>
      offDays.add({
        'employeeId': user.id,
        'employeeName': user.name,
        'date': dateKey(day),
        'month': monthKey(day),
        'reason': reason,
        'status': status,
        'createdAt': FieldValue.serverTimestamp(),
      });

  static Future<void> reviewOffDay(String id, bool approve) =>
      offDays.doc(id).update({'status': approve ? 'approved' : 'rejected'});

  static Future<void> deleteOffDay(String id) => offDays.doc(id).delete();

  // ------------------------------------------------------------- tracking
  static Future<void> pushLocation({
    required String uid,
    required double lat,
    required double lng,
    required double accuracy,
    required bool checkedIn,
    required String siteName,
    bool addTrackPoint = true,
  }) async {
    final batch = _fs.batch();
    batch.set(
        users.doc(uid),
        {
          'lastLocation': {
            'lat': lat,
            'lng': lng,
            'accuracy': accuracy,
            'at': FieldValue.serverTimestamp(),
            'checkedIn': checkedIn,
            'siteName': siteName,
          }
        },
        SetOptions(merge: true));
    if (addTrackPoint) {
      batch.set(track(uid).doc(), {
        'lat': lat,
        'lng': lng,
        'accuracy': accuracy,
        'date': dateKey(DateTime.now()),
        'at': FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  static Future<void> markTrackingStopped(String uid) => users.doc(uid).set({
        'lastLocation': {'checkedIn': false, 'siteName': ''}
      }, SetOptions(merge: true));

  static Stream<List<TrackPoint>> trackForDay(String uid, String date) => track(uid)
      .where('date', isEqualTo: date)
      .snapshots()
      .map((q) {
        final l = q.docs.map(TrackPoint.fromDoc).whereType<TrackPoint>().toList()
          ..sort((a, b) => (a.at ?? DateTime(2100)).compareTo(b.at ?? DateTime(2100)));
        return l;
      });

  // ---------------------------------------------------------------- my ID documents
  static CollectionReference<Map<String, dynamic>> get idInfo => _fs.collection('idInfo');
  static CollectionReference<Map<String, dynamic>> get idFiles => _fs.collection('idFiles');

  /// Employee updates their own mobile number / email (rules allow only these fields).
  static Future<void> updateMyContact(String uid, {required String phone, required String email}) =>
      users.doc(uid).update({'phone': phone, 'contactEmail': email, 'contactUpdatedAt': FieldValue.serverTimestamp()});

  /// Everyone's ID numbers (management / people allowed to view IDs).
  static Stream<Map<String, Map<String, dynamic>>> allIdInfo() =>
      idInfo.snapshots().map((q) => {for (final d in q.docs) d.id: d.data()});

  /// Every official ID copy (not the ones still waiting for approval from the Documents Portal).
  static Stream<List<IdFileMeta>> allIdFiles() => idFiles.snapshots().map((q) => q.docs
      .where((d) => d.data()['pending'] != true)
      .map(IdFileMeta.fromDoc)
      .toList()
    ..sort((a, b) => (a.uploadedAt ?? DateTime(2000)).compareTo(b.uploadedAt ?? DateTime(2000))));

  static Stream<List<ExtWorker>> allWorkersStream() => extWorkers.snapshots().map((q) =>
      q.docs.map(ExtWorker.fromDoc).toList()..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase())));

  static Stream<Map<String, dynamic>> myIdInfo(String uid) =>
      idInfo.doc(uid).snapshots().map((d) => d.data() ?? {});

  static Future<void> saveMyIdInfo(AppUser me, Map<String, String> fields) =>
      saveIdInfo(IdOwner.fromUser(me), fields);

  /// Numbers / expiry for anyone (management can save for staff and external workers).
  static Future<void> saveIdInfo(IdOwner o, Map<String, String> fields) =>
      idInfo.doc(o.id).set({
        ...fields,
        'ownerType': o.type,
        'name': o.name,
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));

  static Stream<List<IdFileMeta>> myIdFiles(String uid) =>
      idFiles.where('ownerId', isEqualTo: uid).snapshots().map((q) =>
          q.docs.map(IdFileMeta.fromDoc).toList()
            ..sort((a, b) => (a.uploadedAt ?? DateTime(2000)).compareTo(b.uploadedAt ?? DateTime(2000))));

  static const _chunk = 700000; // base64 characters per Firestore document

  static Future<void> uploadMyIdFile({
    required AppUser me,
    required String kind,
    required String name,
    required String mime,
    required Uint8List bytes,
    String side = '',
    String title = '', // heading of an additional document
    IdOwner? owner, // management uploading for someone else
  }) async {
    final o = owner ?? IdOwner.fromUser(me);
    if (bytes.length > kMaxDocBytes) throw Exception('File is larger than 2 MB.');
    final b64 = base64Encode(bytes);
    final ref = idFiles.doc();
    final n = (b64.length / _chunk).ceil().clamp(1, 1000);
    final batch = _fs.batch();
    for (var i = 0; i < n; i++) {
      final end = (i + 1) * _chunk;
      batch.set(ref.collection('chunks').doc('$i'),
          {'d': b64.substring(i * _chunk, end > b64.length ? b64.length : end)});
    }
    batch.set(ref, {
      'ownerId': o.id,
      'ownerType': o.type,
      'ownerName': o.name,
      'kind': kind,
      'name': name,
      'mime': mime,
      'size': bytes.length,
      'chunks': n,
      'uploadedAt': FieldValue.serverTimestamp(),
      'uploadedBy': me.name,
      if (side.isNotEmpty) 'side': side,
      if (title.isNotEmpty) 'title': title,
    });
    await batch.commit();
  }

  // ---------------------------------------------------------------- company documents
  static CollectionReference<Map<String, dynamic>> get companyDocs => _fs.collection('companyDocs');
  static CollectionReference<Map<String, dynamic>> get companyFiles => _fs.collection('companyFiles');

  static Stream<List<CompanyDoc>> companyDocsStream() =>
      companyDocs.snapshots().map((q) => q.docs.map(CompanyDoc.fromDoc).toList());

  static Stream<List<CompanyFile>> companyFilesStream() => companyFiles.snapshots().map((q) =>
      q.docs.map(CompanyFile.fromDoc).toList()
        ..sort((a, b) => (a.uploadedAt ?? DateTime(2100)).compareTo(b.uploadedAt ?? DateTime(2100))));

  /// Standard documents use their key as the id; additional ones get a new id. Returns the id.
  static Future<String> saveCompanyDoc({
    String? id,
    String key = '',
    required String title,
    String number = '',
    String issueDate = '',
    String expiry = '',
    String notes = '',
    bool custom = false,
    String by = '',
  }) async {
    final ref = id != null ? companyDocs.doc(id) : (key.isNotEmpty && !custom ? companyDocs.doc(key) : companyDocs.doc());
    await ref.set({
      'key': key,
      'title': title,
      'number': number,
      'issueDate': issueDate,
      'expiry': expiry,
      'notes': notes,
      'custom': custom,
      'updatedAt': FieldValue.serverTimestamp(),
      'updatedBy': by,
    }, SetOptions(merge: true));
    return ref.id;
  }

  static Future<void> uploadCompanyFile({
    required String docId,
    required String name,
    required String mime,
    required Uint8List bytes,
    String by = '',
  }) async {
    if (bytes.length > kMaxDocBytes) throw Exception('File is larger than 2 MB.');
    final b64 = base64Encode(bytes);
    final ref = companyFiles.doc();
    final n = (b64.length / _chunk).ceil().clamp(1, 1000);
    final batch = _fs.batch();
    for (var i = 0; i < n; i++) {
      final end = (i + 1) * _chunk;
      batch.set(ref.collection('chunks').doc('$i'), {'d': b64.substring(i * _chunk, end > b64.length ? b64.length : end)});
    }
    batch.set(ref, {
      'docId': docId,
      'name': name,
      'mime': mime,
      'size': bytes.length,
      'chunks': n,
      'uploadedAt': FieldValue.serverTimestamp(),
      'uploadedBy': by,
    });
    await batch.commit();
  }

  static Future<Uint8List> readCompanyFile(CompanyFile f) async {
    final q = await companyFiles.doc(f.id).collection('chunks').get();
    final parts = q.docs.toList()..sort((a, b) => int.parse(a.id).compareTo(int.parse(b.id)));
    return base64Decode(parts.map((d) => _str(d.data()['d'])).join());
  }

  static Future<void> deleteCompanyFile(CompanyFile f) async {
    final q = await companyFiles.doc(f.id).collection('chunks').get();
    final batch = _fs.batch();
    for (final d in q.docs) {
      batch.delete(d.reference);
    }
    batch.delete(companyFiles.doc(f.id));
    await batch.commit();
  }

  static Future<void> deleteCompanyDoc(String docId, List<CompanyFile> files) async {
    for (final f in files.where((f) => f.docId == docId)) {
      await deleteCompanyFile(f);
    }
    await companyDocs.doc(docId).delete();
  }

  static Future<Uint8List> readIdFile(IdFileMeta f) async {
    final q = await idFiles.doc(f.id).collection('chunks').get();
    final parts = q.docs.toList()..sort((a, b) => int.parse(a.id).compareTo(int.parse(b.id)));
    return base64Decode(parts.map((d) => _str(d.data()['d'])).join());
  }

  static Future<void> deleteIdFile(IdFileMeta f) async {
    final q = await idFiles.doc(f.id).collection('chunks').get();
    final batch = _fs.batch();
    for (final d in q.docs) {
      batch.delete(d.reference);
    }
    batch.delete(idFiles.doc(f.id));
    await batch.commit();
  }

  // ---------------------------------------------------------------- driver trips
  static CollectionReference<Map<String, dynamic>> get trips => _fs.collection('trips');

  static Stream<Trip?> activeTrip(String uid) => trips
      .where('employeeId', isEqualTo: uid)
      .where('status', isEqualTo: 'active')
      .snapshots()
      .map((q) => q.docs.isEmpty ? null : Trip.fromDoc(q.docs.first));

  static Stream<List<Trip>> tripsForDay(String uid, String date) => trips
      .where('employeeId', isEqualTo: uid)
      .where('date', isEqualTo: date)
      .snapshots()
      .map((q) => q.docs.map(Trip.fromDoc).toList()..sort((a, b) => b.startAt.compareTo(a.startAt)));

  /// Every finished trip of a driver (for the earned / paid / balance tally).
  static Stream<List<Trip>> myDoneTrips(String uid) => trips
      .where('employeeId', isEqualTo: uid)
      .where('status', isEqualTo: 'done')
      .snapshots()
      .map((q) => q.docs.map(Trip.fromDoc).toList()..sort((a, b) => b.startAt.compareTo(a.startAt)));

  /// Finished staff rides taken with this driver (they count in the driver's account).
  static Stream<List<Trip>> ridesWithDriver(String uid) => trips
      .where('driverId', isEqualTo: uid)
      .where('status', isEqualTo: 'done')
      .snapshots()
      .map((q) => q.docs.map(Trip.fromDoc).toList()..sort((a, b) => b.startAt.compareTo(a.startAt)));

  static Stream<List<DriverPayment>> myDriverPayments(String uid) => _fs
      .collection('driverPayments')
      .where('employeeId', isEqualTo: uid)
      .snapshots()
      .map((q) => q.docs.map(DriverPayment.fromDoc).toList()..sort((a, b) => b.date.compareTo(a.date)));

  /// Driver enters / changes the cost of a trip (during or after it).
  static Future<void> setTripCost(String tripId, double cost) => trips.doc(tripId).update({
        'cost': (cost * 100).round() / 100,
        'costEntered': true,
        'costEditedAt': FieldValue.serverTimestamp(),
      });

  /// Management: trips & rides between two dates (yyyy-MM-dd, inclusive).
  static Stream<List<Trip>> tripsInRange(String from, String to) => trips
      .where('date', isGreaterThanOrEqualTo: from)
      .where('date', isLessThanOrEqualTo: to)
      .snapshots()
      .map((q) => q.docs.map(Trip.fromDoc).toList()..sort((a, b) => b.startAt.compareTo(a.startAt)));

  /// Every finished trip (for driver accounts: earned − paid).
  static Stream<List<Trip>> doneTripsAll() => trips
      .where('status', isEqualTo: 'done')
      .snapshots()
      .map((q) => q.docs.map(Trip.fromDoc).toList());

  static Future<List<({double lat, double lng})>> tripPoints(String id) async {
    final q = await trips.doc(id).collection('points').get();
    final pts = q.docs.map((d) => d.data()).where((m) => m['lat'] is num && m['lng'] is num).toList()
      ..sort((a, b) {
        final x = a['at'], y = b['at'];
        if (x is Timestamp && y is Timestamp) return x.compareTo(y);
        return 0;
      });
    return pts.map((m) => (lat: (m['lat'] as num).toDouble(), lng: (m['lng'] as num).toDouble())).toList();
  }

  /// Admin correction of a trip / ride. Keeps the GPS distance it replaced the first time.
  static Future<void> adminEditTrip({
    required Trip trip,
    required double km,
    required double cost,
    Site? site,
    required String purpose,
    required String note,
    required AppUser by,
  }) {
    return trips.doc(trip.id).update({
      'distanceM': (km * 1000).round(),
      'cost': (cost * 100).round() / 100,
      'siteId': site?.id ?? '',
      'siteName': site?.name ?? '',
      'purpose': purpose,
      'note': note,
      'editedAt': FieldValue.serverTimestamp(),
      'editedBy': by.name,
      if ((km * 1000).round() != trip.distanceM.round()) 'originalDistanceM': trip.distanceM,
    });
  }

  /// Ends a trip someone forgot to stop, at its last GPS point.
  static Future<void> adminEndTrip(Trip t, AppUser by, double rate) {
    final end = DateTime.now();
    return trips.doc(t.id).update({
      'status': 'done',
      'endAt': Timestamp.fromDate(end),
      'endLat': t.lastLat,
      'endLng': t.lastLng,
      'siteId': t.siteId.isNotEmpty ? t.siteId : t.startSiteId,
      'siteName': t.siteName.isNotEmpty ? t.siteName : t.startSiteName,
      'durationMin': end.difference(t.startAt).inMinutes,
      'cost': t.cost ?? (t.isTaxi ? 0 : (t.km * (t.ratePerKm ?? rate) * 100).round() / 100),
      'note': 'Ended by ${by.name}',
    });
  }

  /// Admin: deletes a trip and its GPS route.
  static Future<void> deleteTrip(String id) async {
    final pts = await trips.doc(id).collection('points').get();
    for (var i = 0; i < pts.docs.length; i += 400) {
      final b = _fs.batch();
      for (final d in pts.docs.skip(i).take(400)) {
        b.delete(d.reference);
      }
      await b.commit();
    }
    await trips.doc(id).delete();
  }

  static Stream<List<DriverPayment>> allDriverPayments() => _fs
      .collection('driverPayments')
      .snapshots()
      .map((q) => q.docs.map(DriverPayment.fromDoc).toList()..sort((a, b) => b.date.compareTo(a.date)));

  static Future<void> addDriverPayment({
    required AppUser driver,
    required double amount,
    required String date,
    required String method,
    required String note,
    required AppUser by,
  }) =>
      _fs.collection('driverPayments').add({
        'employeeId': driver.id,
        'employeeName': driver.name,
        'amount': (amount * 100).round() / 100,
        'date': date,
        'method': method,
        'note': note,
        'createdBy': by.name,
        'createdById': by.id,
        'createdAt': FieldValue.serverTimestamp(),
      });

  static Future<void> deleteDriverPayment(String id) => _fs.collection('driverPayments').doc(id).delete();

  /// Management: every trip running now / every trip on a date.
  static Stream<List<Trip>> activeTripsAll() => trips
      .where('status', isEqualTo: 'active')
      .snapshots()
      .map((q) => q.docs.map(Trip.fromDoc).toList());

  static Stream<List<Trip>> tripsForDate(String date) => trips
      .where('date', isEqualTo: date)
      .snapshots()
      .map((q) => q.docs.map(Trip.fromDoc).toList());

  /// Company rate per km (admin setting) — a driver's own rate overrides it.
  static Future<double> tripRate(AppUser u) async {
    if (u.tripRatePerKm != null) return u.tripRatePerKm!;
    try {
      final d = await _fs.collection('settings').doc('general').get();
      final v = d.data()?['tripRatePerKm'];
      return v is num ? v.toDouble() : 0;
    } catch (_) {
      return 0;
    }
  }

  /// Drivers, for "ride with a company driver".
  static Stream<List<AppUser>> driversStream() => _fs
      .collection('users')
      .where('isDriver', isEqualTo: true)
      .snapshots()
      .map((q) => q.docs.map(AppUser.fromDoc).where((u) => u.active).toList()..sort((a, b) => a.name.compareTo(b.name)));

  static Stream<List<Trip>> tripsForMonth(String uid, String month) => trips
      .where('employeeId', isEqualTo: uid)
      .where('month', isEqualTo: month)
      .snapshots()
      .map((q) => q.docs.map(Trip.fromDoc).toList()..sort((a, b) => b.startAt.compareTo(a.startAt)));

  static Future<String> startTrip({
    required AppUser user,
    required String vehicle,
    required String purpose,
    required double lat,
    required double lng,
    Site? site,
    String kind = 'driver',
    AppUser? driver,
    double? ratePerKm,
  }) async {
    final now = DateTime.now();
    final ref = trips.doc();
    final batch = _fs.batch();
    batch.set(ref, {
      'employeeId': user.id,
      'employeeName': user.name,
      'vehicle': vehicle,
      'purpose': purpose,
      'status': 'active',
      'startAt': Timestamp.fromDate(now),
      'startServer': FieldValue.serverTimestamp(),
      'tz': now.timeZoneOffset.inMinutes,
      'date': dateKey(now),
      'month': monthKey(now),
      'startLat': lat,
      'startLng': lng,
      'lastLat': lat,
      'lastLng': lng,
      'lastAt': FieldValue.serverTimestamp(),
      'startSiteId': site?.id ?? '',
      'startSiteName': site?.name ?? '',
      'distanceM': 0,
      'pointsCount': 1,
      'platform': 'android',
      'kind': kind,
      'driverId': driver?.id ?? '',
      'driverName': driver?.name ?? '',
      if (ratePerKm != null) 'ratePerKm': ratePerKm,
    });
    batch.set(ref.collection('points').doc(), {'lat': lat, 'lng': lng, 'at': FieldValue.serverTimestamp()});
    await batch.commit();
    return ref.id;
  }

  /// Saves a route point and the running distance.
  static Future<void> addTripPoint(String tripId, double lat, double lng, double distanceM, int points) {
    final ref = trips.doc(tripId);
    final batch = _fs.batch();
    batch.set(ref.collection('points').doc(), {'lat': lat, 'lng': lng, 'at': FieldValue.serverTimestamp()});
    batch.update(ref, {
      'distanceM': distanceM,
      'pointsCount': points,
      'lastLat': lat,
      'lastLng': lng,
      'lastAt': FieldValue.serverTimestamp(),
    });
    return batch.commit();
  }

  static Future<void> endTrip({
    required Trip trip,
    required double distanceM,
    required int points,
    double? ratePerKm,
    double? cost,
    bool costEntered = false,
    String? vehicle,
    double? lat,
    double? lng,
    Site? site,
    String note = '',
  }) async {
    final now = DateTime.now();
    // The trip's cost is charged to the drop-off site, or the pick-up site if the drop isn't at a site.
    final chargeId = site?.id ?? trip.startSiteId;
    final chargeName = site?.name ?? trip.startSiteName;
    final km = distanceM / 1000;
    final ref = trips.doc(trip.id);
    final batch = _fs.batch();
    if (lat != null && lng != null) {
      batch.set(ref.collection('points').doc(), {'lat': lat, 'lng': lng, 'at': FieldValue.serverTimestamp()});
    }
    batch.update(ref, {
      'status': 'done',
      'endAt': Timestamp.fromDate(now),
      'endServer': FieldValue.serverTimestamp(),
      'endTz': now.timeZoneOffset.inMinutes,
      'endLat': lat,
      'endLng': lng,
      'endSiteId': site?.id ?? '',
      'endSiteName': site?.name ?? '',
      'siteId': chargeId,
      'siteName': chargeName,
      'distanceM': distanceM,
      'pointsCount': points + (lat != null ? 1 : 0),
      'durationMin': now.difference(trip.startAt).inMinutes,
      'ratePerKm': ratePerKm,
      'cost': cost ?? ((km * (ratePerKm ?? 0) * 100).round() / 100),
      if (costEntered) 'costEntered': true,
      if (vehicle != null && vehicle.isNotEmpty) 'vehicle': vehicle,
      if (note.isNotEmpty) 'note': note,
    });
    await batch.commit();
  }

  // ---------------------------------------------------------------- accounts (admin only)
  static CollectionReference<Map<String, dynamic>> get acct => _fs.collection('acctEntries');

  static Stream<List<AcctEntry>> acctInRange(String from, String to) => acct
      .where('date', isGreaterThanOrEqualTo: from)
      .where('date', isLessThanOrEqualTo: to)
      .snapshots()
      .map((q) => q.docs.map(AcctEntry.fromDoc).toList());

  /// Automatic expense lines: petty cash given to staff (not staff spending — that cash
  /// was already counted when given) and payments to drivers.
  static Future<List<AcctEntry>> acctAuto(String from, String to) async {
    final res = await Future.wait([
      _fs.collection('petty').where('date', isGreaterThanOrEqualTo: from).where('date', isLessThanOrEqualTo: to).get(),
      _fs.collection('driverPayments').where('date', isGreaterThanOrEqualTo: from).where('date', isLessThanOrEqualTo: to).get(),
    ]);
    final out = <AcctEntry>[];
    for (final d in res[0].docs) {
      final m = d.data();
      if (m['type'] != 'credit' || m['status'] == 'rejected') continue;
      out.add(AcctEntry(
        id: 'petty_${d.id}',
        source: 'petty',
        type: 'expense',
        date: (m['date'] as String?) ?? '',
        amount: (m['amount'] as num?)?.toDouble() ?? 0,
        category: 'Petty cash given',
        party: (m['employeeName'] as String?) ?? '',
        note: [(m['note'] as String?) ?? '', if ((m['createdByName'] ?? '') != '') 'given by ${m['createdByName']}']
            .where((x) => x.isNotEmpty)
            .join(' · '),
        siteName: (m['siteName'] as String?) ?? '',
      ));
    }
    for (final d in res[1].docs) {
      final p = DriverPayment.fromDoc(d);
      out.add(AcctEntry(
        id: 'drv_${d.id}',
        source: 'driver',
        type: 'expense',
        date: p.date,
        amount: p.amount,
        category: 'Driver payment',
        method: p.method.isEmpty ? 'Bank transfer' : p.method,
        party: (d.data()['employeeName'] as String?) ?? '',
        note: p.note,
      ));
    }
    return out;
  }

  /// Saved names for the accounts form — suppliers / payees (paidTo) and payers (receivedFrom).
  /// Shared with the invoicing app (acctSettings/parties).
  static Future<Map<String, List<String>>> acctParties() async {
    final d = await _fs.collection('acctSettings').doc('parties').get();
    final m = d.data() ?? {};
    List<String> l(String k) {
      final out = ((m[k] as List?) ?? const []).map((x) => '$x'.trim()).where((x) => x.isNotEmpty).toSet().toList();
      out.sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
      return out;
    }
    return {'paidTo': l('paidTo'), 'receivedFrom': l('receivedFrom')};
  }

  static Future<void> saveAcctParty(String key, String name, {bool remove = false}) =>
      _fs.collection('acctSettings').doc('parties').set({
        key: remove ? FieldValue.arrayRemove([name]) : FieldValue.arrayUnion([name]),
      }, SetOptions(merge: true));

  /// Projects for the accounts form: (id, label), active ones first.
  static Future<List<({String id, String label})>> acctProjects() async {
    final q = await _fs.collection('projects').get();
    final rows = q.docs.map((d) {
      final m = d.data();
      final name = (m['name'] as String?) ?? '';
      final code = (m['code'] as String?) ?? '';
      final status = (m['status'] as String?) ?? 'active';
      return (id: d.id, label: [code, name].where((x) => x.isNotEmpty).join(' · '), active: status == 'active');
    }).where((p) => p.label.isNotEmpty).toList()
      ..sort((a, b) => a.active != b.active ? (a.active ? -1 : 1) : a.label.toLowerCase().compareTo(b.label.toLowerCase()));
    return [for (final p in rows) (id: p.id, label: p.label)];
  }

  static Future<({String date, double cash, double bank})> acctOpening() async {
    final d = await _fs.collection('acctSettings').doc('opening').get();
    final m = d.data() ?? {};
    return (date: (m['date'] as String?) ?? '', cash: (m['cash'] as num?)?.toDouble() ?? 0, bank: (m['bank'] as num?)?.toDouble() ?? 0);
  }

  static Future<void> saveAcctOpening(String date, double cash, double bank, String by) =>
      _fs.collection('acctSettings').doc('opening').set({
        'date': date,
        'cash': (cash * 100).round() / 100,
        'bank': (bank * 100).round() / 100,
        'updatedBy': by,
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));

  /// Balance brought forward to [from]: opening balance + everything from the opening date to the day before.
  static Future<({double cash, double bank})> acctBroughtForward(String from) async {
    final o = await acctOpening();
    var cash = 0.0, bank = 0.0;
    if (o.date.isNotEmpty && o.date.compareTo(from) <= 0) {
      cash = o.cash;
      bank = o.bank;
    }
    final start = o.date.isEmpty ? '2000-01-01' : o.date;
    if (start.compareTo(from) >= 0) return (cash: cash, bank: bank);
    final end = dateKey(parseDateKey(from).subtract(const Duration(days: 1)));
    final manual = await acct.where('date', isGreaterThanOrEqualTo: start).where('date', isLessThanOrEqualTo: end).get();
    final auto = await acctAuto(start, end);
    for (final e in [...manual.docs.map(AcctEntry.fromDoc), ...auto]) {
      if (e.isBank) {
        bank += e.signed;
      } else {
        cash += e.signed;
      }
    }
    return (cash: (cash * 100).round() / 100, bank: (bank * 100).round() / 100);
  }

  static Future<void> saveAcct({String? id, required Map<String, dynamic> data, required AppUser by, String? photoBase64}) async {
    final ref = id == null ? acct.doc() : acct.doc(id);
    final b = _fs.batch();
    b.set(ref, {
      ...data,
      'month': (data['date'] as String).substring(0, 7),
      if (photoBase64 != null) 'hasFile': true,
      if (photoBase64 != null) 'fileName': 'receipt.jpg',
      if (photoBase64 != null) 'fileMime': 'image/jpeg',
      if (id == null) 'createdBy': by.name,
      if (id == null) 'createdById': by.id,
      if (id == null) 'createdAt': FieldValue.serverTimestamp(),
      if (id != null) 'editedBy': by.name,
      if (id != null) 'editedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
    if (photoBase64 != null) {
      b.set(_fs.collection('acctFiles').doc(ref.id), {'base64': photoBase64, 'mime': 'image/jpeg', 'name': 'receipt.jpg'});
    }
    await b.commit();
  }

  static Future<void> deleteAcct(AcctEntry e) async {
    final b = _fs.batch();
    b.delete(acct.doc(e.id));
    if (e.hasFile) b.delete(_fs.collection('acctFiles').doc(e.id));
    await b.commit();
  }

  /// Overall position (all dates since the opening balance): totals and current cash / bank.
  static Future<({double inc, double exp, int nIn, int nOut, double cash, double bank})> acctPosition() async {
    final o = await acctOpening();
    final start = o.date.isEmpty ? '' : o.date;
    final manual = await acct.get();
    final auto = await acctAuto('2000-01-01', '2100-12-31');
    var inc = 0.0, exp = 0.0, cash = start.isEmpty ? 0.0 : o.cash, bank = start.isEmpty ? 0.0 : o.bank;
    var nIn = 0, nOut = 0;
    for (final e in [...manual.docs.map(AcctEntry.fromDoc), ...auto]) {
      if (start.isNotEmpty && e.date.compareTo(start) < 0) continue;
      if (e.isIncome) {
        inc += e.amount;
        nIn++;
      } else {
        exp += e.amount;
        nOut++;
      }
      if (e.isBank) {
        bank += e.signed;
      } else {
        cash += e.signed;
      }
    }
    double r(double v) => (v * 100).round() / 100;
    return (inc: r(inc), exp: r(exp), nIn: nIn, nOut: nOut, cash: r(cash), bank: r(bank));
  }

  // ---------------------------------------------------------------- pending payments (to pay / to receive)
  static CollectionReference<Map<String, dynamic>> get acctPending => _fs.collection('acctPending');
  static Stream<List<PendingPay>> pendingStream() =>
      acctPending.snapshots().map((q) => q.docs.map(PendingPay.fromDoc).toList()
        ..sort((a, b) => (a.dueDate.isEmpty ? '9999' : a.dueDate).compareTo(b.dueDate.isEmpty ? '9999' : b.dueDate)));

  static Future<void> savePending({String? id, required Map<String, dynamic> data, required AppUser by}) {
    final ref = id == null ? acctPending.doc() : acctPending.doc(id);
    return ref.set({
      ...data,
      if (id == null) 'status': 'open',
      if (id == null) 'paid': 0,
      if (id == null) 'history': [],
      if (id == null) 'createdBy': by.name,
      if (id == null) 'createdAt': FieldValue.serverTimestamp(),
      if (id != null) 'editedBy': by.name,
      if (id != null) 'editedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  static Future<void> deletePending(String id) => acctPending.doc(id).delete();

  /// Pays / receives all or part of a pending item: adds the accounts entry and reduces or closes the item.
  static Future<void> payPending(PendingPay p, {required double amount, required String date, required String method, String reference = '', required AppUser by}) async {
    final amt = (amount * 100).round() / 100;
    final b = _fs.batch();
    final eref = acct.doc();
    b.set(eref, {
      'type': p.isReceive ? 'income' : 'expense',
      'date': date,
      'month': date.substring(0, 7),
      'amount': amt,
      'category': p.category.isNotEmpty ? p.category : (p.isReceive ? 'Client payment' : 'Supplier payment'),
      'party': p.party,
      'method': method,
      'reference': reference,
      'bank': '',
      'chequeDate': '',
      'siteId': '',
      'siteName': '',
      'note': [p.note, if (amt < p.remaining - 0.005) 'part payment ($amt of ${p.remaining})'].where((x) => x.isNotEmpty).join(' · '),
      'pendingId': p.id,
      'createdBy': by.name,
      'createdById': by.id,
      'createdAt': FieldValue.serverTimestamp(),
    });
    final paid = ((p.paid + amt) * 100).round() / 100;
    b.update(acctPending.doc(p.id), {
      'paid': paid,
      'status': paid >= p.amount - 0.005 ? 'done' : 'open',
      'lastPaidOn': date,
      'history': FieldValue.arrayUnion([
        {'date': date, 'amount': amt, 'entryId': eref.id, 'by': by.name}
      ]),
    });
    await b.commit();
  }

  static Future<({String base64, String mime})?> acctFile(String id) async {
    final d = await _fs.collection('acctFiles').doc(id).get();
    final m = d.data();
    if (m == null) return null;
    return (base64: (m['base64'] as String?) ?? '', mime: (m['mime'] as String?) ?? 'image/jpeg');
  }
}
