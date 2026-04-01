import { Router } from "express";
import { validateUser, getTopTracks } from "../lastfm.js";
import { findOrCreateUser, addToQueue, getTrackFeatures } from "../db.js";

const router = Router();

// Validate Last.fm username and create user
router.post("/auth/lastfm/login", async (req, res) => {
  const { username } = req.body;
  if (!username || typeof username !== "string" || username.trim().length === 0) {
    return res.status(400).json({ error: "Username obrigatorio" });
  }

  const trimmed = username.trim();

  try {
    const userInfo = await validateUser(trimmed);
    if (!userInfo) {
      return res.status(404).json({ error: "Usuario nao encontrado no Last.fm" });
    }

    const user = await findOrCreateUser("lastfm", trimmed);

    // Fire-and-forget: enqueue top tracks for Essentia analysis
    enqueueLastfmTopTracks(trimmed).catch((err) =>
      console.error("Error enqueuing Last.fm tracks:", err.message)
    );

    res.json({
      userId: user.id,
      lastfmUser: userInfo,
    });
  } catch (err: any) {
    console.error("Last.fm login error:", err.message);
    res.status(500).json({ error: "Falha ao validar usuario" });
  }
});

async function enqueueLastfmTopTracks(username: string) {
  const tracks = await getTopTracks(username, "3month", 50);
  let newCount = 0;
  for (const track of tracks) {
    const trackId = `lastfm_${track.name}_${track.artist}`.slice(0, 60);
    const existing = await getTrackFeatures(trackId);
    if (!existing) {
      await addToQueue(trackId, track.name, track.artist);
      newCount++;
    }
    if (newCount >= 20) break;
  }
  if (newCount > 0) {
    console.log(`Enqueued ${newCount} Last.fm tracks for ${username}`);
  }
}

export default router;
