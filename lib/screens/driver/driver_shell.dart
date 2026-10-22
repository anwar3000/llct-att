import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/auth_service.dart';
import '../../services/db.dart';
import '../../services/trip_service.dart';
import '../../widgets/common.dart';
import '../../widgets/profile_prompt.dart';
import '../../widgets/trip_card.dart';
import '../employee/my_documents_screen.dart';

/// The app for a "Driver (taxi)" work profile: no attendance check-in —
/// just Start / Stop trip, the driver's rate, and their trips and earnings.
class DriverShell extends StatefulWidget {
  final AppUser me;
  const DriverShell({super.key, required this.me});

  @override
  State<DriverShell> createState() => _DriverShellState();
}

class _DriverShellState extends State<DriverShell> {
  final List<StreamSubscription> _subs = [];
  List<Site> _sites = [];
  List<Trip> _month = [];
  bool _loaded = false;
  DateTime _monthOf = DateTime(DateTime.now().year, DateTime.now().month);
  double? _rate;
  StreamSubscription? _monthSub;
  List<Trip> _allDone = [];
  List<Trip> _rides = [];
  List<DriverPayment> _payments = [];

  @override
  void initState() {
    super.initState();
    // Missing mobile / email / passport / Emirates ID? Ask once when the app opens.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) ProfilePrompt.maybeAsk(context, widget.me);
    });
    _subs.add(Db.sitesStream(activeOnly: true).listen((l) {
      if (mounted) setState(() => _sites = l);
    }, onError: (_) {}));
    _watchMonth();
    _subs.add(Db.myDoneTrips(widget.me.id).listen((l) {
      if (mounted) setState(() => _allDone = l);
    }, onError: (_) {}));
    _subs.add(Db.ridesWithDriver(widget.me.id).listen((l) {
      if (mounted) setState(() => _rides = l);
    }, onError: (_) {}));
    _subs.add(Db.myDriverPayments(widget.me.id).listen((l) {
      if (mounted) setState(() => _payments = l);
    }, onError: (_) {}));
    Db.tripRate(widget.me).then((r) {
      if (mounted) setState(() => _rate = r);
    });
  }

  void _watchMonth() {
    _monthSub?.cancel();
    _loaded = false;
    _monthSub = Db.tripsForMonth(widget.me.id, monthKey(_monthOf)).listen((l) {
      if (mounted) setState(() {
        _month = l;
        _loaded = true;
      });
    }, onError: (_) {
      if (mounted) setState(() => _loaded = true);
    });
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    _monthSub?.cancel();
    super.dispose();
  }

  Future<void> _signOut() async {
    final running = TripService.instance.isRunning;
    final msg = running
        ? 'A trip is still running. GPS recording stops until you sign in again. Sign out anyway?'
        : 'Sign out of this device?';
    if (!await confirm(context, 'Sign out', msg, ok: 'Sign out')) return;
    await TripService.instance.detach();
    await AuthService.signOut();
  }

  void _profile() {
    final me = widget.me;
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Avatar(me.name, size: 64),
            const SizedBox(height: 10),
            Text(me.name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const Text('Driver', style: TextStyle(color: AppColors.muted)),
            const SizedBox(height: 14),
            InfoRow(Icons.badge_outlined, 'Login ID', me.loginId),
            if (me.vehicle.isNotEmpty) InfoRow(Icons.directions_car_outlined, 'Vehicle', me.vehicle),
            InfoRow(Icons.speed, 'Rate', _rate == null ? '…' : '${fmtMoney(_rate!)} per km'),
            const SizedBox(height: 14),
            if (me.contactEmail.isNotEmpty) InfoRow(Icons.mail_outline, 'Email', me.contactEmail),
            OutlinedButton.icon(
              onPressed: () {
                Navigator.pop(c);
                ProfilePrompt.editContact(context, widget.me);
              },
              icon: const Icon(Icons.edit_outlined),
              label: Text(me.phone.isEmpty || me.contactEmail.isEmpty ? 'Add mobile number & email' : 'Edit mobile number & email'),
            ),
            const SizedBox(height: 8),
            FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: AppColors.accent, foregroundColor: AppColors.primaryDark),
              onPressed: () {
                Navigator.pop(c);
                Navigator.of(context).push(MaterialPageRoute(builder: (_) => MyDocumentsScreen(me: me)));
              },
              icon: const Icon(Icons.badge_outlined),
              label: const Text('My ID documents'),
            ),
            const SizedBox(height: 8),
            const Text('LLCT Attendance v$kAppVersion', style: TextStyle(color: AppColors.muted, fontSize: 12)),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: () {
                Navigator.pop(c);
                _signOut();
              },
              icon: const Icon(Icons.logout),
              label: const Text('Sign out'),
            ),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final me = widget.me;
    final done = _month.where((t) => !t.isActive).toList();
    final km = done.fold<double>(0, (a, t) => a + t.km);
    final earned = done.fold<double>(0, (a, t) => a + (t.cost ?? 0));
    final days = done.map((t) => dateKey(t.startLocal)).toSet().length;

    final header = Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(colors: [AppColors.primaryDark, AppColors.primary]),
        borderRadius: BorderRadius.circular(22),
        border: const Border(bottom: BorderSide(color: Color(0xFF7B4FC9), width: 4)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Hello, ${me.name.split(' ').first}',
            style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700)),
        Text(fmtDate(DateTime.now()), style: TextStyle(color: Colors.white.withValues(alpha: 0.75))),
        const SizedBox(height: 14),
        Row(children: [
          _stat('Your rate', _rate == null ? '…' : '${fmtMoney(_rate!)}/km'),
          _stat('This month', '${km.toStringAsFixed(1)} km'),
          _stat('Earned', fmtMoney((earned * 100).round() / 100)),
        ]),
        if (me.vehicle.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Text('Vehicle ${me.vehicle}', style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 12.5)),
          ),
      ]),
    );

    // Tally: everything earned on finished trips minus everything paid by the office.
    final totalEarned = _allDone.fold<double>(0, (a, t) => a + (t.cost ?? 0)) + _rides.fold<double>(0, (a, t) => a + (t.cost ?? 0));
    final totalPaid = _payments.fold<double>(0, (a, p) => a + p.amount);
    final balance = ((totalEarned - totalPaid) * 100).round() / 100;
    final tally = Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('My account', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15.5)),
          const SizedBox(height: 10),
          Row(children: [
            _tallyBox('Earned', fmtMoney((totalEarned * 100).round() / 100),
                '${_allDone.length} trips${_rides.isEmpty ? '' : ' + ${_rides.length} rides'}', AppColors.primary),
            const SizedBox(width: 8),
            _tallyBox('Paid', fmtMoney((totalPaid * 100).round() / 100), '${_payments.length} payments', AppColors.success),
            const SizedBox(width: 8),
            _tallyBox(balance >= 0 ? 'Balance due' : 'Overpaid', fmtMoney(balance.abs()), 'earned − paid',
                balance > 0 ? AppColors.warning : AppColors.success),
          ]),
          if (_payments.isNotEmpty) ...[
            const SizedBox(height: 12),
            const Text('Payments received', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
            for (final p in _payments.take(10))
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Row(children: [
                  const Icon(Icons.check_circle, size: 16, color: AppColors.success),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                        '${p.date.length == 10 ? fmtDateShort(parseDateKey(p.date)) : p.date}${p.method.isEmpty ? '' : ' · ${p.method}'}${p.note.isEmpty ? '' : ' · ${p.note}'}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12.5)),
                  ),
                  Text(fmtMoney(p.amount), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
                ]),
              ),
          ],
        ]),
      ),
    );

    final left = <Widget>[
      header,
      const SizedBox(height: 12),
      TripCard(me: me, sites: _sites),
      const SizedBox(height: 4),
      tally,
    ];
    final right = <Widget>[
      SectionTitle('My trips · ${fmtMonth(_monthOf)}',
          trailing: Text('${done.length} trips · $days days', style: const TextStyle(color: AppColors.muted))),
      MonthSwitcher(
        month: _monthOf,
        onChanged: (m) {
          setState(() => _monthOf = m);
          _watchMonth();
        },
      ),
      const SizedBox(height: 8),
      if (!_loaded)
        const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()))
      else if (done.isEmpty)
        const Card(child: EmptyState(icon: Icons.route_outlined, title: 'No trips this month'))
      else
        Card(
          child: Column(children: [
            for (var i = 0; i < done.length; i++) ...[
              if (i > 0) const Divider(height: 1, indent: 16),
              ListTile(
                dense: true,
                onTap: () => editTripCost(context, done[i]),
                title: Text(
                    '${done[i].startSiteName.isEmpty ? 'GPS' : done[i].startSiteName} → ${done[i].endSiteName.isEmpty ? 'GPS' : done[i].endSiteName}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text(
                    '${fmtDateShort(done[i].startLocal)} · ${fmtTime(done[i].startLocal)}–${fmtTime(done[i].endLocal)}'
                    '${done[i].purpose.isEmpty ? '' : ' · ${done[i].purpose}'}'),
                trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                  Text('${done[i].km.toStringAsFixed(1)} km', style: const TextStyle(fontWeight: FontWeight.w800)),
                  Text(done[i].cost == null ? 'Add cost ✎' : '${fmtMoney(done[i].cost!)} ✎',
                      style: const TextStyle(fontSize: 12, color: AppColors.accentDark, fontWeight: FontWeight.w700)),
                ]),
              ),
            ],
          ]),
        ),
    ];

    if (_rides.isNotEmpty) {
      right.addAll([
        const SectionTitle('Staff rides with me'),
        Card(
          child: Column(children: [
            for (final r in _rides.take(15))
              ListTile(
                dense: true,
                leading: const Icon(Icons.directions_car, color: Color(0xFF7B4FC9)),
                title: Text(r.employeeName, style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text('${fmtDateShort(r.startLocal)} · ${fmtTime(r.startLocal)} · '
                    '${r.startSiteName.isEmpty ? 'GPS' : r.startSiteName} → ${r.endSiteName.isEmpty ? 'GPS' : r.endSiteName}',
                    maxLines: 1, overflow: TextOverflow.ellipsis),
                trailing: Text('${r.km.toStringAsFixed(1)} km${r.cost == null ? '' : '\n${fmtMoney(r.cost!)}'}',
                    textAlign: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
              ),
          ]),
        ),
      ]);
    }

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: Row(children: [
          ClipRRect(borderRadius: BorderRadius.circular(9), child: Image.asset('assets/icon.png', width: 34, height: 34)),
          const SizedBox(width: 10),
          const Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Driver trips'),
              Text('LLCT', style: TextStyle(fontSize: 12, color: AppColors.muted, fontWeight: FontWeight.w500)),
            ]),
          ),
        ]),
        actions: [
          IconButton(onPressed: _profile, icon: Avatar(me.name, size: 32)),
          const SizedBox(width: 6),
        ],
      ),
      body: LayoutBuilder(builder: (context, c) {
        if (c.maxWidth >= 700) {
          return SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: left)),
              const SizedBox(width: 16),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: right)),
            ]),
          );
        }
        return ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 32), children: [...left, ...right]);
      }),
    );
  }

  Widget _tallyBox(String label, String value, String sub, Color color) => Expanded(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
          decoration: BoxDecoration(color: color.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(12)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(value, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: color)),
            ),
            Text(sub, style: const TextStyle(fontSize: 10.5, color: AppColors.muted)),
          ]),
        ),
      );

  Widget _stat(String label, String value) => Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: TextStyle(color: Colors.white.withValues(alpha: 0.7), fontSize: 11.5)),
          const SizedBox(height: 2),
          Text(value, style: const TextStyle(color: AppColors.accent, fontSize: 17, fontWeight: FontWeight.w800)),
        ]),
      );
}
