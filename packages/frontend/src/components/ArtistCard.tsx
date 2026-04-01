import { motion } from "framer-motion";

interface Props {
  artist: {
    name: string;
    image: string;
    genres: string[];
  };
  index: number;
  onClick?: () => void;
}

export default function ArtistCard({ artist, index, onClick }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.08, duration: 0.4 }}
      className="group flex flex-col items-center gap-3 cursor-pointer"
      onClick={onClick}
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
          {index + 1}
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
  );
}
