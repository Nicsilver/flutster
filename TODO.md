# Planned work

Small backlog for a project that is otherwise done. Nothing here blocks using
or releasing Flutster.

## Next up

- **Card-back design picker in the card maker.** A "Card design" select when
  generating backs: 11 approved designs (current Skyline stays the default),
  plus a "Mix" option that prints all designs equally across the deck (design
  assignment must be reproducible so reprints match). Fronts are untouched.
  Design decision record and mockup sources live locally in
  `staging/card-lab/PICKED.md` (not committed).

## Waiting on something

- **Fresh scan-screen screenshot for the README.** Needs a physical printed
  card to point the camera at; the other three app screenshots are already
  current. Thirty-second job once a deck is printed: point the scanner at a
  card's back (no QR, so nothing triggers) and screencap.
- **Play Store review** of v1.4.0+8 is pending. After approval:
  - upload v1.4.1+9 (or newer) as an update: immersive mode, cutout fix,
    AGPL About text;
  - re-upload the GitHub social preview banner (manual: repo Settings →
    Social preview → `screenshots/social-banner.png`);
  - launch posts. Deliberately held until the app is live.
- **Spotify developer-app signups reopening.** A scheduled check runs every
  few days and opens a GitHub issue if the freeze lifts. When it fires,
  soften the "currently locked" warnings in the app onboarding, the web mode
  chooser, and the README.

## Parked decisions

- **Site front door.** Should the site open with a make-or-play choice
  instead of card-maker-first? Concepts are mocked; for now the promoted
  topbar Play button (concept A) is the answer. Revisit if the web player
  gets real use.
- **v1.4.1 release APK About text** still says MIT (binary was built before
  the relicense). Cosmetic; fold into the next release rather than re-cut.

## Ideas, not commitments

- In-app "Try a demo song" button, so a new user hears playback before
  owning any cards.
- "Need cards?" link on the scan screen pointing at the card maker.
- Danish localization.
- iOS build (needs Apple signing; the web player covers iPhones meanwhile).
