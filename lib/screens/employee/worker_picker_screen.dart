import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/db.dart';
import '../../widgets/common.dart';

/// Pick the external workers (labour) who are with you on this check-in.
/// Workers don't punch themselves — their time follows this check-in.
/// A worker already on another check-in (any site) can't be picked twice.
class WorkerPickerScreen extends StatefulWidget {
  final AppUser me;
  final String sessionId;
  final String siteId;
  final String siteName;
  final DateTime sessionStart;
  final bool afterCheckIn;

  const WorkerPickerScreen({
    super.key,
    required this.me,
    required this.sessionId,
    required this.siteId,
    required this.siteName,
    required this.sessionStart,
    this.afterCheckIn = false,
  });

  @override
  State<WorkerPickerScreen> createState() => _WorkerPickerScreenState();
}

class _WorkerPickerScreenState extends State<WorkerPickerScreen> {
  final _search = TextEditingController();
  final List<StreamSubscription> _subs = [];
  List<ExtWorker> _workers = [];
  Map<String, WorkerLock> _locks = {};
  List<WorkerEntry> _entries = [];
  final Set<String> _selected = {};
  bool _loadedWorkers = false, _loadedEntries = false, _initialised = false;
  bool _saving = false;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _subs.add(Db.activeWorkersStream().listen((l) {
      if (mounted) setState(() { _workers = l; _loadedWorkers = true; });
    }, onError: (e) {
      if (mounted) setState(() { _loadedWorkers = true; _loadError = '$e'; });
    }));
    _subs.add(Db.workerLocksStream().listen((m) {
      if (mounted) setState(() => _locks = m);
    }));
    _subs.add(Db.workersForSession(widget.sessionId, widget.me.id).listen((l) {
      if (!mounted) return;
      _loadError = null;
      setState(() {
        _entries = l;
        _loadedEntries = true;
        if (!_initialised) {
          _initialised = true;
          _selected.addAll(_onSiteIds);
        }
      });
    }, onError: (e) {
      if (mounted) setState(() { _loadedEntries = true; _loadError = '$e'; });
    }));
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    _search.dispose();
    super.dispose();
  }

  Set<String> get _onSiteIds => _entries.where((e) => e.open).map((e) => e.workerId).toSet();

  /// Lock held by a *different* check-in.
  WorkerLock? _busyLock(String workerId) {
    final l = _locks[workerId];
    return (l != null && l.sessionId != widget.sessionId) ? l : null;
  }

  Future<void> _save() async {
    final current = _onSiteIds;
    final add = _workers.where((w) => _selected.contains(w.id) && !current.contains(w.id)).toList();
    final remove = _entries.where((e) => e.open && !_selected.contains(e.workerId)).toList();
    if (add.isEmpty && remove.isEmpty) {
      Navigator.pop(context);
      return;
    }
    if (remove.isNotEmpty) {
      final ok = await confirm(
        context,
        'Remove ${remove.length} worker${remove.length == 1 ? '' : 's'}?',
        '${remove.map((e) => e.workerName).join(', ')}\n\nTheir time on site ends now (${fmtTime(DateTime.now())}).',
        ok: 'Remove',
      );
      if (!ok || !mounted) return;
    }
    setState(() => _saving = true);
    try {
      final now = DateTime.now();
      for (final e in remove) {
        await Db.endWorkerEntry(e, now);
      }
      final busy = await Db.addWorkersToSession(
        user: widget.me,
        sessionId: widget.sessionId,
        siteId: widget.siteId,
        siteName: widget.siteName,
        sessionStart: widget.sessionStart,
        workers: add,
      );
      if (!mounted) return;
      if (busy.isNotEmpty) {
        await showDialog<void>(
          context: context,
          builder: (c) => AlertDialog(
            icon: const Icon(Icons.block, color: AppColors.danger),
            title: const Text('Already on another check-in'),
            content: Text('${busy.join('\n')}\n\nA worker can be on only one site at a time. '
                'Ask that employee to remove them, or ask management to release them.'),
            actions: [FilledButton(onPressed: () => Navigator.pop(c), child: const Text('OK'))],
          ),
        );
        if (!mounted) return;
      }
      final added = add.length - busy.length;
      showSnack(context, [
        if (added > 0) '$added worker${added == 1 ? '' : 's'} added',
        if (remove.isNotEmpty) '${remove.length} removed',
      ].join(' · ').ifEmpty('No changes'));
      Navigator.pop(context);
    } catch (e) {
      if (mounted) showSnack(context, 'Could not save: $e', error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _addNew() async {
    final name = TextEditingController(text: _search.text.trim());
    final phone = TextEditingController();
    final company = TextEditingController();
    final trade = TextEditingController();
    String? err;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, setD) => AlertDialog(
          title: const Text('Add new external worker'),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Text('Only if the worker is not in the list. Management will add their documents later.',
                  style: TextStyle(fontSize: 12.5, color: AppColors.muted)),
              const SizedBox(height: 12),
              TextField(
                  controller: name,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(labelText: 'Full name *')),
              const SizedBox(height: 10),
              TextField(
                  controller: phone,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(labelText: 'Phone *')),
              const SizedBox(height: 10),
              TextField(controller: company, decoration: const InputDecoration(labelText: 'Company / agency')),
              const SizedBox(height: 10),
              TextField(controller: trade, decoration: const InputDecoration(labelText: 'Trade (Helper, Mason…)')),
              if (err != null) ...[
                const SizedBox(height: 10),
                Text(err!, style: const TextStyle(color: AppColors.danger, fontSize: 12.5)),
              ],
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
            FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size(90, 44)),
              onPressed: () {
                final n = name.text.trim(), p = phone.text.replaceAll(RegExp(r'[\s-]'), '');
                if (n.isEmpty || p.isEmpty) {
                  setD(() => err = 'Name and phone are required.');
                  return;
                }
                final dup = _workers.where((w) => w.phone.replaceAll(RegExp(r'[\s-]'), '') == p).firstOrNull;
                if (dup != null) {
                  setD(() => err = '${dup.name} already has this phone number — pick them from the list.');
                  return;
                }
                Navigator.pop(c, true);
              },
              child: const Text('Add'),
            ),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    try {
      final w = await Db.addWorkerByEmployee(
        me: widget.me,
        name: name.text.trim(),
        phone: phone.text.trim(),
        company: company.text.trim(),
        trade: trade.text.trim(),
      );
      if (!mounted) return;
      setState(() {
        _selected.add(w.id);
        _search.clear();
      });
      showSnack(context, '${w.name} added and ticked — tap Save to check them in');
    } catch (e) {
      if (mounted) showSnack(context, 'Could not add: $e', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final q = _search.text.trim().toLowerCase();
    final list = _workers
        .where((w) => q.isEmpty ||
            '${w.name} ${w.company} ${w.trade} ${w.phone}'.toLowerCase().contains(q))
        .toList()
      // Selected first, then free, then busy elsewhere.
      ..sort((a, b) {
        int rank(ExtWorker w) =>
            _selected.contains(w.id) ? 0 : (_busyLock(w.id) == null ? 1 : 2);
        final r = rank(a).compareTo(rank(b));
        return r != 0 ? r : a.name.toLowerCase().compareTo(b.name.toLowerCase());
      });
    final changed = _selected.length != _onSiteIds.length || !_selected.containsAll(_onSiteIds);
    final loading = !_loadedWorkers || !_loadedEntries;

    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('External workers'),
          Text(widget.siteName,
              style: const TextStyle(fontSize: 12.5, color: AppColors.muted, fontWeight: FontWeight.w500)),
        ]),
        actions: [
          if (widget.afterCheckIn)
            TextButton(onPressed: _saving ? null : () => Navigator.pop(context), child: const Text('Skip')),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : Column(children: [
              Container(
                width: double.infinity,
                color: AppColors.accentSoft,
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                child: const Text(
                  'Tick the workers who are with you at this site. Their hours follow your check-in '
                  'until you remove them or check out.',
                  style: TextStyle(fontSize: 12.5, color: AppColors.primary),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: Row(children: [
                  Expanded(child: TextField(
                  controller: _search,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(
                    hintText: 'Search name, company, trade…',
                    prefixIcon: Icon(Icons.search),
                    isDense: true,
                  ),
                  )),
                  const SizedBox(width: 8),
                  FilledButton.tonalIcon(
                    style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
                    onPressed: _saving ? null : _addNew,
                    icon: const Icon(Icons.person_add_alt_1),
                    label: const Text('New'),
                  ),
                ]),
              ),
              Expanded(
                child: _loadError != null
                    ? EmptyState(
                        icon: Icons.lock_outline,
                        title: 'Could not load workers',
                        message: _loadError!.contains('permission')
                            ? 'Ask management to publish the latest Firestore rules.'
                            : _loadError!,
                      )
                    : _workers.isEmpty
                    ? const EmptyState(
                        icon: Icons.engineering_outlined,
                        title: 'No external workers registered',
                        message: 'Tap “New” above to add a worker who is with you.',
                      )
                    : ListView.separated(
                        padding: const EdgeInsets.fromLTRB(8, 4, 8, 100),
                        itemCount: list.length,
                        separatorBuilder: (_, __) => const Divider(height: 1, indent: 72),
                        itemBuilder: (c, i) {
                          final w = list[i];
                          final busy = _busyLock(w.id);
                          final entry = _entries.where((e) => e.workerId == w.id && e.open).firstOrNull;
                          final sel = _selected.contains(w.id);
                          return CheckboxListTile(
                            value: sel,
                            enabled: busy == null && !_saving,
                            controlAffinity: ListTileControlAffinity.trailing,
                            activeColor: AppColors.accentDark,
                            secondary: Avatar(w.name, size: 40),
                            title: Text(w.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                            subtitle: Text(
                              busy != null
                                  ? 'With ${busy.employeeName} at ${busy.siteName}'
                                  : entry != null
                                      ? 'On site since ${fmtTime(entry.inLocal)}${w.subtitle.isEmpty ? '' : ' · ${w.subtitle}'}'
                                      : (w.subtitle.isEmpty ? w.phone : w.subtitle),
                              style: TextStyle(
                                  color: busy != null ? AppColors.danger : AppColors.muted, fontSize: 12.5),
                            ),
                            onChanged: (v) => setState(() {
                              if (v == true) {
                                _selected.add(w.id);
                              } else {
                                _selected.remove(w.id);
                              }
                            }),
                          );
                        },
                      ),
              ),
            ]),
      bottomNavigationBar: loading || _workers.isEmpty
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: SizedBox(
                  height: 54,
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.accent,
                      foregroundColor: AppColors.primaryDark,
                      textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
                    ),
                    onPressed: _saving ? null : _save,
                    icon: _saving
                        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.check),
                    label: Text(_saving
                        ? 'Saving…'
                        : changed
                            ? 'Save · ${_selected.length} on site'
                            : '${_selected.length} on site · Done'),
                  ),
                ),
              ),
            ),
    );
  }
}

extension on String {
  String ifEmpty(String other) => isEmpty ? other : this;
}
