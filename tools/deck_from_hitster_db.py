#!/usr/bin/env python3
"""
Build app/assets/deck_<sku>.json from Hitster's OWN public gameset database.

This is how the real Hitster app resolves cards: it downloads a public JSON that
maps every (SKU, CardNumber) -> Spotify track id. No private API, no auth needed
for the mapping itself.

    Public source: https://hitster.jumboplay.com/hitster-assets/gameset_database.json
    Structure: { "gamesets": [ { "sku": "aaaa0047",
                    "gameset_data": { "gameset_name": "...", "cards": [
                        {"CardNumber":"00230","Spotify":"<trackid>"}, ... ] } } ] }

Nic's Danish base deck = SKU aaaa0047 ("Hitster Original - Denmark", 308 cards).

Optional metadata enrichment (title/artist/year, for the in-app "reveal" screen):
set SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET and pass --enrich. Uses the Spotify
Web API /v1/tracks batch endpoint (client-credentials; no user login).

Usage:
    python deck_from_hitster_db.py --sku aaaa0047 --out ../app/assets/deck_aaaa0047.json
    python deck_from_hitster_db.py --sku aaaa0047 --enrich   # add title/artist/year
    python deck_from_hitster_db.py --list                    # list all SKUs + names
"""
import argparse, base64, json, os, sys, urllib.parse, urllib.request

DB_URL = "https://hitster.jumboplay.com/hitster-assets/gameset_database.json"


def load_db(path):
    if path and os.path.exists(path):
        return json.load(open(path, encoding="utf-8"))
    with urllib.request.urlopen(DB_URL) as r:
        return json.load(r)


def spotify_token():
    cid = os.environ.get("SPOTIFY_CLIENT_ID")
    sec = os.environ.get("SPOTIFY_CLIENT_SECRET")
    if not cid or not sec:
        sys.exit("--enrich needs SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET env vars.")
    auth = base64.b64encode(f"{cid}:{sec}".encode()).decode()
    data = urllib.parse.urlencode({"grant_type": "client_credentials"}).encode()
    req = urllib.request.Request(
        "https://accounts.spotify.com/api/token", data=data,
        headers={"Authorization": f"Basic {auth}",
                 "Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)["access_token"]


def enrich(cards, token):
    """cards: dict cardNumber -> {uri,...}. Fills title/artist/year in place."""
    ids = [v["uri"].split(":")[-1] for v in cards.values()]
    meta = {}
    for i in range(0, len(ids), 50):
        chunk = ids[i:i + 50]
        url = "https://api.spotify.com/v1/tracks?ids=" + ",".join(chunk)
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req) as r:
            for t in json.load(r)["tracks"]:
                if not t:
                    continue
                year = 0
                rd = t["album"].get("release_date", "")
                if rd[:4].isdigit():
                    year = int(rd[:4])
                meta[t["id"]] = (t["name"],
                                 ", ".join(a["name"] for a in t["artists"]), year)
    for v in cards.values():
        tid = v["uri"].split(":")[-1]
        if tid in meta:
            v["title"], v["artist"], v["year"] = meta[tid]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sku")
    ap.add_argument("--out")
    ap.add_argument("--db", default="gameset_database.json",
                    help="local cache path; downloaded if missing")
    ap.add_argument("--enrich", action="store_true")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    db = load_db(args.db)
    gamesets = db["gamesets"]

    if args.list:
        for g in gamesets:
            gd = g.get("gameset_data") or {}
            n = len(gd.get("cards", [])) if isinstance(gd, dict) else 0
            if n:
                print(f'{g["sku"]}  {n:>4} cards  {gd.get("gameset_name","")}')
        return

    if not args.sku:
        sys.exit("Provide --sku (or --list).")
    match = [g for g in gamesets if g["sku"] == args.sku]
    if not match:
        sys.exit(f"SKU {args.sku} not found.")
    gd = match[0]["gameset_data"]

    cards = {}
    for c in gd["cards"]:
        sp = c.get("Spotify")
        if sp:
            cards[c["CardNumber"]] = {"uri": "spotify:track:" + sp,
                                      "title": "", "artist": "", "year": 0}

    if args.enrich:
        enrich(cards, spotify_token())

    out = {"deck": args.sku, "region": "dk",
           "note": f'From Hitster gameset_database.json — {gd.get("gameset_name","")}.',
           "cards": cards}
    dest = args.out or f"deck_{args.sku}.json"
    json.dump(out, open(dest, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f'{gd.get("gameset_name","")}: {len(cards)} cards -> {dest}'
          f'{" (enriched)" if args.enrich else ""}')


if __name__ == "__main__":
    main()
