import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../core/utils.dart';

/// Small KPI tile used on dashboards.
class StatTile extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color color;
  final String? sub;
  final VoidCallback? onTap;

  const StatTile({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    this.color = AppColors.primary,
    this.sub,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(children: [
                Container(
                  padding: const EdgeInsets.all(7),
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(icon, size: 18, color: color),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
                ),
              ]),
              const SizedBox(height: 10),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(value,
                    style: const TextStyle(
                        fontSize: 22, fontWeight: FontWeight.w800, color: AppColors.ink)),
              ),
              if (sub != null) ...[
                const SizedBox(height: 2),
                Text(sub!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Responsive grid of [StatTile]s: 2 columns on phones, more on tablets.
class StatGrid extends StatelessWidget {
  final List<Widget> children;
  const StatGrid({super.key, required this.children});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, c) {
      final cols = c.maxWidth > 900 ? 4 : (c.maxWidth > 560 ? 3 : 2);
      const gap = 10.0;
      final w = (c.maxWidth - gap * (cols - 1)) / cols;
      return Wrap(
        spacing: gap,
        runSpacing: gap,
        children: children.map((e) => SizedBox(width: w, child: e)).toList(),
      );
    });
  }
}

class SectionTitle extends StatelessWidget {
  final String title;
  final Widget? trailing;
  const SectionTitle(this.title, {super.key, this.trailing});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(2, 18, 2, 8),
      child: Row(children: [
        Expanded(
          child: Text(title,
              style: const TextStyle(
                  fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.ink)),
        ),
        if (trailing != null) trailing!,
      ]),
    );
  }
}

class EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? message;
  const EmptyState({super.key, required this.icon, required this.title, this.message});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 16),
      child: Column(children: [
        Icon(icon, size: 44, color: AppColors.muted.withValues(alpha: 0.6)),
        const SizedBox(height: 10),
        Text(title,
            textAlign: TextAlign.center,
            style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.ink)),
        if (message != null) ...[
          const SizedBox(height: 4),
          Text(message!,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.muted, fontSize: 13)),
        ],
      ]),
    );
  }
}

class Pill extends StatelessWidget {
  final String text;
  final Color color;
  final IconData? icon;
  const Pill(this.text, {super.key, this.color = AppColors.primary, this.icon});

  factory Pill.status(String status) {
    switch (status) {
      case 'approved':
        return const Pill('Approved', color: AppColors.success, icon: Icons.check_circle);
      case 'rejected':
        return const Pill('Rejected', color: AppColors.danger, icon: Icons.cancel);
      case 'pending':
        return const Pill('Pending', color: AppColors.warning, icon: Icons.schedule);
      default:
        return Pill(status, color: AppColors.muted);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[
          Icon(icon, size: 12, color: color),
          const SizedBox(width: 4),
        ],
        Text(text,
            style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: color)),
      ]),
    );
  }
}

class Avatar extends StatelessWidget {
  final String name;
  final double size;
  final Color? ring;
  const Avatar(this.name, {super.key, this.size = 40, this.ring});

  static const _palette = [
    Color(0xFF0E5E6F),
    Color(0xFF3A7BD5),
    Color(0xFF8E5CC4),
    Color(0xFFC2557A),
    Color(0xFFE08E2B),
    Color(0xFF2E9E6A),
  ];

  @override
  Widget build(BuildContext context) {
    final c = _palette[name.hashCode.abs() % _palette.length];
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: c,
        shape: BoxShape.circle,
        border: ring == null ? null : Border.all(color: ring!, width: 2.5),
      ),
      alignment: Alignment.center,
      child: Text(initials(name),
          style: TextStyle(
              color: Colors.white, fontWeight: FontWeight.w700, fontSize: size * 0.36)),
    );
  }
}

/// Decodes base64 photos once and caches the bytes.
class Base64Image extends StatelessWidget {
  final String data;
  final double? width;
  final double? height;
  final BoxFit fit;
  const Base64Image(this.data, {super.key, this.width, this.height, this.fit = BoxFit.cover});

  static final Map<int, Uint8List> _cache = {};

  Uint8List _bytes() {
    final k = data.hashCode;
    final hit = _cache[k];
    if (hit != null) return hit;
    final b = base64Decode(data);
    if (_cache.length > 80) _cache.clear();
    _cache[k] = b;
    return b;
  }

  @override
  Widget build(BuildContext context) {
    return Image.memory(_bytes(),
        width: width,
        height: height,
        fit: fit,
        gaplessPlayback: true,
        errorBuilder: (_, __, ___) => Container(
              width: width,
              height: height,
              color: const Color(0xFFE3E8EB),
              child: const Icon(Icons.broken_image_outlined, color: AppColors.muted),
            ));
  }
}

class PhotoStrip extends StatelessWidget {
  final List<String> photos;
  final double size;
  final void Function(int index)? onRemove;
  const PhotoStrip(this.photos, {super.key, this.size = 72, this.onRemove});

  @override
  Widget build(BuildContext context) {
    if (photos.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      height: size,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: photos.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, i) => Stack(children: [
          GestureDetector(
            onTap: () => openPhoto(context, photos[i]),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Base64Image(photos[i], width: size, height: size),
            ),
          ),
          if (onRemove != null)
            Positioned(
              right: 2,
              top: 2,
              child: InkWell(
                onTap: () => onRemove!(i),
                child: const CircleAvatar(
                  radius: 11,
                  backgroundColor: Colors.black54,
                  child: Icon(Icons.close, size: 14, color: Colors.white),
                ),
              ),
            ),
        ]),
      ),
    );
  }
}

void openPhoto(BuildContext context, String data) {
  Navigator.of(context).push(MaterialPageRoute(
    builder: (_) => Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
      ),
      body: InteractiveViewer(
        child: Center(child: Base64Image(data, fit: BoxFit.contain)),
      ),
    ),
  ));
}

/// Month navigator: ‹ October 2026 ›
class MonthSwitcher extends StatelessWidget {
  final DateTime month;
  final ValueChanged<DateTime> onChanged;
  const MonthSwitcher({super.key, required this.month, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final isCurrent = month.year == now.year && month.month == now.month;
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
        child: Row(children: [
          IconButton(
            icon: const Icon(Icons.chevron_left),
            onPressed: () => onChanged(DateTime(month.year, month.month - 1, 1)),
          ),
          Expanded(
            child: Text(fmtMonth(month),
                textAlign: TextAlign.center,
                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
          ),
          IconButton(
            icon: const Icon(Icons.chevron_right),
            onPressed: isCurrent
                ? null
                : () => onChanged(DateTime(month.year, month.month + 1, 1)),
          ),
        ]),
      ),
    );
  }
}

/// Handles loading / error states for a StreamBuilder in one line.
class StreamView<T> extends StatelessWidget {
  final Stream<T> stream;
  final Widget Function(BuildContext context, T data) builder;
  final Widget? loading;
  const StreamView({super.key, required this.stream, required this.builder, this.loading});

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<T>(
      stream: stream,
      builder: (context, snap) {
        if (snap.hasError) {
          return Padding(
            padding: const EdgeInsets.all(16),
            child: Text('Error: ${snap.error}',
                style: const TextStyle(color: AppColors.danger)),
          );
        }
        if (!snap.hasData) {
          return loading ??
              const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              );
        }
        return builder(context, snap.data as T);
      },
    );
  }
}

class InfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color? color;
  const InfoRow(this.icon, this.label, this.value, {super.key, this.color});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, size: 16, color: color ?? AppColors.muted),
        const SizedBox(width: 8),
        SizedBox(
            width: 92,
            child: Text(label, style: const TextStyle(color: AppColors.muted, fontSize: 13))),
        Expanded(
          child: Text(value,
              style: TextStyle(
                  fontSize: 13.5, fontWeight: FontWeight.w600, color: color ?? AppColors.ink)),
        ),
      ]),
    );
  }
}
