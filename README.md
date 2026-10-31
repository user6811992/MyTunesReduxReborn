# MyTunes Redux Reborn (v2.0.0 "Reborn")

> **Disclaimer:** MyTunes Redux Reborn is an independent open-source
> reimplementation of the historical myTunes Redux project by Bill Zeller.
> It is not affiliated with, endorsed by, or related to mytunes.ai, Apple Inc.,
> or iTunes.

A modern, legitimate reimagining of the classic **myTunes Redux** experience:
browse and download from DAAP-compatible music shares that you are authorized
to access, with a modern web-based GUI.

## Features
- Manual connection to DAAP servers (host/port/password)
- Best-effort Bonjour/mDNS discovery of `_daap._tcp` shares
- Browse server info, databases, playlists, and tracks
- Search/filter tracks by title, artist, album, genre
- Download selected or individual tracks
- Configurable download folder
- Open downloaded files in the default app (optional iTunes COM hook on Windows)
- Modern responsive web UI
- About page with dedication and credits

## Limitations
- iTunes 7+ / Home Sharing use proprietary authentication (`Client-DAAP-Validation`)
  that has not been publicly reverse-engineered. This client works with
  standards-compatible and legacy (pre-iTunes 7) shares where permitted.
- No DRM circumvention or unauthorized access is provided or intended.

## Run
```bash
npm start
```
Then open http://localhost:8765

## Test
```bash
npm test
```

## Dedication
In memory of **Bill Zeller**, creator of the original myTunes and myTunes Redux.

## Credits
Initial recreation analysis performed with **REA (Reverse Engineering Anything)**;
shout-out to **Beam Free** for assistance with analysis and rebuild planning.
Created for testing prior to open-sourcing on GitHub.