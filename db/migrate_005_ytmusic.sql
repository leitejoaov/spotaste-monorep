-- Add ytmusic to users table
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN ytmusic_channel_id VARCHAR(128) UNIQUE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Cross-platform track mapping
CREATE TABLE IF NOT EXISTS track_mapping (
  id SERIAL PRIMARY KEY,
  spotify_id VARCHAR(64),
  youtube_id VARCHAR(64),
  lastfm_key VARCHAR(128),
  track_name TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  matched_at TIMESTAMP DEFAULT NOW(),
  match_confidence REAL DEFAULT 1.0,
  UNIQUE(spotify_id, youtube_id)
);
CREATE INDEX IF NOT EXISTS idx_track_mapping_spotify ON track_mapping(spotify_id);
CREATE INDEX IF NOT EXISTS idx_track_mapping_youtube ON track_mapping(youtube_id);
CREATE INDEX IF NOT EXISTS idx_track_mapping_lastfm ON track_mapping(lastfm_key);

-- Add youtube_id and platform_source to track_features
DO $$ BEGIN
  ALTER TABLE track_features ADD COLUMN youtube_id VARCHAR(64);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE track_features ADD COLUMN platform_source VARCHAR(16) DEFAULT 'spotify';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Add platform to playlists
DO $$ BEGIN
  ALTER TABLE playlists ADD COLUMN platform VARCHAR(16) DEFAULT 'spotify';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
