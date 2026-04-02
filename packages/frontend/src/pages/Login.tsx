import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Music, Headphones, Mic2, PlayCircle, Loader2 } from "lucide-react";
import SpotifyButton from "../components/SpotifyButton";
import LastfmInput from "../components/LastfmInput";
import DeviceCodeModal from "../components/DeviceCodeModal";
import { usePlatform } from "../context/PlatformContext";

const floatingIcons = [
  { Icon: Music, x: "10%", y: "20%", delay: 0, size: 32 },
  { Icon: Headphones, x: "80%", y: "15%", delay: 0.5, size: 28 },
  { Icon: Mic2, x: "15%", y: "75%", delay: 1, size: 24 },
  { Icon: Music, x: "85%", y: "70%", delay: 1.5, size: 36 },
  { Icon: Headphones, x: "50%", y: "85%", delay: 0.8, size: 30 },
];

export default function Login() {
  const navigate = useNavigate();
  const { setLastfmUser, setYTMusicToken, setUserId } = usePlatform();
  const [ytSetup, setYtSetup] = useState<{ url: string; code: string; deviceCode: string } | null>(null);
  const [ytLoading, setYtLoading] = useState(false);

  const handleLastfmSuccess = (userId: number, username: string) => {
    setLastfmUser(username);
    setUserId(userId);
    navigate("/hub");
  };

  const handleYTMusicSetup = async () => {
    setYtLoading(true);
    try {
      const res = await fetch("/auth/ytmusic/setup");
      if (!res.ok) throw new Error("Falha ao iniciar setup");
      const data = await res.json();
      setYtSetup({
        url: data.verification_url,
        code: data.user_code,
        deviceCode: data.device_code,
      });
    } catch {
      // silently fail
    } finally {
      setYtLoading(false);
    }
  };

  const handleYTMusicSuccess = (data: { token: object; channelId: string; userName: string; userId: number }) => {
    setYTMusicToken(JSON.stringify(data.token));
    setUserId(data.userId);
    setYtSetup(null);
    navigate("/hub");
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-spotify-dark via-[#0d1117] to-[#1a0a2e]">
      {/* Animated background blobs */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-spotify-green/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl animate-pulse [animation-delay:2s]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-spotify-green/5 rounded-full blur-3xl" />
      </div>

      {/* Floating music icons */}
      {floatingIcons.map(({ Icon, x, y, delay, size }, i) => (
        <motion.div
          key={i}
          className="absolute text-white/10"
          style={{ left: x, top: y }}
          animate={{
            y: [0, -20, 0],
            rotate: [0, 10, -10, 0],
          }}
          transition={{
            duration: 4,
            repeat: Infinity,
            delay,
            ease: "easeInOut",
          }}
        >
          <Icon size={size} />
        </motion.div>
      ))}

      {/* Main card */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="relative z-10 flex flex-col items-center gap-8 px-8 py-12 sm:px-16 sm:py-16 rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl max-w-md w-full mx-4"
      >
        {/* Logo / Title */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="flex flex-col items-center gap-3"
        >
          <div className="w-20 h-20 rounded-2xl bg-spotify-green/20 flex items-center justify-center mb-2">
            <Music className="text-spotify-green" size={40} />
          </div>
          <h1 className="text-5xl font-display font-extrabold tracking-tight bg-gradient-to-r from-spotify-green to-emerald-400 bg-clip-text text-transparent">
            Spotaste
          </h1>
          <p className="text-spotify-text text-center text-sm leading-relaxed max-w-xs">
            Descubra o que seu gosto musical diz sobre voce.
            <br />
            Prepare-se para o roast. 🎤
          </p>
        </motion.div>

        {/* Last.fm Login — Primary */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="w-full bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#d51007]/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-[#d51007]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M10.584 17.21l-.88-2.392s-1.43 1.594-3.573 1.594c-1.897 0-3.244-1.649-3.244-4.288 0-3.382 1.704-4.591 3.381-4.591 2.422 0 3.19 1.567 3.849 3.574l.88 2.749c.88 2.666 2.529 4.81 7.285 4.81 3.409 0 5.718-1.044 5.718-3.793 0-2.227-1.265-3.381-3.63-3.932l-1.758-.385c-1.21-.275-1.567-.77-1.567-1.595 0-.934.742-1.484 1.952-1.484 1.32 0 2.034.495 2.144 1.677l2.749-.33c-.22-2.474-1.924-3.492-4.729-3.492-2.474 0-4.893.935-4.893 3.932 0 1.87.907 3.051 3.189 3.602l1.87.44c1.402.33 1.87.825 1.87 1.65 0 .99-.962 1.4-2.776 1.4-2.694 0-3.822-1.413-4.453-3.382l-.907-2.749c-1.155-3.573-2.997-4.893-6.653-4.893C2.144 5.333 0 7.89 0 12.233c0 4.18 2.144 6.434 5.993 6.434 3.106 0 4.591-1.457 4.591-1.457z" />
              </svg>
            </div>
            <div>
              <h3 className="font-display font-bold text-white">Entrar com Last.fm</h3>
              <p className="text-xs text-spotify-text">Sem limites, acesso completo</p>
            </div>
          </div>
          <LastfmInput onSuccess={handleLastfmSuccess} buttonText="Entrar" />
        </motion.div>

        {/* Divider */}
        <div className="flex items-center gap-4 w-full">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-xs text-white/30 uppercase tracking-widest">ou</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Spotify Login — Secondary */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          className="w-full space-y-3"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-spotify-green/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-spotify-green" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
              </svg>
            </div>
            <div>
              <h3 className="font-display font-semibold text-sm text-white">Entrar com Spotify</h3>
              <p className="text-xs text-spotify-text">Cria playlists + analises</p>
            </div>
          </div>
          <SpotifyButton />
        </motion.div>

        {/* Divider */}
        <div className="flex items-center gap-4 w-full">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-xs text-white/30 uppercase tracking-widest">ou</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* YouTube Music Login */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="w-full space-y-3"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center">
              <PlayCircle className="w-4 h-4 text-red-500" />
            </div>
            <div>
              <h3 className="font-display font-semibold text-sm text-white">YouTube Music</h3>
              <p className="text-xs text-spotify-text">Conecte sua conta do YouTube Music</p>
            </div>
          </div>
          <button
            onClick={handleYTMusicSetup}
            disabled={ytLoading}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
          >
            {ytLoading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <PlayCircle size={18} />
            )}
            Entrar com YouTube Music
          </button>
        </motion.div>

        <p className="text-[11px] text-white/30 text-center">
          Conectamos com suas plataformas apenas para ler seus artistas favoritos.
          <br />
          <button
            onClick={() => navigate("/privacy")}
            className="text-spotify-green/50 hover:text-spotify-green underline transition-colors"
          >
            Privacidade
          </button>
          {" · "}
          <button
            onClick={() => navigate("/terms")}
            className="text-spotify-green/50 hover:text-spotify-green underline transition-colors"
          >
            Termos de Uso
          </button>
        </p>
      </motion.div>

      {/* YouTube Music Device Code Modal */}
      {ytSetup && (
        <DeviceCodeModal
          url={ytSetup.url}
          code={ytSetup.code}
          deviceCode={ytSetup.deviceCode}
          onSuccess={handleYTMusicSuccess}
          onCancel={() => setYtSetup(null)}
        />
      )}
    </div>
  );
}
