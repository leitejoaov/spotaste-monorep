import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Menu, X, Home, Flame, BarChart3, Headphones, Library,
  Sparkles, ListMusic, LogOut, Music, Settings, PlayCircle,
} from "lucide-react";
import { clearAccessToken, getAccessToken } from "../hooks/useAuth";
import { usePlatform } from "../context/PlatformContext";

const PLAYLIST_PLATFORMS = new Set(["/text-to-playlist", "/playlist-history"]);

const NAV_ITEMS = [
  { path: "/hub", label: "Hub", icon: Home },
  { path: "/judge", label: "Julgar Perfil", icon: Flame },
  { path: "/taste-analysis", label: "Vibe Profile", icon: BarChart3 },
  { path: "/audio-features", label: "Audio Analysis", icon: Headphones },
  { path: "/library", label: "Banco de Musicas", icon: Library },
  { path: "/text-to-playlist", label: "Text to Playlist", icon: Sparkles },
  { path: "/playlist-history", label: "Minhas Playlists", icon: ListMusic },
  { path: "/settings", label: "Configuracoes", icon: Settings },
];

interface Props {
  hubData?: string;
}

export default function Sidebar({ hubData = "" }: Props) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { hasSpotify, hasLastfm, hasYTMusic } = usePlatform();

  const handleNav = (path: string) => {
    setOpen(false);
    if (path === "/hub") {
      navigate(`/hub?artists=${hubData}`);
    } else if (path === "/judge") {
      // Judge needs artists param — skip if no hubData
      navigate(`/judge?hubData=${encodeURIComponent(hubData)}`);
    } else {
      navigate(`${path}?hubData=${encodeURIComponent(hubData)}`);
    }
  };

  const handleLogout = () => {
    setOpen(false);
    clearAccessToken();
    navigate("/");
  };

  const currentPath = location.pathname;

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed top-4 left-4 z-40 p-2 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm hover:bg-white/10 transition-colors"
      >
        <Menu size={20} className="text-white/70" />
      </button>

      {/* Overlay */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar panel */}
      <AnimatePresence>
        {open && (
          <motion.aside
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed top-0 left-0 z-50 h-full w-[260px] bg-[#0a0d12] border-r border-white/5 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-5 border-b border-white/5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-spotify-green/20 flex items-center justify-center">
                  <Music className="text-spotify-green" size={16} />
                </div>
                <span className="font-display font-bold text-lg bg-gradient-to-r from-spotify-green to-emerald-400 bg-clip-text text-transparent">
                  Spotaste
                </span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
              >
                <X size={18} className="text-white/50" />
              </button>
            </div>

            {/* Nav items */}
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
              {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
                const isActive = currentPath === path;
                const disabled = PLAYLIST_PLATFORMS.has(path) && !getAccessToken() && !sessionStorage.getItem("spotaste_ytmusic_token");
                return (
                  <button
                    key={path}
                    onClick={() => !disabled && handleNav(path)}
                    disabled={disabled}
                    title={disabled ? "Requer login com Spotify" : undefined}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm transition-all ${
                      disabled
                        ? "text-white/20 cursor-not-allowed"
                        : isActive
                          ? "bg-spotify-green/10 text-spotify-green font-medium"
                          : "text-white/60 hover:bg-white/5 hover:text-white/90"
                    }`}
                  >
                    <Icon size={18} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Connect platforms */}
            {(!hasSpotify || !hasLastfm || !hasYTMusic) && (
              <div className="px-3 py-3 border-t border-white/5 space-y-1.5">
                <p className="px-3 text-[10px] uppercase tracking-widest text-white/20 font-semibold mb-2">Conectar</p>
                {!hasSpotify && (
                  <a
                    href={`${import.meta.env?.VITE_API_URL || ""}/auth/login`}
                    onClick={() => setOpen(false)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-white/50 hover:bg-white/5 hover:text-white/80 transition-all"
                  >
                    <svg className="w-4 h-4 text-spotify-green shrink-0" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                    </svg>
                    <span>Spotify</span>
                  </a>
                )}
                {!hasLastfm && (
                  <button
                    onClick={() => { setOpen(false); navigate("/settings"); }}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-white/50 hover:bg-white/5 hover:text-white/80 transition-all"
                  >
                    <svg className="w-4 h-4 text-[#d51007] shrink-0" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M10.584 17.21l-.88-2.392s-1.43 1.594-3.573 1.594c-1.897 0-3.244-1.649-3.244-4.288 0-3.382 1.704-4.591 3.381-4.591 2.422 0 3.19 1.567 3.849 3.574l.88 2.749c.88 2.666 2.529 4.81 7.285 4.81 3.409 0 5.718-1.044 5.718-3.793 0-2.227-1.265-3.381-3.63-3.932l-1.758-.385c-1.21-.275-1.567-.77-1.567-1.595 0-.934.742-1.484 1.952-1.484 1.32 0 2.034.495 2.144 1.677l2.749-.33c-.22-2.474-1.924-3.492-4.729-3.492-2.474 0-4.893.935-4.893 3.932 0 1.87.907 3.051 3.189 3.602l1.87.44c1.402.33 1.87.825 1.87 1.65 0 .99-.962 1.4-2.776 1.4-2.694 0-3.822-1.413-4.453-3.382l-.907-2.749c-1.155-3.573-2.997-4.893-6.653-4.893C2.144 5.333 0 7.89 0 12.233c0 4.18 2.144 6.434 5.993 6.434 3.106 0 4.591-1.457 4.591-1.457z" />
                    </svg>
                    <span>Last.fm</span>
                  </button>
                )}
                {!hasYTMusic && (
                  <button
                    onClick={() => { setOpen(false); navigate("/"); }}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-white/50 hover:bg-white/5 hover:text-white/80 transition-all"
                  >
                    <PlayCircle className="w-4 h-4 text-red-500 shrink-0" />
                    <span>YouTube Music</span>
                  </button>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="px-3 py-4 border-t border-white/5">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-red-400/70 hover:bg-red-500/5 hover:text-red-400 transition-all"
              >
                <LogOut size={18} />
                <span>Sair</span>
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
