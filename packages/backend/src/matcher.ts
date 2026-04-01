import type { TrackFeatures } from "./db.js";
import type { VibeProfile } from "./claude.js";

export interface ScoredTrack {
  track: TrackFeatures;
  score: number;
}

const FEATURE_MAP: {
  key: string;
  trackKey: keyof TrackFeatures;
  profileKey: keyof VibeProfile;
  normalize?: (value: number, target: number, profile: VibeProfile) => number;
}[] = [
  {
    key: "bpm",
    trackKey: "bpm",
    profileKey: "bpm_target",
    normalize: (value, target, profile) =>
      Math.min(Math.abs(value - target) / (profile.bpm_tolerance || 20), 1.0),
  },
  {
    key: "energy",
    trackKey: "energy",
    profileKey: "energy",
  },
  {
    key: "danceability",
    trackKey: "danceability",
    profileKey: "danceability",
  },
  {
    key: "loudness",
    trackKey: "loudness",
    profileKey: "loudness",
    normalize: (value, target) => Math.min(Math.abs(value - target) / 30, 1.0),
  },
  { key: "mood_happy", trackKey: "mood_happy", profileKey: "mood_happy" },
  { key: "mood_sad", trackKey: "mood_sad", profileKey: "mood_sad" },
  { key: "mood_aggressive", trackKey: "mood_aggressive", profileKey: "mood_aggressive" },
  { key: "mood_relaxed", trackKey: "mood_relaxed", profileKey: "mood_relaxed" },
  { key: "mood_party", trackKey: "mood_party", profileKey: "mood_party" },
  { key: "voice_instrumental", trackKey: "voice_instrumental", profileKey: "voice_instrumental" },
  { key: "mood_acoustic", trackKey: "mood_acoustic", profileKey: "mood_acoustic" },
];

function scoreTrack(track: TrackFeatures, profile: VibeProfile): number {
  let weightedDistSum = 0;
  let weightSum = 0;

  for (const feat of FEATURE_MAP) {
    const trackValue = track[feat.trackKey] as number | null;
    if (trackValue == null) continue;

    const weight = profile.feature_weights?.[feat.key] ?? 0.5;
    if (weight === 0) continue;

    const target = profile[feat.profileKey] as number;
    const distance = feat.normalize
      ? feat.normalize(trackValue, target, profile)
      : Math.abs(trackValue - target);

    weightedDistSum += weight * distance * distance;
    weightSum += weight;
  }

  if (weightSum === 0) return 0;

  return Math.max(0, 1 - Math.sqrt(weightedDistSum / weightSum));
}

export function matchTracks(
  profile: VibeProfile,
  allTracks: TrackFeatures[],
  limit = 20
): ScoredTrack[] {
  const scored = allTracks.map((track) => ({
    track,
    score: scoreTrack(track, profile),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}
