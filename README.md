# Študent naj bo!

A small static web app for playing Radio Študent `Glasbene opreme` tracklists through Spotify.

**Deployed app:** [rokroskar.github.io/student-naj-bo](https://rokroskar.github.io/student-naj-bo/)

It fetches recent music logs from [radiostudent.si/ostalo/glasbene-opreme](https://radiostudent.si/ostalo/glasbene-opreme), extracts the listed songs, matches them against Spotify, and starts playback on the user's active Spotify device.

## Features

- Mobile-first, minimalist interface
- Automatically loads recent Radio Študent music logs
- Parses multiple Radio Študent playlist formats
- Plays a whole day through Spotify
- Plays individual tracks from a day's list
- Shows current Spotify playback with previous/play-pause/next controls
- Caches Spotify search results locally to avoid repeated lookups
- Marks tracks that could not be confidently matched on Spotify

## Using the app

1. Open the deployed app.
2. Click **Connect Spotify**.
3. Select a Radio Študent day.
4. Press play on the day or on an individual track.

Spotify playback depends on Spotify's Web API and the availability of an active Spotify playback device.

## Local development

Serve the folder with any static file server:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

## Spotify configuration

This app uses Spotify Authorization Code with PKCE, so it can run as a static frontend-only app. No client secret is used.

The Spotify Client ID is configured in `app.js`:

```js
const BUILT_IN_SPOTIFY_CLIENT_ID = '...';
```

The Spotify app must include every deployment URL as a Redirect URI, for example:

```text
http://localhost:8000/
https://rokroskar.github.io/student-naj-bo/
```

## Deployment

The repository includes a GitHub Pages workflow:

```text
.github/workflows/pages.yml
```

To deploy:

1. Push the repository to GitHub.
2. Open **Settings → Pages**.
3. Set **Source** to **GitHub Actions**.
4. Push to `main` or run the workflow manually.

The site will be published at:

```text
https://rokroskar.github.io/student-naj-bo/
```

## Notes

- Radio Študent pages are fetched through the Jina reader proxy to avoid browser CORS issues.
- Spotify matching is intentionally conservative: uncertain matches are skipped rather than playing likely-wrong tracks.
- Spotify match results, including misses, are cached in browser `localStorage`.
