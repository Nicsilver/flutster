import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

class AppSettings {
  AppSettings._();
  static final AppSettings instance = AppSettings._();

  static const _kStart30 = 'start_30s_in';
  static const _kClientId = 'spotify_client_id';
  static const _kDeckSources = 'deck_sources';
  static const _kExplored = 'explored_without_spotify';

  final ValueNotifier<bool> start30 = ValueNotifier(false);

  // Each user supplies their own Spotify app's Client ID (see OnboardingScreen).
  final ValueNotifier<String> clientId = ValueNotifier('');
  bool get hasClientId => clientId.value.trim().isNotEmpty;

  // Set when the user taps "Skip for now" on onboarding — lets them into the app
  // (and lets a store reviewer see it) without supplying Spotify credentials.
  final ValueNotifier<bool> explored = ValueNotifier(false);

  // Deck-database sources: http(s) URLs or local file paths. The app ships none.
  final ValueNotifier<List<String>> deckSources = ValueNotifier(<String>[]);

  Future<void> load() async {
    final p = await SharedPreferences.getInstance();
    start30.value = p.getBool(_kStart30) ?? false;
    clientId.value = p.getString(_kClientId) ?? '';
    explored.value = p.getBool(_kExplored) ?? false;
    deckSources.value =
        (jsonDecode(p.getString(_kDeckSources) ?? '[]') as List).cast<String>();
  }

  Future<void> setExplored(bool v) async {
    explored.value = v;
    final p = await SharedPreferences.getInstance();
    await p.setBool(_kExplored, v);
  }

  Future<void> setStart30(bool v) async {
    start30.value = v;
    final p = await SharedPreferences.getInstance();
    await p.setBool(_kStart30, v);
  }

  Future<void> setClientId(String v) async {
    clientId.value = v.trim();
    final p = await SharedPreferences.getInstance();
    await p.setString(_kClientId, v.trim());
  }

  Future<void> setDeckSources(List<String> v) async {
    deckSources.value = List.of(v);
    final p = await SharedPreferences.getInstance();
    await p.setString(_kDeckSources, jsonEncode(v));
  }
}
