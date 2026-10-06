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

/**
 * Fetch lyrics from lyrics.ovh (free, no auth required).
 * Returns the lyrics text or null if not found.
 */
export async function fetchLyrics(artist: string, title: string): Promise<string | null> {
  const clean = cleanForSearch(artist, title);

  if (!clean.artist || !clean.title || clean.artist.length < 2 || clean.title.length < 2) return null;

  // Try with cleaned names first
  const result = await tryFetch(clean.artist, clean.title);
  if (result) return result;

  // If cleaned names differ from original, try original artist + cleaned title
  if (clean.artist.toLowerCase() !== artist.trim().toLowerCase()) {
    const fallback = await tryFetch(artist.trim(), clean.title);
    if (fallback) return fallback;
  }

  return null;
}

async function tryFetch(artist: string, title: string): Promise<string | null> {
  try {
    const { data } = await axios.get(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
      { timeout: 8000 }
    );
    if (data.lyrics && typeof data.lyrics === "string" && data.lyrics.trim().length > 20) {
      return data.lyrics.trim().slice(0, 3000);
    }
    return null;
  } catch {
    return null;
  }
}
