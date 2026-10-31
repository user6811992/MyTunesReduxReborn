# MyTunes Redux Reborn (v2.2.1 "Standalone")

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
- Network subnet scanner for DAAP hosts
- Browse server info, databases, playlists, and tracks
- Search/filter tracks by title, artist, album, genre
- Download selected or individual tracks (skip existing)
- Album art with fallback search
- Ratings and play counts
- Smart views (top rated, most played, unrated)
- Lyrics lookup
- Internet radio / podcast URL playback
- Podcast feed loading (RSS)
- ListenBrainz scrobbling (now playing + submit)
- Last.fm scrobbling (now playing + submit)
- Smart playlists with saved rules
- AirPlay device discovery
- Connection profiles
- Configurable download folder
- Open downloaded files in the default app (optional iTunes COM hook on Windows)
- Modern responsive web UI with dark/light themes
- Standalone Windows executable (no Node install required)
- About page with dedication and credits

## Roadmap
- AirPlay / Chromecast audio output
- DACP remote control
- Podcast subscriptions and auto-download
- Libre.fm scrobbling
- ReplayGain normalization

## Limitations
- iTunes 7+ / Home Sharing use proprietary authentication (`Client-DAAP-Validation`)
  that has not been publicly reverse-engineered. This client works with
  standards-compatible and legacy (pre-iTunes 7) shares where permitted.
- No DRM circumvention or unauthorized access is provided or intended.

## Run (development)
```bash
npm start
```
Then open http://localhost:8765

## Run (standalone)
Double-click `MyTunesReduxReborn.exe` (or the Desktop shortcut). It starts the local server and opens the app window.

## Test
```bash
npm test
```

## Dedication
In memory of **Bill Zeller**, creator of the original myTunes and myTunes Redux.

## Credits
Initial recreation analysis performed with **REA (Reverse Engineering Anything)**;
shout-out to **Beam Free** for assistance with analysis and rebuild planning.