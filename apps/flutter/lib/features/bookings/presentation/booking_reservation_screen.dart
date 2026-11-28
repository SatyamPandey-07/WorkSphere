import 'package:flutter/material.dart';
import 'package:worksphere_app/features/bookings/data/booking_sync_worker.dart';
import 'package:worksphere_app/features/bookings/domain/booking_draft.dart';

class BookingReservationScreen extends StatefulWidget {
  const BookingReservationScreen({
    super.key,
    required this.venueId,
    required this.syncWorker,
  });

  final String venueId;
  final BookingSyncWorker syncWorker;

  @override
  State<BookingReservationScreen> createState() =>
      _BookingReservationScreenState();
}

class _BookingReservationScreenState extends State<BookingReservationScreen> {
  late DateTime _reservationDate = DateTime.now().add(const Duration(days: 1));
  int _guestCount = 1;
  bool _isSubmitting = false;

  Future<void> _queueReservation() async {
    setState(() => _isSubmitting = true);
    final start = DateTime(
      _reservationDate.year,
      _reservationDate.month,
      _reservationDate.day,
      9,
    );
    final end = DateTime(
      _reservationDate.year,
      _reservationDate.month,
      _reservationDate.day,
      17,
    );
    try {
      await widget.syncWorker.enqueueReservation(<String, dynamic>{
        'venueId': widget.venueId,
        'startTime': start.toUtc().toIso8601String(),
        'endTime': end.toUtc().toIso8601String(),
        'guests': _guestCount,
      });
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            widget.syncWorker.isOnline
                ? 'Reservation request saved.'
                : 'Reservation saved offline and will sync when connected.',
          ),
        ),
      );
    } catch (_) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Unable to save this reservation. Please try again.'),
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  Future<void> _chooseDate() async {
    final selected = await showDatePicker(
      context: context,
      initialDate: _reservationDate,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (selected != null && mounted) {
      setState(() => _reservationDate = selected);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reserve a venue')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            'Venue ${widget.venueId}',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 20),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Reservation date'),
            subtitle: Text(
              '${_reservationDate.year}-'
              '${_reservationDate.month.toString().padLeft(2, '0')}-'
              '${_reservationDate.day.toString().padLeft(2, '0')} · 9:00 AM–5:00 PM',
            ),
            trailing: const Icon(Icons.calendar_today_outlined),
            onTap: _chooseDate,
          ),
          DropdownButtonFormField<int>(
            value: _guestCount,
            decoration: const InputDecoration(labelText: 'Guests'),
            items: List<DropdownMenuItem<int>>.generate(
              10,
              (index) => DropdownMenuItem<int>(
                value: index + 1,
                child: Text('${index + 1}'),
              ),
            ),
            onChanged: (value) {
              if (value != null) {
                setState(() => _guestCount = value);
              }
            },
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: _isSubmitting ? null : _queueReservation,
            icon: const Icon(Icons.event_available_outlined),
            label: Text(_isSubmitting ? 'Saving…' : 'Request reservation'),
          ),
          const SizedBox(height: 24),
          Text('Your booking requests', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          AnimatedBuilder(
            animation: widget.syncWorker,
            builder: (context, _) {
              final drafts = widget.syncWorker.drafts
                  .where((draft) => draft.payload['venueId'] == widget.venueId)
                  .toList(growable: false);
              if (drafts.isEmpty) {
                return const Text('No reservation requests yet.');
              }
              return Column(
                children: drafts.map(_buildDraftStatus).toList(growable: false),
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildDraftStatus(BookingDraft draft) {
    final status = switch (draft.status) {
      BookingDraftStatus.pending =>
        draft.attemptCount > 0 ? 'Retry scheduled' : 'Waiting to sync',
      BookingDraftStatus.syncing => 'Syncing',
      BookingDraftStatus.completed => 'Confirmed',
      BookingDraftStatus.failed => 'Could not be submitted',
    };
    final icon = switch (draft.status) {
      BookingDraftStatus.pending => Icons.cloud_upload_outlined,
      BookingDraftStatus.syncing => Icons.sync,
      BookingDraftStatus.completed => Icons.check_circle_outline,
      BookingDraftStatus.failed => Icons.error_outline,
    };
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      leading: Icon(icon),
      title: Text(status),
      subtitle: Text(
        draft.status == BookingDraftStatus.failed
            ? draft.lastError ?? 'Please submit a new request.'
            : 'Request ${draft.idempotencyKey.substring(0, draft.idempotencyKey.length < 12 ? draft.idempotencyKey.length : 12)}',
      ),
    );
  }
}
