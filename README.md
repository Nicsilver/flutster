<p align="center">
  <img src="screenshots/social-banner.png" width="640" alt="Flutster. Scan a card. Play the song. Guess the year.">
</p>

<p align="center">
  <a href="../../releases/latest"><img src="https://img.shields.io/github/v/release/Nicsilver/flutster?label=release&color=b026ff" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-ff3d81" alt="AGPL-3.0 license"></a>
  <a href="https://nicsilver.github.io/flutster/"><img src="https://img.shields.io/badge/card_maker-live-5b2bff" alt="Card maker"></a>
</p>

Flutster is a companion app for music-timeline party games. Scan the QR code on a card and the song plays on your own Spotify. Everyone guesses the year it came out, then places it on their timeline.

It has two parts:

- **App** (Android, Flutter): scans cards and controls Spotify playback.
- **[Card Maker](https://nicsilver.github.io/flutster/)** (web): turns any Spotify playlist into printable double-sided cards.

Flutster runs on **your own** free Spotify developer credentials, so it works for you and your friends with nothing shared, no accounts, and no servers. It ships **no** song data.

## Screenshots

<p align="center">
  <img src="screenshots/app-scan.jpg" width="24%" alt="Scanner pointed at a music card">
  <img src="screenshots/app-guess.jpg" width="24%" alt="Now playing: guess the year">
  <img src="screenshots/app-onboarding.jpg" width="24%" alt="Guided Spotify setup">
  <img src="screenshots/app-settings.jpg" width="24%" alt="Settings">
</p>

## Features

- Opens straight to the camera. Point at a card and the song plays.
- Plays through the official Spotify app (Premium required for playback control).
- Fast-forward, rewind, restart, and an optional "start 30 seconds in" setting that skips long intros.
- Saves songs you like to a private "Flutster Songs" playlist with one tap.
- Card Maker turns any playlist into QR fronts and answer backs, aligned for double-sided printing, with a live songs-per-year balance chart.
- Deck sources: point the app at a deck-database URL or local file to resolve physical cards. You supply the source; the app bundles none.

## Download

Grab the latest signed APK from the [Releases](../../releases/latest) page and install it. You may need to allow installing from unknown sources.

## Setup: bring your own Spotify app

Both the app and the card maker use a free Spotify developer app that you create yourself, so you never share credentials or hit someone else's limits. It takes about three minutes, once, and the app walks you through it on first launch:

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and press **Create app**.
2. Under **Redirect URIs**, add both:
   - `flutster://auth` for the Android app
   - the card-maker URL you use: `https://nicsilver.github.io/flutster/` for the hosted site, or `http://127.0.0.1:5173/` if you run it locally
3. Under **Which API/SDKs**, tick **Web API** and **Android**.
4. Under **Android packages**, add the package `com.nicsilver.flutster` with the release SHA-1:
   `C4:9E:41:2D:B4:7E:C7:0A:53:B8:0A:67:97:42:FB:B6:80:28:F1:F6`
5. Under **Users and Access**, add your own Spotify account (needs **Premium**).
6. Copy the **Client ID** and paste it into the app's setup screen (the card maker asks for the same ID).

You also need the Spotify app installed and a Spotify Premium account.

## Card Maker

- Hosted, free: https://nicsilver.github.io/flutster/
- Local:

  ```bash
  cd card-maker
  npm install
  npm run dev      # http://127.0.0.1:5173/
  ```

Log in, pick a playlist, and download the fronts (QR codes) and backs (answers) as PDFs. Print the fronts, flip the paper, print the backs. The QR codes are plain `spotify:track:` URIs, so the app scans and plays them directly.

## Build the app from source

```bash
cd app
flutter pub get
flutter run          # debug build on a connected device
```

## Data and scope

Flutster is an independent hobby project for personal use. It is not affiliated with, endorsed by, or connected to Spotify or any card-game publisher, and it does not include or distribute any game's card database. You point it at your own cards or your own deck source. Spotify is a trademark of Spotify AB.

## License

[AGPL-3.0](LICENSE)
