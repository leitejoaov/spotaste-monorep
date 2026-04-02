import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Music, ArrowLeft, Share2, Loader2 } from "lucide-react";
import { usePlatform } from "../context/PlatformContext";

// Kitsune expression images
import imgShocked from "../images/Shocked.png";
import imgDisgusted from "../images/Disgusted.png";
import imgLaughing from "../images/Laughing.png";
import imgJudging from "../images/Judging.png";
import imgImpressed from "../images/Impressed.png";
import imgCrying from "../images/Crying.png";
import imgAngry from "../images/Angry.png";
import imgConfused from "../images/Confused.png";
import imgSarcastic from "../images/Sarcastic.png";
import imgDead from "../images/Dead.png";

interface ArtistData {
  name: string;
  image: string;
  genres: string[];
}

interface JudgeMessage {
  text: string;
  mood: string;
}

const MOOD_IMAGES: Record<string, string> = {
  shocked: imgShocked,
  disgusted: imgDisgusted,
  laughing: imgLaughing,
  judging: imgJudging,
  impressed: imgImpressed,
  crying: imgCrying,
  angry: imgAngry,
  confused: imgConfused,
  sarcastic: imgSarcastic,
  dead: imgDead,
};

function getMoodImage(mood: string): string {
  return MOOD_IMAGES[mood] || MOOD_IMAGES.judging;
}

function getLoadingPhrases(artists: ArtistData[]): string[] {
  const names = artists.map((a) => a.name);
  const generic = [
    "Analisando seu gosto musical questionavel...",
    "Preparando o roast do seculo...",
    "A IA esta julgando cada uma das suas escolhas...",
    "Procurando algo de bom no seu perfil... dificil...",
    "Calculando o nivel de vergonha alheia...",
    "Investigando se isso e gosto musical ou cry for help...",
    "Tentando entender suas escolhas de vida...",
    "Carregando julgamento... paciencia, tem muita coisa pra criticar...",
  ];

  const personalized = names.slice(0, 5).flatMap((name) => [
    `${name}? Serio mesmo?`,
    `Ainda escutando ${name} em ${new Date().getFullYear()}...`,
    `${name} no top? A IA esta chocada.`,
  ]);

  return [...generic, ...personalized].sort(() => Math.random() - 0.5);
}

export default function Judge() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [artists, setArtists] = useState<ArtistData[]>([]);
  const [messages, setMessages] = useState<JudgeMessage[]>([]);
  const [visibleCount, setVisibleCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentPhrase, setCurrentPhrase] = useState(0);
  const [phrases, setPhrases] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [typing, setTyping] = useState(false);

  const hubData = searchParams.get("hubData") || "";
  const { getHeaders } = usePlatform();

  const fetchAnalysis = useCallback(async (artistsList: ArtistData[]) => {
    try {
      const res = await fetch("/api/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getHeaders() },
        body: JSON.stringify({ artists: artistsList }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Erro ${res.status}`);
      }

      const data = await res.json();
      // Backend returns JudgeMessage[] (array of {text, mood})
      let msgs: JudgeMessage[];
      if (Array.isArray(data.analysis)) {
        msgs = data.analysis.map((m: any) =>
          typeof m === "string"
            ? { text: m, mood: "judging" }
            : { text: m.text || m, mood: m.mood || "judging" }
        );
      } else {
        // Fallback for old string format
        msgs = data.analysis
          .split("\n")
          .filter((p: string) => p.trim())
          .map((p: string) => ({ text: p, mood: "judging" }));
      }
      setMessages(msgs);
    } catch (err: any) {
      setError(err.message || "Algo deu errado.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const raw = searchParams.get("artists");
    if (!raw) {
      navigate("/");
      return;
    }
    try {
      const parsed = JSON.parse(decodeURIComponent(raw)) as ArtistData[];
      setArtists(parsed);
      setPhrases(getLoadingPhrases(parsed));
      fetchAnalysis(parsed);
    } catch {
      navigate("/");
    }
  }, [searchParams, navigate, fetchAnalysis]);

  // Loading phrases rotation
  useEffect(() => {
    if (!loading || phrases.length === 0) return;
    const interval = setInterval(() => {
      setCurrentPhrase((prev) => (prev + 1) % phrases.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [loading, phrases]);

  // Progressive message reveal — first message
  useEffect(() => {
    if (messages.length === 0 || loading) return;
    setTyping(true);
    const timeout = setTimeout(() => {
      setVisibleCount(1);
      setTyping(false);
    }, 800);
    return () => clearTimeout(timeout);
  }, [messages, loading]);

  // Progressive message reveal — subsequent messages
  useEffect(() => {
    if (visibleCount === 0 || visibleCount >= messages.length) return;
    setTyping(true);
    const delay = 800 + Math.random() * 1200; // 0.8-2s
    const timeout = setTimeout(() => {
      setVisibleCount((prev) => prev + 1);
      setTyping(false);
    }, delay);
    return () => clearTimeout(timeout);
  }, [visibleCount, messages.length]);

  const handleShare = async () => {
    if (messages.length === 0) return;
    try {
      await navigator.clipboard.writeText(messages.map((m) => m.text).join("\n\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  // Current mood for the typing indicator
  const currentMood = visibleCount < messages.length
    ? messages[visibleCount]?.mood || "judging"
    : messages[messages.length - 1]?.mood || "judging";

  // Loading screen
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-spotify-dark via-[#0d1117] to-spotify-dark flex flex-col items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-8 max-w-md text-center"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          >
            <Loader2 size={48} className="text-spotify-green" />
          </motion.div>

          <AnimatePresence mode="wait">
            <motion.p
              key={currentPhrase}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.4 }}
              className="text-lg text-gray-300 font-medium min-h-[3.5rem]"
            >
              {phrases[currentPhrase] || "Carregando..."}
            </motion.p>
          </AnimatePresence>

          <div className="flex gap-2 flex-wrap justify-center">
            {artists.slice(0, 5).map((a, i) => (
              <motion.div
                key={a.name}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.15 }}
                className="w-12 h-12 rounded-full overflow-hidden border-2 border-white/10"
              >
                {a.image ? (
                  <img src={a.image} alt={a.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-spotify-gray flex items-center justify-center">
                    <Music size={16} className="text-spotify-text" />
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-spotify-dark via-[#0d1117] to-spotify-dark flex flex-col items-center justify-center px-4 gap-4">
        <p className="text-red-400 text-lg">{error}</p>
        <button
          onClick={() => navigate(`/hub?artists=${hubData}`)}
          className="px-6 py-3 rounded-full border border-spotify-green/30 text-spotify-green hover:bg-spotify-green/10 transition-all text-sm font-medium"
        >
          Voltar ao Hub
        </button>
      </div>
    );
  }

  // Chat result
  return (
    <div className="min-h-screen bg-gradient-to-b from-spotify-dark via-[#0d1117] to-spotify-dark text-white flex flex-col">
      <header className="sticky top-0 z-20 bg-spotify-dark/80 backdrop-blur-lg border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={() => navigate(`/hub?artists=${hubData}`)}
            className="flex items-center gap-2 text-spotify-text hover:text-white transition-colors"
          >
            <ArrowLeft size={20} />
            <span className="text-sm font-medium">Hub</span>
          </button>
          <div className="flex items-center gap-2">
            <img src={imgJudging} alt="Kitsune" className="w-8 h-8 rounded-full object-cover" />
            <span className="font-bold text-sm">Critico Musical IA</span>
          </div>
          <button
            onClick={handleShare}
            className="flex items-center gap-2 text-sm text-spotify-text hover:text-white transition-colors"
          >
            <Share2 size={18} />
            <span>{copied ? "Copiado!" : "Copiar"}</span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-6 space-y-3 overflow-y-auto">
        <AnimatePresence>
          {messages.slice(0, visibleCount).map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="flex gap-3 items-end"
            >
              {/* Avatar with mood expression */}
              <div className="flex-shrink-0 w-14">
                <motion.div
                  key={`avatar-${i}-${msg.mood}`}
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                  className="w-14 h-14 rounded-full overflow-hidden border border-white/10"
                >
                  <img src={getMoodImage(msg.mood)} alt={msg.mood} className="w-full h-full object-cover" />
                </motion.div>
              </div>
              {/* Bubble */}
              <div className="bg-white/[0.07] backdrop-blur-sm border border-white/[0.08] rounded-2xl rounded-bl-md px-4 py-3 max-w-[85%]">
                <p className="text-[15px] leading-relaxed text-gray-200">
                  {msg.text}
                </p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Typing indicator */}
        {typing && visibleCount < messages.length && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex gap-3 items-end"
          >
            <div className="w-14 h-14 rounded-full overflow-hidden border border-white/10 flex-shrink-0">
              <img src={getMoodImage(currentMood)} alt="typing" className="w-full h-full object-cover" />
            </div>
            <div className="bg-white/[0.07] border border-white/[0.08] rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1.5">
                <motion.span
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: 0 }}
                  className="w-2 h-2 bg-spotify-text rounded-full"
                />
                <motion.span
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
                  className="w-2 h-2 bg-spotify-text rounded-full"
                />
                <motion.span
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }}
                  className="w-2 h-2 bg-spotify-text rounded-full"
                />
              </div>
            </div>
          </motion.div>
        )}

        {/* All revealed — footer */}
        {visibleCount >= messages.length && messages.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="pt-6 text-center"
          >
            <button
              onClick={() => navigate(`/hub?artists=${hubData}`)}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-spotify-green/30 text-spotify-green hover:bg-spotify-green/10 transition-all text-sm font-medium"
            >
              Voltar ao Hub
            </button>
          </motion.div>
        )}
      </main>
    </div>
  );
}
