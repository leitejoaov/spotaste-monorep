// Imports a Spotify "Extended Streaming History" export (my_spotify_data.zip) and
// sends every track through the Essentia audio-service.
//
// Usage (from repo root):
//   pnpm import:history <path-to-zip-or-folder> [options]
//
// Options:
//   --direct            analyze now in this process instead of just enqueueing for the worker
//   --concurrency N     parallel requests to the audio-service in --direct mode (default 1)
//   --min-plays N       only tracks with at least N plays of >= 30s (default 1)
//   --min-ms N          only tracks with at least N ms listened in total (default 30000)
//   --since YYYY        only plays from this year on
//   --limit N           only the N most-played tracks
//   --dry-run           print stats, don't touch the database
import "../config.js";
import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  bulkAddToQueue,
  closeDb,
  getAnalyzedSpotifyIds,
  initDb,
  saveTrackFeatures,
  updateQueueStatus,
  type QueueItem,
} from "../db.js";
import { analyzeWithEssentia } from "../essentia.js";

interface StreamRow {
  ts: string;
  ms_played: number;
  master_metadata_track_name: string | null;
  master_metadata_album_artist_name: string | null;
  spotify_track_uri: string | null;
}

interface HistoryTrack extends QueueItem {
  plays: number;
  ms: number;
}

const REAL_PLAY_MS = 30_000;

function parseArgs(argv: string[]) {
  const opts = {
    input: "",
    direct: false,
    dryRun: false,
    concurrency: 1,
    minPlays: 1,
    minMs: REAL_PLAY_MS,
    since: 0,
    limit: Infinity,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => Number(argv[++i]);
    if (arg === "--direct") opts.direct = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--concurrency") opts.concurrency = Math.max(1, next());
    else if (arg === "--min-plays") opts.minPlays = next();
    else if (arg === "--min-ms") opts.minMs = next();
    else if (arg === "--since") opts.since = next();
    else if (arg === "--limit") opts.limit = next();
    else if (!arg.startsWith("--")) opts.input = arg;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!opts.input) {
    throw new Error("Usage: pnpm import:history <my_spotify_data.zip | folder> [--direct] [--min-plays N] ...");
  }
  return opts;
}

function findHistoryFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...findHistoryFiles(full));
    else if (/^Streaming_History_Audio_.*\.json$/.test(name)) files.push(full);
  }
  return files;
}

function loadHistory(input: string): StreamRow[] {
  if (!existsSync(input)) throw new Error(`Not found: ${input}`);

  let dir = input;
  let tmp: string | null = null;
  if (input.endsWith(".zip")) {
    tmp = mkdtempSync(join(tmpdir(), "spotaste-history-"));
    execFileSync("unzip", ["-q", "-o", input, "-d", tmp]);
    dir = tmp;
  }

  try {
    const files = findHistoryFiles(dir);
    if (files.length === 0) throw new Error(`No Streaming_History_Audio_*.json files in ${input}`);
    console.log(`[import] reading ${files.length} history files`);
    return files.flatMap((f) => JSON.parse(readFileSync(f, "utf-8")) as StreamRow[]);
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

function aggregate(rows: StreamRow[], since: number): HistoryTrack[] {
  const tracks = new Map<string, HistoryTrack>();
  for (const row of rows) {
    // Podcasts, audiobooks and local files have no track URI
    if (!row.spotify_track_uri?.startsWith("spotify:track:")) continue;
    if (!row.master_metadata_track_name || !row.master_metadata_album_artist_name) continue;
    if (since && Number(row.ts.slice(0, 4)) < since) continue;

    const id = row.spotify_track_uri.slice("spotify:track:".length);
    let track = tracks.get(id);
    if (!track) {
      track = {
        spotify_id: id,
        track_name: row.master_metadata_track_name,
        artist_name: row.master_metadata_album_artist_name,
        plays: 0,
        ms: 0,
      };
      tracks.set(id, track);
    }
    track.ms += row.ms_played;
    if (row.ms_played >= REAL_PLAY_MS) track.plays++;
  }
  // Most-played first, so the best-known tracks get analyzed earliest
  return [...tracks.values()].sort((a, b) => b.plays - a.plays || b.ms - a.ms);
}

async function analyzeDirect(tracks: HistoryTrack[], concurrency: number): Promise<void> {
  let next = 0;
  let done = 0;
  let failed = 0;
  const started = Date.now();

  async function runOne(): Promise<void> {
    while (next < tracks.length) {
      const track = tracks[next++];
      try {
        // Claim it so a running backend worker doesn't analyze it too
        await updateQueueStatus(track.spotify_id, "processing");
        const features = await analyzeWithEssentia(track.track_name, track.artist_name);
        await saveTrackFeatures(track.spotify_id, track.track_name, track.artist_name, features);
        await updateQueueStatus(track.spotify_id, "done");
        done++;
      } catch (err: any) {
        failed++;
        await updateQueueStatus(track.spotify_id, "failed").catch(() => {});
        console.error(`[import] failed: ${track.track_name} - ${track.artist_name}: ${err.message}`);
      }
      const total = done + failed;
      if (total % 10 === 0 || total === tracks.length) {
        const perTrack = (Date.now() - started) / total;
        const etaMin = Math.round(((tracks.length - total) * perTrack) / concurrency / 60_000);
        console.log(`[import] ${total}/${tracks.length} (ok ${done}, failed ${failed}) — ETA ~${etaMin} min`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, runOne));
  console.log(`[import] finished: ${done} analyzed, ${failed} failed`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  const rows = loadHistory(opts.input);
  const all = aggregate(rows, opts.since);
  const filtered = all
    .filter((t) => t.plays >= opts.minPlays && t.ms >= opts.minMs)
    .slice(0, opts.limit);

  console.log(`[import] ${rows.length} plays, ${all.length} unique tracks, ${filtered.length} after filters`);
  if (opts.dryRun) {
    console.log("[import] top 10:");
    for (const t of filtered.slice(0, 10)) {
      console.log(`  ${t.plays}x  ${t.track_name} - ${t.artist_name}`);
    }
    return;
  }

  await initDb();
  const analyzed = await getAnalyzedSpotifyIds();
  const todo = filtered.filter((t) => !analyzed.has(t.spotify_id));
  console.log(`[import] ${filtered.length - todo.length} already analyzed, ${todo.length} to go`);

  // Always enqueue: keeps progress visible in /api/queue-status and lets the
  // backend worker pick up whatever a --direct run doesn't finish.
  const inserted = await bulkAddToQueue(todo);
  console.log(`[import] enqueued ${inserted} new tracks`);

  if (opts.direct) {
    await analyzeDirect(todo, opts.concurrency);
  } else {
    console.log("[import] the backend worker will process them (5 every 30s). Use --direct to go faster.");
  }
}

main()
  .catch((err) => {
    console.error(`[import] ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
