import axios from "axios";
import { config } from "./config.js";

const BASE = config.ytmusicServiceUrl;

function encodeToken(token: object): string {
  return Buffer.from(JSON.stringify(token)).toString("base64");
}

// Auth
export async function getAuthSetup(): Promise<{
  verification_url: string;
  user_code: string;
  device_code: string;
  interval: number;
}> {
  const { data } = await axios.get(`${BASE}/auth/setup`, { timeout: 10000 });
  return data;
}

export async function pollAuthToken(deviceCode: string): Promise<{
  token: object;
  channel_id: string;
} | null> {
  const { data } = await axios.post(`${BASE}/auth/token`, { device_code: deviceCode }, { timeout: 10000 });
  if (data.pending) return null;
  return data;
}

export async function refreshYTToken(token: object): Promise<object> {
  const { data } = await axios.post(`${BASE}/auth/refresh`, { token }, { timeout: 10000 });
  return data.token;
}

// User
export async function getYTUserInfo(token: object): Promise<{ channelId: string; name: string }> {
  const { data } = await axios.get(`${BASE}/user/info`, {
    headers: { "X-Token": encodeToken(token) },
    timeout: 10000,
  });
  return data;
}

export async function getYTLikedSongs(token: object, limit = 200): Promise<YTTrack[]> {
  const { data } = await axios.get(`${BASE}/user/liked-songs`, {
    headers: { "X-Token": encodeToken(token) },
    params: { limit },
    timeout: 30000,
  });
  return data;
}

export async function getYTHistory(token: object, limit = 200): Promise<YTTrack[]> {
  const { data } = await axios.get(`${BASE}/user/history`, {
    headers: { "X-Token": encodeToken(token) },
    params: { limit },
    timeout: 30000,
  });
  return data;
}

// Top tracks (synthetic: liked + history scored)
export async function getYTTopTracks(token: object, limit = 50): Promise<YTTrack[]> {
  const [liked, history] = await Promise.all([
    getYTLikedSongs(token, 200),
    getYTHistory(token, 200),
  ]);

  const scores = new Map<string, { track: YTTrack; score: number }>();

  for (const t of liked) {
    const key = `${t.title.toLowerCase()}_${t.artist.toLowerCase()}`;
    const existing = scores.get(key);
    if (existing) {
      existing.score += 5;
    } else {
      scores.set(key, { track: t, score: 5 });
    }
  }

  for (const t of history) {
    const key = `${t.title.toLowerCase()}_${t.artist.toLowerCase()}`;
    const existing = scores.get(key);
    if (existing) {
      existing.score += 1;
    } else {
      scores.set(key, { track: t, score: 1 });
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.track);
}

// Search
export async function searchYTTracks(token: object | null, query: string, limit = 20): Promise<YTTrack[]> {
  const headers: Record<string, string> = {};
  if (token) headers["X-Token"] = encodeToken(token);
  const { data } = await axios.get(`${BASE}/search`, {
    headers,
    params: { q: query, limit },
    timeout: 10000,
  });
  return data;
}

// Artist
export async function getYTArtistInfo(token: object | null, channelId: string): Promise<any> {
  const headers: Record<string, string> = {};
  if (token) headers["X-Token"] = encodeToken(token);
  const { data } = await axios.get(`${BASE}/artist/${channelId}`, {
    headers,
    timeout: 10000,
  });
  return data;
}

// Playlist creation
export async function createYTPlaylist(token: object, title: string, description: string): Promise<string> {
  const { data } = await axios.post(
    `${BASE}/playlist/create`,
    { title, description },
    { headers: { "X-Token": encodeToken(token) }, timeout: 10000 }
  );
  return data.playlistId;
}

export async function addToYTPlaylist(token: object, playlistId: string, videoIds: string[]): Promise<void> {
  await axios.post(
    `${BASE}/playlist/${playlistId}/add`,
    { videoIds },
    { headers: { "X-Token": encodeToken(token) }, timeout: 30000 }
  );
}

// Types
export interface YTTrack {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  thumbnail: string | null;
  duration?: string;
}
