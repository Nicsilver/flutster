import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:path_provider/path_provider.dart';
import 'package:spotify_sdk/models/player_state.dart';

import 'card_resolver.dart';
import 'settings.dart';
import 'spotify_service.dart';

final _spotify = SpotifyService();
final _resolver = CardResolver();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  await AppSettings.instance.load();
  runApp(const FlutsterApp());
}

class FlutsterApp extends StatelessWidget {
  const FlutsterApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Flutster',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorSchemeSeed: const Color(0xFF1DB954),
        brightness: Brightness.dark,
        useMaterial3: true,
      ),
      home: ValueListenableBuilder<String>(
        valueListenable: AppSettings.instance.clientId,
        builder: (_, id, __) =>
            id.trim().isEmpty ? const OnboardingScreen() : const ScanHome(),
      ),
    );
  }
}

class ScanHome extends StatefulWidget {
  const ScanHome({super.key});
  @override
  State<ScanHome> createState() => _ScanHomeState();
}

class _ScanHomeState extends State<ScanHome> {
  final _controller = MobileScannerController();
  bool _handling = false;
  String _spotifyStatus = 'Connecting…';
  bool _spotifyOk = false;

  @override
  void initState() {
    super.initState();
    _connectSpotify();
    for (final src in AppSettings.instance.deckSources.value) {
      _resolver.loadSource(src).catchError((_) => 0);
    }
  }

  Future<void> _connectSpotify() async {
    setState(() => _spotifyStatus = 'Connecting…');
    try {
      final ok = await _spotify.connect();
      setState(() {
        _spotifyOk = ok;
        _spotifyStatus = ok ? 'Spotify' : 'Tap to connect';
      });
    } catch (_) {
      setState(() {
        _spotifyOk = false;
        _spotifyStatus = 'Tap to connect';
      });
    }
  }

  Future<void> _onDetect(BarcodeCapture cap) async {
    if (_handling) return;
    final raw = cap.barcodes.firstOrNull?.rawValue;
    if (raw == null) return;

    final directUri = spotifyTrackUriFrom(raw);
    HitsterCard? card;
    if (directUri == null) {
      card = HitsterCard.tryParse(raw);
      if (card == null) return;
    }

    _handling = true;
    await _controller.stop();

    final track = directUri != null
        ? ResolvedTrack(spotifyUri: directUri, title: '', artist: '', year: 0)
        : await _resolver.resolve(card!);
    if (!mounted) return;

    if (track == null) {
      _snack('Card ${card!.id} isn\'t in the deck map yet.');
    } else if (!_spotify.isConnected) {
      _snack('Connect Spotify first.');
      await _connectSpotify();
    } else {
      await Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => NowPlayingScreen(track: track),
      ));
    }
    _handling = false;
    if (mounted) await _controller.start();
  }

  void _snack(String msg) => ScaffoldMessenger.of(context)
      .showSnackBar(SnackBar(content: Text(msg)));

  Future<void> _openSettings() async {
    await _controller.stop();
    if (mounted) {
      await Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => const SettingsScreen()),
      );
    }
    if (mounted) await _controller.start();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        fit: StackFit.expand,
        children: [
          MobileScanner(controller: _controller, onDetect: _onDetect),
          const _ScannerFrame(),
          SafeArea(
            child: Column(
              children: [
                Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Flutster',
                          style: TextStyle(
                              fontSize: 26,
                              fontWeight: FontWeight.bold,
                              color: Colors.white)),
                      Row(children: [
                        _StatusChip(
                          status: _spotifyStatus,
                          ok: _spotifyOk,
                          onTap: _spotifyOk ? null : _connectSpotify,
                        ),
                        IconButton(
                          icon: const Icon(Icons.settings, color: Colors.white),
                          onPressed: _openSettings,
                        ),
                      ]),
                    ],
                  ),
                ),
                const Spacer(),
                Padding(
                  padding: const EdgeInsets.only(bottom: 48),
                  child: Text('Point at a music card',
                      style: Theme.of(context)
                          .textTheme
                          .titleMedium
                          ?.copyWith(color: Colors.white70)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  final String status;
  final bool ok;
  final VoidCallback? onTap;
  const _StatusChip({required this.status, required this.ok, this.onTap});
  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: Colors.black54,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(children: [
          Icon(Icons.circle,
              size: 10, color: ok ? const Color(0xFF1DB954) : Colors.orange),
          const SizedBox(width: 6),
          Text(status, style: const TextStyle(color: Colors.white)),
        ]),
      ),
    );
  }
}

class _ScannerFrame extends StatelessWidget {
  const _ScannerFrame();
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        width: 240,
        height: 240,
        decoration: BoxDecoration(
          border: Border.all(color: Colors.white70, width: 3),
          borderRadius: BorderRadius.circular(24),
        ),
      ),
    );
  }
}

// No reveal — the year is printed on the physical card back.
class NowPlayingScreen extends StatefulWidget {
  final ResolvedTrack track;
  const NowPlayingScreen({super.key, required this.track});
  @override
  State<NowPlayingScreen> createState() => _NowPlayingScreenState();
}

class _NowPlayingScreenState extends State<NowPlayingScreen> {
  static const int _skipMs = 15000;

  StreamSubscription<PlayerState>? _sub;
  Timer? _ticker;
  bool _paused = false;
  bool _saving = false;
  bool _saved = false;
  int _baseMs = 0;
  DateTime _syncAt = DateTime.now();

  // Spotify's stream only emits on change, so extrapolate while playing.
  int get _positionMs => _paused
      ? _baseMs
      : _baseMs + DateTime.now().difference(_syncAt).inMilliseconds;

  @override
  void initState() {
    super.initState();
    final startAt = AppSettings.instance.start30.value ? 30000 : 0;
    _baseMs = startAt;
    _syncAt = DateTime.now();
    _spotify.play(widget.track.spotifyUri, startAtMs: startAt);
    _spotify.isInLikedPlaylist(widget.track.spotifyUri).then((already) {
      if (mounted && already) setState(() => _saved = true);
    });
    _sub = _spotify.playerState().listen((ps) {
      if (!mounted || _paused) return;
      // Ignore the previous song's lingering events during a fast re-scan.
      if (ps.track?.uri != widget.track.spotifyUri) return;
      setState(() {
        _baseMs = ps.playbackPosition;
        _syncAt = DateTime.now();
      });
    });
    // Tick the clock between stream events.
    _ticker = Timer.periodic(const Duration(milliseconds: 250), (_) {
      if (mounted && !_paused) setState(() {});
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    _ticker?.cancel();
    super.dispose();
  }

  // Pausing here would race the next scan's play(); PopScope handles the stop.
  void _guess() => Navigator.of(context).pop();

  void _togglePlay() {
    if (_paused) {
      // Resume: keep the frozen position, restart extrapolation from now.
      setState(() {
        _paused = false;
        _syncAt = DateTime.now();
      });
      _spotify.resume();
    } else {
      // Freeze the clock at the current position.
      setState(() {
        _baseMs = _positionMs;
        _paused = true;
      });
      _spotify.pause();
    }
  }

  // Update the clock optimistically rather than waiting for a Spotify event.
  void _seekBy(int deltaMs) {
    _spotify.nudge(deltaMs);
    setState(() {
      final target = _positionMs + deltaMs;
      _baseMs = target < 0 ? 0 : target;
      _syncAt = DateTime.now();
    });
  }

  void _restart() {
    _spotify.seekTo(0);
    if (_paused) _spotify.resume();
    setState(() {
      _baseMs = 0;
      _syncAt = DateTime.now();
      _paused = false;
    });
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    final ok = await _spotify.saveToLikedPlaylist(widget.track.spotifyUri);
    if (!mounted) return;
    // No toast — the icon flipping to a green check is the confirmation.
    setState(() {
      _saving = false;
      _saved = ok;
    });
  }

  String _fmt(int ms) {
    final s = (ms / 1000).floor();
    return '${(s ~/ 60)}:${(s % 60).toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      // Stop playback on any exit (GUESS, close, back button/gesture).
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) _spotify.pause();
      },
      child: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  IconButton(
                    iconSize: 32,
                    icon: const Icon(Icons.close),
                    onPressed: _guess,
                  ),
                  IconButton(
                    iconSize: 40,
                    tooltip: _saved
                        ? 'Already in ${SpotifyService.likedPlaylistName}'
                        : 'Save to ${SpotifyService.likedPlaylistName}',
                    onPressed: (_saving || _saved) ? null : _save,
                    icon: _saving
                        ? const SizedBox(
                            width: 26,
                            height: 26,
                            child: CircularProgressIndicator(strokeWidth: 2))
                        : Icon(
                            _saved
                                ? Icons.check_circle
                                : Icons.add_circle_outline,
                            color: _saved ? const Color(0xFF1DB954) : null,
                          ),
                  ),
                ],
              ),
              const Spacer(),
              const Icon(Icons.music_note, size: 120),
              const SizedBox(height: 28),
              Text('Guess the year',
                  style: Theme.of(context)
                      .textTheme
                      .headlineLarge
                      ?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 28),
              Text(_fmt(_positionMs),
                  style: Theme.of(context).textTheme.displaySmall?.copyWith(
                      fontFeatures: const [],
                      fontWeight: FontWeight.w600)),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  IconButton(
                    iconSize: 60,
                    onPressed: () => _seekBy(-_skipMs),
                    icon: const Icon(Icons.fast_rewind),
                    tooltip: 'Back 15s',
                  ),
                  const SizedBox(width: 12),
                  IconButton(
                    iconSize: 96,
                    onPressed: _togglePlay,
                    icon: Icon(
                        _paused ? Icons.play_circle : Icons.pause_circle),
                  ),
                  const SizedBox(width: 12),
                  IconButton(
                    iconSize: 60,
                    onPressed: () => _seekBy(_skipMs),
                    icon: const Icon(Icons.fast_forward),
                    tooltip: 'Forward 15s',
                  ),
                ],
              ),
              const SizedBox(height: 8),
              TextButton.icon(
                onPressed: _restart,
                icon: const Icon(Icons.restart_alt, size: 26),
                label: const Text('Restart', style: TextStyle(fontSize: 16)),
              ),
              const Spacer(),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 30),
                    textStyle: const TextStyle(
                        fontSize: 28, fontWeight: FontWeight.bold),
                  ),
                  onPressed: _guess,
                  child: const Text('GUESS'),
                ),
              ),
              const SizedBox(height: 40),
            ],
          ),
        ),
      ),
      ),
    );
  }
}

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final s = AppSettings.instance;
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          ValueListenableBuilder<bool>(
            valueListenable: s.start30,
            builder: (context, value, _) => SwitchListTile(
              title: const Text('Start songs 30 seconds in'),
              subtitle: const Text(
                  'Skip the intro — scanned songs begin 30s into the track.'),
              value: value,
              onChanged: (v) => s.setStart30(v),
            ),
          ),
          const Divider(),
          ListTile(
            title: const Text('Spotify Client ID'),
            subtitle: const Text('The Spotify developer app Flutster connects with.'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const OnboardingScreen())),
          ),
          const Divider(),
          ValueListenableBuilder<List<String>>(
            valueListenable: AppSettings.instance.deckSources,
            builder: (context, sources, _) => ListTile(
              title: const Text('Deck sources'),
              subtitle: Text(sources.isEmpty
                  ? 'None — scan your own QR cards, or add a deck database'
                  : '${sources.length} source${sources.length == 1 ? '' : 's'}'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const DeckSourcesScreen())),
            ),
          ),
          const Divider(),
          const ListTile(
            title: Text('Liked songs playlist'),
            subtitle: Text(
                'The "+" button saves songs to "${SpotifyService.likedPlaylistName}" on your Spotify.'),
          ),
        ],
      ),
    );
  }
}

// One-time setup: the user pastes their own Spotify app's Client ID.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});
  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  late final _c = TextEditingController(text: AppSettings.instance.clientId.value);
  static const _pkg = 'com.nicsilver.flutster';
  static const _redirect = 'flutster://auth';
  static const _sha1 = 'C4:9E:41:2D:B4:7E:C7:0A:53:B8:0A:67:97:42:FB:B6:80:28:F1:F6';

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final id = _c.text.trim();
    if (id.isEmpty) return;
    await AppSettings.instance.setClientId(id);
    if (mounted && Navigator.of(context).canPop()) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Connect Spotify')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            'Flutster plays music through your own free Spotify developer app, so it '
            'works for you and your friends. One-time setup, about 3 minutes.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 20),
          _step(1, 'Open developer.spotify.com/dashboard, log in, and press Create app.'),
          _step(2, 'Redirect URI — add exactly:', copy: _redirect),
          _step(3, 'Which API/SDKs — tick Web API and Android.'),
          _step(4, 'Android package name:', copy: _pkg),
          _step(5, 'Android SHA-1 fingerprint:', copy: _sha1),
          _step(6, 'Users and Access — add your own Spotify account (needs Premium).'),
          _step(7, "Open the app's Settings, copy its Client ID, and paste it below."),
          const SizedBox(height: 12),
          TextField(
            controller: _c,
            decoration: const InputDecoration(
              labelText: 'Spotify Client ID',
              border: OutlineInputBorder(),
            ),
            onSubmitted: (_) => _save(),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _save,
            child: const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Text('Save & continue'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _step(int n, String text, {String? copy}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 13,
            backgroundColor: const Color(0xFF1DB954),
            child: Text('$n',
                style: const TextStyle(
                    color: Colors.black, fontWeight: FontWeight.bold, fontSize: 13)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(text),
                if (copy != null)
                  Container(
                    width: double.infinity,
                    margin: const EdgeInsets.only(top: 5),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    decoration: BoxDecoration(
                        color: Colors.white10, borderRadius: BorderRadius.circular(8)),
                    child: SelectableText(copy,
                        style: const TextStyle(fontFamily: 'monospace', fontSize: 13)),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// Manage deck-database sources (URLs and local files). Flutster ships no deck
// data itself — these are how physical cards get resolved to tracks.
class DeckSourcesScreen extends StatefulWidget {
  const DeckSourcesScreen({super.key});
  @override
  State<DeckSourcesScreen> createState() => _DeckSourcesScreenState();
}

class _DeckSourcesScreenState extends State<DeckSourcesScreen> {
  String _status = '';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _status = '${_resolver.cardCount} cards loaded';
  }

  Future<void> _reload() async {
    setState(() => _busy = true);
    _resolver.clear();
    var failed = 0;
    for (final src in AppSettings.instance.deckSources.value) {
      try {
        await _resolver.loadSource(src);
      } catch (_) {
        failed++;
      }
    }
    setState(() {
      _busy = false;
      _status = '${_resolver.cardCount} cards loaded'
          '${failed > 0 ? ' · $failed source failed' : ''}';
    });
  }

  Future<void> _add(String src) async {
    final list = [...AppSettings.instance.deckSources.value];
    if (src.isEmpty || list.contains(src)) return;
    list.add(src);
    await AppSettings.instance.setDeckSources(list);
    await _reload();
  }

  Future<void> _remove(String src) async {
    final list = [...AppSettings.instance.deckSources.value]..remove(src);
    await AppSettings.instance.setDeckSources(list);
    if (!src.startsWith('http')) {
      try {
        await File(src).delete();
      } catch (_) {}
    }
    await _reload();
  }

  Future<void> _addUrl() async {
    final c = TextEditingController();
    final url = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Add deck URL'),
        content: TextField(
          controller: c,
          autofocus: true,
          decoration: const InputDecoration(hintText: 'https://…/deck.json'),
          onSubmitted: (v) => Navigator.pop(ctx, v.trim()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, c.text.trim()),
              child: const Text('Add')),
        ],
      ),
    );
    if (url != null && url.isNotEmpty) await _add(url);
  }

  Future<void> _addFile() async {
    final res = await FilePicker.platform.pickFiles(
        type: FileType.custom, allowedExtensions: ['json'], withData: true);
    final picked = (res != null && res.files.isNotEmpty) ? res.files.first : null;
    if (picked?.bytes == null) return;
    final dir = await getApplicationDocumentsDirectory();
    final f = File('${dir.path}/deck_${DateTime.now().millisecondsSinceEpoch}.json');
    await f.writeAsBytes(picked!.bytes!);
    await _add(f.path);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Deck sources')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              'Add deck databases to resolve physical cards to songs — a public URL or a '
              'local JSON file. Flutster ships no deck data; with none added you can still '
              'scan your own QR cards from the card maker.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
          Expanded(
            child: ValueListenableBuilder<List<String>>(
              valueListenable: AppSettings.instance.deckSources,
              builder: (context, sources, _) => sources.isEmpty
                  ? const Center(child: Text('No deck sources yet.'))
                  : ListView(
                      children: [
                        for (final src in sources)
                          ListTile(
                            leading: Icon(src.startsWith('http')
                                ? Icons.link
                                : Icons.insert_drive_file),
                            title: Text(
                                src.startsWith('http')
                                    ? src
                                    : src.split(Platform.pathSeparator).last,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis),
                            subtitle: Text(src.startsWith('http') ? 'URL' : 'Local file'),
                            trailing: IconButton(
                              icon: const Icon(Icons.delete_outline),
                              onPressed: _busy ? null : () => _remove(src),
                            ),
                          ),
                      ],
                    ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text(_busy ? 'Loading…' : _status,
                style: Theme.of(context).textTheme.bodySmall),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(children: [
                Expanded(
                  child: FilledButton.tonalIcon(
                    onPressed: _busy ? null : _addUrl,
                    icon: const Icon(Icons.add_link),
                    label: const Text('Add URL'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton.tonalIcon(
                    onPressed: _busy ? null : _addFile,
                    icon: const Icon(Icons.upload_file),
                    label: const Text('Add file'),
                  ),
                ),
              ]),
            ),
          ),
        ],
      ),
    );
  }
}
