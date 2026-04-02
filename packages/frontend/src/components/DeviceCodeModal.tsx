import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Copy, Check, Loader2, PlayCircle, ExternalLink } from "lucide-react";

interface Props {
  url: string;
  code: string;
  deviceCode: string;
  onSuccess: (data: { token: object; channelId: string; userName: string; userId: number }) => void;
  onCancel: () => void;
}

export default function DeviceCodeModal({ url, code, deviceCode, onSuccess, onCancel }: Props) {
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const hasAutoOpened = useRef(false);

  // Auto-copy code on mount, countdown then open URL
  useEffect(() => {
    if (hasAutoOpened.current) return;
    hasAutoOpened.current = true;

    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 4000);
    }).catch(() => {});
  }, [code]);

  useEffect(() => {
    if (opened) return;
    if (countdown <= 0) {
      window.open(url, "_blank", "noopener,noreferrer");
      setOpened(true);
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, opened, url]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleOpenUrl = () => {
    window.open(url, "_blank", "noopener,noreferrer");
    setOpened(true);
  };

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/auth/ytmusic/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_code: deviceCode }),
        });
        const data = await res.json();
        if (!data.pending && data.token) {
          clearInterval(interval);
          onSuccess(data);
        }
      } catch {}
    }, 5000);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      onCancel();
    }, 300000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [deviceCode, onSuccess, onCancel]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center"
        onClick={onCancel}
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
          className="relative z-10 w-full max-w-md bg-[#0d1117] border border-white/10 rounded-3xl shadow-2xl p-8 mx-4"
        >
          {/* Close button */}
          <button
            onClick={onCancel}
            className="absolute top-4 right-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            <X size={18} className="text-white/60" />
          </button>

          {/* Header */}
          <div className="flex flex-col items-center gap-4 mb-8">
            <div className="w-16 h-16 rounded-2xl bg-red-500/20 flex items-center justify-center">
              <PlayCircle className="text-red-500" size={32} />
            </div>
            <h2 className="font-display font-extrabold text-xl text-white text-center">
              Conectar YouTube Music
            </h2>
            <p className="text-sm text-spotify-text text-center">
              {opened
                ? "Cole o codigo na aba que abriu e autorize"
                : `Copie o codigo abaixo — abrindo o Google em ${countdown}s...`}
            </p>
          </div>

          {/* User code */}
          <div className="mb-6">
            <div className="flex items-center justify-center gap-3 bg-white/5 border border-white/10 rounded-2xl py-5 px-6">
              <span className="font-mono text-3xl font-bold tracking-[0.3em] text-white">
                {code}
              </span>
              <button
                onClick={handleCopy}
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors shrink-0"
                title="Copiar codigo"
              >
                {copied ? (
                  <Check size={18} className="text-green-400" />
                ) : (
                  <Copy size={18} className="text-white/60" />
                )}
              </button>
            </div>
            {copied && (
              <p className="text-xs text-green-400 text-center mt-2">Codigo copiado!</p>
            )}
          </div>

          {/* Open URL button */}
          {!opened && (
            <button
              onClick={() => { setCountdown(0); }}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors mb-6"
            >
              <ExternalLink size={16} />
              Abrir agora ({countdown}s)
            </button>
          )}

          {opened && (
            <button
              onClick={handleOpenUrl}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 hover:text-white/80 text-sm font-medium transition-all mb-6"
            >
              <ExternalLink size={16} />
              Abrir novamente
            </button>
          )}

          {/* Waiting spinner */}
          <div className="flex items-center justify-center gap-3 mb-6">
            <Loader2 size={18} className="animate-spin text-red-400" />
            <span className="text-sm text-spotify-text">Aguardando autorizacao...</span>
          </div>

          {/* Cancel button */}
          <button
            onClick={onCancel}
            className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white/60 hover:bg-white/10 hover:text-white/80 transition-all font-medium"
          >
            Cancelar
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
