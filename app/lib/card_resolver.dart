import 'dart:convert';
import 'dart:io';

class HitsterCard {
  final String region;
  final String deck;
  final String number;

  HitsterCard(this.region, this.deck, this.number);

  String get id => '$deck/$number';

  // Hitster card QRs are URLs like https://www.hitstergame.com/dk/aaaa0047/00230
  // (region / deck / number). Returns null for anything that isn't one.
  static HitsterCard? tryParse(String raw) {
    final s = raw.trim();
    final m = RegExp(
      r'hitstergame\.com/([a-z]{2})/([a-z0-9]+)/(\d{3,6})',
      caseSensitive: false,
    ).firstMatch(s);
    if (m != null) {
      return HitsterCard(m.group(1)!, m.group(2)!.toLowerCase(), m.group(3)!);
    }
    final m2 =
        RegExp(r'([a-z0-9]{4,})/(\d{3,6})', caseSensitive: false).firstMatch(s);
    if (m2 != null) {
      return HitsterCard('dk', m2.group(1)!.toLowerCase(), m2.group(2)!);
    }
    return null;
  }
}

// Extracts a spotify:track:ID from a raw URI or an open.spotify.com/track URL.
String? spotifyTrackUriFrom(String raw) {
  final s = raw.trim();
  final uri = RegExp(r'spotify:track:([A-Za-z0-9]+)').firstMatch(s);
  if (uri != null) return 'spotify:track:${uri.group(1)}';
  final url =
      RegExp(r'open\.spotify\.com/track/([A-Za-z0-9]+)', caseSensitive: false)
          .firstMatch(s);
  if (url != null) return 'spotify:track:${url.group(1)}';
  return null;
}

class ResolvedTrack {
  final String spotifyUri;
  final String title;
  final String artist;
  final int year;

  ResolvedTrack({
    required this.spotifyUri,
    required this.title,
    required this.artist,
    required this.year,
  });
}

// Resolves a physical card (deck + number) to a Spotify track using deck data the
// user loads from a URL. The app ships no deck data itself.
class CardResolver {
  final Map<String, Map<String, ResolvedTrack>> _decks = {};

  int get cardCount => _decks.values.fold(0, (s, m) => s + m.length);

  void clear() => _decks.clear();

  // Loads and merges a deck database from an http(s) URL or a local file path.
  // Accepts either the Hitster gameset_database.json shape or our own
  // {deck, cards:{…}} shape. Returns the number of cards added.
  Future<int> loadSource(String src) async {
    String body;
    if (src.startsWith('http')) {
      final client = HttpClient();
      try {
        final resp = await (await client.getUrl(Uri.parse(src))).close();
        if (resp.statusCode != 200) throw Exception('HTTP ${resp.statusCode}');
        body = await resp.transform(utf8.decoder).join();
      } finally {
        client.close();
      }
    } else {
      body = await File(src).readAsString();
    }
    return _merge(jsonDecode(body));
  }

  int _merge(dynamic data) {
    var added = 0;
    void add(String deck, String number, String uri,
        {String title = '', String artist = '', int year = 0}) {
      (_decks[deck] ??= {})[number] =
          ResolvedTrack(spotifyUri: uri, title: title, artist: artist, year: year);
      added++;
    }

    if (data is Map && data['gamesets'] is List) {
      for (final g in data['gamesets']) {
        final sku = g['sku']?.toString();
        final cards = g['gameset_data']?['cards'];
        if (sku == null || cards is! List) continue;
        for (final c in cards) {
          final sp = c['Spotify']?.toString();
          final num = c['CardNumber']?.toString();
          if (sp == null || sp.isEmpty || num == null) continue;
          add(sku, num, 'spotify:track:$sp');
        }
      }
    } else if (data is Map && data['cards'] is Map && data['deck'] != null) {
      final deck = data['deck'].toString();
      (data['cards'] as Map).forEach((number, v) {
        final t = v as Map;
        add(deck, number.toString(), t['uri'].toString(),
            title: t['title']?.toString() ?? '',
            artist: t['artist']?.toString() ?? '',
            year: (t['year'] as num?)?.toInt() ?? 0);
      });
    } else if (data is Map && data['decks'] is List) {
      for (final d in data['decks']) {
        added += _merge(d);
      }
    }
    return added;
  }

  Future<ResolvedTrack?> resolve(HitsterCard card) async {
    final deck = _decks[card.deck];
    if (deck == null) return null;
    return deck[card.number] ?? deck[int.tryParse(card.number)?.toString()];
  }
}
