-- Fix platform for existing YouTube Music playlists based on their URL
UPDATE playlists SET platform = 'ytmusic' WHERE spotify_url LIKE '%music.youtube.com%' AND (platform IS NULL OR platform = 'spotify');
