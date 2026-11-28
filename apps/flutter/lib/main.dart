import 'dart:async';

import 'package:flutter/material.dart';
import 'package:worksphere_app/app/router.dart';
import 'package:worksphere_app/features/bookings/data/booking_sync_runtime.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final apiBaseUri = Uri.parse(
    const String.fromEnvironment(
      'WORKSPHERE_API_BASE_URL',
      defaultValue: 'https://worksphere.app',
    ),
  );
  final bookingRuntime = await BookingSyncRuntime.open(baseUri: apiBaseUri);
  final isAuthenticated = ValueNotifier<bool>(true);
  runApp(
    WorkSphereApp(
      isAuthenticated: isAuthenticated,
      bookingRuntime: bookingRuntime,
    ),
  );
}

class WorkSphereApp extends StatefulWidget {
  const WorkSphereApp({
    required this.isAuthenticated,
    required this.bookingRuntime,
    super.key,
  });

  final ValueNotifier<bool> isAuthenticated;
  final BookingSyncRuntime bookingRuntime;

  @override
  State<WorkSphereApp> createState() => _WorkSphereAppState();
}

class _WorkSphereAppState extends State<WorkSphereApp> {
  late final _router = createAppRouter(
    isAuthenticated: widget.isAuthenticated,
    bookingSyncWorker: widget.bookingRuntime.worker,
  );

  @override
  void dispose() {
    _router.dispose();
    widget.isAuthenticated.dispose();
    unawaited(widget.bookingRuntime.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'WorkSphere',
      theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
      routerConfig: _router,
    );
  }
}
