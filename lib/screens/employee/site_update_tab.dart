import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/db.dart';
import '../../services/location_service.dart';
import '../../services/photo_service.dart';
import '../../widgets/common.dart';
import '../../widgets/tiles.dart';

const updateCategories = ['Progress', 'Issue', 'Material', 'Safety'];

class SiteUpdateTab extends StatefulWidget {
  final AppUser me;
  final AttendanceSession? open;
  const SiteUpdateTab({super.key, required this.me, required this.open});

  @override
  State<SiteUpdateTab> createState() => _SiteUpdateTabState();
}

class _SiteUpdateTabState extends State<SiteUpdateTab> {
  late final Stream<List<Site>> _sitesStream = Db.sitesStream(activeOnly: true);
  late Stream<List<SiteUpdate>> _mine =
      Db.updatesForEmployeeMonth(widget.me.id, monthKey(DateTime.now()));

  final _note = TextEditingController();
  String? _siteId;
  String _category = 'Progress';
  bool _withProgress = false;
  double _progress = 0;
  final List<String> _photos = [];
  bool _saving = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _addPhoto(bool camera) async {
    if (_photos.length >= 3) {
      showSnack(context, 'Maximum 3 photos per update.');
      return;
    }
    try {
      final p = await PhotoService.pick(camera: camera);
      if (p != null && mounted) setState(() => _photos.add(p));
    } catch (e) {
      if (mounted) showSnack(context, '$e', error: true);
    }
  }

  Future<void> _submit(List<Site> sites) async {
    final site = sites.where((s) => s.id == _siteId).firstOrNull;
    if (site == null) {
      showSnack(context, 'Please choose a site.', error: true);
      return;
    }
    if (_note.text.trim().isEmpty && _photos.isEmpty) {
      showSnack(context, 'Write a note or add a photo.', error: true);
      return;
    }
    setState(() => _saving = true);
    try {
      double? lat, lng;
      try {
        final p = await LocationService.current().timeout(const Duration(seconds: 12));
        lat = p.latitude;
        lng = p.longitude;
      } catch (_) {
        // Location is a nice-to-have for updates; don't block the submission.
      }
      final progress = _withProgress ? _progress.round() : null;
      await Db.addSiteUpdate(
        user: widget.me,
        site: site,
        category: _category,
        note: _note.text.trim(),
        progress: progress,
        photos: List.of(_photos),
        lat: lat,
        lng: lng,
      );
      if (progress != null) {
        try {
          await Db.updateSiteProgress(site.id, progress);
        } catch (_) {}
      }
      if (!mounted) return;
      setState(() {
        _note.clear();
        _photos.clear();
        _withProgress = false;
        _category = 'Progress';
      });
      FocusScope.of(context).unfocus();
      showSnack(context, 'Update posted for ${site.name}');
    } catch (e) {
      if (mounted) showSnack(context, 'Failed to post: $e', error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return StreamView<List<Site>>(
      stream: _sitesStream,
      builder: (context, allSites) {
        final sites = allSites.where((s) => s.approved || s.createdBy == widget.me.id).toList();
        // Default to the site the employee is currently checked in at.
        if (_siteId == null || !sites.any((s) => s.id == _siteId)) {
          final openId = widget.open?.siteId;
          _siteId = sites.any((s) => s.id == openId)
              ? openId
              : (sites.isNotEmpty ? sites.first.id : null);
          final s = sites.where((s) => s.id == _siteId).firstOrNull;
          if (s != null) _progress = s.progress.toDouble();
        }
        return RefreshIndicator(
          onRefresh: () async => setState(() {
            _mine = Db.updatesForEmployeeMonth(widget.me.id, monthKey(DateTime.now()));
          }),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
            children: [
              _form(sites),
              const SectionTitle('My updates this month'),
              StreamView<List<SiteUpdate>>(
                stream: _mine,
                builder: (context, list) => list.isEmpty
                    ? const Card(
                        child: EmptyState(
                            icon: Icons.construction_outlined,
                            title: 'No updates posted yet',
                            message: 'Share progress, issues or material needs from your sites.'),
                      )
                    : Column(
                        children: list
                            .map((u) => Padding(
                                  padding: const EdgeInsets.only(bottom: 10),
                                  child: UpdateCard(u, showName: false),
                                ))
                            .toList(),
                      ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _form(List<Site> sites) {
    if (sites.isEmpty) {
      return const Card(
        child: EmptyState(
          icon: Icons.location_city_outlined,
          title: 'No active sites',
          message: 'Management has not added any sites yet.',
        ),
      );
    }
    final site = sites.where((s) => s.id == _siteId).firstOrNull;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          DropdownButtonFormField<String>(
            value: _siteId,
            isExpanded: true,
            decoration: const InputDecoration(
              labelText: 'Site',
              prefixIcon: Icon(Icons.location_city_outlined),
            ),
            items: sites
                .map((s) => DropdownMenuItem(
                      value: s.id,
                      child: Text(
                        s.id == widget.open?.siteId ? '${s.name}  (checked in)' : s.name,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ))
                .toList(),
            onChanged: (v) => setState(() {
              _siteId = v;
              final s = sites.where((x) => x.id == v).firstOrNull;
              if (s != null) _progress = s.progress.toDouble();
            }),
          ),
          if (site != null) ...[
            const SizedBox(height: 10),
            Row(children: [
              const Text('Current progress  ',
                  style: TextStyle(color: AppColors.muted, fontSize: 13)),
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: LinearProgressIndicator(
                    value: site.progress / 100,
                    minHeight: 6,
                    backgroundColor: const Color(0xFFE3E8EB),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text('${site.progress}%', style: const TextStyle(fontWeight: FontWeight.w700)),
            ]),
          ],
          const SizedBox(height: 14),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: updateCategories.map((c) {
              final sel = c == _category;
              return ChoiceChip(
                label: Text(c),
                avatar: Icon(UpdateCard.iconFor(c),
                    size: 16, color: sel ? Colors.white : UpdateCard.colorFor(c)),
                selected: sel,
                showCheckmark: false,
                selectedColor: UpdateCard.colorFor(c),
                labelStyle: TextStyle(
                    color: sel ? Colors.white : AppColors.ink, fontWeight: FontWeight.w600),
                onSelected: (_) => setState(() => _category = c),
              );
            }).toList(),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _note,
            minLines: 3,
            maxLines: 6,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(
              hintText: _category == 'Issue'
                  ? 'Describe the problem…'
                  : (_category == 'Material'
                      ? 'Which materials and how much is needed?'
                      : 'What was done today?'),
            ),
          ),
          const SizedBox(height: 8),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Update work progress %'),
            value: _withProgress,
            onChanged: (v) => setState(() => _withProgress = v),
          ),
          if (_withProgress)
            Row(children: [
              Expanded(
                child: Slider(
                  value: _progress,
                  min: 0,
                  max: 100,
                  divisions: 20,
                  label: '${_progress.round()}%',
                  onChanged: (v) => setState(() => _progress = v),
                ),
              ),
              SizedBox(
                width: 48,
                child: Text('${_progress.round()}%',
                    textAlign: TextAlign.end,
                    style: const TextStyle(fontWeight: FontWeight.w800)),
              ),
            ]),
          const SizedBox(height: 6),
          PhotoStrip(_photos, onRemove: (i) => setState(() => _photos.removeAt(i))),
          if (_photos.isNotEmpty) const SizedBox(height: 10),
          Row(children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _saving ? null : () => _addPhoto(true),
                icon: const Icon(Icons.photo_camera_outlined),
                label: const Text('Camera'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _saving ? null : () => _addPhoto(false),
                icon: const Icon(Icons.photo_library_outlined),
                label: const Text('Gallery'),
              ),
            ),
          ]),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: _saving ? null : () => _submit(sites),
            icon: _saving
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Icon(Icons.send),
            label: Text(_saving ? 'Posting…' : 'Post update'),
          ),
        ]),
      ),
    );
  }
}
