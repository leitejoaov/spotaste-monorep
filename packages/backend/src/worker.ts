import {
  getPendingQueue,
  getTrackFeatures,
  getTracksWithoutMoods,
  updateQueueStatus,
  saveTrackFeatures,
  resetStuckProcessing,
} from "./db.js";
import { analyzeWithEssentia } from "./essentia.js";

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

export async function startWorker(): Promise<void> {
  // Reset items stuck in 'processing' from a previous crash
  const reset = await resetStuckProcessing();
  if (reset > 0) console.log(`[worker] reset ${reset} stuck processing items`);
  console.log(`[worker] started (interval: ${INTERVAL_MS / 1000}s)`);
  setInterval(async () => {
    try {
      await processQueue();
    } catch (err) {
      console.error("[worker] unexpected error:", err);
    }
  }, INTERVAL_MS);
}
