# YouTube Music Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add YouTube Music as an alternative platform alongside Spotify, with dual login, cross-platform track mapping, global view toggle, and comparative "dual personality" roast.

**Architecture:** New `ytmusic-service` Flask microservice wraps ytmusicapi (Python). Backend adds a `MusicProvider` abstraction layer so endpoints work with either platform. Frontend gains a platform toggle in the header and a settings page for managing connections. Database gets a `users` table, `track_mapping` table, and platform-aware columns.

**Tech Stack:** ytmusicapi (Python), Flask, Docker, Express/Node.js, React, PostgreSQL, Tailwind CSS

---

## File Structure

### New Files

```
ytmusic-service/
  app.py                          # Flask REST API wrapping ytmusicapi
  requirements.txt                # ytmusicapi, flask, gunicorn
  Dockerfile                      # Python 3.11 + deps

db/
  migrate_004_multiplatform.sql   # users, track_mapping, alter track_features/judge_cache

packages/backend/src/
  providers/
    types.ts                      # MusicProvider interface, Track, Artist types
    spotify.ts                    # SpotifyProvider (wraps existing spotify.ts)
    ytmusic.ts                    # YTMusicProvider (HTTP client to ytmusic-service)
    combined.ts                   # CombinedProvider (merge + dedup)
    index.ts                      # Factory: getProvider(platform)
  routes/
    auth-ytmusic.ts               # YouTube Music device code OAuth routes
    settings.ts                   # Connected accounts API routes
  users.ts                        # User creation, linking, lookup

packages/frontend/src/
  context/
    PlatformContext.tsx            # React context: tokens, platform, toggle state
  components/
    PlatformToggle.tsx            # Global header toggle (Spotify | YT Music | Both)
    YTMusicButton.tsx             # Login button for YouTube Music
    DeviceCodeModal.tsx           # Modal showing verification URL + code
  pages/
    Settings.tsx                  # Connected accounts management page
```

### Modified Files

```
docker-compose.yml                             # Add ytmusic-service
packages/backend/src/config.ts                 # Add YTMUSIC_SERVICE_URL, GOOGLE_CLIENT_ID/SECRET
packages/backend/src/index.ts                  # Mount new routes, resolve provider from header
packages/backend/src/routes/auth.ts            # Adapt for multi-platform user creation
packages/backend/src/db.ts                     # Add new queries (users, track_mapping)
packages/backend/src/judge.ts                  # Add dual personality prompt
packages/backend/src/worker.ts                 # Process youtube tracks too
packages/frontend/src/App.tsx                  # Add PlatformProvider, Settings route
packages/frontend/src/hooks/useAuth.ts         # Multi-token management
packages/frontend/src/pages/Login.tsx          # Dual login cards
packages/frontend/src/pages/AuthCallback.tsx   # Handle both platforms
packages/frontend/src/pages/Hub.tsx            # Use platform context
packages/frontend/src/pages/Judge.tsx          # Dual personality mode
packages/frontend/src/pages/TasteAnalysis.tsx  # Use platform context
packages/frontend/src/pages/AudioFeatures.tsx  # Use platform context
packages/frontend/src/pages/TextToPlaylist.tsx # Use platform context
packages/frontend/src/pages/PlaylistHistory.tsx# Use platform context
packages/frontend/src/pages/Library.tsx        # No auth change needed
packages/frontend/src/components/Sidebar.tsx   # Add Settings link, platform indicator
packages/frontend/src/components/ArtistModal.tsx # Use platform context
packages/frontend/src/components/SpotifyButton.tsx # Minor style alignment
.env.example                                   # Add new env vars
```

---

## Task 1: Database Migration — Multi-Platform Support

**Files:**
- Create: `db/migrate_004_multiplatform.sql`
- Modify: `packages/backend/src/db.ts`

- [ ] **Step 1: Write the migration SQL**

Create `db/migrate_004_multiplatform.sql`:

```sql
-- Users table (app-level identity, links platform accounts)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  spotify_user_id VARCHAR(128) UNIQUE,
  ytmusic_user_id VARCHAR(128) UNIQUE,
  primary_platform VARCHAR(16) NOT NULL DEFAULT 'spotify',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Cross-platform track mapping
CREATE TABLE IF NOT EXISTS track_mapping (
  id SERIAL PRIMARY KEY,
  spotify_id VARCHAR(64),
  youtube_id VARCHAR(64),
  track_name TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  matched_at TIMESTAMP DEFAULT NOW(),
  match_confidence REAL DEFAULT 1.0,
  UNIQUE(spotify_id, youtube_id)
);
CREATE INDEX IF NOT EXISTS idx_track_mapping_spotify ON track_mapping(spotify_id);
CREATE INDEX IF NOT EXISTS idx_track_mapping_youtube ON track_mapping(youtube_id);

-- Add youtube_id to track_features
DO $$ BEGIN
  ALTER TABLE track_features ADD COLUMN youtube_id TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE track_features ADD COLUMN platform_source VARCHAR(16) DEFAULT 'spotify';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_track_features_youtube ON track_features(youtube_id);

-- Add platform to judge_cache
DO $$ BEGIN
  ALTER TABLE judge_cache ADD COLUMN platform VARCHAR(16) DEFAULT 'spotify';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Drop the old PK constraint on judge_cache so we can cache per platform
-- judge_cache currently has user_spotify_id as PK; we need (user_id, platform) composite
-- First create new table structure, migrate data
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'judge_cache' AND column_name = 'user_id') THEN

    ALTER TABLE judge_cache ADD COLUMN user_id INTEGER;
    ALTER TABLE judge_cache DROP CONSTRAINT IF EXISTS judge_cache_pkey;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_judge_cache_user_platform
      ON judge_cache(user_id, platform, artists_hash);
  END IF;
END $$;

-- Playlists: add user_id column alongside user_spotify_id
DO $$ BEGIN
  ALTER TABLE playlists ADD COLUMN user_id INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE playlists ADD COLUMN platform VARCHAR(16) DEFAULT 'spotify';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
```

- [ ] **Step 2: Add migration loading to db.ts**

In `packages/backend/src/db.ts`, find the section that loads migrations (near `initDb()`). Add migration 004 to the list:

```typescript
// Inside initDb(), after migrate_003:
const migrate004 = path.join(migrationsDir, "migrate_004_multiplatform.sql");
if (fs.existsSync(migrate004)) {
  await pool.query(fs.readFileSync(migrate004, "utf-8"));
  console.log("Migration 004 applied (multiplatform)");
}
```

- [ ] **Step 3: Add new DB query functions to db.ts**

Add these functions to `packages/backend/src/db.ts`:

```typescript
// ============ USERS ============

export interface User {
  id: number;
  spotify_user_id: string | null;
  ytmusic_user_id: string | null;
  primary_platform: string;
  created_at: string;
}

export async function findOrCreateUser(
  platform: "spotify" | "ytmusic",
  platformUserId: string
): Promise<User> {
  const col = platform === "spotify" ? "spotify_user_id" : "ytmusic_user_id";
  // Try to find existing
  const existing = await pool.query(
    `SELECT * FROM users WHERE ${col} = $1`,
    [platformUserId]
  );
  if (existing.rows.length > 0) return existing.rows[0];
  // Create new
  const result = await pool.query(
    `INSERT INTO users (${col}, primary_platform) VALUES ($1, $2) RETURNING *`,
    [platformUserId, platform]
  );
  return result.rows[0];
}

export async function linkPlatform(
  userId: number,
  platform: "spotify" | "ytmusic",
  platformUserId: string
): Promise<User> {
  const col = platform === "spotify" ? "spotify_user_id" : "ytmusic_user_id";
  const result = await pool.query(
    `UPDATE users SET ${col} = $1 WHERE id = $2 RETURNING *`,
    [platformUserId, userId]
  );
  return result.rows[0];
}

export async function getUserById(userId: number): Promise<User | null> {
  const result = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
  return result.rows[0] || null;
}

export async function getUserByPlatformId(
  platform: "spotify" | "ytmusic",
  platformUserId: string
): Promise<User | null> {
  const col = platform === "spotify" ? "spotify_user_id" : "ytmusic_user_id";
  const result = await pool.query(
    `SELECT * FROM users WHERE ${col} = $1`,
    [platformUserId]
  );
  return result.rows[0] || null;
}

// ============ TRACK MAPPING ============

export async function findTrackMapping(
  platform: "spotify" | "youtube",
  trackId: string
): Promise<{ spotify_id: string | null; youtube_id: string | null } | null> {
  const col = platform === "spotify" ? "spotify_id" : "youtube_id";
  const result = await pool.query(
    `SELECT spotify_id, youtube_id FROM track_mapping WHERE ${col} = $1`,
    [trackId]
  );
  return result.rows[0] || null;
}

export async function saveTrackMapping(
  spotifyId: string | null,
  youtubeId: string | null,
  trackName: string,
  artistName: string,
  confidence: number = 1.0
): Promise<void> {
  await pool.query(
    `INSERT INTO track_mapping (spotify_id, youtube_id, track_name, artist_name, match_confidence)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (spotify_id, youtube_id) DO UPDATE SET
       match_confidence = GREATEST(track_mapping.match_confidence, $5)`,
    [spotifyId, youtubeId, trackName, artistName, confidence]
  );
}

// ============ TRACK FEATURES (youtube support) ============

export async function getTrackFeaturesByYoutubeId(
  youtubeId: string
): Promise<TrackFeatures | null> {
  const result = await pool.query(
    "SELECT * FROM track_features WHERE youtube_id = $1",
    [youtubeId]
  );
  return result.rows[0] || null;
}

export async function saveTrackFeaturesYT(
  youtubeId: string,
  trackName: string,
  artistName: string,
  features: Partial<TrackFeatures>
): Promise<void> {
  await pool.query(
    `INSERT INTO track_features
       (spotify_id, youtube_id, track_name, artist_name, bpm, key, mode,
        energy, danceability, loudness, mood_happy, mood_sad, mood_aggressive,
        mood_relaxed, mood_party, voice_instrumental, mood_acoustic, platform_source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'youtube')
     ON CONFLICT (spotify_id) DO UPDATE SET
       youtube_id = $2,
       bpm = COALESCE($5, track_features.bpm),
       mood_happy = COALESCE($11, track_features.mood_happy),
       mood_sad = COALESCE($12, track_features.mood_sad),
       mood_aggressive = COALESCE($13, track_features.mood_aggressive),
       mood_relaxed = COALESCE($14, track_features.mood_relaxed),
       mood_party = COALESCE($15, track_features.mood_party),
       voice_instrumental = COALESCE($16, track_features.voice_instrumental),
       mood_acoustic = COALESCE($17, track_features.mood_acoustic)`,
    [
      `yt_${youtubeId}`, youtubeId, trackName, artistName,
      features.bpm, features.key, features.mode,
      features.energy, features.danceability, features.loudness,
      features.mood_happy, features.mood_sad, features.mood_aggressive,
      features.mood_relaxed, features.mood_party, features.voice_instrumental,
      features.mood_acoustic,
    ]
  );
}

// ============ JUDGE CACHE (platform-aware) ============

export async function getCachedJudgeByUser(
  userId: number,
  artHash: string,
  platform: string
): Promise<string | null> {
  const result = await pool.query(
    `SELECT result_text FROM judge_cache
     WHERE user_id = $1 AND artists_hash = $2 AND platform = $3
       AND created_at > NOW() - INTERVAL '30 days'`,
    [userId, artHash, platform]
  );
  return result.rows[0]?.result_text || null;
}

export async function setCachedJudgeByUser(
  userId: number,
  artHash: string,
  platform: string,
  result: string
): Promise<void> {
  await pool.query(
    `INSERT INTO judge_cache (user_id, user_spotify_id, artists_hash, platform, result_text, created_at)
     VALUES ($1, '', $2, $3, $4, NOW())
     ON CONFLICT (user_id, platform, artists_hash) DO UPDATE SET
       result_text = $4, created_at = NOW()`,
    [userId, artHash, platform, result]
  );
}
```

- [ ] **Step 4: Test migration locally**

```bash
cd /Users/jvitorleite/Brendi/Dev/spotaste-monorep
docker compose up -d postgres
pnpm dev:backend
# Watch for: "Migration 004 applied (multiplatform)"
# Then verify tables:
docker exec -it $(docker ps -q -f name=postgres) psql -U spotaste -c "\dt"
docker exec -it $(docker ps -q -f name=postgres) psql -U spotaste -c "\d users"
docker exec -it $(docker ps -q -f name=postgres) psql -U spotaste -c "\d track_mapping"
```

- [ ] **Step 5: Commit**

```bash
git add db/migrate_004_multiplatform.sql packages/backend/src/db.ts
git commit -m "feat: add multiplatform database schema (users, track_mapping, platform columns)"
```

---

## Task 2: ytmusic-service Microservice

**Files:**
- Create: `ytmusic-service/app.py`
- Create: `ytmusic-service/requirements.txt`
- Create: `ytmusic-service/Dockerfile`

- [ ] **Step 1: Create requirements.txt**

Create `ytmusic-service/requirements.txt`:

```
flask==3.1.0
gunicorn==23.0.0
ytmusicapi==1.11.5
flask-cors==5.0.1
```

- [ ] **Step 2: Create Dockerfile**

Create `ytmusic-service/Dockerfile`:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 5002

CMD ["gunicorn", "--bind", "0.0.0.0:5002", "--timeout", "120", "app:app"]
```

- [ ] **Step 3: Create Flask app**

Create `ytmusic-service/app.py`:

```python
import json
import os
import time
import tempfile
from flask import Flask, request, jsonify
from flask_cors import CORS
from ytmusicapi import YTMusic
from ytmusicapi.auth.oauth import OAuthCredentials

app = Flask(__name__)
CORS(app)

CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")


def get_credentials():
    return OAuthCredentials(client_id=CLIENT_ID, client_secret=CLIENT_SECRET)


def get_ytmusic(token_data: dict):
    """Create an authenticated YTMusic instance from token data."""
    creds = get_credentials()
    # Write token to a temp file (ytmusicapi needs a file path or dict)
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
    json.dump(token_data, tmp)
    tmp.close()
    try:
        yt = YTMusic(tmp.name, oauth_credentials=creds)
    finally:
        os.unlink(tmp.name)
    return yt


def extract_token():
    """Extract token JSON from Authorization header (Base64 encoded) or request body."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        import base64
        try:
            token_json = base64.b64decode(auth[7:]).decode("utf-8")
            return json.loads(token_json)
        except Exception:
            return None
    return None


# ============ AUTH ============

@app.route("/auth/device-code", methods=["POST"])
def auth_device_code():
    """Start device code flow. Returns verification URL + user code."""
    creds = get_credentials()
    code_info = creds.get_code()
    return jsonify({
        "device_code": code_info["device_code"],
        "user_code": code_info["user_code"],
        "verification_url": code_info["verification_url"],
        "expires_in": code_info["expires_in"],
        "interval": code_info["interval"],
    })


@app.route("/auth/token", methods=["POST"])
def auth_token():
    """Exchange device code for token. Poll this after user authorizes."""
    device_code = request.json.get("device_code")
    if not device_code:
        return jsonify({"error": "device_code required"}), 400

    creds = get_credentials()
    try:
        token_data = creds.token_from_code(device_code)
        # Add expires_at for frontend/backend tracking
        token_data["expires_at"] = int(time.time()) + token_data.get("expires_in", 3600)
        return jsonify({"status": "complete", "token": token_data})
    except Exception as e:
        error_str = str(e)
        if "authorization_pending" in error_str.lower():
            return jsonify({"status": "pending"})
        if "slow_down" in error_str.lower():
            return jsonify({"status": "slow_down"})
        return jsonify({"status": "error", "error": error_str}), 400


@app.route("/auth/refresh", methods=["POST"])
def auth_refresh():
    """Refresh an expired token."""
    refresh_token = request.json.get("refresh_token")
    if not refresh_token:
        return jsonify({"error": "refresh_token required"}), 400

    creds = get_credentials()
    try:
        new_token = creds.refresh_token(refresh_token)
        new_token["expires_at"] = int(time.time()) + new_token.get("expires_in", 3600)
        new_token["refresh_token"] = refresh_token  # keep the refresh token
        return jsonify(new_token)
    except Exception as e:
        return jsonify({"error": str(e)}), 400


# ============ USER DATA ============

@app.route("/user/liked-songs", methods=["GET"])
def user_liked_songs():
    """Get user's liked songs."""
    token = extract_token()
    if not token:
        return jsonify({"error": "auth required"}), 401

    limit = request.args.get("limit", 200, type=int)
    yt = get_ytmusic(token)
    try:
        liked = yt.get_liked_songs(limit=limit)
        tracks = []
        for t in liked.get("tracks", []):
            if not t.get("videoId"):
                continue
            tracks.append({
                "videoId": t["videoId"],
                "title": t.get("title", ""),
                "artists": [{"name": a.get("name", ""), "id": a.get("id", "")}
                           for a in t.get("artists", [])],
                "album": {
                    "name": t.get("album", {}).get("name", "") if t.get("album") else "",
                    "id": t.get("album", {}).get("id", "") if t.get("album") else "",
                },
                "duration": t.get("duration", ""),
                "thumbnails": t.get("thumbnails", []),
                "isExplicit": t.get("isExplicit", False),
            })
        return jsonify({"tracks": tracks})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/user/history", methods=["GET"])
def user_history():
    """Get user's listening history."""
    token = extract_token()
    if not token:
        return jsonify({"error": "auth required"}), 401

    yt = get_ytmusic(token)
    try:
        history = yt.get_history()
        tracks = []
        for t in history:
            if not t.get("videoId"):
                continue
            tracks.append({
                "videoId": t["videoId"],
                "title": t.get("title", ""),
                "artists": [{"name": a.get("name", ""), "id": a.get("id", "")}
                           for a in t.get("artists", [])],
                "album": {
                    "name": t.get("album", {}).get("name", "") if t.get("album") else "",
                    "id": t.get("album", {}).get("id", "") if t.get("album") else "",
                },
                "duration": t.get("duration", ""),
                "thumbnails": t.get("thumbnails", []),
                "played": t.get("played", ""),
            })
        return jsonify({"tracks": tracks})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/user/playlists", methods=["GET"])
def user_playlists():
    """Get user's library playlists."""
    token = extract_token()
    if not token:
        return jsonify({"error": "auth required"}), 401

    yt = get_ytmusic(token)
    try:
        playlists = yt.get_library_playlists(limit=None)
        return jsonify({"playlists": playlists})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/user/playlist/<playlist_id>", methods=["GET"])
def user_playlist_tracks(playlist_id):
    """Get tracks in a specific playlist."""
    token = extract_token()
    if not token:
        return jsonify({"error": "auth required"}), 401

    limit = request.args.get("limit", 200, type=int)
    yt = get_ytmusic(token)
    try:
        playlist = yt.get_playlist(playlist_id, limit=limit)
        tracks = []
        for t in playlist.get("tracks", []):
            if not t.get("videoId"):
                continue
            tracks.append({
                "videoId": t["videoId"],
                "title": t.get("title", ""),
                "artists": [{"name": a.get("name", ""), "id": a.get("id", "")}
                           for a in t.get("artists", [])],
                "album": {
                    "name": t.get("album", {}).get("name", "") if t.get("album") else "",
                    "id": t.get("album", {}).get("id", "") if t.get("album") else "",
                },
                "duration": t.get("duration", ""),
                "thumbnails": t.get("thumbnails", []),
            })
        return jsonify({
            "id": playlist.get("id"),
            "title": playlist.get("title"),
            "trackCount": playlist.get("trackCount"),
            "tracks": tracks,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ============ SEARCH ============

@app.route("/search", methods=["GET"])
def search():
    """Search YouTube Music for songs/artists."""
    token = extract_token()
    query = request.args.get("q", "")
    filter_type = request.args.get("filter", "songs")  # songs, artists, albums
    limit = request.args.get("limit", 10, type=int)

    if not query:
        return jsonify({"results": []})

    # Unauthenticated search works too
    if token:
        yt = get_ytmusic(token)
    else:
        yt = YTMusic()

    try:
        results = yt.search(query, filter=filter_type, limit=limit)
        formatted = []
        for r in results:
            if filter_type == "songs":
                formatted.append({
                    "videoId": r.get("videoId"),
                    "title": r.get("title", ""),
                    "artists": [{"name": a.get("name", ""), "id": a.get("id", "")}
                               for a in r.get("artists", [])],
                    "album": {
                        "name": r.get("album", {}).get("name", "") if r.get("album") else "",
                    },
                    "duration": r.get("duration", ""),
                    "thumbnails": r.get("thumbnails", []),
                })
            elif filter_type == "artists":
                formatted.append({
                    "browseId": r.get("browseId"),
                    "name": r.get("artist", ""),
                    "thumbnails": r.get("thumbnails", []),
                })
        return jsonify({"results": formatted})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ============ ARTIST ============

@app.route("/artist/<channel_id>", methods=["GET"])
def artist_details(channel_id):
    """Get artist info including top songs."""
    token = extract_token()
    if token:
        yt = get_ytmusic(token)
    else:
        yt = YTMusic()

    try:
        artist = yt.get_artist(channel_id)
        songs = []
        for s in artist.get("songs", {}).get("results", []):
            songs.append({
                "videoId": s.get("videoId"),
                "title": s.get("title", ""),
                "album": s.get("album", ""),
                "thumbnails": s.get("thumbnails", []),
            })

        related = []
        for r in artist.get("related", {}).get("results", []):
            related.append({
                "browseId": r.get("browseId"),
                "name": r.get("title", ""),
                "subscribers": r.get("subscribers", ""),
            })

        return jsonify({
            "name": artist.get("name", ""),
            "channelId": artist.get("channelId", channel_id),
            "description": artist.get("description", ""),
            "subscribers": artist.get("subscribers", ""),
            "thumbnails": artist.get("thumbnails", []),
            "topSongs": songs,
            "related": related,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ============ SEARCH ARTIST BY NAME ============

@app.route("/artist-by-name", methods=["GET"])
def artist_by_name():
    """Search for an artist by name and return details."""
    name = request.args.get("name", "")
    if not name:
        return jsonify({"error": "name required"}), 400

    token = extract_token()
    yt = get_ytmusic(token) if token else YTMusic()

    try:
        results = yt.search(name, filter="artists", limit=1)
        if not results:
            return jsonify({"error": "artist not found"}), 404

        browse_id = results[0].get("browseId")
        if not browse_id:
            return jsonify({"error": "artist not found"}), 404

        artist = yt.get_artist(browse_id)
        songs = []
        for s in artist.get("songs", {}).get("results", []):
            songs.append({
                "videoId": s.get("videoId"),
                "title": s.get("title", ""),
                "album": s.get("album", ""),
                "thumbnails": s.get("thumbnails", []),
            })

        return jsonify({
            "name": artist.get("name", ""),
            "channelId": artist.get("channelId", browse_id),
            "description": artist.get("description", ""),
            "subscribers": artist.get("subscribers", ""),
            "thumbnails": artist.get("thumbnails", []),
            "topSongs": songs,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ============ PLAYLIST MANAGEMENT ============

@app.route("/create-playlist", methods=["POST"])
def create_playlist():
    """Create a new playlist."""
    token = extract_token()
    if not token:
        return jsonify({"error": "auth required"}), 401

    data = request.json or {}
    title = data.get("title", "Untitled")
    description = data.get("description", "")
    video_ids = data.get("videoIds", [])

    yt = get_ytmusic(token)
    try:
        playlist_id = yt.create_playlist(
            title=title,
            description=description,
            privacy_status="PRIVATE",
            video_ids=video_ids if video_ids else None,
        )
        # playlist_id is a string on success
        if isinstance(playlist_id, str):
            return jsonify({
                "id": playlist_id,
                "url": f"https://music.youtube.com/playlist?list={playlist_id}",
            })
        return jsonify({"error": "Failed to create playlist", "details": playlist_id}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/playlist/<playlist_id>/add", methods=["POST"])
def add_to_playlist(playlist_id):
    """Add tracks to a playlist."""
    token = extract_token()
    if not token:
        return jsonify({"error": "auth required"}), 401

    data = request.json or {}
    video_ids = data.get("videoIds", [])

    if not video_ids:
        return jsonify({"error": "videoIds required"}), 400

    yt = get_ytmusic(token)
    try:
        result = yt.add_playlist_items(playlistId=playlist_id, videoIds=video_ids)
        return jsonify({"status": "ok", "result": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ============ HEALTH ============

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "ytmusic-service"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5002, debug=True)
```

- [ ] **Step 4: Test the service locally**

```bash
cd ytmusic-service
docker build -t ytmusic-service .
docker run --rm -p 5002:5002 \
  -e GOOGLE_CLIENT_ID="test" \
  -e GOOGLE_CLIENT_SECRET="test" \
  ytmusic-service

# In another terminal:
curl http://127.0.0.1:5002/health
# Expected: {"service":"ytmusic-service","status":"ok"}
```

- [ ] **Step 5: Commit**

```bash
git add ytmusic-service/
git commit -m "feat: add ytmusic-service microservice (Flask + ytmusicapi)"
```

---

## Task 3: Docker Compose Update

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example` (or `.env`)

- [ ] **Step 1: Add ytmusic-service to docker-compose.yml**

Add the new service to `docker-compose.yml`:

```yaml
  ytmusic-service:
    build: ./ytmusic-service
    ports:
      - "5002:5002"
    environment:
      - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
      - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
```

- [ ] **Step 2: Add new env vars to .env.example**

Append to `.env.example` (or `.env`):

```
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
YTMUSIC_SERVICE_URL=http://127.0.0.1:5002
```

- [ ] **Step 3: Update config.ts**

Add to `packages/backend/src/config.ts`:

```typescript
export const config = {
  // ... existing ...
  ytmusicServiceUrl: process.env.YTMUSIC_SERVICE_URL || "http://127.0.0.1:5002",
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  },
};
```

- [ ] **Step 4: Test full stack startup**

```bash
docker compose up -d --build
curl http://127.0.0.1:5002/health
curl http://127.0.0.1:5001/health
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml .env.example packages/backend/src/config.ts
git commit -m "feat: add ytmusic-service to Docker Compose and config"
```

---

## Task 4: Backend — MusicProvider Interface & Types

**Files:**
- Create: `packages/backend/src/providers/types.ts`

- [ ] **Step 1: Define shared types and provider interface**

Create `packages/backend/src/providers/types.ts`:

```typescript
export type Platform = "spotify" | "ytmusic" | "combined";

export interface ProviderTrack {
  id: string;             // platform-specific ID (spotify_id or videoId)
  name: string;
  artist: string;
  album: string;
  imageUrl: string;
  platform: "spotify" | "ytmusic";
}

export interface ProviderArtist {
  id: string;
  name: string;
  genres: string[];
  imageUrl: string;
  popularity: number;
  externalUrl: string;
  topTracks: ProviderTrack[];
  platform: "spotify" | "ytmusic";
}

export interface ProviderPlaylist {
  id: string;
  url: string;
  platform: "spotify" | "ytmusic";
}

export interface MusicProvider {
  platform: "spotify" | "ytmusic";
  getUserId(token: string): Promise<string>;
  getTopTracks(token: string, limit?: number): Promise<ProviderTrack[]>;
  getTopArtists(token: string): Promise<ProviderArtist[]>;
  searchTracks(token: string, query: string, limit?: number): Promise<ProviderTrack[]>;
  getArtistDetails(token: string, name: string): Promise<ProviderArtist | null>;
  createPlaylist(
    token: string,
    userId: string,
    name: string,
    description?: string
  ): Promise<ProviderPlaylist>;
  addTracksToPlaylist(
    token: string,
    playlistId: string,
    trackIds: string[]
  ): Promise<void>;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/providers/types.ts
git commit -m "feat: define MusicProvider interface and shared types"
```

---

## Task 5: Backend — SpotifyProvider

**Files:**
- Create: `packages/backend/src/providers/spotify.ts`

- [ ] **Step 1: Implement SpotifyProvider wrapping existing spotify.ts**

Create `packages/backend/src/providers/spotify.ts`:

```typescript
import {
  MusicProvider,
  ProviderTrack,
  ProviderArtist,
  ProviderPlaylist,
} from "./types.js";
import {
  getSpotifyUserId,
  getTopArtists as spotifyTopArtists,
  getTopTracks as spotifyTopTracks,
  searchTracks as spotifySearch,
  searchArtist,
  getArtistTopTracks,
  createPlaylist as spotifyCreatePlaylist,
  addTracksToPlaylist as spotifyAddTracks,
  SpotifyTrack,
  SpotifyArtist,
} from "../spotify.js";

function toProviderTrack(t: SpotifyTrack): ProviderTrack {
  return {
    id: t.id,
    name: t.name,
    artist: t.artists.map((a) => a.name).join(", "),
    album: t.album.name,
    imageUrl: t.album.images?.[0]?.url || "",
    platform: "spotify",
  };
}

function artistToProvider(a: SpotifyArtist, topTracks: ProviderTrack[] = []): ProviderArtist {
  return {
    id: a.id,
    name: a.name,
    genres: a.genres,
    imageUrl: a.images?.[0]?.url || "",
    popularity: a.popularity,
    externalUrl: a.external_urls?.spotify || "",
    topTracks,
    platform: "spotify",
  };
}

export class SpotifyProvider implements MusicProvider {
  platform = "spotify" as const;

  async getUserId(token: string): Promise<string> {
    return getSpotifyUserId(token);
  }

  async getTopTracks(token: string, limit = 20): Promise<ProviderTrack[]> {
    const tracks = await spotifyTopTracks(token, { limit });
    return tracks.map(toProviderTrack);
  }

  async getTopArtists(token: string): Promise<ProviderArtist[]> {
    const artists = await spotifyTopArtists(token);
    return artists.map((a) => artistToProvider(a));
  }

  async searchTracks(token: string, query: string, limit = 8): Promise<ProviderTrack[]> {
    const results = await spotifySearch(token, query, limit);
    return results.map((r) => ({
      id: r.id,
      name: r.name,
      artist: r.artists.map((a) => a.name).join(", "),
      album: r.album.name,
      imageUrl: r.album.images?.[0]?.url || "",
      platform: "spotify" as const,
    }));
  }

  async getArtistDetails(token: string, name: string): Promise<ProviderArtist | null> {
    const artist = await searchArtist(token, name);
    if (!artist) return null;
    const rawTracks = await getArtistTopTracks(token, artist.id);
    const topTracks: ProviderTrack[] = rawTracks.map((t) => ({
      id: t.id,
      name: t.name,
      artist: t.artists.map((a) => a.name).join(", "),
      album: t.album.name,
      imageUrl: t.album.images?.[0]?.url || "",
      platform: "spotify" as const,
    }));
    return artistToProvider(artist, topTracks);
  }

  async createPlaylist(
    token: string,
    userId: string,
    name: string,
    description?: string
  ): Promise<ProviderPlaylist> {
    const result = await spotifyCreatePlaylist(token, userId, name, description);
    return { id: result.id, url: result.url, platform: "spotify" };
  }

  async addTracksToPlaylist(
    token: string,
    playlistId: string,
    trackIds: string[]
  ): Promise<void> {
    await spotifyAddTracks(token, playlistId, trackIds);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/providers/spotify.ts
git commit -m "feat: implement SpotifyProvider wrapping existing Spotify API client"
```

---

## Task 6: Backend — YTMusicProvider

**Files:**
- Create: `packages/backend/src/providers/ytmusic.ts`

- [ ] **Step 1: Implement YTMusicProvider as HTTP client to ytmusic-service**

Create `packages/backend/src/providers/ytmusic.ts`:

```typescript
import axios from "axios";
import { config } from "../config.js";
import {
  MusicProvider,
  ProviderTrack,
  ProviderArtist,
  ProviderPlaylist,
} from "./types.js";

const BASE_URL = config.ytmusicServiceUrl;

function authHeader(token: string) {
  // Token is the base64-encoded JSON of the OAuth token data
  return { Authorization: `Bearer ${token}` };
}

interface YTTrack {
  videoId: string;
  title: string;
  artists: { name: string; id: string }[];
  album: { name: string; id?: string };
  thumbnails: { url: string; width: number; height: number }[];
  duration?: string;
}

function toProviderTrack(t: YTTrack): ProviderTrack {
  return {
    id: t.videoId,
    name: t.title,
    artist: t.artists?.map((a) => a.name).join(", ") || "",
    album: t.album?.name || "",
    imageUrl: t.thumbnails?.[t.thumbnails.length - 1]?.url || "",
    platform: "ytmusic",
  };
}

export class YTMusicProvider implements MusicProvider {
  platform = "ytmusic" as const;

  async getUserId(token: string): Promise<string> {
    // YouTube Music doesn't have a direct "get user ID" — we derive it from
    // the token's refresh_token hash as a stable identifier
    const tokenData = JSON.parse(Buffer.from(token, "base64").toString());
    const crypto = await import("crypto");
    return crypto
      .createHash("md5")
      .update(tokenData.refresh_token || tokenData.access_token)
      .digest("hex");
  }

  async getTopTracks(token: string, limit = 20): Promise<ProviderTrack[]> {
    // YouTube Music has no "top tracks" API.
    // We build a synthetic ranking from liked songs + history.
    const [likedRes, historyRes] = await Promise.all([
      axios.get(`${BASE_URL}/user/liked-songs?limit=200`, {
        headers: authHeader(token),
      }),
      axios.get(`${BASE_URL}/user/history`, {
        headers: authHeader(token),
      }),
    ]);

    const liked: YTTrack[] = likedRes.data.tracks || [];
    const history: YTTrack[] = historyRes.data.tracks || [];

    // Score: +5 for liked, +1 per history occurrence
    const scores = new Map<string, { track: YTTrack; score: number }>();

    for (const t of liked) {
      if (!t.videoId) continue;
      const existing = scores.get(t.videoId);
      if (existing) {
        existing.score += 5;
      } else {
        scores.set(t.videoId, { track: t, score: 5 });
      }
    }

    for (const t of history) {
      if (!t.videoId) continue;
      const existing = scores.get(t.videoId);
      if (existing) {
        existing.score += 1;
      } else {
        scores.set(t.videoId, { track: t, score: 1 });
      }
    }

    // Sort by score descending, return top N
    const sorted = [...scores.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return sorted.map((s) => toProviderTrack(s.track));
  }

  async getTopArtists(token: string): Promise<ProviderArtist[]> {
    // Derive top artists from top tracks
    const topTracks = await this.getTopTracks(token, 50);
    const artistCounts = new Map<string, { name: string; count: number }>();

    for (const t of topTracks) {
      const name = t.artist.split(",")[0].trim(); // Primary artist
      const existing = artistCounts.get(name);
      if (existing) {
        existing.count++;
      } else {
        artistCounts.set(name, { name, count: 1 });
      }
    }

    const sorted = [...artistCounts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return sorted.map((a) => ({
      id: a.name, // We'll resolve browseId when needed
      name: a.name,
      genres: [],
      imageUrl: "",
      popularity: 0,
      externalUrl: "",
      topTracks: [],
      platform: "ytmusic" as const,
    }));
  }

  async searchTracks(
    token: string,
    query: string,
    limit = 8
  ): Promise<ProviderTrack[]> {
    const res = await axios.get(`${BASE_URL}/search`, {
      params: { q: query, filter: "songs", limit },
      headers: authHeader(token),
    });
    const results: YTTrack[] = res.data.results || [];
    return results.map(toProviderTrack);
  }

  async getArtistDetails(
    token: string,
    name: string
  ): Promise<ProviderArtist | null> {
    try {
      const res = await axios.get(`${BASE_URL}/artist-by-name`, {
        params: { name },
        headers: authHeader(token),
      });
      const data = res.data;
      const topTracks: ProviderTrack[] = (data.topSongs || []).map(
        (s: any) => ({
          id: s.videoId,
          name: s.title,
          artist: name,
          album: s.album || "",
          imageUrl: s.thumbnails?.[s.thumbnails.length - 1]?.url || "",
          platform: "ytmusic" as const,
        })
      );
      return {
        id: data.channelId,
        name: data.name,
        genres: [], // YT Music doesn't expose genres
        imageUrl: data.thumbnails?.[data.thumbnails.length - 1]?.url || "",
        popularity: 0,
        externalUrl: `https://music.youtube.com/channel/${data.channelId}`,
        topTracks,
        platform: "ytmusic",
      };
    } catch {
      return null;
    }
  }

  async createPlaylist(
    token: string,
    _userId: string,
    name: string,
    description?: string
  ): Promise<ProviderPlaylist> {
    const res = await axios.post(
      `${BASE_URL}/create-playlist`,
      { title: name, description: description || "", videoIds: [] },
      { headers: authHeader(token) }
    );
    return {
      id: res.data.id,
      url: res.data.url,
      platform: "ytmusic",
    };
  }

  async addTracksToPlaylist(
    token: string,
    playlistId: string,
    trackIds: string[]
  ): Promise<void> {
    await axios.post(
      `${BASE_URL}/playlist/${playlistId}/add`,
      { videoIds: trackIds },
      { headers: authHeader(token) }
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/providers/ytmusic.ts
git commit -m "feat: implement YTMusicProvider (HTTP client to ytmusic-service)"
```

---

## Task 7: Backend — CombinedProvider & Provider Factory

**Files:**
- Create: `packages/backend/src/providers/combined.ts`
- Create: `packages/backend/src/providers/index.ts`

- [ ] **Step 1: Implement CombinedProvider**

Create `packages/backend/src/providers/combined.ts`:

```typescript
import {
  MusicProvider,
  ProviderTrack,
  ProviderArtist,
  ProviderPlaylist,
} from "./types.js";

export class CombinedProvider implements MusicProvider {
  platform = "ytmusic" as const; // Doesn't matter, not used directly
  private spotify: MusicProvider;
  private ytmusic: MusicProvider;

  constructor(spotify: MusicProvider, ytmusic: MusicProvider) {
    this.spotify = spotify;
    this.ytmusic = ytmusic;
  }

  async getUserId(token: string): Promise<string> {
    // Combined mode uses spotify user ID as primary
    return this.spotify.getUserId(token);
  }

  async getTopTracks(token: string, limit = 20): Promise<ProviderTrack[]> {
    // This is called with two tokens joined — we need to split
    throw new Error("Use getTopTracksCombined() with separate tokens");
  }

  async getTopTracksCombined(
    spotifyToken: string,
    ytmusicToken: string,
    limit = 20
  ): Promise<ProviderTrack[]> {
    const half = Math.ceil(limit / 2);
    const [spotifyTracks, ytTracks] = await Promise.all([
      this.spotify.getTopTracks(spotifyToken, half),
      this.ytmusic.getTopTracks(ytmusicToken, half),
    ]);

    // Interleave and deduplicate by name+artist (case-insensitive)
    const seen = new Set<string>();
    const combined: ProviderTrack[] = [];
    const all = [...spotifyTracks, ...ytTracks];

    for (const t of all) {
      const key = `${t.name.toLowerCase()}|${t.artist.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(t);
      }
    }

    return combined.slice(0, limit);
  }

  async getTopArtistsCombined(
    spotifyToken: string,
    ytmusicToken: string
  ): Promise<ProviderArtist[]> {
    const [spotifyArtists, ytArtists] = await Promise.all([
      this.spotify.getTopArtists(spotifyToken),
      this.ytmusic.getTopArtists(ytmusicToken),
    ]);

    const seen = new Set<string>();
    const combined: ProviderArtist[] = [];

    for (const a of [...spotifyArtists, ...ytArtists]) {
      const key = a.name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(a);
      }
    }

    return combined.slice(0, 10);
  }

  async getTopArtists(token: string): Promise<ProviderArtist[]> {
    throw new Error("Use getTopArtistsCombined() with separate tokens");
  }

  async searchTracks(
    token: string,
    query: string,
    limit = 8
  ): Promise<ProviderTrack[]> {
    // Search on both platforms, merge results
    // token here should be the primary platform token
    // For combined search, we search on the primary platform
    return this.spotify.searchTracks(token, query, limit);
  }

  async searchTracksCombined(
    spotifyToken: string,
    ytmusicToken: string,
    query: string,
    limit = 8
  ): Promise<ProviderTrack[]> {
    const half = Math.ceil(limit / 2);
    const [spotifyResults, ytResults] = await Promise.all([
      this.spotify.searchTracks(spotifyToken, query, half),
      this.ytmusic.searchTracks(ytmusicToken, query, half),
    ]);

    const seen = new Set<string>();
    const combined: ProviderTrack[] = [];
    for (const t of [...spotifyResults, ...ytResults]) {
      const key = `${t.name.toLowerCase()}|${t.artist.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(t);
      }
    }
    return combined.slice(0, limit);
  }

  async getArtistDetails(
    token: string,
    name: string
  ): Promise<ProviderArtist | null> {
    return this.spotify.getArtistDetails(token, name);
  }

  async createPlaylist(
    token: string,
    userId: string,
    name: string,
    description?: string
  ): Promise<ProviderPlaylist> {
    // Create on primary platform (spotify)
    return this.spotify.createPlaylist(token, userId, name, description);
  }

  async addTracksToPlaylist(
    token: string,
    playlistId: string,
    trackIds: string[]
  ): Promise<void> {
    return this.spotify.addTracksToPlaylist(token, playlistId, trackIds);
  }
}
```

- [ ] **Step 2: Create provider factory**

Create `packages/backend/src/providers/index.ts`:

```typescript
import { Platform, MusicProvider } from "./types.js";
import { SpotifyProvider } from "./spotify.js";
import { YTMusicProvider } from "./ytmusic.js";
import { CombinedProvider } from "./combined.js";

export { Platform, MusicProvider, ProviderTrack, ProviderArtist, ProviderPlaylist } from "./types.js";
export { SpotifyProvider } from "./spotify.js";
export { YTMusicProvider } from "./ytmusic.js";
export { CombinedProvider } from "./combined.js";

const spotifyProvider = new SpotifyProvider();
const ytmusicProvider = new YTMusicProvider();
const combinedProvider = new CombinedProvider(spotifyProvider, ytmusicProvider);

export function getProvider(platform: Platform): MusicProvider {
  switch (platform) {
    case "spotify":
      return spotifyProvider;
    case "ytmusic":
      return ytmusicProvider;
    case "combined":
      return combinedProvider;
    default:
      return spotifyProvider;
  }
}

export function getCombinedProvider(): CombinedProvider {
  return combinedProvider;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/providers/
git commit -m "feat: add CombinedProvider and provider factory"
```

---

## Task 8: Backend — YouTube Music Auth Routes

**Files:**
- Create: `packages/backend/src/routes/auth-ytmusic.ts`
- Modify: `packages/backend/src/index.ts`

- [ ] **Step 1: Create YouTube Music auth router**

Create `packages/backend/src/routes/auth-ytmusic.ts`:

```typescript
import { Router } from "express";
import axios from "axios";
import { config } from "../config.js";
import { findOrCreateUser } from "../db.js";
import { YTMusicProvider } from "../providers/ytmusic.js";

const router = Router();
const ytProvider = new YTMusicProvider();

// Step 1: Start device code flow
router.post("/auth/ytmusic/start", async (_req, res) => {
  try {
    const response = await axios.post(
      `${config.ytmusicServiceUrl}/auth/device-code`
    );
    res.json(response.data);
  } catch (err: any) {
    console.error("YT Music auth start error:", err.message);
    res.status(500).json({ error: "Failed to start YouTube Music auth" });
  }
});

// Step 2: Poll for token (frontend calls this repeatedly)
router.post("/auth/ytmusic/poll", async (req, res) => {
  const { device_code } = req.body;
  if (!device_code) {
    return res.status(400).json({ error: "device_code required" });
  }

  try {
    const response = await axios.post(
      `${config.ytmusicServiceUrl}/auth/token`,
      { device_code }
    );
    const data = response.data;

    if (data.status === "complete" && data.token) {
      // Encode token as base64 for storage/transmission
      const tokenBase64 = Buffer.from(JSON.stringify(data.token)).toString(
        "base64"
      );

      // Get user ID and create/find user
      const userId = await ytProvider.getUserId(tokenBase64);
      const user = await findOrCreateUser("ytmusic", userId);

      // Get top artists for the hub (derived from top tracks)
      const topArtists = await ytProvider.getTopArtists(tokenBase64);

      return res.json({
        status: "complete",
        token: tokenBase64,
        userId: user.id,
        artists: topArtists,
      });
    }

    res.json({ status: data.status });
  } catch (err: any) {
    console.error("YT Music auth poll error:", err.message);
    res.status(500).json({ error: "Failed to poll YouTube Music auth" });
  }
});

// Refresh token
router.post("/auth/ytmusic/refresh", async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: "token required" });
  }

  try {
    const tokenData = JSON.parse(Buffer.from(token, "base64").toString());
    const response = await axios.post(
      `${config.ytmusicServiceUrl}/auth/refresh`,
      { refresh_token: tokenData.refresh_token }
    );
    const newTokenBase64 = Buffer.from(
      JSON.stringify(response.data)
    ).toString("base64");
    res.json({ token: newTokenBase64 });
  } catch (err: any) {
    console.error("YT Music refresh error:", err.message);
    res.status(500).json({ error: "Failed to refresh token" });
  }
});

export default router;
```

- [ ] **Step 2: Mount in index.ts**

In `packages/backend/src/index.ts`, add the import and mount:

```typescript
import ytmusicAuthRouter from "./routes/auth-ytmusic.js";

// After the existing auth router mount:
app.use(ytmusicAuthRouter);
```

- [ ] **Step 3: Update Spotify auth to create user records**

In `packages/backend/src/routes/auth.ts`, after `exchangeCode(code)` and `getTopArtists(accessToken)`, add user creation:

```typescript
import { findOrCreateUser } from "../db.js";
import { getSpotifyUserId } from "../spotify.js";

// Inside the callback handler, after getting accessToken:
const spotifyUserId = await getSpotifyUserId(accessToken);
const user = await findOrCreateUser("spotify", spotifyUserId);
```

The redirect URL should include the user ID:
```typescript
// Update redirect to include userId
res.redirect(
  `${config.frontendUrl}/#/auth-callback?artists=${encodeURIComponent(JSON.stringify(topArtists))}&t=${accessToken}&userId=${user.id}&platform=spotify`
);
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/routes/auth-ytmusic.ts packages/backend/src/index.ts packages/backend/src/routes/auth.ts
git commit -m "feat: add YouTube Music device code OAuth flow"
```

---

## Task 9: Backend — Settings Routes (Connect/Disconnect Platforms)

**Files:**
- Create: `packages/backend/src/routes/settings.ts`
- Modify: `packages/backend/src/index.ts`

- [ ] **Step 1: Create settings router**

Create `packages/backend/src/routes/settings.ts`:

```typescript
import { Router } from "express";
import { getUserById, linkPlatform } from "../db.js";
import { getSpotifyUserId } from "../spotify.js";
import { YTMusicProvider } from "../providers/ytmusic.js";

const router = Router();
const ytProvider = new YTMusicProvider();

// Get connected accounts status
router.get("/api/settings/accounts", async (req, res) => {
  const userId = req.headers["x-user-id"];
  if (!userId) return res.status(401).json({ error: "user ID required" });

  const user = await getUserById(Number(userId));
  if (!user) return res.status(404).json({ error: "user not found" });

  res.json({
    userId: user.id,
    spotify: {
      connected: !!user.spotify_user_id,
      userId: user.spotify_user_id,
    },
    ytmusic: {
      connected: !!user.ytmusic_user_id,
      userId: user.ytmusic_user_id,
    },
    primaryPlatform: user.primary_platform,
  });
});

// Link Spotify account to existing user
router.post("/api/settings/link-spotify", async (req, res) => {
  const userId = Number(req.headers["x-user-id"]);
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!userId || !token) {
    return res.status(400).json({ error: "userId and spotify token required" });
  }

  try {
    const spotifyUserId = await getSpotifyUserId(token);
    const user = await linkPlatform(userId, "spotify", spotifyUserId);
    res.json({ connected: true, spotifyUserId: user.spotify_user_id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Link YouTube Music account to existing user
router.post("/api/settings/link-ytmusic", async (req, res) => {
  const userId = Number(req.headers["x-user-id"]);
  const ytToken = req.headers["x-ytmusic-token"] as string;
  if (!userId || !ytToken) {
    return res.status(400).json({ error: "userId and ytmusic token required" });
  }

  try {
    const ytUserId = await ytProvider.getUserId(ytToken);
    const user = await linkPlatform(userId, "ytmusic", ytUserId);
    res.json({ connected: true, ytmusicUserId: user.ytmusic_user_id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

- [ ] **Step 2: Mount in index.ts**

```typescript
import settingsRouter from "./routes/settings.js";

app.use(settingsRouter);
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/routes/settings.ts packages/backend/src/index.ts
git commit -m "feat: add settings routes for platform account linking"
```

---

## Task 10: Backend — Refactor Endpoints to Use Providers

**Files:**
- Modify: `packages/backend/src/index.ts`

This is the largest backend task. We need to modify existing endpoints to resolve the platform from the `X-Platform` header and use the appropriate provider.

- [ ] **Step 1: Add platform resolution middleware**

Add to the top of `packages/backend/src/index.ts` (after imports):

```typescript
import { getProvider, getCombinedProvider, Platform } from "./providers/index.js";

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      platform?: Platform;
      spotifyToken?: string;
      ytmusicToken?: string;
      userId?: number;
    }
  }
}

// Platform resolution middleware
function resolvePlatform(req: express.Request, _res: express.Response, next: express.NextFunction) {
  const platform = (req.headers["x-platform"] as Platform) || "spotify";
  req.platform = platform;
  req.spotifyToken = req.headers.authorization?.replace("Bearer ", "") || "";
  req.ytmusicToken = (req.headers["x-ytmusic-token"] as string) || "";
  req.userId = req.headers["x-user-id"] ? Number(req.headers["x-user-id"]) : undefined;
  next();
}

app.use(resolvePlatform);
```

- [ ] **Step 2: Refactor /api/search-tracks endpoint**

Replace the existing search-tracks handler:

```typescript
app.get("/api/search-tracks", async (req, res) => {
  const query = req.query.q as string;
  if (!query) return res.json([]);

  try {
    const provider = getProvider(req.platform!);
    const token = req.platform === "ytmusic" ? req.ytmusicToken! : req.spotifyToken!;
    const tracks = await provider.searchTracks(token, query);
    res.json(
      tracks.map((t) => ({
        id: t.id,
        name: t.name,
        artist: t.artist,
        album: t.album,
        image: t.imageUrl,
        platform: t.platform,
      }))
    );
  } catch (err: any) {
    console.error("Search error:", err.message);
    res.status(500).json({ error: "Search failed" });
  }
});
```

- [ ] **Step 3: Refactor /api/artist-details endpoint**

Replace the existing handler:

```typescript
app.get("/api/artist-details", async (req, res) => {
  const name = req.query.name as string;
  if (!name) return res.status(400).json({ error: "name required" });

  try {
    const provider = getProvider(req.platform!);
    const token = req.platform === "ytmusic" ? req.ytmusicToken! : req.spotifyToken!;
    const artist = await provider.getArtistDetails(token, name);
    if (!artist) return res.status(404).json({ error: "Artist not found" });

    res.json({
      id: artist.id,
      name: artist.name,
      image: artist.imageUrl,
      genres: artist.genres,
      popularity: artist.popularity,
      external_url: artist.externalUrl,
      top_tracks: artist.topTracks.map((t) => ({
        id: t.id,
        name: t.name,
        artists: [{ name: t.artist }],
        album: { name: t.album, images: [{ url: t.imageUrl }] },
        external_urls: { spotify: "" },
        duration_ms: 0,
        platform: t.platform,
      })),
      platform: artist.platform,
    });
  } catch (err: any) {
    console.error("Artist details error:", err.message);
    res.status(500).json({ error: "Failed to get artist details" });
  }
});
```

- [ ] **Step 4: Refactor /api/analyze-taste endpoint**

Update to use providers for fetching top tracks:

```typescript
app.get("/api/analyze-taste", claudeLimiter, async (req, res) => {
  const token = req.platform === "ytmusic" ? req.ytmusicToken! : req.spotifyToken!;
  if (!token) return res.status(401).json({ error: "Token required" });

  try {
    const provider = getProvider(req.platform!);
    const platformUserId = await provider.getUserId(token);

    // Check cache (keyed by platform user ID)
    const cached = getCachedAnalysis(platformUserId);
    if (cached) {
      // Enrich with fresh data...
      return res.json(cached);
    }

    // Get top tracks via provider
    const topTracks = await provider.getTopTracks(token, 20);

    // Convert to format Claude expects
    const tracksForClaude = topTracks.map((t) => ({
      id: t.id,
      name: t.name,
      artists: [{ name: t.artist }],
      preview_url: null,
      album: { name: t.album, images: [{ url: t.imageUrl }] },
    }));

    const result = await analyzeTaste(tracksForClaude as any);

    // Enrich with album images + platform info
    result.tracks = result.tracks.map((t, i) => ({
      ...t,
      albumImage: topTracks[i]?.imageUrl || "",
      spotifyId: topTracks[i]?.id || "",
      platform: topTracks[i]?.platform || req.platform,
    }));

    setCachedAnalysis(platformUserId, result);
    res.json(result);
  } catch (err: any) {
    console.error("Analyze-taste error:", err.message);
    res.status(500).json({ error: "Analysis failed" });
  }
});
```

- [ ] **Step 5: Refactor /api/playlist/generate endpoint**

Update to use providers for playlist creation:

```typescript
// Inside the playlist/generate handler, replace the Spotify-specific playlist creation:
const provider = getProvider(req.platform!);
const token = req.platform === "ytmusic" ? req.ytmusicToken! : req.spotifyToken!;
const platformUserId = await provider.getUserId(token);

// ... (matching logic stays the same - uses DB track_features) ...

// Create playlist on the user's platform
let playlistResult: { id: string; url: string } | null = null;
try {
  playlistResult = await provider.createPlaylist(
    token,
    platformUserId,
    vibeProfile.playlist_name,
    description
  );
  // Add tracks
  const trackIds = topMatches.map((t) =>
    req.platform === "ytmusic" ? t.youtube_id || t.spotify_id : t.spotify_id
  );
  await provider.addTracksToPlaylist(token, playlistResult.id, trackIds.filter(Boolean));
} catch (err: any) {
  console.error("Playlist creation failed:", err.message);
  // Continue without external playlist
}
```

- [ ] **Step 6: Verify backend starts and existing Spotify flow still works**

```bash
pnpm dev:backend
# Test existing Spotify endpoints work unchanged
curl -s http://127.0.0.1:3000/health
curl -s http://127.0.0.1:3000/api/queue-status
```

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/index.ts
git commit -m "feat: refactor API endpoints to use platform providers"
```

---

## Task 11: Backend — Judge Dual Personality Prompt

**Files:**
- Modify: `packages/backend/src/judge.ts`
- Modify: `packages/backend/src/index.ts` (judge endpoint)

- [ ] **Step 1: Add dual personality analysis function to judge.ts**

Add to `packages/backend/src/judge.ts`:

```typescript
export async function getDualPersonalityAnalysis(
  spotifyArtists: { name: string; genres: string[] }[],
  ytmusicArtists: { name: string; genres: string[] }[]
): Promise<string> {
  const spotifyList = spotifyArtists
    .map((a) => `${a.name} (${a.genres.join(", ") || "sem genero"})`)
    .join("\n");
  const ytmusicList = ytmusicArtists
    .map((a) => `${a.name} (${a.genres.join(", ") || "sem genero"})`)
    .join("\n");

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2000,
    system: `Voce e um critico musical gen-z brasileiro BRUTALMENTE sincero e engraçado.
O usuario usa DUAS plataformas de musica: Spotify e YouTube Music.
Voce vai receber os artistas que ele mais ouve em CADA plataforma.
Seu trabalho e fazer um ROAST comparativo zoando as CONTRADIÇOES e a DUPLA PERSONALIDADE musical dele.
Faz piada sobre como ele e uma pessoa no Spotify e outra completamente diferente no YouTube Music.
Usa girias gen-z brasileiras (kkkkk, ne possivel, mlk, mano, vey).
Tom: zoeiro, memes, comparações absurdas.
4-5 paragrafos. Sem markdown, texto puro.
IMPORTANTE: Foca nas DIFERENÇAS entre as duas plataformas. Se forem parecidas, zoa que ele nao consegue nem ter dupla personalidade direito.`,
    messages: [
      {
        role: "user",
        content: `SPOTIFY - Top artistas:\n${spotifyList}\n\nYOUTUBE MUSIC - Top artistas:\n${ytmusicList}`,
      },
    ],
  });

  return (msg.content[0] as any).text;
}
```

- [ ] **Step 2: Update judge endpoint for combined mode**

In `packages/backend/src/index.ts`, update the `/api/judge` handler to support combined mode:

```typescript
import { getMusicTasteAnalysis, getDualPersonalityAnalysis } from "./judge.js";

// Inside the /api/judge handler:
app.post("/api/judge", claudeLimiter, async (req, res) => {
  const { artists, spotifyArtists, ytmusicArtists } = req.body;
  const platform = req.platform || "spotify";
  const userId = req.userId;

  try {
    // Combined mode: dual personality roast
    if (platform === "combined" && spotifyArtists && ytmusicArtists) {
      const hash = hashArtists([...spotifyArtists, ...ytmusicArtists]);
      if (userId) {
        const cached = await getCachedJudgeByUser(userId, hash, "combined");
        if (cached) return res.json({ analysis: cached });
      }
      const analysis = await getDualPersonalityAnalysis(spotifyArtists, ytmusicArtists);
      if (userId) {
        await setCachedJudgeByUser(userId, hash, "combined", analysis);
      }
      return res.json({ analysis });
    }

    // Single platform mode (existing logic)
    if (!artists?.length) {
      return res.status(400).json({ error: "artists required" });
    }
    const hash = hashArtists(artists);
    if (userId) {
      const cached = await getCachedJudgeByUser(userId, hash, platform);
      if (cached) return res.json({ analysis: cached });
    }
    const analysis = await getMusicTasteAnalysis(artists);
    if (userId) {
      await setCachedJudgeByUser(userId, hash, platform, analysis);
    }
    res.json({ analysis });
  } catch (err: any) {
    console.error("Judge error:", err.message);
    res.status(500).json({ error: "Failed to analyze" });
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/judge.ts packages/backend/src/index.ts
git commit -m "feat: add dual personality roast for combined platform mode"
```

---

## Task 12: Frontend — Platform Context & Token Management

**Files:**
- Create: `packages/frontend/src/context/PlatformContext.tsx`
- Modify: `packages/frontend/src/hooks/useAuth.ts`
- Modify: `packages/frontend/src/App.tsx`

- [ ] **Step 1: Create PlatformContext**

Create `packages/frontend/src/context/PlatformContext.tsx`:

```tsx
import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type Platform = "spotify" | "ytmusic" | "combined";

interface PlatformState {
  spotifyToken: string;
  ytmusicToken: string;
  userId: number | null;
  primaryPlatform: Platform;
  viewMode: Platform;
}

interface PlatformContextType extends PlatformState {
  setSpotifyToken: (token: string) => void;
  setYtmusicToken: (token: string) => void;
  setUserId: (id: number) => void;
  setPrimaryPlatform: (p: "spotify" | "ytmusic") => void;
  setViewMode: (mode: Platform) => void;
  isLoggedIn: boolean;
  hasBothPlatforms: boolean;
  activeToken: string;
  logout: () => void;
  getHeaders: () => Record<string, string>;
}

const PlatformContext = createContext<PlatformContextType | null>(null);

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlatformState>(() => ({
    spotifyToken: sessionStorage.getItem("spotaste_spotify_token") || "",
    ytmusicToken: sessionStorage.getItem("spotaste_ytmusic_token") || "",
    userId: sessionStorage.getItem("spotaste_user_id")
      ? Number(sessionStorage.getItem("spotaste_user_id"))
      : null,
    primaryPlatform:
      (sessionStorage.getItem("spotaste_primary_platform") as "spotify" | "ytmusic") || "spotify",
    viewMode:
      (sessionStorage.getItem("spotaste_view_mode") as Platform) || "spotify",
  }));

  const setSpotifyToken = useCallback((token: string) => {
    sessionStorage.setItem("spotaste_spotify_token", token);
    setState((s) => ({ ...s, spotifyToken: token }));
  }, []);

  const setYtmusicToken = useCallback((token: string) => {
    sessionStorage.setItem("spotaste_ytmusic_token", token);
    setState((s) => ({ ...s, ytmusicToken: token }));
  }, []);

  const setUserId = useCallback((id: number) => {
    sessionStorage.setItem("spotaste_user_id", String(id));
    setState((s) => ({ ...s, userId: id }));
  }, []);

  const setPrimaryPlatform = useCallback((p: "spotify" | "ytmusic") => {
    sessionStorage.setItem("spotaste_primary_platform", p);
    setState((s) => ({ ...s, primaryPlatform: p, viewMode: p }));
  }, []);

  const setViewMode = useCallback((mode: Platform) => {
    sessionStorage.setItem("spotaste_view_mode", mode);
    setState((s) => ({ ...s, viewMode: mode }));
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem("spotaste_spotify_token");
    sessionStorage.removeItem("spotaste_ytmusic_token");
    sessionStorage.removeItem("spotaste_user_id");
    sessionStorage.removeItem("spotaste_primary_platform");
    sessionStorage.removeItem("spotaste_view_mode");
    // Keep legacy key clear too
    sessionStorage.removeItem("spotaste_token");
    setState({
      spotifyToken: "",
      ytmusicToken: "",
      userId: null,
      primaryPlatform: "spotify",
      viewMode: "spotify",
    });
  }, []);

  const isLoggedIn = !!(state.spotifyToken || state.ytmusicToken);
  const hasBothPlatforms = !!(state.spotifyToken && state.ytmusicToken);

  const activeToken =
    state.viewMode === "ytmusic" ? state.ytmusicToken : state.spotifyToken;

  const getHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = {
      "X-Platform": state.viewMode,
    };
    if (state.spotifyToken) {
      headers["Authorization"] = `Bearer ${state.spotifyToken}`;
    }
    if (state.ytmusicToken) {
      headers["X-YTMusic-Token"] = state.ytmusicToken;
    }
    if (state.userId) {
      headers["X-User-Id"] = String(state.userId);
    }
    return headers;
  }, [state]);

  return (
    <PlatformContext.Provider
      value={{
        ...state,
        setSpotifyToken,
        setYtmusicToken,
        setUserId,
        setPrimaryPlatform,
        setViewMode,
        isLoggedIn,
        hasBothPlatforms,
        activeToken,
        logout,
        getHeaders,
      }}
    >
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform() {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error("usePlatform must be used within PlatformProvider");
  return ctx;
}
```

- [ ] **Step 2: Update useAuth.ts for backward compatibility**

Replace `packages/frontend/src/hooks/useAuth.ts`:

```typescript
export function getAccessToken(): string {
  // Check new keys first, fallback to legacy
  return (
    sessionStorage.getItem("spotaste_spotify_token") ||
    sessionStorage.getItem("spotaste_token") ||
    ""
  );
}

export function clearAccessToken() {
  sessionStorage.removeItem("spotaste_spotify_token");
  sessionStorage.removeItem("spotaste_ytmusic_token");
  sessionStorage.removeItem("spotaste_user_id");
  sessionStorage.removeItem("spotaste_primary_platform");
  sessionStorage.removeItem("spotaste_view_mode");
  sessionStorage.removeItem("spotaste_token");
}
```

- [ ] **Step 3: Wrap App with PlatformProvider**

In `packages/frontend/src/App.tsx`, wrap the router content:

```tsx
import { PlatformProvider } from "./context/PlatformContext";

// In the component, wrap everything:
function App() {
  return (
    <PlatformProvider>
      {/* existing Routes and Sidebar logic */}
    </PlatformProvider>
  );
}
```

Add `/settings` route:
```tsx
import Settings from "./pages/Settings";

// Inside Routes:
<Route path="/settings" element={<Settings />} />
```

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/context/PlatformContext.tsx packages/frontend/src/hooks/useAuth.ts packages/frontend/src/App.tsx
git commit -m "feat: add PlatformContext for multi-platform state management"
```

---

## Task 13: Frontend — Dual Login Page

**Files:**
- Modify: `packages/frontend/src/pages/Login.tsx`
- Create: `packages/frontend/src/components/YTMusicButton.tsx`
- Create: `packages/frontend/src/components/DeviceCodeModal.tsx`

- [ ] **Step 1: Create YTMusicButton component**

Create `packages/frontend/src/components/YTMusicButton.tsx`:

```tsx
interface Props {
  onClick: () => void;
}

export default function YTMusicButton({ onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 bg-[#FF0000] hover:bg-[#cc0000] text-white font-bold py-3 px-6 rounded-full transition-all duration-200 hover:scale-105"
    >
      <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current">
        <path d="M12 0C5.376 0 0 5.376 0 12s5.376 12 12 12 12-5.376 12-12S18.624 0 12 0zm0 19.104c-3.924 0-7.104-3.18-7.104-7.104S8.076 4.896 12 4.896s7.104 3.18 7.104 7.104-3.18 7.104-7.104 7.104zm0-13.332c-3.432 0-6.228 2.796-6.228 6.228S8.568 18.228 12 18.228s6.228-2.796 6.228-6.228S15.432 5.772 12 5.772zM9.684 15.54V8.46L15.816 12l-6.132 3.54z" />
      </svg>
      Entrar com YouTube Music
    </button>
  );
}
```

- [ ] **Step 2: Create DeviceCodeModal component**

Create `packages/frontend/src/components/DeviceCodeModal.tsx`:

```tsx
import { useState, useEffect, useCallback } from "react";
import { Loader2, ExternalLink, Copy, Check } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "";

interface Props {
  onComplete: (token: string, userId: number, artists: any[]) => void;
  onCancel: () => void;
}

export default function DeviceCodeModal({ onComplete, onCancel }: Props) {
  const [deviceCode, setDeviceCode] = useState("");
  const [userCode, setUserCode] = useState("");
  const [verificationUrl, setVerificationUrl] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  // Start device code flow
  useEffect(() => {
    async function start() {
      try {
        const res = await fetch(`${API_URL}/auth/ytmusic/start`, {
          method: "POST",
        });
        const data = await res.json();
        setDeviceCode(data.device_code);
        setUserCode(data.user_code);
        setVerificationUrl(data.verification_url);
        setLoading(false);
      } catch (err) {
        setError("Falha ao iniciar autenticacao");
        setLoading(false);
      }
    }
    start();
  }, []);

  // Poll for completion
  useEffect(() => {
    if (!deviceCode) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/auth/ytmusic/poll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_code: deviceCode }),
        });
        const data = await res.json();
        if (data.status === "complete") {
          clearInterval(interval);
          onComplete(data.token, data.userId, data.artists);
        } else if (data.status === "error") {
          clearInterval(interval);
          setError(data.error || "Autenticacao falhou");
        }
      } catch {
        // Keep polling on network errors
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [deviceCode, onComplete]);

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [userCode]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
        <div className="bg-spotify-dark rounded-2xl p-8 max-w-md w-full mx-4 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-[#FF0000] mx-auto" />
          <p className="text-white mt-4">Preparando autenticacao...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-spotify-dark rounded-2xl p-8 max-w-md w-full mx-4">
        <h2 className="text-xl font-bold text-white mb-4 text-center">
          Conectar YouTube Music
        </h2>

        {error ? (
          <div className="text-center">
            <p className="text-red-400 mb-4">{error}</p>
            <button
              onClick={onCancel}
              className="px-6 py-2 bg-white/10 rounded-lg text-white hover:bg-white/20"
            >
              Fechar
            </button>
          </div>
        ) : (
          <>
            <p className="text-spotify-text mb-6 text-center">
              Acesse o link abaixo e digite o codigo para autorizar:
            </p>

            {/* Code display */}
            <div className="bg-black/40 rounded-xl p-4 mb-4 text-center">
              <p className="text-sm text-spotify-text mb-2">Seu codigo:</p>
              <div className="flex items-center justify-center gap-2">
                <span className="text-3xl font-mono font-bold text-white tracking-widest">
                  {userCode}
                </span>
                <button
                  onClick={copyCode}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                >
                  {copied ? (
                    <Check className="w-5 h-5 text-green-400" />
                  ) : (
                    <Copy className="w-5 h-5 text-spotify-text" />
                  )}
                </button>
              </div>
            </div>

            {/* Verification URL */}
            <a
              href={verificationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 bg-[#FF0000] hover:bg-[#cc0000] text-white font-bold py-3 px-6 rounded-full transition-all w-full mb-6"
            >
              Abrir Google
              <ExternalLink className="w-4 h-4" />
            </a>

            {/* Polling indicator */}
            <div className="flex items-center justify-center gap-2 text-spotify-text text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Aguardando autorizacao...
            </div>

            <button
              onClick={onCancel}
              className="w-full mt-4 py-2 text-spotify-text hover:text-white transition-colors text-sm"
            >
              Cancelar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update Login page with dual cards**

Modify `packages/frontend/src/pages/Login.tsx` to add YouTube Music card alongside Spotify:

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import SpotifyButton from "../components/SpotifyButton";
import YTMusicButton from "../components/YTMusicButton";
import DeviceCodeModal from "../components/DeviceCodeModal";
import { usePlatform } from "../context/PlatformContext";

// In the component:
const [showYTAuth, setShowYTAuth] = useState(false);
const navigate = useNavigate();
const { setYtmusicToken, setUserId, setPrimaryPlatform } = usePlatform();

const handleYTComplete = (token: string, userId: number, artists: any[]) => {
  setYtmusicToken(token);
  setUserId(userId);
  setPrimaryPlatform("ytmusic");
  setShowYTAuth(false);
  navigate(`/hub?artists=${encodeURIComponent(JSON.stringify(artists))}&platform=ytmusic`);
};

// In the JSX, replace the single SpotifyButton with two cards:
<div className="flex flex-col sm:flex-row gap-4 justify-center">
  {/* Spotify Card */}
  <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 flex flex-col items-center gap-4 min-w-[200px]">
    <div className="w-16 h-16 bg-[#1DB954]/20 rounded-full flex items-center justify-center">
      <svg viewBox="0 0 24 24" className="w-8 h-8 fill-[#1DB954]">
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
      </svg>
    </div>
    <SpotifyButton />
  </div>

  {/* YouTube Music Card */}
  <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 flex flex-col items-center gap-4 min-w-[200px]">
    <div className="w-16 h-16 bg-[#FF0000]/20 rounded-full flex items-center justify-center">
      <svg viewBox="0 0 24 24" className="w-8 h-8 fill-[#FF0000]">
        <path d="M12 0C5.376 0 0 5.376 0 12s5.376 12 12 12 12-5.376 12-12S18.624 0 12 0zm0 19.104c-3.924 0-7.104-3.18-7.104-7.104S8.076 4.896 12 4.896s7.104 3.18 7.104 7.104-3.18 7.104-7.104 7.104zM9.684 15.54V8.46L15.816 12l-6.132 3.54z" />
      </svg>
    </div>
    <YTMusicButton onClick={() => setShowYTAuth(true)} />
  </div>
</div>

{showYTAuth && (
  <DeviceCodeModal
    onComplete={handleYTComplete}
    onCancel={() => setShowYTAuth(false)}
  />
)}
```

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/YTMusicButton.tsx packages/frontend/src/components/DeviceCodeModal.tsx packages/frontend/src/pages/Login.tsx
git commit -m "feat: dual login page with Spotify and YouTube Music cards"
```

---

## Task 14: Frontend — Auth Callback Updates

**Files:**
- Modify: `packages/frontend/src/pages/AuthCallback.tsx`

- [ ] **Step 1: Update AuthCallback for multi-platform**

Update `packages/frontend/src/pages/AuthCallback.tsx` to handle the `platform` and `userId` params:

```tsx
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePlatform } from "../context/PlatformContext";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { setSpotifyToken, setYtmusicToken, setUserId, setPrimaryPlatform } =
    usePlatform();

  useEffect(() => {
    const token = params.get("t") || "";
    const artists = params.get("artists") || "[]";
    const userId = params.get("userId");
    const platform = params.get("platform") || "spotify";

    if (token) {
      if (platform === "ytmusic") {
        setYtmusicToken(token);
      } else {
        setSpotifyToken(token);
        // Also set legacy key for backward compat
        sessionStorage.setItem("spotaste_token", token);
      }
      setPrimaryPlatform(platform as "spotify" | "ytmusic");
      if (userId) setUserId(Number(userId));
    }

    navigate(`/hub?artists=${encodeURIComponent(artists)}&platform=${platform}`);
  }, []);

  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/pages/AuthCallback.tsx
git commit -m "feat: update AuthCallback for multi-platform token handling"
```

---

## Task 15: Frontend — Global Platform Toggle

**Files:**
- Create: `packages/frontend/src/components/PlatformToggle.tsx`
- Modify: `packages/frontend/src/App.tsx` (or wherever the header/layout lives)

- [ ] **Step 1: Create PlatformToggle component**

Create `packages/frontend/src/components/PlatformToggle.tsx`:

```tsx
import { usePlatform, Platform } from "../context/PlatformContext";

export default function PlatformToggle() {
  const { viewMode, setViewMode, spotifyToken, ytmusicToken, hasBothPlatforms } =
    usePlatform();

  if (!spotifyToken && !ytmusicToken) return null;

  const options: { value: Platform; label: string; color: string }[] = [];

  if (spotifyToken) {
    options.push({ value: "spotify", label: "Spotify", color: "bg-[#1DB954]" });
  }
  if (ytmusicToken) {
    options.push({ value: "ytmusic", label: "YT Music", color: "bg-[#FF0000]" });
  }
  if (hasBothPlatforms) {
    options.push({ value: "combined", label: "Ambos", color: "bg-purple-500" });
  }

  if (options.length <= 1) return null;

  return (
    <div className="flex items-center bg-white/5 rounded-full p-1 gap-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setViewMode(opt.value)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
            viewMode === opt.value
              ? `${opt.color} text-white shadow-lg`
              : "text-spotify-text hover:text-white hover:bg-white/10"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add toggle to the app layout**

In `packages/frontend/src/App.tsx`, add the toggle to the header area (alongside Sidebar). The exact placement depends on the current layout, but it should appear in a fixed header bar:

```tsx
import PlatformToggle from "./components/PlatformToggle";

// In the layout, add PlatformToggle next to the sidebar toggle or in a fixed header:
{isLoggedIn && <PlatformToggle />}
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/PlatformToggle.tsx packages/frontend/src/App.tsx
git commit -m "feat: add global platform toggle component"
```

---

## Task 16: Frontend — Settings Page (Connected Accounts)

**Files:**
- Create: `packages/frontend/src/pages/Settings.tsx`
- Modify: `packages/frontend/src/components/Sidebar.tsx`

- [ ] **Step 1: Create Settings page**

Create `packages/frontend/src/pages/Settings.tsx`:

```tsx
import { useState, useEffect } from "react";
import { ArrowLeft, Check, Link, Unlink } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePlatform } from "../context/PlatformContext";
import DeviceCodeModal from "../components/DeviceCodeModal";

const API_URL = import.meta.env.VITE_API_URL || "";

export default function Settings() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const hubData = params.get("hubData") || "";
  const platform = usePlatform();
  const [showYTAuth, setShowYTAuth] = useState(false);
  const [linking, setLinking] = useState(false);

  const handleLinkYTMusic = (token: string, _userId: number) => {
    platform.setYtmusicToken(token);
    setShowYTAuth(false);

    // Tell backend to link accounts
    fetch(`${API_URL}/api/settings/link-ytmusic`, {
      method: "POST",
      headers: {
        ...platform.getHeaders(),
        "Content-Type": "application/json",
        "X-YTMusic-Token": token,
      },
    });
  };

  const handleLinkSpotify = () => {
    // Redirect to Spotify OAuth — on callback, we link to existing user
    sessionStorage.setItem("spotaste_linking", "true");
    window.location.href = `${API_URL}/auth/login`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-spotify-dark to-black p-4 sm:p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <button
          onClick={() => navigate(`/hub?${hubData ? `hubData=${hubData}` : ""}`)}
          className="flex items-center gap-2 text-spotify-text hover:text-white mb-8 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          Voltar
        </button>

        <h1 className="text-2xl font-bold text-white mb-8">Configuracoes</h1>

        {/* Connected Accounts */}
        <div className="bg-white/5 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-6">
            Contas Conectadas
          </h2>

          {/* Spotify */}
          <div className="flex items-center justify-between p-4 bg-black/20 rounded-xl mb-3">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                platform.spotifyToken ? "bg-[#1DB954]/20" : "bg-white/5"
              }`}>
                <svg viewBox="0 0 24 24" className={`w-5 h-5 ${
                  platform.spotifyToken ? "fill-[#1DB954]" : "fill-gray-500"
                }`}>
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                </svg>
              </div>
              <div>
                <p className="text-white font-medium">Spotify</p>
                <p className="text-spotify-text text-sm">
                  {platform.spotifyToken ? "Conectado" : "Nao conectado"}
                </p>
              </div>
            </div>
            {platform.spotifyToken ? (
              <Check className="w-5 h-5 text-[#1DB954]" />
            ) : (
              <button
                onClick={handleLinkSpotify}
                className="flex items-center gap-2 px-4 py-2 bg-[#1DB954] hover:bg-[#1ed760] rounded-full text-white text-sm font-medium transition-colors"
              >
                <Link className="w-4 h-4" />
                Conectar
              </button>
            )}
          </div>

          {/* YouTube Music */}
          <div className="flex items-center justify-between p-4 bg-black/20 rounded-xl">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                platform.ytmusicToken ? "bg-[#FF0000]/20" : "bg-white/5"
              }`}>
                <svg viewBox="0 0 24 24" className={`w-5 h-5 ${
                  platform.ytmusicToken ? "fill-[#FF0000]" : "fill-gray-500"
                }`}>
                  <path d="M12 0C5.376 0 0 5.376 0 12s5.376 12 12 12 12-5.376 12-12S18.624 0 12 0zm0 19.104c-3.924 0-7.104-3.18-7.104-7.104S8.076 4.896 12 4.896s7.104 3.18 7.104 7.104-3.18 7.104-7.104 7.104zM9.684 15.54V8.46L15.816 12l-6.132 3.54z" />
                </svg>
              </div>
              <div>
                <p className="text-white font-medium">YouTube Music</p>
                <p className="text-spotify-text text-sm">
                  {platform.ytmusicToken ? "Conectado" : "Nao conectado"}
                </p>
              </div>
            </div>
            {platform.ytmusicToken ? (
              <Check className="w-5 h-5 text-[#FF0000]" />
            ) : (
              <button
                onClick={() => setShowYTAuth(true)}
                className="flex items-center gap-2 px-4 py-2 bg-[#FF0000] hover:bg-[#cc0000] rounded-full text-white text-sm font-medium transition-colors"
              >
                <Link className="w-4 h-4" />
                Conectar
              </button>
            )}
          </div>
        </div>

        {/* Info */}
        {platform.hasBothPlatforms && (
          <p className="text-spotify-text text-sm mt-4 text-center">
            Com as duas plataformas conectadas, use o toggle no topo pra alternar entre Spotify, YouTube Music ou visualizacao combinada.
          </p>
        )}
      </div>

      {showYTAuth && (
        <DeviceCodeModal
          onComplete={handleLinkYTMusic}
          onCancel={() => setShowYTAuth(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add Settings to Sidebar**

In `packages/frontend/src/components/Sidebar.tsx`, add a Settings navigation item:

```tsx
// Add to the navigation items array (before the logout button):
{ path: "/settings", label: "Configuracoes", icon: Settings } // import Settings from lucide-react
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/pages/Settings.tsx packages/frontend/src/components/Sidebar.tsx
git commit -m "feat: add Settings page with connected accounts management"
```

---

## Task 17: Frontend — Hub & Page Adaptations

**Files:**
- Modify: `packages/frontend/src/pages/Hub.tsx`
- Modify: `packages/frontend/src/pages/Judge.tsx`
- Modify: `packages/frontend/src/pages/TasteAnalysis.tsx`
- Modify: `packages/frontend/src/pages/AudioFeatures.tsx`
- Modify: `packages/frontend/src/pages/TextToPlaylist.tsx`
- Modify: `packages/frontend/src/pages/PlaylistHistory.tsx`
- Modify: `packages/frontend/src/components/ArtistModal.tsx`

- [ ] **Step 1: Update Hub to use platform context**

In `packages/frontend/src/pages/Hub.tsx`:

```tsx
import { usePlatform } from "../context/PlatformContext";

// In the component:
const { logout, viewMode } = usePlatform();

// Replace the logout handler with:
const handleLogout = () => {
  logout();
  navigate("/");
};
```

- [ ] **Step 2: Update all pages to pass platform headers in API calls**

In every page that makes API calls, import and use `usePlatform()`:

```tsx
import { usePlatform } from "../context/PlatformContext";

// In each component:
const { getHeaders, activeToken } = usePlatform();

// Replace all fetch calls to add headers. Example for Judge.tsx:
const res = await fetch(`${API_URL}/api/judge`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...getHeaders(),
  },
  body: JSON.stringify({ artists }),
});
```

Apply this pattern to:
- `Judge.tsx`: POST `/api/judge` — add `getHeaders()`
- `TasteAnalysis.tsx`: GET `/api/analyze-taste` — replace `Authorization` with `getHeaders()`
- `AudioFeatures.tsx`: GET `/api/search-tracks`, POST `/api/enqueue-track`, GET `/api/track-status` — add `getHeaders()`
- `TextToPlaylist.tsx`: POST `/api/playlist/generate` — add `getHeaders()`
- `PlaylistHistory.tsx`: GET `/api/playlist/history`, GET `/api/playlist/:id`, POST `/api/playlist/:id/rate` — add `getHeaders()`
- `ArtistModal.tsx`: GET `/api/artist-details` — add `getHeaders()`

- [ ] **Step 3: Update Judge.tsx for dual personality mode**

In `packages/frontend/src/pages/Judge.tsx`, add combined mode support:

```tsx
const { viewMode, getHeaders } = usePlatform();

// When viewMode === "combined", send both platform artists:
const body =
  viewMode === "combined"
    ? { spotifyArtists: artists, ytmusicArtists: ytArtists }
    : { artists };

const res = await fetch(`${API_URL}/api/judge`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...getHeaders() },
  body: JSON.stringify(body),
});
```

The `ytArtists` would need to be fetched from the YT Music provider when in combined mode. Add this to the useEffect:

```tsx
// If combined mode, also fetch YT Music top artists
if (viewMode === "combined" && ytmusicToken) {
  const ytRes = await fetch(`${API_URL}/api/top-artists`, {
    headers: { ...getHeaders(), "X-Platform": "ytmusic" },
  });
  const ytData = await ytRes.json();
  setYtArtists(ytData.artists);
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/pages/ packages/frontend/src/components/ArtistModal.tsx
git commit -m "feat: update all pages to use platform context and headers"
```

---

## Task 18: Backend — Top Artists Endpoint

**Files:**
- Modify: `packages/backend/src/index.ts`

- [ ] **Step 1: Add /api/top-artists endpoint**

The frontend needs a way to fetch top artists for a given platform (especially for YT Music mode and combined mode). Add:

```typescript
app.get("/api/top-artists", async (req, res) => {
  try {
    const provider = getProvider(req.platform!);
    const token =
      req.platform === "ytmusic" ? req.ytmusicToken! : req.spotifyToken!;
    if (!token) return res.status(401).json({ error: "Token required" });

    const artists = await provider.getTopArtists(token);
    res.json({ artists });
  } catch (err: any) {
    console.error("Top artists error:", err.message);
    res.status(500).json({ error: "Failed to get top artists" });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/index.ts
git commit -m "feat: add /api/top-artists endpoint for platform-agnostic artist fetching"
```

---

## Task 19: Backend — Worker YouTube Track Support

**Files:**
- Modify: `packages/backend/src/worker.ts`
- Modify: `packages/backend/src/db.ts`

- [ ] **Step 1: Update queue to support youtube tracks**

In `packages/backend/src/db.ts`, update `addToQueue` to accept a platform parameter:

```typescript
export async function addToQueue(
  trackId: string,
  trackName: string,
  artistName: string,
  platform: "spotify" | "youtube" = "spotify"
): Promise<void> {
  await pool.query(
    `INSERT INTO analysis_queue (spotify_id, track_name, artist_name)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [platform === "youtube" ? `yt_${trackId}` : trackId, trackName, artistName]
  );
}
```

The worker already processes by track name + artist (sent to Essentia), so it works for both platforms — the Essentia service searches YouTube for the audio regardless.

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/worker.ts packages/backend/src/db.ts
git commit -m "feat: update worker queue to support YouTube tracks"
```

---

## Task 20: Update .env.example and Final Integration

**Files:**
- Modify: `.env.example`
- Modify: `packages/frontend/vite.config.ts`

- [ ] **Step 1: Update .env.example**

Ensure `.env.example` has all new vars:

```
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
REDIRECT_URI=http://127.0.0.1:3000/auth/callback
FRONTEND_URL=http://127.0.0.1:5173
PORT=3000
ANTHROPIC_API_KEY=
AUDIO_SERVICE_URL=http://127.0.0.1:5001
DATABASE_URL=postgresql://spotaste:spotaste@localhost:5432/spotaste
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
YTMUSIC_SERVICE_URL=http://127.0.0.1:5002
```

- [ ] **Step 2: Add ytmusic proxy to Vite config**

In `packages/frontend/vite.config.ts`, add proxy for ytmusic auth routes (they go through the backend, not directly to ytmusic-service):

```typescript
// The existing proxy for /auth and /api already covers the new routes
// since /auth/ytmusic/* routes are mounted on the Express app.
// No changes needed if proxy already covers /auth and /api.
```

Verify the vite config proxies `/auth` routes. If it only proxies `/api`, add `/auth/ytmusic` too.

- [ ] **Step 3: Full stack integration test**

```bash
# Start everything
docker compose up -d --build
pnpm dev:backend &
pnpm dev:frontend &

# Verify all services are up
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:5001/health
curl http://127.0.0.1:5002/health

# Test Spotify login flow still works
open http://127.0.0.1:5173

# Test YouTube Music auth start
curl -X POST http://127.0.0.1:3000/auth/ytmusic/start
```

- [ ] **Step 4: Commit**

```bash
git add .env.example packages/frontend/vite.config.ts
git commit -m "feat: finalize multi-platform config and proxy setup"
```

---

## Summary of All Tasks

| # | Task | Files | Est. Steps |
|---|------|-------|-----------|
| 1 | Database migration | db/migrate_004, db.ts | 5 |
| 2 | ytmusic-service microservice | ytmusic-service/* | 5 |
| 3 | Docker Compose + config | docker-compose.yml, config.ts | 5 |
| 4 | MusicProvider interface | providers/types.ts | 2 |
| 5 | SpotifyProvider | providers/spotify.ts | 2 |
| 6 | YTMusicProvider | providers/ytmusic.ts | 2 |
| 7 | CombinedProvider + factory | providers/combined.ts, index.ts | 3 |
| 8 | YouTube Music auth routes | routes/auth-ytmusic.ts | 4 |
| 9 | Settings routes | routes/settings.ts | 3 |
| 10 | Refactor endpoints | index.ts | 7 |
| 11 | Judge dual personality | judge.ts, index.ts | 3 |
| 12 | Platform context | PlatformContext.tsx, useAuth.ts, App.tsx | 4 |
| 13 | Dual login page | Login.tsx, YTMusicButton, DeviceCodeModal | 4 |
| 14 | Auth callback updates | AuthCallback.tsx | 2 |
| 15 | Global platform toggle | PlatformToggle.tsx, App.tsx | 3 |
| 16 | Settings page | Settings.tsx, Sidebar.tsx | 3 |
| 17 | Page adaptations | All pages + ArtistModal | 4 |
| 18 | Top artists endpoint | index.ts | 2 |
| 19 | Worker YouTube support | worker.ts, db.ts | 2 |
| 20 | Final config + integration | .env.example, vite.config.ts | 4 |
