import { useState } from "react";
import { getAccessToken } from "../hooks/useAuth";

const RATINGS = [
  { code: "liked_right_vibe", label: "Curti a musica e a vibe ta certa", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/30" },
  { code: "right_vibe", label: "Curti a vibe", color: "bg-green-500/20 text-green-300 border-green-500/30 hover:bg-green-500/30" },
  { code: "liked_song", label: "Curti a musica", color: "bg-teal-500/20 text-teal-300 border-teal-500/30 hover:bg-teal-500/30" },
  { code: "bad_song_right_vibe", label: "Nao gostei da musica mas ta com a vibe", color: "bg-amber-500/20 text-amber-300 border-amber-500/30 hover:bg-amber-500/30" },
  { code: "liked_wrong_vibe", label: "Gostei da musica mas nao ta na vibe", color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30 hover:bg-yellow-500/30" },
  { code: "bad_both", label: "Nao curti a musica nem a vibe", color: "bg-red-500/20 text-red-300 border-red-500/30 hover:bg-red-500/30" },
];

interface Props {
  playlistId: number;
  spotifyId: string;
  currentRating: string | null;
  onRate: (rating: string, accuracy: { vibe_accuracy: number | null; music_accuracy: number | null }) => void;
}

export default function TrackRating({ playlistId, spotifyId, currentRating, onRate }: Props) {
  const [loading, setLoading] = useState(false);

  const handleRate = async (code: string) => {
    if (loading) return;
    setLoading(true);

    try {
      const res = await fetch(`/api/playlist/${playlistId}/rate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getAccessToken()}`,
        },
        body: JSON.stringify({ spotifyId, rating: code }),
      });

      if (res.ok) {
        const accuracy = await res.json();
        onRate(code, accuracy);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {RATINGS.map(({ code, label, color }) => (
        <button
          key={code}
          onClick={() => handleRate(code)}
          disabled={loading}
          className={`text-[10px] font-medium px-2.5 py-1 rounded-full border transition-all ${
            currentRating === code
              ? color.replace("/20", "/40").replace("hover:", "") + " ring-1 ring-white/20"
              : currentRating
              ? "opacity-30 " + color
              : color
          } ${loading ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
