# Flutster Card Maker

A small web app that turns a **Spotify playlist** into **printable, double-sided
Flutster cards**. Fronts carry a QR code (a plain `spotify:track:` URI, scanned
directly by the Flutster app); backs carry the answer — artist, the year on a
wide colored pill, and the title — between two little equalizer skylines.

Every back gets its own colors, derived from the track itself (never from the
year, so a glimpsed corner can't spoil the answer). Fronts are identical on
every card, so nothing is memorizable between game nights. A **Colour / B&W
ink saver** switch covers laser printers, and the embedded rounded font (Baloo
2, OFL) travels inside the PDFs, so cards print the same everywhere.

## One-time setup

1. **Register the redirect URI** in your own Spotify app in the dashboard
   (https://developer.spotify.com/dashboard → your app → *Edit settings* →
   *Redirect URIs*). Add exactly:
   ```
   http://127.0.0.1:5173/
   ```
   (or `https://nicsilver.github.io/flutster/` if you use the hosted site).
2. Make sure **Web API** is ticked under the app's APIs.

## Run it

```bash
cd card-maker
npm install
npm run dev
```
Open **http://127.0.0.1:5173/** (use `127.0.0.1`, not `localhost` — Spotify only
accepts the loopback IP as a redirect).

## Use it

1. **Log in with Spotify.** Your playlists appear on the left, each with a
   little decade "fingerprint" showing its era mix; you can also paste any
   playlist link into the search box.
   - Works with your own playlists and public playlists. (Spotify-owned/algorithmic
     playlists may be blocked by Spotify's API — copy them to your own playlist first.)
2. Tune the deck: the timeline shows the year balance, tap cards to exclude
   them, cap songs per year, shuffle. The sheet preview on the right shows the
   exact printed layout, page by page.
3. Pick **cards per row** (default 3 → ~63 mm cards, 12 per A4) and **Colour**
   or **B&W** card style.
4. **Download the Fronts PDF** and the **Backs PDF**.

## Printing double-sided (by hand)

1. Print the **Fronts** (QR) PDF at **100% / actual size** (turn OFF “fit to page”).
2. Put the printed stack back in the tray and **flip it on the long edge (left↔right)**
   — or pick “Short edge” in the app and flip top↕bottom, whichever your printer wants.
3. Print the **Backs** (answers) PDF.
4. **Do one test sheet first** to confirm the backs line up, then cut along the guides.

## Notes / limits

- Auth is **PKCE** — no client secret is stored in the app (safe for the browser).
- Everything runs client-side; nothing is uploaded anywhere.
- Personal use. Respect Spotify's and any card game's terms.
