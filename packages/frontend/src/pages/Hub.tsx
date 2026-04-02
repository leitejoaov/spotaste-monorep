import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Music, Flame, BarChart3, Headphones, LogOut, Library, Sparkles, ListMusic, X, PlayCircle, ChevronDown, ChevronRight } from "lucide-react";
import ArtistCard from "../components/ArtistCard";
import ArtistModal from "../components/ArtistModal";
import LastfmInput from "../components/LastfmInput";
import { usePlatform } from "../context/PlatformContext";
import { getAccessToken } from "../hooks/useAuth";

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
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const { hasSpotify, hasLastfm, hasYTMusic, isLoggedIn, lastfmUser, setLastfmUser, setUserId, getHeaders, logout } = usePlatform();
  const accessToken = getAccessToken();
  const [lastfmArtists, setLastfmArtists] = useState<ArtistData[]>([]);
  const [ytmusicArtists, setYtmusicArtists] = useState<ArtistData[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isLoggedIn) {
      navigate("/");
      return;
    }
    const raw = searchParams.get("artists");
    if (raw) {
      try {
        setArtists(JSON.parse(decodeURIComponent(raw)));
      } catch {
        // Last.fm-only users may not have artists param -- that's ok
      }
    }
  }, [searchParams, navigate, isLoggedIn]);

  // Fetch Last.fm top artists when user has Last.fm
  useEffect(() => {
    if (!lastfmUser) return;

    const API_URL = import.meta.env.VITE_API_URL || "";
    fetch(`${API_URL}/api/lastfm/top-artists?username=${encodeURIComponent(lastfmUser)}`, {
      headers: { ...getHeaders() },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.artists && Array.isArray(data.artists)) {
          setLastfmArtists(data.artists);
          // If no Spotify artists from URL, use Last.fm ones as main artists
          if (!searchParams.get("artists")) {
            setArtists(data.artists);
          }
        }
      })
      .catch(() => {});
  }, [lastfmUser, searchParams, getHeaders]);

  // Fetch YouTube Music top artists when user has YT Music
  useEffect(() => {
    if (!hasYTMusic) return;

    const API_URL = import.meta.env.VITE_API_URL || "";
    fetch(`${API_URL}/api/ytmusic/top-artists`, {
      headers: { ...getHeaders() },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.artists && Array.isArray(data.artists)) {
          setYtmusicArtists(data.artists);
          // If no Spotify or Last.fm artists, use YT Music ones as main artists
          if (!searchParams.get("artists") && !lastfmUser) {
            setArtists(data.artists);
          }
        }
      })
      .catch(() => {});
  }, [hasYTMusic, searchParams, getHeaders, lastfmUser]);

  if (!isLoggedIn) return null;

  const artistsParam = searchParams.get("artists") || "";

  const cards = [
    {
      title: "Julgar Perfil",
      description: "Deixe a IA analisar (e zoar) seu gosto musical",
      icon: Flame,
      color: "from-orange-500 to-red-500",
      shadow: "shadow-orange-500/20",
      onClick: () => {
        // Merge all platform artists for a comprehensive judge
        const allArtists = [...artists];
        const seen = new Set(allArtists.map((a) => a.name.toLowerCase()));
        for (const a of [...lastfmArtists, ...ytmusicArtists]) {
          if (!seen.has(a.name.toLowerCase())) {
            allArtists.push(a);
            seen.add(a.name.toLowerCase());
          }
        }
        const payload = encodeURIComponent(JSON.stringify(allArtists));
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
    logout();
    navigate("/");
  };

  const handleLastfmSuccess = (userId: number, username: string) => {
    setLastfmUser(username);
    setUserId(userId);
    setBannerDismissed(true);
  };

  const missingPlatforms = !bannerDismissed && (!hasSpotify || !hasLastfm || !hasYTMusic);

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
        {/* Connection cards for missing platforms */}
        {missingPlatforms && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-wrap gap-3 items-start"
          >
            {!hasSpotify && (
              <a
                href={`${import.meta.env.VITE_API_URL || ""}/auth/login`}
                className="flex items-center gap-2.5 px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 hover:border-white/20 transition-all"
              >
                <svg className="w-4 h-4 text-spotify-green shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                </svg>
                <span className="text-sm text-white/80 font-medium">Conectar Spotify</span>
              </a>
            )}
            {!hasLastfm && (
              <div className="flex items-center gap-2.5 px-4 py-2 bg-white/5 border border-white/10 rounded-xl">
                <svg className="w-4 h-4 text-[#d51007] shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10.584 17.21l-.88-2.392s-1.43 1.594-3.573 1.594c-1.897 0-3.244-1.649-3.244-4.288 0-3.382 1.704-4.591 3.381-4.591 2.422 0 3.19 1.567 3.849 3.574l.88 2.749c.88 2.666 2.529 4.81 7.285 4.81 3.409 0 5.718-1.044 5.718-3.793 0-2.227-1.265-3.381-3.63-3.932l-1.758-.385c-1.21-.275-1.567-.77-1.567-1.595 0-.934.742-1.484 1.952-1.484 1.32 0 2.034.495 2.144 1.677l2.749-.33c-.22-2.474-1.924-3.492-4.729-3.492-2.474 0-4.893.935-4.893 3.932 0 1.87.907 3.051 3.189 3.602l1.87.44c1.402.33 1.87.825 1.87 1.65 0 .99-.962 1.4-2.776 1.4-2.694 0-3.822-1.413-4.453-3.382l-.907-2.749c-1.155-3.573-2.997-4.893-6.653-4.893C2.144 5.333 0 7.89 0 12.233c0 4.18 2.144 6.434 5.993 6.434 3.106 0 4.591-1.457 4.591-1.457z" />
                </svg>
                <LastfmInput onSuccess={handleLastfmSuccess} buttonText="Conectar Last.fm" compact />
              </div>
            )}
            {!hasYTMusic && (
              <button
                onClick={() => navigate("/?connectYT=1")}
                className="flex items-center gap-2.5 px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 hover:border-white/20 transition-all"
              >
                <PlayCircle className="w-4 h-4 text-red-500 shrink-0" />
                <span className="text-sm text-white/80 font-medium">Conectar YouTube Music</span>
              </button>
            )}
            <button
              onClick={() => setBannerDismissed(true)}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors flex-shrink-0 self-center"
            >
              <X size={14} className="text-white/30" />
            </button>
          </motion.div>
        )}

        {artists.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <button
              onClick={() => setCollapsed((c) => ({ ...c, main: !c.main }))}
              className="flex items-center gap-2 mb-6 group"
            >
              {collapsed.main ? <ChevronRight size={16} className="text-spotify-green" /> : <ChevronDown size={16} className="text-spotify-green" />}
              <h2 className="text-sm font-semibold uppercase tracking-widest text-spotify-green group-hover:text-spotify-green/80 transition-colors">
                {hasSpotify ? "Seus Top Artistas" : hasLastfm ? "Top Artistas (Last.fm)" : "Artistas das Liked Songs (YouTube Music)"}
              </h2>
              <span className="text-xs text-white/30">{artists.length}</span>
            </button>
            {!collapsed.main && (
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
            )}
          </motion.section>
        )}

        {/* Show Last.fm artists separately when we also have Spotify artists */}
        {hasSpotify && lastfmArtists.length > 0 && artists.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.6 }}
          >
            <button
              onClick={() => setCollapsed((c) => ({ ...c, lastfm: !c.lastfm }))}
              className="flex items-center gap-2 mb-6 group"
            >
              {collapsed.lastfm ? <ChevronRight size={16} className="text-[#d51007]" /> : <ChevronDown size={16} className="text-[#d51007]" />}
              <h2 className="text-sm font-semibold uppercase tracking-widest text-[#d51007] group-hover:text-[#d51007]/80 transition-colors">
                Top Artistas (Last.fm)
              </h2>
              <span className="text-xs text-white/30">{lastfmArtists.length}</span>
            </button>
            {!collapsed.lastfm && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                {lastfmArtists.map((artist, i) => (
                  <ArtistCard
                    key={`lfm-${artist.name}`}
                    artist={artist}
                    index={i}
                    onClick={() => setSelectedArtist(artist.name)}
                  />
                ))}
              </div>
            )}
          </motion.section>
        )}

        {/* Show YouTube Music artists separately when we also have other platform artists */}
        {(hasSpotify || hasLastfm) && ytmusicArtists.length > 0 && artists.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
          >
            <button
              onClick={() => setCollapsed((c) => ({ ...c, ytmusic: !c.ytmusic }))}
              className="flex items-center gap-2 mb-6 group"
            >
              {collapsed.ytmusic ? <ChevronRight size={16} className="text-[#ff0000]" /> : <ChevronDown size={16} className="text-[#ff0000]" />}
              <h2 className="text-sm font-semibold uppercase tracking-widest text-[#ff0000] group-hover:text-[#ff0000]/80 transition-colors">
                Artistas das Liked Songs (YouTube Music)
              </h2>
              <span className="text-xs text-white/30">{ytmusicArtists.length}</span>
            </button>
            {!collapsed.ytmusic && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                {ytmusicArtists.map((artist, i) => (
                  <ArtistCard
                    key={`ytm-${artist.name}`}
                    artist={artist}
                    index={i}
                    onClick={() => setSelectedArtist(artist.name)}
                  />
                ))}
              </div>
            )}
          </motion.section>
        )}

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
