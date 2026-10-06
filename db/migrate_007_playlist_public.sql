-- Add is_public flag to playlists (default true = visible to everyone)
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true;
