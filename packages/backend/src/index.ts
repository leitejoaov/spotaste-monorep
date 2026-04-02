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
import { getTopArtists as lfmGetTopArtists, validateUser as lfmValidateUser, getTopTracks as lfmGetTopTracks, getTrackInfo as lfmGetTrackInfo, searchTrack as lfmSearchTrack, getArtistInfo as lfmGetArtistInfo, getArtistTopTracks as lfmGetArtistTopTracks, getSimilarArtists as lfmGetSimilarArtists, resolveTrackImage, resolveArtistImage } from "./lastfm.js";
import { analyzeTaste, generateVibeProfile, detectAndExtractArtists, analyzeLyrics } from "./claude.js";
import { fetchLyrics } from "./lyrics.js";
import { getCachedAnalysis, setCachedAnalysis } from "./cache.js";
import { analyzeWithEssentia } from "./essentia.js";
import { initDb, getTrackFeatures, saveTrackFeatures, getQueueStatus, getAllTrackFeatures, addToQueue, savePlaylist, getPlaylistsByUser, getPublicPlaylists, getPlaylistWithTracks, rateTrack, getCachedJudge, setCachedJudge, hashArtists, trackExistsByName, updateTrackSpotifyId, saveLyricsTags, pool } from "./db.js";
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

/**
 * Resolve the caller's verified user ID from request headers.
 * Trusts Spotify token and YouTube Music token (server-verified).
 * Never trusts x-user-id alone — it must match a verified credential.
 */
async function resolveCallerId(req: express.Request): Promise<string | null> {
  // 1. Spotify token — most reliable
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token) {
    try {
      return await getSpotifyUserId(token);
    } catch { /* invalid token */ }
  }

  // 2. YouTube Music token — verify via ytmusic-service
  const ytTokenB64 = req.headers["x-ytmusic-token"] as string | undefined;
  if (ytTokenB64) {
    try {
      const ytToken = JSON.parse(Buffer.from(ytTokenB64, "base64").toString("utf-8"));
      const info = await getYTUserInfo(ytToken);
      if (info.channelId) return info.channelId;
    } catch { /* invalid yt token */ }
  }

  return null;
}

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

  const { description, platform = "spotify", is_public = true } = req.body;

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
    const userId = await resolveCallerId(req) || "anonymous";

    console.log(`[playlist] generating for "${description}" on ${platform} (user: ${userId})`);

    // 0. Detect if the description is a list of artists
    const artistDetection = await detectAndExtractArtists(description.trim());

    let scored: { track: any; score: number }[];
    let vibeProfile: any;
    let playlistName: string;

    if (artistDetection) {
      // ARTIST MODE: fetch top tracks directly from named artists
      console.log(`[playlist] artist mode: ${artistDetection.artists.join(", ")}`);
      playlistName = artistDetection.playlist_name;
      vibeProfile = null;

      const artistTracks: { spotify_id: string; track_name: string; artist_name: string }[] = [];

      for (const artistName of artistDetection.artists.slice(0, 10)) {
        try {
          // Try Spotify first if we have a token
          if (platform === "spotify" && token) {
            const artist = await searchArtist(token, artistName);
            if (artist) {
              const topTracks = await getArtistTopTracks(token, artist.id);
              for (const t of topTracks.slice(0, 5)) {
                artistTracks.push({
                  spotify_id: t.id,
                  track_name: t.name,
                  artist_name: t.artists[0]?.name || artistName,
                });
              }
              continue;
            }
          }
          // Try YouTube Music search if platform is ytmusic
          if (platform === "ytmusic") {
            const ytToken = ytTokenB64 ? JSON.parse(Buffer.from(ytTokenB64, "base64").toString("utf-8")) : null;
            const ytResults = await searchYTTracks(ytToken, artistName, 5);
            if (ytResults.length > 0) {
              for (const t of ytResults) {
                artistTracks.push({
                  spotify_id: `ytmusic_${t.videoId}_${t.title}`.slice(0, 60),
                  track_name: t.title,
                  artist_name: t.artist || artistName,
                });
              }
              continue;
            }
          }
          // Fallback: Last.fm top tracks
          const lfmTracks = await lfmGetArtistTopTracks(artistName, 5);
          for (const t of lfmTracks) {
            artistTracks.push({
              spotify_id: `lastfm_${t.name}_${artistName}`.slice(0, 60),
              track_name: t.name,
              artist_name: artistName,
            });
          }
        } catch (err: any) {
          console.warn(`[playlist] could not get tracks for ${artistName}:`, err.message);
        }
      }

      if (artistTracks.length < 3) {
        res.status(422).json({ error: "Nao foi possivel encontrar musicas suficientes dos artistas mencionados." });
        return;
      }

      // Shuffle and limit
      for (let i = artistTracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [artistTracks[i], artistTracks[j]] = [artistTracks[j], artistTracks[i]];
      }
      scored = artistTracks.slice(0, 20).map((t, i) => ({
        track: t,
        score: 1 - i * 0.02, // descending score for display
      }));

      console.log(`[playlist] collected ${artistTracks.length} tracks from ${artistDetection.artists.length} artists`);
    } else {
      // VIBE MODE: original flow — generate vibe profile and match from database
      vibeProfile = await generateVibeProfile(description.trim());
      playlistName = vibeProfile.playlist_name;
      console.log(`[playlist] vibe profile: ${playlistName}`);

      const { tracks: allTracks } = await getAllTrackFeatures(undefined, 1, 5000);
      scored = matchTracks(vibeProfile, allTracks);

      if (scored.length < 5) {
        res.status(422).json({
          error: "Poucas musicas no banco para essa vibe. Tente novamente quando mais musicas forem analisadas.",
        });
        return;
      }

      console.log(`[playlist] matched ${scored.length} tracks (best: ${scored[0].score.toFixed(2)})`);
    }

    let playlistExternalId: string | null = null;
    let playlistUrl: string | null = null;

    if (platform === "ytmusic" && ytTokenB64) {
      // 3a. Create YouTube Music playlist
      try {
        const ytToken = JSON.parse(Buffer.from(ytTokenB64, "base64").toString("utf-8"));
        const ytPlaylistId = await createYTPlaylist(ytToken, playlistName, description);
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
      // 3b. Create Spotify playlist — resolve non-Spotify IDs first
      try {
        // Resolve lastfm_/ytmusic_ IDs to real Spotify track IDs
        for (const s of scored) {
          const id = s.track.spotify_id;
          if (id.startsWith("lastfm_") || id.startsWith("ytmusic_")) {
            try {
              const query = `${s.track.track_name} ${s.track.artist_name}`;
              const results = await searchTracks(token, query, 1);
              if (results.length > 0) {
                const oldId = s.track.spotify_id;
                s.track.spotify_id = results[0].id;
                // Update the DB so future playlists use the real ID
                try { await updateTrackSpotifyId(oldId, results[0].id); } catch { /* dup ok */ }
                console.log(`[playlist] resolved ${oldId} -> ${results[0].id}`);
              }
            } catch {
              // Search failed, keep original ID (will be filtered)
            }
          }
        }

        const validTrackIds = scored
          .map((s) => s.track.spotify_id)
          .filter((id) => !id.startsWith("lastfm_") && !id.startsWith("ytmusic_"));

        const playlist = await createPlaylist(token, userId, playlistName, description);
        playlistExternalId = playlist.id;
        playlistUrl = playlist.url;

        if (validTrackIds.length > 0) {
          await addTracksToPlaylist(token, playlist.id, validTrackIds);
        }
        console.log(`[playlist] created on Spotify: ${playlistUrl} (${validTrackIds.length}/${scored.length} tracks)`);
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
      })),
      platform,
      is_public
    );

    res.json({
      playlist: {
        id: saved.id,
        name: playlistName,
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
  const callerId = await resolveCallerId(req);
  if (!callerId) {
    res.status(401).json({ error: "Auth required" });
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
    // Ownership check: only the playlist owner can rate
    const result = await getPlaylistWithTracks(playlistId);
    if (!result) {
      res.status(404).json({ error: "Playlist nao encontrada" });
      return;
    }
    if (result.playlist.user_spotify_id !== callerId) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }

    const accuracy = await rateTrack(playlistId, spotifyId, rating);
    res.json(accuracy);
  } catch (error: any) {
    console.error("[rate] ERROR:", error);
    res.status(500).json({ error: "Falha ao salvar rating" });
  }
});

app.get("/api/playlist/public", apiLimiter, async (_req, res) => {
  try {
    const playlists = await getPublicPlaylists(50, 0);
    res.json(playlists);
  } catch (error: any) {
    console.error("[playlist-public] ERROR:", error);
    res.status(500).json({ error: "Falha ao buscar playlists publicas" });
  }
});

app.get("/api/playlist/history", async (req, res) => {
  try {
    const callerId = await resolveCallerId(req);
    if (!callerId) {
      res.status(401).json({ error: "Auth required" });
      return;
    }

    const playlists = await getPlaylistsByUser(callerId);
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

    // Public playlists are accessible to anyone
    const isPublic = (result.playlist as any).is_public;
    if (!isPublic) {
      // Private playlist — require verified ownership (default-deny)
      const callerId = await resolveCallerId(req);
      const storedOwner = result.playlist.user_spotify_id;

      if (!callerId || !storedOwner || callerId !== storedOwner) {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
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

// Recommended/similar artists based on user's top artists
app.get("/api/recommended-artists", apiLimiter, async (req, res) => {
  const artistNames = (req.query.artists as string || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (artistNames.length === 0) {
    res.status(400).json({ error: "Missing artists query param (comma-separated)" });
    return;
  }

  try {
    // Get similar artists from Last.fm for each input artist (top 5 per artist)
    const allSimilar = new Map<string, { name: string; image: string; score: number; from: string[] }>();

    await Promise.all(
      artistNames.slice(0, 10).map(async (artistName) => {
        try {
          const similar = await lfmGetSimilarArtists(artistName, 10);
          for (const s of similar) {
            const key = s.name.toLowerCase();
            // Skip if it's one of the user's own top artists
            if (artistNames.some((a) => a.toLowerCase() === key)) continue;
            const existing = allSimilar.get(key);
            if (existing) {
              existing.score += s.match;
              existing.from.push(artistName);
            } else {
              allSimilar.set(key, { name: s.name, image: s.image, score: s.match, from: [artistName] });
            }
          }
        } catch {
          // Skip failed lookups
        }
      })
    );

    // Sort by aggregate score and resolve images
    const ranked = [...allSimilar.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    // Resolve images in parallel — use resolveArtistImage which handles Last.fm placeholders + Deezer fallback
    const results = await Promise.all(
      ranked.map(async (r) => {
        let image = "";
        try {
          image = await resolveArtistImage(r.name, r.image || "");
        } catch { /* no image */ }
        return {
          name: r.name,
          image,
          score: Math.round(r.score * 100),
          from: r.from,
        };
      })
    );

    res.json({ artists: results });
  } catch (error: any) {
    console.error("[recommended-artists] ERROR:", error.message);
    res.status(500).json({ error: "Failed to get recommended artists" });
  }
});

// Admin: re-analyze all tracks for lyrics tags
app.post("/api/admin/reanalyze-lyrics", async (req, res) => {
  const adminKey = req.headers["x-admin-key"] as string;
  if (adminKey !== config.anthropicApiKey?.slice(-10)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const { mode = "inline" } = req.body || {};

    if (mode === "reset") {
      const result = await pool.query(
        "UPDATE track_features SET lyrics_tags = '{}' WHERE mood_happy IS NOT NULL"
      );
      res.json({ message: `Reset ${result.rowCount} tracks. Worker will process them over time.` });
      return;
    }

    // Select tracks based on mode
    let query: string;
    if (mode === "retry-instrumental") {
      // Only re-process tracks that were marked instrumental (no lyrics found)
      query = "SELECT * FROM track_features WHERE lyrics_tags = '{instrumental}' ORDER BY analyzed_at DESC";
    } else {
      // Process all tracks
      query = "SELECT * FROM track_features WHERE mood_happy IS NOT NULL ORDER BY analyzed_at DESC";
    }
    const { rows: tracks } = await pool.query(query);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
    res.write(`Starting lyrics analysis for ${tracks.length} tracks...\n`);

    let done = 0;
    let found = 0;
    let notFound = 0;

    for (const track of tracks) {
      done++;
      try {
        const lyrics = await fetchLyrics(track.artist_name, track.track_name);
        if (!lyrics) {
          await saveLyricsTags(track.spotify_id, ["instrumental"], null);
          notFound++;
          res.write(`[${done}/${tracks.length}] ${track.track_name} - ${track.artist_name} -> no lyrics (instrumental)\n`);
          continue;
        }

        const analysis = await analyzeLyrics(track.track_name, track.artist_name, lyrics);
        if (analysis) {
          await saveLyricsTags(track.spotify_id, analysis.tags, analysis.language);
          found++;
          res.write(`[${done}/${tracks.length}] ${track.track_name} - ${track.artist_name} -> [${analysis.tags.join(", ")}] (${analysis.language})\n`);
        } else {
          await saveLyricsTags(track.spotify_id, ["unknown"], null);
          notFound++;
          res.write(`[${done}/${tracks.length}] ${track.track_name} - ${track.artist_name} -> analysis failed\n`);
        }
      } catch (err: any) {
        await saveLyricsTags(track.spotify_id, ["error"], null).catch(() => {});
        res.write(`[${done}/${tracks.length}] ${track.track_name} - ${track.artist_name} -> ERROR: ${err.message}\n`);
      }
    }

    res.write(`\nDone! ${found} with lyrics, ${notFound} without, ${tracks.length} total.\n`);
    res.end();
  } catch (error: any) {
    console.error("[admin-reanalyze] ERROR:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to start reanalysis" });
    }
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
