import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Music, Flame, BarChart3, Headphones, LogOut, Library, Sparkles, ListMusic } from "lucide-react";
import ArtistCard from "../components/ArtistCard";
import ArtistModal from "../components/ArtistModal";
import { getAccessToken, clearAccessToken } from "../hooks/useAuth";

interface ArtistData {
  name: string;
  image: string;
  genres: string[];
}

export default function Hub() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [artists, setArtists] = useState<ArtistData[]>([]);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const accessToken = getAccessToken();

  useEffect(() => {
    if (!accessToken) {
      navigate("/");
      return;
    }
    const raw = searchParams.get("artists");
    if (raw) {
      try {
        setArtists(JSON.parse(decodeURIComponent(raw)));
      } catch {
        navigate("/");
      }
    }
  }, [searchParams, navigate, accessToken]);

  if (!accessToken || artists.length === 0) return null;

  const artistsParam = searchParams.get("artists") || "";

  const cards = [
    {
      title: "Julgar Perfil",
      description: "Deixe a IA analisar (e zoar) seu gosto musical",
      icon: Flame,
      color: "from-orange-500 to-red-500",
      shadow: "shadow-orange-500/20",
      onClick: () => {
        const payload = encodeURIComponent(JSON.stringify(artists));
        navigate(`/judge?artists=${payload}&hubData=${encodeURIComponent(artistsParam)}`);
      },
    },
    {
      title: "Vibe Profile",
      description: "Analise detalhada das suas top tracks com IA",
      icon: BarChart3,
      color: "from-spotify-green to-emerald-400",
      shadow: "shadow-spotify-green/20",
      onClick: () => navigate(`/taste-analysis?hubData=${encodeURIComponent(artistsParam)}`),
    },
    {
      title: "Audio Analysis",
      description: "Analise real do audio de qualquer track via Essentia",
      icon: Headphones,
      color: "from-purple-500 to-violet-400",
      shadow: "shadow-purple-500/20",
      onClick: () => navigate(`/audio-features?hubData=${encodeURIComponent(artistsParam)}`),
    },
    {
      title: "Banco de Musicas",
      description: "Explore todas as musicas ja analisadas no banco global",
      icon: Library,
      color: "from-cyan-500 to-blue-400",
      shadow: "shadow-cyan-500/20",
      onClick: () => navigate(`/library?hubData=${encodeURIComponent(artistsParam)}`),
    },
    {
      title: "Text to Playlist",
      description: "Descreva uma vibe e a IA monta uma playlist pra voce",
      icon: Sparkles,
      color: "from-amber-500 to-yellow-400",
      shadow: "shadow-amber-500/20",
      onClick: () => navigate(`/text-to-playlist?hubData=${encodeURIComponent(artistsParam)}`),
    },
    {
      title: "Minhas Playlists",
      description: "Veja e avalie as playlists criadas pela IA",
      icon: ListMusic,
      color: "from-rose-500 to-pink-400",
      shadow: "shadow-rose-500/20",
      onClick: () => navigate(`/playlist-history?hubData=${encodeURIComponent(artistsParam)}`),
    },
  ];

  const handleLogout = () => {
    clearAccessToken();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-spotify-dark via-[#0d1117] to-spotify-dark text-white">
      <header className="bg-spotify-dark/80 backdrop-blur-lg border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 py-6 flex items-center justify-between">
          <div className="w-20" />
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-spotify-green/20 flex items-center justify-center">
              <Music className="text-spotify-green" size={22} />
            </div>
            <h1 className="font-display font-extrabold text-2xl bg-gradient-to-r from-spotify-green to-emerald-400 bg-clip-text text-transparent">
              Spotaste
            </h1>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-spotify-text hover:text-white transition-colors text-sm"
          >
            <LogOut size={18} />
            <span>Sair</span>
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-10">
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-sm font-semibold uppercase tracking-widest text-spotify-green mb-6">
            Seus Top Artistas
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
            {artists.map((artist, i) => (
              <ArtistCard
                key={artist.name}
                artist={artist}
                index={i}
                onClick={() => setSelectedArtist(artist.name)}
              />
            ))}
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
        >
          <h2 className="text-sm font-semibold uppercase tracking-widest text-spotify-green mb-6">
            O que voce quer fazer?
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {cards.map(({ title, description, icon: Icon, color, shadow, onClick }, i) => (
              <motion.button
                key={title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + i * 0.1, duration: 0.5 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onClick}
                className={`group relative overflow-hidden bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 text-left transition-all hover:border-white/20 ${shadow} hover:shadow-lg`}
              >
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center mb-4`}>
                  <Icon size={24} className="text-white" />
                </div>
                <h3 className="font-display font-bold text-lg mb-1">{title}</h3>
                <p className="text-sm text-spotify-text">{description}</p>
                <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-0 group-hover:opacity-5 transition-opacity duration-300`} />
              </motion.button>
            ))}
          </div>
        </motion.section>
      </main>

      {selectedArtist && (
        <ArtistModal
          artistName={selectedArtist}
          accessToken={accessToken}
          onClose={() => setSelectedArtist(null)}
        />
      )}
    </div>
  );
}
