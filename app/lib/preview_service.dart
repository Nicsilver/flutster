import 'dart:convert';
import 'dart:io';

/// Preview mode: no Spotify account of any kind. A scanned card resolves to a
/// 30-second iTunes preview clip instead: title/artist come from the
/// credential-free metadata mirror (same one the card maker's Preview mode
/// uses), then an iTunes search finds the matching clip. Search-only on
/// purpose — iTunes' lookup endpoint ignores ISRC, and deck-database cards
/// already carry title/artist.
class PreviewTrack {
  final String title;
  final String artist;
  final String previewUrl;
  const PreviewTrack(this.title, this.artist, this.previewUrl);
}

class PreviewService {
  PreviewService._();
  static final PreviewService instance = PreviewService._();

  static const _worker = 'https://flutster-meta.nic-silver.workers.dev';

  // uri -> resolved clip, or null for a known miss (don't re-search mid-game).
  final Map<String, PreviewTrack?> _cache = {};

  final HttpClient _http = HttpClient()
    ..connectionTimeout = const Duration(seconds: 10);

  Future<Map<String, dynamic>?> _getJson(String url) async {
    try {
      final req = await _http.getUrl(Uri.parse(url));
      final res = await req.close().timeout(const Duration(seconds: 12));
      if (res.statusCode != 200) return null;
      final body = await res.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }

  static String _flat(String s) => s
      .toLowerCase()
      .replaceAll(RegExp(r'[^a-z0-9]'), '');

  // "Song - Remastered 2011 (feat. X)" -> "Song"
  static String _bareTitle(String t) => t.split(' - ')[0].split(' (')[0].trim();
  static String _leadArtist(String a) => a.split(',')[0].trim();

  Future<PreviewTrack?> resolve(String spotifyUri,
      {String? title, String? artist}) async {
    if (_cache.containsKey(spotifyUri)) return _cache[spotifyUri];

    var t = title ?? '';
    var a = artist ?? '';
    if (t.isEmpty) {
      final id = spotifyUri.split(':').last;
      final meta = await _getJson('$_worker/track/$id');
      if (meta == null || (meta['title'] as String? ?? '').isEmpty) {
        // Mirror unreachable: don't cache, the next scan may succeed.
        return null;
      }
      t = meta['title'] as String;
      a = (meta['artist'] as String?) ?? '';
    }

    final clip = await _findClip(_bareTitle(t), _leadArtist(a));
    _cache[spotifyUri] = clip;
    return clip;
  }

  Future<PreviewTrack?> _findClip(String title, String artist) async {
    final fa = _flat(artist);
    final ft = _flat(title);
    // Same ladder the card maker probes with (~96% hit rate on a real deck):
    // artist+title on the local storefront, title-only, then the US storefront.
    final attempts = [
      ['$artist $title', 'DK'],
      [title, 'DK'],
      ['$artist $title', 'US'],
    ];
    for (final at in attempts) {
      final term = Uri.encodeComponent(at[0].length > 80 ? at[0].substring(0, 80) : at[0]);
      final j = await _getJson(
          'https://itunes.apple.com/search?term=$term&entity=song&limit=10&country=${at[1]}');
      final results = (j?['results'] as List?) ?? const [];
      for (final r in results) {
        final url = r['previewUrl'] as String?;
        if (url == null || url.isEmpty) continue;
        final ra = _flat((r['artistName'] as String?) ?? '');
        final rt = _flat((r['trackName'] as String?) ?? '');
        final artistOk = ra.contains(fa) || fa.contains(ra);
        final titleOk = rt.contains(ft) || ft.contains(rt);
        if (artistOk && titleOk) {
          return PreviewTrack(title, artist, url);
        }
      }
    }
    return null;
  }
}
