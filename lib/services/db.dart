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
  static Future<Site> createSiteByEmployee({
    required AppUser user,
    required String name,
    required String address,
    required double lat,
    required double lng,
  }) async {
    final site = Site(
      id: '',
      name: name,
      address: address,
      lat: lat,
      lng: lng,
      radius: kDefaultSiteRadius,
      status: 'active',
      notes: 'Added from the field by ${user.name}',
      approved: false,
    );
    final ref = await sites.add({
      ...site.toMap(),
      'createdBy': user.id,
      'createdByName': user.name,
      'addedByEmployee': true,
      'createdAt': FieldValue.serverTimestamp(),
    });
    return Site(
      id: ref.id,
      name: site.name,
      address: site.address,
      lat: lat,
      lng: lng,
      radius: site.radius,
      status: site.status,
      notes: site.notes,
      createdByName: user.name,
      createdBy: user.id,
      approved: false,
    );
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
  }) async {
    final now = at ?? DateTime.now();
    final ref = await attendance.add({
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
    await _closeWorkersSafely(session, now);
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

  static Stream<Map<String, dynamic>> myIdInfo(String uid) =>
      idInfo.doc(uid).snapshots().map((d) => d.data() ?? {});

  static Future<void> saveMyIdInfo(AppUser me, Map<String, String> fields) =>
      idInfo.doc(me.id).set({
        ...fields,
        'ownerType': 'staff',
        'name': me.name,
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
  }) async {
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
      'ownerId': me.id,
      'ownerType': 'staff',
      'ownerName': me.name,
      'kind': kind,
      'name': name,
      'mime': mime,
      'size': bytes.length,
      'chunks': n,
      'uploadedAt': FieldValue.serverTimestamp(),
      'uploadedBy': me.name,
    });
    await batch.commit();
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
}
