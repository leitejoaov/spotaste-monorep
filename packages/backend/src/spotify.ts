import axios from "axios";
import { config } from "./config.js";

interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  genres: string[];
  popularity: number;
  images: { url: string; height: number; width: number }[];
  external_urls: { spotify: string };
}

interface TopArtistsResponse {
  items: SpotifyArtist[];
}

export async function getSpotifyUserId(accessToken: string): Promise<string> {
  const { data } = await axios.get<{ id: string }>(
    "https://api.spotify.com/v1/me",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  return data.id;
}

export function getAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.spotify.clientId,
    scope: "user-top-read user-read-playback-state user-read-recently-played playlist-modify-private playlist-modify-public",
    redirect_uri: config.spotify.redirectUri,
    state,
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

export async function exchangeCode(code: string): Promise<string> {
  const credentials = Buffer.from(
    `${config.spotify.clientId}:${config.spotify.clientSecret}`
  ).toString("base64");

  const { data } = await axios.post<SpotifyTokenResponse>(
    "https://accounts.spotify.com/api/token",
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.spotify.redirectUri,
    }),
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  return data.access_token;
}

export async function getTopArtists(accessToken: string): Promise<SpotifyArtist[]> {
  const { data } = await axios.get<TopArtistsResponse>(
    "https://api.spotify.com/v1/me/top/artists?limit=10",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (data.items.length > 0) return data.items;

  // Fallback for new users: extract artists from recently played tracks
  console.log("[spotify] no top artists, falling back to recently played");
  try {
    const { data: recent } = await axios.get(
      "https://api.spotify.com/v1/me/player/recently-played?limit=50",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const artistMap = new Map<string, SpotifyArtist>();
    for (const item of recent.items || []) {
      const track = item.track;
      if (!track?.artists?.[0]) continue;
      for (const a of track.artists) {
        if (artistMap.has(a.id)) continue;
        artistMap.set(a.id, {
          id: a.id,
          name: a.name,
          genres: [],
          images: track.album?.images || [],
          popularity: 0,
          external_urls: a.external_urls || { spotify: "" },
        });
      }
      if (artistMap.size >= 10) break;
    }

    const artists = [...artistMap.values()];
    console.log(`[spotify] found ${artists.length} artists from recently played`);
    return artists;
  } catch (err) {
    console.error("[spotify] recently played fallback failed:", err);
    return [];
  }
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: { name: string }[];
  preview_url: string | null;
  album: {
    name: string;
    images: { url: string; height: number; width: number }[];
  };
}

interface TopTracksResponse {
  items: SpotifyTrack[];
}

export async function getTopTracks(
  accessToken: string,
  options?: { limit?: number; offset?: number }
): Promise<SpotifyTrack[]> {
  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;
  const { data } = await axios.get<TopTracksResponse>(
    `https://api.spotify.com/v1/me/top/tracks?limit=${limit}&offset=${offset}&time_range=medium_term`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  return data.items;
}

export async function getTrackDetails(accessToken: string, trackId: string): Promise<SpotifyTrack> {
  const { data } = await axios.get<SpotifyTrack>(
    `https://api.spotify.com/v1/tracks/${trackId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  return data;
}

export interface SpotifySearchResult {
  id: string;
  name: string;
  artists: { name: string }[];
  album: {
    name: string;
    images: { url: string; height: number; width: number }[];
  };
}

export async function searchTracks(
  accessToken: string,
  query: string,
  limit = 8
): Promise<SpotifySearchResult[]> {
  const { data } = await axios.get<{ tracks: { items: SpotifySearchResult[] } }>(
    `https://api.spotify.com/v1/search?type=track&limit=${limit}&q=${encodeURIComponent(query)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  return data.tracks.items;
}

export async function createPlaylist(
  accessToken: string,
  userId: string,
  name: string,
  description?: string
): Promise<{ id: string; url: string }> {
  const { data } = await axios.post(
    `https://api.spotify.com/v1/users/${userId}/playlists`,
    { name, description, public: false },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return { id: data.id, url: data.external_urls.spotify };
}

export async function addTracksToPlaylist(
  accessToken: string,
  playlistId: string,
  trackIds: string[]
): Promise<void> {
  const uris = trackIds.map((id) => `spotify:track:${id}`);
  await axios.post(
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
    { uris },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
}

export async function searchArtist(
  accessToken: string,
  name: string
): Promise<SpotifyArtist | null> {
  const { data } = await axios.get(
    `https://api.spotify.com/v1/search?type=artist&limit=1&q=${encodeURIComponent(name)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return data.artists.items[0] || null;
}

export interface ArtistTopTrack {
  id: string;
  name: string;
  artists: { name: string }[];
  album: {
    name: string;
    images: { url: string; height: number; width: number }[];
  };
  external_urls: { spotify: string };
  duration_ms: number;
}

export async function getArtistTopTracks(
  accessToken: string,
  artistId: string
): Promise<ArtistTopTrack[]> {
  const { data } = await axios.get<{ tracks: ArtistTopTrack[] }>(
    `https://api.spotify.com/v1/artists/${artistId}/top-tracks`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return data.tracks.slice(0, 10);
}
