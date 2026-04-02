import {
  getPendingQueue,
  getTrackFeatures,
  getTracksWithoutMoods,
  getTracksWithoutSpotifyId,
  updateQueueStatus,
  updateTrackSpotifyId,
  saveTrackFeatures,
  resetStuckProcessing,
  cleanExpiredCache,
} from "./db.js";
import { analyzeWithEssentia } from "./essentia.js";
import { searchTracks } from "./spotify.js";

const INTERVAL_MS = 30_000;

async function processQueue(): Promise<void> {
  // 1. Process pending queue items first
  const items = await getPendingQueue();
  if (items.length > 0) {
    console.log(`[worker] processing ${items.length} pending items`);

    for (const item of items) {
      try {
        const existing = await getTrackFeatures(item.spotify_id);
        // Skip if already analyzed WITH mood data
        if (existing && existing.mood_happy !== null) {
          await updateQueueStatus(item.spotify_id, "done");
          continue;
        }

        await updateQueueStatus(item.spotify_id, "processing");
        console.log(`[worker] analyzing: ${item.track_name} - ${item.artist_name}`);

        const features = await analyzeWithEssentia(item.track_name, item.artist_name);
        await saveTrackFeatures(item.spotify_id, item.track_name, item.artist_name, features);
        await updateQueueStatus(item.spotify_id, "done");

        console.log(`[worker] done: ${item.track_name}`);
      } catch (err) {
        console.error(`[worker] failed: ${item.track_name}`, err);
        await updateQueueStatus(item.spotify_id, "failed").catch(() => {});
      }
    }
    return;
  }

  // 2. If queue is empty, re-analyze tracks missing mood data
  const stale = await getTracksWithoutMoods();
  if (stale.length === 0) return;

  console.log(`[worker] re-analyzing ${stale.length} tracks missing mood data`);
  for (const track of stale) {
    try {
      console.log(`[worker] re-analyzing: ${track.track_name} - ${track.artist_name}`);
      const features = await analyzeWithEssentia(track.track_name, track.artist_name);
      await saveTrackFeatures(track.spotify_id, track.track_name, track.artist_name, features);
      console.log(`[worker] re-done: ${track.track_name}`);
    } catch (err) {
      console.error(`[worker] re-analysis failed: ${track.track_name}`, err);
    }
  }
}

export async function backfillSpotifyIds(token: string, limit = 50): Promise<void> {
  try {
    const tracks = await getTracksWithoutSpotifyId(limit);
    if (tracks.length === 0) {
      console.log("[backfill] no tracks need Spotify ID backfill");
      return;
    }

    console.log(`[backfill] attempting to match ${tracks.length} tracks with Spotify`);
    let matched = 0;

    for (const track of tracks) {
      try {
        // Search Spotify for this track
        const query = `track:${track.track_name} artist:${track.artist_name}`;
        const results = await searchTracks(token, query);

        if (results.length > 0) {
          // Check for name match (case-insensitive)
          const match = results.find(
            (r) => r.name.toLowerCase() === track.track_name.toLowerCase() &&
                   r.artists.some((a: any) => a.name.toLowerCase() === track.artist_name.toLowerCase())
          ) || results[0]; // fallback to first result if no exact match

          await updateTrackSpotifyId(track.spotify_id, match.id);
          matched++;
        }

        // Rate limit: wait 100ms between searches
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (err: any) {
        // Skip individual track errors (might be rate limited)
        if (err.response?.status === 429) {
          console.log("[backfill] rate limited, stopping");
          break;
        }
      }
    }

    console.log(`[backfill] matched ${matched}/${tracks.length} tracks with Spotify IDs`);
  } catch (err: any) {
    console.error("[backfill] error:", err.message);
  }
}

export async function startWorker(): Promise<void> {
  // Reset items stuck in 'processing' from a previous crash
  const reset = await resetStuckProcessing();
  if (reset > 0) console.log(`[worker] reset ${reset} stuck processing items`);
  console.log(`[worker] started (interval: ${INTERVAL_MS / 1000}s)`);
  setInterval(async () => {
    try {
      await processQueue();

      // Clean expired Last.fm cache entries
      const cleaned = await cleanExpiredCache();
      if (cleaned > 0) {
        console.log(`[worker] cleaned ${cleaned} expired cache entries`);
      }
    } catch (err) {
      console.error("[worker] unexpected error:", err);
    }
  }, INTERVAL_MS);
}
