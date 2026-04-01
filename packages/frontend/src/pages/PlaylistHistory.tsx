import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ListMusic, ExternalLink, ChevronDown, ChevronUp, Loader2, Music2, Sparkles } from "lucide-react";
import TrackRating from "../components/TrackRating";
import { getAccessToken } from "../hooks/useAuth";

interface PlaylistSummary {
  id: number;
  description: string;
  vibe_profile: { playlist_name: string };
  spotify_url: string | null;
  track_count: number;
  vibe_accuracy: number | null;
  music_accuracy: number | null;
  created_at: string;
}

interface PlaylistTrack {
  spotify_id: string;
  track_name: string;
  artist_name: string;
  position: number;
  score: number;
  rating: string | null;
}

interface PlaylistDetail {
  playlist: PlaylistSummary;
  tracks: PlaylistTrack[];
}

function AccuracyBadge({ label, value, color }: { label: string; value: number | null; color: string }) {
  if (value == null) return null;
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${color}`}>
      {label} {Math.round(value)}%
    </span>
  );
}

export default function PlaylistHistory() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const accessToken = getAccessToken();

  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    fetch("/api/playlist/history", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setPlaylists(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [accessToken]);

  const toggleExpand = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }

    setExpandedId(id);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/playlist/${id}`);
      if (res.ok) {
        setDetail(await res.json());
      }
    } catch {
      // silent
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRate = (spotifyId: string, rating: string, accuracy: { vibe_accuracy: number | null; music_accuracy: number | null }) => {
    // Update detail tracks
    setDetail((prev) =>
      prev
        ? {
            ...prev,
            tracks: prev.tracks.map((t) =>
              t.spotify_id === spotifyId ? { ...t, rating } : t
            ),
          }
        : prev
    );

    // Update summary accuracy
    setPlaylists((prev) =>
      prev.map((p) =>
        p.id === expandedId
          ? { ...p, vibe_accuracy: accuracy.vibe_accuracy, music_accuracy: accuracy.music_accuracy }
          : p
      )
    );
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

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
            <ListMusic className="text-amber-400" size={22} />
            <span className="font-display font-bold text-lg bg-gradient-to-r from-amber-400 to-yellow-300 bg-clip-text text-transparent">
              Minhas Playlists
            </span>
          </div>
          <div className="w-20" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-amber-400" />
          </div>
        ) : playlists.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20 text-spotify-text"
          >
            <ListMusic size={48} className="mx-auto mb-4 opacity-30" />
            <p className="text-lg">Nenhuma playlist criada ainda</p>
            <p className="text-sm mt-1">Use o Text to Playlist pra gerar sua primeira!</p>
            <button
              onClick={() => navigate(`/text-to-playlist?hubData=${searchParams.get("hubData") || ""}`)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/20 text-amber-400 text-sm font-medium hover:bg-amber-500/30 transition-colors"
            >
              <Sparkles size={14} />
              Criar Playlist
            </button>
          </motion.div>
        ) : (
          playlists.map((pl, i) => (
            <motion.div
              key={pl.id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden"
            >
              {/* Summary row */}
              <button
                onClick={() => toggleExpand(pl.id)}
                className="w-full flex items-center gap-4 p-5 hover:bg-white/[0.02] transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-yellow-400 flex items-center justify-center shrink-0">
                  <ListMusic size={18} className="text-black" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-display font-bold text-white truncate">
                    {pl.vibe_profile.playlist_name}
                  </h3>
                  <p className="text-xs text-spotify-text truncate">"{pl.description}"</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] text-white/30">{pl.track_count} tracks</span>
                    <span className="text-[10px] text-white/30">{formatDate(pl.created_at)}</span>
                    <AccuracyBadge label="Vibe" value={pl.vibe_accuracy} color="bg-amber-500/20 text-amber-300 border-amber-500/30" />
                    <AccuracyBadge label="Musica" value={pl.music_accuracy} color="bg-spotify-green/20 text-spotify-green border-spotify-green/30" />
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {pl.spotify_url && (
                    <a
                      href={pl.spotify_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="p-2 rounded-lg hover:bg-white/5 transition-colors text-spotify-green"
                    >
                      <ExternalLink size={16} />
                    </a>
                  )}
                  {expandedId === pl.id ? (
                    <ChevronUp size={16} className="text-white/30" />
                  ) : (
                    <ChevronDown size={16} className="text-white/30" />
                  )}
                </div>
              </button>

              {/* Expanded detail */}
              <AnimatePresence>
                {expandedId === pl.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-white/5 px-5 pb-5">
                      {detailLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 size={20} className="animate-spin text-white/30" />
                        </div>
                      ) : detail ? (
                        <div className="space-y-2 pt-3">
                          {detail.tracks.map((track) => (
                            <div
                              key={track.spotify_id}
                              className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-3"
                            >
                              <div className="flex items-center gap-2.5">
                                <span className="text-[10px] text-white/30 w-5 text-right font-mono">{track.position}</span>
                                <Music2 size={12} className="text-spotify-green shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-white truncate">{track.track_name}</p>
                                  <p className="text-[11px] text-spotify-text truncate">{track.artist_name}</p>
                                </div>
                                <span className="text-[10px] text-white/30 shrink-0">{Math.round(track.score * 100)}% match</span>
                                {track.rating && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-spotify-green shrink-0" />
                                )}
                              </div>
                              <div className="mt-2 pl-[30px]">
                                <TrackRating
                                  playlistId={pl.id}
                                  spotifyId={track.spotify_id}
                                  currentRating={track.rating}
                                  onRate={(rating, accuracy) => handleRate(track.spotify_id, rating, accuracy)}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))
        )}
      </main>
    </div>
  );
}
