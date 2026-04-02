import pg from "pg";
import { createHash } from "crypto";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://spotaste:spotaste@localhost:5432/spotaste";

const pool = new pg.Pool({ connectionString: DATABASE_URL });

export async function initDb(): Promise<void> {
  const schema = readFileSync(
    resolve(__dirname, "../../../db/schema.sql"),
    "utf-8"
  );
  await pool.query(schema);

  // Run migrations
  const migrationPath = resolve(__dirname, "../../../db/migrate_001_add_moods.sql");
  if (existsSync(migrationPath)) {
    await pool.query(readFileSync(migrationPath, "utf-8"));
    console.log("[db] migration 001 applied");
  }

  const migration002Path = resolve(__dirname, "../../../db/migrate_002_playlists.sql");
  if (existsSync(migration002Path)) {
    await pool.query(readFileSync(migration002Path, "utf-8"));
    console.log("[db] migration 002 applied");
  }

  const migration003Path = resolve(__dirname, "../../../db/migrate_003_judge_cache.sql");
  if (existsSync(migration003Path)) {
    await pool.query(readFileSync(migration003Path, "utf-8"));
    console.log("[db] migration 003 applied");
  }

  const migrate004 = resolve(__dirname, "../../../db/migrate_004_lastfm.sql");
  if (existsSync(migrate004)) {
    await pool.query(readFileSync(migrate004, "utf-8"));
    console.log("Migration 004 applied (lastfm)");
  }

  const migration005Path = resolve(__dirname, "../../../db/migrate_005_ytmusic.sql");
  if (existsSync(migration005Path)) {
    await pool.query(readFileSync(migration005Path, "utf-8"));
    console.log("[db] migration 005 applied");
  }

  const migration006Path = resolve(__dirname, "../../../db/migrate_006_playlist_platform.sql");
  if (existsSync(migration006Path)) {
    await pool.query(readFileSync(migration006Path, "utf-8"));
    console.log("[db] migration 006 applied");
  }

  const migration007Path = resolve(__dirname, "../../../db/migrate_007_playlist_public.sql");
  if (existsSync(migration007Path)) {
    await pool.query(readFileSync(migration007Path, "utf-8"));
    console.log("[db] migration 007 applied");
  }

  const migration008Path = resolve(__dirname, "../../../db/migrate_008_fix_platform.sql");
  if (existsSync(migration008Path)) {
    await pool.query(readFileSync(migration008Path, "utf-8"));
    console.log("[db] migration 008 applied");
  }

  console.log("[db] schema initialized");
}

export interface TrackFeatures {
  spotify_id: string;
  track_name: string;
  artist_name: string;
  bpm: number;
  key: string;
  mode: string;
  energy: number;
  danceability: number;
  loudness: number;
  mood_happy: number | null;
  mood_sad: number | null;
  mood_aggressive: number | null;
  mood_relaxed: number | null;
  mood_party: number | null;
  voice_instrumental: number | null;
  mood_acoustic: number | null;
  analyzed_at: string;
}

export async function getTrackFeatures(
  spotifyId: string
): Promise<TrackFeatures | null> {
  const { rows } = await pool.query(
    "SELECT * FROM track_features WHERE spotify_id = $1",
    [spotifyId]
  );
  return rows[0] || null;
}

export async function saveTrackFeatures(
  spotifyId: string,
  trackName: string,
  artistName: string,
  features: {
    bpm: number;
    key: string;
    mode: string;
    energy: number;
    danceability: number;
    loudness: number;
    mood_happy?: number;
    mood_sad?: number;
    mood_aggressive?: number;
    mood_relaxed?: number;
    mood_party?: number;
    voice_instrumental?: number;
    mood_acoustic?: number;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO track_features
       (spotify_id, track_name, artist_name, bpm, key, mode, energy, danceability, loudness,
        mood_happy, mood_sad, mood_aggressive, mood_relaxed, mood_party, voice_instrumental, mood_acoustic)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (spotify_id) DO UPDATE SET
       bpm = EXCLUDED.bpm, key = EXCLUDED.key, mode = EXCLUDED.mode,
       energy = EXCLUDED.energy, danceability = EXCLUDED.danceability,
       loudness = EXCLUDED.loudness,
       mood_happy = EXCLUDED.mood_happy, mood_sad = EXCLUDED.mood_sad,
       mood_aggressive = EXCLUDED.mood_aggressive, mood_relaxed = EXCLUDED.mood_relaxed,
       mood_party = EXCLUDED.mood_party, voice_instrumental = EXCLUDED.voice_instrumental,
       mood_acoustic = EXCLUDED.mood_acoustic, analyzed_at = NOW()`,
    [
      spotifyId,
      trackName,
      artistName,
      features.bpm,
      features.key,
      features.mode,
      features.energy,
      features.danceability,
      features.loudness,
      features.mood_happy ?? null,
      features.mood_sad ?? null,
      features.mood_aggressive ?? null,
      features.mood_relaxed ?? null,
      features.mood_party ?? null,
      features.voice_instrumental ?? null,
      features.mood_acoustic ?? null,
    ]
  );
}

export interface QueueItem {
  spotify_id: string;
  track_name: string;
  artist_name: string;
}

export async function trackExistsByName(
  trackName: string,
  artistName: string
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM track_features
     WHERE LOWER(track_name) = LOWER($1) AND LOWER(artist_name) = LOWER($2)
     LIMIT 1`,
    [trackName, artistName]
  );
  if (rows.length > 0) return true;
  // Also check queue
  const { rows: queueRows } = await pool.query(
    `SELECT 1 FROM analysis_queue
     WHERE LOWER(track_name) = LOWER($1) AND LOWER(artist_name) = LOWER($2)
     LIMIT 1`,
    [trackName, artistName]
  );
  return queueRows.length > 0;
}

export async function addToQueue(
  spotifyId: string,
  trackName: string,
  artistName: string
): Promise<void> {
  await pool.query(
    `INSERT INTO analysis_queue (spotify_id, track_name, artist_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (spotify_id) DO NOTHING`,
    [spotifyId, trackName, artistName]
  );
}

export async function getPendingQueue(): Promise<QueueItem[]> {
  const { rows } = await pool.query(
    `SELECT spotify_id, track_name, artist_name FROM analysis_queue
     WHERE status = 'pending' ORDER BY created_at LIMIT 5`
  );
  return rows;
}

export async function updateQueueStatus(
  spotifyId: string,
  status: "processing" | "done" | "failed"
): Promise<void> {
  await pool.query(
    "UPDATE analysis_queue SET status = $1 WHERE spotify_id = $2",
    [status, spotifyId]
  );
}

export async function resetStuckProcessing(): Promise<number> {
  const { rowCount } = await pool.query(
    "UPDATE analysis_queue SET status = 'pending' WHERE status = 'processing'"
  );
  return rowCount ?? 0;
}

export async function getQueueStatus(): Promise<Record<string, number>> {
  const { rows } = await pool.query(
    `SELECT status, COUNT(*)::int as count FROM analysis_queue GROUP BY status`
  );
  const { rows: moodRows } = await pool.query(
    `SELECT COUNT(*)::int as count FROM track_features WHERE mood_happy IS NULL`
  );
  const result: Record<string, number> = {
    pending: 0,
    processing: 0,
    done: 0,
    failed: 0,
    reanalyzing: moodRows[0]?.count || 0,
  };
  for (const row of rows) {
    result[row.status] = row.count;
  }
  return result;
}

export async function getTracksWithoutMoods(): Promise<TrackFeatures[]> {
  const { rows } = await pool.query(
    `SELECT * FROM track_features WHERE mood_happy IS NULL ORDER BY analyzed_at LIMIT 5`
  );
  return rows;
}

export async function getAllTrackFeatures(
  search?: string,
  page = 1,
  limit = 20
): Promise<{ tracks: TrackFeatures[]; total: number }> {
  const offset = (page - 1) * limit;
  if (search) {
    const pattern = `%${search.toLowerCase()}%`;
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM track_features WHERE LOWER(track_name) LIKE $1 OR LOWER(artist_name) LIKE $1`,
      [pattern]
    );
    const { rows } = await pool.query(
      `SELECT * FROM track_features
       WHERE LOWER(track_name) LIKE $1 OR LOWER(artist_name) LIKE $1
       ORDER BY analyzed_at DESC LIMIT $2 OFFSET $3`,
      [pattern, limit, offset]
    );
    return { tracks: rows, total: Number(countRes.rows[0].count) };
  }
  const countRes = await pool.query("SELECT COUNT(*) FROM track_features");
  const { rows } = await pool.query(
    "SELECT * FROM track_features ORDER BY analyzed_at DESC LIMIT $1 OFFSET $2",
    [limit, offset]
  );
  return { tracks: rows, total: Number(countRes.rows[0].count) };
}

// --- Playlist functions ---

export interface PlaylistRow {
  id: number;
  user_spotify_id: string;
  user_id?: number;
  description: string;
  vibe_profile: any;
  spotify_playlist_id: string | null;
  spotify_url: string | null;
  track_count: number;
  vibe_accuracy: number | null;
  music_accuracy: number | null;
  created_at: string;
}

export interface PlaylistTrackRow {
  id: number;
  playlist_id: number;
  spotify_id: string;
  track_name: string;
  artist_name: string;
  position: number;
  score: number;
  rating: string | null;
  rated_at: string | null;
}

export async function savePlaylist(
  userSpotifyId: string,
  description: string,
  vibeProfile: any,
  spotifyPlaylistId: string | null,
  spotifyUrl: string | null,
  tracks: { spotify_id: string; track_name: string; artist_name: string; score: number }[],
  platform: string = "spotify",
  isPublic: boolean = true
): Promise<PlaylistRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `INSERT INTO playlists (user_spotify_id, description, vibe_profile, spotify_playlist_id, spotify_url, track_count, platform, is_public)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [userSpotifyId, description, vibeProfile ? JSON.stringify(vibeProfile) : null, spotifyPlaylistId, spotifyUrl, tracks.length, platform, isPublic]
    );
    const playlist = rows[0] as PlaylistRow;

    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      await client.query(
        `INSERT INTO playlist_tracks (playlist_id, spotify_id, track_name, artist_name, position, score)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [playlist.id, t.spotify_id, t.track_name, t.artist_name, i + 1, t.score]
      );
    }

    await client.query("COMMIT");
    return playlist;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getPlaylistsByUser(userSpotifyId: string): Promise<PlaylistRow[]> {
  const { rows } = await pool.query(
    "SELECT * FROM playlists WHERE user_spotify_id = $1 ORDER BY created_at DESC",
    [userSpotifyId]
  );
  return rows;
}

export async function getPublicPlaylists(limit = 50, offset = 0): Promise<PlaylistRow[]> {
  const { rows } = await pool.query(
    "SELECT * FROM playlists WHERE is_public = true ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    [limit, offset]
  );
  return rows;
}

export async function getPlaylistWithTracks(
  playlistId: number
): Promise<{ playlist: PlaylistRow; tracks: PlaylistTrackRow[] } | null> {
  const { rows: pRows } = await pool.query(
    "SELECT * FROM playlists WHERE id = $1",
    [playlistId]
  );
  if (pRows.length === 0) return null;

  const { rows: tRows } = await pool.query(
    "SELECT * FROM playlist_tracks WHERE playlist_id = $1 ORDER BY position",
    [playlistId]
  );
  return { playlist: pRows[0], tracks: tRows };
}

export async function rateTrack(
  playlistId: number,
  spotifyId: string,
  rating: string
): Promise<{ vibe_accuracy: number | null; music_accuracy: number | null }> {
  await pool.query(
    `UPDATE playlist_tracks SET rating = $1, rated_at = NOW()
     WHERE playlist_id = $2 AND spotify_id = $3`,
    [rating, playlistId, spotifyId]
  );

  // Recalculate accuracy
  await pool.query(
    `UPDATE playlists SET
      vibe_accuracy = (
        SELECT COUNT(*) FILTER (WHERE rating IN ('liked_right_vibe','right_vibe','bad_song_right_vibe'))
        * 100.0 / NULLIF(COUNT(*) FILTER (WHERE rating IS NOT NULL), 0)
        FROM playlist_tracks WHERE playlist_id = $1
      ),
      music_accuracy = (
        SELECT COUNT(*) FILTER (WHERE rating IN ('liked_right_vibe','liked_song','liked_wrong_vibe'))
        * 100.0 / NULLIF(COUNT(*) FILTER (WHERE rating IS NOT NULL), 0)
        FROM playlist_tracks WHERE playlist_id = $1
      )
    WHERE id = $1`,
    [playlistId]
  );

  const { rows } = await pool.query(
    "SELECT vibe_accuracy, music_accuracy FROM playlists WHERE id = $1",
    [playlistId]
  );
  return rows[0];
}

// --- Judge cache ---

const JUDGE_CACHE_DAYS = 30;

export function hashArtists(artists: { name: string }[]): string {
  const sorted = artists.map((a) => a.name.toLowerCase()).sort().join("|");
  return createHash("md5").update(sorted).digest("hex");
}

export async function getCachedJudge(
  userId: string,
  artistsHash: string
): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT result_text FROM judge_cache
     WHERE user_spotify_id = $1
       AND artists_hash = $2
       AND created_at > NOW() - $3 * INTERVAL '1 day'`,
    [userId, artistsHash, JUDGE_CACHE_DAYS]
  );
  return rows[0]?.result_text ?? null;
}

export async function setCachedJudge(
  userId: string,
  artistsHash: string,
  result: string
): Promise<void> {
  await pool.query(
    `INSERT INTO judge_cache (user_spotify_id, artists_hash, result_text, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_spotify_id) DO UPDATE SET
       artists_hash = EXCLUDED.artists_hash,
       result_text = EXCLUDED.result_text,
       created_at = NOW()`,
    [userId, artistsHash, result]
  );
}

// ============ USERS ============

export interface User {
  id: number;
  lastfm_username: string | null;
  spotify_user_id: string | null;
  ytmusic_channel_id?: string;
  primary_platform: string;
  created_at: string;
}

export async function findOrCreateUser(
  platform: "lastfm" | "spotify" | "ytmusic",
  identifier: string
): Promise<User> {
  const col = platform === "lastfm" ? "lastfm_username"
    : platform === "ytmusic" ? "ytmusic_channel_id"
    : "spotify_user_id";
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
  platform: "lastfm" | "spotify" | "ytmusic",
  identifier: string
): Promise<User> {
  const col = platform === "lastfm" ? "lastfm_username"
    : platform === "ytmusic" ? "ytmusic_channel_id"
    : "spotify_user_id";
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
  top_artists: 6 * 60 * 60,
  top_tracks: 6 * 60 * 60,
  recent_tracks: 5 * 60,
  loved_tracks: 60 * 60,
  artist_info: 7 * 24 * 60 * 60,
  track_info: 7 * 24 * 60 * 60,
  user_info: 24 * 60 * 60,
};

function getCacheTTL(cacheKey: string): number {
  for (const [prefix, ttl] of Object.entries(CACHE_TTLS)) {
    if (cacheKey.startsWith(prefix)) return ttl;
  }
  return 60 * 60;
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

// --- Track Mapping ---

export async function findTrackMapping(opts: {
  spotifyId?: string;
  youtubeId?: string;
  lastfmKey?: string;
}): Promise<any | null> {
  if (opts.spotifyId) {
    const { rows } = await pool.query("SELECT * FROM track_mapping WHERE spotify_id = $1", [opts.spotifyId]);
    if (rows.length > 0) return rows[0];
  }
  if (opts.youtubeId) {
    const { rows } = await pool.query("SELECT * FROM track_mapping WHERE youtube_id = $1", [opts.youtubeId]);
    if (rows.length > 0) return rows[0];
  }
  if (opts.lastfmKey) {
    const { rows } = await pool.query("SELECT * FROM track_mapping WHERE lastfm_key = $1", [opts.lastfmKey]);
    if (rows.length > 0) return rows[0];
  }
  return null;
}

export async function createTrackMapping(
  spotifyId: string | null,
  youtubeId: string | null,
  lastfmKey: string | null,
  trackName: string,
  artistName: string,
  confidence = 1.0
): Promise<void> {
  await pool.query(
    `INSERT INTO track_mapping (spotify_id, youtube_id, lastfm_key, track_name, artist_name, match_confidence)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [spotifyId, youtubeId, lastfmKey, trackName, artistName, confidence]
  );
}

export async function getTracksWithoutSpotifyId(limit = 50): Promise<TrackFeatures[]> {
  const { rows } = await pool.query(
    `SELECT * FROM track_features
     WHERE (spotify_id LIKE 'lastfm_%' OR spotify_id LIKE 'ytmusic_%')
     ORDER BY analyzed_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function updateTrackSpotifyId(oldId: string, newSpotifyId: string): Promise<void> {
  await pool.query(
    "UPDATE track_features SET spotify_id = $1 WHERE spotify_id = $2",
    [newSpotifyId, oldId]
  );
}
