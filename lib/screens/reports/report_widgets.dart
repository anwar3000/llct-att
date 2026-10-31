import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils.dart';
import '../../models/models.dart';
import '../../services/inv_reports.dart';

class RCard extends StatelessWidget {
  final List<Widget> children;
  const RCard({super.key, required this.children});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0xFFEBE8E3)),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
      );
}

class RTitle extends StatelessWidget {
  final String text;
  final Widget? trailing;
  const RTitle(this.text, {super.key, this.trailing});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(children: [
          Expanded(child: Text(text, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
          if (trailing != null) trailing!,
        ]),
      );
}

/// One line: name, description, qty, unit, status and serial numbers.
class ItemEditor extends StatefulWidget {
  final int index;
  final Map<String, dynamic> item;
  final ReportKind kind;
  final VoidCallback onRemove;
  final VoidCallback onChanged;
  final bool compact; // sign-off: only status & serials
  const ItemEditor(
      {super.key, required this.index, required this.item, required this.kind, required this.onRemove, required this.onChanged, this.compact = false});

  @override
  State<ItemEditor> createState() => _ItemEditorState();
}

class _ItemEditorState extends State<ItemEditor> {
  final _sn = TextEditingController();

  @override
  void dispose() {
    _sn.dispose();
    super.dispose();
  }

  List<String> get _serials {
    final s = widget.item['serials'];
    if (s is List<String>) return s;
    final l = (s is List) ? s.map((e) => '$e').toList() : <String>[];
    widget.item['serials'] = l;
    return l;
  }

  void _addSerials(String raw) {
    final codes = raw.split(RegExp(r'[\n\r,;\t]+')).map((x) => x.trim()).where((x) => x.isNotEmpty);
    var dup = 0;
    for (final c in codes) {
      if (_serials.contains(c)) {
        dup++;
        continue;
      }
      _serials.add(c);
    }
    _sn.clear();
    if (dup > 0) showSnack(context, dup == 1 ? 'That serial number is already on this line.' : '$dup serial numbers were already on this line.', error: true);
    setState(() {});
    widget.onChanged();
  }

  @override
  Widget build(BuildContext context) {
    final it = widget.item, k = widget.kind;
    final status = k.statuses.contains(it['status']) ? '${it['status']}' : k.statuses.first;
    it['status'] = status;
    final qty = it['qty'] is num ? it['qty'] as num : num.tryParse('${it['qty']}') ?? 0;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
      decoration: BoxDecoration(color: const Color(0xFFFAF9F6), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFEBE8E3))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Text('${widget.index + 1}'.padLeft(2, '0'), style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.muted)),
          const SizedBox(width: 8),
          Expanded(
            child: widget.compact
                ? Text('${it['name']}', style: const TextStyle(fontWeight: FontWeight.w700))
                : TextFormField(
                    initialValue: '${it['name'] ?? ''}',
                    decoration: const InputDecoration(labelText: 'Item name', isDense: true),
                    onChanged: (v) => it['name'] = v,
                  ),
          ),
          if (!widget.compact) IconButton(onPressed: widget.onRemove, icon: const Icon(Icons.delete_outline, color: AppColors.danger)),
        ]),
        if (!widget.compact) ...[
          const SizedBox(height: 6),
          TextFormField(
            initialValue: '${it['desc'] ?? ''}',
            minLines: 1,
            maxLines: 5,
            decoration: const InputDecoration(labelText: 'Description', isDense: true),
            onChanged: (v) => it['desc'] = v,
          ),
          const SizedBox(height: 6),
          Row(children: [
            SizedBox(
              width: 80,
              child: TextFormField(
                initialValue: '${it['qty'] ?? ''}',
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Qty', isDense: true),
                onChanged: (v) {
                  it['qty'] = v.isEmpty ? '' : (num.tryParse(v) ?? v);
                  setState(() {});
                },
              ),
            ),
            const SizedBox(width: 8),
            SizedBox(
              width: 80,
              child: TextFormField(
                initialValue: '${it['unit'] ?? ''}',
                decoration: const InputDecoration(labelText: 'Unit', isDense: true),
                onChanged: (v) => it['unit'] = v,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(child: _statusBox(status)),
          ]),
        ] else ...[
          if ('${it['desc'] ?? ''}'.isNotEmpty) Text('${it['desc']}', style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
          const SizedBox(height: 6),
          _statusBox(status),
        ],
        const SizedBox(height: 8),
        Row(children: [
          Expanded(
            child: TextField(
              controller: _sn,
              textCapitalization: TextCapitalization.characters,
              decoration: InputDecoration(
                isDense: true,
                labelText: 'Serial number',
                hintText: 'Type or paste, then Enter',
                suffixText: '${_serials.length}/${qty is int ? qty : qty.toStringAsFixed(qty % 1 == 0 ? 0 : 1)}',
              ),
              onSubmitted: _addSerials,
            ),
          ),
          IconButton(onPressed: () => _addSerials(_sn.text), icon: const Icon(Icons.add_circle_outline)),
        ]),
        if (_serials.isNotEmpty)
          Wrap(spacing: 6, runSpacing: 4, children: [
            for (var s = 0; s < _serials.length; s++)
              InputChip(
                label: Text(_serials[s], style: const TextStyle(fontSize: 12, fontFamily: 'monospace')),
                onDeleted: () {
                  _serials.removeAt(s);
                  setState(() {});
                  widget.onChanged();
                },
              ),
          ]),
      ]),
    );
  }

  Widget _statusBox(String status) => DropdownButtonFormField<String>(
        value: status,
        isExpanded: true,
        decoration: const InputDecoration(labelText: 'Status', isDense: true),
        items: [for (final s in widget.kind.statuses) DropdownMenuItem(value: s, child: Text(s, overflow: TextOverflow.ellipsis))],
        onChanged: (v) {
          widget.item['status'] = v ?? widget.kind.statuses.first;
          widget.onChanged();
        },
      );
}

/// Photo from inv_images (or a data URL), loaded once.
class RefImage extends StatelessWidget {
  final String refId;
  final double? width, height;
  final BoxFit fit;
  const RefImage(this.refId, {super.key, this.width, this.height, this.fit = BoxFit.cover});

  @override
  Widget build(BuildContext context) => FutureBuilder<Uint8List?>(
        future: InvReports.imageBytes(refId),
        builder: (c, s) {
          final b = s.data;
          if (b == null) {
            return Container(
              width: width,
              height: height,
              color: const Color(0xFFEDEAE4),
              child: s.connectionState == ConnectionState.done ? const Icon(Icons.broken_image_outlined, color: AppColors.muted) : null,
            );
          }
          return Image.memory(b, width: width, height: height, fit: fit, gaplessPlayback: true);
        },
      );
}

/// Photos with captions (before / after for service reports).
class PhotosCard extends StatefulWidget {
  final AppUser me;
  final String title;
  final bool beforeAfter;
  final List<Map<String, dynamic>> photos;
  final VoidCallback onChanged;
  const PhotosCard({super.key, required this.me, required this.title, required this.beforeAfter, required this.photos, required this.onChanged});

  @override
  State<PhotosCard> createState() => _PhotosCardState();
}

class _PhotosCardState extends State<PhotosCard> {
  bool _busy = false;

  Future<void> _add(bool camera, [String caption = '']) async {
    setState(() => _busy = true);
    try {
      final a = await InvReports.addPhoto(widget.me, camera: camera, caption: caption);
      if (a != null) {
        widget.photos.add(a);
        // keep "before" photos ahead of "after" photos
        if (caption.isNotEmpty) {
          widget.photos.sort((x, y) => (x['caption'] == photoLabels[1] ? 1 : 0).compareTo(y['caption'] == photoLabels[1] ? 1 : 0));
        }
        widget.onChanged();
      }
    } catch (e) {
      if (mounted) showSnack(context, 'Could not add photo: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.photos.where((a) => a['kind'] == 'image').toList();
    return RCard(children: [
      RTitle('${widget.title} photos', trailing: _busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : null),
      Wrap(spacing: 8, runSpacing: 8, children: [
        if (widget.beforeAfter) ...[
          OutlinedButton.icon(onPressed: _busy ? null : () => _add(true, photoLabels[0]), icon: const Icon(Icons.photo_camera_outlined, size: 18), label: const Text('Before')),
          OutlinedButton.icon(onPressed: _busy ? null : () => _add(true, photoLabels[1]), icon: const Icon(Icons.photo_camera_outlined, size: 18), label: const Text('After')),
        ] else
          OutlinedButton.icon(onPressed: _busy ? null : () => _add(true), icon: const Icon(Icons.photo_camera_outlined, size: 18), label: const Text('Take photo')),
        OutlinedButton.icon(onPressed: _busy ? null : () => _add(false), icon: const Icon(Icons.photo_library_outlined, size: 18), label: const Text('Gallery')),
      ]),
      if (p.isNotEmpty) ...[
        const SizedBox(height: 10),
        for (final a in p)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              ClipRRect(borderRadius: BorderRadius.circular(8), child: RefImage('${a['ref']}', width: 72, height: 72)),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  TextFormField(
                    key: ValueKey('cap-${a['ref']}-${a['caption']}'),
                    initialValue: '${a['caption'] ?? ''}',
                    decoration: const InputDecoration(labelText: 'Caption', isDense: true),
                    onChanged: (v) => a['caption'] = v,
                  ),
                  if (widget.beforeAfter)
                    Wrap(spacing: 6, children: [
                      for (final l in photoLabels)
                        ChoiceChip(
                          visualDensity: VisualDensity.compact,
                          label: Text(l, style: const TextStyle(fontSize: 11.5)),
                          selected: a['caption'] == l,
                          onSelected: (_) => setState(() {
                            a['caption'] = a['caption'] == l ? '' : l;
                            widget.onChanged();
                          }),
                        ),
                    ]),
                ]),
              ),
              IconButton(
                onPressed: () => setState(() {
                  widget.photos.remove(a);
                  widget.onChanged();
                }),
                icon: const Icon(Icons.close, color: AppColors.danger),
              ),
            ]),
          ),
      ],
    ]);
  }
}

/// Searchable client list.
Future<InvClient?> pickInvClient(BuildContext context, List<InvClient> clients) {
  return showModalBottomSheet<InvClient>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    useSafeArea: true,
    builder: (c) => _ClientPicker(clients: clients),
  );
}

class _ClientPicker extends StatefulWidget {
  final List<InvClient> clients;
  const _ClientPicker({required this.clients});

  @override
  State<_ClientPicker> createState() => _ClientPickerState();
}

class _ClientPickerState extends State<_ClientPicker> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final q = _q.toLowerCase();
    final l = widget.clients
        .where((c) => q.isEmpty || c.name.toLowerCase().contains(q) || c.sites.any((s) => s.name.toLowerCase().contains(q)))
        .toList();
    return SizedBox(
      height: MediaQuery.of(context).size.height * 0.8,
      child: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
          child: TextField(
            autofocus: true,
            decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search client or site'),
            onChanged: (v) => setState(() => _q = v),
          ),
        ),
        Expanded(
          child: ListView.builder(
            itemCount: l.length,
            itemBuilder: (c, i) => ListTile(
              title: Text(l[i].name, style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text('${l[i].sites.length} site${l[i].sites.length == 1 ? '' : 's'}', style: const TextStyle(fontSize: 12)),
              onTap: () => Navigator.pop(context, l[i]),
            ),
          ),
        ),
      ]),
    );
  }
}
