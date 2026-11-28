import 'package:flutter/material.dart';
import 'package:worksphere_app/app/router.dart';

void main() {
  final isAuthenticated = ValueNotifier<bool>(true);
  runApp(WorkSphereApp(isAuthenticated: isAuthenticated));
}

class WorkSphereApp extends StatefulWidget {
  const WorkSphereApp({required this.isAuthenticated, super.key});

  final ValueNotifier<bool> isAuthenticated;

  @override
  State<WorkSphereApp> createState() => _WorkSphereAppState();
}

class _WorkSphereAppState extends State<WorkSphereApp> {
  late final _router = createAppRouter(isAuthenticated: widget.isAuthenticated);

  @override
  void dispose() {
    _router.dispose();
    widget.isAuthenticated.dispose();
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
