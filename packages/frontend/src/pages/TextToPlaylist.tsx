import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ArrowLeft, Loader2, ExternalLink, Music2, ChevronDown, ChevronUp, BarChart3, Info, Music, PlayCircle } from "lucide-react";
import TrackRating from "../components/TrackRating";
import { usePlatform } from "../context/PlatformContext";

interface PlaylistTrack {
  position: number;
  spotify_id: string;
  track_name: string;
  artist_name: string;
  score: number;
  rating: string | null;
}

interface VibeProfile {
  bpm_target: number;
  energy: number;
  danceability: number;
  mood_happy: number;
  mood_sad: number;
  mood_aggressive: number;
  mood_relaxed: number;
  mood_party: number;
  voice_instrumental: number;
  mood_acoustic: number;
  feature_weights: Record<string, number>;
  playlist_name: string;
}

interface GeneratedPlaylist {
  id: number;
  name: string;
  description: string;
  spotify_url: string | null;
  platform?: "spotify" | "ytmusic";
  vibe_profile: VibeProfile;
  tracks: PlaylistTrack[];
}

const LOADING_PHRASES = [
  "Analisando a vibe do seu texto...",
  "A IA ta montando o perfil sonoro...",
  "Buscando as tracks perfeitas...",
  "Criando a playlist...",
  "Quase la, so mais um pouquinho...",
];

const VIBE_BARS: { key: string; label: string; color: string }[] = [
  { key: "energy", label: "Energia", color: "from-red-500 to-orange-400" },
  { key: "danceability", label: "Dancabilidade", color: "from-spotify-green to-emerald-400" },
  { key: "mood_happy", label: "Felicidade", color: "from-yellow-400 to-amber-400" },
  { key: "mood_sad", label: "Tristeza", color: "from-blue-400 to-indigo-400" },
  { key: "mood_relaxed", label: "Relaxamento", color: "from-teal-400 to-cyan-400" },
  { key: "mood_party", label: "Festa", color: "from-pink-400 to-rose-400" },
  { key: "mood_acoustic", label: "Acustico", color: "from-amber-400 to-yellow-400" },
  { key: "mood_aggressive", label: "Agressividade", color: "from-red-600 to-red-400" },
];

function MiniBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${value * 100}%` }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className={`h-full rounded-full bg-gradient-to-r ${color}`}
      />
    </div>
  );
}

export default function TextToPlaylist() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { getHeaders, hasSpotify, hasYTMusic } = usePlatform();

  const canCreatePlaylist = hasSpotify || hasYTMusic;
  const [selectedPlatform, setSelectedPlatform] = useState<"spotify" | "ytmusic">(
    hasSpotify ? "spotify" : "ytmusic"
  );
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingPhrase, setLoadingPhrase] = useState(0);
  const [error, setError] = useState("");
  const [playlist, setPlaylist] = useState<GeneratedPlaylist | null>(null);
  const [vibeAccuracy, setVibeAccuracy] = useState<number | null>(null);
  const [musicAccuracy, setMusicAccuracy] = useState<number | null>(null);
  const [expandedTrack, setExpandedTrack] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!description.trim() || loading) return;

    setLoading(true);
    setError("");
    setPlaylist(null);
    setVibeAccuracy(null);
    setMusicAccuracy(null);

    const phraseInterval = setInterval(() => {
      setLoadingPhrase((p) => (p + 1) % LOADING_PHRASES.length);
    }, 3000);

    try {
      const res = await fetch("/api/playlist/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getHeaders(),
        },
        body: JSON.stringify({ description: description.trim(), platform: selectedPlatform }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === "scope_missing") {
          setError("Voce precisa fazer login novamente para criar playlists. Os novos scopes do Spotify sao necessarios.");
        } else {
          setError(data.error || `Erro ${res.status}`);
        }
        return;
      }

      const data = await res.json();
      setPlaylist({
        ...data.playlist,
        tracks: data.playlist.tracks.map((t: any) => ({ ...t, rating: null })),
      });
    } catch {
      setError("Algo deu errado. Tente novamente.");
    } finally {
      setLoading(false);
      clearInterval(phraseInterval);
      setLoadingPhrase(0);
    }
  };

  const handleRate = (spotifyId: string, rating: string, accuracy: { vibe_accuracy: number | null; music_accuracy: number | null }) => {
    setVibeAccuracy(accuracy.vibe_accuracy);
    setMusicAccuracy(accuracy.music_accuracy);
    setPlaylist((prev) =>
      prev
        ? {
            ...prev,
            tracks: prev.tracks.map((t) =>
              t.spotify_id === spotifyId ? { ...t, rating } : t
            ),
          }
        : prev
    );
  };

  const ratedCount = playlist?.tracks.filter((t) => t.rating).length ?? 0;

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
            <Sparkles className="text-amber-400" size={22} />
            <span className="font-display font-bold text-lg bg-gradient-to-r from-amber-400 to-yellow-300 bg-clip-text text-transparent">
              Text to Playlist
            </span>
          </div>
          <div className="w-20" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Input */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6"
        >
          <label className="text-sm font-semibold uppercase tracking-widest text-amber-400 mb-4 block">
            Descreva a vibe
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex: playlist pra noite de chuva lendo um livro, algo calmo e acustico..."
            rows={3}
            className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-amber-400/50 transition-colors text-sm resize-none"
          />
          {/* Platform selector */}
          {hasSpotify && hasYTMusic && (
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setSelectedPlatform("spotify")}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                  selectedPlatform === "spotify"
                    ? "bg-spotify-green/10 border-spotify-green/30 text-spotify-green"
                    : "bg-white/5 border-white/10 text-white/40 hover:bg-white/[0.08]"
                }`}
              >
                <Music size={16} />
                Spotify
              </button>
              <button
                onClick={() => setSelectedPlatform("ytmusic")}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                  selectedPlatform === "ytmusic"
                    ? "bg-red-500/10 border-red-500/30 text-red-400"
                    : "bg-white/5 border-white/10 text-white/40 hover:bg-white/[0.08]"
                }`}
              >
                <PlayCircle size={16} />
                YouTube Music
              </button>
            </div>
          )}

          {/* No playlist platform warning */}
          {!canCreatePlaylist && (
            <div className="mt-4 bg-white/5 border border-white/10 rounded-xl p-4 text-center">
              <p className="text-sm text-white/60 flex items-center justify-center gap-2">
                <Info size={16} className="text-amber-400 shrink-0" />
                Conecte Spotify ou YouTube Music para criar playlists
              </p>
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={loading || description.trim().length < 3 || !canCreatePlaylist}
            className="mt-4 w-full px-5 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-black font-bold text-sm flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Gerando...
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Gerar Playlist
              </>
            )}
          </button>

          {/* Loading phrases */}
          <AnimatePresence mode="wait">
            {loading && (
              <motion.p
                key={loadingPhrase}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="mt-3 text-xs text-center text-spotify-text"
              >
                {LOADING_PHRASES[loadingPhrase]}
              </motion.p>
            )}
          </AnimatePresence>

          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-3 text-sm text-red-400 text-center"
            >
              {error}
            </motion.p>
          )}
        </motion.div>

        {/* Result */}
        {playlist && (
          <>
            {/* Playlist header */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 text-center"
            >
              <h2 className="font-display font-bold text-xl text-white mb-1">{playlist.name}</h2>
              <p className="text-sm text-spotify-text mb-4">"{playlist.description}"</p>
              {playlist.spotify_url ? (
                <a
                  href={playlist.spotify_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    playlist.platform === "ytmusic"
                      ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                      : "bg-spotify-green/20 text-spotify-green hover:bg-spotify-green/30"
                  }`}
                >
                  <ExternalLink size={14} />
                  {playlist.platform === "ytmusic" ? "Abrir no YouTube Music" : "Abrir no Spotify"}
                </a>
              ) : null}
            </motion.div>

            {/* Vibe profile */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6"
            >
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 size={16} className="text-amber-400" />
                <h3 className="text-sm font-semibold uppercase tracking-widest text-amber-400">
                  Perfil da Vibe
                </h3>
              </div>
              <div className="space-y-2.5">
                {VIBE_BARS.filter(({ key }) => (playlist.vibe_profile.feature_weights[key] ?? 0) > 0.3).map(({ key, label, color }) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-white/40 w-28">{label}</span>
                    <div className="flex-1">
                      <MiniBar
                        value={(playlist.vibe_profile as any)[key] ?? 0}
                        color={color}
                      />
                    </div>
                    <span className="text-xs text-white/60 w-10 text-right">
                      {(((playlist.vibe_profile as any)[key] ?? 0) * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-[10px] uppercase tracking-wider text-white/40 w-28">BPM alvo</span>
                  <span className="text-sm font-bold text-white">{playlist.vibe_profile.bpm_target}</span>
                </div>
              </div>
            </motion.div>

            {/* Accuracy meters */}
            {ratedCount > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex gap-4"
              >
                <div className="flex-1 bg-white/5 border border-white/10 rounded-xl p-4 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Acerto de Vibe</p>
                  <p className="text-2xl font-display font-bold text-amber-400">
                    {vibeAccuracy != null ? `${Math.round(vibeAccuracy)}%` : "—"}
                  </p>
                  <p className="text-[10px] text-spotify-text">{ratedCount}/{playlist.tracks.length} avaliadas</p>
                </div>
                <div className="flex-1 bg-white/5 border border-white/10 rounded-xl p-4 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Acerto de Musica</p>
                  <p className="text-2xl font-display font-bold text-spotify-green">
                    {musicAccuracy != null ? `${Math.round(musicAccuracy)}%` : "—"}
                  </p>
                  <p className="text-[10px] text-spotify-text">{ratedCount}/{playlist.tracks.length} avaliadas</p>
                </div>
              </motion.div>
            )}

            {/* Track list */}
            <div className="space-y-2">
              {playlist.tracks.map((track, i) => (
                <motion.div
                  key={track.spotify_id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + i * 0.03 }}
                  className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden"
                >
                  <button
                    onClick={() =>
                      setExpandedTrack(expandedTrack === track.spotify_id ? null : track.spotify_id)
                    }
                    className="w-full flex items-center gap-3 p-4 hover:bg-white/[0.02] transition-colors text-left"
                  >
                    <span className="text-xs text-white/30 w-6 text-right font-mono">{track.position}</span>
                    <Music2 size={14} className="text-spotify-green shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{track.track_name}</p>
                      <p className="text-xs text-spotify-text truncate">{track.artist_name}</p>
                    </div>
                    <span className="text-xs text-white/40 shrink-0">{track.score}% match</span>
                    {track.rating && (
                      <span className="w-2 h-2 rounded-full bg-spotify-green shrink-0" />
                    )}
                    {expandedTrack === track.spotify_id ? (
                      <ChevronUp size={14} className="text-white/30" />
                    ) : (
                      <ChevronDown size={14} className="text-white/30" />
                    )}
                  </button>

                  <AnimatePresence>
                    {expandedTrack === track.spotify_id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-4 pt-1 border-t border-white/5">
                          <p className="text-[10px] uppercase tracking-wider text-white/40 mb-2">Como voce avalia essa track?</p>
                          <TrackRating
                            playlistId={playlist.id}
                            spotifyId={track.spotify_id}
                            currentRating={track.rating}
                            onRate={(rating, accuracy) => handleRate(track.spotify_id, rating, accuracy)}
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
