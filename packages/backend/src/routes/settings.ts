import { Router } from "express";
import { getUserById, linkPlatform } from "../db.js";
import { validateUser } from "../lastfm.js";
import { getSpotifyUserId } from "../spotify.js";

const router = Router();

router.get("/api/settings/accounts", async (req, res) => {
  const userId = Number(req.headers["x-user-id"]);
  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  const user = await getUserById(userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  res.json({
    userId: user.id,
    lastfm: { connected: !!user.lastfm_username, username: user.lastfm_username },
    spotify: { connected: !!user.spotify_user_id },
    primaryPlatform: user.primary_platform,
  });
});

router.post("/api/settings/link-lastfm", async (req, res) => {
  const userId = Number(req.headers["x-user-id"]);
  const { username } = req.body;
  if (!userId || !username) {
    return res.status(400).json({ error: "userId and username required" });
  }

  const userInfo = await validateUser(username.trim());
  if (!userInfo) {
    return res.status(404).json({ error: "Usuario nao encontrado no Last.fm" });
  }

  try {
    const user = await linkPlatform(userId, "lastfm", username.trim());
    res.json({ connected: true, username: user.lastfm_username });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/settings/link-spotify", async (req, res) => {
  const userId = Number(req.headers["x-user-id"]);
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!userId || !token) {
    return res.status(400).json({ error: "userId and spotify token required" });
  }

  try {
    const spotifyUserId = await getSpotifyUserId(token);
    const user = await linkPlatform(userId, "spotify", spotifyUserId);
    res.json({ connected: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
