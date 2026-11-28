import 'dart:async';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:cross_file/cross_file.dart';
import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';

import '../data/nomad_desk_pass.dart';
import '../data/nomad_desk_pass_cache.dart';

typedef NomadDeskPassLoader = Future<NomadDeskPass> Function(String bookingId);
typedef NomadDeskPassShareHandler = Future<void> Function({
  required String bookingId,
  required String text,
  required String qrPayload,
  required Uint8List? qrImageBytes,
});

class NomadDeskPassScreen extends StatefulWidget {
  const NomadDeskPassScreen({
    required this.bookingId,
    required this.cache,
    this.loadPass,
    this.sharePass,
    super.key,
  });

  final String bookingId;
  final NomadDeskPassCache cache;
  final NomadDeskPassLoader? loadPass;
  final NomadDeskPassShareHandler? sharePass;

  @override
  State<NomadDeskPassScreen> createState() => _NomadDeskPassScreenState();
}

class _NomadDeskPassScreenState extends State<NomadDeskPassScreen> {
  NomadDeskPass? _pass;
  bool _isLoading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    unawaited(_loadPass());
  }

  Future<void> _loadPass() async {
    try {
      final cachedPass = await widget.cache.read(widget.bookingId);
      if (!mounted) return;
      setState(() {
        _pass = cachedPass;
        _isLoading = widget.loadPass != null;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _errorMessage = 'Saved pass could not be read.';
        _isLoading = widget.loadPass != null;
      });
    }

    final loader = widget.loadPass;
    if (loader == null) {
      if (mounted) setState(() => _isLoading = false);
      return;
    }

    try {
      final freshPass = await loader(widget.bookingId);
      if (freshPass.bookingId != widget.bookingId) {
        throw const FormatException('Pass booking ID does not match request.');
      }
      await widget.cache.write(freshPass);
      if (!mounted) return;
      setState(() {
        _pass = freshPass;
        _errorMessage = null;
      });
    } catch (_) {
      if (!mounted) return;
      if (_pass == null) {
        setState(() {
          _errorMessage = 'Pass is unavailable. Try again when online.';
        });
      } else {
        setState(() {
          _errorMessage = 'Showing the saved pass; refresh is unavailable.';
        });
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _sharePass(NomadDeskPass pass) async {
    final venueName = pass.venueName.trim().isEmpty
        ? 'Venue details unavailable'
        : pass.venueName;
    final address = pass.venueAddress?.trim();
    final message = [
      'WorkSphere booking confirmation',
      'Booking ID: ${pass.bookingId}',
      'Venue: $venueName',
      if (address != null && address.isNotEmpty) 'Venue address: $address',
    ].join('\n');

    final qrImageBytes = await _createQrImage(pass.qrPayload);
    if (!mounted) return;

    try {
      final shareHandler = widget.sharePass;
      ShareResult? shareResult;
      if (shareHandler != null) {
        await shareHandler(
          bookingId: pass.bookingId,
          text: message,
          qrPayload: pass.qrPayload,
          qrImageBytes: qrImageBytes,
        );
      } else {
        shareResult = await Share.shareXFiles(
          [
            if (qrImageBytes != null)
              XFile.fromData(
                qrImageBytes,
                name: 'worksphere-pass-${Uri.encodeComponent(pass.bookingId)}.png',
                mimeType: 'image/png',
              ),
          ],
          text: message,
          subject: 'NomadDesk pass',
        );
      }

      if (mounted && shareResult?.status == ShareResultStatus.unavailable) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Sharing is unavailable on this device.'),
          ),
        );
        return;
      }

      if (mounted && qrImageBytes == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Booking details shared. The QR image could not be attached.',
            ),
          ),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Unable to share the pass. Please try again.'),
          ),
        );
      }
    }
  }

  Future<Uint8List?> _createQrImage(String payload) async {
    try {
      final imageData = await QrPainter(
        data: payload,
        version: QrVersions.auto,
        gapless: true,
      ).toImageData(512, format: ui.ImageByteFormat.png);
      if (imageData == null) return null;
      return imageData.buffer.asUint8List(
        imageData.offsetInBytes,
        imageData.lengthInBytes,
      );
    } catch (_) {
      return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final pass = _pass;

    return Scaffold(
      appBar: AppBar(title: const Text('NomadDeskPass')),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: _isLoading && pass == null
                  ? const Center(child: CircularProgressIndicator())
                  : pass == null
                      ? _UnavailablePass(message: _errorMessage)
                      : Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            if (_errorMessage != null)
                              Padding(
                                padding: const EdgeInsets.only(bottom: 16),
                                child: Text(
                                  _errorMessage!,
                                  key: const ValueKey('pass-status'),
                                  style: TextStyle(color: colors.onSurfaceVariant),
                                  textAlign: TextAlign.center,
                                ),
                              ),
                            Expanded(
                              child: Card(
                                child: Padding(
                                  padding: const EdgeInsets.all(24),
                                  child: Column(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      Icon(
                                        Icons.confirmation_number_outlined,
                                        size: 36,
                                        color: colors.primary,
                                      ),
                                      const SizedBox(height: 12),
                                      Text(
                                        'BOOKING ID',
                                        style: Theme.of(context)
                                            .textTheme
                                            .labelLarge
                                            ?.copyWith(
                                              color: colors.onSurfaceVariant,
                                              letterSpacing: 1.2,
                                            ),
                                      ),
                                      const SizedBox(height: 6),
                                      SelectableText(
                                        pass.bookingId,
                                        key: const ValueKey('booking-id'),
                                        textAlign: TextAlign.center,
                                        style: Theme.of(context)
                                            .textTheme
                                            .headlineSmall
                                            ?.copyWith(
                                              fontWeight: FontWeight.w700,
                                            ),
                                      ),
                                      const SizedBox(height: 8),
                                      Text(
                                        pass.venueName.trim().isEmpty
                                            ? 'Venue details unavailable'
                                            : pass.venueName,
                                        key: const ValueKey('venue-name'),
                                        textAlign: TextAlign.center,
                                        style: Theme.of(context)
                                            .textTheme
                                            .titleMedium,
                                      ),
                                      const SizedBox(height: 28),
                                      QrImageView(
                                        data: pass.qrPayload,
                                        size: 220,
                                        semanticsLabel:
                                            'QR code for booking ${pass.bookingId}',
                                      ),
                                      const SizedBox(height: 12),
                                      Text(
                                        'Show this code at the venue',
                                        style: Theme.of(context)
                                            .textTheme
                                            .bodyMedium
                                            ?.copyWith(
                                              color: colors.onSurfaceVariant,
                                            ),
                                      ),
                                      const SizedBox(height: 12),
                                      OutlinedButton.icon(
                                            key: const ValueKey('pass-share'),
                                            onPressed: () => _sharePass(pass),
                                            icon: const Icon(Icons.share_outlined),
                                            label: const Text('Share Pass'),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
            ),
          ),
        ),
      ),
    );
  }
}

class _UnavailablePass extends StatelessWidget {
  const _UnavailablePass({this.message});

  final String? message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Text(
        message ?? 'No saved pass is available for this booking.',
        key: const ValueKey('pass-unavailable'),
        textAlign: TextAlign.center,
      ),
    );
  }
}
