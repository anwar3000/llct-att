import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/models.dart';

/// LLCT Service Desk: client service requests (CCTV AMC etc.) raised from the client's link
/// or by staff, worked from the attendance app. Same data as the web desk (svcTickets).
///
/// svcTickets/{id}                       – the ticket (staff)
/// svcPortals/{token}/tickets/{id}        – what the client sees (status, technician, visit time)

DateTime? _ts(dynamic v) => v is Timestamp ? v.toDate() : (v is DateTime ? v : null);
String _s(dynamic v) => v is String ? v : '';
double? _d(dynamic v) => v is num ? v.toDouble() : null;

class SvcPriority {
  final String key;
  final String label;
  final Color color;
  final int hours;
  const SvcPriority(this.key, this.label, this.color, this.hours);
}

class SvcStatus {
  final String label;
  final Color color;
  const SvcStatus(this.label, this.color);
}

const svcPriorities = [
  SvcPriority('critical', 'Critical', Color(0xFFD64545), 4),
  SvcPriority('high', 'High', Color(0xFFE08E2B), 24),
  SvcPriority('normal', 'Normal', Color(0xFF3A7BD5), 48),
  SvcPriority('low', 'Low', Color(0xFF75757A), 96),
];
SvcPriority svcPriority(String k) => svcPriorities.firstWhere((p) => p.key == k, orElse: () => svcPriorities[2]);

const svcStatuses = {
  'new': SvcStatus('New', Color(0xFFD64545)),
  'assigned': SvcStatus('Assigned', Color(0xFF8E5CC4)),
  'accepted': SvcStatus('Accepted', Color(0xFF3A7BD5)),
  'on_way': SvcStatus('On the way', Color(0xFFE08E2B)),
  'on_site': SvcStatus('At site', Color(0xFFD98A1A)),
  'completed': SvcStatus('Completed', Color(0xFF2E9E6A)),
  'closed': SvcStatus('Closed', Color(0xFF404041)),
  'cancelled': SvcStatus('Cancelled', Color(0xFF75757A)),
};
SvcStatus svcStatus(String k) => svcStatuses[k] ?? SvcStatus(k, const Color(0xFF75757A));

const svcTypes = {
  'camera': 'CCTV camera not working',
  'recording': 'NVR / DVR not recording',
  'remote': 'No remote / mobile view',
  'image': 'Image blurry, dark or no night vision',
  'hdd': 'Hard disk / storage error',
  'playback': 'Footage backup / playback needed',
  'power': 'Power, cable or PoE issue',
  'network': 'Network / Wi-Fi / internet',
  'access': 'Access control / door / intercom',
  'ppm': 'Preventive maintenance (AMC visit)',
  'install': 'New camera / relocation',
  'other': 'Other',
};
String svcTypeLabel(String k) => svcTypes[k] ?? (k.isEmpty ? 'Service' : k);

const svcSlots = {
  'asap': 'As soon as possible',
  'morning': 'Morning (8 am – 12 pm)',
  'afternoon': 'Afternoon (12 – 4 pm)',
  'evening': 'Evening (4 – 8 pm)',
  'any': 'Any time that day',
};

class ServiceTicket {
  final String id;
  final String number;
  final String portal;
  final String clientId;
  final String clientName;
  final String siteName;
  final String siteAddress;
  final double? lat;
  final double? lng;
  final String contactName;
  final String contactPhone;
  final String category;
  final String description;
  final String priority;
  final String preferredDate;
  final String preferredSlot;
  final String status;
  final bool open;
  final String assignedTo;
  final String assignedName;
  final String assignedByName;
  final DateTime? scheduledAt;
  final DateTime? createdAt;
  final String reportId;
  final String reportNo;
  final String techNote;
  final int cameras;
  final String source;
  final List<String> photos;
  final List<Map<String, dynamic>> log;

  ServiceTicket({
    required this.id,
    required this.number,
    required this.portal,
    required this.clientId,
    required this.clientName,
    required this.siteName,
    required this.siteAddress,
    required this.lat,
    required this.lng,
    required this.contactName,
    required this.contactPhone,
    required this.category,
    required this.description,
    required this.priority,
    required this.preferredDate,
    required this.preferredSlot,
    required this.status,
    required this.open,
    required this.assignedTo,
    required this.assignedName,
    required this.assignedByName,
    required this.scheduledAt,
    required this.createdAt,
    required this.reportId,
    required this.reportNo,
    required this.techNote,
    required this.cameras,
    required this.source,
    required this.photos,
    required this.log,
  });

  factory ServiceTicket.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) {
    final m = d.data() ?? {};
    final lat = _d(m['lat']), lng = _d(m['lng']);
    return ServiceTicket(
      id: d.id,
      number: _s(m['number']).isEmpty ? d.id : _s(m['number']),
      portal: _s(m['portal']),
      clientId: _s(m['clientId']),
      clientName: _s(m['clientName']),
      siteName: _s(m['siteName']),
      siteAddress: _s(m['siteAddress']),
      lat: lat,
      lng: lng,
      contactName: _s(m['contactName']),
      contactPhone: _s(m['contactPhone']),
      category: _s(m['category']),
      description: _s(m['description']),
      priority: _s(m['priority']).isEmpty ? 'normal' : _s(m['priority']),
      preferredDate: _s(m['preferredDate']),
      preferredSlot: _s(m['preferredSlot']),
      status: _s(m['status']).isEmpty ? 'new' : _s(m['status']),
      open: m['open'] == true,
      assignedTo: _s(m['assignedTo']),
      assignedName: _s(m['assignedName']),
      assignedByName: _s(m['assignedByName']),
      scheduledAt: _ts(m['scheduledAt']),
      createdAt: _ts(m['createdAt']),
      reportId: _s(m['reportId']),
      reportNo: _s(m['reportNo']),
      techNote: _s(m['techNote']),
      cameras: m['cameras'] is num ? (m['cameras'] as num).toInt() : 0,
      source: _s(m['source']),
      photos: (m['photos'] is List) ? (m['photos'] as List).whereType<String>().toList() : const [],
      log: (m['log'] is List)
          ? (m['log'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
          : const [],
    );
  }

  bool get hasGps => lat != null && lng != null && !(lat == 0 && lng == 0);
  bool get unassigned => status == 'new' && assignedTo.isEmpty;
  bool isMine(String uid) => assignedTo == uid;
  SvcPriority get prio => svcPriority(priority);
  SvcStatus get stat => svcStatus(status);
  String get typeLabel => svcTypeLabel(category);
  DateTime? get respondBy => createdAt?.add(Duration(hours: prio.hours));
  bool get overdue => open && respondBy != null && DateTime.now().isAfter(respondBy!);

  /// Photo bytes as plain base64 (the portal stores data URLs).
  List<String> get photosBase64 => photos.map((p) {
        final i = p.indexOf('base64,');
        return i >= 0 ? p.substring(i + 7) : p;
      }).toList();
}

/// One live list of open tickets for the whole app (popups, badge, jobs screen).
class ServiceHub {
  ServiceHub._();
  static final tickets = ValueNotifier<List<ServiceTicket>?>(null);
  static final error = ValueNotifier<String?>(null);
  static StreamSubscription? _sub;
  static int _users = 0;

  static void attach() {
    _users++;
    if (_sub != null) return;
    _sub = FirebaseFirestore.instance
        .collection('svcTickets')
        .where('open', isEqualTo: true)
        .snapshots()
        .listen((q) {
      final l = q.docs.map(ServiceTicket.fromDoc).toList()
        ..sort((a, b) => (b.createdAt ?? DateTime(2000)).compareTo(a.createdAt ?? DateTime(2000)));
      error.value = null;
      tickets.value = l;
    }, onError: (e) {
      // Usually: the new Firestore rules are not published yet.
      error.value = '$e';
      tickets.value ??= const [];
    });
  }

  static void detach() {
    _users--;
    if (_users > 0) return;
    _users = 0;
    _sub?.cancel();
    _sub = null;
    tickets.value = null;
  }
}

class ServiceDesk {
  ServiceDesk._();
  static final _fs = FirebaseFirestore.instance;
  static const invoicingBase = 'https://anwar3000.github.io/llct-invoice/';

  static String _when(DateTime? d) {
    if (d == null) return '';
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
    return ' on ${d.day} ${mon[d.month - 1]} ${d.year}, $h:${d.minute.toString().padLeft(2, '0')} ${d.hour >= 12 ? 'pm' : 'am'}';
  }

  /// Writes the ticket change and the client's view in one batch, with a log line each.
  static Future<void> update(ServiceTicket t, AppUser me, Map<String, dynamic> changes, String logText,
      {String? clientText}) async {
    final b = _fs.batch();
    final at = Timestamp.now();
    b.update(_fs.collection('svcTickets').doc(t.id), {
      ...changes,
      'updatedAt': FieldValue.serverTimestamp(),
      'log': FieldValue.arrayUnion([
        {'at': at, 'by': me.id, 'byName': me.name, 't': logText}
      ]),
    });
    if (t.portal.isNotEmpty) {
      final assignedTo = changes.containsKey('assignedTo') ? (changes['assignedTo'] as String? ?? '') : t.assignedTo;
      final assignedName = changes.containsKey('assignedName') ? (changes['assignedName'] as String? ?? '') : t.assignedName;
      final sched = changes.containsKey('scheduledAt') ? changes['scheduledAt'] : (t.scheduledAt == null ? null : Timestamp.fromDate(t.scheduledAt!));
      final pub = <String, dynamic>{
        'status': changes['status'] ?? t.status,
        'priority': changes['priority'] ?? t.priority,
        'updatedAt': FieldValue.serverTimestamp(),
        'assignedName': assignedTo.isEmpty ? FieldValue.delete() : assignedName,
        'scheduledAt': (assignedTo.isEmpty || sched == null) ? FieldValue.delete() : sched,
      };
      final rn = changes['reportNo'] ?? t.reportNo;
      if (rn is String && rn.isNotEmpty) pub['reportNo'] = rn;
      if (clientText != null) {
        pub['log'] = FieldValue.arrayUnion([
          {'at': at, 't': clientText}
        ]);
      }
      b.set(_fs.collection('svcPortals').doc(t.portal).collection('tickets').doc(t.id), pub, SetOptions(merge: true));
    }
    await b.commit();
  }

  /// Take an unassigned request, or confirm one assigned to me.
  static Future<void> accept(ServiceTicket t, AppUser me) {
    if (t.unassigned) {
      return update(
          t,
          me,
          {
            'status': 'accepted',
            'assignedTo': me.id,
            'assignedName': me.name,
            'assignedAt': FieldValue.serverTimestamp(),
            'assignedBy': me.id,
            'assignedByName': me.name,
            'acceptedAt': FieldValue.serverTimestamp(),
          },
          'Picked up by ${me.name}',
          clientText: 'Assigned to our technical team — technician ${me.name} will visit as per your preferred time');
    }
    return update(t, me, {'status': 'accepted', 'acceptedAt': FieldValue.serverTimestamp()}, 'Accepted by ${me.name}',
        clientText: 'Technician ${me.name} confirmed the visit${_when(t.scheduledAt)}');
  }

  static Future<void> setStatus(ServiceTicket t, AppUser me, String s) {
    final tech = t.assignedName.isEmpty ? 'Our technician' : 'Technician ${t.assignedName}';
    switch (s) {
      case 'on_way':
        return update(t, me, {'status': s, 'onWayAt': FieldValue.serverTimestamp()}, 'On the way',
            clientText: '$tech is on the way');
      case 'on_site':
        return update(t, me, {'status': s, 'arrivedAt': FieldValue.serverTimestamp()}, 'Arrived at site',
            clientText: '$tech arrived at site');
      case 'completed':
        return update(t, me, {'status': s, 'completedAt': FieldValue.serverTimestamp()}, 'Work completed',
            clientText: 'Work completed');
    }
    return Future.value();
  }

  static Future<void> handBack(ServiceTicket t, AppUser me, String reason) => update(
      t,
      me,
      {
        'status': 'new',
        'assignedTo': null,
        'assignedName': '',
        'assignedAt': null,
        'assignedBy': '',
        'assignedByName': '',
        'acceptedAt': null,
        'scheduledAt': null,
      },
      'Handed back by ${me.name}${reason.isEmpty ? '' : ': $reason'}',
      clientText: 'Our team is re-assigning a technician');

  static Future<void> assign(ServiceTicket t, AppUser me, AppUser tech, DateTime? when, {String note = ''}) {
    final same = t.assignedTo == tech.id;
    final keep = same && ['accepted', 'on_way', 'on_site'].contains(t.status);
    return update(
        t,
        me,
        {
          'status': keep ? t.status : 'assigned',
          'assignedTo': tech.id,
          'assignedName': tech.name,
          'assignedAt': FieldValue.serverTimestamp(),
          'assignedBy': me.id,
          'assignedByName': me.name,
          'scheduledAt': when == null ? null : Timestamp.fromDate(when),
          if (note.isNotEmpty) 'techNote': note,
        },
        '${same ? 'Visit updated' : 'Assigned to ${tech.name}'}${when == null ? '' : ' — visit${_when(when)}'}${note.isEmpty ? '' : ' (note: $note)'}',
        clientText:
            'Assigned to our technical team — technician ${tech.name} will visit${when == null ? ' as per your preferred time' : _when(when)}');
  }

  static Future<void> addNote(ServiceTicket t, AppUser me, String note) =>
      update(t, me, me.assignsService ? <String, dynamic>{} : {'techNote': note}, 'Note: $note');

  static Stream<List<AppUser>> staff() => _fs.collection('users').snapshots().map((q) => q.docs
      .map(AppUser.fromDoc)
      .where((u) => u.active && u.role != 'docs')
      .toList()
    ..sort((a, b) => a.name.compareTo(b.name)));

  static Future<bool> _open(Uri u) =>
      launchUrl(u, mode: LaunchMode.externalApplication).catchError((_) => false);

  static Future<bool> navigate(ServiceTicket t) {
    if (t.hasGps) {
      return _open(Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${t.lat},${t.lng}&travelmode=driving'));
    }
    return _open(Uri.parse(
        'https://www.google.com/maps/search/?api=1&query=${Uri.encodeComponent('${t.siteName} ${t.siteAddress}')}'));
  }

  static Future<bool> call(String phone) => _open(Uri.parse('tel:${phone.replaceAll(RegExp(r'[^\d+]'), '')}'));

  /// Opens LLCT Invoicing with a service report pre-filled from this ticket.
  static Future<bool> openReport(ServiceTicket t) {
    final p = {'type': 'delivery', 'rt': 'service', 'tk': t.id};
    final url = Uri.parse('$invoicingBase#/edit?${Uri.encodeComponent(jsonEncode(p))}');
    return launchUrl(url, mode: LaunchMode.inAppBrowserView)
        .catchError((_) => launchUrl(url, mode: LaunchMode.externalApplication));
  }

  static Future<bool> openReportView(ServiceTicket t) {
    final url = Uri.parse('$invoicingBase#/view?${Uri.encodeComponent(jsonEncode({'id': t.reportId}))}');
    return launchUrl(url, mode: LaunchMode.inAppBrowserView)
        .catchError((_) => launchUrl(url, mode: LaunchMode.externalApplication));
  }

  /// The web service desk address (saved by the desk itself in settings/service).
  static Future<String?> deskUrl() async {
    try {
      final d = await _fs.collection('settings').doc('service').get();
      final u = d.data()?['deskUrl'];
      return u is String && u.isNotEmpty ? u : null;
    } catch (_) {
      return null;
    }
  }
}
