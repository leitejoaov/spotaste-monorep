import axios from "axios";

const AUDIO_SERVICE_URL = process.env.AUDIO_SERVICE_URL || "http://127.0.0.1:5001";

export interface EssentiaFeatures {
  bpm: number;
  key: string;
  mode: string;
  energy: number;
  danceability: number;
  loudness: number;
  source: string;
  // TF mood features (optional — available when models are loaded)
  mood_happy?: number;
  mood_sad?: number;
  mood_aggressive?: number;
  mood_relaxed?: number;
  mood_party?: number;
  voice_instrumental?: number;
  mood_acoustic?: number;
}

export async function analyzeWithEssentia(track: string, artist: string): Promise<EssentiaFeatures> {
  const { data } = await axios.post<EssentiaFeatures>(
    `${AUDIO_SERVICE_URL}/analyze`,
    { track, artist },
    { timeout: 180000 } // 3 min timeout — TF analysis adds time
  );

  return data;
}
