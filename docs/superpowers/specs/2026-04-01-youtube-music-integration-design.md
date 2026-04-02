# YouTube Music Integration — Design Spec

## Overview

Spotaste gains multi-platform support: Spotify + YouTube Music. Users choose a platform at login, can connect the second one later, and a global toggle controls which platform's data is displayed. When both are connected, features gain a "dual personality" mode with merged data and comparative analysis.

## Decisions

- **Data source for YT Music "top tracks"**: Liked songs + listening history, ranked by frequency/recency (no official top tracks API exists)
- **ytmusicapi integration**: New Python microservice (`ytmusic-service`) on port 5002, same pattern as `audio-service`
- **Second platform connection**: Settings/accounts page (not Hub card)
- **View switching**: Global toggle in header — Spotify | YouTube Music | Both
- **Dual roast**: Comparative roast highlighting contradictions between platforms
- **Unofficial API risk accepted**: Project is personal/experimental, not commercial

---

## 1. Architecture — New `ytmusic-service` Microservice

Docker container: Flask + ytmusicapi, exposed as REST API consumed by the Node.js backend via HTTP.

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/url` | GET | Generate OAuth URL (ytmusicapi TV device flow) |
| `/auth/callback` | POST | Exchange code for token |
| `/auth/refresh` | POST | Refresh token |
| `/user/liked-songs` | GET | Paginated liked songs |
| `/user/history` | GET | Listening history |
| `/user/playlists` | GET | User's playlists |
| `/user/playlist/:id` | GET | Tracks in a playlist |
| `/search` | GET | Search tracks/artists |
| `/artist/:id` | GET | Artist info + top songs |
| `/create-playlist` | POST | Create playlist |
| `/playlist/:id/add` | POST | Add tracks to playlist |
| `/health` | GET | Health check |

Docker Compose: new service `ytmusic-service` on port 5002, alongside `audio-service` (5001) and PostgreSQL.

---

## 2. Auth — Dual Login

### Login Screen
- Two cards side by side: "Entrar com Spotify" / "Entrar com YouTube Music"
- Each initiates the respective platform's OAuth flow
- Spotify flow unchanged
- YouTube Music: backend intermediates with ytmusic-service OAuth endpoints

### Token Storage (frontend)
- `sessionStorage`:
  - `spotaste_spotify_token` — Spotify access token
  - `spotaste_ytmusic_token` — YouTube Music access token
  - `spotaste_primary_platform` — `"spotify"` or `"ytmusic"` (whichever was used at login)
- Connecting the second platform adds its token without losing the first

### Settings Page (Connected Accounts)
- Shows connection status for each platform
- Button to connect the second platform
- Button to disconnect (except primary — at least one must remain connected)

---

## 3. Database — Cross-Platform Mapping

### New Tables

```sql
-- User accounts (currently no user table exists)
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  spotify_user_id VARCHAR(128) UNIQUE,
  ytmusic_user_id VARCHAR(128) UNIQUE,
  primary_platform VARCHAR(16) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Cross-platform track mapping
CREATE TABLE track_mapping (
  id SERIAL PRIMARY KEY,
  spotify_id VARCHAR(64),
  youtube_id VARCHAR(64),
  track_name TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  matched_at TIMESTAMP DEFAULT NOW(),
  match_confidence FLOAT,
  UNIQUE(spotify_id, youtube_id)
);
```

### Schema Changes

```sql
-- track_features: support both platforms
ALTER TABLE track_features
  ADD COLUMN youtube_id VARCHAR(64),
  ADD COLUMN platform_source VARCHAR(16);

-- judge_cache: per-platform + combined
ALTER TABLE judge_cache
  ADD COLUMN platform VARCHAR(16) DEFAULT 'spotify';
```

### Track Matching Logic
- When a track is found on one platform, search for a match on the other by `track_name + artist_name` (fuzzy matching)
- `match_confidence`: exact name match = 1.0, fuzzy = 0.5-0.9
- Only use matches with confidence > 0.7
- Allows track_features to be shared cross-platform (Essentia analysis is the same audio)

---

## 4. Backend — Platform Provider Abstraction

### New module `packages/backend/src/providers/`

```
providers/
  types.ts          # MusicProvider interface
  spotify.ts        # SpotifyProvider implements MusicProvider
  ytmusic.ts        # YTMusicProvider implements MusicProvider
  combined.ts       # CombinedProvider (merges both)
```

### MusicProvider Interface

```typescript
interface Track {
  id: string              // platform-specific ID
  name: string
  artist: string
  album?: string
  imageUrl?: string
  platform: 'spotify' | 'ytmusic'
}

interface Artist {
  id: string
  name: string
  genres: string[]
  imageUrl?: string
  popularity?: number
  topTracks: Track[]
  platform: 'spotify' | 'ytmusic'
}

interface MusicProvider {
  getTopTracks(token: string, limit: number): Promise<Track[]>
  searchTracks(token: string, query: string): Promise<Track[]>
  getArtistDetails(token: string, name: string): Promise<Artist>
  createPlaylist(token: string, name: string, description: string): Promise<{id: string, url: string}>
  addTracksToPlaylist(token: string, playlistId: string, trackIds: string[]): Promise<void>
  getUserId(token: string): Promise<string>
}
```

- **SpotifyProvider**: Wraps existing `spotify.ts` functions
- **YTMusicProvider**: Calls `ytmusic-service` via HTTP. `getTopTracks()` combines liked songs + history, ranks by recency/frequency
- **CombinedProvider**: Merges both providers, deduplicates via `track_mapping`, produces unified rankings

### Request Routing
Existing endpoints receive `X-Platform: spotify | ytmusic | combined` header (derived from frontend toggle). Backend resolves which provider to use.

---

## 5. Frontend — Global Toggle + Adaptations

### Global Toggle (Header)
- Visible when at least one platform is connected
- States: `Spotify` | `YouTube Music` | `Both` (only shown when two are connected)
- Stored in `sessionStorage` as `spotaste_view_mode`
- All pages read this state and pass it as header in API requests

### Login Screen
- Two cards with platform logos and brand colors
- Spotify: green (#1DB954), YouTube Music: red (#FF0000)

### Hub
- Top artists come from the platform selected in toggle
- "Both" mode: merged artists from both platforms, deduplicated

### Julgar Perfil ("Both" mode)
- Special Claude prompt comparing both profiles
- "Dual personality" roast: highlights contradictions between platforms
- Single card layout with comparative roast

### Vibe Profile ("Both" mode)
- Top 20 combined tracks (proportional from each)
- Analysis mentions track origin

### Text to Playlist
- Creates playlist on the toggled platform (or primary if "Both")
- Matching uses tracks from both platforms in the DB

### Audio Analysis / Library
- Unified search and results regardless of toggle

### Settings Page
- "Connected Accounts" section
- Status per platform (connected/disconnected)
- Connect/disconnect buttons
- Cannot disconnect the last remaining platform

---

## 6. YouTube Music "Top Tracks" Construction

The YTMusicProvider builds a synthetic ranking:

1. Fetch **liked songs** (up to 200) from ytmusic-service
2. Fetch **listening history** (up to 200 recent) from ytmusic-service
3. Score each track: +1 per history occurrence, +5 if liked
4. Sort by score descending
5. Return top N as user's "top tracks"

This provides a reasonable proxy for musical taste — not as precise as Spotify's algorithm, but sufficient for all features.

---

## 7. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| ytmusicapi breaks (internal API changes) | Isolated microservice — disable without affecting Spotify. Feature flag in frontend. |
| ytmusicapi OAuth is unstable | Fallback: clear error message on auth failure. Spotify continues working. |
| Cross-platform match is imprecise | Fuzzy matching + confidence score. Only use matches > 0.7 confidence. |
| YouTube Data API quota (if official API used for anything) | Not using official API at all. ytmusicapi has no documented quota limits. |
| Google ToS violation | Accepted risk — personal/experimental project, non-commercial. |
