import { motion } from "framer-motion";
import { Music, Headphones, Mic2 } from "lucide-react";
import SpotifyButton from "../components/SpotifyButton";

const floatingIcons = [
  { Icon: Music, x: "10%", y: "20%", delay: 0, size: 32 },
  { Icon: Headphones, x: "80%", y: "15%", delay: 0.5, size: 28 },
  { Icon: Mic2, x: "15%", y: "75%", delay: 1, size: 24 },
  { Icon: Music, x: "85%", y: "70%", delay: 1.5, size: 36 },
  { Icon: Headphones, x: "50%", y: "85%", delay: 0.8, size: 30 },
];

export default function Login() {
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
            Descubra o que seu gosto musical diz sobre você.
            <br />
            Prepare-se para o roast. 🎤
          </p>
        </motion.div>

        {/* Login button */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          className="w-full"
        >
          <SpotifyButton />
        </motion.div>

        <p className="text-[11px] text-white/30 text-center">
          Conectamos com o Spotify apenas para ler seus artistas favoritos.
          <br />
          Não armazenamos nenhum dado.
        </p>
      </motion.div>
    </div>
  );
}
