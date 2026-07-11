# Flutster Card Maker

A small web app that turns a **Spotify playlist** into **printable, double-sided
Flutster cards** — a grid of QR codes on the front (each encoding a
`spotify:track:` URI) and the year / artist / title on the back, laid out so the
two sides line up when you flip the paper.

The QR codes are plain Spotify track URIs, so the **Flutster** app scans and plays
them directly (no deck lookup needed).

## One-time setup

1. **Register the redirect URI** in your Spotify dashboard
   (https://developer.spotify.com/dashboard → your app → *Edit settings* →
   *Redirect URIs*). Add exactly:
   ```
   http://127.0.0.1:5173/
   ```
   (This is the same Spotify app as Flutster — Client ID `0c33…1e5`.)
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

1. **Log in with Spotify.**
2. Paste a **playlist link** (e.g. `https://open.spotify.com/playlist/…`) and hit **Load**.
   - Works with your own playlists and public playlists. (Spotify-owned/algorithmic
     playlists may be blocked by Spotify's API — copy them to your own playlist first.)
3. Adjust card size / margins if you like. Default is 63 mm (≈ Hitster size), 12 per A4.
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
