import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Music, ArrowLeft, Search, AlertCircle, Loader2, Database, Wifi, CheckCircle2, Clock } from "lucide-react";
import { usePlatform } from "../context/PlatformContext";

interface TrackFeatures {
  bpm: number;
  key: string;
  mode: string;
  energy: number;
  danceability: number;
  loudness: number;
  mood_happy?: number | null;
  mood_sad?: number | null;
  mood_aggressive?: number | null;
  mood_relaxed?: number | null;
  mood_party?: number | null;
  voice_instrumental?: number | null;
  mood_acoustic?: number | null;
}

interface QueueItem {
  spotify_id: string;
  track_name: string;
  artist_name: string;
  album_image?: string | null;
  status: "pending" | "processing" | "done" | "done_partial";
  features?: TrackFeatures;
  source?: "cache" | "essentia";
}

interface QueueStatus {
  pending: number;
  processing: number;
  done: number;
  failed: number;
  reanalyzing: number;
}

interface SearchResult {
  id: string;
  name: string;
  artist: string;
  album: string;
  image: string | null;
}

function extractTrackId(input: string): string | null {
  const urlMatch = input.match(/track\/([a-zA-Z0-9]{22})/);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9]{22}$/.test(input.trim())) return input.trim();
  return null;
}

function looksLikeTrackRef(input: string): boolean {
  return /track\/[a-zA-Z0-9]{22}/.test(input) || /^[a-zA-Z0-9]{22}$/.test(input.trim());
}

function MiniBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${value * 100}%` }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className={`h-full rounded-full ${color}`}
      />
    </div>
  );
}

export default function AudioFeatures() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { getHeaders } = usePlatform();

  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searching, setSearching] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Poll queue status
  useEffect(() => {
    const fetchStatus = () =>
      fetch("/api/queue-status").then((r) => r.json()).then(setQueueStatus).catch(() => {});
    fetchStatus();
    const interval = setInterval(fetchStatus, 10_000);
    return () => clearInterval(interval);
  }, []);

  // Debounced search — only when input looks like a text query (not a URL/ID)
  useEffect(() => {
    clearTimeout(searchDebounceRef.current);
    const trimmed = input.trim();

    if (trimmed.length < 2 || looksLikeTrackRef(trimmed)) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    setSearching(true);
    searchDebounceRef.current = setTimeout(() => {
      fetch(`/api/search-tracks?q=${encodeURIComponent(trimmed)}`, {
        headers: { ...getHeaders() },
      })
        .then((r) => r.json())
        .then((data) => {
          setSearchResults(data);
          setShowResults(true);
          setSearching(false);
        })
        .catch(() => setSearching(false));
    }, 400);

    return () => clearTimeout(searchDebounceRef.current);
  }, [input, getHeaders]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Poll pending items in local queue for completion
  const pollQueue = useCallback(() => {
    setQueue((prev) => {
      const pending = prev.filter((item) => item.status === "pending" || item.status === "processing");
      if (pending.length === 0) {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = undefined;
        }
        return prev;
      }

      for (const item of pending) {
        fetch(`/api/track-status/${item.spotify_id}`)
          .then((r) => r.json())
          .then((data) => {
            if (data.status === "done" || data.status === "done_partial") {
              setQueue((q) =>
                q.map((qi) =>
                  qi.spotify_id === item.spotify_id
                    ? { ...qi, status: data.status, features: data.features, source: "essentia" }
                    : qi
                )
              );
            }
          })
          .catch(() => {});
      }

      return prev;
    });
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(pollQueue, 5_000);
  }, [pollQueue]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const enqueueTrack = async (trackId: string) => {
    if (queue.some((q) => q.spotify_id === trackId)) return;

    try {
      const res = await fetch(`/api/enqueue-track/${trackId}`, {
        method: "POST",
        headers: { ...getHeaders() },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setError("Token expirado. Faca login novamente.");
          return;
        }
        setError(data.error || `Erro ${res.status}`);
        return;
      }

      const data = await res.json();

      const newItem: QueueItem = {
        spotify_id: data.spotify_id,
        track_name: data.track_name,
        artist_name: data.artist_name,
        album_image: data.album_image,
        status: data.status === "done" ? "done" : "pending",
        features: data.features || undefined,
        source: data.status === "done" ? "cache" : undefined,
      };

      setQueue((prev) => [newItem, ...prev]);

      if (newItem.status === "pending") {
        startPolling();
      }
    } catch {
      setError("Erro ao enfileirar track.");
    }
  };

  const handleSubmit = () => {
    const trackId = extractTrackId(input);
    if (trackId) {
      setError("");
      setInput("");
      setShowResults(false);
      enqueueTrack(trackId);
    }
    // If not a track ID/URL, the dropdown handles it
  };

  const handleSelectResult = (result: SearchResult) => {
    setInput("");
    setShowResults(false);
    setSearchResults([]);
    enqueueTrack(result.id);
  };

  const pendingCount = queue.filter((q) => q.status === "pending" || q.status === "processing").length;
  const doneCount = queue.filter((q) => q.status === "done" || q.status === "done_partial").length;

  return (
    <div className="min-h-screen bg-gradient-to-b from-spotify-dark via-[#0d1117] to-spotify-dark text-white">
      <header className="sticky top-0 z-20 bg-spotify-dark/80 backdrop-blur-lg border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={() => navigate(`/hub?artists=${searchParams.get("hubData") || ""}`)}
            className="flex items-center gap-2 text-spotify-text hover:text-white transition-colors"
          >
            <ArrowLeft size={20} />
            <span className="text-sm font-medium">Hub</span>
          </button>
          <div className="flex items-center gap-2">
            <Music className="text-spotify-green" size={22} />
            <span className="font-display font-bold text-lg bg-gradient-to-r from-spotify-green to-emerald-400 bg-clip-text text-transparent">
              Audio Analysis
            </span>
          </div>
          <div className="w-20" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Global status */}
        {queueStatus && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-center gap-3 flex-wrap"
          >
            <span className="flex items-center gap-1.5 text-xs bg-white/5 border border-white/10 rounded-full px-3 py-1.5 text-spotify-text">
              <Database size={12} className="text-spotify-green" />
              {queueStatus.done} musicas no banco global
            </span>
            {queueStatus.reanalyzing > 0 && (
              <span className="flex items-center gap-1.5 text-xs bg-purple-500/10 border border-purple-500/20 rounded-full px-3 py-1.5 text-purple-400">
                <Loader2 size={12} className="animate-spin" />
                {queueStatus.reanalyzing} atualizando moods
              </span>
            )}
          </motion.div>
        )}

        {/* Input */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-30 bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 overflow-visible"
        >
          <label className="text-sm font-semibold uppercase tracking-widest text-spotify-green mb-4 block">
            Adicionar Track
          </label>
          <div className="relative" ref={dropdownRef}>
            <div className="flex gap-3">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  onFocus={() => searchResults.length > 0 && setShowResults(true)}
                  placeholder="Nome da musica, artista, ou cole um link do Spotify"
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-spotify-green/50 transition-colors text-sm"
                />
                {searching && (
                  <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-white/30" />
                )}
              </div>
              {looksLikeTrackRef(input) && (
                <button
                  onClick={handleSubmit}
                  className="px-5 py-3 rounded-xl bg-spotify-green hover:bg-[#1ed760] transition-all text-black font-semibold text-sm flex items-center gap-2 shrink-0"
                >
                  <Search size={16} />
                  Analisar
                </button>
              )}
            </div>

            {/* Search results dropdown */}
            <AnimatePresence>
              {showResults && searchResults.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="absolute z-30 mt-2 w-full bg-[#1a1d23] border border-white/10 rounded-xl shadow-2xl overflow-hidden"
                >
                  {searchResults.map((result) => {
                    const alreadyQueued = queue.some((q) => q.spotify_id === result.id);
                    return (
                      <button
                        key={result.id}
                        onClick={() => !alreadyQueued && handleSelectResult(result)}
                        disabled={alreadyQueued}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left disabled:opacity-40"
                      >
                        {result.image ? (
                          <img src={result.image} alt="" className="w-10 h-10 rounded-md object-cover shrink-0" />
                        ) : (
                          <div className="w-10 h-10 rounded-md bg-white/5 flex items-center justify-center shrink-0">
                            <Music size={16} className="text-white/20" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{result.name}</p>
                          <p className="text-xs text-spotify-text truncate">{result.artist} — {result.album}</p>
                        </div>
                        {alreadyQueued ? (
                          <span className="text-[10px] text-spotify-green shrink-0">Na fila</span>
                        ) : (
                          <Search size={14} className="text-white/20 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 flex items-center gap-2 text-red-400 text-sm"
            >
              <AlertCircle size={16} />
              {error}
            </motion.div>
          )}
        </motion.div>

        {/* Local queue summary */}
        {queue.length > 0 && (
          <div className="flex items-center gap-3 justify-center">
            {pendingCount > 0 && (
              <span className="flex items-center gap-1.5 text-xs bg-yellow-500/10 border border-yellow-500/20 rounded-full px-3 py-1.5 text-yellow-400">
                <Loader2 size={12} className="animate-spin" />
                {pendingCount} analisando
              </span>
            )}
            {doneCount > 0 && (
              <span className="flex items-center gap-1.5 text-xs bg-spotify-green/10 border border-spotify-green/20 rounded-full px-3 py-1.5 text-spotify-green">
                <CheckCircle2 size={12} />
                {doneCount} concluidas
              </span>
            )}
          </div>
        )}

        {/* Queue items */}
        <AnimatePresence mode="popLayout">
          {queue.map((item) => (
            <motion.div
              key={item.spotify_id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              layout
              className="bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] rounded-2xl p-5 transition-all"
            >
              {/* Track header */}
              <div className="flex items-center gap-3 mb-3">
                {item.album_image && (
                  <img
                    src={item.album_image}
                    alt=""
                    className="w-12 h-12 rounded-lg object-cover"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-display font-bold text-white truncate">{item.track_name}</h3>
                  <p className="text-sm text-spotify-text truncate">{item.artist_name}</p>
                </div>
                <div>
                  {(item.status === "pending" || item.status === "processing") ? (
                    <span className="flex items-center gap-1.5 text-xs bg-yellow-500/10 border border-yellow-500/20 rounded-full px-2.5 py-1 text-yellow-400">
                      <Loader2 size={12} className="animate-spin" />
                      Na fila
                    </span>
                  ) : item.source === "cache" ? (
                    <span className="flex items-center gap-1.5 text-xs bg-spotify-green/10 border border-spotify-green/20 rounded-full px-2.5 py-1 text-spotify-green">
                      <Database size={12} />
                      Instantaneo
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs bg-purple-500/10 border border-purple-500/20 rounded-full px-2.5 py-1 text-purple-400">
                      <Wifi size={12} />
                      Analisado
                    </span>
                  )}
                </div>
              </div>

              {/* Features (when done) */}
              {item.features && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  transition={{ duration: 0.3 }}
                  className="space-y-3"
                >
                  {/* Bars */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider text-white/40 w-24">Energia</span>
                      <div className="flex-1">
                        <MiniBar value={item.features.energy} color="bg-gradient-to-r from-red-500 to-orange-400" />
                      </div>
                      <span className="text-xs text-white/60 w-10 text-right">
                        {(item.features.energy * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider text-white/40 w-24">Dancabilidade</span>
                      <div className="flex-1">
                        <MiniBar value={item.features.danceability} color="bg-gradient-to-r from-spotify-green to-emerald-400" />
                      </div>
                      <span className="text-xs text-white/60 w-10 text-right">
                        {(item.features.danceability * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="flex gap-3">
                    {[
                      { label: "BPM", value: String(item.features.bpm) },
                      { label: "Key", value: `${item.features.key} ${item.features.mode}` },
                      { label: "Loud", value: `${item.features.loudness} dB` },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex-1 bg-white/[0.03] rounded-xl py-2 px-3 text-center">
                        <p className="text-[10px] uppercase tracking-wider text-white/40">{label}</p>
                        <p className="text-sm font-bold text-white">{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Mood tags */}
                  {item.features.mood_happy != null && (
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { key: "mood_happy" as const, label: "Happy", emoji: "😊", color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" },
                        { key: "mood_sad" as const, label: "Sad", emoji: "😢", color: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
                        { key: "mood_aggressive" as const, label: "Aggressive", emoji: "🔥", color: "bg-red-500/20 text-red-300 border-red-500/30" },
                        { key: "mood_relaxed" as const, label: "Relaxed", emoji: "🧘", color: "bg-teal-500/20 text-teal-300 border-teal-500/30" },
                        { key: "mood_party" as const, label: "Party", emoji: "🎉", color: "bg-pink-500/20 text-pink-300 border-pink-500/30" },
                        { key: "mood_acoustic" as const, label: "Acoustic", emoji: "🎸", color: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
                        { key: "voice_instrumental" as const, label: "Instrumental", emoji: "🎹", color: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30" },
                      ]
                        .filter(({ key }) => (item.features![key] as number) > 0.5)
                        .map(({ key, label, emoji, color }) => (
                          <span key={key} className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${color}`}>
                            {emoji} {label} {((item.features![key] as number) * 100).toFixed(0)}%
                          </span>
                        ))}
                    </div>
                  )}
                </motion.div>
              )}

              {/* Pending skeleton */}
              {!item.features && (
                <div className="space-y-2 animate-pulse">
                  <div className="h-1.5 bg-white/5 rounded-full w-3/4" />
                  <div className="h-1.5 bg-white/5 rounded-full w-1/2" />
                  <p className="text-xs text-spotify-text mt-2 flex items-center gap-1.5">
                    <Clock size={12} />
                    Aguardando analise pelo worker...
                  </p>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </main>
    </div>
  );
}
