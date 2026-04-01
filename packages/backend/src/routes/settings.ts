import { Router } from "express";
import { getUserById, linkPlatform } from "../db.js";
import { validateUser } from "../lastfm.js";
import { getSpotifyUserId } from "../spotify.js";

const router = Router();

/**
 * Verify the caller's identity by checking at least one trusted credential
 * (Spotify token or Last.fm username) matches the claimed user ID.
 * Returns the verified user or null.
 */
async function verifyUser(req: any): Promise<any | null> {
  const userId = Number(req.headers["x-user-id"]);
  if (!userId) return null;

  const user = await getUserById(userId);
  if (!user) return null;

  // Verify via Spotify token
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token) {
    try {
      const spotifyId = await getSpotifyUserId(token);
      if (user.spotify_user_id === spotifyId) return user;
    } catch { /* token invalid, try Last.fm */ }
  }

  // Verify via Last.fm username header
  const lastfmUser = req.headers["x-lastfm-user"] as string;
  if (lastfmUser && user.lastfm_username === lastfmUser) {
    return user;
  }

  return null;
}

router.get("/api/settings/accounts", async (req, res) => {
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  res.json({
    userId: user.id,
    lastfm: { connected: !!user.lastfm_username, username: user.lastfm_username },
    spotify: { connected: !!user.spotify_user_id },
    primaryPlatform: user.primary_platform,
  });
});

router.post("/api/settings/link-lastfm", async (req, res) => {
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: "username required" });
  }

  const userInfo = await validateUser(username.trim());
  if (!userInfo) {
    return res.status(404).json({ error: "Usuario nao encontrado no Last.fm" });
  }

  try {
    const updated = await linkPlatform(user.id, "lastfm", username.trim());
    res.json({ connected: true, username: updated.lastfm_username });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/settings/link-spotify", async (req, res) => {
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    return res.status(400).json({ error: "Spotify token required" });
  }

  try {
    const spotifyUserId = await getSpotifyUserId(token);
    const updated = await linkPlatform(user.id, "spotify", spotifyUserId);
    res.json({ connected: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
