import axios from "axios";

// YouTube channel name patterns to strip from artist_name
const CHANNEL_SUFFIXES = /(?:VEVO|Official|Music|Records|TV|HQ|Oficial|4eva)$/i;

/**
 * Clean up track name and artist for lyrics search.
 * Handles YouTube-style names like "Artist - Song (Official Video) - ChannelName"
 */
function cleanForSearch(artist: string, title: string): { artist: string; title: string } {
  let cleanArtist = artist.trim();
  let cleanTitle = title.trim();

  // If title contains "Artist - Song" pattern, extract artist from it
  const dashParts = cleanTitle.split(/\s*[-–—]\s*/);
  if (dashParts.length >= 2) {
    // Check if first part looks like an artist name (not a generic word)
    const possibleArtist = dashParts[0].trim();
    const possibleTitle = dashParts[1].trim();

    // If the stored artist looks like a YouTube channel, prefer the one from title
    if (CHANNEL_SUFFIXES.test(cleanArtist) || cleanArtist.includes("_")) {
      cleanArtist = possibleArtist;
      cleanTitle = possibleTitle;
    } else if (possibleArtist.length > 1 && possibleTitle.length > 1) {
      // If title has "Artist - Song - Channel" format (3+ parts), use first two
      if (dashParts.length >= 3) {
        cleanArtist = possibleArtist;
        cleanTitle = possibleTitle;
      }
    }
  }

  // Remove common YouTube noise from title
  cleanTitle = cleanTitle
    .replace(/\s*[\(\[](Official\s*(Music\s*)?Video|Lyric\s*Video|Audio|Visualizer|Clipe\s*Oficial|WebClipe|Unofficial\s*Video|Bass\s*Boosted|8D|Ao\s*Vivo|Live)[\)\]]/gi, "")
    .replace(/\s*[\(\[].*?remix.*?[\)\]]/gi, "")
    .replace(/\s*[\(\[].*?[\)\]]/g, "")
    .replace(/\s*[-–]\s*(feat|ft)\.?\s*.*/i, "")
    .replace(/\s*[-–]\s*Ao\s*Vivo\s*$/i, "")
    .trim();

  // Clean artist: remove VEVO, channel suffixes, underscores
  cleanArtist = cleanArtist
    .replace(/VEVO$/i, "")
    .replace(/\s*[\(\[].*?[\)\]]/g, "")
    .replace(/_/g, " ")
    .trim();

  return { artist: cleanArtist, title: cleanTitle };
}

const LRCLIB_USER_AGENT = "spotaste (https://github.com/leitejoaov/spotaste-monorep)";
const MAX_LYRICS_CHARS = 3000;

/**
 * Fetch lyrics, trying LRCLIB first and lyrics.ovh as a fallback (both free, no auth required).
 * Returns the lyrics text or null if not found.
 */
export async function fetchLyrics(artist: string, title: string): Promise<string | null> {
  const clean = cleanForSearch(artist, title);

  if (!clean.artist || !clean.title || clean.artist.length < 2 || clean.title.length < 2) return null;

  const originalArtist = artist.trim();
  const artistChanged = clean.artist.toLowerCase() !== originalArtist.toLowerCase();

  for (const source of [fetchFromLrclib, fetchFromLyricsOvh]) {
    // Try with cleaned names first
    const result = await source(clean.artist, clean.title);
    if (result) return result;

    // If cleaned names differ from original, try original artist + cleaned title
    if (artistChanged) {
      const fallback = await source(originalArtist, clean.title);
      if (fallback) return fallback;
    }
  }

  return null;
}

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

async function fetchFromLrclib(artist: string, title: string): Promise<string | null> {
  try {
    const { data } = await axios.get("https://lrclib.net/api/search", {
      params: { track_name: title, artist_name: artist },
      headers: { "User-Agent": LRCLIB_USER_AGENT },
      timeout: 8000,
    });
    if (!Array.isArray(data)) return null;

    // Search is fuzzy, so only accept results credited to the artist we asked for
    const wanted = normalizeName(artist);
    const hit = data.find((item: any) => {
      if (typeof item?.plainLyrics !== "string" || item.plainLyrics.trim().length <= 20) return false;
      const found = normalizeName(String(item.artistName ?? ""));
      return found.length > 0 && (found.includes(wanted) || wanted.includes(found));
    });
    return hit ? hit.plainLyrics.trim().slice(0, MAX_LYRICS_CHARS) : null;
  } catch {
    return null;
  }
}

async function fetchFromLyricsOvh(artist: string, title: string): Promise<string | null> {
  try {
    const { data } = await axios.get(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
      { timeout: 8000 }
    );
    if (data.lyrics && typeof data.lyrics === "string" && data.lyrics.trim().length > 20) {
      return data.lyrics.trim().slice(0, MAX_LYRICS_CHARS);
    }
    return null;
  } catch {
    return null;
  }
}
