import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:image_picker/image_picker.dart';

import '../core/utils.dart';
import '../models/models.dart';

/// Service reports, call-out reports and delivery notes made inside the attendance app.
/// They are the SAME documents as LLCT Invoicing (inv_docs, type 'delivery'), with the same
/// numbering (SRV / COR / DLN + ddmmyy + 3 digits, claimed in inv_numbers), photos in inv_images
/// and client sites in inv_clients — so they show up in invoicing exactly as if made there.

final _fs = FirebaseFirestore.instance;
final _rnd = Random();
String invUid() =>
    DateTime.now().millisecondsSinceEpoch.toRadixString(36) +
    List.generate(6, (_) => '0123456789abcdefghijklmnopqrstuvwxyz'[_rnd.nextInt(36)]).join();
String isoNow() => DateTime.now().toUtc().toIso8601String();

class ReportKind {
  final String key; // '' for delivery note (no reportType stored), 'service', 'callout'
  final String title;
  final String short;
  final String prefix;
  final String who;
  final String sign;
  final String ok;
  final String photos;
  final List<String> statuses;
  const ReportKind(this.key, this.title, this.short, this.prefix, this.who, this.sign, this.ok, this.photos, this.statuses);
  bool get isService => key.isNotEmpty;
}

const kindDelivery = ReportKind('', 'Delivery Note', 'DN', 'DLN', 'Deliver to', 'Received by',
    'Received in good condition. Thank you for your acceptance.', 'Proof of delivery',
    ['Delivered', 'Delivered & installed', 'Installed', 'Partially delivered', 'Pending']);
const kindService = ReportKind('service', 'Service Report', 'SR', 'SRV', 'Customer', 'Customer confirmation',
    'Work completed to satisfaction. Thank you for your acceptance.', 'Site photos',
    ['Completed', 'Attended', 'Repaired', 'Replaced', 'Pending parts', 'Follow-up required']);
const kindCallout = ReportKind('callout', 'Call-out Attendance Report', 'CO', 'COR', 'Customer', 'Customer confirmation',
    'Call-out attended. Thank you for your acceptance.', 'Site photos',
    ['Attended', 'Completed', 'Temporary fix', 'Pending parts', 'Follow-up required']);
const reportKinds = [kindService, kindCallout, kindDelivery];
ReportKind kindOf(String rt) => rt == 'service' ? kindService : (rt == 'callout' ? kindCallout : kindDelivery);

const photoLabels = ['Before the work', 'After the work'];

/// Company settings from LLCT Invoicing (inv_config/company), with the same defaults.
class InvConfig {
  final Map<String, dynamic> m;
  InvConfig(this.m);
  static const defaults = <String, dynamic>{
    'name': 'LEADERS LINE TRADING LLC',
    'address': 'M05, Al Nisf, Airport Road\nDubai, UAE',
    'phone': '04 880 5577',
    'email': 'anwar@llct.net',
    'website': 'www.llct.net  ·  www.o2iot.ae',
    'taxId': '100362683300003',
    'taxIdLabel': 'TRN',
    'dnEmail': 'service@llct.net / mekha@llct.net',
    'taxRate': 5,
    'tagline': 'SECURITY | IoT | AUTOMATION | SOLUTIONS',
    'brand': '#B8285E',
    'charcoal': '#17375F',
    'logo': 'assets/logo.png',
    'signature': '',
    'signName': '',
    'stamp': '',
  };
  String s(String k) => (m[k] ?? defaults[k] ?? '').toString();
  num get taxRate => (m['taxRate'] is num) ? m['taxRate'] as num : 5;
  String get deliveryTerms {
    final t = m['terms'];
    if (t is Map && t['delivery'] is String) return t['delivery'] as String;
    return 'Goods received in good condition. Please check serial numbers against this note.';
  }

  String get deliveryPrefix {
    final p = m['prefix'];
    final v = p is Map ? p['delivery'] : null;
    return (v is String && v.isNotEmpty && !['QT-', 'INV-', 'DN-', 'QUT'].contains(v)) ? v : 'DLN';
  }

  static InvConfig? _cache;
  static Future<InvConfig> load() async {
    if (_cache != null) return _cache!;
    try {
      final d = await _fs.collection('inv_config').doc('company').get();
      _cache = InvConfig(d.data() ?? {});
    } catch (_) {
      _cache = InvConfig({});
    }
    return _cache!;
  }
}

/// What this person may do in invoicing (inv_access/{uid}); admins may do everything.
class InvAccess {
  final bool admin;
  final bool enabled;
  final Map perms;
  const InvAccess(this.admin, this.enabled, this.perms);
  bool can(String p) => admin || (enabled && perms[p] == true);
  bool get makes => can('delivery');
  bool get signs => can('deliver') || can('delivery');
  bool get seesAll => can('viewAll') || can('delivery') || can('deliver');
  bool get any => admin || enabled;

  static Future<InvAccess> load(AppUser me) async {
    if (me.isAdmin) return const InvAccess(true, true, {});
    try {
      final d = await _fs.collection('inv_access').doc(me.id).get();
      final m = d.data();
      if (m == null) return const InvAccess(false, false, {});
      return InvAccess(false, m['enabled'] != false, (m['perms'] as Map?) ?? const {});
    } catch (_) {
      return const InvAccess(false, false, {});
    }
  }
}

class InvSite {
  final String id, name, address, contact, phone;
  final double? lat, lng;
  final double radius;
  InvSite(this.id, this.name, this.address, this.contact, this.phone, this.lat, this.lng, this.radius);
  bool get hasGps => lat != null && lng != null;
  String get text => [name, address].where((x) => x.isNotEmpty).join(', ');
}

class InvClient {
  final String id;
  final Map<String, dynamic> m;
  InvClient(this.id, this.m);
  String get name => (m['name'] ?? '').toString();
  String _s(String k) => (m[k] ?? '').toString();
  List<InvSite> get sites {
    final l = m['places'];
    if (l is! List) return const [];
    final out = <InvSite>[];
    for (var i = 0; i < l.length; i++) {
      final p = l[i];
      if (p is! Map) continue;
      double? n(dynamic v) => v is num ? v.toDouble() : (v is String ? double.tryParse(v) : null);
      out.add(InvSite((p['id'] ?? 's$i').toString(), (p['name'] ?? 'Site').toString(), (p['address'] ?? '').toString(),
          (p['contact'] ?? '').toString(), (p['phone'] ?? '').toString(), n(p['lat']), n(p['lng']), n(p['radius']) ?? 150));
    }
    return out;
  }

  /// Same snapshot as invoicing's clientSnap().
  Map<String, dynamic> snap() => {
        'name': name,
        'contact': _s('contact'),
        'address': _s('address'),
        'phone': _s('phone'),
        'email': _s('email'),
        'taxId': _s('taxId'),
      };
}

class NearMatch {
  final InvClient client;
  final InvSite site;
  final double dist;
  NearMatch(this.client, this.site, this.dist);
}

double _dist(double lat1, double lng1, double lat2, double lng2) {
  const r = 6371000.0;
  double rad(double x) => x * pi / 180;
  final dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  final q = sin(dLat / 2) * sin(dLat / 2) + cos(rad(lat1)) * cos(rad(lat2)) * sin(dLng / 2) * sin(dLng / 2);
  return 2 * r * asin(sqrt(q));
}

/// One report (an inv_docs document of type 'delivery').
class InvReport {
  final String id;
  final Map<String, dynamic> m;
  InvReport(this.id, this.m);
  factory InvReport.fromDoc(DocumentSnapshot<Map<String, dynamic>> d) => InvReport(d.id, d.data() ?? {});

  String s(String k) => (m[k] ?? '').toString();
  ReportKind get kind => kindOf(s('reportType'));
  String get number => s('number');
  String get date => s('date');
  String get clientName => (m['client'] is Map ? (m['client'] as Map)['name'] : null)?.toString() ?? '';
  Map get delivery => m['delivery'] is Map ? m['delivery'] as Map : const {};
  bool get signed => (delivery['signedAt'] ?? '').toString().isNotEmpty;
  List<Map<String, dynamic>> get items => (m['items'] is List)
      ? (m['items'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
      : <Map<String, dynamic>>[];
  List<Map<String, dynamic>> get attachments => (m['attachments'] is List)
      ? (m['attachments'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
      : <Map<String, dynamic>>[];
  DateTime? get createdAt => DateTime.tryParse(s('createdAt'))?.toLocal();
  String get place => s('deliveryAddress').isNotEmpty ? s('deliveryAddress') : s('siteName');
}

class InvReports {
  InvReports._();

  static Stream<List<InvClient>> clients() => _fs.collection('inv_clients').snapshots().map((q) =>
      q.docs.map((d) => InvClient(d.id, d.data())).toList()..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase())));

  /// Everyone with delivery access sees all reports; others only their own.
  static Stream<List<InvReport>> list(AppUser me, InvAccess acc) {
    Query<Map<String, dynamic>> q = _fs.collection('inv_docs');
    q = acc.seesAll ? q.where('type', isEqualTo: 'delivery') : q.where('createdBy', isEqualTo: me.id);
    return q.snapshots().map((s) {
      final l = s.docs.map(InvReport.fromDoc).where((r) => r.s('type') == 'delivery').toList()
        ..sort((a, b) {
          final x = b.date.compareTo(a.date);
          return x != 0 ? x : b.s('createdAt').compareTo(a.s('createdAt'));
        });
      return l;
    });
  }

  static Stream<InvReport?> watch(String id) =>
      _fs.collection('inv_docs').doc(id).snapshots().map((d) => d.exists ? InvReport.fromDoc(d) : null);

  static List<NearMatch> nearby(List<InvClient> clients, double lat, double lng, double acc) {
    final slack = min(acc, 100.0);
    final out = <NearMatch>[];
    for (final c in clients) {
      for (final s in c.sites) {
        if (!s.hasGps) continue;
        final d = _dist(lat, lng, s.lat!, s.lng!);
        if (d <= s.radius + slack) out.add(NearMatch(c, s, d));
      }
    }
    out.sort((a, b) => a.dist.compareTo(b.dist));
    return out.take(5).toList();
  }

  static String _ddmmyy(String iso) => iso.length >= 10 ? iso.substring(8, 10) + iso.substring(5, 7) + iso.substring(2, 4) : '';
  static String prefixFor(ReportKind k, InvConfig cfg) => k.isService ? k.prefix : cfg.deliveryPrefix;
  static String suggestNumber(ReportKind k, InvConfig cfg, String date) =>
      '${prefixFor(k, cfg)}${_ddmmyy(date)}${(1 + _rnd.nextInt(999)).toString().padLeft(3, '0')}';

  /// Claims a number in inv_numbers so no two documents share one (same as invoicing).
  static Future<String> reserveNumber(ReportKind k, InvConfig cfg, String date, String uid, {String? preferred}) async {
    final pre = '${prefixFor(k, cfg)}${_ddmmyy(date)}';
    String? cand = (preferred != null && preferred.startsWith(pre)) ? preferred : null;
    for (var i = 0; i < 30; i++) {
      final n = cand ?? '$pre${(1 + _rnd.nextInt(999)).toString().padLeft(3, '0')}';
      cand = null;
      try {
        final ok = await _fs.runTransaction<bool>((tx) async {
          final ref = _fs.collection('inv_numbers').doc(n);
          final sn = await tx.get(ref);
          if (sn.exists) return false;
          tx.set(ref, {'type': 'delivery', 'by': uid, 'at': isoNow()});
          return true;
        });
        if (ok) return n;
      } catch (_) {
        return n;
      }
    }
    return '$pre${(1 + _rnd.nextInt(999)).toString().padLeft(3, '0')}';
  }

  /// A new, empty report — same fields as invoicing's newDraft().
  static Map<String, dynamic> newDraft(ReportKind k, InvConfig cfg, AppUser me) {
    final date = dateKey(DateTime.now());
    return {
      'type': 'delivery',
      if (k.isService) 'reportType': k.key,
      'number': suggestNumber(k, cfg, date),
      'date': date,
      'dueDate': '',
      'validUntil': '',
      'clientId': '',
      'client': null,
      'ref': '',
      'subject': '',
      'salesperson': '',
      'deliveryAddress': '',
      'items': k.isService ? <Map<String, dynamic>>[] : [newItem(k)],
      'discount': 0,
      'taxRate': cfg.taxRate,
      'notes': '',
      'terms': cfg.deliveryTerms,
      'status': '',
      'createdBy': me.id,
      'createdByName': me.name,
      'contactName': me.name,
      'contactMobile': '',
      'contactEmail': cfg.s('dnEmail'),
      if (k.isService) 'technician': me.name,
      'attachments': <Map<String, dynamic>>[],
      'createdAt': isoNow(),
    };
  }

  static Map<String, dynamic> newItem(ReportKind k) =>
      {'name': '', 'desc': '', 'qty': 1, 'unit': 'pcs', 'price': 0, 'photo': '', 'status': k.statuses.first, 'serials': <String>[]};

  /// Saves (creates or replaces) the report. New reports get their number claimed first.
  static Future<InvReport> save(String? id, Map<String, dynamic> d, AppUser me, InvConfig cfg, {bool isNew = false}) async {
    final docId = id ?? invUid();
    final k = kindOf((d['reportType'] ?? '').toString());
    if (isNew) {
      d['number'] = await reserveNumber(k, cfg, (d['date'] ?? dateKey(DateTime.now())).toString(), me.id,
          preferred: (d['number'] ?? '').toString());
    } else {
      d['updatedBy'] = me.name;
    }
    d['items'] = (d['items'] as List? ?? const [])
        .whereType<Map>()
        .where((i) => '${i['name'] ?? ''}'.trim().isNotEmpty || '${i['desc'] ?? ''}'.trim().isNotEmpty)
        .toList();
    d['updatedAt'] = isoNow();
    await _fs.collection('inv_docs').doc(docId).set(d);
    final r = InvReport(docId, d);
    if (isNew) _rememberPlace(r).catchError((_) {});
    if (isNew) linkTicket(r, me).catchError((_) {});
    return r;
  }

  /// Customer / receiver sign-off: only items, delivery, attachments and updatedAt change (as in invoicing).
  static Future<void> signOff(InvReport r, AppUser me,
      {required List<Map<String, dynamic>> items,
      required List<Map<String, dynamic>> attachments,
      required String receiver,
      required String receiverPhone,
      required String signature,
      Map<String, dynamic>? gps}) async {
    final delivery = {
      'receiver': receiver,
      'receiverPhone': receiverPhone,
      'signature': signature,
      'signedAt': isoNow(),
      'deliveredBy': me.id,
      'deliveredByName': me.name,
      'gps': gps,
    };
    final upd = {'items': items, 'attachments': attachments, 'delivery': delivery, 'updatedAt': isoNow()};
    await _fs.collection('inv_docs').doc(r.id).update(upd);
    linkTicket(InvReport(r.id, {...r.m, ...upd}), me).catchError((_) {});
  }

  static Future<void> saveWithoutSigning(InvReport r, List<Map<String, dynamic>> items, List<Map<String, dynamic>> attachments) =>
      _fs.collection('inv_docs').doc(r.id).update({'items': items, 'attachments': attachments, 'updatedAt': isoNow()});

  /// Remember where a client was served (same rule as invoicing's rememberPlace()).
  static Future<void> _rememberPlace(InvReport r) async {
    final g = r.m['gps'];
    final cid = r.s('clientId');
    if (g is! Map || g['lat'] is! num || g['lng'] is! num || cid.isEmpty) return;
    if ((g['acc'] is num ? g['acc'] as num : 0) > 300) return;
    final lat = (g['lat'] as num).toDouble(), lng = (g['lng'] as num).toDouble();
    final ref = _fs.collection('inv_clients').doc(cid);
    final snap = await ref.get();
    final c = InvClient(cid, snap.data() ?? {});
    if (c.sites.any((s) => s.hasGps && _dist(s.lat!, s.lng!, lat, lng) <= s.radius)) return;
    final places = ((snap.data() ?? {})['places'] as List? ?? const []).map((e) => e is Map ? Map<String, dynamic>.from(e) : e).toList();
    final siteId = r.s('siteId');
    final i = siteId.isEmpty ? -1 : c.sites.indexWhere((s) => s.id == siteId);
    if (i >= 0 && !c.sites[i].hasGps && i < places.length && places[i] is Map) {
      final p = Map<String, dynamic>.from(places[i] as Map);
      places[i] = {...p, 'id': siteId, 'lat': lat, 'lng': lng, 'radius': p['radius'] ?? 150};
    } else {
      final nm = (r.s('siteName').isNotEmpty ? r.s('siteName') : (r.place.isNotEmpty ? r.place : 'Site')).split('\n').first;
      places.add({
        'id': invUid(),
        'name': nm.length > 80 ? nm.substring(0, 80) : nm,
        'address': r.s('siteName').isNotEmpty ? r.s('siteAddress') : '',
        'lat': lat,
        'lng': lng,
        'radius': 150,
        'addedAt': isoNow(),
      });
    }
    await ref.update({'places': places, 'updatedAt': isoNow()});
  }

  /// Report number back to the service ticket (and the client's tracking link); signing completes it.
  static Future<void> linkTicket(InvReport r, AppUser me) async {
    final tid = r.s('ticketId');
    if (tid.isEmpty) return;
    final ref = _fs.collection('svcTickets').doc(tid);
    final s = await ref.get();
    if (!s.exists) return;
    final t = s.data() ?? {};
    final at = Timestamp.now();
    final up = <String, dynamic>{
      'reportId': r.id,
      'reportNo': r.number,
      'updatedAt': FieldValue.serverTimestamp(),
      'log': FieldValue.arrayUnion([
        {'at': at, 'by': me.id, 'byName': me.name, 't': 'Service report ${r.number}${r.signed ? ' signed by customer' : ' created'}'}
      ]),
    };
    if (r.signed && t['open'] == true && ['assigned', 'accepted', 'on_way', 'on_site'].contains(t['status'])) {
      up['status'] = 'completed';
      up['completedAt'] = FieldValue.serverTimestamp();
    }
    final b = _fs.batch()..update(ref, up);
    final portal = (t['portal'] ?? '').toString();
    if (portal.isNotEmpty) {
      b.set(
          _fs.collection('svcPortals').doc(portal).collection('tickets').doc(tid),
          {
            'reportNo': r.number,
            'updatedAt': FieldValue.serverTimestamp(),
            if (up['status'] != null) 'status': up['status'],
            'log': FieldValue.arrayUnion([
              {'at': at, 't': r.signed ? 'Work completed — service report ${r.number}' : 'Service report ${r.number} prepared'}
            ]),
          },
          SetOptions(merge: true));
    }
    await b.commit();
  }

  // ------------------------------------------------------------------ photos (inv_images)
  static final _picker = ImagePicker();
  static final Map<String, Uint8List> _imgCache = {};

  /// Takes / picks a photo, stores it in inv_images and returns an attachment entry.
  static Future<Map<String, dynamic>?> addPhoto(AppUser me, {required bool camera, String caption = ''}) async {
    final x = await _picker.pickImage(
        source: camera ? ImageSource.camera : ImageSource.gallery, maxWidth: 1400, maxHeight: 1400, imageQuality: 62);
    if (x == null) return null;
    var bytes = await x.readAsBytes();
    if (bytes.length > 650 * 1024) {
      final y = await _picker.pickImage(
          source: camera ? ImageSource.camera : ImageSource.gallery, maxWidth: 900, maxHeight: 900, imageQuality: 50);
      if (y == null) return null;
      bytes = await y.readAsBytes();
      if (bytes.length > 650 * 1024) throw Exception('Photo is too large. Please retake it.');
    }
    final id = invUid();
    final data = 'data:image/jpeg;base64,${base64Encode(bytes)}';
    await _fs.collection('inv_images').doc(id).set({
      'data': data,
      'name': x.name,
      'mime': 'image/jpeg',
      'createdBy': me.id,
      'createdAt': isoNow(),
    });
    _imgCache[id] = bytes;
    return {'ref': 'img:$id', 'kind': 'image', 'name': x.name, 'caption': caption, 'inPdf': true, 'size': 'M', 'proof': true};
  }

  /// Bytes of an image reference: 'img:<id>' (inv_images), a data URL, or nothing.
  static Future<Uint8List?> imageBytes(String ref) async {
    if (ref.isEmpty) return null;
    if (ref.startsWith('data:')) {
      final i = ref.indexOf('base64,');
      return i < 0 ? null : base64Decode(ref.substring(i + 7));
    }
    if (!ref.startsWith('img:')) return null;
    final id = ref.substring(4);
    final hit = _imgCache[id];
    if (hit != null) return hit;
    try {
      final d = await _fs.collection('inv_images').doc(id).get();
      final data = (d.data()?['data'] ?? '').toString();
      final i = data.indexOf('base64,');
      if (i < 0) return null;
      final b = base64Decode(data.substring(i + 7));
      if (_imgCache.length > 60) _imgCache.clear();
      _imgCache[id] = b;
      return b;
    } catch (_) {
      return null;
    }
  }
}
