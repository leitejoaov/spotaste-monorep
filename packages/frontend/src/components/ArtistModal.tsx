import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ExternalLink, Loader2, Music2, Clock } from "lucide-react";

interface ArtistTrack {
  position: number;
  id: string;
  name: string;
  artist: string;
  album_name: string;
  album_image: string | null;
  spotify_url: string;
  duration_ms: number;
}

interface ArtistDetails {
  id: string;
  name: string;
  image: string | null;
  genres: string[];
  popularity: number;
  spotify_url: string;
  top_tracks: ArtistTrack[];
}

interface Props {
  artistName: string;
  accessToken: string;
  onClose: () => void;
}

function formatDuration(ms: number): string {
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export default function ArtistModal({ artistName, accessToken, onClose }: Props) {
  const [data, setData] = useState<ArtistDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/artist-details?name=${encodeURIComponent(artistName)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("Falha ao buscar artista");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [artistName, accessToken]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
        onClick={onClose}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 50, scale: 0.95 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="relative z-10 w-full max-w-lg max-h-[85vh] overflow-y-auto bg-[#0d1117] border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl"
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-10 p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            <X size={18} className="text-white/60" />
          </button>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={32} className="animate-spin text-spotify-green" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-20 text-red-400 text-sm">
              {error}
            </div>
          ) : data ? (
            <>
              {/* Artist header */}
              <div className="relative">
                {data.image && (
                  <div className="w-full h-48 overflow-hidden rounded-t-3xl">
                    <img
                      src={data.image}
                      alt={data.name}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0d1117] via-[#0d1117]/50 to-transparent" />
                  </div>
                )}
                <div className={`px-6 ${data.image ? "-mt-16 relative" : "pt-12"}`}>
                  <h2 className="font-display font-extrabold text-2xl text-white">{data.name}</h2>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {data.genres.slice(0, 4).map((g) => (
                      <span
                        key={g}
                        className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-spotify-green/15 text-spotify-green font-medium"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 mt-3">
                    <span className="text-xs text-spotify-text">Popularidade: {data.popularity}/100</span>
                    <a
                      href={data.spotify_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-spotify-green hover:underline"
                    >
                      <ExternalLink size={12} />
                      Abrir no Spotify
                    </a>
                  </div>
                </div>
              </div>

              {/* Top tracks */}
              <div className="px-6 pt-6 pb-6">
                <h3 className="text-[10px] uppercase tracking-widest text-white/30 mb-4">
                  Top 10 Musicas
                </h3>
                <div className="space-y-1.5">
                  {data.top_tracks.map((track, i) => (
                    <motion.a
                      key={track.id}
                      href={track.spotify_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/5 transition-colors group"
                    >
                      <span className="text-xs text-white/30 w-5 text-right font-mono">{track.position}</span>
                      {track.album_image ? (
                        <img
                          src={track.album_image}
                          alt={track.album_name}
                          className="w-10 h-10 rounded-lg object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                          <Music2 size={14} className="text-white/20" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate group-hover:text-spotify-green transition-colors">
                          {track.name}
                        </p>
                        <p className="text-[11px] text-spotify-text truncate">{track.album_name}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-white/30 flex items-center gap-1">
                          <Clock size={10} />
                          {formatDuration(track.duration_ms)}
                        </span>
                        <ExternalLink size={12} className="text-white/0 group-hover:text-spotify-green transition-colors" />
                      </div>
                    </motion.a>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
