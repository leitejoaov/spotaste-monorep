# Last.fm Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Last.fm as an enrichment layer and standalone entry point, giving users deeper music analytics (play counts, tags, similar artists) without requiring Spotify.

**Architecture:** New `lastfm.ts` backend module calls the Last.fm REST API directly (no microservice). PostgreSQL caches responses. Frontend gains a platform context for managing Last.fm username + Spotify token. All 5 features enriched with Last.fm data.

**Tech Stack:** Last.fm API v2, axios, PostgreSQL, React Context, Express, Tailwind CSS

---

## File Structure

### New Files

```
db/migrate_004_lastfm.sql                        # users table, lastfm_cache, schema changes
packages/backend/src/lastfm.ts                    # Last.fm API HTTP client with caching
packages/backend/src/routes/auth-lastfm.ts        # Last.fm username validation + login
packages/backend/src/routes/settings.ts           # Connected accounts management
packages/frontend/src/context/PlatformContext.tsx  # React context: tokens, username, state
packages/frontend/src/components/LastfmInput.tsx   # Username input component (reused in Login + Hub + Settings)
pages/frontend/src/pages/Settings.tsx              # Connected accounts page
```

### Modified Files

```
packages/backend/src/config.ts:8-17               # Add LASTFM_API_KEY
packages/backend/src/db.ts:15-42,343-379          # Add migration 004, users queries, lastfm_cache queries
packages/backend/src/index.ts:1-16,29-63,65-147,149-175,457-501  # Mount routes, refactor endpoints
packages/backend/src/judge.ts:11-45               # Enriched roast prompt with play counts
packages/backend/src/routes/auth.ts:22-94         # Create user on Spotify OAuth callback
packages/backend/src/matcher.ts:47-70             # Tag-boosted scoring
packages/backend/src/worker.ts:13-59              # Enqueue Last.fm top tracks
packages/frontend/src/App.tsx:1-45                # PlatformProvider wrapper, Settings route
packages/frontend/src/hooks/useAuth.ts:1-8        # Multi-platform token management
packages/frontend/src/pages/Login.tsx:1-98         # Dual login cards
packages/frontend/src/pages/AuthCallback.tsx:1-23  # User ID handling
packages/frontend/src/pages/Hub.tsx:22-93          # Connection banner, Last.fm artists
packages/frontend/src/pages/Judge.tsx:51-90        # Last.fm enriched data
packages/frontend/src/pages/TasteAnalysis.tsx:88-107  # Platform headers
packages/frontend/src/pages/AudioFeatures.tsx:99-220  # Platform headers + Last.fm search
packages/frontend/src/pages/TextToPlaylist.tsx:87-132  # Virtual playlist support
packages/frontend/src/pages/PlaylistHistory.tsx:53-84  # Platform headers
packages/frontend/src/components/Sidebar.tsx:10-18     # Settings nav item
packages/frontend/src/components/ArtistModal.tsx:43-54  # Last.fm enrichment
.env.example                                       # Add LASTFM_API_KEY
```

---

## Task 1: Database Migration

**Files:**
- Create: `db/migrate_004_lastfm.sql`
- Modify: `packages/backend/src/db.ts:23-39` (add migration loading)

- [ ] **Step 1: Create migration file**

Create `db/migrate_004_lastfm.sql`:

```sql
-- Users table (app-level identity)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  lastfm_username VARCHAR(128) UNIQUE,
  spotify_user_id VARCHAR(128) UNIQUE,
  primary_platform VARCHAR(16) NOT NULL DEFAULT 'lastfm',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Last.fm API response cache
CREATE TABLE IF NOT EXISTS lastfm_cache (
  id SERIAL PRIMARY KEY,
  username VARCHAR(128) NOT NULL,
  cache_key VARCHAR(128) NOT NULL,
  data JSONB NOT NULL,
  cached_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(username, cache_key)
);
CREATE INDEX IF NOT EXISTS idx_lastfm_cache_lookup ON lastfm_cache(username, cache_key);
CREATE INDEX IF NOT EXISTS idx_lastfm_cache_expiry ON lastfm_cache(cached_at);

-- Add user_id to judge_cache for non-Spotify users
DO $$ BEGIN
  ALTER TABLE judge_cache ADD COLUMN user_id INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Add user_id to playlists for non-Spotify users
DO $$ BEGIN
  ALTER TABLE playlists ADD COLUMN user_id INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
```

- [ ] **Step 2: Add migration loading to db.ts**

In `packages/backend/src/db.ts`, after the existing migration 003 loading (around line 39), add:

```typescript
const migrate004 = path.join(migrationsDir, "migrate_004_lastfm.sql");
if (fs.existsSync(migrate004)) {
  await pool.query(fs.readFileSync(migrate004, "utf-8"));
  console.log("Migration 004 applied (lastfm)");
}
```

- [ ] **Step 3: Add user management queries to db.ts**

Append to `packages/backend/src/db.ts` (after the existing exports, around line 379):

```typescript
// ============ USERS ============

export interface User {
  id: number;
  lastfm_username: string | null;
  spotify_user_id: string | null;
  primary_platform: string;
  created_at: string;
}

export async function findOrCreateUser(
  platform: "lastfm" | "spotify",
  identifier: string
): Promise<User> {
  const col = platform === "lastfm" ? "lastfm_username" : "spotify_user_id";
  const existing = await pool.query(
    `SELECT * FROM users WHERE ${col} = $1`,
    [identifier]
  );
  if (existing.rows.length > 0) return existing.rows[0];
  const result = await pool.query(
    `INSERT INTO users (${col}, primary_platform) VALUES ($1, $2) RETURNING *`,
    [identifier, platform]
  );
  return result.rows[0];
}

export async function linkPlatform(
  userId: number,
  platform: "lastfm" | "spotify",
  identifier: string
): Promise<User> {
  const col = platform === "lastfm" ? "lastfm_username" : "spotify_user_id";
  const result = await pool.query(
    `UPDATE users SET ${col} = $1 WHERE id = $2 RETURNING *`,
    [identifier, userId]
  );
  return result.rows[0];
}

export async function getUserById(userId: number): Promise<User | null> {
  const result = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
  return result.rows[0] || null;
}

// ============ LASTFM CACHE ============

const CACHE_TTLS: Record<string, number> = {
  top_artists: 6 * 60 * 60,      // 6 hours
  top_tracks: 6 * 60 * 60,       // 6 hours
  recent_tracks: 5 * 60,         // 5 minutes
  loved_tracks: 60 * 60,         // 1 hour
  artist_info: 7 * 24 * 60 * 60, // 7 days
  track_info: 7 * 24 * 60 * 60,  // 7 days
  user_info: 24 * 60 * 60,       // 1 day
};

function getCacheTTL(cacheKey: string): number {
  for (const [prefix, ttl] of Object.entries(CACHE_TTLS)) {
    if (cacheKey.startsWith(prefix)) return ttl;
  }
  return 60 * 60; // default 1 hour
}

export async function getLastfmCache(
  username: string,
  cacheKey: string
): Promise<any | null> {
  const ttl = getCacheTTL(cacheKey);
  const result = await pool.query(
    `SELECT data FROM lastfm_cache
     WHERE username = $1 AND cache_key = $2
       AND cached_at > NOW() - INTERVAL '1 second' * $3`,
    [username, cacheKey, ttl]
  );
  return result.rows[0]?.data || null;
}

export async function setLastfmCache(
  username: string,
  cacheKey: string,
  data: any
): Promise<void> {
  await pool.query(
    `INSERT INTO lastfm_cache (username, cache_key, data, cached_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (username, cache_key) DO UPDATE SET
       data = $3, cached_at = NOW()`,
    [username, cacheKey, JSON.stringify(data)]
  );
}

export async function cleanExpiredCache(): Promise<number> {
  const result = await pool.query(
    `DELETE FROM lastfm_cache WHERE cached_at < NOW() - INTERVAL '7 days'`
  );
  return result.rowCount || 0;
}
```

- [ ] **Step 4: Test migration**

```bash
docker compose up -d postgres
pnpm dev:backend
# Watch for: "Migration 004 applied (lastfm)"
# Verify:
docker exec -it $(docker ps -q -f name=postgres) psql -U spotaste -c "\dt"
docker exec -it $(docker ps -q -f name=postgres) psql -U spotaste -c "\d users"
docker exec -it $(docker ps -q -f name=postgres) psql -U spotaste -c "\d lastfm_cache"
```

- [ ] **Step 5: Commit**

```bash
git add db/migrate_004_lastfm.sql packages/backend/src/db.ts
git commit -m "feat: add users table, lastfm_cache, and user management queries"
```

---

## Task 2: Config & Environment

**Files:**
- Modify: `packages/backend/src/config.ts:8-17`
- Modify: `.env.example`

- [ ] **Step 1: Update config.ts**

In `packages/backend/src/config.ts`, add `lastfmApiKey` to the config object (after `anthropicApiKey`):

```typescript
export const config = {
  port: Number(process.env.PORT) || 3000,
  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID!,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET!,
    redirectUri:
      process.env.REDIRECT_URI || "http://127.0.0.1:3000/auth/callback",
  },
  frontendUrl: process.env.FRONTEND_URL || "http://127.0.0.1:5173",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  lastfmApiKey: process.env.LASTFM_API_KEY || "",
};
```

- [ ] **Step 2: Update .env.example**

Append to `.env.example`:

```
LASTFM_API_KEY=your_lastfm_api_key
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/config.ts .env.example
git commit -m "feat: add LASTFM_API_KEY to config"
```

---

## Task 3: Backend — lastfm.ts Client

**Files:**
- Create: `packages/backend/src/lastfm.ts`

- [ ] **Step 1: Create the Last.fm API client**

Create `packages/backend/src/lastfm.ts`:

```typescript
import axios from "axios";
import { config } from "./config.js";
import { getLastfmCache, setLastfmCache } from "./db.js";

const BASE_URL = "https://ws.audioscrobbler.com/2.0/";
const API_KEY = config.lastfmApiKey;

// Rate limiter: max 4 requests/second
let lastRequestTime = 0;
const MIN_INTERVAL = 250; // ms between requests

async function rateLimitedGet(params: Record<string, string | number>) {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL) {
    await new Promise((resolve) => setTimeout(resolve, MIN_INTERVAL - elapsed));
  }
  lastRequestTime = Date.now();

  const response = await axios.get(BASE_URL, {
    params: { ...params, api_key: API_KEY, format: "json" },
    timeout: 10000,
  });

  // Last.fm returns errors inside 200 responses
  if (response.data.error) {
    throw new Error(
      `Last.fm API error ${response.data.error}: ${response.data.message}`
    );
  }

  return response.data;
}

async function cachedGet(
  username: string,
  cacheKey: string,
  params: Record<string, string | number>
): Promise<any> {
  const cached = await getLastfmCache(username, cacheKey);
  if (cached) return cached;

  const data = await rateLimitedGet(params);
  await setLastfmCache(username, cacheKey, data);
  return data;
}

// ============ USER DATA ============

export interface LastfmUserInfo {
  name: string;
  realname: string;
  playcount: number;
  artist_count: number;
  track_count: number;
  image: string;
  url: string;
  registered: number; // unix timestamp
  country: string;
}

export async function validateUser(
  username: string
): Promise<LastfmUserInfo | null> {
  try {
    const data = await cachedGet(username, "user_info", {
      method: "user.getInfo",
      user: username,
    });
    const u = data.user;
    return {
      name: u.name,
      realname: u.realname || "",
      playcount: Number(u.playcount) || 0,
      artist_count: Number(u.artist_count) || 0,
      track_count: Number(u.track_count) || 0,
      image: u.image?.find((i: any) => i.size === "extralarge")?.["#text"] || "",
      url: u.url || "",
      registered: Number(u.registered?.unixtime) || 0,
      country: u.country || "",
    };
  } catch {
    return null;
  }
}

export type LastfmPeriod =
  | "7day"
  | "1month"
  | "3month"
  | "6month"
  | "12month"
  | "overall";

export interface LastfmTopArtist {
  name: string;
  playcount: number;
  mbid: string;
  url: string;
  image: string;
  rank: number;
}

export async function getTopArtists(
  username: string,
  period: LastfmPeriod = "3month",
  limit = 10
): Promise<LastfmTopArtist[]> {
  const data = await cachedGet(
    username,
    `top_artists_${period}_${limit}`,
    { method: "user.getTopArtists", user: username, period, limit }
  );
  const artists = data.topartists?.artist || [];
  // Handle single-item non-array quirk
  const list = Array.isArray(artists) ? artists : [artists];
  return list.map((a: any) => ({
    name: a.name,
    playcount: Number(a.playcount) || 0,
    mbid: a.mbid || "",
    url: a.url || "",
    image:
      a.image?.find((i: any) => i.size === "extralarge")?.["#text"] || "",
    rank: Number(a["@attr"]?.rank) || 0,
  }));
}

export interface LastfmTopTrack {
  name: string;
  artist: string;
  playcount: number;
  mbid: string;
  url: string;
  image: string;
  rank: number;
}

export async function getTopTracks(
  username: string,
  period: LastfmPeriod = "3month",
  limit = 20
): Promise<LastfmTopTrack[]> {
  const data = await cachedGet(
    username,
    `top_tracks_${period}_${limit}`,
    { method: "user.getTopTracks", user: username, period, limit }
  );
  const tracks = data.toptracks?.track || [];
  const list = Array.isArray(tracks) ? tracks : [tracks];
  return list.map((t: any) => ({
    name: t.name,
    artist: t.artist?.name || "",
    playcount: Number(t.playcount) || 0,
    mbid: t.mbid || "",
    url: t.url || "",
    image:
      t.image?.find((i: any) => i.size === "extralarge")?.["#text"] || "",
    rank: Number(t["@attr"]?.rank) || 0,
  }));
}

export interface LastfmRecentTrack {
  name: string;
  artist: string;
  album: string;
  image: string;
  date: number; // unix timestamp, 0 if nowplaying
  nowplaying: boolean;
}

export async function getRecentTracks(
  username: string,
  limit = 50
): Promise<LastfmRecentTrack[]> {
  const data = await cachedGet(username, "recent_tracks", {
    method: "user.getRecentTracks",
    user: username,
    limit,
    extended: 0,
  });
  const tracks = data.recenttracks?.track || [];
  const list = Array.isArray(tracks) ? tracks : [tracks];
  return list.map((t: any) => ({
    name: t.name,
    artist: t.artist?.["#text"] || t.artist?.name || "",
    album: t.album?.["#text"] || "",
    image:
      t.image?.find((i: any) => i.size === "extralarge")?.["#text"] || "",
    date: Number(t.date?.uts) || 0,
    nowplaying: t["@attr"]?.nowplaying === "true",
  }));
}

export interface LastfmTrackInfo {
  name: string;
  artist: string;
  album: string;
  duration: number; // ms
  listeners: number;
  playcount: number;
  userplaycount: number;
  userloved: boolean;
  tags: string[];
  url: string;
  wiki: string;
}

export async function getTrackInfo(
  artist: string,
  track: string,
  username?: string
): Promise<LastfmTrackInfo | null> {
  try {
    const key = `track_info_${artist.toLowerCase()}_${track.toLowerCase()}`;
    const params: Record<string, string | number> = {
      method: "track.getInfo",
      artist,
      track,
    };
    if (username) params.username = username;

    const data = await cachedGet(username || "_global", key, params);
    const t = data.track;
    if (!t) return null;

    const tags = t.toptags?.tag || [];
    const tagList = Array.isArray(tags) ? tags : [tags];

    return {
      name: t.name,
      artist: t.artist?.name || artist,
      album: t.album?.title || "",
      duration: Number(t.duration) || 0,
      listeners: Number(t.listeners) || 0,
      playcount: Number(t.playcount) || 0,
      userplaycount: Number(t.userplaycount) || 0,
      userloved: t.userloved === "1",
      tags: tagList.map((tag: any) => tag.name).filter(Boolean),
      url: t.url || "",
      wiki: t.wiki?.summary || "",
    };
  } catch {
    return null;
  }
}

export interface LastfmArtistInfo {
  name: string;
  mbid: string;
  url: string;
  image: string;
  listeners: number;
  playcount: number;
  tags: string[];
  bio: string;
  similar: { name: string; match: number; image: string }[];
}

export async function getArtistInfo(
  artist: string
): Promise<LastfmArtistInfo | null> {
  try {
    const key = `artist_info_${artist.toLowerCase()}`;
    const data = await cachedGet("_global", key, {
      method: "artist.getInfo",
      artist,
    });
    const a = data.artist;
    if (!a) return null;

    const tags = a.tags?.tag || [];
    const tagList = Array.isArray(tags) ? tags : [tags];
    const similar = a.similar?.artist || [];
    const simList = Array.isArray(similar) ? similar : [similar];

    return {
      name: a.name,
      mbid: a.mbid || "",
      url: a.url || "",
      image:
        a.image?.find((i: any) => i.size === "extralarge")?.["#text"] || "",
      listeners: Number(a.stats?.listeners) || 0,
      playcount: Number(a.stats?.playcount) || 0,
      tags: tagList.map((tag: any) => tag.name).filter(Boolean),
      bio: a.bio?.summary || "",
      similar: simList.map((s: any) => ({
        name: s.name,
        match: parseFloat(s.match) || 0,
        image:
          s.image?.find((i: any) => i.size === "extralarge")?.["#text"] || "",
      })),
    };
  } catch {
    return null;
  }
}

export interface LastfmArtistTopTrack {
  name: string;
  playcount: number;
  listeners: number;
  url: string;
}

export async function getArtistTopTracks(
  artist: string,
  limit = 10
): Promise<LastfmArtistTopTrack[]> {
  const key = `artist_top_tracks_${artist.toLowerCase()}_${limit}`;
  const data = await cachedGet("_global", key, {
    method: "artist.getTopTracks",
    artist,
    limit,
  });
  const tracks = data.toptracks?.track || [];
  const list = Array.isArray(tracks) ? tracks : [tracks];
  return list.map((t: any) => ({
    name: t.name,
    playcount: Number(t.playcount) || 0,
    listeners: Number(t.listeners) || 0,
    url: t.url || "",
  }));
}

export async function getSimilarArtists(
  artist: string,
  limit = 10
): Promise<{ name: string; match: number; image: string }[]> {
  const key = `similar_artists_${artist.toLowerCase()}_${limit}`;
  const data = await cachedGet("_global", key, {
    method: "artist.getSimilar",
    artist,
    limit,
  });
  const artists = data.similarartists?.artist || [];
  const list = Array.isArray(artists) ? artists : [artists];
  return list.map((a: any) => ({
    name: a.name,
    match: parseFloat(a.match) || 0,
    image:
      a.image?.find((i: any) => i.size === "extralarge")?.["#text"] || "",
  }));
}

export interface LastfmSearchResult {
  name: string;
  artist: string;
  listeners: number;
  url: string;
  image: string;
}

export async function searchTrack(
  query: string,
  limit = 10
): Promise<LastfmSearchResult[]> {
  // No cache for searches — they're dynamic
  const data = await rateLimitedGet({
    method: "track.search",
    track: query,
    limit,
  });
  const tracks = data.results?.trackmatches?.track || [];
  const list = Array.isArray(tracks) ? tracks : [tracks];
  return list.map((t: any) => ({
    name: t.name,
    artist: t.artist,
    listeners: Number(t.listeners) || 0,
    url: t.url || "",
    image:
      t.image?.find((i: any) => i.size === "extralarge")?.["#text"] || "",
  }));
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd packages/backend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/lastfm.ts
git commit -m "feat: add Last.fm API client with caching and rate limiting"
```

---

## Task 4: Backend — Last.fm Auth Routes

**Files:**
- Create: `packages/backend/src/routes/auth-lastfm.ts`
- Modify: `packages/backend/src/index.ts:1-16` (add import and mount)

- [ ] **Step 1: Create Last.fm auth router**

Create `packages/backend/src/routes/auth-lastfm.ts`:

```typescript
import { Router } from "express";
import { validateUser } from "../lastfm.js";
import { findOrCreateUser } from "../db.js";
import { addToQueue, getTrackFeatures } from "../db.js";
import { getTopTracks } from "../lastfm.js";

const router = Router();

// Validate Last.fm username and create user
router.post("/auth/lastfm/login", async (req, res) => {
  const { username } = req.body;
  if (!username || typeof username !== "string" || username.trim().length === 0) {
    return res.status(400).json({ error: "Username obrigatorio" });
  }

  const trimmed = username.trim();

  try {
    const userInfo = await validateUser(trimmed);
    if (!userInfo) {
      return res.status(404).json({ error: "Usuario nao encontrado no Last.fm" });
    }

    const user = await findOrCreateUser("lastfm", trimmed);

    // Fire-and-forget: enqueue top tracks for Essentia analysis
    enqueueLastfmTopTracks(trimmed).catch((err) =>
      console.error("Error enqueuing Last.fm tracks:", err.message)
    );

    res.json({
      userId: user.id,
      lastfmUser: userInfo,
    });
  } catch (err: any) {
    console.error("Last.fm login error:", err.message);
    res.status(500).json({ error: "Falha ao validar usuario" });
  }
});

// Enqueue top tracks from Last.fm for background Essentia analysis
async function enqueueLastfmTopTracks(username: string) {
  const tracks = await getTopTracks(username, "3month", 50);
  let newCount = 0;
  for (const track of tracks) {
    const existing = await getTrackFeatures(`lastfm_${track.name}_${track.artist}`);
    if (!existing) {
      await addToQueue(
        `lastfm_${track.name}_${track.artist}`.slice(0, 60),
        track.name,
        track.artist
      );
      newCount++;
    }
    if (newCount >= 20) break; // Don't flood the queue
  }
  if (newCount > 0) {
    console.log(`Enqueued ${newCount} Last.fm tracks for ${username}`);
  }
}

export default router;
```

- [ ] **Step 2: Mount in index.ts**

In `packages/backend/src/index.ts`, add at the imports section (around line 14):

```typescript
import lastfmAuthRouter from "./routes/auth-lastfm.js";
```

And after the existing auth router mount (around line 27):

```typescript
app.use(lastfmAuthRouter);
```

- [ ] **Step 3: Test the endpoint**

```bash
pnpm dev:backend &
# Test with a real Last.fm username:
curl -X POST http://127.0.0.1:3000/auth/lastfm/login \
  -H "Content-Type: application/json" \
  -d '{"username":"rj"}'
# rj is a Last.fm test user. Expected: {userId: N, lastfmUser: {...}}

# Test invalid username:
curl -X POST http://127.0.0.1:3000/auth/lastfm/login \
  -H "Content-Type: application/json" \
  -d '{"username":"this_user_definitely_does_not_exist_12345"}'
# Expected: {error: "Usuario nao encontrado no Last.fm"}
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/routes/auth-lastfm.ts packages/backend/src/index.ts
git commit -m "feat: add Last.fm username login route with auto-enqueue"
```

---

## Task 5: Backend — Update Spotify Auth to Create Users

**Files:**
- Modify: `packages/backend/src/routes/auth.ts:22-94`

- [ ] **Step 1: Add user creation to Spotify callback**

In `packages/backend/src/routes/auth.ts`, add import at the top:

```typescript
import { findOrCreateUser } from "../db.js";
```

Inside the callback handler (after `const accessToken = await exchangeCode(code as string);` around line 42), add user creation:

```typescript
const { getSpotifyUserId } = await import("../spotify.js");
const spotifyUserId = await getSpotifyUserId(accessToken);
const user = await findOrCreateUser("spotify", spotifyUserId);
```

Update the redirect URL (around line 89) to include `userId`:

```typescript
res.redirect(
  `${config.frontendUrl}/#/auth-callback?artists=${encodeURIComponent(
    JSON.stringify(topArtists)
  )}&t=${accessToken}&userId=${user.id}`
);
```

- [ ] **Step 2: Verify Spotify flow still works**

```bash
pnpm dev:backend
# Navigate to http://127.0.0.1:3000/auth/login in browser
# Complete Spotify OAuth
# Verify redirect includes userId param
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/routes/auth.ts
git commit -m "feat: create user record on Spotify OAuth callback"
```

---

## Task 6: Backend — Settings Routes

**Files:**
- Create: `packages/backend/src/routes/settings.ts`
- Modify: `packages/backend/src/index.ts` (mount router)

- [ ] **Step 1: Create settings router**

Create `packages/backend/src/routes/settings.ts`:

```typescript
import { Router } from "express";
import { getUserById, linkPlatform } from "../db.js";
import { validateUser } from "../lastfm.js";
import { getSpotifyUserId } from "../spotify.js";

const router = Router();

// Get connected accounts status
router.get("/api/settings/accounts", async (req, res) => {
  const userId = Number(req.headers["x-user-id"]);
  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  const user = await getUserById(userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  res.json({
    userId: user.id,
    lastfm: {
      connected: !!user.lastfm_username,
      username: user.lastfm_username,
    },
    spotify: {
      connected: !!user.spotify_user_id,
    },
    primaryPlatform: user.primary_platform,
  });
});

// Link Last.fm account
router.post("/api/settings/link-lastfm", async (req, res) => {
  const userId = Number(req.headers["x-user-id"]);
  const { username } = req.body;
  if (!userId || !username) {
    return res.status(400).json({ error: "userId and username required" });
  }

  const userInfo = await validateUser(username.trim());
  if (!userInfo) {
    return res.status(404).json({ error: "Usuario nao encontrado no Last.fm" });
  }

  try {
    const user = await linkPlatform(userId, "lastfm", username.trim());
    res.json({ connected: true, username: user.lastfm_username });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Link Spotify account
router.post("/api/settings/link-spotify", async (req, res) => {
  const userId = Number(req.headers["x-user-id"]);
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!userId || !token) {
    return res.status(400).json({ error: "userId and spotify token required" });
  }

  try {
    const spotifyUserId = await getSpotifyUserId(token);
    const user = await linkPlatform(userId, "spotify", spotifyUserId);
    res.json({ connected: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

- [ ] **Step 2: Mount in index.ts**

Add to imports in `packages/backend/src/index.ts`:

```typescript
import settingsRouter from "./routes/settings.js";
```

Mount after auth routers:

```typescript
app.use(settingsRouter);
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/routes/settings.ts packages/backend/src/index.ts
git commit -m "feat: add settings routes for platform account linking"
```

---

## Task 7: Backend — Enriched Judge (Roast)

**Files:**
- Modify: `packages/backend/src/judge.ts:11-45`
- Modify: `packages/backend/src/index.ts:29-63` (judge endpoint)

- [ ] **Step 1: Add enriched roast function to judge.ts**

Add a new export to `packages/backend/src/judge.ts` (after the existing `getMusicTasteAnalysis` function):

```typescript
export async function getEnrichedMusicTasteAnalysis(
  artists: { name: string; genres: string[]; playcount?: number }[],
  totalScrobbles?: number,
  memberSince?: number
): Promise<string> {
  const artistList = artists
    .map(
      (a) =>
        `${a.name} (${a.genres.join(", ") || "sem genero"})${
          a.playcount ? ` — ${a.playcount} plays` : ""
        }`
    )
    .join("\n");

  const statsLine = [
    totalScrobbles ? `Total de scrobbles: ${totalScrobbles.toLocaleString()}` : "",
    memberSince
      ? `Membro desde: ${new Date(memberSince * 1000).getFullYear()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    system: `Voce e um critico musical gen-z brasileiro BRUTALMENTE sincero e engraçado.
Voce recebe os artistas mais ouvidos do usuario COM a quantidade de vezes que ele ouviu cada um.
Use esses numeros pra fazer piadas ESPECIFICAS (ex: "tu ouviu X 847 vezes, isso e uma vez a cada 3 horas, ta tudo bem?").
Quanto maior o numero, mais zoa. Se o total de scrobbles for absurdo, zoa também.
Usa girias gen-z brasileiras (kkkkk, ne possivel, mlk, mano, vey).
Tom: zoeiro, memes, comparacoes absurdas. 4-5 paragrafos. Sem markdown, texto puro.`,
    messages: [
      {
        role: "user",
        content: `Top artistas:\n${artistList}\n\n${statsLine}`,
      },
    ],
  });

  return (msg.content[0] as any).text;
}
```

- [ ] **Step 2: Update judge endpoint to use Last.fm data**

In `packages/backend/src/index.ts`, replace the `/api/judge` handler (lines 29-63):

```typescript
app.post("/api/judge", claudeLimiter, async (req, res) => {
  const { artists } = req.body;
  const token = req.headers.authorization?.replace("Bearer ", "");
  const lastfmUser = req.headers["x-lastfm-user"] as string;
  const userId = Number(req.headers["x-user-id"]) || undefined;

  if (!artists?.length) {
    return res.status(400).json({ error: "artists required" });
  }

  try {
    const artHash = hashArtists(artists);

    // Check cache
    if (userId) {
      const cached = await getCachedJudge(
        userId.toString(),
        artHash
      );
      if (cached) return res.json({ analysis: cached });
    } else if (token) {
      const spotifyId = await getSpotifyUserId(token);
      const cached = await getCachedJudge(spotifyId, artHash);
      if (cached) return res.json({ analysis: cached });
    }

    let analysis: string;

    // If Last.fm connected, use enriched roast with play counts
    if (lastfmUser) {
      const lastfm = await import("./lastfm.js");
      const topArtists = await lastfm.getTopArtists(lastfmUser, "3month", 10);
      const userInfo = await lastfm.validateUser(lastfmUser);

      // Merge Last.fm play counts with artists from request
      const enriched = artists.map((a: any) => {
        const lfmMatch = topArtists.find(
          (la) => la.name.toLowerCase() === a.name.toLowerCase()
        );
        return {
          name: a.name,
          genres: a.genres || [],
          playcount: lfmMatch?.playcount || 0,
        };
      });

      analysis = await getEnrichedMusicTasteAnalysis(
        enriched,
        userInfo?.playcount,
        userInfo?.registered
      );
    } else {
      analysis = await getMusicTasteAnalysis(artists);
    }

    // Cache result
    if (userId) {
      await setCachedJudge(userId.toString(), artHash, analysis);
    } else if (token) {
      const spotifyId = await getSpotifyUserId(token);
      await setCachedJudge(spotifyId, artHash, analysis);
    }

    res.json({ analysis });
  } catch (err: any) {
    console.error("Judge error:", err.message);
    res.status(500).json({ error: "Analysis failed" });
  }
});
```

Add the import at the top of index.ts:

```typescript
import { getMusicTasteAnalysis, getEnrichedMusicTasteAnalysis } from "./judge.js";
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/judge.ts packages/backend/src/index.ts
git commit -m "feat: enriched roast with Last.fm play counts and stats"
```

---

## Task 8: Backend — Enriched Analyze-Taste

**Files:**
- Modify: `packages/backend/src/index.ts:65-147`

- [ ] **Step 1: Update analyze-taste to support Last.fm data source**

Replace the `/api/analyze-taste` handler:

```typescript
app.get("/api/analyze-taste", claudeLimiter, async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const lastfmUser = req.headers["x-lastfm-user"] as string;

  if (!token && !lastfmUser) {
    return res.status(401).json({ error: "Auth required (Spotify token or Last.fm username)" });
  }

  try {
    // Determine user ID for caching
    let cacheKey: string;
    if (lastfmUser) {
      cacheKey = `lastfm_${lastfmUser}`;
    } else {
      cacheKey = await getSpotifyUserId(token!);
    }

    // Check SQLite cache
    const cached = getCachedAnalysis(cacheKey);
    if (cached) {
      // Enrich cached result with fresh Essentia data from DB
      if (cached.tracks) {
        for (const track of cached.tracks) {
          if (track.spotifyId) {
            const dbFeatures = await getTrackFeatures(track.spotifyId);
            if (dbFeatures?.mood_happy != null) {
              track.essentia = {
                bpm: dbFeatures.bpm,
                key: dbFeatures.key,
                mode: dbFeatures.mode,
                energy: dbFeatures.energy,
                danceability: dbFeatures.danceability,
                loudness: dbFeatures.loudness,
                mood_happy: dbFeatures.mood_happy,
                mood_sad: dbFeatures.mood_sad,
                mood_aggressive: dbFeatures.mood_aggressive,
                mood_relaxed: dbFeatures.mood_relaxed,
                mood_party: dbFeatures.mood_party,
                voice_instrumental: dbFeatures.voice_instrumental,
                mood_acoustic: dbFeatures.mood_acoustic,
              };
            }
          }
        }
      }
      return res.json(cached);
    }

    // Build track list from available source
    let tracksForClaude: any[];

    if (lastfmUser) {
      // Use Last.fm top tracks
      const lastfm = await import("./lastfm.js");
      const topTracks = await lastfm.getTopTracks(lastfmUser, "3month", 20);

      // Enrich with Last.fm tags
      const enrichedTracks = await Promise.all(
        topTracks.map(async (t) => {
          const info = await lastfm.getTrackInfo(t.artist, t.name, lastfmUser);
          return {
            id: `lastfm_${t.name}_${t.artist}`.slice(0, 60),
            name: t.name,
            artists: [{ name: t.artist }],
            preview_url: null,
            album: { name: "", images: [{ url: t.image }] },
            playcount: t.playcount,
            tags: info?.tags || [],
          };
        })
      );
      tracksForClaude = enrichedTracks;
    } else {
      // Use Spotify top tracks (existing flow)
      const topTracks = await getTopTracks(token!, { limit: 20 });
      tracksForClaude = topTracks;
    }

    const result = await analyzeTaste(tracksForClaude as any);

    // Enrich result tracks with images, IDs, and Essentia data
    result.tracks = await Promise.all(
      result.tracks.map(async (t: any, i: number) => {
        const source = tracksForClaude[i];
        const spotifyId = source?.id || "";
        const dbFeatures = spotifyId ? await getTrackFeatures(spotifyId) : null;

        return {
          ...t,
          albumImage: source?.album?.images?.[0]?.url || "",
          spotifyId,
          playcount: source?.playcount || undefined,
          lastfmTags: source?.tags || undefined,
          essentia: dbFeatures?.mood_happy != null ? {
            bpm: dbFeatures.bpm,
            key: dbFeatures.key,
            mode: dbFeatures.mode,
            energy: dbFeatures.energy,
            danceability: dbFeatures.danceability,
            loudness: dbFeatures.loudness,
            mood_happy: dbFeatures.mood_happy,
            mood_sad: dbFeatures.mood_sad,
            mood_aggressive: dbFeatures.mood_aggressive,
            mood_relaxed: dbFeatures.mood_relaxed,
            mood_party: dbFeatures.mood_party,
            voice_instrumental: dbFeatures.voice_instrumental,
            mood_acoustic: dbFeatures.mood_acoustic,
          } : undefined,
        };
      })
    );

    setCachedAnalysis(cacheKey, result);
    res.json(result);
  } catch (err: any) {
    console.error("Analyze-taste error:", err.message);
    res.status(500).json({ error: "Analysis failed" });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/index.ts
git commit -m "feat: analyze-taste supports Last.fm as data source with tags"
```

---

## Task 9: Backend — Search with Last.fm Fallback

**Files:**
- Modify: `packages/backend/src/index.ts:149-175`

- [ ] **Step 1: Update search-tracks to fall back to Last.fm**

Replace the `/api/search-tracks` handler:

```typescript
app.get("/api/search-tracks", async (req, res) => {
  const query = req.query.q as string;
  if (!query) return res.json([]);

  const token = req.headers.authorization?.replace("Bearer ", "");

  try {
    // Prefer Spotify search if available (better results, album art)
    if (token) {
      const results = await searchTracks(token, query);
      return res.json(
        results.map((r) => ({
          id: r.id,
          name: r.name,
          artist: r.artists.map((a) => a.name).join(", "),
          album: r.album.name,
          image: r.album.images?.[0]?.url || "",
          source: "spotify",
        }))
      );
    }

    // Fall back to Last.fm search
    const lastfm = await import("./lastfm.js");
    const results = await lastfm.searchTrack(query, 8);
    res.json(
      results.map((r) => ({
        id: `lastfm_${r.name}_${r.artist}`.slice(0, 60),
        name: r.name,
        artist: r.artist,
        album: "",
        image: r.image || "",
        listeners: r.listeners,
        source: "lastfm",
      }))
    );
  } catch (err: any) {
    console.error("Search error:", err.message);
    res.status(500).json({ error: "Search failed" });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/index.ts
git commit -m "feat: search-tracks falls back to Last.fm when no Spotify token"
```

---

## Task 10: Backend — Enriched Artist Details

**Files:**
- Modify: `packages/backend/src/index.ts:457-501`

- [ ] **Step 1: Update artist-details to include Last.fm data**

Replace the `/api/artist-details` handler:

```typescript
app.get("/api/artist-details", async (req, res) => {
  const name = req.query.name as string;
  if (!name) return res.status(400).json({ error: "name required" });

  const token = req.headers.authorization?.replace("Bearer ", "");
  const lastfmUser = req.headers["x-lastfm-user"] as string;

  try {
    let spotifyData: any = null;
    let lastfmData: any = null;

    // Fetch from Spotify if available
    if (token) {
      try {
        const artist = await searchArtist(token, name);
        if (artist) {
          const topTracks = await getArtistTopTracks(token, artist.id);
          spotifyData = {
            id: artist.id,
            name: artist.name,
            image: artist.images?.[0]?.url || "",
            genres: artist.genres,
            popularity: artist.popularity,
            spotify_url: artist.external_urls?.spotify || "",
            top_tracks: topTracks.map((t) => ({
              id: t.id,
              name: t.name,
              artists: t.artists,
              album: t.album,
              external_urls: t.external_urls,
              duration_ms: t.duration_ms,
            })),
          };
        }
      } catch (err: any) {
        console.error("Spotify artist fetch error:", err.message);
      }
    }

    // Fetch from Last.fm (always, for enrichment)
    const lastfm = await import("./lastfm.js");
    const artistInfo = await lastfm.getArtistInfo(name);
    if (artistInfo) {
      lastfmData = {
        bio: artistInfo.bio,
        tags: artistInfo.tags,
        similar: artistInfo.similar,
        listeners: artistInfo.listeners,
        global_playcount: artistInfo.playcount,
      };
    }

    // Get Last.fm top tracks as fallback if no Spotify
    if (!spotifyData && artistInfo) {
      const lfmTracks = await lastfm.getArtistTopTracks(name, 10);
      spotifyData = {
        id: artistInfo.mbid || name,
        name: artistInfo.name,
        image: artistInfo.image || "",
        genres: artistInfo.tags,
        popularity: 0,
        spotify_url: "",
        top_tracks: lfmTracks.map((t) => ({
          id: "",
          name: t.name,
          artists: [{ name }],
          album: { name: "", images: [] },
          external_urls: { spotify: "" },
          duration_ms: 0,
          listeners: t.listeners,
          playcount: t.playcount,
        })),
      };
    }

    if (!spotifyData && !lastfmData) {
      return res.status(404).json({ error: "Artist not found" });
    }

    res.json({
      ...(spotifyData || {}),
      lastfm: lastfmData,
    });
  } catch (err: any) {
    console.error("Artist details error:", err.message);
    res.status(500).json({ error: "Failed to get artist details" });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/index.ts
git commit -m "feat: artist-details enriched with Last.fm bio, tags, similar artists"
```

---

## Task 11: Backend — Worker Cache Cleanup

**Files:**
- Modify: `packages/backend/src/worker.ts:61-73`

- [ ] **Step 1: Add cache cleanup to worker cycle**

In `packages/backend/src/worker.ts`, add the import at the top:

```typescript
import { cleanExpiredCache } from "./db.js";
```

In the `startWorker` function (around line 61), add cache cleanup to the interval:

```typescript
export function startWorker() {
  resetStuckProcessing().then((count) => {
    if (count > 0) console.log(`Reset ${count} stuck processing items`);
  });

  setInterval(async () => {
    try {
      await processQueue();
      // Clean expired Last.fm cache entries every cycle
      const cleaned = await cleanExpiredCache();
      if (cleaned > 0) console.log(`Cleaned ${cleaned} expired cache entries`);
    } catch (err: any) {
      console.error("Worker error:", err.message);
    }
  }, 30000);
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/worker.ts
git commit -m "feat: worker cleans expired Last.fm cache entries"
```

---

## Task 12: Frontend — Platform Context

**Files:**
- Create: `packages/frontend/src/context/PlatformContext.tsx`
- Modify: `packages/frontend/src/hooks/useAuth.ts:1-8`

- [ ] **Step 1: Create PlatformContext**

Create `packages/frontend/src/context/PlatformContext.tsx`:

```tsx
import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";

interface PlatformState {
  spotifyToken: string;
  lastfmUser: string;
  userId: number | null;
}

interface PlatformContextType extends PlatformState {
  setSpotifyToken: (token: string) => void;
  setLastfmUser: (username: string) => void;
  setUserId: (id: number) => void;
  isLoggedIn: boolean;
  hasSpotify: boolean;
  hasLastfm: boolean;
  hasBoth: boolean;
  logout: () => void;
  getHeaders: () => Record<string, string>;
}

const PlatformContext = createContext<PlatformContextType | null>(null);

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlatformState>(() => ({
    spotifyToken:
      sessionStorage.getItem("spotaste_spotify_token") ||
      sessionStorage.getItem("spotaste_token") ||
      "",
    lastfmUser: sessionStorage.getItem("spotaste_lastfm_user") || "",
    userId: sessionStorage.getItem("spotaste_user_id")
      ? Number(sessionStorage.getItem("spotaste_user_id"))
      : null,
  }));

  const setSpotifyToken = useCallback((token: string) => {
    sessionStorage.setItem("spotaste_spotify_token", token);
    sessionStorage.setItem("spotaste_token", token); // legacy compat
    setState((s) => ({ ...s, spotifyToken: token }));
  }, []);

  const setLastfmUser = useCallback((username: string) => {
    sessionStorage.setItem("spotaste_lastfm_user", username);
    setState((s) => ({ ...s, lastfmUser: username }));
  }, []);

  const setUserId = useCallback((id: number) => {
    sessionStorage.setItem("spotaste_user_id", String(id));
    setState((s) => ({ ...s, userId: id }));
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem("spotaste_spotify_token");
    sessionStorage.removeItem("spotaste_lastfm_user");
    sessionStorage.removeItem("spotaste_user_id");
    sessionStorage.removeItem("spotaste_token");
    setState({ spotifyToken: "", lastfmUser: "", userId: null });
  }, []);

  const isLoggedIn = !!(state.spotifyToken || state.lastfmUser);
  const hasSpotify = !!state.spotifyToken;
  const hasLastfm = !!state.lastfmUser;
  const hasBoth = hasSpotify && hasLastfm;

  const getHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (state.spotifyToken) {
      headers["Authorization"] = `Bearer ${state.spotifyToken}`;
    }
    if (state.lastfmUser) {
      headers["X-Lastfm-User"] = state.lastfmUser;
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
        setLastfmUser,
        setUserId,
        isLoggedIn,
        hasSpotify,
        hasLastfm,
        hasBoth,
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
  if (!ctx) throw new Error("usePlatform must be inside PlatformProvider");
  return ctx;
}
```

- [ ] **Step 2: Update useAuth.ts for backward compatibility**

Replace `packages/frontend/src/hooks/useAuth.ts`:

```typescript
export function getAccessToken(): string {
  return (
    sessionStorage.getItem("spotaste_spotify_token") ||
    sessionStorage.getItem("spotaste_token") ||
    ""
  );
}

export function clearAccessToken() {
  sessionStorage.removeItem("spotaste_spotify_token");
  sessionStorage.removeItem("spotaste_lastfm_user");
  sessionStorage.removeItem("spotaste_user_id");
  sessionStorage.removeItem("spotaste_token");
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/context/PlatformContext.tsx packages/frontend/src/hooks/useAuth.ts
git commit -m "feat: add PlatformContext for Last.fm + Spotify state management"
```

---

## Task 13: Frontend — Wrap App with PlatformProvider

**Files:**
- Modify: `packages/frontend/src/App.tsx:1-45`

- [ ] **Step 1: Add PlatformProvider and Settings route**

In `packages/frontend/src/App.tsx`, add the imports:

```tsx
import { PlatformProvider } from "./context/PlatformContext";
import Settings from "./pages/Settings";
```

Wrap the return of the `App` component with `PlatformProvider`:

```tsx
function App() {
  return (
    <PlatformProvider>
      <Routes>
        {/* ... existing routes ... */}
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </PlatformProvider>
  );
}
```

Also update the `AppContent` function (if that's the component with routes) to be wrapped by `PlatformProvider` at the top level. The provider should wrap everything that uses `usePlatform()`.

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/App.tsx
git commit -m "feat: wrap App with PlatformProvider, add Settings route"
```

---

## Task 14: Frontend — Last.fm Input Component

**Files:**
- Create: `packages/frontend/src/components/LastfmInput.tsx`

- [ ] **Step 1: Create reusable Last.fm username input**

Create `packages/frontend/src/components/LastfmInput.tsx`:

```tsx
import { useState } from "react";
import { Loader2 } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "";

interface Props {
  onSuccess: (userId: number, username: string, userInfo: any) => void;
  buttonText?: string;
  compact?: boolean;
}

export default function LastfmInput({
  onSuccess,
  buttonText = "Entrar",
  compact = false,
}: Props) {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_URL}/auth/lastfm/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Falha ao conectar");
        return;
      }

      onSuccess(data.userId, username.trim(), data.lastfmUser);
    } catch {
      setError("Erro de conexao");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={compact ? "flex gap-2" : "space-y-3"}>
      <input
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username do Last.fm"
        className={`bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-[#d51007] transition-colors ${
          compact ? "px-3 py-2 text-sm flex-1" : "px-4 py-3 w-full"
        }`}
        disabled={loading}
      />
      <button
        type="submit"
        disabled={loading || !username.trim()}
        className={`bg-[#d51007] hover:bg-[#b50e06] disabled:opacity-50 text-white font-bold rounded-lg transition-all ${
          compact ? "px-4 py-2 text-sm" : "px-6 py-3 w-full"
        }`}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : buttonText}
      </button>
      {error && (
        <p className={`text-red-400 ${compact ? "text-xs" : "text-sm text-center"}`}>
          {error}
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/components/LastfmInput.tsx
git commit -m "feat: add reusable LastfmInput component"
```

---

## Task 15: Frontend — Dual Login Page

**Files:**
- Modify: `packages/frontend/src/pages/Login.tsx:1-98`

- [ ] **Step 1: Update Login page with dual cards**

Replace the content of `packages/frontend/src/pages/Login.tsx`. Keep the existing animated background and header, but replace the single SpotifyButton with two cards:

After the existing imports, add:

```tsx
import { useNavigate } from "react-router-dom";
import LastfmInput from "../components/LastfmInput";
import { usePlatform } from "../context/PlatformContext";
```

In the component, add:

```tsx
const navigate = useNavigate();
const { setLastfmUser, setUserId } = usePlatform();

const handleLastfmSuccess = (userId: number, username: string) => {
  setLastfmUser(username);
  setUserId(userId);
  navigate("/hub");
};
```

Replace the SpotifyButton section with:

```tsx
{/* Login Cards */}
<div className="flex flex-col gap-6 w-full max-w-md">
  {/* Last.fm Card (Primary) */}
  <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
    <div className="flex items-center gap-3 mb-4">
      <div className="w-10 h-10 bg-[#d51007]/20 rounded-full flex items-center justify-center">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-[#d51007]">
          <path d="M10.584 17.21l-.88-2.392s-1.43 1.594-3.573 1.594c-1.897 0-3.244-1.649-3.244-4.288 0-3.382 1.704-4.591 3.381-4.591 2.422 0 3.19 1.567 3.849 3.574l.88 2.749c.88 2.666 2.529 4.81 7.285 4.81 3.409 0 5.718-1.044 5.718-3.793 0-2.227-1.265-3.381-3.63-3.932l-1.758-.385c-1.21-.275-1.567-.77-1.567-1.595 0-.934.742-1.484 1.952-1.484 1.32 0 2.034.495 2.144 1.677l2.749-.33c-.22-2.474-1.924-3.492-4.729-3.492-2.474 0-4.893.935-4.893 3.932 0 1.87.907 3.051 3.189 3.602l1.87.44c1.402.33 1.87.825 1.87 1.65 0 .99-.962 1.4-2.776 1.4-2.694 0-3.822-1.413-4.453-3.382l-.907-2.749c-1.155-3.573-2.997-4.893-6.653-4.893C2.144 5.333 0 7.89 0 12.233c0 4.18 2.144 6.434 5.993 6.434 3.106 0 4.591-1.457 4.591-1.457z"/>
        </svg>
      </div>
      <div>
        <h3 className="text-white font-semibold">Entrar com Last.fm</h3>
        <p className="text-spotify-text text-xs">Sem limites, acesso completo</p>
      </div>
    </div>
    <LastfmInput onSuccess={handleLastfmSuccess} />
  </div>

  {/* Divider */}
  <div className="flex items-center gap-4">
    <div className="flex-1 h-px bg-white/10"></div>
    <span className="text-spotify-text text-sm">ou</span>
    <div className="flex-1 h-px bg-white/10"></div>
  </div>

  {/* Spotify Card (Secondary) */}
  <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
    <div className="flex items-center gap-3 mb-4">
      <div className="w-10 h-10 bg-[#1DB954]/20 rounded-full flex items-center justify-center">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-[#1DB954]">
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
        </svg>
      </div>
      <div>
        <h3 className="text-white font-semibold">Entrar com Spotify</h3>
        <p className="text-spotify-text text-xs">Cria playlists + analises</p>
      </div>
    </div>
    <SpotifyButton />
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/pages/Login.tsx
git commit -m "feat: dual login page with Last.fm primary and Spotify secondary"
```

---

## Task 16: Frontend — Auth Callback + Hub Updates

**Files:**
- Modify: `packages/frontend/src/pages/AuthCallback.tsx:1-23`
- Modify: `packages/frontend/src/pages/Hub.tsx:22-93`

- [ ] **Step 1: Update AuthCallback for userId**

In `packages/frontend/src/pages/AuthCallback.tsx`, add platform context:

```tsx
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePlatform } from "../context/PlatformContext";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { setSpotifyToken, setUserId } = usePlatform();

  useEffect(() => {
    const token = params.get("t") || "";
    const artists = params.get("artists") || "[]";
    const userId = params.get("userId");

    if (token) {
      setSpotifyToken(token);
      if (userId) setUserId(Number(userId));
    }

    navigate(`/hub?artists=${encodeURIComponent(artists)}`);
  }, []);

  return null;
}
```

- [ ] **Step 2: Add connection banner to Hub**

In `packages/frontend/src/pages/Hub.tsx`, add the import and banner logic:

```tsx
import { usePlatform } from "../context/PlatformContext";
import LastfmInput from "../components/LastfmInput";
```

In the component:

```tsx
const { hasSpotify, hasLastfm, hasBoth, setLastfmUser, setUserId, logout } = usePlatform();
const [bannerDismissed, setBannerDismissed] = useState(false);
```

Add the banner JSX (before the feature cards section):

```tsx
{/* Connection Banner */}
{!hasBoth && !bannerDismissed && (
  <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-4 mb-6 border border-white/10">
    {hasSpotify && !hasLastfm && (
      <div>
        <p className="text-white font-medium mb-2">
          Conecte seu Last.fm pra analises mais profundas
        </p>
        <p className="text-spotify-text text-sm mb-3">
          Play counts reais, tags, artistas similares e muito mais
        </p>
        <LastfmInput
          compact
          buttonText="Conectar"
          onSuccess={(userId, username) => {
            setLastfmUser(username);
            setUserId(userId);
          }}
        />
      </div>
    )}
    {hasLastfm && !hasSpotify && (
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white font-medium">Conecte o Spotify</p>
          <p className="text-spotify-text text-sm">
            Pra criar playlists e busca de musicas mais rica
          </p>
        </div>
        <a
          href={`${import.meta.env.VITE_API_URL || ""}/auth/login`}
          className="px-4 py-2 bg-[#1DB954] hover:bg-[#1ed760] rounded-full text-white text-sm font-medium transition-colors"
        >
          Conectar Spotify
        </a>
      </div>
    )}
    <button
      onClick={() => setBannerDismissed(true)}
      className="text-spotify-text text-xs mt-2 hover:text-white transition-colors"
    >
      Depois
    </button>
  </div>
)}
```

Replace the logout handler to use `usePlatform().logout`:

```tsx
const handleLogout = () => {
  logout();
  navigate("/");
};
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/pages/AuthCallback.tsx packages/frontend/src/pages/Hub.tsx
git commit -m "feat: AuthCallback handles userId, Hub shows connection banner"
```

---

## Task 17: Frontend — Settings Page

**Files:**
- Create: `packages/frontend/src/pages/Settings.tsx`
- Modify: `packages/frontend/src/components/Sidebar.tsx:10-18`

- [ ] **Step 1: Create Settings page**

Create `packages/frontend/src/pages/Settings.tsx`:

```tsx
import { ArrowLeft, Check } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePlatform } from "../context/PlatformContext";
import LastfmInput from "../components/LastfmInput";

const API_URL = import.meta.env.VITE_API_URL || "";

export default function Settings() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const hubData = params.get("hubData") || "";
  const { hasSpotify, hasLastfm, lastfmUser, setLastfmUser, setUserId, getHeaders } =
    usePlatform();

  const handleLinkLastfm = async (userId: number, username: string) => {
    setLastfmUser(username);
    setUserId(userId);
    // Link to existing user record
    await fetch(`${API_URL}/api/settings/link-lastfm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getHeaders() },
      body: JSON.stringify({ username }),
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-spotify-dark to-black p-4 sm:p-8">
      <div className="max-w-2xl mx-auto">
        <button
          onClick={() => navigate(`/hub${hubData ? `?hubData=${hubData}` : ""}`)}
          className="flex items-center gap-2 text-spotify-text hover:text-white mb-8 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          Voltar
        </button>

        <h1 className="text-2xl font-bold text-white mb-8">Configuracoes</h1>

        <div className="bg-white/5 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-6">
            Contas Conectadas
          </h2>

          {/* Last.fm */}
          <div className="flex items-center justify-between p-4 bg-black/20 rounded-xl mb-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  hasLastfm ? "bg-[#d51007]/20" : "bg-white/5"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className={`w-5 h-5 ${hasLastfm ? "fill-[#d51007]" : "fill-gray-500"}`}
                >
                  <path d="M10.584 17.21l-.88-2.392s-1.43 1.594-3.573 1.594c-1.897 0-3.244-1.649-3.244-4.288 0-3.382 1.704-4.591 3.381-4.591 2.422 0 3.19 1.567 3.849 3.574l.88 2.749c.88 2.666 2.529 4.81 7.285 4.81 3.409 0 5.718-1.044 5.718-3.793 0-2.227-1.265-3.381-3.63-3.932l-1.758-.385c-1.21-.275-1.567-.77-1.567-1.595 0-.934.742-1.484 1.952-1.484 1.32 0 2.034.495 2.144 1.677l2.749-.33c-.22-2.474-1.924-3.492-4.729-3.492-2.474 0-4.893.935-4.893 3.932 0 1.87.907 3.051 3.189 3.602l1.87.44c1.402.33 1.87.825 1.87 1.65 0 .99-.962 1.4-2.776 1.4-2.694 0-3.822-1.413-4.453-3.382l-.907-2.749c-1.155-3.573-2.997-4.893-6.653-4.893C2.144 5.333 0 7.89 0 12.233c0 4.18 2.144 6.434 5.993 6.434 3.106 0 4.591-1.457 4.591-1.457z" />
                </svg>
              </div>
              <div>
                <p className="text-white font-medium">Last.fm</p>
                <p className="text-spotify-text text-sm">
                  {hasLastfm ? lastfmUser : "Nao conectado"}
                </p>
              </div>
            </div>
            {hasLastfm ? (
              <Check className="w-5 h-5 text-[#d51007]" />
            ) : (
              <div className="w-64">
                <LastfmInput compact buttonText="Conectar" onSuccess={handleLinkLastfm} />
              </div>
            )}
          </div>

          {/* Spotify */}
          <div className="flex items-center justify-between p-4 bg-black/20 rounded-xl">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  hasSpotify ? "bg-[#1DB954]/20" : "bg-white/5"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className={`w-5 h-5 ${hasSpotify ? "fill-[#1DB954]" : "fill-gray-500"}`}
                >
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                </svg>
              </div>
              <div>
                <p className="text-white font-medium">Spotify</p>
                <p className="text-spotify-text text-sm">
                  {hasSpotify ? "Conectado" : "Nao conectado"}
                </p>
              </div>
            </div>
            {hasSpotify ? (
              <Check className="w-5 h-5 text-[#1DB954]" />
            ) : (
              <a
                href={`${API_URL}/auth/login`}
                className="px-4 py-2 bg-[#1DB954] hover:bg-[#1ed760] rounded-full text-white text-sm font-medium transition-colors"
              >
                Conectar
              </a>
            )}
          </div>
        </div>

        {!hasSpotify && (
          <p className="text-spotify-text text-sm mt-4 text-center">
            Sem Spotify, criacao de playlists nao esta disponivel.
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add Settings to Sidebar**

In `packages/frontend/src/components/Sidebar.tsx`, add to the NAV_ITEMS array (around line 10-18). Import the Settings icon from lucide-react:

```tsx
import { /* existing icons */, Settings } from "lucide-react";
```

Add to the array:

```typescript
{ path: "/settings", label: "Configuracoes", icon: Settings },
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/pages/Settings.tsx packages/frontend/src/components/Sidebar.tsx
git commit -m "feat: add Settings page and Sidebar nav item"
```

---

## Task 18: Frontend — Update All Pages to Use Platform Headers

**Files:**
- Modify: `packages/frontend/src/pages/Judge.tsx:51-90`
- Modify: `packages/frontend/src/pages/TasteAnalysis.tsx:88-107`
- Modify: `packages/frontend/src/pages/AudioFeatures.tsx:99-220`
- Modify: `packages/frontend/src/pages/TextToPlaylist.tsx:87-132`
- Modify: `packages/frontend/src/pages/PlaylistHistory.tsx:53-84`
- Modify: `packages/frontend/src/components/ArtistModal.tsx:43-54`

- [ ] **Step 1: Update every page that makes API calls**

In each file, add the import:

```tsx
import { usePlatform } from "../context/PlatformContext";
```

In each component, add:

```tsx
const { getHeaders } = usePlatform();
```

Then update every `fetch` call to include `...getHeaders()` in the headers object.

**Judge.tsx** — update the fetch in fetchAnalysis (around line 51-74):
```tsx
const res = await fetch(`${API_URL}/api/judge`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...getHeaders() },
  body: JSON.stringify({ artists }),
});
```

**TasteAnalysis.tsx** — update the fetch (around line 88-107):
```tsx
const res = await fetch(`${API_URL}/api/analyze-taste`, {
  headers: getHeaders(),
});
```

**AudioFeatures.tsx** — update search fetch (around line 99-124):
```tsx
const res = await fetch(`${API_URL}/api/search-tracks?q=${encodeURIComponent(query)}`, {
  headers: getHeaders(),
});
```

And the enqueue fetch (around line 181-220):
```tsx
const res = await fetch(`${API_URL}/api/enqueue-track/${trackId}`, {
  method: "POST",
  headers: getHeaders(),
});
```

**TextToPlaylist.tsx** — update generate fetch (around line 87-132):
```tsx
const res = await fetch(`${API_URL}/api/playlist/generate`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...getHeaders() },
  body: JSON.stringify({ description }),
});
```

Also add a check: if no Spotify, show generated tracks as "virtual playlist" without Spotify link:
```tsx
const { hasSpotify } = usePlatform();
// In the JSX, conditionally show Spotify button:
{playlist.spotify_url && hasSpotify && (
  <a href={playlist.spotify_url} ...>Abrir no Spotify</a>
)}
{!hasSpotify && (
  <p className="text-spotify-text text-sm">Conecte o Spotify nas configuracoes pra salvar playlists</p>
)}
```

**PlaylistHistory.tsx** — update fetches (around line 53-84):
```tsx
const res = await fetch(`${API_URL}/api/playlist/history`, {
  headers: getHeaders(),
});
```

**ArtistModal.tsx** — update fetch (around line 43-54):
```tsx
const res = await fetch(`${API_URL}/api/artist-details?name=${encodeURIComponent(artistName)}`, {
  headers: getHeaders(),
});
```

Also add rendering for Last.fm data if present in the response:
```tsx
{data.lastfm && (
  <>
    {data.lastfm.bio && (
      <p className="text-spotify-text text-sm mt-4" dangerouslySetInnerHTML={{ __html: data.lastfm.bio }} />
    )}
    {data.lastfm.tags?.length > 0 && (
      <div className="flex flex-wrap gap-1 mt-3">
        {data.lastfm.tags.map((tag: string) => (
          <span key={tag} className="px-2 py-0.5 bg-white/10 rounded-full text-xs text-spotify-text">{tag}</span>
        ))}
      </div>
    )}
    {data.lastfm.similar?.length > 0 && (
      <div className="mt-4">
        <h4 className="text-white text-sm font-medium mb-2">Artistas Similares</h4>
        <div className="flex flex-wrap gap-2">
          {data.lastfm.similar.slice(0, 5).map((s: any) => (
            <span key={s.name} className="px-2 py-1 bg-white/5 rounded-lg text-xs text-spotify-text">
              {s.name} ({Math.round(s.match * 100)}%)
            </span>
          ))}
        </div>
      </div>
    )}
  </>
)}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/pages/Judge.tsx packages/frontend/src/pages/TasteAnalysis.tsx packages/frontend/src/pages/AudioFeatures.tsx packages/frontend/src/pages/TextToPlaylist.tsx packages/frontend/src/pages/PlaylistHistory.tsx packages/frontend/src/components/ArtistModal.tsx
git commit -m "feat: all pages pass platform headers, ArtistModal shows Last.fm data"
```

---

## Task 19: Frontend — Hub Top Artists from Last.fm

**Files:**
- Modify: `packages/frontend/src/pages/Hub.tsx`

- [ ] **Step 1: Fetch top artists from Last.fm when no Spotify artists**

In `packages/frontend/src/pages/Hub.tsx`, add a useEffect that fetches Last.fm top artists when the user logged in via Last.fm (no artists from URL param):

```tsx
const { hasLastfm, lastfmUser, getHeaders } = usePlatform();
const [lastfmArtists, setLastfmArtists] = useState<any[]>([]);

useEffect(() => {
  // If no Spotify artists from URL and user has Last.fm, fetch from API
  if ((!artists || artists.length === 0) && hasLastfm) {
    fetch(`${API_URL}/api/lastfm/top-artists?username=${lastfmUser}`, {
      headers: getHeaders(),
    })
      .then((r) => r.json())
      .then((data) => setLastfmArtists(data.artists || []))
      .catch(() => {});
  }
}, [hasLastfm, lastfmUser]);
```

- [ ] **Step 2: Add the /api/lastfm/top-artists backend endpoint**

In `packages/backend/src/index.ts`, add:

```typescript
app.get("/api/lastfm/top-artists", async (req, res) => {
  const username = (req.query.username as string) || (req.headers["x-lastfm-user"] as string);
  if (!username) return res.status(400).json({ error: "username required" });

  try {
    const lastfm = await import("./lastfm.js");
    const period = (req.query.period as string) || "3month";
    const artists = await lastfm.getTopArtists(username, period as any, 10);

    // Enrich with tags
    const enriched = await Promise.all(
      artists.map(async (a) => {
        const info = await lastfm.getArtistInfo(a.name);
        return {
          name: a.name,
          image: a.image || info?.image || "",
          genres: info?.tags?.slice(0, 3) || [],
          playcount: a.playcount,
        };
      })
    );

    res.json({ artists: enriched });
  } catch (err: any) {
    console.error("Last.fm top artists error:", err.message);
    res.status(500).json({ error: "Failed to get top artists" });
  }
});
```

- [ ] **Step 3: Display Last.fm artists in Hub**

In Hub.tsx, use `lastfmArtists` as fallback when `artists` is empty:

```tsx
const displayArtists = artists.length > 0 ? artists : lastfmArtists;
```

Use `displayArtists` in the ArtistCard rendering section. For Last.fm artists, the card structure is `{name, image, genres}` which matches what ArtistCard expects.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/pages/Hub.tsx packages/backend/src/index.ts
git commit -m "feat: Hub displays Last.fm top artists with tags when no Spotify data"
```

---

## Task 20: Final Integration & Verification

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Ensure .env has LASTFM_API_KEY**

Verify `.env` file has the key:

```bash
grep LASTFM_API_KEY .env || echo "LASTFM_API_KEY=your_key_here" >> .env
```

- [ ] **Step 2: Full stack smoke test**

```bash
docker compose up -d
pnpm dev:backend &
pnpm dev:frontend &

# 1. Test Last.fm login
curl -X POST http://127.0.0.1:3000/auth/lastfm/login \
  -H "Content-Type: application/json" \
  -d '{"username":"rj"}'

# 2. Test Last.fm top artists
curl "http://127.0.0.1:3000/api/lastfm/top-artists?username=rj"

# 3. Test Last.fm search fallback (no auth header)
curl "http://127.0.0.1:3000/api/search-tracks?q=radiohead"

# 4. Test artist details with Last.fm enrichment
curl "http://127.0.0.1:3000/api/artist-details?name=Radiohead" \
  -H "X-Lastfm-User: rj"

# 5. Open browser and test:
open http://127.0.0.1:5173
# - Login with Last.fm username
# - Verify Hub shows artists
# - Navigate to Judge, verify roast includes play counts
# - Navigate to Settings, verify both platform statuses
# - Try Audio Analysis search without Spotify
```

- [ ] **Step 3: Final commit**

```bash
git add -A
git status
# Review all changes, then:
git commit -m "feat: Last.fm integration complete — login, enrichment, search fallback"
```

---

## Summary

| # | Task | Key Deliverable |
|---|------|----------------|
| 1 | Database migration | users table, lastfm_cache, schema changes |
| 2 | Config & env | LASTFM_API_KEY in config |
| 3 | lastfm.ts client | Full Last.fm API client with caching + rate limiting |
| 4 | Last.fm auth routes | Username validation + login + auto-enqueue |
| 5 | Spotify auth update | User record creation on OAuth callback |
| 6 | Settings routes | Account linking API |
| 7 | Enriched judge | Roast with play counts and stats |
| 8 | Enriched analyze-taste | Last.fm as data source with tags |
| 9 | Search fallback | Last.fm search when no Spotify token |
| 10 | Enriched artist details | Bio, tags, similar artists from Last.fm |
| 11 | Worker cache cleanup | Expired cache entries cleaned every cycle |
| 12 | Platform context | React context for multi-platform state |
| 13 | App wrapper | PlatformProvider + Settings route |
| 14 | LastfmInput component | Reusable username input |
| 15 | Dual login page | Last.fm primary + Spotify secondary |
| 16 | AuthCallback + Hub banner | userId handling + connection prompt |
| 17 | Settings page | Connected accounts management |
| 18 | All pages headers | Platform headers on every API call |
| 19 | Hub Last.fm artists | Top artists + tags from Last.fm |
| 20 | Final integration | Smoke test full stack |
