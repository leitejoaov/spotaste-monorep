import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Music, ArrowLeft, Share2, Loader2 } from "lucide-react";
import { usePlatform } from "../context/PlatformContext";

interface ArtistData {
  name: string;
  image: string;
  genres: string[];
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
    `Anotando: esse ser humano escuta ${name} de livre e espontanea vontade.`,
  ]);

  return [...generic, ...personalized].sort(() => Math.random() - 0.5);
}

export default function Judge() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [artists, setArtists] = useState<ArtistData[]>([]);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentPhrase, setCurrentPhrase] = useState(0);
  const [phrases, setPhrases] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

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
      setAnalysis(data.analysis);
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

  useEffect(() => {
    if (!loading || phrases.length === 0) return;
    const interval = setInterval(() => {
      setCurrentPhrase((prev) => (prev + 1) % phrases.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [loading, phrases]);

  const handleShare = async () => {
    if (!analysis) return;
    try {
      await navigator.clipboard.writeText(analysis);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

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
                  <div className="w-full h-full bg-spotify-gray flex items-center justify-center text-xs">
                    🎵
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

  // Result
  return (
    <div className="min-h-screen bg-gradient-to-b from-spotify-dark via-[#0d1117] to-spotify-dark text-white">
      <header className="sticky top-0 z-20 bg-spotify-dark/80 backdrop-blur-lg border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={() => navigate(`/hub?artists=${hubData}`)}
            className="flex items-center gap-2 text-spotify-text hover:text-white transition-colors"
          >
            <ArrowLeft size={20} />
            <span className="text-sm font-medium">Hub</span>
          </button>
          <div className="flex items-center gap-2">
            <Music className="text-spotify-green" size={22} />
            <span className="font-display font-bold text-lg bg-gradient-to-r from-spotify-green to-emerald-400 bg-clip-text text-transparent">
              O Veredito
            </span>
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

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-10">
        {/* Top Artists */}
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
              <motion.div
                key={artist.name}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.08, duration: 0.4 }}
                className="group flex flex-col items-center gap-3"
              >
                <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-spotify-gray shadow-lg">
                  {artist.image ? (
                    <img
                      src={artist.image}
                      alt={artist.name}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-spotify-text text-3xl">
                      🎵
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <span className="absolute top-2 left-2 text-[11px] font-bold bg-spotify-green text-black w-6 h-6 rounded-full flex items-center justify-center">
                    {i + 1}
                  </span>
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold truncate w-full">{artist.name}</p>
                  {artist.genres.length > 0 && (
                    <p className="text-[11px] text-spotify-text truncate w-full mt-0.5">
                      {artist.genres[0]}
                    </p>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* Analysis */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
        >
          <h2 className="text-sm font-semibold uppercase tracking-widest text-spotify-green mb-6">
            O Veredito 🔥
          </h2>
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 sm:p-8">
            <div className="prose prose-invert max-w-none">
              {analysis!.split("\n").map((paragraph, i) =>
                paragraph.trim() ? (
                  <p
                    key={i}
                    className="text-[15px] leading-relaxed text-gray-300 mb-4 last:mb-0"
                  >
                    {paragraph}
                  </p>
                ) : null
              )}
            </div>
          </div>
        </motion.section>

        {/* Footer */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-center pb-8"
        >
          <button
            onClick={() => navigate(`/hub?artists=${hubData}`)}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-spotify-green/30 text-spotify-green hover:bg-spotify-green/10 transition-all text-sm font-medium"
          >
            Voltar ao Hub
          </button>
        </motion.footer>
      </main>
    </div>
  );
}
