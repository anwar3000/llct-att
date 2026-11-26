import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:intl/intl.dart';
import 'package:latlong2/latlong.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/db.dart';
import '../../services/trip_statement.dart';
import '../../widgets/common.dart';
import '../../widgets/ride_charge.dart';
import '../../widgets/map_widgets.dart';
import '../../widgets/trip_card.dart' show kDialogButton;
import 'admin_live.dart';
import 'id_documents_screen.dart' show runWithProgress;

const _purple = Color(0xFF7B4FC9);

/// Management: every driver trip and staff ride with details — by period and type,
/// expense by site and by person, and (admin) driver accounts & payments.
class TripsTab extends StatefulWidget {
  final AppUser me;
  final AdminLive live;
  const TripsTab({super.key, required this.me, required this.live});

  @override
  State<TripsTab> createState() => _TripsTabState();
}

class _TripsTabState extends State<TripsTab> {
  String _period = 'month';
  String _kind = '';
  String _view = 'list';
  String _person = '';
  DateTimeRange? _custom;
  List<AppUser> _drivers = [];
  StreamSubscription? _dsub;
  StreamSubscription? _sub;
  List<Trip> _trips = [];
  bool _loading = true;
  Object? _error;

  bool get _money => widget.me.isAdmin;

  @override
  void initState() {
    super.initState();
    _load();
    _dsub = Db.driversStream().listen((l) {
      if (mounted) setState(() => _drivers = l);
    }, onError: (_) {});
  }

  ({String from, String to}) _range() {
    final n = DateTime.now();
    switch (_period) {
      case 'today':
        return (from: dateKey(n), to: dateKey(n));
      case 'yday':
        final y = n.subtract(const Duration(days: 1));
        return (from: dateKey(y), to: dateKey(y));
      case '7':
        return (from: dateKey(n.subtract(const Duration(days: 6))), to: dateKey(n));
      case 'last':
        final f = DateTime(n.year, n.month - 1, 1), t = DateTime(n.year, n.month, 0);
        return (from: dateKey(f), to: dateKey(t));
      case 'all':
        return (from: '2020-01-01', to: dateKey(n));
      case 'pick':
        if (_custom != null) return (from: dateKey(_custom!.start), to: dateKey(_custom!.end));
        return (from: dateKey(DateTime(n.year, n.month, 1)), to: dateKey(n));
      default:
        return (from: dateKey(DateTime(n.year, n.month, 1)), to: dateKey(n));
    }
  }

  void _load() {
    _sub?.cancel();
    setState(() {
      _loading = true;
      _error = null;
    });
    final r = _range();
    _sub = Db.tripsInRange(r.from, r.to).listen((l) {
      if (mounted) setState(() {
        _trips = l;
        _loading = false;
      });
    }, onError: (e) {
      if (mounted) setState(() {
        _error = e;
        _loading = false;
      });
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    _dsub?.cancel();
    super.dispose();
  }

  /// Driver trip: km × driver's rate. Company-driver ride: km × that driver's rate. Taxi: the fare.
  double _costOf(Trip t) {
    // Staff rides from the approval start: only the provider's charge counts.
    if (t.isWithDriver && t.date.compareTo(kTripApprovalFrom) >= 0) return t.costEntered ? (t.cost ?? 0) : 0;
    if (t.cost != null) return t.cost!;
    if (t.isTaxi) return 0;
    final u = widget.live.userById(t.isWithDriver ? t.driverId : t.employeeId);
    return t.km * (t.ratePerKm ?? u?.tripRatePerKm ?? 0);
  }

  /// "Company driver: Basheer · DXB 1234" / "Taxi: DXB T 12345" / "Driver trip · DXB 777".
  String _who(Trip t) => t.isWithDriver
      ? 'Ride for ${t.employeeName}${t.vehicle.isEmpty ? '' : ' · ${t.vehicle}'}'
      : t.isTaxi
          ? (t.vehicle.isEmpty || t.vehicle == 'Taxi' ? 'Taxi' : t.vehicle)
          : 'Driver trip${t.vehicle.isEmpty ? '' : ' · ${t.vehicle}'}';

  /// Whose account the trip's cost belongs to: the driver / transport provider for a ride, else the person.
  String _ownerId(Trip t) => t.isWithDriver && t.driverId.isNotEmpty ? t.driverId : t.employeeId;
  String _ownerName(Trip t) => t.isWithDriver && t.driverName.isNotEmpty ? t.driverName : t.employeeName;

  /// Statement head: the driver / provider, Taxi or RTA.
  String _head(Trip t) => t.isTaxi ? (t.isRta ? 'RTA (metro / bus)' : 'Taxi') : _ownerName(t);

  String _periodLabel() {
    final r = _range();
    String f(String k) => DateFormat('d MMM yyyy').format(DateTime.parse(k));
    return _period == 'all' ? 'All days (to ${f(r.to)})' : r.from == r.to ? f(r.from) : '${f(r.from)} – ${f(r.to)}';
  }

  Future<void> _pickDates() async {
    final n = DateTime.now();
    final r = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: n,
      initialDateRange: _custom ?? DateTimeRange(start: DateTime(n.year, n.month, 1), end: n),
    );
    if (r == null) return;
    _custom = r;
    _period = 'pick';
    _load();
  }

  Future<void> _shareStatement(List<Trip> list) async {
    final lines = [
      for (final t in list.reversed)
        StatementLine(
          when: t.startLocal,
          person: t.isWithDriver ? '${t.employeeName} (ride)' : t.employeeName,
          head: _head(t),
          route: '${t.startSiteName.isEmpty ? 'GPS' : t.startSiteName} → ${t.endSiteName.isEmpty ? 'GPS' : t.endSiteName}',
          km: t.km,
          cost: (_costOf(t) * 100).round() / 100,
          status: t.isApproved ? 'Approved' : t.isRejected ? 'Rejected' : 'Unapproved',
        ),
    ];
    final who = _person.isEmpty ? '' : ' - ${_peopleIn(_trips)[_person] ?? ''}';
    try {
      await runWithProgress(context, (set) => TripStatement.share(lines, title: 'Trips statement$who', period: _periodLabel()));
    } catch (e) {
      if (mounted) showSnack(context, 'Could not make the statement: $e', error: true);
    }
  }

  /// Everyone in these trips: staff and drivers / providers (id → name).
  Map<String, String> _peopleIn(List<Trip> l) {
    final m = <String, String>{};
    for (final t in l) {
      m[t.employeeId] = t.employeeName;
      if (t.isWithDriver && t.driverId.isNotEmpty) m[t.driverId] = t.driverName;
    }
    return m;
  }

  Widget _statementCard(List<Trip> list) {
    final heads = <String, ({int n, double km, double cost, double ok})>{};
    for (final t in list) {
      final h = _head(t), c = _costOf(t), p = heads[h];
      heads[h] = (n: (p?.n ?? 0) + 1, km: (p?.km ?? 0) + t.km, cost: (p?.cost ?? 0) + c, ok: (p?.ok ?? 0) + (t.isApproved ? c : 0));
    }
    final rows = heads.entries.toList()..sort((a, b) => b.value.cost.compareTo(a.value.cost));
    final total = list.fold<double>(0, (a, t) => a + _costOf(t));
    final ok = list.where((t) => t.isApproved).fold<double>(0, (a, t) => a + _costOf(t));
    final km = list.fold<double>(0, (a, t) => a + t.km);
    String m(double v) => fmtMoney((v * 100).round() / 100);
    const hs = TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: AppColors.muted, letterSpacing: .5);
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            const Icon(Icons.receipt_long_outlined, color: _purple, size: 20),
            const SizedBox(width: 8),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Statement', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                Text(_periodLabel(), style: const TextStyle(fontSize: 12, color: AppColors.muted)),
              ]),
            ),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(minimumSize: const Size(0, 36)),
              onPressed: () => _shareStatement(list),
              icon: const Icon(Icons.picture_as_pdf_outlined, size: 18),
              label: const Text('PDF'),
            ),
          ]),
          const SizedBox(height: 10),
          Row(children: const [
            Expanded(flex: 4, child: Text('HEAD', style: hs)),
            Expanded(flex: 2, child: Text('TRIPS', style: hs, textAlign: TextAlign.right)),
            Expanded(flex: 3, child: Text('KM', style: hs, textAlign: TextAlign.right)),
            Expanded(flex: 4, child: Text('AMOUNT', style: hs, textAlign: TextAlign.right)),
          ]),
          const Divider(height: 12),
          for (final e in rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(children: [
                Expanded(flex: 4, child: Text(e.key, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700))),
                Expanded(flex: 2, child: Text('${e.value.n}', textAlign: TextAlign.right)),
                Expanded(flex: 3, child: Text(e.value.km.toStringAsFixed(1), textAlign: TextAlign.right)),
                Expanded(
                  flex: 4,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                    Text(m(e.value.cost), style: const TextStyle(fontWeight: FontWeight.w800)),
                    if (e.value.cost - e.value.ok > 0.004)
                      Text('${m(e.value.cost - e.value.ok)} unapproved', style: const TextStyle(fontSize: 11, color: AppColors.warning)),
                  ]),
                ),
              ]),
            ),
          const Divider(height: 14),
          Row(children: [
            const Expanded(flex: 4, child: Text('TOTAL', style: TextStyle(fontWeight: FontWeight.w900))),
            Expanded(flex: 2, child: Text('${list.length}', textAlign: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w800))),
            Expanded(flex: 3, child: Text(km.toStringAsFixed(1), textAlign: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w800))),
            Expanded(
              flex: 4,
              child: Text(m(total), textAlign: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: AppColors.accentDark)),
            ),
          ]),
          if (total - ok > 0.004)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text('Approved ${m(ok)} · waiting approval ${m(total - ok)}',
                  textAlign: TextAlign.right, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
            ),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final people = _peopleIn(_trips);
    if (_person.isNotEmpty && !people.containsKey(_person)) people[_person] = '—';
    final list = _trips
        .where((t) => _kind.isEmpty || t.kind == _kind)
        .where((t) => _person.isEmpty || t.employeeId == _person || (t.isWithDriver && t.driverId == _person))
        .toList();
    final km = list.fold<double>(0, (a, t) => a + t.km);
    final cost = list.fold<double>(0, (a, t) => a + _costOf(t));
    final taxi = list.where((t) => t.isTaxi).fold<double>(0, (a, t) => a + _costOf(t));
    final drv = list.where((t) => !t.isRide).fold<double>(0, (a, t) => a + _costOf(t));

    Widget chip(String label, bool on, VoidCallback tap) => Padding(
          padding: const EdgeInsets.only(right: 6),
          child: ChoiceChip(label: Text(label), selected: on, onSelected: (_) => tap()),
        );

    final header = <Widget>[
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: [
          for (final p in const [('today', 'Today'), ('yday', 'Yesterday'), ('7', '7 days'), ('month', 'This month'), ('last', 'Last month'), ('all', 'All days')])
            chip(p.$2, _period == p.$1, () {
              _period = p.$1;
              _load();
            }),
          Padding(
            padding: const EdgeInsets.only(right: 6),
            child: ChoiceChip(
              avatar: const Icon(Icons.date_range, size: 18),
              label: Text(_period == 'pick' ? _periodLabel() : 'Pick dates'),
              selected: _period == 'pick',
              onSelected: (_) => _pickDates(),
            ),
          ),
        ]),
      ),
      const SizedBox(height: 6),
      Align(
        alignment: Alignment.centerLeft,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 360),
          child: DropdownButtonFormField<String>(
            value: _person,
            isExpanded: true,
            decoration: const InputDecoration(
                isDense: true, labelText: 'Person / driver / provider', prefixIcon: Icon(Icons.person_search_outlined)),
            items: [
              const DropdownMenuItem(value: '', child: Text('Everyone')),
              for (final e in (people.entries.toList()..sort((a, b) => a.value.toLowerCase().compareTo(b.value.toLowerCase()))))
                DropdownMenuItem(value: e.key, child: Text(e.value, overflow: TextOverflow.ellipsis)),
            ],
            onChanged: (v) => setState(() => _person = v ?? ''),
          ),
        ),
      ),
      const SizedBox(height: 6),
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: [
          for (final k in const [('', 'All types'), ('driver', 'Driver trips'), ('taxi', 'Taxi'), ('withDriver', 'With driver')])
            chip(k.$2, _kind == k.$1, () => setState(() => _kind = k.$1)),
        ]),
      ),
      const SizedBox(height: 10),
      StatGrid(children: [
        StatTile(label: 'Trips & rides', value: '${list.length}', icon: Icons.route, color: _purple,
            sub: '${list.where((t) => !t.isRide).length} driver · ${list.where((t) => t.isTaxi).length} taxi · ${list.where((t) => t.isWithDriver).length} with driver'),
        StatTile(label: 'Distance', value: '${km.toStringAsFixed(1)} km', icon: Icons.straighten, color: AppColors.success,
            sub: list.isEmpty ? '—' : 'avg ${(km / list.length).toStringAsFixed(1)} km'),
        if (_money)
          StatTile(label: 'Cost', value: fmtMoney((cost * 100).round() / 100), icon: Icons.payments_outlined, color: AppColors.accentDark,
              sub: 'drivers ${fmtMoney((drv * 100).round() / 100)} · taxi ${fmtMoney((taxi * 100).round() / 100)}'),
        StatTile(label: 'In progress', value: '${widget.live.activeTrips.length}', icon: Icons.local_shipping_outlined,
            color: AppColors.info, sub: 'driving now'),
      ]),
      const SizedBox(height: 10),
      // Text only, one line: icons made the labels wrap on phones.
      SegmentedButton<String>(
        showSelectedIcon: false,
        style: const ButtonStyle(visualDensity: VisualDensity.compact, padding: WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: 4))),
        segments: [
          for (final v in [('list', 'Trips'), ('site', 'Sites'), ('person', 'People'), if (_money) ('acct', 'Accounts')])
            ButtonSegment(
                value: v.$1,
                label: FittedBox(fit: BoxFit.scaleDown, child: Text(v.$2, maxLines: 1, softWrap: false))),
        ],
        selected: {_view},
        onSelectionChanged: (v) => setState(() => _view = v.first),
      ),
      const SizedBox(height: 10),
    ];

    List<Widget> body;
    if (_error != null) {
      body = [Card(child: Padding(padding: const EdgeInsets.all(16), child: Text('Could not load trips: $_error', style: const TextStyle(color: AppColors.danger))))];
    } else if (_loading) {
      body = [const Padding(padding: EdgeInsets.all(30), child: Center(child: CircularProgressIndicator()))];
    } else if (_view == 'acct') {
      body = [_Accounts(me: widget.me, live: widget.live, drivers: _drivers)];
    } else if (list.isEmpty) {
      body = [const Card(child: EmptyState(icon: Icons.route_outlined, title: 'No trips or rides in this period'))];
    } else if (_view == 'site') {
      body = [_groupCard(list, (t) => t.siteId.isNotEmpty ? t.siteId : (t.isActive ? t.startSiteId : ''),
          (t) => t.siteName.isNotEmpty ? t.siteName : (t.isActive && t.startSiteName.isNotEmpty ? t.startSiteName : 'Not at a site'), Icons.location_city)];
    } else if (_view == 'person') {
      // Rides with a driver / transport provider count under that driver (his account), not the passenger.
      body = [_groupCard(list, _ownerId, _ownerName, Icons.person)];
    } else {
      body = [if (_money) _statementCard(list), for (final t in list) _tripTile(t)];
    }

    return LayoutBuilder(builder: (context, c) {
      final pad = c.maxWidth >= 700 ? 24.0 : 16.0;
      return RefreshIndicator(
        onRefresh: () async => _load(),
        child: ListView(padding: EdgeInsets.fromLTRB(pad, 6, pad, 32), children: [...header, ...body]),
      );
    });
  }

  Widget _kindPill(Trip t) => Pill(t.isTaxi ? 'Taxi' : (t.isWithDriver ? 'With driver' : 'Driver'),
      color: t.isTaxi ? AppColors.accentDark : (t.isWithDriver ? AppColors.info : _purple));

  Widget _tripTile(Trip t) {
    final cost = _costOf(t);
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => _details(t),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Avatar(_ownerName(t), size: 34, ring: t.isActive ? AppColors.success : _purple),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(_ownerName(t), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800)),
                  Row(children: [
                    Icon(t.isTaxi ? Icons.local_taxi : (t.isWithDriver ? Icons.directions_car : Icons.local_shipping), size: 14, color: _purple),
                    const SizedBox(width: 4),
                    Flexible(
                      child: Text(_who(t), maxLines: 1, overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: _purple)),
                    ),
                  ]),
                  Text('${fmtDateShort(t.startLocal)} · ${fmtTime(t.startLocal)}–${t.isActive ? 'now' : fmtTime(t.endLocal)} · ${fmtDuration(t.duration)}',
                      style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                ]),
              ),
              _kindPill(t),
            ]),
            const SizedBox(height: 8),
            Row(children: [
              const Icon(Icons.trip_origin, size: 14, color: AppColors.success),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  '${t.startSiteName.isEmpty ? 'GPS location' : t.startSiteName}  →  ${t.isActive ? 'driving…' : (t.endSiteName.isEmpty ? 'GPS location' : t.endSiteName)}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13),
                ),
              ),
            ]),
            const SizedBox(height: 6),
            Row(children: [
              Expanded(
                child: Text(
                  [
                    if (t.siteName.isNotEmpty) 'Charged to ${t.siteName}',

                    if (t.purpose.isNotEmpty) t.purpose,
                  ].join(' · '),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ),
              Text('${t.km.toStringAsFixed(1)} km', style: const TextStyle(fontWeight: FontWeight.w800)),
              if (_money) ...[
                const SizedBox(width: 10),
                Text(fmtMoney((cost * 100).round() / 100), style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.accentDark)),
              ],
            ]),
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Row(children: [
                approvalPill(t),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                      [
                        if (t.byOther) 'Driven by ${t.actualDriver.isEmpty ? 'other driver' : t.actualDriver}',
                        if (t.needsCharge && !t.isApproved) 'Needs ${t.driverName.split(' ').first}\'s charge',
                        if (t.costEntered && t.groupedWith.isEmpty) 'Charge entered${t.chargedBy.isEmpty ? ' by driver' : ' by ${t.chargedBy}'}',
                        if (t.groupedWith.isNotEmpty) 'Same journey as another trip',
                        if (t.pettyId.isNotEmpty) 'In petty cash',
                      ].join(' · '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 11.5, color: AppColors.warning)),
                ),
              ]),
            ),
          ]),
        ),
      ),
    );
  }

  Widget _groupCard(List<Trip> list, String Function(Trip) key, String Function(Trip) name, IconData icon) {
    final m = <String, ({String name, int n, double km, double cost})>{};
    for (final t in list) {
      final k = key(t);
      final p = m[k];
      m[k] = (name: p?.name ?? name(t), n: (p?.n ?? 0) + 1, km: (p?.km ?? 0) + t.km, cost: (p?.cost ?? 0) + _costOf(t));
    }
    final rows = m.values.toList()..sort((a, b) => b.cost == a.cost ? b.km.compareTo(a.km) : b.cost.compareTo(a.cost));
    return Card(
      child: Column(children: [
        for (var i = 0; i < rows.length; i++) ...[
          if (i > 0) const Divider(height: 1, indent: 56),
          ListTile(
            leading: CircleAvatar(backgroundColor: _purple.withValues(alpha: 0.1), child: Icon(icon, color: _purple, size: 20)),
            title: Text(rows[i].name, style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text('${rows[i].n} trip${rows[i].n == 1 ? '' : 's'} · ${rows[i].km.toStringAsFixed(1)} km'),
            trailing: _money
                ? Text(fmtMoney((rows[i].cost * 100).round() / 100), style: const TextStyle(fontWeight: FontWeight.w800))
                : null,
          ),
        ],
      ]),
    );
  }

  Future<void> _delete(Trip t) async {
    if (!await confirm(context, 'Delete trip',
        'Delete ${t.employeeName}\'s ${t.kindLabel.toLowerCase()} on ${fmtDateShort(t.startLocal)} (${t.km.toStringAsFixed(1)} km)? This cannot be undone.',
        ok: 'Delete', danger: true)) {
      return;
    }
    try {
      await Db.deleteTrip(t.id);
      if (mounted) showSnack(context, 'Trip deleted');
    } catch (e) {
      if (mounted) showSnack(context, 'Could not delete: $e', error: true);
    }
  }

  Future<void> _edit(Trip t) async {
    final kmC = TextEditingController(text: t.km.toStringAsFixed(2));
    final costC = TextEditingController(text: _costOf(t).toStringAsFixed(2));
    final purposeC = TextEditingController(text: t.purpose);
    final noteC = TextEditingController(text: t.note);
    final user = widget.live.userById(t.employeeId);
    final cur = t.isTaxi ? (t.isRta ? 'rta' : 'taxi') : t.isWithDriver ? 'wd:${t.driverId}' : 'driver';
    var type = cur;
    final drivers = _drivers.where((u) => u.id != t.employeeId).toList();
    if (t.isWithDriver && t.driverId.isNotEmpty && !drivers.any((d) => d.id == t.driverId)) {
      drivers.add(widget.live.userById(t.driverId) ??
          AppUser(id: t.driverId, name: t.driverName.isEmpty ? 'Driver' : t.driverName, loginId: '', email: '', isDriver: true));
    }
    // Taxi company: pick from the list, plus an optional taxi number.
    final known = <String>[...kTaxiCompanies];
    var company = '';
    final vnoC = TextEditingController();
    if (t.isTaxi && !t.isRta && t.vehicle.isNotEmpty) {
      final parts = t.vehicle.split(' · ');
      if (known.contains(parts.first)) {
        company = parts.first;
        vnoC.text = parts.skip(1).join(' · ');
      } else {
        vnoC.text = t.vehicle;
      }
    }
    final vehC = TextEditingController(text: t.isTaxi && !t.isRta ? '' : t.vehicle);
    String siteId = t.siteId;
    final sites = widget.live.sites.where((x) => x.approved || x.id == t.siteId).toList();
    String? err;
    double? rateFor(String ty) => ty == 'driver' ? (t.ratePerKm ?? user?.tripRatePerKm) : null;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, set) {
          final isTaxiType = type == 'taxi' || type == 'rta';
          final rate = rateFor(type);
          return AlertDialog(
            title: const Text('Edit trip'),
            content: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text('${t.employeeName} · ${fmtDateShort(t.startLocal)}', style: const TextStyle(color: AppColors.muted)),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  value: type,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Type of trip', prefixIcon: Icon(Icons.directions_car_outlined)),
                  items: [
                    const DropdownMenuItem(value: 'taxi', child: Text('Taxi (staff petty)')),
                    const DropdownMenuItem(value: 'rta', child: Text('RTA metro / bus (staff petty)')),
                    for (final d in drivers)
                      DropdownMenuItem(value: 'wd:${d.id}', child: Text('With ${d.name}', overflow: TextOverflow.ellipsis)),
                    if (user?.isDriver == true || cur == 'driver')
                      DropdownMenuItem(value: 'driver', child: Text('${t.employeeName} driving', overflow: TextOverflow.ellipsis)),
                  ],
                  onChanged: (v) => set(() {
                    type = v ?? type;
                    if (type != cur) {
                      if (type.startsWith('wd:')) {
                        costC.text = '';
                        vehC.text = drivers.where((d) => d.id == type.substring(3)).firstOrNull?.vehicle ?? '';
                      } else if (type == 'driver') {
                        final km = double.tryParse(kmC.text.trim()) ?? 0;
                        costC.text = (km * (rateFor('driver') ?? 0)).toStringAsFixed(2);
                        vehC.text = user?.vehicle ?? '';
                      }
                    }
                  }),
                ),
                if (type != cur && t.pettyId.isNotEmpty && !isTaxiType)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text("${t.employeeName}'s petty cash claim for this trip will be rejected — the driver is paid instead.",
                        style: const TextStyle(color: AppColors.warning, fontSize: 12)),
                  ),
                const SizedBox(height: 10),
                TextField(
                  controller: kmC,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Distance (km)', prefixIcon: Icon(Icons.straighten)),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: costC,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(
                      labelText: isTaxiType
                          ? (type == 'rta' ? 'Ticket / fare ($kCurrency)' : 'Taxi fare ($kCurrency)')
                          : type.startsWith('wd:')
                              ? "Provider's charge ($kCurrency) — blank if not yet"
                              : 'Cost ($kCurrency)',
                      prefixIcon: const Icon(Icons.payments_outlined),
                      errorText: err),
                ),
                if (type == 'driver' && rate != null && rate > 0)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton(
                      onPressed: () {
                        final km = double.tryParse(kmC.text.trim()) ?? 0;
                        set(() => costC.text = (km * rate).toStringAsFixed(2));
                      },
                      child: Text('Use km × ${fmtMoney(rate)}/km'),
                    ),
                  ),
                const SizedBox(height: 10),
                if (type == 'taxi') ...[
                  DropdownButtonFormField<String>(
                    value: company,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Taxi company', prefixIcon: Icon(Icons.local_taxi_outlined)),
                    items: [
                      const DropdownMenuItem(value: '', child: Text('— Choose —')),
                      for (final k in known) DropdownMenuItem(value: k, child: Text(k)),
                    ],
                    onChanged: (v) => set(() => company = v ?? ''),
                  ),
                  const SizedBox(height: 10),
                  TextField(controller: vnoC, decoration: const InputDecoration(labelText: 'Taxi no. (optional)', prefixIcon: Icon(Icons.numbers))),
                ] else
                  TextField(
                    controller: vehC,
                    decoration: InputDecoration(
                        labelText: type == 'rta' ? 'Line / card (optional)' : 'Vehicle', prefixIcon: const Icon(Icons.directions_car_filled_outlined)),
                  ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  value: sites.any((x) => x.id == siteId) ? siteId : '',
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Charge to site', prefixIcon: Icon(Icons.location_city_outlined)),
                  items: [
                    const DropdownMenuItem(value: '', child: Text('— No site —')),
                    for (final x in sites) DropdownMenuItem(value: x.id, child: Text(x.name, overflow: TextOverflow.ellipsis)),
                  ],
                  onChanged: (v) => set(() => siteId = v ?? ''),
                ),
                const SizedBox(height: 10),
                TextField(controller: purposeC, decoration: const InputDecoration(labelText: 'Purpose')),
                const SizedBox(height: 10),
                TextField(controller: noteC, decoration: const InputDecoration(labelText: 'Note (reason for change)')),
              ]),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
              FilledButton(
                style: kDialogButton,
                onPressed: () {
                  final km = double.tryParse(kmC.text.trim());
                  final txt = costC.text.trim();
                  final cost = txt.isEmpty && type.startsWith('wd:') ? 0.0 : double.tryParse(txt);
                  if (km == null || km < 0 || cost == null || cost < 0) {
                    set(() => err = 'Enter valid numbers');
                    return;
                  }
                  Navigator.pop(c, true);
                },
                child: const Text('SAVE'),
              ),
            ],
          );
        },
      ),
    );
    if (ok != true) return;
    final txt = costC.text.trim();
    final vehicle = type == 'taxi'
        ? [company, vnoC.text.trim()].where((x) => x.isNotEmpty).join(' · ')
        : vehC.text.trim();
    try {
      await Db.adminEditTrip(
        trip: t,
        km: double.parse(kmC.text.trim()),
        cost: txt.isEmpty ? 0 : double.parse(txt),
        site: widget.live.siteById(siteId),
        purpose: purposeC.text.trim(),
        note: noteC.text.trim(),
        by: widget.me,
        type: type.startsWith('wd:') ? 'wd' : type,
        driver: type.startsWith('wd:') ? drivers.where((d) => d.id == type.substring(3)).firstOrNull : null,
        vehicle: vehicle,
        ratePerKm: rateFor(type),
      );
      if (mounted) showSnack(context, 'Trip updated');
    } catch (e) {
      if (mounted) showSnack(context, 'Could not save: $e', error: true);
    }
  }

  void _details(Trip t) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (c) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.85,
        maxChildSize: 0.95,
        builder: (c, scroll) => ListView(controller: scroll, padding: const EdgeInsets.fromLTRB(16, 0, 16, 24), children: [
          Row(children: [
            Expanded(child: Text(t.employeeName, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800))),
            _kindPill(t),
          ]),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: SizedBox(height: 260, child: _RouteMap(t)),
          ),
          if (!t.isActive && t.pointsCount <= 2)
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text('Very few GPS points: the ride was very short, or the phone’s location was off during the ride.',
                  style: TextStyle(fontSize: 12, color: AppColors.warning)),
            ),
          const SizedBox(height: 10),
          InfoRow(Icons.event, 'Date', '${fmtDate(t.startLocal)} ${tzLabel(t.tz)}'),
          InfoRow(Icons.schedule, 'Time', '${fmtTime(t.startLocal)} – ${t.isActive ? 'in progress' : fmtTime(t.endLocal)} (${fmtDuration(t.duration)})'),
          InfoRow(Icons.trip_origin, 'Pick-up', t.startSiteName.isEmpty ? 'GPS location' : t.startSiteName),
          InfoRow(Icons.flag_outlined, 'Drop-off', t.isActive ? '—' : (t.endSiteName.isEmpty ? 'GPS location' : t.endSiteName)),
          InfoRow(Icons.location_city_outlined, 'Charged to', t.siteName.isEmpty ? '—' : t.siteName),
          InfoRow(Icons.straighten, 'Distance',
              '${t.km.toStringAsFixed(2)} km${t.kmSource == 'road' ? ' (road map)' : t.kmSource == 'gps' ? ' (GPS)' : ''} · ${t.pointsCount} GPS points'),
          if (t.gpsDistanceM != null || t.roadDistanceM != null)
            InfoRow(Icons.alt_route, 'Km check',
                'GPS ${((t.gpsDistanceM ?? t.distanceM) / 1000).toStringAsFixed(2)} km · road map ${t.roadDistanceM == null ? '—' : '${(t.roadDistanceM! / 1000).toStringAsFixed(2)} km'}'),
          if (t.isWithDriver) InfoRow(Icons.person_pin, 'Driver / provider', '${t.driverName}${t.vehicle.isEmpty ? '' : ' · ${t.vehicle}'}'),
          if (t.byOther) InfoRow(Icons.swap_horiz, 'Driven by', '${t.actualDriver.isEmpty ? 'another driver' : t.actualDriver} (sent by ${t.driverName})'),
          if (t.groupedWith.isNotEmpty) const InfoRow(Icons.group_work_outlined, 'Charged', 'With another trip of the same car journey'),
          if (t.isTaxi) InfoRow(t.isRta ? Icons.directions_subway : Icons.local_taxi, t.isRta ? 'RTA' : 'Taxi',
              '${t.vehicle.isEmpty || t.vehicle == 'Taxi' || t.vehicle == 'RTA' ? 'Not entered' : t.vehicle}${t.pettyId.isNotEmpty ? ' · in petty cash' : ''}'),
          if (!t.isRide && t.vehicle.isNotEmpty) InfoRow(Icons.directions_car_outlined, 'Vehicle', t.vehicle),
          if (t.purpose.isNotEmpty) InfoRow(Icons.notes, 'Purpose', t.purpose),
          if (_money) ...[
            if (!t.isTaxi && t.ratePerKm != null) InfoRow(Icons.speed, 'Rate', '${fmtMoney(t.ratePerKm!)} / km'),
            InfoRow(Icons.payments_outlined, 'Cost',
                '${fmtMoney((_costOf(t) * 100).round() / 100)}${t.costEntered ? ' (entered by driver)' : (t.isActive ? ' (estimate)' : '')}'),
          ],
          if (t.note.isNotEmpty) InfoRow(Icons.sticky_note_2_outlined, 'Note', t.note),
          if (t.costNote.isNotEmpty) InfoRow(Icons.sticky_note_2_outlined, 'Charge note', t.costNote),
          if (t.editedBy.isNotEmpty) InfoRow(Icons.edit_note, 'Edited by', t.editedBy),
          const SizedBox(height: 10),
          Row(children: [
            const Text('Approval  ', style: TextStyle(color: AppColors.muted)),
            approvalPill(t),
            if (t.approvedBy.isNotEmpty) Text('  by ${t.approvedBy}', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
          ]),
          if (widget.me.isAdmin && !t.isActive) ...[
            const SizedBox(height: 8),
            if (t.needsCharge && !t.isApproved)
              OutlinedButton.icon(
                onPressed: () {
                  Navigator.pop(c);
                  chargeRideDialog(context, t, rides: _trips.where((x) => x.isWithDriver).toList(), by: widget.me.name);
                },
                icon: const Icon(Icons.payments_outlined),
                label: Text('Add charge for ${t.driverName}'),
              ),
            Row(children: [
              if (!t.isApproved)
                Expanded(
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(backgroundColor: AppColors.success, minimumSize: const Size(0, 44)),
                    onPressed: t.needsCharge
                        ? null
                        : () async {
                            Navigator.pop(c);
                            try {
                              await Db.setTripApproval(t, 'approved', by: widget.me.name);
                              if (mounted) showSnack(context, 'Approved');
                            } catch (e) {
                              if (mounted) showSnack(context, 'Could not approve: $e', error: true);
                            }
                          },
                    icon: const Icon(Icons.check),
                    label: Text(t.needsCharge ? 'Needs the charge first' : 'Approve'),
                  ),
                ),
              if (!t.isApproved && !t.isRejected) const SizedBox(width: 8),
              if (!t.isRejected)
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(foregroundColor: AppColors.danger, minimumSize: const Size(0, 44)),
                    onPressed: () async {
                      Navigator.pop(c);
                      try {
                        await Db.setTripApproval(t, t.isApproved ? '' : 'rejected', by: widget.me.name);
                        if (mounted) showSnack(context, t.isApproved ? 'Back to unapproved' : 'Rejected');
                      } catch (e) {
                        if (mounted) showSnack(context, 'Could not save: $e', error: true);
                      }
                    },
                    icon: Icon(t.isApproved ? Icons.undo : Icons.close),
                    label: Text(t.isApproved ? 'Unapprove' : 'Reject'),
                  ),
                ),
            ]),
          ],
          const SizedBox(height: 14),
          if (t.isActive)
            OutlinedButton.icon(
              onPressed: () async {
                Navigator.pop(c);
                if (!await confirm(context, 'End trip', 'End ${t.employeeName}\'s trip now at the last GPS point (${t.km.toStringAsFixed(1)} km)?', ok: 'End trip')) return;
                try {
                  await Db.adminEndTrip(t, widget.me, widget.live.userById(t.employeeId)?.tripRatePerKm ?? await Db.tripRate(widget.live.userById(t.employeeId) ?? widget.me));
                  if (mounted) showSnack(context, 'Trip ended');
                } catch (e) {
                  if (mounted) showSnack(context, 'Could not end: $e', error: true);
                }
              },
              icon: const Icon(Icons.stop_circle_outlined),
              label: const Text('End this trip now'),
            ),
          if (widget.me.isAdmin) ...[
            const SizedBox(height: 8),
            Row(children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: () {
                    Navigator.pop(c);
                    _edit(t);
                  },
                  icon: const Icon(Icons.edit_outlined),
                  label: const Text('Edit'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(foregroundColor: AppColors.danger, side: const BorderSide(color: AppColors.danger)),
                  onPressed: () {
                    Navigator.pop(c);
                    _delete(t);
                  },
                  icon: const Icon(Icons.delete_outline),
                  label: const Text('Delete'),
                ),
              ),
            ]),
          ],
        ]),
      ),
    );
  }
}

class _RouteMap extends StatefulWidget {
  final Trip t;
  const _RouteMap(this.t);
  @override
  State<_RouteMap> createState() => _RouteMapState();
}

class _RouteMapState extends State<_RouteMap> {
  List<LatLng>? _pts;

  @override
  void initState() {
    super.initState();
    Db.tripPoints(widget.t.id).then((l) {
      if (mounted) setState(() => _pts = l.map((p) => LatLng(p.lat, p.lng)).toList());
    }).catchError((_) {
      if (mounted) setState(() => _pts = []);
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.t;
    final pts = [...?_pts];
    // Always show pick-up, and drop-off (or where the ride is now), even with few GPS points.
    final start = t.startLat != null ? LatLng(t.startLat!, t.startLng!) : null;
    if (start != null && (pts.isEmpty || Distance()(pts.first, start) > 5)) pts.insert(0, start);
    final end = t.endLat != null && t.endLng != null
        ? LatLng(t.endLat!, t.endLng!)
        : (t.isActive && t.lastLat != null && t.lastLng != null ? LatLng(t.lastLat!, t.lastLng!) : null);
    if (end != null && (pts.isEmpty || Distance()(pts.last, end) > 5)) pts.add(end);
    if (_pts == null) return const Center(child: CircularProgressIndicator());
    if (pts.isEmpty) return const Center(child: Text('No GPS points'));
    return FlutterMap(
      options: MapOptions(
        initialCameraFit: pts.length > 1
            ? CameraFit.bounds(bounds: LatLngBounds.fromPoints(pts), padding: const EdgeInsets.all(30), maxZoom: 16)
            : null,
        initialCenter: pts.first,
        initialZoom: 15,
      ),
      children: [
        osmTiles(),
        if (pts.length > 1) PolylineLayer(polylines: [Polyline(points: pts, strokeWidth: 5, color: _purple)]),
        MarkerLayer(markers: [
          // Pick-up and drop-off at the same spot (very short ride) → one combined pin, so neither hides the other.
          if (pts.length == 1 || Distance()(pts.first, pts.last) < 30)
            Marker(point: pts.first, width: 150, height: 46, alignment: Alignment.topCenter,
                child: _pin(t.isActive ? 'Pick-up · now' : 'Pick-up & drop-off', AppColors.success))
          else
            Marker(point: pts.first, width: 90, height: 46, alignment: Alignment.topCenter, child: _pin('Pick-up', AppColors.success)),
          if (pts.length > 1 && Distance()(pts.first, pts.last) >= 30)
            Marker(point: pts.last, width: 90, height: 46, alignment: Alignment.topCenter,
                child: _pin(t.isActive ? 'Now' : 'Drop-off', t.isActive ? _purple : AppColors.danger)),
        ]),
        osmAttribution(),
      ],
    );
  }

  Widget _pin(String label, Color c) => Column(mainAxisSize: MainAxisSize.min, children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(6)),
          child: Text(label, style: const TextStyle(color: Colors.white, fontSize: 10.5, fontWeight: FontWeight.w800)),
        ),
        Container(
          width: 16,
          height: 16,
          decoration: BoxDecoration(color: c, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 3),
              boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 3)]),
        ),
      ]);
}

/// Admin: per driver — earned (finished trip costs) − paid = balance; record payments.
class _Accounts extends StatefulWidget {
  final AppUser me;
  final AdminLive live;
  final List<AppUser> drivers;
  const _Accounts({required this.me, required this.live, required this.drivers});
  @override
  State<_Accounts> createState() => _AccountsState();
}

class _AccountsState extends State<_Accounts> {
  List<Trip> _done = [];
  List<DriverPayment> _pays = [];
  final List<StreamSubscription> _subs = [];
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _subs.add(Db.doneTripsAll().listen((l) {
      if (mounted) setState(() {
        _done = l.where((t) => !t.isTaxi).toList();
        _loaded = true;
      });
    }, onError: (_) {
      if (mounted) setState(() => _loaded = true);
    }));
    _subs.add(Db.allDriverPayments().listen((l) {
      if (mounted) setState(() => _pays = l);
    }, onError: (_) {}));
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    super.dispose();
  }

  Future<void> _review(DriverPayment p, bool accept) async {
    try {
      await Db.reviewDriverPayment(p, accept, widget.me);
      if (mounted) showSnack(context, accept ? 'Accepted' : 'Rejected');
    } catch (e) {
      if (mounted) showSnack(context, 'Could not save: $e', error: true);
    }
  }

  /// New payment to a driver, or (with [p]) change / delete an existing one. Date defaults to today and can be changed.
  Future<void> _pay(AppUser d, double balance, [DriverPayment? p]) async {
    final amt = TextEditingController(text: p != null ? p.claimed.toStringAsFixed(2) : (balance > 0 ? balance.toStringAsFixed(2) : ''));
    final note = TextEditingController(text: p?.note ?? '');
    String method = p != null && p.method.isNotEmpty ? p.method : 'Bank transfer';
    var date = p != null && p.date.length == 10 ? parseDateKey(p.date) : DateTime.now();
    String? err;
    final res = await showDialog<String>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, set) => AlertDialog(
          title: Text(p == null ? 'Payment to ${d.name}' : 'Change payment · ${d.name}'),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text('Balance due: ${fmtMoney(balance)}', style: const TextStyle(color: AppColors.muted)),
              const SizedBox(height: 10),
              TextField(
                  controller: amt,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(labelText: 'Amount ($kCurrency)', prefixIcon: const Icon(Icons.payments_outlined), errorText: err)),
              const SizedBox(height: 10),
              InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: () async {
                  final x = await showDatePicker(context: c, firstDate: DateTime(2023), lastDate: DateTime.now().add(const Duration(days: 60)), initialDate: date);
                  if (x != null) set(() => date = x);
                },
                child: InputDecorator(
                  decoration: const InputDecoration(labelText: 'Payment date', prefixIcon: Icon(Icons.event)),
                  child: Text(DateFormat('EEE, d MMM yyyy').format(date), style: const TextStyle(fontWeight: FontWeight.w700)),
                ),
              ),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                value: method,
                decoration: const InputDecoration(labelText: 'Method'),
                items: const ['Cash', 'Bank transfer', 'Cheque', 'Other'].map((m) => DropdownMenuItem(value: m, child: Text(m))).toList(),
                onChanged: (v) => set(() => method = v ?? 'Bank transfer'),
              ),
              const SizedBox(height: 10),
              TextField(controller: note, decoration: const InputDecoration(labelText: 'Note / reference')),
            ]),
          ),
          actions: [
            if (p != null)
              TextButton(
                  onPressed: () => Navigator.pop(c, 'delete'),
                  child: const Text('Delete', style: TextStyle(color: AppColors.danger))),
            TextButton(onPressed: () => Navigator.pop(c), child: const Text('Cancel')),
            FilledButton(
              style: kDialogButton,
              onPressed: () {
                final v = double.tryParse(amt.text.trim());
                if (v == null || v <= 0) {
                  set(() => err = 'Enter the amount');
                  return;
                }
                Navigator.pop(c, 'save');
              },
              child: const Text('SAVE'),
            ),
          ],
        ),
      ),
    );
    if (res == null) return;
    try {
      if (res == 'delete') {
        if (!mounted || !await confirm(context, 'Delete payment', 'Delete the payment of ${fmtMoney(p!.claimed)} on ${p.date}?', ok: 'Delete', danger: true)) return;
        await Db.deleteDriverPayment(p.id);
        if (mounted) showSnack(context, 'Payment deleted');
        return;
      }
      final v = double.parse(amt.text.trim());
      if (p == null) {
        await Db.addDriverPayment(driver: d, amount: v, date: dateKey(date), method: method, note: note.text.trim(), by: widget.me);
        if (mounted) showSnack(context, 'Payment saved — it shows in ${d.name}\'s app and in Accounts (Transport)');
      } else {
        await Db.updateDriverPayment(p.id, amount: v, date: dateKey(date), method: method, note: note.text.trim(), by: widget.me);
        if (mounted) showSnack(context, 'Payment updated');
      }
    } catch (e) {
      if (mounted) showSnack(context, 'Could not save: $e', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_loaded) return const Padding(padding: EdgeInsets.all(30), child: Center(child: CircularProgressIndicator()));
    // Staff drivers (also inactive ones with history) + external workers who drive.
    final drivers = [
      ...widget.live.users.where((u) => u.isDriver),
      ...widget.drivers.where((d) => !widget.live.users.any((u) => u.id == d.id)),
    ];
    if (drivers.isEmpty) return const Card(child: EmptyState(icon: Icons.no_crash_outlined, title: 'No drivers yet'));
    final rows = drivers.map((u) {
      // Driver's own trips + staff rides with this driver (costed at the driver's rate).
      // Only approved trips count; unapproved ones wait.
      final tr = _done.where((t) => t.isApproved && ((!t.isRide && t.employeeId == u.id) || (t.isWithDriver && t.driverId == u.id))).toList();
      final pays = _pays.where((p) => p.employeeId == u.id).toList();
      final earned = tr.fold<double>(0, (a, t) => a + (t.cost ?? 0));
      final paid = pays.fold<double>(0, (a, p) => a + p.amount);
      return (u: u, trips: tr.length, earned: earned, paid: paid, bal: ((earned - paid) * 100).round() / 100, pays: pays);
    }).toList()
      ..sort((a, b) => b.bal.compareTo(a.bal));
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      for (final r in rows)
        Card(
          margin: const EdgeInsets.only(bottom: 8),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Avatar(r.u.name, size: 34, ring: _purple),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(r.u.name, style: const TextStyle(fontWeight: FontWeight.w800)),
                    Text('${r.trips} trips${r.u.vehicle.isEmpty ? '' : ' · ${r.u.vehicle}'}', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                  ]),
                ),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(minimumSize: const Size(0, 38)),
                  onPressed: () => _pay(r.u, r.bal),
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Payment'),
                ),
              ]),
              const SizedBox(height: 10),
              Row(children: [
                _box('Earned', fmtMoney((r.earned * 100).round() / 100), AppColors.primary),
                const SizedBox(width: 6),
                _box('Paid', fmtMoney((r.paid * 100).round() / 100), AppColors.success),
                const SizedBox(width: 6),
                _box(r.bal >= 0 ? 'Balance' : 'Overpaid', fmtMoney(r.bal.abs()), r.bal > 0 ? AppColors.warning : AppColors.success),
              ]),
              for (final p in [...r.pays.where((x) => x.isException), ...r.pays.where((x) => !x.isException).take(5)])
                InkWell(
                  onTap: p.isException ? null : () => _pay(r.u, r.bal, p),
                  child: Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Icon(p.isException ? Icons.error : p.isRejected ? Icons.cancel : Icons.check_circle,
                          size: 15, color: p.isException || p.isRejected ? AppColors.danger : AppColors.success),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text('${p.date.length == 10 ? DateFormat('d MMM yyyy').format(parseDateKey(p.date)) : p.date} · ${p.method}${p.note.isEmpty ? '' : ' · ${p.note}'}',
                            maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5)),
                      ),
                      Text(fmtMoney(p.claimed),
                          style: TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 12.5,
                              color: p.isException || p.isRejected ? AppColors.danger : null,
                              decoration: p.isRejected ? TextDecoration.lineThrough : null)),
                    ]),
                    if (p.isException)
                      Container(
                        margin: const EdgeInsets.only(top: 4),
                        padding: const EdgeInsets.fromLTRB(10, 6, 6, 6),
                        decoration: BoxDecoration(color: const Color(0xFFFBE6E6), borderRadius: BorderRadius.circular(8)),
                        child: Row(children: [
                          Expanded(
                            child: Text(
                                'EXCEPTION — ${p.prev == null ? 'added' : 'changed (was ${fmtMoney((p.prev!['amount'] as num?)?.toDouble() ?? 0)})'} by driver: ${p.reason}',
                                style: const TextStyle(fontSize: 12, color: Color(0xFF8F2A2A), fontWeight: FontWeight.w600)),
                          ),
                          IconButton(
                            tooltip: 'Reject',
                            visualDensity: VisualDensity.compact,
                            icon: const Icon(Icons.close, color: AppColors.danger),
                            onPressed: () => _review(p, false),
                          ),
                          IconButton(
                            tooltip: 'Accept',
                            visualDensity: VisualDensity.compact,
                            icon: const Icon(Icons.check, color: AppColors.success),
                            onPressed: () => _review(p, true),
                          ),
                        ]),
                      ),
                  ]),
                ),
                ),
            ]),
          ),
        ),
      const Padding(
        padding: EdgeInsets.all(8),
        child: Text('Full statements (Excel / PDF): web dashboard → Trips & rides → Driver accounts.',
            style: TextStyle(fontSize: 12, color: AppColors.muted)),
      ),
    ]);
  }

  Widget _box(String l, String v, Color c) => Expanded(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          decoration: BoxDecoration(color: c.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(l, style: const TextStyle(fontSize: 11, color: AppColors.muted)),
            FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(v, style: TextStyle(fontWeight: FontWeight.w800, color: c))),
          ]),
        ),
      );
}
