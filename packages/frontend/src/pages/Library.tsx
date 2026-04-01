import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Library as LibraryIcon, ArrowLeft, Search, Music2, Zap, Disc3, Volume2, Loader2 } from "lucide-react";

interface TrackFeatures {
  spotify_id: string;
  track_name: string;
  artist_name: string;
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
  analyzed_at: string;
}

const MOOD_TAGS: { key: keyof TrackFeatures; label: string; emoji: string; color: string }[] = [
  { key: "mood_happy", label: "Happy", emoji: "😊", color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" },
  { key: "mood_sad", label: "Sad", emoji: "😢", color: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
  { key: "mood_aggressive", label: "Aggressive", emoji: "🔥", color: "bg-red-500/20 text-red-300 border-red-500/30" },
  { key: "mood_relaxed", label: "Relaxed", emoji: "🧘", color: "bg-teal-500/20 text-teal-300 border-teal-500/30" },
  { key: "mood_party", label: "Party", emoji: "🎉", color: "bg-pink-500/20 text-pink-300 border-pink-500/30" },
  { key: "mood_acoustic", label: "Acoustic", emoji: "🎸", color: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
  { key: "voice_instrumental", label: "Instrumental", emoji: "🎹", color: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30" },
];

interface QueueStatus {
  pending: number;
  processing: number;
  done: number;
  failed: number;
  reanalyzing: number;
}

function StatBadge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className={`flex flex-col items-center px-3 py-1.5 rounded-lg bg-gradient-to-b ${color} border border-white/5`}>
      <span className="text-[10px] uppercase tracking-wider text-white/50">{label}</span>
      <span className="text-sm font-bold text-white">{value}</span>
    </div>
  );
}

function MiniBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${value * 100}%` }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className={`h-full rounded-full ${color}`}
      />
    </div>
  );
}

export default function Library() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [tracks, setTracks] = useState<TrackFeatures[]>([]);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchTracks = useCallback((query?: string) => {
    setLoading(true);
    const url = query ? `/api/tracks?search=${encodeURIComponent(query)}` : "/api/tracks";
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        setTracks(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Debounced search — triggers 400ms after user stops typing
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchTracks(search || undefined);
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [search, fetchTracks]);

  useEffect(() => {
    fetch("/api/queue-status")
      .then((r) => r.json())
      .then(setQueueStatus)
      .catch(() => {});

    const interval = setInterval(() => {
      fetch("/api/queue-status")
        .then((r) => r.json())
        .then((status) => {
          setQueueStatus(status);
          if (status.processing > 0 || status.pending > 0) {
            fetchTracks(search || undefined);
          }
        })
        .catch(() => {});
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-spotify-dark via-[#0d1117] to-spotify-dark text-white">
      <header className="sticky top-0 z-20 bg-spotify-dark/80 backdrop-blur-lg border-b border-white/5">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={() => navigate(`/hub?artists=${searchParams.get("hubData") || ""}`)}
            className="flex items-center gap-2 text-spotify-text hover:text-white transition-colors"
          >
            <ArrowLeft size={20} />
            <span className="text-sm font-medium">Hub</span>
          </button>
          <div className="flex items-center gap-2">
            <LibraryIcon className="text-spotify-green" size={22} />
            <span className="font-display font-bold text-lg bg-gradient-to-r from-spotify-green to-emerald-400 bg-clip-text text-transparent">
              Banco de Musicas
            </span>
          </div>
          <div className="w-20" />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Stats bar */}
        {queueStatus && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-center gap-4 flex-wrap"
          >
            <span className="flex items-center gap-1.5 text-sm font-medium text-white">
              <Disc3 size={16} className="text-spotify-green" />
              {tracks.length} musicas analisadas
            </span>
            {(queueStatus.pending > 0 || queueStatus.processing > 0) && (
              <span className="flex items-center gap-1.5 text-xs bg-yellow-500/10 border border-yellow-500/20 rounded-full px-3 py-1.5 text-yellow-400">
                <Loader2 size={12} className="animate-spin" />
                {queueStatus.pending + queueStatus.processing} na fila
              </span>
            )}
            {queueStatus.reanalyzing > 0 && (
              <span className="flex items-center gap-1.5 text-xs bg-purple-500/10 border border-purple-500/20 rounded-full px-3 py-1.5 text-purple-400">
                <Loader2 size={12} className="animate-spin" />
                {queueStatus.reanalyzing} atualizando moods
              </span>
            )}
          </motion.div>
        )}

        {/* Search */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou artista..."
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-spotify-green/50 transition-colors text-sm"
            />
          </div>
        </motion.div>

        {/* Track list */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-spotify-green" />
          </div>
        ) : tracks.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20 text-spotify-text"
          >
            <Music2 size={48} className="mx-auto mb-4 opacity-30" />
            <p className="text-lg">Nenhuma musica analisada ainda</p>
            <p className="text-sm mt-1">As musicas aparecem aqui conforme sao analisadas pelo worker</p>
          </motion.div>
        ) : (
          <div className="grid gap-3">
            <AnimatePresence mode="popLayout">
              {tracks.map((track, i) => (
                <motion.div
                  key={track.spotify_id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: Math.min(i * 0.03, 0.5) }}
                  className="group bg-white/[0.03] hover:bg-white/[0.07] backdrop-blur-sm border border-white/[0.06] hover:border-white/10 rounded-2xl p-5 transition-all"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    {/* Track info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Music2 size={14} className="text-spotify-green shrink-0" />
                        <h3 className="font-display font-bold text-white truncate">
                          {track.track_name}
                        </h3>
                      </div>
                      <p className="text-sm text-spotify-text truncate pl-[22px]">
                        {track.artist_name}
                      </p>

                      {/* Mini bars */}
                      <div className="mt-3 space-y-2 pl-[22px]">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase tracking-wider text-white/40 w-24">Energia</span>
                          <div className="flex-1">
                            <MiniBar value={track.energy} color="bg-gradient-to-r from-red-500 to-orange-400" />
                          </div>
                          <span className="text-xs text-white/60 w-10 text-right">
                            {(track.energy * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase tracking-wider text-white/40 w-24">Dancabilidade</span>
                          <div className="flex-1">
                            <MiniBar value={track.danceability} color="bg-gradient-to-r from-spotify-green to-emerald-400" />
                          </div>
                          <span className="text-xs text-white/60 w-10 text-right">
                            {(track.danceability * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>

                      {/* Mood tags */}
                      {track.mood_happy !== null && (
                        <div className="mt-3 flex flex-wrap gap-1.5 pl-[22px]">
                          {MOOD_TAGS.filter(({ key }) => (track[key] as number) > 0.5).map(({ key, label, emoji, color }) => (
                            <span
                              key={key}
                              className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${color}`}
                            >
                              {emoji} {label} {((track[key] as number) * 100).toFixed(0)}%
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Stats */}
                    <div className="flex gap-2 sm:gap-3 shrink-0">
                      <StatBadge label="BPM" value={String(track.bpm)} color="from-white/[0.04] to-white/[0.02]" />
                      <StatBadge label="Key" value={`${track.key} ${track.mode}`} color="from-white/[0.04] to-white/[0.02]" />
                      <StatBadge
                        label="Loud"
                        value={`${track.loudness} dB`}
                        color="from-white/[0.04] to-white/[0.02]"
                      />
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>
    </div>
  );
}
