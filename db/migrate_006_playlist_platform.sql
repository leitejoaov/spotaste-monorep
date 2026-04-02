-- Add platform column to playlists (spotify, ytmusic, lastfm)
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'spotify';

-- Allow null vibe_profile (artist mode playlists don't have one)
ALTER TABLE playlists ALTER COLUMN vibe_profile DROP NOT NULL;
