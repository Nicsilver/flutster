import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:spotify_sdk/models/player_state.dart';
import 'package:url_launcher/url_launcher.dart';

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
        useMaterial3: true,
        brightness: Brightness.dark,
        // Berry Punch — mirrors the card-maker web theme.
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFB026FF), // violet
          brightness: Brightness.dark,
          secondary: const Color(0xFFFF3D81), // pink
          tertiary: const Color(0xFF5B2BFF), // indigo
          surface: const Color(0xFF17111F),
          onSurface: const Color(0xFFFDEEE6),
        ),
        scaffoldBackgroundColor: const Color(0xFF0E0A18),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF0E0A18),
          foregroundColor: Color(0xFFFDEEE6),
          elevation: 0,
        ),
      ),
      home: ValueListenableBuilder<String>(
        valueListenable: AppSettings.instance.clientId,
        builder: (_, id, __) =>
            id.trim().isEmpty ? const OnboardingScreen() : const ScanHome(),
      ),
    );
  }
}

// ── Berry Punch gradient helpers (mirror the card-maker web theme) ──
const _berryGradient = LinearGradient(
  colors: [Color(0xFFFF3D81), Color(0xFFB026FF), Color(0xFF5B2BFF)],
  stops: [0.0, 0.55, 1.0],
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
);

/// Fills [text] with the Berry Punch gradient (like the web wordmark/headings).
class GradientText extends StatelessWidget {
  const GradientText(this.text, {super.key, this.style, this.gradient = _berryGradient});
  final String text;
  final TextStyle? style;
  final Gradient gradient;
  @override
  Widget build(BuildContext context) {
    return ShaderMask(
      blendMode: BlendMode.srcIn,
      shaderCallback: (r) => gradient.createShader(Rect.fromLTWH(0, 0, r.width, r.height)),
      child: Text(text, style: (style ?? const TextStyle()).copyWith(color: Colors.white)),
    );
  }
}

/// Gradient-filled primary button (mirrors the web `.primary`).
class GradientButton extends StatelessWidget {
  const GradientButton({
    super.key,
    required this.child,
    required this.onPressed,
    this.padding = const EdgeInsets.symmetric(vertical: 16, horizontal: 22),
  });
  final Widget child;
  final VoidCallback? onPressed;
  final EdgeInsetsGeometry padding;
  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null;
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: enabled ? _berryGradient : null,
        color: enabled ? null : Colors.white10,
        borderRadius: BorderRadius.circular(14),
        boxShadow: enabled
            ? const [BoxShadow(color: Color(0x59B026FF), blurRadius: 22, offset: Offset(0, 8))]
            : null,
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onPressed,
          child: Padding(
            padding: padding,
            child: Center(
              child: DefaultTextStyle.merge(
                style: TextStyle(
                    color: enabled ? Colors.white : Colors.white38,
                    fontWeight: FontWeight.bold,
                    fontSize: 16),
                child: child,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Soft corner glows over the plum background (mirrors the web radial glows).
class BerryBackground extends StatelessWidget {
  const BerryBackground({super.key, required this.child});
  final Widget child;
  static Widget _glow(Color c, [double size = 400]) => IgnorePointer(
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: RadialGradient(colors: [c.withValues(alpha: 0.22), c.withValues(alpha: 0.0)]),
          ),
        ),
      );
  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        const Positioned.fill(child: ColoredBox(color: Color(0xFF0E0A18))),
        Positioned(left: -130, top: -150, child: _glow(const Color(0xFFFF3D81))),
        Positioned(right: -150, top: -60, child: _glow(const Color(0xFF5B2BFF))),
        Positioned(left: -80, bottom: -170, child: _glow(const Color(0xFFB026FF), 340)),
        Positioned.fill(child: child),
      ],
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
      if (!ok && mounted) {
        _snack('Couldn\'t connect. Is Spotify installed and logged in?');
      }
    } catch (e) {
      setState(() {
        _spotifyOk = false;
        _spotifyStatus = 'Tap to connect';
      });
      if (mounted) {
        final msg = e is PlatformException ? (e.message ?? e.code) : e.toString();
        _snack('Spotify: $msg');
      }
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
                      const GradientText('Flutster',
                          style: TextStyle(
                              fontSize: 26, fontWeight: FontWeight.bold)),
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
        backgroundColor: Colors.transparent,
        body: BerryBackground(
          child: SafeArea(
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
              ShaderMask(
                blendMode: BlendMode.srcIn,
                shaderCallback: (r) =>
                    _berryGradient.createShader(Rect.fromLTWH(0, 0, r.width, r.height)),
                child: const Icon(Icons.music_note, size: 120, color: Colors.white),
              ),
              const SizedBox(height: 28),
              GradientText('Guess the year',
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
                child: GradientButton(
                  onPressed: _guess,
                  padding: const EdgeInsets.symmetric(vertical: 30),
                  child: const Text('GUESS',
                      style: TextStyle(
                          fontSize: 28, fontWeight: FontWeight.bold, color: Colors.white)),
                ),
              ),
              const SizedBox(height: 40),
            ],
          ),
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
    return BerryBackground(
      child: Scaffold(
      backgroundColor: Colors.transparent,
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
          _step(1, 'Log in and press Create app in the Spotify dashboard.',
              link: 'https://developer.spotify.com/dashboard',
              linkLabel: 'Open dashboard'),
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
          GradientButton(
            onPressed: _save,
            child: const Text('Save & continue'),
          ),
          const SizedBox(height: 28),
          const Divider(),
          const SizedBox(height: 14),
          Text('Got physical music cards?',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 6),
          Text(
            "If you own printed music cards (like a music-timeline card game), Flutster "
            "can play them too — it just needs a deck database that maps each card to a "
            "track. Search the web for your game's card / gameset database (a public JSON "
            "file), then add its URL under Deck sources. Optional — without one you can "
            "still scan cards you make in the card maker.",
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const DeckSourcesScreen())),
            icon: const Icon(Icons.playlist_add),
            label: const Text('Deck sources (optional)'),
          ),
        ],
      ),
    ),
  );
  }

  void _copy(String text) {
    Clipboard.setData(ClipboardData(text: text));
    ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Copied'), duration: Duration(seconds: 1)));
  }

  Future<void> _open(String url) async {
    await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  }

  Widget _step(int n, String text, {String? copy, String? link, String? linkLabel}) {
    const berry = Color(0xFFB026FF);
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 13,
            backgroundColor: berry,
            child: Text('$n',
                style: const TextStyle(
                    color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(text),
                if (link != null)
                  TextButton.icon(
                    onPressed: () => _open(link),
                    style: TextButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    icon: const Icon(Icons.open_in_new, size: 16),
                    label: Text(linkLabel ?? 'Open'),
                  ),
                if (copy != null)
                  Container(
                    width: double.infinity,
                    margin: const EdgeInsets.only(top: 5),
                    padding: const EdgeInsets.only(left: 10, top: 4, bottom: 4, right: 4),
                    decoration: BoxDecoration(
                        color: Colors.white10, borderRadius: BorderRadius.circular(8)),
                    child: Row(
                      children: [
                        Expanded(
                          child: SelectableText(copy,
                              style: const TextStyle(fontFamily: 'monospace', fontSize: 13)),
                        ),
                        IconButton(
                          visualDensity: VisualDensity.compact,
                          icon: const Icon(Icons.copy, size: 18, color: berry),
                          onPressed: () => _copy(copy),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// Manage deck-database source URLs. Flutster ships no deck data itself — these
// are how physical cards get resolved to tracks.
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Deck sources')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              "Add a deck-database URL to resolve physical cards to songs. Flutster "
              "ships no deck data — search the web for your card game's card / gameset "
              "database (a public JSON file) and paste its URL. With none added, you can "
              "still scan cards you make in the card maker.",
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
                            leading: const Icon(Icons.link),
                            title: Text(src, maxLines: 1, overflow: TextOverflow.ellipsis),
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
              child: SizedBox(
                width: double.infinity,
                child: FilledButton.tonalIcon(
                  onPressed: _busy ? null : _addUrl,
                  icon: const Icon(Icons.add_link),
                  label: const Text('Add deck URL'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
