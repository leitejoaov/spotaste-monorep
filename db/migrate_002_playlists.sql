CREATE TABLE IF NOT EXISTS playlists (
  id                SERIAL PRIMARY KEY,
  user_spotify_id   TEXT NOT NULL,
  description       TEXT NOT NULL,
  vibe_profile      JSONB NOT NULL,
  spotify_playlist_id TEXT,
  spotify_url       TEXT,
  track_count       INT DEFAULT 0,
  vibe_accuracy     REAL,
  music_accuracy    REAL,
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  id          SERIAL PRIMARY KEY,
  playlist_id INT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  spotify_id  TEXT NOT NULL,
  track_name  TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  position    INT NOT NULL,
  score       REAL NOT NULL,
  rating      TEXT,
  rated_at    TIMESTAMP,
  UNIQUE(playlist_id, spotify_id)
);

CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_spotify_id);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id);
