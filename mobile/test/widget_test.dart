import 'package:flutter_test/flutter_test.dart';
import 'package:worksphere_mobile/main.dart';

void main() {
  testWidgets('app initializes and renders the WorkSphere home screen',
      (tester) async {
    await tester.pumpWidget(const WorkSphereApp());
    await tester.pumpAndSettle();

    expect(find.text('WorkSphere'), findsOneWidget);
    expect(find.text('Welcome to WorkSphere'), findsOneWidget);
    expect(find.text('Your spaces, people, and plans, all in one place.'),
        findsOneWidget);
  });
}
