CREATE TABLE IF NOT EXISTS judge_cache (
  user_spotify_id  TEXT PRIMARY KEY,
  artists_hash     TEXT NOT NULL,
  result_text      TEXT NOT NULL,
  created_at       TIMESTAMP DEFAULT NOW()
);
