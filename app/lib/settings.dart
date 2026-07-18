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
  static const _kUsePreviews = 'use_previews';
  static const _kThemeMode = 'theme_mode';

  final ValueNotifier<bool> start30 = ValueNotifier(false);

  // 'light' | 'dark' | 'system'. Follows the system by default.
  final ValueNotifier<String> themeMode = ValueNotifier('system');

  // Each user supplies their own Spotify app's Client ID (see OnboardingScreen).
  final ValueNotifier<String> clientId = ValueNotifier('');
  bool get hasClientId => clientId.value.trim().isNotEmpty;

  // Set when the user taps "Skip for now" on onboarding — lets them into the app
  // (and lets a store reviewer see it) without supplying Spotify credentials.
  final ValueNotifier<bool> explored = ValueNotifier(false);

  // Force preview playback (30s iTunes clips) even when a Spotify app is
  // configured. Without a Client ID previews are always used regardless.
  final ValueNotifier<bool> usePreviews = ValueNotifier(false);
  bool get previewMode => usePreviews.value || !hasClientId;

  // Deck-database sources: http(s) URLs or local file paths. The app ships none.
  final ValueNotifier<List<String>> deckSources = ValueNotifier(<String>[]);

  Future<void> load() async {
    final p = await SharedPreferences.getInstance();
    start30.value = p.getBool(_kStart30) ?? false;
    themeMode.value = p.getString(_kThemeMode) ?? 'system';
    clientId.value = p.getString(_kClientId) ?? '';
    explored.value = p.getBool(_kExplored) ?? false;
    usePreviews.value = p.getBool(_kUsePreviews) ?? false;
    deckSources.value =
        (jsonDecode(p.getString(_kDeckSources) ?? '[]') as List).cast<String>();
  }

  Future<void> setUsePreviews(bool v) async {
    usePreviews.value = v;
    final p = await SharedPreferences.getInstance();
    await p.setBool(_kUsePreviews, v);
  }

  Future<void> setExplored(bool v) async {
    explored.value = v;
    final p = await SharedPreferences.getInstance();
    await p.setBool(_kExplored, v);
  }

  Future<void> setThemeMode(String v) async {
    themeMode.value = v;
    final p = await SharedPreferences.getInstance();
    await p.setString(_kThemeMode, v);
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
