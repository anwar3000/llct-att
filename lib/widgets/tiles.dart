import 'dart:async';

import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../core/utils.dart';
import '../models/models.dart';
import '../services/db.dart';
import '../services/photo_service.dart';
import 'common.dart';

/// Ticking hh:mm:ss timer. Isolated so only this widget rebuilds every second.
class LiveTimer extends StatefulWidget {
  final DateTime since;
  final Duration base; // already-completed time to add (e.g. earlier sessions today)
  final TextStyle? style;
  final bool compact;
  const LiveTimer({
    super.key,
    required this.since,
    this.base = Duration.zero,
    this.style,
    this.compact = false,
  });

  @override
  State<LiveTimer> createState() => _LiveTimerState();
}

class _LiveTimerState extends State<LiveTimer> {
  Timer? _t;

  @override
  void initState() {
    super.initState();
    _t = Timer.periodic(Duration(seconds: widget.compact ? 30 : 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.base + DateTime.now().difference(widget.since);
    return Text(widget.compact ? fmtDuration(d) : fmtClock(d), style: widget.style);
  }
}

/// One check-in → check-out session.
class SessionTile extends StatelessWidget {
  final AttendanceSession s;
  final bool showName;
  final VoidCallback? onTap;
  final Widget? trailing;
  const SessionTile(this.s, {super.key, this.showName = false, this.onTap, this.trailing});

  @override
  Widget build(BuildContext context) {
    final color = s.isOpen ? AppColors.success : AppColors.primary;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            width: 4,
            height: 48,
            decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(4)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(showName ? '${s.employeeName} · ${s.siteName}' : s.siteName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5)),
              const SizedBox(height: 3),
              Row(children: [
                const Icon(Icons.login, size: 14, color: AppColors.success),
                const SizedBox(width: 4),
                Text(fmtTime(s.inLocal), style: const TextStyle(fontSize: 13)),
                const SizedBox(width: 12),
                const Icon(Icons.logout, size: 14, color: AppColors.danger),
                const SizedBox(width: 4),
                Text(s.isOpen ? 'In progress' : fmtTime(s.outLocal),
                    style: TextStyle(
                        fontSize: 13,
                        color: s.isOpen ? AppColors.success : null,
                        fontWeight: s.isOpen ? FontWeight.w600 : null)),
              ]),
              if (s.flagged) ...[
                const SizedBox(height: 5),
                Wrap(spacing: 6, runSpacing: 4, children: [
                  if (s.inOutside)
                    Pill('In: ${fmtDistance(s.inDistance)} away',
                        color: AppColors.warning, icon: Icons.wrong_location_outlined),
                  if (s.outOutside)
                    Pill('Out: ${fmtDistance(s.outDistance)} away',
                        color: AppColors.warning, icon: Icons.wrong_location_outlined),
                  if (s.mocked)
                    const Pill('Fake GPS', color: AppColors.danger, icon: Icons.gps_off),
                ]),
              ],
            ]),
          ),
          const SizedBox(width: 8),
          trailing ??
              (s.isOpen
                  ? LiveTimer(
                      since: s.checkIn,
                      compact: true,
                      style: const TextStyle(
                          fontWeight: FontWeight.w800, color: AppColors.success))
                  : Text(fmtDuration(s.worked()),
                      style: const TextStyle(fontWeight: FontWeight.w800))),
        ]),
      ),
    );
  }
}

/// Petty cash transaction row.
class PettyTile extends StatelessWidget {
  final PettyTxn t;
  final bool showName;
  final Widget? actions;
  final VoidCallback? onTap;
  const PettyTile(this.t, {super.key, this.showName = false, this.actions, this.onTap});

  static IconData iconFor(String category) {
    switch (category.toLowerCase()) {
      case 'fuel':
        return Icons.local_gas_station_outlined;
      case 'food':
        return Icons.restaurant_outlined;
      case 'travel':
        return Icons.directions_bus_outlined;
      case 'materials':
        return Icons.inventory_2_outlined;
      case 'tools':
        return Icons.handyman_outlined;
      case 'cash advance':
        return Icons.payments_outlined;
      default:
        return Icons.receipt_long_outlined;
    }
  }

  @override
  Widget build(BuildContext context) {
    final credit = t.isCredit;
    final color = credit ? AppColors.success : AppColors.danger;
    final dim = t.status == 'rejected';
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(children: [
            Row(children: [
              Container(
                padding: const EdgeInsets.all(9),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(credit ? Icons.south_west : iconFor(t.category),
                    color: color, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(
                    showName
                        ? t.employeeName
                        : (credit ? 'Cash received' : (t.category.isEmpty ? 'Expense' : t.category)),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    [
                      if (showName) credit ? 'Cash given' : t.category,
                      if (t.siteName.isNotEmpty) t.siteName,
                      fmtDateTime(t.createdAt),
                    ].where((e) => e.isNotEmpty).join(' · '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12, color: AppColors.muted),
                  ),
                ]),
              ),
              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                Text('${credit ? '+' : '−'} ${fmtMoney(t.amount)}',
                    style: TextStyle(
                      fontWeight: FontWeight.w800,
                      color: dim ? AppColors.muted : color,
                      decoration: dim ? TextDecoration.lineThrough : null,
                    )),
                const SizedBox(height: 4),
                Pill.status(t.status),
              ]),
            ]),
            if (t.note.isNotEmpty || t.receipt != null || t.reviewNote.isNotEmpty) ...[
              const SizedBox(height: 8),
              Row(children: [
                const SizedBox(width: 50),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    if (t.note.isNotEmpty)
                      Text(t.note, style: const TextStyle(fontSize: 13)),
                    if (t.reviewNote.isNotEmpty)
                      Text('Manager: ${t.reviewNote}',
                          style: const TextStyle(
                              fontSize: 12.5, color: AppColors.muted, fontStyle: FontStyle.italic)),
                  ]),
                ),
                if (t.receipt != null)
                  GestureDetector(
                    onTap: () => openPhoto(context, t.receipt!),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: Base64Image(t.receipt!, width: 44, height: 44),
                    ),
                  ),
              ]),
            ],
            if (actions != null) ...[const SizedBox(height: 8), actions!],
          ]),
        ),
      ),
    );
  }
}

/// Balance summary card for petty cash.
class PettyBalanceCard extends StatelessWidget {
  final PettySummary s;
  final String title;
  const PettyBalanceCard(this.s, {super.key, this.title = 'Petty cash balance'});

  @override
  Widget build(BuildContext context) {
    final negative = s.balance < 0;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [AppColors.primaryDark, AppColors.primary],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: TextStyle(color: Colors.white.withValues(alpha: 0.8))),
        const SizedBox(height: 6),
        Text(fmtMoney(s.balance),
            style: TextStyle(
                color: negative ? const Color(0xFFFFB4A8) : Colors.white,
                fontSize: 32,
                fontWeight: FontWeight.w800)),
        if (negative)
          Text('Company owes you ${fmtMoney(-s.balance)}',
              style: const TextStyle(color: Color(0xFFFFD7CF), fontSize: 12.5)),
        const SizedBox(height: 14),
        Row(children: [
          _mini('Received', fmtMoney(s.credited), Icons.south_west),
          _mini('Spent', fmtMoney(s.spent), Icons.north_east),
          _mini('Pending', '${fmtMoney(s.pending)} (${s.pendingCount})', Icons.schedule),
        ]),
      ]),
    );
  }

  Widget _mini(String label, String value, IconData icon) => Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(icon, size: 13, color: Colors.white70),
            const SizedBox(width: 4),
            Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12)),
          ]),
          const SizedBox(height: 2),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(value,
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
          ),
        ]),
      );
}

/// Site update card (note, progress, photos).
class UpdateCard extends StatelessWidget {
  final SiteUpdate u;
  final bool showSite;
  final bool showName;
  final VoidCallback? onDelete;
  const UpdateCard(this.u,
      {super.key, this.showSite = true, this.showName = true, this.onDelete});

  static Color colorFor(String c) {
    switch (c) {
      case 'Issue':
        return AppColors.danger;
      case 'Material':
        return AppColors.info;
      case 'Safety':
        return AppColors.warning;
      default:
        return AppColors.success;
    }
  }

  static IconData iconFor(String c) {
    switch (c) {
      case 'Issue':
        return Icons.report_problem_outlined;
      case 'Material':
        return Icons.inventory_2_outlined;
      case 'Safety':
        return Icons.health_and_safety_outlined;
      default:
        return Icons.trending_up;
    }
  }

  bool get _canEdit {
    final me = CurrentUser.me;
    return onDelete != null || (me != null && (me.isManagement || me.id == u.employeeId));
  }

  Future<void> _delete(BuildContext context) async {
    if (onDelete != null) {
      onDelete!();
      return;
    }
    if (!await confirm(context, 'Delete update?', 'This update and its photos will be removed.',
        danger: true, ok: 'Delete')) {
      return;
    }
    try {
      await Db.deleteSiteUpdate(u.id);
      if (context.mounted) showSnack(context, 'Update deleted');
    } catch (e) {
      if (context.mounted) showSnack(context, 'Could not delete: $e', error: true);
    }
  }

  void _edit(BuildContext context) => showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        showDragHandle: true,
        builder: (_) => _UpdateEditSheet(u),
      );

  @override
  Widget build(BuildContext context) {
    final color = colorFor(u.category);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            if (showName) ...[Avatar(u.employeeName, size: 34), const SizedBox(width: 10)],
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(
                  [if (showName) u.employeeName, if (showSite) u.siteName].join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                Text(
                    '${fmtDateTime(u.createdLocal)}${u.tz != null ? ' (${tzLabel(u.tz)})' : ''}'
                    '${u.editedAt != null ? ' · edited' : ''}',
                    style: const TextStyle(fontSize: 12, color: AppColors.muted)),
              ]),
            ),
            Pill(u.category, color: color, icon: iconFor(u.category)),
            if (_canEdit)
              PopupMenuButton<String>(
                tooltip: 'Edit or delete',
                icon: const Icon(Icons.more_vert, size: 20),
                onSelected: (v) => v == 'edit' ? _edit(context) : _delete(context),
                itemBuilder: (_) => const [
                  PopupMenuItem(
                      value: 'edit',
                      child: ListTile(
                          dense: true, leading: Icon(Icons.edit_outlined), title: Text('Edit'))),
                  PopupMenuItem(
                      value: 'delete',
                      child: ListTile(
                          dense: true,
                          leading: Icon(Icons.delete_outline, color: AppColors.danger),
                          title: Text('Delete'))),
                ],
              ),
          ]),
          if (u.note.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(u.note, style: const TextStyle(fontSize: 14, height: 1.35)),
          ],
          if (u.progress != null) ...[
            const SizedBox(height: 10),
            Row(children: [
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: LinearProgressIndicator(
                    value: u.progress! / 100,
                    minHeight: 8,
                    backgroundColor: const Color(0xFFE3E8EB),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Text('${u.progress}%', style: const TextStyle(fontWeight: FontWeight.w700)),
            ]),
          ],
          if (u.photos.isNotEmpty) ...[
            const SizedBox(height: 10),
            PhotoStrip(u.photos, size: 84),
          ],
        ]),
      ),
    );
  }
}


/// Edit an existing site update: category, note, progress and photos.
class _UpdateEditSheet extends StatefulWidget {
  final SiteUpdate u;
  const _UpdateEditSheet(this.u);

  @override
  State<_UpdateEditSheet> createState() => _UpdateEditSheetState();
}

class _UpdateEditSheetState extends State<_UpdateEditSheet> {
  static const _categories = ['Progress', 'Issue', 'Material', 'Safety'];
  late String _category = _categories.contains(widget.u.category) ? widget.u.category : 'Progress';
  late final _note = TextEditingController(text: widget.u.note);
  late double? _progress = widget.u.progress?.toDouble();
  late final List<String> _photos = [...widget.u.photos];
  bool _saving = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _addPhoto(bool camera) async {
    try {
      final p = await PhotoService.pick(camera: camera);
      if (p != null && mounted) setState(() => _photos.add(p));
    } catch (e) {
      if (mounted) showSnack(context, '$e', error: true);
    }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await Db.editSiteUpdate(
        widget.u.id,
        category: _category,
        note: _note.text.trim(),
        progress: _progress?.round(),
        photos: _photos,
        editedBy: CurrentUser.me?.name ?? '',
      );
      if (mounted) {
        Navigator.pop(context);
        showSnack(context, 'Update saved');
      }
    } catch (e) {
      if (mounted) showSnack(context, 'Could not save: $e', error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: SingleChildScrollView(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
          Text('Edit update · ${widget.u.siteName}',
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final c in _categories)
              ChoiceChip(
                label: Text(c),
                avatar: Icon(UpdateCard.iconFor(c), size: 16, color: UpdateCard.colorFor(c)),
                selected: _category == c,
                onSelected: (_) => setState(() => _category = c),
              ),
          ]),
          const SizedBox(height: 12),
          TextField(
            controller: _note,
            maxLines: 4,
            minLines: 2,
            decoration: const InputDecoration(labelText: 'Note'),
          ),
          const SizedBox(height: 8),
          Row(children: [
            const Text('Progress'),
            Expanded(
              child: Slider(
                value: _progress ?? 0,
                min: 0,
                max: 100,
                divisions: 20,
                label: _progress == null ? 'not set' : '${_progress!.round()}%',
                onChanged: (v) => setState(() => _progress = v),
              ),
            ),
            SizedBox(
                width: 64,
                child: Text(_progress == null ? '—' : '${_progress!.round()}%',
                    textAlign: TextAlign.end, style: const TextStyle(fontWeight: FontWeight.w700))),
            if (_progress != null)
              IconButton(
                  tooltip: 'Clear',
                  onPressed: () => setState(() => _progress = null),
                  icon: const Icon(Icons.close, size: 18)),
          ]),
          if (_photos.isNotEmpty)
            SizedBox(
              height: 86,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: _photos.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (_, i) => Stack(children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: SizedBox(width: 86, height: 86, child: Base64Image(_photos[i], fit: BoxFit.cover)),
                  ),
                  Positioned(
                    right: 2,
                    top: 2,
                    child: InkWell(
                      onTap: () => setState(() => _photos.removeAt(i)),
                      child: Container(
                        decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                        padding: const EdgeInsets.all(3),
                        child: const Icon(Icons.close, size: 16, color: Colors.white),
                      ),
                    ),
                  ),
                ]),
              ),
            ),
          const SizedBox(height: 6),
          Row(children: [
            TextButton.icon(
                onPressed: _photos.length >= 3 ? null : () => _addPhoto(true),
                icon: const Icon(Icons.photo_camera_outlined),
                label: const Text('Camera')),
            TextButton.icon(
                onPressed: _photos.length >= 3 ? null : () => _addPhoto(false),
                icon: const Icon(Icons.photo_library_outlined),
                label: const Text('Gallery')),
          ]),
          const SizedBox(height: 8),
          FilledButton.icon(
            onPressed: _saving ? null : _save,
            icon: const Icon(Icons.check),
            label: Text(_saving ? 'Saving…' : 'Save changes'),
          ),
        ]),
      ),
    );
  }
}
