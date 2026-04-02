import axios from "axios";
import { config } from "./config.js";
import { getLastfmCache, setLastfmCache } from "./db.js";

// ============ INTERFACES ============

export interface LastfmUserInfo {
  name: string;
  realname: string;
  playcount: number;
  artist_count: number;
  track_count: number;
  image: string;
  url: string;
  registered: number;
  country: string;
}

export type LastfmPeriod =
  | "7day"
  | "1month"
  | "3month"
  | "6month"
  | "12month"
  | "overall";

export interface LastfmTopArtist {
  name: string;
  playcount: number;
  mbid: string;
  url: string;
  image: string;
  rank: number;
}

export interface LastfmTopTrack {
  name: string;
  artist: string;
  playcount: number;
  mbid: string;
  url: string;
  image: string;
  rank: number;
}

export interface LastfmRecentTrack {
  name: string;
  artist: string;
  album: string;
  image: string;
  date: number;
  nowplaying: boolean;
}

export interface LastfmTrackInfo {
  name: string;
  artist: string;
  album: string;
  duration: number;
  listeners: number;
  playcount: number;
  userplaycount: number;
  userloved: boolean;
  tags: string[];
  url: string;
  wiki: string;
}

export interface LastfmArtistInfo {
  name: string;
  mbid: string;
  url: string;
  image: string;
  listeners: number;
  playcount: number;
  tags: string[];
  bio: string;
  similar: { name: string; match: number; image: string }[];
}

export interface LastfmArtistTopTrack {
  name: string;
  playcount: number;
  listeners: number;
  url: string;
}

export interface LastfmSearchResult {
  name: string;
  artist: string;
  listeners: number;
  url: string;
  image: string;
}

// ============ RATE LIMITER ============

const RATE_LIMIT_MS = 250; // max 4 requests/second
let lastRequestTime = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

// ============ HELPERS ============

const BASE_URL = "https://ws.audioscrobbler.com/2.0/";

function extractImage(images: any): string {
  if (!images || !Array.isArray(images)) return "";
  return (
    images.find((i: any) => i.size === "extralarge")?.["#text"] || ""
  );
}

function normalizeArray<T>(items: T | T[] | undefined): T[] {
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

async function apiGet(params: Record<string, string>): Promise<any> {
  await rateLimit();

  const { data } = await axios.get(BASE_URL, {
    params: {
      ...params,
      api_key: config.lastfmApiKey,
      format: "json",
    },
    timeout: 10000,
  });

  // Last.fm returns errors inside 200 responses
  if (data.error) {
    throw new Error(`Last.fm API error ${data.error}: ${data.message}`);
  }

  return data;
}

async function cachedGet(
  username: string,
  cacheKey: string,
  params: Record<string, string>
): Promise<any> {
  const cached = await getLastfmCache(username, cacheKey);
  if (cached) return cached;

  const data = await apiGet(params);
  await setLastfmCache(username, cacheKey, data);
  return data;
}

// ============ IMAGE FALLBACK (Deezer) ============

export async function resolveArtistImage(
  name: string,
  lastfmImage: string
): Promise<string> {
  // If Last.fm provided a valid image, use it
  if (lastfmImage && !lastfmImage.includes("2a96cbd8b46e442fc41c2b86b821562f")) {
    return lastfmImage;
  }

  // Fallback to Deezer (free, no auth needed)
  const cacheKey = `deezer_img_${name.toLowerCase()}`;
  const cached = await getLastfmCache("_global", cacheKey);
  if (cached?.url) return cached.url;

  try {
    const { data } = await axios.get("https://api.deezer.com/search/artist", {
      params: { q: name, limit: 5 },
      timeout: 5000,
    });
    // Find best match by name similarity to avoid wrong artist
    const match = data?.data?.find(
      (a: any) => a.name.toLowerCase() === name.toLowerCase()
    ) || data?.data?.[0];
    const img = match?.picture_big || match?.picture_medium || "";
    if (img) {
      await setLastfmCache("_global", cacheKey, { url: img });
    }
    return img;
  } catch {
    return lastfmImage || "";
  }
}

export async function resolveTrackImage(
  trackName: string,
  artistName: string,
  lastfmImage: string
): Promise<string> {
  // If Last.fm provided a valid image, use it
  if (lastfmImage && !lastfmImage.includes("2a96cbd8b46e442fc41c2b86b821562f")) {
    return lastfmImage;
  }

  // Fallback to Deezer track search (returns album cover)
  const cacheKey = `deezer_track_${artistName.toLowerCase()}_${trackName.toLowerCase()}`;
  const cached = await getLastfmCache("_global", cacheKey);
  if (cached?.url) return cached.url;

  try {
    const { data } = await axios.get("https://api.deezer.com/search", {
      params: { q: `artist:"${artistName}" track:"${trackName}"`, limit: 5 },
      timeout: 5000,
    });
    // Prefer result matching the correct artist
    const match = data?.data?.find(
      (t: any) => t.artist?.name?.toLowerCase() === artistName.toLowerCase()
    ) || data?.data?.[0];
    const img = match?.album?.cover_big || match?.album?.cover_medium || "";
    if (img) {
      await setLastfmCache("_global", cacheKey, { url: img });
    }
    return img;
  } catch {
    // Fall back to artist image
    return resolveArtistImage(artistName, "");
  }
}

// ============ API FUNCTIONS ============

export async function validateUser(
  username: string
): Promise<LastfmUserInfo | null> {
  try {
    const data = await cachedGet(username, "user_info", {
      method: "user.getInfo",
      user: username,
    });

    const u = data.user;
    return {
      name: u.name || "",
      realname: u.realname || "",
      playcount: Number(u.playcount) || 0,
      artist_count: Number(u.artist_count) || 0,
      track_count: Number(u.track_count) || 0,
      image: extractImage(u.image),
      url: u.url || "",
      registered: Number(u.registered?.unixtime) || 0,
      country: u.country || "",
    };
  } catch {
    return null;
  }
}

export async function getTopArtists(
  username: string,
  period: LastfmPeriod = "overall",
  limit = 50
): Promise<LastfmTopArtist[]> {
  const cacheKey = `top_artists_${period}_${limit}`;
  const data = await cachedGet(username, cacheKey, {
    method: "user.getTopArtists",
    user: username,
    period,
    limit: String(limit),
  });

  const artists = normalizeArray(data.topartists?.artist);
  const mapped = artists.map((a: any, i: number) => ({
    name: a.name || "",
    playcount: Number(a.playcount) || 0,
    mbid: a.mbid || "",
    url: a.url || "",
    image: extractImage(a.image),
    rank: Number(a["@attr"]?.rank) || i + 1,
  }));

  // Resolve images via Deezer fallback for artists with missing images
  const resolved = await Promise.all(
    mapped.map(async (a) => ({
      ...a,
      image: await resolveArtistImage(a.name, a.image),
    }))
  );
  return resolved;
}

export async function getTopTracks(
  username: string,
  period: LastfmPeriod = "overall",
  limit = 50
): Promise<LastfmTopTrack[]> {
  const cacheKey = `top_tracks_${period}_${limit}`;
  const data = await cachedGet(username, cacheKey, {
    method: "user.getTopTracks",
    user: username,
    period,
    limit: String(limit),
  });

  const tracks = normalizeArray(data.toptracks?.track);
  return tracks.map((t: any, i: number) => ({
    name: t.name || "",
    artist: t.artist?.name || "",
    playcount: Number(t.playcount) || 0,
    mbid: t.mbid || "",
    url: t.url || "",
    image: extractImage(t.image),
    rank: Number(t["@attr"]?.rank) || i + 1,
  }));
}

export async function getRecentTracks(
  username: string,
  limit = 50
): Promise<LastfmRecentTrack[]> {
  const data = await cachedGet(username, "recent_tracks", {
    method: "user.getRecentTracks",
    user: username,
    limit: String(limit),
  });

  const tracks = normalizeArray(data.recenttracks?.track);
  return tracks.map((t: any) => ({
    name: t.name || "",
    artist: t.artist?.["#text"] || "",
    album: t.album?.["#text"] || "",
    image: extractImage(t.image),
    date: Number(t.date?.uts) || 0,
    nowplaying: t["@attr"]?.nowplaying === "true",
  }));
}

export async function getTrackInfo(
  artist: string,
  track: string,
  username?: string
): Promise<LastfmTrackInfo | null> {
  try {
    const cacheUser = username || "_global";
    const cacheKey = `track_info_${artist}_${track}`;
    const params: Record<string, string> = {
      method: "track.getInfo",
      artist,
      track,
    };
    if (username) params.username = username;

    const data = await cachedGet(cacheUser, cacheKey, params);

    const t = data.track;
    const tags = normalizeArray(t.toptags?.tag);
    return {
      name: t.name || "",
      artist: t.artist?.name || "",
      album: t.album?.title || "",
      duration: Number(t.duration) || 0,
      listeners: Number(t.listeners) || 0,
      playcount: Number(t.playcount) || 0,
      userplaycount: Number(t.userplaycount) || 0,
      userloved: t.userloved === "1",
      tags: tags.map((tag: any) => tag.name || ""),
      url: t.url || "",
      wiki: t.wiki?.summary || "",
    };
  } catch {
    return null;
  }
}

export async function getArtistInfo(
  artist: string
): Promise<LastfmArtistInfo | null> {
  try {
    const cacheKey = `artist_info_${artist}`;
    const data = await cachedGet("_global", cacheKey, {
      method: "artist.getInfo",
      artist,
    });

    const a = data.artist;
    const tags = normalizeArray(a.tags?.tag);
    const similar = normalizeArray(a.similar?.artist);
    const image = await resolveArtistImage(a.name || artist, extractImage(a.image));
    return {
      name: a.name || "",
      mbid: a.mbid || "",
      url: a.url || "",
      image,
      listeners: Number(a.stats?.listeners) || 0,
      playcount: Number(a.stats?.playcount) || 0,
      tags: tags.map((tag: any) => tag.name || ""),
      bio: a.bio?.summary || "",
      similar: similar.map((s: any) => ({
        name: s.name || "",
        match: Number(s.match) || 0,
        image: extractImage(s.image),
      })),
    };
  } catch {
    return null;
  }
}

export async function getArtistTopTracks(
  artist: string,
  limit = 10
): Promise<LastfmArtistTopTrack[]> {
  const cacheKey = `artist_top_tracks_${artist}_${limit}`;
  const data = await cachedGet("_global", cacheKey, {
    method: "artist.getTopTracks",
    artist,
    limit: String(limit),
  });

  const tracks = normalizeArray(data.toptracks?.track);
  return tracks.map((t: any) => ({
    name: t.name || "",
    playcount: Number(t.playcount) || 0,
    listeners: Number(t.listeners) || 0,
    url: t.url || "",
  }));
}

export async function getSimilarArtists(
  artist: string,
  limit = 20
): Promise<{ name: string; match: number; image: string }[]> {
  const cacheKey = `similar_artists_${artist}_${limit}`;
  const data = await cachedGet("_global", cacheKey, {
    method: "artist.getSimilar",
    artist,
    limit: String(limit),
  });

  const artists = normalizeArray(data.similarartists?.artist);
  return artists.map((a: any) => ({
    name: a.name || "",
    match: Number(a.match) || 0,
    image: extractImage(a.image),
  }));
}

export async function searchTrack(
  query: string,
  limit = 20
): Promise<LastfmSearchResult[]> {
  // searchTrack does NOT use cache
  const data = await apiGet({
    method: "track.search",
    track: query,
    limit: String(limit),
  });

  const tracks = normalizeArray(
    data.results?.trackmatches?.track
  );
  return tracks.map((t: any) => ({
    name: t.name || "",
    artist: t.artist || "",
    listeners: Number(t.listeners) || 0,
    url: t.url || "",
    image: extractImage(t.image),
  }));
}
