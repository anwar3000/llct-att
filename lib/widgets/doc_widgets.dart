import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../core/theme.dart';
import '../models/models.dart';
import '../services/id_sheet.dart';

/// Document bytes cached for the session (ID copies and company documents).
class DocBytes {
  static final Map<String, Future<Uint8List>> _cache = {};

  static Future<Uint8List> get(String id, Future<Uint8List> Function() load) {
    final c = _cache[id];
    if (c != null) return c;
    final fut = load();
    _cache[id] = fut;
    fut.then((_) {}, onError: (Object _) {
      _cache.remove(id);
    });
    return fut;
  }

  static void forget(String id) => _cache.remove(id);
}

typedef PickedDoc = ({String name, String mime, Uint8List bytes});

/// Camera / gallery / PDF picker, max 2 MB. Returns null when cancelled; throws with a readable message.
Future<PickedDoc?> pickDocument(BuildContext context, String title, {bool allowPdf = true}) async {
  final src = await showModalBottomSheet<String>(
    context: context,
    showDragHandle: true,
    builder: (c) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
          child: Text('$title · max 2 MB', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
        ),
        ListTile(
            leading: const Icon(Icons.photo_camera_outlined),
            title: const Text('Take a photo'),
            onTap: () => Navigator.pop(c, 'camera')),
        ListTile(
            leading: const Icon(Icons.photo_library_outlined),
            title: const Text('Choose from gallery'),
            onTap: () => Navigator.pop(c, 'gallery')),
        if (allowPdf)
          ListTile(
              leading: const Icon(Icons.picture_as_pdf_outlined),
              title: const Text('Choose a PDF or file'),
              onTap: () => Navigator.pop(c, 'file')),
        const SizedBox(height: 8),
      ]),
    ),
  );
  if (src == null) return null;
  String name, mime;
  List<int>? bytes;
  if (src == 'file') {
    final r = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png'],
      withData: true,
    );
    final f = r?.files.single;
    if (f == null) return null;
    if (f.size > kMaxDocBytes) throw Exception('${f.name} is larger than 2 MB. Please choose a smaller file.');
    bytes = f.bytes;
    name = f.name;
    final ext = (f.extension ?? '').toLowerCase();
    mime = ext == 'pdf' ? 'application/pdf' : (ext == 'png' ? 'image/png' : 'image/jpeg');
  } else {
    final x = await ImagePicker().pickImage(
      source: src == 'camera' ? ImageSource.camera : ImageSource.gallery,
      maxWidth: 2200,
      maxHeight: 2200,
      imageQuality: 82,
    );
    if (x == null) return null;
    bytes = await x.readAsBytes();
    name = '${title.replaceAll(RegExp(r'[^A-Za-z0-9 _-]'), '').trim()}.jpg';
    mime = 'image/jpeg';
  }
  if (bytes == null) throw Exception('Could not read the file.');
  if (bytes.length > kMaxDocBytes) {
    throw Exception('File is ${(bytes.length / 1048576).toStringAsFixed(1)} MB — the limit is 2 MB.');
  }
  return (name: name, mime: mime, bytes: Uint8List.fromList(bytes));
}

/// Asks for the heading of an additional document.
Future<String?> askHeading(BuildContext context, {String title = 'Additional document', String hint = 'e.g. Driving licence', List<String> suggestions = const []}) {
  final c = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (d) => AlertDialog(
      title: Text(title),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        TextField(
          controller: c,
          autofocus: true,
          textCapitalization: TextCapitalization.words,
          decoration: InputDecoration(labelText: 'Heading', hintText: hint),
          onSubmitted: (v) => Navigator.pop(d, v.trim()),
        ),
        if (suggestions.isNotEmpty) ...[
          const SizedBox(height: 10),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final s in suggestions) ActionChip(label: Text(s), onPressed: () => c.text = s),
          ]),
        ],
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')),
        FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(96, 44)),
            onPressed: () => Navigator.pop(d, c.text.trim()),
            child: const Text('Next')),
      ],
    ),
  ).then((v) => (v == null || v.isEmpty) ? null : v);
}

/// Thumbnail (image) or PDF icon; loads bytes lazily.
class DocThumb extends StatelessWidget {
  final String id;
  final bool isImage;
  final Future<Uint8List> Function() load;
  final BoxFit fit;
  const DocThumb({super.key, required this.id, required this.isImage, required this.load, this.fit = BoxFit.cover});

  @override
  Widget build(BuildContext context) {
    if (!isImage) {
      return Container(
        color: const Color(0xFFFCEDED),
        alignment: Alignment.center,
        child: const Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.picture_as_pdf, color: AppColors.danger, size: 30),
          Text('PDF', style: TextStyle(color: AppColors.danger, fontWeight: FontWeight.w800, fontSize: 11)),
        ]),
      );
    }
    return FutureBuilder<Uint8List>(
      future: DocBytes.get(id, load),
      builder: (_, s) {
        if (s.hasError) return const Center(child: Icon(Icons.broken_image_outlined, color: AppColors.muted));
        if (!s.hasData) {
          return const Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)));
        }
        return Image.memory(s.data!,
            fit: fit,
            gaplessPlayback: true,
            cacheWidth: 600,
            errorBuilder: (_, __, ___) => const Center(child: Icon(Icons.broken_image_outlined, color: AppColors.muted)));
      },
    );
  }
}

/// Empty slot placeholder.
class DocPlaceholder extends StatelessWidget {
  final IconData icon;
  const DocPlaceholder({super.key, this.icon = Icons.add_a_photo_outlined});
  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: const Color(0xFFD9D5CC)),
        ),
        alignment: Alignment.center,
        child: Icon(icon, color: AppColors.muted, size: 24),
      );
}

/// Full-screen document with pinch-zoom and share / save.
class DocViewer extends StatelessWidget {
  final String id, title, fileName, mime;
  final Future<Uint8List> Function() load;
  /// Shown as a delete button when set (management).
  final Future<void> Function()? onDelete;
  const DocViewer({super.key, required this.id, required this.title, required this.fileName, required this.mime, required this.load, this.onDelete});

  static Future<void> open(BuildContext context,
          {required String id,
          required String title,
          required String fileName,
          required String mime,
          required Future<Uint8List> Function() load,
          Future<void> Function()? onDelete}) =>
      Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => DocViewer(id: id, title: title, fileName: fileName, mime: mime, load: load, onDelete: onDelete)));

  @override
  Widget build(BuildContext context) {
    Future<void> share() async {
      try {
        final b = await DocBytes.get(id, load);
        await IdSheet.shareFiles([(name: fileName, data: b, mime: mime)], subject: title);
      } catch (e) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not share: $e')));
        }
      }
    }

    final isImage = mime.startsWith('image/');
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: [
          if (onDelete != null)
            IconButton(
              tooltip: 'Delete',
              icon: const Icon(Icons.delete_outline),
              onPressed: () async {
                final ok = await showDialog<bool>(
                  context: context,
                  builder: (d) => AlertDialog(
                    title: const Text('Delete this file?'),
                    content: Text(fileName),
                    actions: [
                      TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
                      FilledButton(
                          style: FilledButton.styleFrom(minimumSize: const Size(96, 44), backgroundColor: AppColors.danger),
                          onPressed: () => Navigator.pop(d, true),
                          child: const Text('Delete')),
                    ],
                  ),
                );
                if (ok != true) return;
                try {
                  await onDelete!();
                  DocBytes.forget(id);
                  if (context.mounted) Navigator.pop(context);
                } catch (e) {
                  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not delete: $e')));
                }
              },
            ),
          IconButton(tooltip: 'Share / save', icon: const Icon(Icons.ios_share), onPressed: share),
        ],
      ),
      body: isImage
          ? FutureBuilder<Uint8List>(
              future: DocBytes.get(id, load),
              builder: (_, s) => s.hasError
                  ? Center(child: Text('Could not load: ${s.error}', style: const TextStyle(color: Colors.white70)))
                  : !s.hasData
                      ? const Center(child: CircularProgressIndicator())
                      : InteractiveViewer(maxScale: 6, child: Center(child: Image.memory(s.data!, fit: BoxFit.contain))),
            )
          : Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.picture_as_pdf, size: 70, color: Colors.white70),
                  const SizedBox(height: 12),
                  Text(fileName, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white)),
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    style: FilledButton.styleFrom(minimumSize: const Size(180, 46)),
                    onPressed: share,
                    icon: const Icon(Icons.open_in_new),
                    label: const Text('Open / share PDF'),
                  ),
                ]),
              ),
            ),
    );
  }
}
