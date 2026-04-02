import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.js";
import lastfmAuthRouter from "./routes/auth-lastfm.js";
import ytmusicAuthRouter from "./routes/auth-ytmusic.js";
import settingsRouter from "./routes/settings.js";
import { getTopTracks, getSpotifyUserId, getTrackDetails, searchTracks, createPlaylist, addTracksToPlaylist, searchArtist, getArtistTopTracks } from "./spotify.js";
import { getMusicTasteAnalysis, getEnrichedMusicTasteAnalysis } from "./judge.js";
import { getTopArtists as lfmGetTopArtists, validateUser as lfmValidateUser, getTopTracks as lfmGetTopTracks, getTrackInfo as lfmGetTrackInfo, searchTrack as lfmSearchTrack, getArtistInfo as lfmGetArtistInfo, getArtistTopTracks as lfmGetArtistTopTracks, resolveTrackImage, resolveArtistImage } from "./lastfm.js";
import { analyzeTaste, generateVibeProfile } from "./claude.js";
import { getCachedAnalysis, setCachedAnalysis } from "./cache.js";
import { analyzeWithEssentia } from "./essentia.js";
import { initDb, getTrackFeatures, saveTrackFeatures, getQueueStatus, getAllTrackFeatures, addToQueue, savePlaylist, getPlaylistsByUser, getPlaylistWithTracks, rateTrack, getCachedJudge, setCachedJudge, hashArtists, trackExistsByName } from "./db.js";
import { startWorker } from "./worker.js";
import { matchTracks } from "./matcher.js";
import { searchYTTracks, getYTTopTracks, getYTUserInfo, createYTPlaylist, addToYTPlaylist } from "./ytmusic.js";

const app = express();
app.set("trust proxy", 1);

// Rate limiters
const apiLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });
const claudeLimiter = rateLimit({ windowMs: 60_000, max: 10, message: { error: "Muitas requisicoes. Tente novamente em 1 minuto." } });

app.use(cors({ origin: config.frontendUrl }));
app.use(express.json());
app.use("/api/", apiLimiter);

app.use("/auth", authRouter);
app.use(lastfmAuthRouter);
app.use(ytmusicAuthRouter);
app.use(settingsRouter);

app.post("/api/judge", claudeLimiter, async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const lastfmUser = req.headers["x-lastfm-user"] as string | undefined;
  const ytmusicToken = req.headers["x-ytmusic-token"] as string | undefined;
  const userId_header = req.headers["x-user-id"] as string | undefined;
  const { artists } = req.body;
  const platform = ytmusicToken ? "ytmusic" : lastfmUser ? "lastfm" : "spotify";
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
        try {
          res.json({ analysis: JSON.parse(cached) });
        } catch {
          res.json({ analysis: cached });
        }
        return;
      }

      console.log("[judge] cache miss for", cacheUserId);

      let analysis;
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
          userInfo?.registered,
          platform
        );
      } else {
        analysis = await getMusicTasteAnalysis(artists, platform);
      }

      await setCachedJudge(cacheUserId, artHash, JSON.stringify(analysis));
      res.json({ analysis });
      return;
    }

    // No token, no lastfm — just generate without caching
    const analysis = await getMusicTasteAnalysis(artists, platform);
    res.json({ analysis });
  } catch (error: any) {
    console.error("[judge] ERROR:", error);
    res.status(500).json({ error: "Failed to generate analysis" });
  }
});

app.get("/api/analyze-taste", claudeLimiter, async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const lastfmUser = req.headers["x-lastfm-user"] as string | undefined;
  const ytTokenB64 = req.headers["x-ytmusic-token"] as string | undefined;

  if (!token && !lastfmUser && !ytTokenB64) {
    res.status(401).json({ error: "Missing access token, Last.fm user, or YouTube Music token" });
    return;
  }

  try {
    // Determine cache key
    let cacheKey: string;
    if (ytTokenB64) {
      let channelId = "unknown";
      try {
        const ytToken = JSON.parse(Buffer.from(ytTokenB64, "base64").toString("utf-8"));
        const ytInfo = await getYTUserInfo(ytToken);
        channelId = ytInfo?.channelId || "unknown";
      } catch { /* use fallback */ }
      cacheKey = `ytmusic_${channelId}`;
    } else if (lastfmUser) {
      cacheKey = `lastfm_${lastfmUser}`;
    } else {
      cacheKey = await getSpotifyUserId(token!);
    }

    const cached = await getCachedAnalysis(cacheKey);

    if (cached) {
      console.log("[analyze-taste] cache hit for", cacheKey);
      // Refresh with live data if Spotify token available
      if (token) {
        const tracks = await getTopTracks(token);
        for (let i = 0; i < cached.tracks.length && i < tracks.length; i++) {
          cached.tracks[i].albumImage = tracks[i].album?.images?.[1]?.url
            ?? tracks[i].album?.images?.[0]?.url ?? null;
          cached.tracks[i].spotifyId = tracks[i].id;

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
      }
      res.json(cached);
      return;
    }

    console.log("[analyze-taste] cache miss for", cacheKey);

    let spotifyTracks: any[];

    if (ytTokenB64) {
      // Use YouTube Music top tracks as data source
      const ytToken = JSON.parse(Buffer.from(ytTokenB64, "base64").toString("utf-8"));
      const ytTracks = await getYTTopTracks(ytToken, 20);
      spotifyTracks = ytTracks.map((yt) => ({
        id: `ytmusic_${yt.videoId || yt.title}_${yt.artist}`.slice(0, 60),
        name: yt.title,
        artists: [{ name: yt.artist }],
        album: {
          name: yt.album || "",
          images: yt.thumbnail ? [{ url: yt.thumbnail }] : [],
        },
        popularity: 50,
        tags: [],
      }));
    } else if (lastfmUser) {
      // Use Last.fm top tracks as data source
      const lfmTracks = await lfmGetTopTracks(lastfmUser, "overall", 20);
      // Enrich with tags and images (Deezer fallback for covers)
      spotifyTracks = await Promise.all(
        lfmTracks.map(async (lt) => {
          const info = await lfmGetTrackInfo(lt.artist, lt.name, lastfmUser);
          const image = await resolveTrackImage(lt.name, lt.artist, lt.image);
          return {
            id: `lastfm_${lt.name}_${lt.artist}`.slice(0, 60),
            name: lt.name,
            artists: [{ name: lt.artist }],
            album: {
              name: info?.album || "",
              images: image ? [{ url: image }] : [],
            },
            popularity: Math.min(100, Math.round(lt.playcount / 10)),
            tags: info?.tags || [],
          };
        })
      );
    } else {
      spotifyTracks = await getTopTracks(token!);
    }

    const analysis = await analyzeTaste(spotifyTracks);

    // Enrich with album images and real Essentia data
    for (let i = 0; i < analysis.tracks.length && i < spotifyTracks.length; i++) {
      const t = analysis.tracks[i] as any;
      t.albumImage = spotifyTracks[i].album?.images?.[1]?.url
        ?? spotifyTracks[i].album?.images?.[0]?.url ?? null;
      t.spotifyId = spotifyTracks[i].id;

      // Attach real Essentia features if available
      const real = await getTrackFeatures(spotifyTracks[i].id);
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

    await setCachedAnalysis(cacheKey, analysis);
    res.json(analysis);
  } catch (error: any) {
    console.error("[analyze-taste] ERROR:", error);
    const status = error.response?.status || 500;
    res.status(status).json({ error: error.message || "Failed to analyze taste" });
  }
});

app.get("/api/search-tracks", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const ytTokenB64 = req.headers["x-ytmusic-token"] as string | undefined;

  const q = req.query.q as string;
  if (!q || q.trim().length < 2) {
    res.json([]);
    return;
  }

  try {
    if (token) {
      // Spotify search
      const results = await searchTracks(token, q);
      res.json(results.map((t) => ({
        id: t.id,
        name: t.name,
        artist: t.artists[0]?.name || "Unknown",
        album: t.album.name,
        image: t.album.images?.[2]?.url ?? t.album.images?.[0]?.url ?? null,
        source: "spotify" as const,
      })));
    } else if (ytTokenB64) {
      // YouTube Music search
      const ytToken = JSON.parse(Buffer.from(ytTokenB64, "base64").toString("utf-8"));
      const results = await searchYTTracks(ytToken, q);
      res.json(results.map((t) => ({
        id: `ytmusic_${t.videoId}`,
        name: t.title,
        artist: t.artist,
        album: t.album || "",
        image: t.thumbnail || null,
        source: "ytmusic" as const,
      })));
    } else {
      // Last.fm fallback search with Deezer images
      const results = await lfmSearchTrack(q);
      const enriched = await Promise.all(
        results.map(async (t) => {
          const image = await resolveTrackImage(t.name, t.artist, t.image);
          return {
            id: `lastfm_${t.name}_${t.artist}`.slice(0, 60),
            name: t.name,
            artist: t.artist,
            album: "",
            image: image || null,
            source: "lastfm" as const,
          };
        })
      );
      res.json(enriched);
    }
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

  try {
    const { trackId } = req.params;

    // Already analyzed?
    const cached = await getTrackFeatures(trackId);
    if (cached) {
      res.json({ spotify_id: trackId, track_name: cached.track_name, artist_name: cached.artist_name, status: "done", features: cached });
      return;
    }

    if (trackId.startsWith("lastfm_") || trackId.startsWith("ytmusic_")) {
      // Last.fm or YT Music track — use name/artist from body
      const trackName = req.body.track_name || "Unknown";
      const artistName = req.body.artist_name || "Unknown";
      const albumImage = req.body.album_image || await resolveTrackImage(trackName, artistName, "");

      await addToQueue(trackId, trackName, artistName);
      console.log(`[enqueue] queued (${trackId.startsWith("lastfm_") ? "lastfm" : "ytmusic"}): ${trackName} - ${artistName}`);

      res.json({ spotify_id: trackId, track_name: trackName, artist_name: artistName, album_image: albumImage, status: "pending" });
      return;
    }

    // Spotify track — needs token
    if (!token) {
      res.status(401).json({ error: "Missing access token" });
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
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const result = await getAllTrackFeatures(search, page, limit);
    res.json(result);
  } catch (error: any) {
    console.error("[tracks] ERROR:", error);
    res.status(500).json({ error: "Failed to fetch tracks" });
  }
});

// --- Text to Playlist ---

app.post("/api/playlist/generate", claudeLimiter, async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const ytTokenB64 = req.headers["x-ytmusic-token"] as string | undefined;
  const userIdHeader = req.headers["x-user-id"] as string | undefined;

  const { description, platform = "spotify" } = req.body;

  if (platform === "spotify" && !token) {
    res.status(401).json({ error: "Missing Spotify access token" });
    return;
  }
  if (platform === "ytmusic" && !ytTokenB64) {
    res.status(401).json({ error: "Missing YouTube Music token" });
    return;
  }

  if (!description || typeof description !== "string" || description.trim().length < 3 || description.length > 500) {
    res.status(400).json({ error: "Descricao deve ter entre 3 e 500 caracteres" });
    return;
  }

  try {
    let userId: string;
    if (token) {
      userId = await getSpotifyUserId(token);
    } else if (userIdHeader) {
      userId = userIdHeader;
    } else {
      userId = "anonymous";
    }

    console.log(`[playlist] generating for "${description}" on ${platform} (user: ${userId})`);

    // 1. Generate vibe profile via Claude
    const vibeProfile = await generateVibeProfile(description.trim());
    console.log(`[playlist] vibe profile: ${vibeProfile.playlist_name}`);

    // 2. Match tracks from database
    const { tracks: allTracks } = await getAllTrackFeatures(undefined, 1, 100000);
    const scored = matchTracks(vibeProfile, allTracks);

    if (scored.length < 5) {
      res.status(422).json({
        error: "Poucas musicas no banco para essa vibe. Tente novamente quando mais musicas forem analisadas.",
      });
      return;
    }

    console.log(`[playlist] matched ${scored.length} tracks (best: ${scored[0].score.toFixed(2)})`);

    let playlistExternalId: string | null = null;
    let playlistUrl: string | null = null;

    if (platform === "ytmusic" && ytTokenB64) {
      // 3a. Create YouTube Music playlist
      try {
        const ytToken = JSON.parse(Buffer.from(ytTokenB64, "base64").toString("utf-8"));
        const ytPlaylistId = await createYTPlaylist(ytToken, vibeProfile.playlist_name, description);
        playlistExternalId = ytPlaylistId;
        playlistUrl = `https://music.youtube.com/playlist?list=${ytPlaylistId}`;

        // Find YouTube video IDs for each track — search by name if needed
        const videoIds: string[] = [];
        for (const s of scored) {
          const id = s.track.spotify_id;
          // Try to extract videoId from ytmusic_ prefix
          if (id.startsWith("ytmusic_")) {
            const parts = id.replace("ytmusic_", "").split("_");
            if (parts[0] && parts[0].length >= 8) {
              videoIds.push(parts[0]);
              continue;
            }
          }
          // Search on YouTube Music by track name + artist
          try {
            const results = await searchYTTracks(null, `${s.track.track_name} ${s.track.artist_name}`, 1);
            if (results.length > 0 && results[0].videoId) {
              videoIds.push(results[0].videoId);
            }
          } catch {
            // skip track if search fails
          }
        }

        if (videoIds.length > 0) {
          await addToYTPlaylist(ytToken, ytPlaylistId, videoIds);
        }
        console.log(`[playlist] created on YouTube Music: ${playlistUrl}`);
      } catch (ytErr: any) {
        console.error("[playlist] YouTube Music API error:", ytErr.message);
      }
    } else if (platform === "spotify" && token) {
      // 3b. Create Spotify playlist
      try {
        const playlist = await createPlaylist(token, userId, vibeProfile.playlist_name, description);
        playlistExternalId = playlist.id;
        playlistUrl = playlist.url;

        await addTracksToPlaylist(
          token,
          playlist.id,
          scored.map((s) => s.track.spotify_id).filter((id) => !id.startsWith("lastfm_") && !id.startsWith("ytmusic_"))
        );
        console.log(`[playlist] created on Spotify: ${playlistUrl}`);
      } catch (spotifyErr: any) {
        if (spotifyErr.response?.status === 403) {
          res.status(403).json({
            error: "scope_missing",
            message: "Voce precisa fazer login novamente para criar playlists.",
          });
          return;
        }
        console.error("[playlist] Spotify API error:", spotifyErr.message);
      }
    }

    // 4. Save to database
    const saved = await savePlaylist(
      userId,
      description,
      vibeProfile,
      playlistExternalId,
      playlistUrl,
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
        spotify_url: playlistUrl,
        platform,
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
  const userIdHeader = req.headers["x-user-id"] as string | undefined;
  if (!token && !userIdHeader) {
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
  const userIdHeader = req.headers["x-user-id"] as string | undefined;

  if (!token && !userIdHeader) {
    res.status(401).json({ error: "Missing access token" });
    return;
  }

  try {
    let userId: string;
    if (token) {
      userId = await getSpotifyUserId(token);
    } else {
      userId = userIdHeader!;
    }
    const playlists = await getPlaylistsByUser(userId);
    res.json(playlists);
  } catch (error: any) {
    console.error("[playlist-history] ERROR:", error);
    res.status(500).json({ error: "Falha ao buscar historico" });
  }
});

app.get("/api/playlist/:id", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const userId = Number(req.headers["x-user-id"]) || undefined;

  if (!token && !userId) {
    res.status(401).json({ error: "Auth required" });
    return;
  }

  try {
    const result = await getPlaylistWithTracks(Number(req.params.id));
    if (!result) {
      res.status(404).json({ error: "Playlist nao encontrada" });
      return;
    }

    // Ownership check: verify caller owns this playlist
    if (token) {
      const spotifyId = await getSpotifyUserId(token);
      if (result.playlist.user_spotify_id && result.playlist.user_spotify_id !== spotifyId) {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
    } else if (userId && result.playlist.user_id && result.playlist.user_id !== userId) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }

    res.json(result);
  } catch (error: any) {
    console.error("[playlist-detail] ERROR:", error);
    res.status(500).json({ error: "Falha ao buscar playlist" });
  }
});

app.get("/api/lastfm/top-artists", async (req, res) => {
  const username = (req.query.username as string) || (req.headers["x-lastfm-user"] as string);
  if (!username) {
    res.status(400).json({ error: "username required" });
    return;
  }

  try {
    const period = (req.query.period as string) || "overall";
    const artists = await lfmGetTopArtists(username, period as any, 10);

    // Enrich with tags from Last.fm
    const enriched = await Promise.all(
      artists.map(async (a) => {
        const info = await lfmGetArtistInfo(a.name);
        return {
          name: a.name,
          image: a.image || info?.image || "",
          genres: info?.tags?.slice(0, 3) || [],
          playcount: a.playcount,
        };
      })
    );

    res.json({ artists: enriched });
  } catch (err: any) {
    console.error("Last.fm top artists error:", err.message);
    res.status(500).json({ error: "Failed to get top artists" });
  }
});

app.get("/api/ytmusic/top-artists", async (req, res) => {
  const ytTokenB64 = req.headers["x-ytmusic-token"] as string | undefined;
  if (!ytTokenB64) {
    res.status(401).json({ error: "Missing YouTube Music token" });
    return;
  }

  try {
    const ytToken = JSON.parse(Buffer.from(ytTokenB64, "base64").toString("utf-8"));
    const topTracks = await getYTTopTracks(ytToken, 100);

    // Extract artists from top tracks and rank by frequency
    const artistCounts = new Map<string, { name: string; image: string; count: number }>();
    for (const t of topTracks) {
      const key = t.artist.toLowerCase();
      const existing = artistCounts.get(key);
      if (existing) {
        existing.count++;
      } else {
        artistCounts.set(key, { name: t.artist, image: t.thumbnail || "", count: 1 });
      }
    }

    const artists = [...artistCounts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((a) => ({
        name: a.name,
        image: a.image,
        genres: [] as string[],
      }));

    // Fire-and-forget: enqueue YT Music liked songs for background analysis
    (async () => {
      try {
        let totalEnqueued = 0;
        for (const t of topTracks) {
          if (!t.title || !t.artist) continue;
          const trackId = `ytmusic_${(t.videoId || t.title).slice(0, 40)}_${t.artist.slice(0, 20)}`;
          const existsById = await getTrackFeatures(trackId);
          if (existsById) continue;
          const existsByName = await trackExistsByName(t.title, t.artist);
          if (existsByName) continue;
          await addToQueue(trackId, t.title, t.artist);
          totalEnqueued++;
        }
        if (totalEnqueued > 0) {
          console.log(`[ytmusic] enqueued ${totalEnqueued} tracks for analysis`);
        }
      } catch (err) {
        console.error("[ytmusic] failed to enqueue tracks:", err);
      }
    })();

    res.json({ artists });
  } catch (error: any) {
    console.error("[ytmusic-top-artists] ERROR:", error.message);
    res.status(500).json({ error: "Failed to get top artists" });
  }
});

app.get("/api/artist-details", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");

  const name = req.query.name as string;
  if (!name) {
    res.status(400).json({ error: "Missing artist name" });
    return;
  }

  try {
    // Always try Last.fm data (bio, tags, similar)
    const lfmInfo = await lfmGetArtistInfo(name);

    let result: any = {};

    if (token) {
      // Spotify data
      const artist = await searchArtist(token, name);
      if (!artist) {
        res.status(404).json({ error: "Artista nao encontrado" });
        return;
      }

      const topTracks = await getArtistTopTracks(token, artist.id);

      result = {
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
      };
    } else {
      // No Spotify token — use Last.fm top tracks as fallback
      const lfmTopTracks = await lfmGetArtistTopTracks(name, 10);
      const artistImage = lfmInfo?.image || await resolveArtistImage(name, "");

      // Resolve track images via Deezer
      const tracksWithImages = await Promise.all(
        lfmTopTracks.map(async (t, i) => {
          const trackImg = await resolveTrackImage(t.name, name, "");
          return {
            position: i + 1,
            id: `lastfm_${t.name}_${name}`.slice(0, 60),
            name: t.name,
            artist: name,
            album_name: "",
            album_image: trackImg || null,
            spotify_url: null,
            duration_ms: null,
            listeners: t.listeners,
            playcount: t.playcount,
          };
        })
      );

      result = {
        id: `lastfm_${name}`.slice(0, 60),
        name: lfmInfo?.name || name,
        image: artistImage,
        genres: lfmInfo?.tags || [],
        popularity: null,
        spotify_url: null,
        top_tracks: tracksWithImages,
      };
    }

    // Attach Last.fm enrichment
    if (lfmInfo) {
      result.lastfm = {
        bio: lfmInfo.bio,
        tags: lfmInfo.tags,
        similar: lfmInfo.similar,
        listeners: lfmInfo.listeners,
        global_playcount: lfmInfo.playcount,
      };
    }

    res.json(result);
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

app.get("/terms", (_req, res) => {
  res.redirect("/#/terms");
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
