-- Add lyrics analysis columns to track_features
ALTER TABLE track_features ADD COLUMN IF NOT EXISTS lyrics_tags TEXT[] DEFAULT '{}';
ALTER TABLE track_features ADD COLUMN IF NOT EXISTS lyrics_language TEXT;
