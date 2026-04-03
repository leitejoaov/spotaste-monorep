import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Music, ArrowLeft, Loader2 } from "lucide-react";
import { usePlatform } from "../context/PlatformContext";

interface EssentiaData {
  bpm: number;
  key: string;
  mode: string;
  energy: number;
  danceability: number;
  loudness: number;
  mood_happy: number | null;
  mood_sad: number | null;
  mood_aggressive: number | null;
  mood_relaxed: number | null;
  mood_party: number | null;
  voice_instrumental: number | null;
  mood_acoustic: number | null;
}

interface TrackAnalysis {
  name: string;
  artist: string;
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
  instrumentalness: number;
  bpm: number;
  mood: string;
  albumImage?: string | null;
  spotifyId?: string;
  essentia?: EssentiaData;
}

interface TasteProfile {
  summary: string;
  dominant_moods: string[];
  avg_energy: number;
  avg_valence: number;
  avg_danceability: number;
}

interface AnalysisResult {
  tracks: TrackAnalysis[];
  profile: TasteProfile;
}

const BARS: { key: keyof TrackAnalysis; label: string; color: string }[] = [
  { key: "energy", label: "Energia", color: "from-red-500 to-orange-400" },
  { key: "valence", label: "Positividade", color: "from-yellow-400 to-amber-300" },
  { key: "danceability", label: "Dancabilidade", color: "from-spotify-green to-emerald-400" },
  { key: "acousticness", label: "Acusticidade", color: "from-blue-400 to-cyan-300" },
  { key: "instrumentalness", label: "Instrumentalidade", color: "from-purple-500 to-violet-400" },
];

const PROFILE_BARS: { key: keyof TasteProfile; label: string; color: string }[] = [
  { key: "avg_energy", label: "Energia Media", color: "from-red-500 to-orange-400" },
  { key: "avg_valence", label: "Positividade Media", color: "from-yellow-400 to-amber-300" },
  { key: "avg_danceability", label: "Dancabilidade Media", color: "from-spotify-green to-emerald-400" },
];

const LOADING_PHRASES = [
  "Escaneando suas top tracks...",
  "A IA ta ouvindo suas musicas...",
  "Calculando o nivel de vibe...",
  "Analisando cada batida...",
  "Decifrando seu perfil sonoro...",
  "Processando BPMs e moods...",
  "Quase la, so falta o drop...",
  "Montando seu perfil musical...",
];

export default function TasteAnalysis() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { getHeaders, isLoggedIn } = usePlatform();
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentPhrase, setCurrentPhrase] = useState(0);
  const [expandedTrack, setExpandedTrack] = useState<number | null>(null);

  useEffect(() => {
    if (!isLoggedIn) {
      navigate("/");
      return;
    }

    fetch("/api/analyze-taste", {
      headers: { ...getHeaders() },
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Erro ${res.status}`);
        }
        return res.json();
      })
      .then((data) => setResult(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [isLoggedIn, getHeaders, navigate]);

  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      setCurrentPhrase((prev) => (prev + 1) % LOADING_PHRASES.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [loading]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-spotify-dark via-[#0d1117] to-spotify-dark flex flex-col items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-8 max-w-md text-center"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          >
            <Loader2 size={48} className="text-spotify-green" />
          </motion.div>
          <AnimatePresence mode="wait">
            <motion.p
              key={currentPhrase}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.4 }}
              className="text-lg text-gray-300 font-medium min-h-[3.5rem]"
            >
              {LOADING_PHRASES[currentPhrase]}
            </motion.p>
          </AnimatePresence>
        </motion.div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-spotify-dark via-[#0d1117] to-spotify-dark flex flex-col items-center justify-center px-4 gap-4">
        <p className="text-red-400 text-lg">{error}</p>
        <button
          onClick={() => navigate("/hub")}
          className="px-6 py-3 rounded-full border border-spotify-green/30 text-spotify-green hover:bg-spotify-green/10 transition-all text-sm font-medium"
        >
          Voltar ao Hub
        </button>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-spotify-dark via-[#0d1117] to-spotify-dark text-white">
      <header className="sticky top-0 z-20 bg-spotify-dark/80 backdrop-blur-lg border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={() => navigate("/hub")}
            className="flex items-center gap-2 text-spotify-text hover:text-white transition-colors"
          >
            <ArrowLeft size={20} />
            <span className="text-sm font-medium">Hub</span>
          </button>
          <div className="flex items-center gap-2">
            <Music className="text-spotify-green" size={22} />
            <span className="font-display font-bold text-lg bg-gradient-to-r from-spotify-green to-emerald-400 bg-clip-text text-transparent">
              Vibe Profile
            </span>
          </div>
          <div className="w-16" />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-10">
        {/* Profile Summary */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-sm font-semibold uppercase tracking-widest text-spotify-green mb-6">
            Seu Perfil de Vibe
          </h2>
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 sm:p-8 space-y-6">
            <p className="text-[15px] leading-relaxed text-gray-300">
              {result.profile.summary}
            </p>

            <div className="flex flex-wrap gap-2">
              {result.profile.dominant_moods.map((mood) => (
                <span
                  key={mood}
                  className="px-3 py-1.5 rounded-full bg-spotify-green/15 text-spotify-green text-xs font-semibold uppercase tracking-wider"
                >
                  {mood}
                </span>
              ))}
            </div>

            <div className="space-y-4 pt-2">
              {PROFILE_BARS.map(({ key, label, color }) => (
                <div key={key}>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-gray-300">{label}</span>
                    <span className="text-white font-medium">
                      {((result.profile[key] as number) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-3 bg-white/5 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(result.profile[key] as number) * 100}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                      className={`h-full rounded-full bg-gradient-to-r ${color}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.section>

        {/* Tracks */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
        >
          <h2 className="text-sm font-semibold uppercase tracking-widest text-spotify-green mb-6">
            Analise por Track ({result.tracks.length})
          </h2>
          <div className="space-y-3">
            {result.tracks.map((track, i) => (
              <motion.div
                key={`${track.name}-${i}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.03 }}
                className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl overflow-hidden"
              >
                <button
                  onClick={() => setExpandedTrack(expandedTrack === i ? null : i)}
                  className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-spotify-gray shrink-0">
                      {track.albumImage ? (
                        <img src={track.albumImage} alt={track.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white/20">
                          <Music size={16} />
                        </div>
                      )}
                      <span className="absolute bottom-0 left-0 text-[9px] font-bold bg-spotify-green text-black w-4 h-4 flex items-center justify-center rounded-tr-md">
                        {i + 1}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{track.name}</p>
                      <p className="text-xs text-spotify-text truncate">{track.artist}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <span className="px-2.5 py-1 rounded-full bg-white/10 text-[11px] font-medium text-gray-300">
                      {track.bpm} BPM
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-spotify-green/15 text-[11px] font-semibold text-spotify-green">
                      {track.mood}
                    </span>
                  </div>
                </button>

                <AnimatePresence>
                  {expandedTrack === i && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 pb-5 pt-1 space-y-4 border-t border-white/5">
                        {/* AI inferred attributes */}
                        <div className="space-y-3">
                          <p className="text-[10px] uppercase tracking-widest text-white/30 mt-2">Inferido pela IA</p>
                          {BARS.map(({ key, label, color }) => (
                            <div key={key}>
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-gray-400">{label}</span>
                                <span className="text-white font-medium">
                                  {((track[key] as number) * 100).toFixed(0)}%
                                </span>
                              </div>
                              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                                <motion.div
                                  initial={{ width: 0 }}
                                  animate={{ width: `${(track[key] as number) * 100}%` }}
                                  transition={{ duration: 0.6, ease: "easeOut" }}
                                  className={`h-full rounded-full bg-gradient-to-r ${color}`}
                                />
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Real Essentia data */}
                        {track.essentia && (
                          <div className="space-y-3 pt-2">
                            <p className="text-[10px] uppercase tracking-widest text-purple-400">Analise real do audio (Essentia)</p>
                            <div className="flex gap-2 flex-wrap">
                              <span className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white font-medium">
                                {track.essentia.bpm} BPM
                              </span>
                              <span className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white font-medium">
                                {track.essentia.key} {track.essentia.mode}
                              </span>
                              <span className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white font-medium">
                                {track.essentia.loudness} dB
                              </span>
                            </div>
                            {[
                              { label: "Energia", value: track.essentia.energy, color: "from-red-500 to-orange-400" },
                              { label: "Dancabilidade", value: track.essentia.danceability, color: "from-spotify-green to-emerald-400" },
                            ].map(({ label, value, color }) => (
                              <div key={label}>
                                <div className="flex justify-between text-xs mb-1">
                                  <span className="text-gray-400">{label}</span>
                                  <span className="text-white font-medium">{(value * 100).toFixed(0)}%</span>
                                </div>
                                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                                  <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${value * 100}%` }}
                                    transition={{ duration: 0.6, ease: "easeOut" }}
                                    className={`h-full rounded-full bg-gradient-to-r ${color}`}
                                  />
                                </div>
                              </div>
                            ))}
                            {/* Mood tags */}
                            {track.essentia.mood_happy != null && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {[
                                  { key: "mood_happy" as const, label: "Happy", emoji: "😊", color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" },
                                  { key: "mood_sad" as const, label: "Sad", emoji: "😢", color: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
                                  { key: "mood_aggressive" as const, label: "Aggressive", emoji: "🔥", color: "bg-red-500/20 text-red-300 border-red-500/30" },
                                  { key: "mood_relaxed" as const, label: "Relaxed", emoji: "🧘", color: "bg-teal-500/20 text-teal-300 border-teal-500/30" },
                                  { key: "mood_party" as const, label: "Party", emoji: "🎉", color: "bg-pink-500/20 text-pink-300 border-pink-500/30" },
                                  { key: "mood_acoustic" as const, label: "Acoustic", emoji: "🎸", color: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
                                  { key: "voice_instrumental" as const, label: "Instrumental", emoji: "🎹", color: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30" },
                                ].filter(({ key }) => (track.essentia![key] as number) > 0.5)
                                  .map(({ key, label, emoji, color }) => (
                                    <span key={key} className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${color}`}>
                                      {emoji} {label} {((track.essentia![key] as number) * 100).toFixed(0)}%
                                    </span>
                                  ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* Footer */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-center pb-8"
        >
          <button
            onClick={() => navigate("/hub")}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-spotify-green/30 text-spotify-green hover:bg-spotify-green/10 transition-all text-sm font-medium"
          >
            Voltar ao Hub
          </button>
        </motion.footer>
      </main>
    </div>
  );
}
