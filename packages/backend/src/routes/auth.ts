import { Router } from "express";
import { randomBytes } from "crypto";
import { config } from "../config.js";
import { getAuthUrl, exchangeCode, getTopArtists, getTopTracks } from "../spotify.js";
import { addToQueue, getTrackFeatures } from "../db.js";

export const authRouter = Router();

// In-memory store for OAuth state tokens (short-lived, cleared on use)
const pendingStates = new Map<string, number>();

authRouter.get("/login", (_req, res) => {
  const state = randomBytes(16).toString("hex");
  pendingStates.set(state, Date.now());
  // Clean old states (> 10 min)
  for (const [k, v] of pendingStates) {
    if (Date.now() - v > 600_000) pendingStates.delete(k);
  }
  res.redirect(getAuthUrl(state));
});

authRouter.get("/callback", async (req, res) => {
  console.log("[callback] hit with query:", req.query);
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;

  if (!state || !pendingStates.has(state)) {
    console.log("[callback] invalid or missing state parameter");
    res.redirect(`${config.frontendUrl}/#/error?message=${encodeURIComponent("Invalid state - possible CSRF attack")}`);
    return;
  }
  pendingStates.delete(state);

  if (!code) {
    console.log("[callback] no code, redirecting to error");
    res.redirect(`${config.frontendUrl}/#/error?message=${encodeURIComponent("Authorization failed")}`);
    return;
  }

  try {
    console.log("[callback] exchanging code...");
    const accessToken = await exchangeCode(code);
    console.log("[callback] got access token, fetching artists...");
    const artists = await getTopArtists(accessToken);
    console.log("[callback] got", artists.length, "artists, redirecting to hub");

    const topArtistsData = artists.map((a) => ({
      name: a.name,
      image: a.images[0]?.url ?? "",
      genres: a.genres.slice(0, 3),
    }));

    const artistsPayload = encodeURIComponent(JSON.stringify(topArtistsData));

    // Enqueue top tracks for background analysis (fire-and-forget)
    (async () => {
      try {
        const MAX_OFFSET = 80;
        let totalEnqueued = 0;

        for (let offset = 0; offset <= MAX_OFFSET; offset += 20) {
          const tracks = await getTopTracks(accessToken, { offset });
          if (tracks.length === 0) break;

          let newTracks = 0;
          for (const track of tracks) {
            if (!track.id) continue;
            const exists = await getTrackFeatures(track.id);
            if (!exists) {
              await addToQueue(track.id, track.name, track.artists[0]?.name || "Unknown");
              newTracks++;
            }
          }
          totalEnqueued += newTracks;
          console.log(`[callback] offset=${offset}: ${newTracks} new tracks enqueued (${tracks.length - newTracks} already in db)`);

          if (newTracks > 0) break;
          console.log(`[callback] all tracks at offset=${offset} already in db, fetching next page...`);
        }

        console.log(`[callback] total enqueued: ${totalEnqueued}`);
      } catch (err) {
        console.error("[callback] failed to enqueue tracks:", err);
      }
    })();

    // Redirect to frontend callback page that stores token in sessionStorage
    // Token is in a hash fragment (not query param) so it's not sent to servers or logged
    res.redirect(`${config.frontendUrl}/#/auth-callback?artists=${artistsPayload}&t=${encodeURIComponent(accessToken)}`);
  } catch (error) {
    console.error("[callback] ERROR:", error);
    res.redirect(`${config.frontendUrl}/#/error?message=${encodeURIComponent("Something went wrong")}`);
  }
});
