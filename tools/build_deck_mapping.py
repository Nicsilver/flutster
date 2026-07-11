#!/usr/bin/env python3
"""
Build a deck_<code>.json mapping (card number -> Spotify track) for the Hitster PoC.

Two input modes:

  1) --playlist  <spotify playlist URL/URI>
     Pulls tracks in playlist order and assigns them to sequential card numbers
     starting at --start (default 1). Use this if you found the deck's official
     Spotify playlist and its order matches the card numbers.

  2) --csv <file.csv>   with columns: number,title,artist,year
     Reads what's printed on the card backs and looks each up via Spotify search.
     Most reliable for a real physical deck.

Auth: needs a Spotify app (https://developer.spotify.com/dashboard).
Set env vars SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET (client-credentials flow;
no user login needed for search / playlist reads of public playlists).

Usage:
  export SPOTIFY_CLIENT_ID=...
  export SPOTIFY_CLIENT_SECRET=...
  python build_deck_mapping.py --deck aaaa0047 --csv danish_base.csv    > deck_aaaa0047.json
  python build_deck_mapping.py --deck aaaa0047 --playlist https://open.spotify.com/playlist/XXXX --start 1
"""
import argparse, base64, csv, json, os, re, sys, urllib.parse, urllib.request

TOKEN_URL = "https://accounts.spotify.com/api/token"
API = "https://api.spotify.com/v1"


def get_token():
    cid = os.environ.get("SPOTIFY_CLIENT_ID")
    secret = os.environ.get("SPOTIFY_CLIENT_SECRET")
    if not cid or not secret:
        sys.exit("Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET env vars.")
    auth = base64.b64encode(f"{cid}:{secret}".encode()).decode()
    data = urllib.parse.urlencode({"grant_type": "client_credentials"}).encode()
    req = urllib.request.Request(
        TOKEN_URL, data=data,
        headers={"Authorization": f"Basic {auth}",
                 "Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)["access_token"]


def api_get(path, token, params=None):
    url = f"{API}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def search_track(title, artist, token):
    q = f'track:{title} artist:{artist}'
    res = api_get("/search", token, {"q": q, "type": "track", "limit": 1})
    items = res.get("tracks", {}).get("items", [])
    if not items:
        # looser query
        res = api_get("/search", token, {"q": f"{title} {artist}", "type": "track", "limit": 1})
        items = res.get("tracks", {}).get("items", [])
    if not items:
        return None
    t = items[0]
    year = 0
    m = re.match(r"(\d{4})", t["album"].get("release_date", ""))
    if m:
        year = int(m.group(1))
    return {"uri": t["uri"], "title": t["name"],
            "artist": ", ".join(a["name"] for a in t["artists"]), "year": year}


def playlist_id(s):
    m = re.search(r"playlist[:/]([A-Za-z0-9]+)", s)
    return m.group(1) if m else s


def from_playlist(pl, start, token):
    pid = playlist_id(pl)
    cards, offset, n = {}, 0, start
    while True:
        page = api_get(f"/playlists/{pid}/tracks", token,
                       {"offset": offset, "limit": 100,
                        "fields": "items(track(name,uri,artists(name),album(release_date)))"})
        items = page.get("items", [])
        if not items:
            break
        for it in items:
            t = it.get("track")
            if not t:
                continue
            year = 0
            m = re.match(r"(\d{4})", t["album"].get("release_date", ""))
            if m:
                year = int(m.group(1))
            cards[f"{n:05d}"] = {"uri": t["uri"], "title": t["name"],
                                 "artist": ", ".join(a["name"] for a in t["artists"]),
                                 "year": year}
            n += 1
        offset += len(items)
    return cards


def from_csv(path, token):
    cards = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            num = row["number"].strip().zfill(5)
            hit = search_track(row["title"].strip(), row["artist"].strip(), token)
            if hit:
                if row.get("year"):
                    hit["year"] = int(row["year"])
                cards[num] = hit
                print(f"  {num}  ok  {hit['title']} — {hit['artist']}", file=sys.stderr)
            else:
                print(f"  {num}  MISS  {row['title']} — {row['artist']}", file=sys.stderr)
    return cards


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--deck", required=True)
    ap.add_argument("--region", default="dk")
    ap.add_argument("--playlist")
    ap.add_argument("--csv")
    ap.add_argument("--start", type=int, default=1)
    args = ap.parse_args()

    token = get_token()
    if args.playlist:
        cards = from_playlist(args.playlist, args.start, token)
    elif args.csv:
        cards = from_csv(args.csv, token)
    else:
        sys.exit("Provide --playlist or --csv")

    out = {"deck": args.deck, "region": args.region,
           "note": f"Generated mapping for deck {args.deck}.", "cards": cards}
    json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
    print(f"\n{len(cards)} cards mapped.", file=sys.stderr)


if __name__ == "__main__":
    main()
