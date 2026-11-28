import 'package:connectivity_plus/connectivity_plus.dart';

Stream<bool> bookingConnectivityChanges(Connectivity connectivity) async* {
  yield _hasNetwork(await connectivity.checkConnectivity());
  await for (final results in connectivity.onConnectivityChanged) {
    yield _hasNetwork(results);
  }
}

bool _hasNetwork(List<ConnectivityResult> results) {
  return results.any(
    (result) =>
        result != ConnectivityResult.none &&
        result != ConnectivityResult.bluetooth,
  );
}
