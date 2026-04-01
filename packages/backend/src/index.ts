import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.js";
import lastfmAuthRouter from "./routes/auth-lastfm.js";
import settingsRouter from "./routes/settings.js";
import { getTopTracks, getSpotifyUserId, getTrackDetails, searchTracks, createPlaylist, addTracksToPlaylist, searchArtist, getArtistTopTracks } from "./spotify.js";
import { getMusicTasteAnalysis, getEnrichedMusicTasteAnalysis } from "./judge.js";
import { getTopArtists as lfmGetTopArtists, validateUser as lfmValidateUser, getTopTracks as lfmGetTopTracks, getTrackInfo as lfmGetTrackInfo, searchTrack as lfmSearchTrack, getArtistInfo as lfmGetArtistInfo, getArtistTopTracks as lfmGetArtistTopTracks } from "./lastfm.js";
import { analyzeTaste, generateVibeProfile } from "./claude.js";
import { getCachedAnalysis, setCachedAnalysis } from "./cache.js";
import { analyzeWithEssentia } from "./essentia.js";
import { initDb, getTrackFeatures, saveTrackFeatures, getQueueStatus, getAllTrackFeatures, addToQueue, savePlaylist, getPlaylistsByUser, getPlaylistWithTracks, rateTrack, getCachedJudge, setCachedJudge, hashArtists } from "./db.js";
import { startWorker } from "./worker.js";
import { matchTracks } from "./matcher.js";

const app = express();

// Rate limiters
const apiLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });
const claudeLimiter = rateLimit({ windowMs: 60_000, max: 10, message: { error: "Muitas requisicoes. Tente novamente em 1 minuto." } });

app.use(cors({ origin: config.frontendUrl }));
app.use(express.json());
app.use("/api/", apiLimiter);

app.use("/auth", authRouter);
app.use(lastfmAuthRouter);
app.use(settingsRouter);

app.post("/api/judge", claudeLimiter, async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const lastfmUser = req.headers["x-lastfm-user"] as string | undefined;
  const userId_header = req.headers["x-user-id"] as string | undefined;
  const { artists } = req.body;
  if (!artists || !Array.isArray(artists) || artists.length > 50) {
    res.status(400).json({ error: "Missing or invalid artists data" });
    return;
  }

  try {
    // Determine cache user ID
    let cacheUserId: string | null = null;
    if (token) {
      cacheUserId = await getSpotifyUserId(token);
    } else if (lastfmUser) {
      cacheUserId = `lastfm_${lastfmUser}`;
    } else if (userId_header) {
      cacheUserId = userId_header;
    }

    // Check cache
    if (cacheUserId) {
      const artHash = hashArtists(artists);
      const cached = await getCachedJudge(cacheUserId, artHash);
      if (cached) {
        console.log("[judge] cache hit for", cacheUserId);
        res.json({ analysis: cached });
        return;
      }

      console.log("[judge] cache miss for", cacheUserId);

      let analysis: string;
      if (lastfmUser) {
        // Enriched roast with Last.fm play counts
        const userInfo = await lfmValidateUser(lastfmUser);
        const lfmArtists = await lfmGetTopArtists(lastfmUser, "overall", 50);
        // Merge Last.fm play counts into request artists
        const enrichedArtists = artists.map((a: any) => {
          const lfmMatch = lfmArtists.find(
            (la) => la.name.toLowerCase() === a.name.toLowerCase()
          );
          return {
            name: a.name,
            genres: a.genres || [],
            playcount: lfmMatch?.playcount,
          };
        });
        analysis = await getEnrichedMusicTasteAnalysis(
          enrichedArtists,
          userInfo?.playcount,
          userInfo?.registered
        );
      } else {
        analysis = await getMusicTasteAnalysis(artists);
      }

      await setCachedJudge(cacheUserId, artHash, analysis);
      res.json({ analysis });
      return;
    }

    // No token, no lastfm — just generate without caching
    const analysis = await getMusicTasteAnalysis(artists);
    res.json({ analysis });
  } catch (error: any) {
    console.error("[judge] ERROR:", error);
    res.status(500).json({ error: "Failed to generate analysis" });
  }
});

app.get("/api/analyze-taste", claudeLimiter, async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Missing access token" });
    return;
  }

  try {
    const userId = await getSpotifyUserId(token);
    const cached = await getCachedAnalysis(userId);

    if (cached) {
      console.log("[analyze-taste] cache hit for", userId);
      const tracks = await getTopTracks(token);
      for (let i = 0; i < cached.tracks.length && i < tracks.length; i++) {
        cached.tracks[i].albumImage = tracks[i].album?.images?.[1]?.url
          ?? tracks[i].album?.images?.[0]?.url ?? null;
        cached.tracks[i].spotifyId = tracks[i].id;

        // Refresh Essentia data (may have been analyzed after cache)
        const real = await getTrackFeatures(tracks[i].id);
        if (real) {
          cached.tracks[i].essentia = {
            bpm: real.bpm,
            key: real.key,
            mode: real.mode,
            energy: real.energy,
            danceability: real.danceability,
            loudness: real.loudness,
            mood_happy: real.mood_happy,
            mood_sad: real.mood_sad,
            mood_aggressive: real.mood_aggressive,
            mood_relaxed: real.mood_relaxed,
            mood_party: real.mood_party,
            voice_instrumental: real.voice_instrumental,
            mood_acoustic: real.mood_acoustic,
          };
        }
      }
      res.json(cached);
      return;
    }

    console.log("[analyze-taste] cache miss for", userId);
    const tracks = await getTopTracks(token);
    const analysis = await analyzeTaste(tracks);

    // Enrich with album images and real Essentia data
    for (let i = 0; i < analysis.tracks.length && i < tracks.length; i++) {
      const t = analysis.tracks[i] as any;
      t.albumImage = tracks[i].album?.images?.[1]?.url
        ?? tracks[i].album?.images?.[0]?.url ?? null;
      t.spotifyId = tracks[i].id;

      // Attach real Essentia features if available
      const real = await getTrackFeatures(tracks[i].id);
      if (real) {
        t.essentia = {
          bpm: real.bpm,
          key: real.key,
          mode: real.mode,
          energy: real.energy,
          danceability: real.danceability,
          loudness: real.loudness,
          mood_happy: real.mood_happy,
          mood_sad: real.mood_sad,
          mood_aggressive: real.mood_aggressive,
          mood_relaxed: real.mood_relaxed,
          mood_party: real.mood_party,
          voice_instrumental: real.voice_instrumental,
          mood_acoustic: real.mood_acoustic,
        };
      }
    }

    await setCachedAnalysis(userId, analysis);
    res.json(analysis);
  } catch (error: any) {
    console.error("[analyze-taste] ERROR:", error);
    const status = error.response?.status || 500;
    res.status(status).json({ error: error.message || "Failed to analyze taste" });
  }
});

app.get("/api/search-tracks", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Missing access token" });
    return;
  }

  const q = req.query.q as string;
  if (!q || q.trim().length < 2) {
    res.json([]);
    return;
  }

  try {
    const results = await searchTracks(token, q);
    res.json(results.map((t) => ({
      id: t.id,
      name: t.name,
      artist: t.artists[0]?.name || "Unknown",
      album: t.album.name,
      image: t.album.images?.[2]?.url ?? t.album.images?.[0]?.url ?? null,
    })));
  } catch (error: any) {
    console.error("[search] ERROR:", error.message);
    res.status(error.response?.status || 500).json({ error: "Search failed" });
  }
});

app.get("/api/audio-features-essentia/:trackId", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Missing access token" });
    return;
  }

  try {
    const { trackId } = req.params;

    // Check PostgreSQL cache first
    const cached = await getTrackFeatures(trackId);
    if (cached) {
      console.log(`[essentia] cache hit: ${cached.track_name}`);
      res.json({
        bpm: cached.bpm,
        key: cached.key,
        mode: cached.mode,
        energy: cached.energy,
        danceability: cached.danceability,
        loudness: cached.loudness,
        source: "cache",
      });
      return;
    }

    // Cache miss — get track info from Spotify and analyze
    const track = await getTrackDetails(token, trackId);
    const trackName = track.name;
    const artistName = track.artists[0]?.name || "Unknown";

    console.log(`[essentia] analyzing: ${trackName} - ${artistName}`);
    const features = await analyzeWithEssentia(trackName, artistName);

    // Save to PostgreSQL
    await saveTrackFeatures(trackId, trackName, artistName, features);

    res.json({ ...features, source: "essentia" });
  } catch (error: any) {
    const status = error.response?.status || 500;
    const message = error.response?.data?.error || error.message || "Analysis failed";
    console.error("[essentia] ERROR:", message);
    res.status(status).json({ error: message });
  }
});

// Enqueue a track for background analysis — returns immediately
app.post("/api/enqueue-track/:trackId", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Missing access token" });
    return;
  }

  try {
    const { trackId } = req.params;

    // Already analyzed?
    const cached = await getTrackFeatures(trackId);
    if (cached) {
      res.json({ spotify_id: trackId, track_name: cached.track_name, artist_name: cached.artist_name, status: "done", features: cached });
      return;
    }

    // Get track info from Spotify and enqueue
    const track = await getTrackDetails(token, trackId);
    const trackName = track.name;
    const artistName = track.artists[0]?.name || "Unknown";
    const albumImage = track.album?.images?.[1]?.url ?? track.album?.images?.[0]?.url ?? null;

    await addToQueue(trackId, trackName, artistName);
    console.log(`[enqueue] queued: ${trackName} - ${artistName}`);

    res.json({ spotify_id: trackId, track_name: trackName, artist_name: artistName, album_image: albumImage, status: "pending" });
  } catch (error: any) {
    const status = error.response?.status || 500;
    const message = error.response?.data?.error?.message || error.message || "Failed to enqueue";
    console.error("[enqueue] ERROR:", message);
    res.status(status).json({ error: message });
  }
});

// Check analysis status for a specific track
app.get("/api/track-status/:trackId", async (req, res) => {
  try {
    const { trackId } = req.params;
    const features = await getTrackFeatures(trackId);
    if (features && features.mood_happy !== null) {
      res.json({ status: "done", features });
    } else if (features) {
      res.json({ status: "done_partial", features });
    } else {
      res.json({ status: "pending" });
    }
  } catch (error: any) {
    console.error("[track-status] ERROR:", error);
    res.status(500).json({ error: "Failed to check status" });
  }
});

app.get("/api/queue-status", async (_req, res) => {
  try {
    const status = await getQueueStatus();
    res.json(status);
  } catch (error: any) {
    console.error("[queue-status] ERROR:", error);
    res.status(500).json({ error: "Failed to fetch queue status" });
  }
});

app.get("/api/tracks", async (req, res) => {
  try {
    const search = req.query.search as string | undefined;
    const tracks = await getAllTrackFeatures(search);
    res.json(tracks);
  } catch (error: any) {
    console.error("[tracks] ERROR:", error);
    res.status(500).json({ error: "Failed to fetch tracks" });
  }
});

// --- Text to Playlist ---

app.post("/api/playlist/generate", claudeLimiter, async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Missing access token" });
    return;
  }

  const { description } = req.body;
  if (!description || typeof description !== "string" || description.trim().length < 3 || description.length > 500) {
    res.status(400).json({ error: "Descricao deve ter entre 3 e 500 caracteres" });
    return;
  }

  try {
    const userId = await getSpotifyUserId(token);
    console.log(`[playlist] generating for "${description}" (user: ${userId})`);

    // 1. Generate vibe profile via Claude
    const vibeProfile = await generateVibeProfile(description.trim());
    console.log(`[playlist] vibe profile: ${vibeProfile.playlist_name}`);

    // 2. Match tracks from database
    const allTracks = await getAllTrackFeatures();
    const scored = matchTracks(vibeProfile, allTracks);

    if (scored.length < 5) {
      res.status(422).json({
        error: "Poucas musicas no banco para essa vibe. Tente novamente quando mais musicas forem analisadas.",
      });
      return;
    }

    console.log(`[playlist] matched ${scored.length} tracks (best: ${scored[0].score.toFixed(2)})`);

    // 3. Create Spotify playlist
    let spotifyPlaylistId: string | null = null;
    let spotifyUrl: string | null = null;
    try {
      const playlist = await createPlaylist(token, userId, vibeProfile.playlist_name, description);
      spotifyPlaylistId = playlist.id;
      spotifyUrl = playlist.url;

      await addTracksToPlaylist(
        token,
        playlist.id,
        scored.map((s) => s.track.spotify_id)
      );
      console.log(`[playlist] created on Spotify: ${spotifyUrl}`);
    } catch (spotifyErr: any) {
      if (spotifyErr.response?.status === 403) {
        res.status(403).json({
          error: "scope_missing",
          message: "Voce precisa fazer login novamente para criar playlists.",
        });
        return;
      }
      console.error("[playlist] Spotify API error:", spotifyErr.message);
      // Continue without Spotify playlist — still save locally
    }

    // 4. Save to database
    const saved = await savePlaylist(
      userId,
      description,
      vibeProfile,
      spotifyPlaylistId,
      spotifyUrl,
      scored.map((s) => ({
        spotify_id: s.track.spotify_id,
        track_name: s.track.track_name,
        artist_name: s.track.artist_name,
        score: s.score,
      }))
    );

    res.json({
      playlist: {
        id: saved.id,
        name: vibeProfile.playlist_name,
        description,
        spotify_url: spotifyUrl,
        vibe_profile: vibeProfile,
        tracks: scored.map((s, i) => ({
          position: i + 1,
          spotify_id: s.track.spotify_id,
          track_name: s.track.track_name,
          artist_name: s.track.artist_name,
          score: Math.round(s.score * 100),
        })),
      },
    });
  } catch (error: any) {
    console.error("[playlist] ERROR:", error);
    res.status(500).json({ error: error.message || "Falha ao gerar playlist" });
  }
});

app.post("/api/playlist/:id/rate", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Missing access token" });
    return;
  }

  const { spotifyId, rating } = req.body;
  const playlistId = Number(req.params.id);

  const validRatings = [
    "liked_right_vibe", "right_vibe", "liked_song",
    "bad_song_right_vibe", "liked_wrong_vibe", "bad_both",
  ];

  if (!validRatings.includes(rating)) {
    res.status(400).json({ error: "Rating invalido" });
    return;
  }

  try {
    const accuracy = await rateTrack(playlistId, spotifyId, rating);
    res.json(accuracy);
  } catch (error: any) {
    console.error("[rate] ERROR:", error);
    res.status(500).json({ error: "Falha ao salvar rating" });
  }
});

app.get("/api/playlist/history", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Missing access token" });
    return;
  }

  try {
    const userId = await getSpotifyUserId(token);
    const playlists = await getPlaylistsByUser(userId);
    res.json(playlists);
  } catch (error: any) {
    console.error("[playlist-history] ERROR:", error);
    res.status(500).json({ error: "Falha ao buscar historico" });
  }
});

app.get("/api/playlist/:id", async (req, res) => {
  try {
    const result = await getPlaylistWithTracks(Number(req.params.id));
    if (!result) {
      res.status(404).json({ error: "Playlist nao encontrada" });
      return;
    }
    res.json(result);
  } catch (error: any) {
    console.error("[playlist-detail] ERROR:", error);
    res.status(500).json({ error: "Falha ao buscar playlist" });
  }
});

app.get("/api/artist-details", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Missing access token" });
    return;
  }

  const name = req.query.name as string;
  if (!name) {
    res.status(400).json({ error: "Missing artist name" });
    return;
  }

  try {
    const artist = await searchArtist(token, name);
    if (!artist) {
      res.status(404).json({ error: "Artista nao encontrado" });
      return;
    }

    const topTracks = await getArtistTopTracks(token, artist.id);

    res.json({
      id: artist.id,
      name: artist.name,
      image: artist.images[0]?.url ?? null,
      genres: artist.genres,
      popularity: artist.popularity,
      spotify_url: artist.external_urls.spotify,
      top_tracks: topTracks.map((t, i) => ({
        position: i + 1,
        id: t.id,
        name: t.name,
        artist: t.artists.map((a) => a.name).join(", "),
        album_name: t.album.name,
        album_image: t.album.images?.[1]?.url ?? t.album.images?.[0]?.url ?? null,
        spotify_url: t.external_urls.spotify,
        duration_ms: t.duration_ms,
      })),
    });
  } catch (error: any) {
    console.error("[artist-details] ERROR:", error.message);
    res.status(error.response?.status || 500).json({ error: "Falha ao buscar artista" });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Public routes — redirect to hash router paths
app.get("/privacy", (_req, res) => {
  res.redirect("/#/privacy");
});

// Production: serve frontend static files
if (process.env.NODE_ENV === "production") {
  const frontendDist = path.resolve(process.cwd(), "../frontend/dist");
  console.log("[prod] serving static files from:", frontendDist);
  app.use(express.static(frontendDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

async function start() {
  await initDb();
  startWorker();
  const server = app.listen(config.port, "0.0.0.0", () => {
    console.log(`🎵 Spotaste API running on http://127.0.0.1:${config.port}`);
  });

  const shutdown = () => {
    console.log("\nShutting down...");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 3000);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
