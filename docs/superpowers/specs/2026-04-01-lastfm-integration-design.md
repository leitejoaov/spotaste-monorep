# Last.fm Integration — Design Spec

## Overview

Last.fm becomes the primary source of listening data and a standalone entry point to the app (no Spotify required). Users enter their Last.fm username (zero friction) to access most features. Spotify becomes an optional connection for playlist creation and richer search. All 5 existing features gain deeper data from Last.fm (play counts, tags, similar artists, scrobble history).

## Decisions

- **Last.fm role**: Enrichment layer + independent login (not a replacement for Spotify)
- **YouTube Music**: Deferred — Last.fm already captures YT Music scrobbles via browser extensions
- **Auth**: Username-only (public API, no Last.fm OAuth needed)
- **Last.fm username input**: Banner on Hub + Settings page for management
- **Search without Spotify**: Last.fm `track.search` as fallback, Spotify search when available
- **No new microservice**: Last.fm is a REST API called directly from Node.js backend
- **Cache**: PostgreSQL table with TTL per cache type (6h for top data, 5min for recent, 7d for artist info)

---

## 1. Architecture

No new microservice. Last.fm is a public REST API (`https://ws.audioscrobbler.com/2.0/`) called directly from the Node.js backend using axios and the app's API key.

**New module:** `packages/backend/src/lastfm.ts` — HTTP client (same pattern as `spotify.ts`)

**Data flow:**
- Login: user types Last.fm username → backend validates with `user.getInfo` → stores username in `users` table
- Features: backend fetches Last.fm data (top tracks/artists/tags) → checks cache → enriches with Essentia from DB → Claude analyzes
- If Spotify connected: playlist creation and rich search become available

**Environment variables:**
- `LASTFM_API_KEY` — API key (free, from https://www.last.fm/api/account/create)
- `LASTFM_API_SECRET` — Shared secret (not needed for read-only, but good to have for future auth)

---

## 2. Auth & Entry

### Login Screen
- **Primary card**: "Entrar com Last.fm" — text input for username, Enter button. Backend calls `user.getInfo` to validate username exists. On success, creates user record and redirects to Hub.
- **Secondary card** (smaller): "Entrar com Spotify" — existing OAuth flow unchanged. User can connect Last.fm later in Settings.

### Token/Session (frontend)
- `sessionStorage`:
  - `spotaste_lastfm_user` — Last.fm username
  - `spotaste_spotify_token` — Spotify access token (if connected)
  - `spotaste_user_id` — Internal user ID
- Logged in = at least one of `lastfm_user` or `spotify_token` is present

### Settings (Connected Accounts)
- Shows Last.fm status (username or "not connected") with input to connect/change
- Shows Spotify status (connected/disconnected)
- Can connect/disconnect each independently
- At least one must remain active

### Hub — Connection Banner
- Entered via Spotify without Last.fm: banner "Conecte seu Last.fm pra analises mais profundas" with username input
- Entered via Last.fm without Spotify: banner "Conecte o Spotify pra criar playlists"
- Banner disappears once both are connected (or dismissed)

---

## 3. Database

### New Tables

```sql
-- User accounts (currently no user table exists)
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  lastfm_username VARCHAR(128) UNIQUE,
  spotify_user_id VARCHAR(128) UNIQUE,
  primary_platform VARCHAR(16) NOT NULL DEFAULT 'lastfm',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Last.fm API response cache
CREATE TABLE lastfm_cache (
  id SERIAL PRIMARY KEY,
  username VARCHAR(128) NOT NULL,
  cache_key VARCHAR(64) NOT NULL,
  data JSONB NOT NULL,
  cached_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(username, cache_key)
);
CREATE INDEX idx_lastfm_cache_lookup ON lastfm_cache(username, cache_key);
```

### Schema Changes

```sql
-- judge_cache: add user_id for non-Spotify users
ALTER TABLE judge_cache ADD COLUMN user_id INTEGER;

-- playlists: add user_id for non-Spotify users
ALTER TABLE playlists ADD COLUMN user_id INTEGER;
```

### Cache Strategy

| Cache Key Pattern | TTL | Example |
|-------------------|-----|---------|
| `top_artists_{period}` | 6 hours | `top_artists_3month` |
| `top_tracks_{period}` | 6 hours | `top_tracks_6month` |
| `recent_tracks` | 5 minutes | |
| `loved_tracks` | 1 hour | |
| `artist_info_{name}` | 7 days | `artist_info_radiohead` |
| `track_info_{artist}_{track}` | 7 days | |
| `user_info` | 1 day | |

Cache is checked before every Last.fm API call. Expired entries are cleaned during the worker cycle (already runs every 30s).

---

## 4. Backend — lastfm.ts

HTTP client module calling `https://ws.audioscrobbler.com/2.0/` with `LASTFM_API_KEY`. All functions check `lastfm_cache` before calling the API.

### Functions

| Function | Last.fm Method | Returns |
|----------|---------------|---------|
| `validateUser(username)` | `user.getInfo` | `{name, playcount, registered, image}` or null |
| `getTopArtists(username, period?, limit?)` | `user.getTopArtists` | `[{name, playcount, mbid, image, url}]` |
| `getTopTracks(username, period?, limit?)` | `user.getTopTracks` | `[{name, artist, playcount, mbid, image, url}]` |
| `getRecentTracks(username, limit?)` | `user.getRecentTracks` | `[{name, artist, album, date, nowplaying}]` |
| `getLovedTracks(username, limit?)` | `user.getLovedTracks` | `[{name, artist, date, url}]` |
| `getTrackInfo(artist, track, username?)` | `track.getInfo` | `{tags, listeners, playcount, duration, userplaycount}` |
| `getArtistInfo(artist)` | `artist.getInfo` | `{bio, tags, similar, stats, image}` |
| `getArtistTopTracks(artist, limit?)` | `artist.getTopTracks` | `[{name, playcount, listeners}]` |
| `getSimilarArtists(artist, limit?)` | `artist.getSimilar` | `[{name, match, image}]` |
| `searchTrack(query, limit?)` | `track.search` | `[{name, artist, listeners, url}]` |

### Parameters
- `period`: `"7day"` | `"1month"` | `"3month"` | `"6month"` | `"12month"` | `"overall"` (default: `"3month"`)
- `limit`: number (default varies, max 1000 for top data, 200 for recent)
- `username` for user.getInfo context: adds `userplaycount` and `userloved` fields to track/artist responses

### Rate Limiting
- Client-side rate limiter: max 4 requests/second to Last.fm API
- On HTTP 429: exponential backoff (1s, 2s, 4s)

---

## 5. Feature Enrichment

### 5.1 Julgar Perfil (Roast)

**Today**: Claude receives `"Artist (genre1, genre2)"` from Spotify.

**With Last.fm**: Claude receives:
```
Artist (alternative, rock, shoegaze) — 847 plays nos ultimos 3 meses
Artist2 (pop, brazilian) — 523 plays
...
Total scrobbles: 4,521 nos ultimos 3 meses
Membro desde: 2019
```

Play counts make the roast personal and quantitative. "Tu ouviu Radiohead 847 vezes em 3 meses" hits harder than "tu gosta de Radiohead".

**When both platforms connected**: prompt includes Last.fm play counts + Spotify genres (which are more structured than Last.fm tags).

### 5.2 Vibe Profile

**Today**: Claude analyzes top 20 tracks by name only.

**With Last.fm**: Claude receives per track:
- Name, artist, play count
- Last.fm tags (crowdsourced mood/genre)
- Essentia features from DB (if already analyzed)

Result: analysis combines Claude's interpretation, real audio data, AND crowdsourced genre/mood tags.

### 5.3 Audio Analysis

- **Auto-enqueue on Last.fm connect**: top tracks from Last.fm are progressively enqueued for Essentia analysis (same fire-and-forget pattern as Spotify auth callback today)
- **Search without Spotify**: `track.search` from Last.fm returns name + artist + listeners. Results show Last.fm listener count + local DB data if already analyzed.
- **Search with Spotify**: Spotify search (better results, album art) with Last.fm data overlaid

### 5.4 Text to Playlist

- **Tag-boosted matching**: if the vibe description maps to Last.fm tags (e.g., "shoegaze", "chill"), tracks in the DB that have those tags get a score boost in the matching algorithm
- **Without Spotify**: generates a "virtual playlist" — ranked list of tracks the user can browse but can't save to a platform. Shows a prompt to connect Spotify for full playlist creation.
- **With Spotify**: existing flow unchanged + tag boost in matching

### 5.5 Artist Modal

**Today**: top 10 tracks + genres from Spotify.

**With Last.fm adds**:
- Artist bio (wiki summary)
- Tags (more granular than Spotify genres)
- Similar artists with similarity score (0-1)
- Global stats (total listeners, total plays)
- User's personal play count for this artist (if Last.fm connected)

**Data source priority**: Spotify for top tracks + images (if connected), Last.fm for everything else. If no Spotify, Last.fm provides top tracks too (without album art).

---

## 6. Frontend Changes

### Login Page
- Two cards: Last.fm (primary, large, with username input) + Spotify (secondary, smaller, OAuth button)
- Last.fm card: input field, "Entrar" button, loading state while validating username
- Error state: "Usuario nao encontrado no Last.fm"

### Hub
- Connection banner: prompts to connect the other platform (dismissible, disappears when both connected)
- Top artists: from Last.fm if connected (with play counts shown), fallback to Spotify
- Feature cards: unchanged, but features requiring Spotify show a small badge "Requer Spotify" when Spotify not connected (only Text to Playlist creation)

### Settings Page
- "Contas Conectadas" section
- Last.fm: shows username + option to change/disconnect
- Spotify: shows connected status + connect/disconnect button
- At least one must remain connected

### All Pages
- API calls include `X-Lastfm-User` header (username) and `Authorization: Bearer` (Spotify token) when available
- Backend resolves which data source to use based on available credentials

---

## 7. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Last.fm album/artist images often empty (known issue since ~2020) | Use Spotify images when connected; fall back to local DB or placeholder |
| Rate limit 5 req/s | Aggressive PostgreSQL caching + client-side rate limiter |
| User doesn't have Last.fm | Spotify flow works exactly as today, zero degradation |
| Last.fm tags are crowdsourced (inconsistent) | Use as enrichment signal, not sole source of truth |
| Invalid username | Validate with `user.getInfo` on login, clear error message |
| Last.fm API downtime | Cache serves stale data on API errors (graceful degradation) |
| Privacy (Last.fm profiles can be private) | If `user.getInfo` returns error, show message asking user to make profile public |
