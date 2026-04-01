import { useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { usePlatform } from "../context/PlatformContext";
import LastfmInput from "../components/LastfmInput";

const API_URL = import.meta.env.VITE_API_URL || "";

export default function Settings() {
  const navigate = useNavigate();
  const { hasSpotify, hasLastfm, setLastfmUser, setUserId } = usePlatform();

  const handleLastfmSuccess = (userId: number, username: string) => {
    setLastfmUser(username);
    setUserId(userId);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-spotify-dark via-[#0d1117] to-spotify-dark text-white">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        {/* Back button */}
        <button
          onClick={() => navigate("/hub")}
          className="flex items-center gap-2 text-spotify-text hover:text-white transition-colors text-sm"
        >
          <ArrowLeft size={18} />
          <span>Voltar ao Hub</span>
        </button>

        <h1 className="text-2xl font-display font-extrabold">Configuracoes</h1>

        {/* Connected Accounts */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-spotify-green">
            Contas Conectadas
          </h2>

          {/* Last.fm Card */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${hasLastfm ? "bg-[#d51007]/20" : "bg-white/5"}`}>
                <svg
                  className={`w-6 h-6 ${hasLastfm ? "text-[#d51007]" : "text-white/30"}`}
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M10.584 17.21l-.88-2.392s-1.43 1.594-3.573 1.594c-1.897 0-3.244-1.649-3.244-4.288 0-3.382 1.704-4.591 3.381-4.591 2.422 0 3.19 1.567 3.849 3.574l.88 2.749c.88 2.666 2.529 4.81 7.285 4.81 3.409 0 5.718-1.044 5.718-3.793 0-2.227-1.265-3.381-3.63-3.932l-1.758-.385c-1.21-.275-1.567-.77-1.567-1.595 0-.934.742-1.484 1.952-1.484 1.32 0 2.034.495 2.144 1.677l2.749-.33c-.22-2.474-1.924-3.492-4.729-3.492-2.474 0-4.893.935-4.893 3.932 0 1.87.907 3.051 3.189 3.602l1.87.44c1.402.33 1.87.825 1.87 1.65 0 .99-.962 1.4-2.776 1.4-2.694 0-3.822-1.413-4.453-3.382l-.907-2.749c-1.155-3.573-2.997-4.893-6.653-4.893C2.144 5.333 0 7.89 0 12.233c0 4.18 2.144 6.434 5.993 6.434 3.106 0 4.591-1.457 4.591-1.457z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-display font-bold">Last.fm</h3>
                <p className="text-xs text-spotify-text">
                  {hasLastfm ? "Conectado" : "Nao conectado"}
                </p>
              </div>
              {hasLastfm && (
                <CheckCircle2 size={22} className="text-[#d51007]" />
              )}
            </div>
            {!hasLastfm && (
              <LastfmInput onSuccess={handleLastfmSuccess} buttonText="Conectar" compact />
            )}
          </div>

          {/* Spotify Card */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${hasSpotify ? "bg-spotify-green/20" : "bg-white/5"}`}>
                <svg
                  className={`w-6 h-6 ${hasSpotify ? "text-spotify-green" : "text-white/30"}`}
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-display font-bold">Spotify</h3>
                <p className="text-xs text-spotify-text">
                  {hasSpotify ? "Conectado" : "Nao conectado"}
                </p>
              </div>
              {hasSpotify ? (
                <CheckCircle2 size={22} className="text-spotify-green" />
              ) : (
                <a
                  href={`${API_URL}/auth/login`}
                  className="px-4 py-2 bg-spotify-green hover:bg-[#1ed760] text-black text-sm font-semibold rounded-lg transition-colors"
                >
                  Conectar
                </a>
              )}
            </div>
          </div>

          {/* Note when Spotify not connected */}
          {!hasSpotify && (
            <p className="text-xs text-white/30 text-center">
              Sem Spotify, criacao de playlists nao esta disponivel.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
