import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/db.dart';
import '../../services/photo_service.dart';
import '../../widgets/common.dart';
import '../../widgets/trip_card.dart' show kDialogButton;
import 'admin_live.dart';
import 'petty_admin_tab.dart';

const _green = Color(0xFF2E9E6A);
const _red = Color(0xFFD64545);
double _r2(double v) => (v * 100).round() / 100;
String _money(double v) => '${v < 0 ? '−' : ''}${fmtMoney(_r2(v.abs()))}';

/// Admin "Accounts" tab: company income & expenses, and petty cash.
class AccountsTab extends StatefulWidget {
  final AppUser me;
  final AdminLive live;
  const AccountsTab({super.key, required this.me, required this.live});
  @override
  State<AccountsTab> createState() => _AccountsTabState();
}

class _AccountsTabState extends State<AccountsTab> {
  String _part = 'acct';
  @override
  Widget build(BuildContext context) {
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 6, 16, 4),
        child: SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'acct', label: Text('Accounts'), icon: Icon(Icons.account_balance_outlined)),
            ButtonSegment(value: 'petty', label: Text('Petty cash'), icon: Icon(Icons.account_balance_wallet_outlined)),
          ],
          selected: {_part},
          onSelectionChanged: (v) => setState(() => _part = v.first),
        ),
      ),
      Expanded(
        child: IndexedStack(index: _part == 'acct' ? 0 : 1, children: [
          _AccountsView(me: widget.me, live: widget.live),
          PettyAdminTab(me: widget.me, live: widget.live),
        ]),
      ),
    ]);
  }
}

class _AccountsView extends StatefulWidget {
  final AppUser me;
  final AdminLive live;
  const _AccountsView({required this.me, required this.live});
  @override
  State<_AccountsView> createState() => _AccountsViewState();
}

class _AccountsViewState extends State<_AccountsView> {
  String _period = 'month';
  String _type = '';
  StreamSubscription? _sub;
  List<AcctEntry>? _manual;
  List<AcctEntry> _auto = [];
  ({double cash, double bank})? _bf;
  Object? _error;
  int _token = 0;
  Map<String, String> _projNames = {};

  @override
  void initState() {
    super.initState();
    _load();
    Db.acctProjects().then((l) {
      if (mounted) setState(() => _projNames = {for (final p in l) p.id: p.label});
    }).catchError((_) {});
  }

  /// The entry's project — or, for entries saved with only a site, the project that site belongs to.
  String _projectIdOf(AcctEntry e) => e.projectId.isNotEmpty ? e.projectId : (widget.live.siteById(e.siteId)?.projectId ?? '');
  String _projectOf(AcctEntry e) => e.projectName.isNotEmpty ? e.projectName : (_projNames[_projectIdOf(e)] ?? '');

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  ({String from, String to}) get _range {
    final n = DateTime.now();
    switch (_period) {
      case 'last':
        return (from: dateKey(DateTime(n.year, n.month - 1, 1)), to: dateKey(DateTime(n.year, n.month, 0)));
      case 'year':
        return (from: '${n.year}-01-01', to: dateKey(n));
      case 'all':
        return (from: '2000-01-01', to: dateKey(n));
      default:
        return (from: dateKey(DateTime(n.year, n.month, 1)), to: dateKey(n));
    }
  }

  void _load() {
    final t = ++_token;
    final r = _range;
    _sub?.cancel();
    setState(() {
      _manual = null;
      _bf = null;
      _error = null;
    });
    _sub = Db.acctInRange(r.from, r.to).listen((l) {
      if (mounted) setState(() => _manual = l);
    }, onError: (e) {
      if (mounted) setState(() => _error = e);
    });
    _reloadSide(t);
  }

  Future<void> _reloadSide([int? t]) async {
    final tok = t ?? _token;
    final r = _range;
    try {
      final a = await Db.acctAuto(r.from, r.to);
      final bf = await Db.acctBroughtForward(r.from);
      if (!mounted || tok != _token) return;
      setState(() {
        _auto = a;
        _bf = bf;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final all = [...?_manual, ..._auto].where((e) => _type.isEmpty || e.type == _type).toList()
      ..sort((a, b) => b.date.compareTo(a.date));
    double sum(Iterable<AcctEntry> l) => l.fold(0, (a, e) => a + e.amount);
    final inc = all.where((e) => e.isIncome), exp = all.where((e) => !e.isIncome);
    final tIn = sum(inc), tOut = sum(exp), net = tIn - tOut;
    final cashNet = all.where((e) => !e.isBank).fold<double>(0, (a, e) => a + e.signed);
    final bankNet = all.where((e) => e.isBank).fold<double>(0, (a, e) => a + e.signed);
    final bf = _bf;
    final r = _range;

    Widget chip(String label, bool on, VoidCallback tap) => Padding(
          padding: const EdgeInsets.only(right: 6),
          child: ChoiceChip(label: Text(label), selected: on, onSelected: (_) => tap()),
        );

    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.end, children: [
        FloatingActionButton.extended(
          heroTag: 'acctIn',
          backgroundColor: _green,
          foregroundColor: Colors.white,
          onPressed: () => _edit(null, 'income'),
          icon: const Icon(Icons.add),
          label: const Text('Income'),
        ),
        const SizedBox(height: 10),
        FloatingActionButton.extended(
          heroTag: 'acctOut',
          backgroundColor: _red,
          foregroundColor: Colors.white,
          onPressed: () => _edit(null, 'expense'),
          icon: const Icon(Icons.remove),
          label: const Text('Expense'),
        ),
      ]),
      body: RefreshIndicator(
        onRefresh: () async => _load(),
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 6, 16, 140), children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(children: [
              for (final p in const [('month', 'This month'), ('last', 'Last month'), ('year', 'This year'), ('all', 'All time')])
                chip(p.$2, _period == p.$1, () {
                  _period = p.$1;
                  _load();
                }),
              const SizedBox(width: 8),
              for (final t in const [('', 'All'), ('income', 'Income'), ('expense', 'Expenses')])
                chip(t.$2, _type == t.$1, () => setState(() => _type = t.$1)),
            ]),
          ),
          const SizedBox(height: 8),
          if (_error != null)
            Card(
              color: const Color(0xFFFBE6E6),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Text('Could not load accounts: $_error\nPublish the latest Firestore rules (combined file).',
                    style: const TextStyle(color: Color(0xFF8F2A2A), fontSize: 12.5)),
              ),
            ),
          // Balance brought forward + net = closing
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text('${r.from} → ${r.to}', style: const TextStyle(color: AppColors.muted, fontSize: 12.5))),
                  TextButton(onPressed: _openingDialog, child: const Text('Opening balance')),
                ]),
                _line('Balance brought forward', bf == null ? null : bf.cash + bf.bank,
                    bf == null ? '' : 'cash ${_money(bf.cash)} · bank ${_money(bf.bank)}'),
                _line('+ Income', tIn, '${inc.length} entries', color: _green),
                _line('− Expenses', -tOut, '${exp.length} entries', color: _red),
                const Divider(),
                _line('Closing balance', bf == null ? null : bf.cash + bf.bank + net,
                    bf == null ? '' : 'cash ${_money(bf.cash + cashNet)} · bank ${_money(bf.bank + bankNet)}',
                    big: true),
                if (_type.isNotEmpty)
                  const Padding(
                    padding: EdgeInsets.only(top: 4),
                    child: Text('Showing one type only — closing balance uses only the entries shown.',
                        style: TextStyle(fontSize: 11.5, color: AppColors.warning)),
                  ),
              ]),
            ),
          ),
          SectionTitle('Entries', trailing: Text(_manual == null ? 'Loading…' : '${all.length}', style: const TextStyle(color: AppColors.muted))),
          if (_manual != null && all.isEmpty)
            const Card(child: EmptyState(icon: Icons.receipt_long_outlined, title: 'No entries in this period', message: 'Use + Income or + Expense.'))
          else
            Card(
              child: Column(children: [
                for (var i = 0; i < all.length; i++) ...[
                  if (i > 0) const Divider(height: 1, indent: 16),
                  _tile(all[i]),
                ],
              ]),
            ),
          const Padding(
            padding: EdgeInsets.all(8),
            child: Text(
                'Petty cash given to staff and driver payments are added automatically. Staff spending from petty cash is not counted again. '
                'Full reports (Excel / PDF): web dashboard → Accounts.',
                style: TextStyle(fontSize: 12, color: AppColors.muted)),
          ),
        ]),
      ),
    );
  }

  Widget _line(String label, double? v, String sub, {Color? color, bool big = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(label, style: TextStyle(fontWeight: big ? FontWeight.w800 : FontWeight.w600, fontSize: big ? 15.5 : 14)),
              if (sub.isNotEmpty) Text(sub, style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
            ]),
          ),
          Text(v == null ? '…' : _money(v),
              style: TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: big ? 19 : 15,
                  color: color ?? (big && v != null ? (v >= 0 ? _green : _red) : null))),
        ]),
      );

  Widget _tile(AcctEntry e) {
    final auto = e.source != 'manual';
    return ListTile(
      onTap: auto ? null : () => _edit(e, e.type),
      onLongPress: auto ? null : () => _delete(e),
      leading: CircleAvatar(
        backgroundColor: (e.isIncome ? _green : _red).withValues(alpha: 0.1),
        child: Icon(e.isIncome ? Icons.south_west : Icons.north_east, color: e.isIncome ? _green : _red, size: 20),
      ),
      title: Text('${e.category}${e.party.isEmpty ? '' : ' · ${e.party}'}',
          maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
      subtitle: Text(
        [
          e.date,
          e.method,
          if (_projectOf(e).isNotEmpty) _projectOf(e),
          if (e.reference.isNotEmpty) '${e.method == 'Cheque' ? 'Chq' : 'Ref'} ${e.reference}',
          if (e.bank.isNotEmpty) e.bank,
          if (e.note.isNotEmpty) e.note,
          if (auto) 'auto · ${e.source == 'petty' ? 'petty cash' : 'driver payment'}',
        ].join(' · '),
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontSize: 12),
      ),
      trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
        Text('${e.isIncome ? '+' : '−'}${fmtMoney(e.amount)}',
            style: TextStyle(fontWeight: FontWeight.w800, color: e.isIncome ? _green : _red)),
        if (e.hasFile)
          InkWell(
            onTap: () => _showFile(e),
            child: const Padding(padding: EdgeInsets.only(top: 2), child: Icon(Icons.receipt_long, size: 18, color: AppColors.muted)),
          ),
      ]),
    );
  }

  Future<void> _showFile(AcctEntry e) async {
    try {
      final f = await Db.acctFile(e.id);
      if (f == null || !mounted) return;
      if (f.mime == 'application/pdf') {
        showSnack(context, 'This copy is a PDF — open it on the web dashboard.');
        return;
      }
      openPhoto(context, f.base64);
    } catch (er) {
      if (mounted) showSnack(context, 'Could not open: $er', error: true);
    }
  }

  Future<void> _delete(AcctEntry e) async {
    if (!await confirm(context, 'Delete entry', 'Delete ${e.type} of ${fmtMoney(e.amount)} (${e.category}) on ${e.date}?', ok: 'Delete', danger: true)) return;
    try {
      await Db.deleteAcct(e);
      if (mounted) showSnack(context, 'Deleted');
    } catch (er) {
      if (mounted) showSnack(context, 'Could not delete: $er', error: true);
    }
  }

  Future<void> _openingDialog() async {
    final o = await Db.acctOpening();
    if (!mounted) return;
    final cash = TextEditingController(text: o.cash == 0 ? '' : o.cash.toString());
    final bank = TextEditingController(text: o.bank == 0 ? '' : o.bank.toString());
    var date = o.date.isEmpty ? DateTime(DateTime.now().year, DateTime.now().month, 1) : parseDateKey(o.date);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, set) => AlertDialog(
          title: const Text('Opening balance'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            const Text('Money the company had when you start using Accounts. Each period starts with this plus everything entered before it.',
                style: TextStyle(fontSize: 12.5, color: AppColors.muted)),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.event),
              title: Text('As at ${fmtDate(date)}'),
              onTap: () async {
                final d = await showDatePicker(context: c, initialDate: date, firstDate: DateTime(2015), lastDate: DateTime(2100));
                if (d != null) set(() => date = d);
              },
            ),
            TextField(controller: cash, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
                decoration: const InputDecoration(labelText: 'Cash in hand ($kCurrency)')),
            const SizedBox(height: 10),
            TextField(controller: bank, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
                decoration: const InputDecoration(labelText: 'Bank balance ($kCurrency)')),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
            FilledButton(style: kDialogButton, onPressed: () => Navigator.pop(c, true), child: const Text('SAVE')),
          ],
        ),
      ),
    );
    if (ok != true) return;
    try {
      await Db.saveAcctOpening(dateKey(date), double.tryParse(cash.text.trim()) ?? 0, double.tryParse(bank.text.trim()) ?? 0, widget.me.name);
      if (mounted) showSnack(context, 'Opening balance saved');
      _reloadSide();
    } catch (e) {
      if (mounted) showSnack(context, 'Could not save: $e', error: true);
    }
  }

  Future<void> _edit(AcctEntry? e, String kind) async {
    final income = kind == 'income';
    final cats = income ? kAcctIncome : kAcctExpense;
    final partyKey = income ? 'receivedFrom' : 'paidTo';
    var date = e == null ? DateTime.now() : parseDateKey(e.date);
    final amt = TextEditingController(text: e == null ? '' : e.amount.toString());
    var cat = e?.category ?? cats.first;
    final party = TextEditingController(text: e?.party);
    var method = e?.method ?? (income ? 'Cheque' : 'Cash');
    final ref = TextEditingController(text: e?.reference);
    final bankC = TextEditingController(text: e?.bank);
    final note = TextEditingController(text: e?.note);
    String siteId = e?.siteId ?? '';
    String projectId = e == null ? '' : _projectIdOf(e);
    String? photo;
    String? err;
    final sites = widget.live.sites.where((s) => s.approved).toList();
    // Saved suppliers / payers and projects (shared with the invoicing app).
    var saved = <String>[];
    var projects = <({String id, String label})>[];
    try {
      final r = await Future.wait([Db.acctParties(), Db.acctProjects()]);
      saved = List<String>.from((r[0] as Map<String, List<String>>)[partyKey] ?? const <String>[]);
      projects = r[1] as List<({String id, String label})>;
    } catch (_) {}
    if (!mounted) return;
    final color = income ? _green : _red;
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (c) => StatefulBuilder(builder: (c, set) {
        final t = party.text.trim().toLowerCase();
        final sugg = saved.where((n) => n.toLowerCase() != t && (t.isEmpty || n.toLowerCase().contains(t))).take(12).toList();
        // The keyboard's height: the sheet sits right on top of it, with SAVE always visible.
        return Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(c).bottom),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 4),
              child: Text('${e == null ? 'Add' : 'Edit'} ${income ? 'income' : 'expense'}',
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            ),
            Flexible(
              child: SingleChildScrollView(
                keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.manual,
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 12),
                child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.event),
                    title: Text(fmtDate(date)),
                    onTap: () async {
                      final d = await showDatePicker(context: c, initialDate: date, firstDate: DateTime(2015), lastDate: DateTime(2100));
                      if (d != null) set(() => date = d);
                    },
                  ),
                  TextField(
                    controller: amt,
                    autofocus: e == null,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    textInputAction: TextInputAction.next,
                    style: TextStyle(fontWeight: FontWeight.w800, color: color),
                    decoration: InputDecoration(labelText: 'Amount ($kCurrency)', errorText: err),
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    value: cats.contains(cat) ? cat : null,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Category'),
                    hint: Text(cat),
                    items: [for (final x in cats) DropdownMenuItem(value: x, child: Text(x))],
                    onChanged: (v) => set(() => cat = v ?? cat),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: party,
                    textCapitalization: TextCapitalization.words,
                    textInputAction: TextInputAction.next,
                    onChanged: (_) => set(() {}),
                    decoration: InputDecoration(
                      labelText: income ? 'Received from' : 'Paid to (supplier / party)',
                      helperText: sugg.isEmpty && party.text.trim().isNotEmpty && !saved.any((n) => n.toLowerCase() == t)
                          ? 'New name — saved for next time'
                          : null,
                    ),
                  ),
                  if (sugg.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Wrap(spacing: 6, runSpacing: 6, children: [
                      for (final n in sugg)
                        InputChip(
                          label: Text(n, style: const TextStyle(fontSize: 13)),
                          visualDensity: VisualDensity.compact,
                          onPressed: () => set(() {
                            party.text = n;
                            party.selection = TextSelection.collapsed(offset: n.length);
                          }),
                          onDeleted: () async {
                            set(() => saved.remove(n));
                            try {
                              await Db.saveAcctParty(partyKey, n, remove: true);
                            } catch (_) {}
                          },
                          deleteButtonTooltipMessage: 'Remove from saved list',
                        ),
                    ]),
                  ],
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    value: kAcctMethods.contains(method) ? method : 'Cash',
                    decoration: const InputDecoration(labelText: 'Method'),
                    items: [for (final m in kAcctMethods) DropdownMenuItem(value: m, child: Text(m))],
                    onChanged: (v) => set(() => method = v ?? 'Cash'),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                      controller: ref,
                      textInputAction: TextInputAction.next,
                      decoration: InputDecoration(
                          labelText: method == 'Cheque' ? 'Cheque no.' : (method == 'Cash' ? 'Receipt / voucher no.' : 'Transaction ref.'))),
                  if (method == 'Cheque') ...[
                    const SizedBox(height: 10),
                    TextField(controller: bankC, textInputAction: TextInputAction.next, decoration: const InputDecoration(labelText: 'Bank')),
                  ],
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    value: projects.any((p) => p.id == projectId) ? projectId : '',
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Project (optional)'),
                    items: [
                      const DropdownMenuItem(value: '', child: Text('—')),
                      for (final p in projects) DropdownMenuItem(value: p.id, child: Text(p.label, overflow: TextOverflow.ellipsis)),
                    ],
                    onChanged: (v) => set(() => projectId = v ?? ''),
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    value: sites.any((s) => s.id == siteId) ? siteId : '',
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Site (optional)'),
                    items: [
                      const DropdownMenuItem(value: '', child: Text('—')),
                      for (final s in sites) DropdownMenuItem(value: s.id, child: Text(s.name, overflow: TextOverflow.ellipsis)),
                    ],
                    onChanged: (v) => set(() {
                      siteId = v ?? '';
                      final sp = widget.live.siteById(siteId)?.projectId ?? '';
                      if (projectId.isEmpty && sp.isNotEmpty) projectId = sp;
                    }),
                  ),
                  const SizedBox(height: 10),
                  TextField(controller: note, textInputAction: TextInputAction.done, decoration: const InputDecoration(labelText: 'Note')),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(minimumSize: const Size(0, 42)),
                    onPressed: () async {
                      try {
                        final p = await PhotoService.pick(camera: true);
                        if (p != null) set(() => photo = p);
                      } catch (er) {
                        set(() => err = '$er');
                      }
                    },
                    icon: Icon(photo != null ? Icons.check_circle : Icons.photo_camera_outlined),
                    label: Text(photo != null ? 'Receipt photo added' : (e?.hasFile == true ? 'Replace receipt photo' : 'Add receipt photo')),
                  ),
                ]),
              ),
            ),
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
              child: Row(children: [
                Expanded(
                  child: OutlinedButton(
                    style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)),
                    onPressed: () => Navigator.pop(c, false),
                    child: const Text('Cancel'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  flex: 2,
                  child: FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: color, minimumSize: const Size(0, 48)),
                    onPressed: () {
                      final v = double.tryParse(amt.text.trim());
                      if (v == null || v <= 0) {
                        set(() => err = 'Enter the amount');
                        return;
                      }
                      Navigator.pop(c, true);
                    },
                    child: const Text('SAVE'),
                  ),
                ),
              ]),
            ),
          ]),
        );
      }),
    );
    if (ok != true) return;
    final site = widget.live.siteById(siteId);
    final proj = projects.where((p) => p.id == projectId).firstOrNull;
    final who = party.text.trim();
    try {
      await Db.saveAcct(
        id: e?.id,
        by: widget.me,
        photoBase64: photo,
        data: {
          'type': kind,
          'date': dateKey(date),
          'amount': _r2(double.parse(amt.text.trim())),
          'category': cat,
          'party': who,
          'method': method,
          'reference': ref.text.trim(),
          'bank': method == 'Cheque' ? bankC.text.trim() : '',
          'siteId': siteId,
          'siteName': site?.name ?? '',
          'projectId': proj?.id ?? '',
          'projectName': proj?.label ?? '',
          'note': note.text.trim(),
        },
      );
      if (who.isNotEmpty && !saved.any((n) => n.toLowerCase() == who.toLowerCase())) {
        Db.saveAcctParty(partyKey, who).catchError((_) {});
      }
      if (mounted) showSnack(context, e == null ? '${income ? 'Income' : 'Expense'} added' : 'Saved');
      if (e != null || dateKey(date).compareTo(_range.from) < 0) _reloadSide();
    } catch (er) {
      if (mounted) showSnack(context, 'Could not save: $er', error: true);
    }
  }
}
