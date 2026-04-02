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
