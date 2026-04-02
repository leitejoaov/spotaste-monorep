import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Menu, X, Home, Flame, BarChart3, Headphones, Library,
  Sparkles, ListMusic, LogOut, Music, Settings,
} from "lucide-react";
import { clearAccessToken, getAccessToken } from "../hooks/useAuth";

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
