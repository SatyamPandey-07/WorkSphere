import 'package:shared_preferences/shared_preferences.dart';

import 'nomad_desk_pass.dart';

abstract interface class NomadDeskPassCache {
  Future<NomadDeskPass?> read(String bookingId);
  Future<void> write(NomadDeskPass pass);
  Future<void> remove(String bookingId);
}

class SharedPreferencesNomadDeskPassCache implements NomadDeskPassCache {
  const SharedPreferencesNomadDeskPassCache();

  static const _keyPrefix = 'nomad_desk_pass_';

  @override
  Future<NomadDeskPass?> read(String bookingId) async {
    final preferences = await SharedPreferences.getInstance();
    final key = '$_keyPrefix$bookingId';
    final value = preferences.getString(key);
    if (value == null) return null;

    try {
      final pass = NomadDeskPass.decode(value);
      if (pass.bookingId != bookingId ||
          (pass.expiresAt != null &&
              !pass.expiresAt!.toUtc().isAfter(DateTime.now().toUtc()))) {
        await preferences.remove(key);
        return null;
      }
      return pass;
    } on FormatException {
      await preferences.remove(key);
      return null;
    } on TypeError {
      await preferences.remove(key);
      return null;
    }
  }

  @override
  Future<void> write(NomadDeskPass pass) async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString(
      '$_keyPrefix${pass.bookingId}',
      pass.encode(),
    );
  }

  @override
  Future<void> remove(String bookingId) async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.remove('$_keyPrefix$bookingId');
  }
}
