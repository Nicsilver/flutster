import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:spotify_sdk/models/player_state.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:audioplayers/audioplayers.dart' hide PlayerState;

import 'card_resolver.dart';
import 'preview_service.dart';
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
    return ValueListenableBuilder<String>(
      valueListenable: AppSettings.instance.themeMode,
      builder: (context, mode, _) => MaterialApp(
        title: 'Flutster',
        debugShowCheckedModeBanner: false,
        theme: decadesTheme(Brightness.light),
        darkTheme: decadesTheme(Brightness.dark),
        themeMode: mode == 'dark'
            ? ThemeMode.dark
            : mode == 'system'
                ? ThemeMode.system
                : ThemeMode.light,
        home: AnimatedBuilder(
          animation: Listenable.merge(
              [AppSettings.instance.clientId, AppSettings.instance.explored]),
          builder: (_, __) {
            final s = AppSettings.instance;
            final ready = s.clientId.value.trim().isNotEmpty || s.explored.value;
            return ready ? const ScanHome() : const OnboardingScreen();
          },
        ),
      ),
    );
  }
}

// ── Decades theme (mirrors the card-maker web theme: paper/ink + decade hues) ──
const decadeSpectrum = [
  Color(0xFFE3A008), // '60s
  Color(0xFFE8590C), // '70s
  Color(0xFFD6336C), // '80s
  Color(0xFF0CA678), // '90s
  Color(0xFF1C7ED6), // '00s
  Color(0xFF7048E8), // '10s+
];

ThemeData decadesTheme(Brightness b) {
  final light = b == Brightness.light;
  final ink = light ? const Color(0xFF26221C) : const Color(0xFFF0EDE6);
  final bg = light ? const Color(0xFFF7F2E9) : const Color(0xFF15171E);
  final panel = light ? const Color(0xFFFFFDF8) : const Color(0xFF1D2029);
  final teal = light ? const Color(0xFF0CA678) : const Color(0xFF22C99B);
  return ThemeData(
    useMaterial3: true,
    brightness: b,
    colorScheme: ColorScheme.fromSeed(
      seedColor: teal,
      brightness: b,
      primary: ink, // ink-on-paper buttons, like the web
      onPrimary: bg,
      secondary: teal, // control-active color only (toggles), like the web
      // Informational accents (labels, links, copy icons) use the decade blue —
      // teal on text read as stray green.
      tertiary:
          light ? const Color(0xFF1C7ED6) : const Color(0xFF4AA8FF),
      surface: panel,
      onSurface: ink,
    ),
    scaffoldBackgroundColor: bg,
    appBarTheme: AppBarTheme(
      backgroundColor: bg,
      foregroundColor: ink,
      elevation: 0,
    ),
  );
}

/// Paints [child] with the decade spectrum — the brand gradient, used only for
/// the wordmark and the odd hero glyph.
class SpectrumMask extends StatelessWidget {
  const SpectrumMask({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) {
    return ShaderMask(
      blendMode: BlendMode.srcIn,
      shaderCallback: (r) => const LinearGradient(colors: decadeSpectrum)
          .createShader(Rect.fromLTWH(0, 0, r.width, r.height)),
      child: child,
    );
  }
}

/// Brand/headline text; [color] overrides for surfaces like the camera preview.
class BrandText extends StatelessWidget {
  const BrandText(this.text, {super.key, this.style, this.color});
  final String text;
  final TextStyle? style;
  final Color? color;
  @override
  Widget build(BuildContext context) {
    return Text(text,
        style: (style ?? const TextStyle())
            .copyWith(color: color ?? Theme.of(context).colorScheme.onSurface));
  }
}

/// Solid ink primary button (mirrors the web `.primary`).
class PrimaryButton extends StatelessWidget {
  const PrimaryButton({
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
    final scheme = Theme.of(context).colorScheme;
    final enabled = onPressed != null;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: enabled ? scheme.primary : scheme.onSurface.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(14),
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
                    color: enabled
                        ? scheme.onPrimary
                        : scheme.onSurface.withValues(alpha: 0.4),
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
/// Plain scaffold-colored background. (An earlier version drew the spectrum
/// strip along the top edge, but rounded display corners clip it — the
/// spectrum lives on the primary buttons instead.)
class DecadesBackground extends StatelessWidget {
  const DecadesBackground({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Theme.of(context).scaffoldBackgroundColor,
      child: child,
    );
  }
}

/// Primary action carrying the brand spectrum — GUESS and the setup pager.
/// Solid ink like [PrimaryButton]; the spectrum shows as a slim strip along
/// the bottom edge (a full-bleed gradient fill reads garish at button size —
/// on the web the spectrum is likewise always a thin strip, never a fill).
class SpectrumButton extends StatelessWidget {
  const SpectrumButton({
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
    final scheme = Theme.of(context).colorScheme;
    final enabled = onPressed != null;
    return ClipRRect(
      borderRadius: BorderRadius.circular(14),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: enabled
              ? scheme.primary
              : scheme.onSurface.withValues(alpha: 0.12),
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onPressed,
            child: Stack(
              children: [
                Padding(
                  padding: padding,
                  child: Center(
                    child: DefaultTextStyle.merge(
                      style: TextStyle(
                          color: enabled
                              ? scheme.onPrimary
                              : scheme.onSurface.withValues(alpha: 0.4),
                          fontWeight: FontWeight.bold,
                          fontSize: 16),
                      child: child,
                    ),
                  ),
                ),
                if (enabled)
                  const Positioned(
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: 4,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(colors: decadeSpectrum),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
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
    // mobile_scanner 6+ no longer auto-starts the camera with the widget.
    unawaited(_controller.start());
    if (AppSettings.instance.hasClientId) {
      _connectSpotify();
    } else {
      // No Spotify app configured = preview mode: cards play 30s iTunes clips.
      _spotifyOk = true;
      _spotifyStatus = 'Previews';
    }
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
    } else if (!AppSettings.instance.hasClientId) {
      // Preview mode: no Spotify at all — resolve and play a 30s iTunes clip.
      await Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => PreviewPlayingScreen(track: track),
      ));
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
                      const SpectrumMask(
                        child: Text('Flutster',
                            style: TextStyle(
                                color: Colors.white,
                                fontSize: 26,
                                fontWeight: FontWeight.bold)),
                      ),
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

  Future<void> _toggleSave() async {
    setState(() => _saving = true);
    final ok = _saved
        ? await _spotify.removeFromLikedPlaylist(widget.track.spotifyUri)
        : await _spotify.saveToLikedPlaylist(widget.track.spotifyUri);
    if (!mounted) return;
    // No toast — the icon flipping between + and the green check is the confirmation.
    setState(() {
      _saving = false;
      if (ok) _saved = !_saved;
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
        body: DecadesBackground(
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
                        ? 'Remove from ${SpotifyService.likedPlaylistName}'
                        : 'Save to ${SpotifyService.likedPlaylistName}',
                    onPressed: _saving ? null : _toggleSave,
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
              Icon(Icons.music_note,
                  size: 120,
                  color: Theme.of(context)
                      .colorScheme
                      .onSurface
                      .withValues(alpha: 0.85)),
              const SizedBox(height: 28),
              BrandText('Guess the year',
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
                child: SpectrumButton(
                  onPressed: _guess,
                  padding: const EdgeInsets.symmetric(vertical: 30),
                  child: const Text('GUESS',
                      style: TextStyle(
                          fontSize: 28, fontWeight: FontWeight.bold)),
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

/// Preview-mode player: streams a looping 30-second iTunes clip. Same
/// blind-guess layout as [NowPlayingScreen]; no title/artist shown, no save
/// button (there is no Spotify account to save to).
class PreviewPlayingScreen extends StatefulWidget {
  final ResolvedTrack track;
  const PreviewPlayingScreen({super.key, required this.track});
  @override
  State<PreviewPlayingScreen> createState() => _PreviewPlayingScreenState();
}

class _PreviewPlayingScreenState extends State<PreviewPlayingScreen> {
  final _player = AudioPlayer();
  StreamSubscription<Duration>? _posSub;
  bool _resolving = true;
  bool _miss = false;
  bool _paused = false;
  int _posMs = 0;

  @override
  void initState() {
    super.initState();
    _start();
  }

  Future<void> _start() async {
    final t = widget.track;
    final clip = await PreviewService.instance.resolve(
      t.spotifyUri,
      title: t.title.isEmpty ? null : t.title,
      artist: t.artist.isEmpty ? null : t.artist,
    );
    if (!mounted) return;
    if (clip == null) {
      setState(() {
        _resolving = false;
        _miss = true;
      });
      return;
    }
    setState(() => _resolving = false);
    // Loop: the clip is only 30s and the table may still be arguing.
    await _player.setReleaseMode(ReleaseMode.loop);
    _posSub = _player.onPositionChanged.listen((d) {
      if (mounted) setState(() => _posMs = d.inMilliseconds);
    });
    await _player.play(UrlSource(clip.previewUrl));
  }

  @override
  void dispose() {
    _posSub?.cancel();
    _player.dispose();
    super.dispose();
  }

  void _guess() => Navigator.of(context).pop();

  void _togglePlay() {
    setState(() => _paused = !_paused);
    _paused ? _player.pause() : _player.resume();
  }

  void _restart() {
    _player.seek(Duration.zero);
    if (_paused) {
      _player.resume();
      setState(() => _paused = false);
    }
  }

  String _fmt(int ms) {
    final s = (ms / 1000).floor();
    return '${(s ~/ 60)}:${(s % 60).toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) _player.stop();
      },
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: DecadesBackground(
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
              child: Column(
                children: [
                  Align(
                    alignment: Alignment.centerLeft,
                    child: IconButton(
                      iconSize: 32,
                      icon: const Icon(Icons.close),
                      onPressed: _guess,
                    ),
                  ),
                  const Spacer(),
                  if (_resolving) ...[
                    const SizedBox(
                        width: 56,
                        height: 56,
                        child: CircularProgressIndicator(strokeWidth: 3)),
                    const SizedBox(height: 28),
                    BrandText('Finding the song…',
                        style: Theme.of(context)
                            .textTheme
                            .headlineSmall
                            ?.copyWith(fontWeight: FontWeight.bold)),
                  ] else if (_miss) ...[
                    Icon(Icons.music_off,
                        size: 120,
                        color: Theme.of(context)
                            .colorScheme
                            .onSurface
                            .withValues(alpha: 0.85)),
                    const SizedBox(height: 28),
                    BrandText('No preview for this one',
                        style: Theme.of(context)
                            .textTheme
                            .headlineSmall
                            ?.copyWith(fontWeight: FontWeight.bold)),
                    const SizedBox(height: 10),
                    Text('Put the card back and draw another.',
                        style: Theme.of(context).textTheme.bodyLarge),
                  ] else ...[
                    Icon(Icons.music_note,
                        size: 120,
                        color: Theme.of(context)
                            .colorScheme
                            .onSurface
                            .withValues(alpha: 0.85)),
                    const SizedBox(height: 28),
                    BrandText('Guess the year',
                        style: Theme.of(context)
                            .textTheme
                            .headlineLarge
                            ?.copyWith(fontWeight: FontWeight.bold)),
                    const SizedBox(height: 8),
                    Text('30 second preview',
                        style: Theme.of(context)
                            .textTheme
                            .bodyMedium
                            ?.copyWith(
                                color: Theme.of(context)
                                    .colorScheme
                                    .onSurface
                                    .withValues(alpha: 0.55))),
                    const SizedBox(height: 20),
                    Text(_fmt(_posMs),
                        style: Theme.of(context)
                            .textTheme
                            .displaySmall
                            ?.copyWith(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 16),
                    IconButton(
                      iconSize: 96,
                      onPressed: _togglePlay,
                      icon:
                          Icon(_paused ? Icons.play_circle : Icons.pause_circle),
                    ),
                    const SizedBox(height: 8),
                    TextButton.icon(
                      onPressed: _restart,
                      icon: const Icon(Icons.restart_alt, size: 26),
                      label:
                          const Text('Restart', style: TextStyle(fontSize: 16)),
                    ),
                  ],
                  const Spacer(),
                  SizedBox(
                    width: double.infinity,
                    child: _miss
                        ? PrimaryButton(
                            onPressed: _guess,
                            padding: const EdgeInsets.symmetric(vertical: 30),
                            child: const Text('SCAN NEXT',
                                style: TextStyle(
                                    fontSize: 28, fontWeight: FontWeight.bold)),
                          )
                        : SpectrumButton(
                            onPressed: _guess,
                            padding: const EdgeInsets.symmetric(vertical: 30),
                            child: const Text('GUESS',
                                style: TextStyle(
                                    fontSize: 28, fontWeight: FontWeight.bold)),
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

  static String _mask(String id) {
    final t = id.trim();
    if (t.length <= 8) return t;
    return '${t.substring(0, 4)}…${t.substring(t.length - 4)}';
  }

  @override
  Widget build(BuildContext context) {
    final s = AppSettings.instance;
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 28),
        children: [
          const _SettingsHeader('Appearance'),
          _SettingsGroup(children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 12, 10),
              child: Row(
                children: [
                  const Expanded(child: Text('Theme')),
                  ValueListenableBuilder<String>(
                    valueListenable: s.themeMode,
                    builder: (context, mode, _) => SegmentedButton<String>(
                      segments: const [
                        ButtonSegment(value: 'light', label: Text('Light')),
                        ButtonSegment(value: 'dark', label: Text('Dark')),
                        ButtonSegment(value: 'system', label: Text('Auto')),
                      ],
                      selected: {mode},
                      onSelectionChanged: (v) => s.setThemeMode(v.first),
                      showSelectedIcon: false,
                      style: const ButtonStyle(
                        visualDensity: VisualDensity.compact,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ]),
          const _SettingsHeader('Playback'),
          _SettingsGroup(children: [
            ValueListenableBuilder<bool>(
              valueListenable: s.start30,
              builder: (context, value, _) => SwitchListTile(
                title: const Text('Start songs 30 seconds in'),
                subtitle: const Text('Skip the quiet intros.'),
                value: value,
                onChanged: (v) => s.setStart30(v),
              ),
            ),
          ]),
          const _SettingsHeader('Spotify'),
          _SettingsGroup(children: [
            ValueListenableBuilder<String>(
              valueListenable: s.clientId,
              builder: (context, id, _) {
                final has = id.trim().isNotEmpty;
                return ListTile(
                  title: const Text('Client ID'),
                  subtitle: Text(has
                      ? _mask(id)
                      : 'Not set. Cards play 30 second preview clips; connect your own Spotify app for full songs.'),
                  trailing: has
                      ? const _TagChip('Added')
                      : const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const OnboardingScreen())),
                );
              },
            ),
            const Divider(height: 1, indent: 16, endIndent: 16),
            const ListTile(
              title: Text('Liked songs playlist'),
              subtitle: Text(
                  'The "+" button saves songs to "${SpotifyService.likedPlaylistName}" on your Spotify.'),
            ),
          ]),
          const _SettingsHeader('Decks'),
          _SettingsGroup(children: [
            ValueListenableBuilder<List<String>>(
              valueListenable: s.deckSources,
              builder: (context, sources, _) => ListTile(
                title: const Text('Deck sources'),
                subtitle: Text(sources.isEmpty
                    ? 'None. Scan your own QR cards, or add a deck database.'
                    : '${sources.length} source${sources.length == 1 ? '' : 's'}'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const DeckSourcesScreen())),
              ),
            ),
            const Divider(height: 1, indent: 16, endIndent: 16),
            ListTile(
              title: const Text('Card maker'),
              subtitle: const Text(
                  'Turn a Spotify playlist into printable cards, in your browser.'),
              trailing: const Icon(Icons.open_in_new, size: 18),
              onTap: () => launchUrl(
                  Uri.parse('https://nicsilver.github.io/flutster/'),
                  mode: LaunchMode.externalApplication),
            ),
          ]),
          const _SettingsHeader('About'),
          _SettingsGroup(children: [
            ListTile(
              title: const Text('Flutster on GitHub'),
              subtitle: const Text('Open source, AGPL-3.0 licensed.'),
              trailing: const Icon(Icons.open_in_new, size: 18),
              onTap: () => launchUrl(
                  Uri.parse('https://github.com/Nicsilver/flutster'),
                  mode: LaunchMode.externalApplication),
            ),
          ]),
        ],
      ),
    );
  }
}

class _SettingsHeader extends StatelessWidget {
  const _SettingsHeader(this.label);
  final String label;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(6, 22, 6, 8),
      child: Text(
        label.toUpperCase(),
        style: TextStyle(
            fontSize: 11.5,
            fontWeight: FontWeight.w800,
            letterSpacing: 1.2,
            color: Theme.of(context).colorScheme.tertiary),
      ),
    );
  }
}

class _SettingsGroup extends StatelessWidget {
  const _SettingsGroup({required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) {
    return Material(
      color: Theme.of(context).colorScheme.surface,
      borderRadius: BorderRadius.circular(16),
      clipBehavior: Clip.antiAlias,
      child: Column(children: children),
    );
  }
}

class _TagChip extends StatelessWidget {
  const _TagChip(this.label);
  final String label;
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: const Color(0xFF3DBE7A).withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(label,
          style: const TextStyle(
              color: Color(0xFF6FDCA4),
              fontSize: 11,
              fontWeight: FontWeight.w800)),
    );
  }
}

// One-time setup: the user pastes their own Spotify app's Client ID.
// A short pager rather than one long list — the middle page batches every value
// that goes into Spotify's single "Create app" form so it can all be copied in
// one sitting.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});
  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  late final _c = TextEditingController(text: AppSettings.instance.clientId.value);
  final _pager = PageController();
  int _page = 0;
  static const _pageCount = 4;
  static const _pkg = 'com.nicsilver.flutster';
  static const _redirect = 'flutster://auth';
  static const _sha1 = 'C4:9E:41:2D:B4:7E:C7:0A:53:B8:0A:67:97:42:FB:B6:80:28:F1:F6';

  @override
  void dispose() {
    _c.dispose();
    _pager.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final id = _c.text.trim();
    if (id.isEmpty) return;
    await AppSettings.instance.setClientId(id);
    if (mounted && Navigator.of(context).canPop()) Navigator.of(context).pop();
  }

  Future<void> _skip() async {
    await AppSettings.instance.setExplored(true);
    if (mounted && Navigator.of(context).canPop()) Navigator.of(context).pop();
  }

  void _copy(String text) {
    Clipboard.setData(ClipboardData(text: text));
    ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Copied'), duration: Duration(seconds: 1)));
  }

  Future<void> _open(String url) async {
    await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  }

  void _go(int delta) {
    _pager.animateToPage(_page + delta,
        duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
  }

  @override
  Widget build(BuildContext context) {
    final last = _page == _pageCount - 1;
    return DecadesBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(
          title: const Text('Connect Spotify'),
          actions: [
            TextButton(
                onPressed: _skip, child: const Text('Skip · play with previews')),
            const SizedBox(width: 6),
          ],
        ),
        body: Column(
          children: [
            Expanded(
              child: PageView(
                controller: _pager,
                onPageChanged: (i) => setState(() => _page = i),
                children: [_createPage(), _formPage(), _usersPage(), _finishPage()],
              ),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(_pageCount, (i) {
                final on = i == _page;
                return AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  width: on ? 20 : 7,
                  height: 7,
                  decoration: BoxDecoration(
                    color: on
                        ? Theme.of(context).colorScheme.tertiary
                        : Theme.of(context)
                            .colorScheme
                            .onSurface
                            .withValues(alpha: 0.24),
                    borderRadius: BorderRadius.circular(99),
                  ),
                );
              }),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
              child: Row(
                children: [
                  if (_page > 0) ...[
                    OutlinedButton(
                        onPressed: () => _go(-1), child: const Text('Back')),
                    const SizedBox(width: 12),
                  ],
                  Expanded(
                    child: last
                        ? AnimatedBuilder(
                            animation: _c,
                            builder: (_, __) => SpectrumButton(
                              onPressed: _c.text.trim().isEmpty ? null : _save,
                              child: const Text('Save & continue'),
                            ),
                          )
                        : SpectrumButton(
                            onPressed: () => _go(1),
                            child: const Text('Next'),
                          ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _pageShell(String step, String title, List<Widget> children) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 10, 20, 10),
      children: [
        Text(step.toUpperCase(),
            style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w800,
                letterSpacing: 1.2,
                color: Theme.of(context).colorScheme.tertiary)),
        const SizedBox(height: 5),
        Text(title,
            style: Theme.of(context)
                .textTheme
                .headlineSmall
                ?.copyWith(fontWeight: FontWeight.w800)),
        const SizedBox(height: 14),
        ...children,
      ],
    );
  }

  Widget _copyField(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  color: Theme.of(context)
                      .colorScheme
                      .onSurface
                      .withValues(alpha: 0.75))),
          const SizedBox(height: 5),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.only(left: 12, top: 4, bottom: 4, right: 4),
            decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surface,
                border: Border.all(
                    color: Theme.of(context)
                        .colorScheme
                        .onSurface
                        .withValues(alpha: 0.12)),
                borderRadius: BorderRadius.circular(10)),
            child: Row(
              children: [
                Expanded(
                  child: SelectableText(value,
                      style:
                          const TextStyle(fontFamily: 'monospace', fontSize: 13)),
                ),
                IconButton(
                  visualDensity: VisualDensity.compact,
                  icon: Icon(Icons.copy,
                      size: 18, color: Theme.of(context).colorScheme.tertiary),
                  onPressed: () => _copy(value),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _createPage() {
    return _pageShell('Step 1 of 4', 'Create your Spotify app', [
      Text(
        'Flutster plays music through your own free Spotify developer app, so it '
        'works for you and your friends. One-time setup, about 3 minutes.',
        style: Theme.of(context).textTheme.bodyMedium,
      ),
      const SizedBox(height: 18),
      const Text('Log in at the Spotify developer dashboard and press Create app.'),
      const SizedBox(height: 10),
      OutlinedButton.icon(
        onPressed: () => _open('https://developer.spotify.com/dashboard'),
        icon: const Icon(Icons.open_in_new, size: 16),
        label: const Text('Open dashboard'),
      ),
      const SizedBox(height: 14),
      Text(
        'Name and description can be anything. Keep the form open: the next page '
        'has everything you need to paste into it.',
        style: Theme.of(context).textTheme.bodySmall,
      ),
    ]);
  }

  Widget _formPage() {
    return _pageShell('Step 2 of 4', 'Fill in the app form', [
      Text(
        'Everything below goes into the same Create app form. Copy each value across.',
        style: Theme.of(context).textTheme.bodyMedium,
      ),
      const SizedBox(height: 16),
      _copyField('Redirect URI', _redirect),
      Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Row(
          children: [
            Icon(Icons.check_box_outlined,
                size: 18, color: Theme.of(context).colorScheme.tertiary),
            const SizedBox(width: 8),
            Expanded(
              child: Text('Under Which API/SDKs, tick Web API and Android.',
                  style: Theme.of(context).textTheme.bodyMedium),
            ),
          ],
        ),
      ),
      _copyField('Android package name', _pkg),
      _copyField('Android SHA-1 fingerprint', _sha1),
      Text(
        'Already created the app without these? Add them under Settings > Edit '
        'on your app page.',
        style: Theme.of(context).textTheme.bodySmall,
      ),
    ]);
  }

  Widget _usersPage() {
    return _pageShell('Step 3 of 4', 'Add yourself as a user', [
      Text(
        'On your new app page, open User Management and add the name and email '
        'of your own Spotify account.',
        style: Theme.of(context).textTheme.bodyMedium,
      ),
      const SizedBox(height: 16),
      Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.tertiary.withValues(alpha: 0.10),
          border: Border.all(
              color:
                  Theme.of(context).colorScheme.tertiary.withValues(alpha: 0.35)),
          borderRadius: BorderRadius.circular(12),
        ),
        child: const Text(
            'The account needs Spotify Premium. Controlling playback is a '
            'Premium feature.'),
      ),
    ]);
  }

  Widget _finishPage() {
    return _pageShell('Step 4 of 4', 'Paste your Client ID', [
      Text(
        'Copy the Client ID from the top of your app page in the dashboard and '
        'paste it here.',
        style: Theme.of(context).textTheme.bodyMedium,
      ),
      const SizedBox(height: 14),
      TextField(
        controller: _c,
        decoration: const InputDecoration(
          labelText: 'Spotify Client ID',
          border: OutlineInputBorder(),
        ),
        onSubmitted: (_) => _save(),
      ),
      const SizedBox(height: 24),
      const Divider(),
      const SizedBox(height: 12),
      Text('Got physical music cards?',
          style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 6),
      Text(
        "If you own printed music cards (like a music-timeline card game), Flutster "
        "can play them too. It just needs a deck database that maps each card to a "
        "track: search the web for your game's card or gameset database (a public "
        "JSON file), then add its URL under Deck sources. Optional, without one you "
        "can still scan cards you make in the card maker.",
        style: Theme.of(context).textTheme.bodySmall,
      ),
      const SizedBox(height: 10),
      OutlinedButton.icon(
        onPressed: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const DeckSourcesScreen())),
        icon: const Icon(Icons.playlist_add),
        label: const Text('Deck sources (optional)'),
      ),
    ]);
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
