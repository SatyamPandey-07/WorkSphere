import 'dart:async';

import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../data/nomad_desk_pass.dart';
import '../data/nomad_desk_pass_cache.dart';

typedef NomadDeskPassLoader = Future<NomadDeskPass> Function(String bookingId);

class NomadDeskPassScreen extends StatefulWidget {
  const NomadDeskPassScreen({
    required this.bookingId,
    required this.cache,
    this.loadPass,
    super.key,
  });

  final String bookingId;
  final NomadDeskPassCache cache;
  final NomadDeskPassLoader? loadPass;

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
                                      Row(
                                        children: [
                                          Expanded(
                                            child: Text(
                                              pass.venueName.trim().isEmpty
                                                  ? 'Venue details unavailable'
                                                  : pass.venueName,
                                              key: const ValueKey('venue-name'),
                                              textAlign: TextAlign.center,
                                              overflow: TextOverflow.ellipsis,
                                              style: Theme.of(context)
                                                  .textTheme
                                                  .titleMedium,
                                            ),
                                          ),
                                        ],
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
