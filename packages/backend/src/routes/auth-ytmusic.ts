import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getAuthSetup, pollAuthToken, getYTUserInfo } from "../ytmusic.js";
import { findOrCreateUser } from "../db.js";

const router = Router();

const authLimiter = rateLimit({ windowMs: 60_000, max: 5, message: { error: "Too many requests. Try again in 1 minute." } });
const pollLimiter = rateLimit({ windowMs: 60_000, max: 30, message: { error: "Too many requests." } });

// Step 1: Get device code + verification URL
router.get("/auth/ytmusic/setup", authLimiter, async (_req, res) => {
  try {
    const setup = await getAuthSetup();
    res.json(setup);
  } catch (error: any) {
    console.error("[ytmusic-auth] setup error:", error.message);
    res.status(500).json({ error: "Failed to start YouTube Music auth" });
  }
});

// Step 2: Poll for token (frontend calls this repeatedly)
router.post("/auth/ytmusic/token", pollLimiter, async (req, res) => {
  const { device_code } = req.body;
  if (!device_code) {
    res.status(400).json({ error: "Missing device_code" });
    return;
  }

  try {
    const result = await pollAuthToken(device_code);
    if (!result) {
      res.json({ pending: true });
      return;
    }

    // Token received — try to get user info (optional, may fail)
    let channelId = result.channel_id || "unknown";
    let userName = "";
    let userId: number | null = null;

    try {
      const userInfo = await getYTUserInfo(result.token);
      channelId = userInfo.channelId || channelId;
      userName = userInfo.name || "";
    } catch (infoErr: any) {
      console.warn("[ytmusic-auth] could not get user info:", infoErr.message);
    }

    try {
      const user = await findOrCreateUser("ytmusic", channelId);
      userId = user.id;
    } catch (dbErr: any) {
      console.warn("[ytmusic-auth] could not create user:", dbErr.message);
    }

    res.json({
      token: result.token,
      channelId,
      userName,
      userId,
    });
  } catch (error: any) {
    const status = error.response?.status;
    const errorData = error.response?.data;

    if (status && status < 500) {
      console.log("[ytmusic-auth] polling pending:", errorData?.error || status);
      res.json({ pending: true });
      return;
    }

    console.error("[ytmusic-auth] token error:", error.message);
    res.status(500).json({ error: "Failed to get YouTube Music token" });
  }
});

export default router;
