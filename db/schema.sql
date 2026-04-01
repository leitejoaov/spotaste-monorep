CREATE TABLE IF NOT EXISTS track_features (
  spotify_id     TEXT PRIMARY KEY,
  track_name     TEXT NOT NULL,
  artist_name    TEXT NOT NULL,
  bpm            REAL,
  key            TEXT,
  mode           TEXT,
  energy         REAL,
  danceability   REAL,
  loudness       REAL,
  mood_happy     REAL,
  mood_sad       REAL,
  mood_aggressive REAL,
  mood_relaxed   REAL,
  mood_party     REAL,
  voice_instrumental REAL,
  mood_acoustic  REAL,
  analyzed_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analysis_queue (
  id             SERIAL PRIMARY KEY,
  spotify_id     TEXT NOT NULL,
  track_name     TEXT NOT NULL,
  artist_name    TEXT NOT NULL,
  status         TEXT DEFAULT 'pending',
  created_at     TIMESTAMP DEFAULT NOW(),
  UNIQUE(spotify_id)
);
