import { useState } from "react";
import { Loader2 } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "";

interface Props {
  onSuccess: (userId: number, username: string, userInfo: any) => void;
  buttonText?: string;
  compact?: boolean;
}

export default function LastfmInput({
  onSuccess,
  buttonText = "Entrar",
  compact = false,
}: Props) {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_URL}/auth/lastfm/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Falha ao conectar");
        return;
      }

      onSuccess(data.userId, username.trim(), data.lastfmUser);
    } catch {
      setError("Erro de conexao");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={compact ? "flex gap-2" : "space-y-3"}>
      <input
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username do Last.fm"
        className={`bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-[#d51007] transition-colors ${
          compact ? "px-3 py-2 text-sm flex-1" : "px-4 py-3 w-full"
        }`}
        disabled={loading}
      />
      <button
        type="submit"
        disabled={loading || !username.trim()}
        className={`bg-[#d51007] hover:bg-[#b50e06] disabled:opacity-50 text-white font-bold rounded-lg transition-all ${
          compact ? "px-4 py-2 text-sm" : "px-6 py-3 w-full"
        }`}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : buttonText}
      </button>
      {error && (
        <p className={`text-red-400 ${compact ? "text-xs" : "text-sm text-center"}`}>
          {error}
        </p>
      )}
    </form>
  );
}
