import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../../../.env") });

export const config = {
  port: Number(process.env.PORT) || 3000,
  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID!,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET!,
    redirectUri: process.env.REDIRECT_URI || "http://127.0.0.1:3000/auth/callback",
  },
  frontendUrl: process.env.FRONTEND_URL || "http://127.0.0.1:5173",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  lastfmApiKey: process.env.LASTFM_API_KEY || "",
};
