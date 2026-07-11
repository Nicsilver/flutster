import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:spotify_sdk/spotify_sdk.dart';
import 'package:spotify_sdk/models/player_state.dart';

import 'settings.dart';

// Needs the Spotify app installed and a Premium account (playback control is
// Premium-only). The Client ID is the user's own (see OnboardingScreen); it must
// have redirect flutster://auth and this app's package + SHA-1 registered.
class SpotifyService {
  static const String redirectUrl = 'flutster://auth';
  static const String likedPlaylistName = 'Flutster Songs';

  String get clientId => AppSettings.instance.clientId.value.trim();

  bool _connected = false;
  String? _accessToken;
  String? _userId;
  String? _playlistId;
  Set<String>? _playlistTrackIds;
  bool get isConnected => _connected;

  static const String _scope = 'app-remote-control,'
      'user-modify-playback-state,'
      'user-read-playback-state,'
      'user-read-currently-playing,'
      'playlist-read-private,'
      'playlist-modify-private,'
      'playlist-modify-public';

  Future<bool> connect() async {
    _accessToken = await SpotifySdk.getAccessToken(
      clientId: clientId,
      redirectUrl: redirectUrl,
      scope: _scope,
    );
    _connected = await SpotifySdk.connectToSpotifyRemote(
      clientId: clientId,
      redirectUrl: redirectUrl,
    );
    return _connected;
  }

  Stream<PlayerState> playerState() => SpotifySdk.subscribePlayerState();

  // Serialise transport commands so a stop from the previous song can't land
  // after the next song's play() and leave it stuck paused.
  Future<void> _chain = Future<void>.value();
  Future<void> _run(Future<void> Function() action) {
    final next = _chain.then((_) => action()).catchError((_) {});
    _chain = next;
    return next;
  }

  Future<void> play(String spotifyUri, {int startAtMs = 0}) => _run(() async {
        await SpotifySdk.play(spotifyUri: spotifyUri);
        if (startAtMs > 0) {
          await Future.delayed(const Duration(milliseconds: 350)); // let it load
          await SpotifySdk.seekTo(positionedMilliseconds: startAtMs);
        }
      });

  Future<void> pause() => _run(() => SpotifySdk.pause());
  Future<void> resume() => _run(() => SpotifySdk.resume());
  Future<void> seekTo(int ms) =>
      _run(() => SpotifySdk.seekTo(positionedMilliseconds: ms));
  Future<void> nudge(int ms) =>
      _run(() => SpotifySdk.seekToRelativePosition(relativeMilliseconds: ms));

  Future<void> disconnect() async {
    await SpotifySdk.disconnect();
    _connected = false;
  }

  Future<Map<String, dynamic>?> _apiGet(String url) async {
    final resp = await _send('GET', url);
    if (resp == null) return null;
    return jsonDecode(resp) as Map<String, dynamic>;
  }

  Future<String?> _send(String method, String url, {Object? body}) async {
    final token = _accessToken;
    if (token == null) return null;
    final client = HttpClient();
    try {
      final req = await client.openUrl(method, Uri.parse(url));
      req.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
      if (body != null) {
        req.headers.contentType = ContentType.json;
        req.add(utf8.encode(jsonEncode(body)));
      }
      final resp = await req.close();
      final text = await resp.transform(utf8.decoder).join();
      if (resp.statusCode >= 200 && resp.statusCode < 300) return text;
      return null;
    } catch (_) {
      return null;
    } finally {
      client.close();
    }
  }

  Future<String?> _currentUserId() async {
    if (_userId != null) return _userId;
    final me = await _apiGet('https://api.spotify.com/v1/me');
    _userId = me?['id'] as String?;
    return _userId;
  }

  Future<String?> _likedPlaylistId() async {
    if (_playlistId != null) return _playlistId;
    var url = 'https://api.spotify.com/v1/me/playlists?limit=50';
    while (true) {
      final page = await _apiGet(url);
      if (page == null) break;
      for (final p in (page['items'] as List? ?? [])) {
        if (p['name'] == likedPlaylistName) {
          _playlistId = p['id'] as String?;
          return _playlistId;
        }
      }
      final next = page['next'] as String?;
      if (next == null) break;
      url = next;
    }
    final uid = await _currentUserId();
    if (uid == null) return null;
    final created = await _send(
      'POST',
      'https://api.spotify.com/v1/users/$uid/playlists',
      body: {
        'name': likedPlaylistName,
        'public': false,
        'description': 'Songs I liked while playing Flutster.',
      },
    );
    if (created == null) return null;
    _playlistId = (jsonDecode(created) as Map<String, dynamic>)['id'] as String?;
    _playlistTrackIds = <String>{};
    return _playlistId;
  }

  Future<Set<String>> _loadPlaylistTrackIds() async {
    if (_playlistTrackIds != null) return _playlistTrackIds!;
    final ids = <String>{};
    final pid = await _likedPlaylistId();
    if (pid == null) return ids;
    if (_playlistTrackIds != null) return _playlistTrackIds!; // set while creating
    var url =
        'https://api.spotify.com/v1/playlists/$pid/tracks?fields=items(track(id)),next&limit=100';
    while (true) {
      final page = await _apiGet(url);
      if (page == null) break;
      for (final it in (page['items'] as List? ?? [])) {
        final id = it['track']?['id'] as String?;
        if (id != null) ids.add(id);
      }
      final next = page['next'] as String?;
      if (next == null) break;
      url = next;
    }
    _playlistTrackIds = ids;
    return ids;
  }

  static String _trackId(String uri) => uri.split(':').last;

  Future<bool> isInLikedPlaylist(String trackUri) async {
    final ids = await _loadPlaylistTrackIds();
    return ids.contains(_trackId(trackUri));
  }

  Future<bool> saveToLikedPlaylist(String trackUri) async {
    final pid = await _likedPlaylistId();
    if (pid == null) return false;
    final ids = await _loadPlaylistTrackIds();
    if (ids.contains(_trackId(trackUri))) return true;
    final res = await _send(
      'POST',
      'https://api.spotify.com/v1/playlists/$pid/tracks',
      body: {'uris': [trackUri]},
    );
    if (res == null) return false;
    ids.add(_trackId(trackUri));
    return true;
  }
}
