import 'package:flutter/material.dart';

import '../features/passes/data/nomad_desk_pass_cache.dart';
import '../features/passes/presentation/nomad_desk_pass_screen.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  Future<void> _openPass(BuildContext context) async {
    final controller = TextEditingController();
    final bookingId = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Open a booking pass'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Booking ID'),
          onSubmitted: (value) => Navigator.of(context).pop(value),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(controller.text),
            child: const Text('Continue'),
          ),
        ],
      ),
    );
    controller.dispose();

    if (!context.mounted || bookingId == null || bookingId.trim().isEmpty) {
      return;
    }
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => NomadDeskPassScreen(
          bookingId: bookingId.trim(),
          cache: const SharedPreferencesNomadDeskPassCache(),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('WorkSphere'),
        leading: Icon(
          Icons.hub_rounded,
          color: colors.primary,
        ),
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 640),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Spacer(),
                  Icon(
                    Icons.workspaces_outline_rounded,
                    size: 56,
                    color: colors.primary,
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'Welcome to WorkSphere',
                    key: const ValueKey('home-heading'),
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Your spaces, people, and plans, all in one place.',
                    style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                          color: colors.onSurfaceVariant,
                          height: 1.5,
                        ),
                  ),
                  const SizedBox(height: 28),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: () => _openPass(context),
                      icon: const Icon(Icons.qr_code_rounded),
                      label: const Text('Open a booking pass'),
                    ),
                  ),
                  const Spacer(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
