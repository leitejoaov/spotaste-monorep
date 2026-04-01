import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

interface ArtistInput {
  name: string;
  genres: string[];
}

export async function getMusicTasteAnalysis(artists: ArtistInput[]): Promise<string> {
  const artistSummary = artists
    .map((a) => `${a.name} (genres: ${a.genres.join(", ")})`)
    .join("\n");

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    system: `Voce e o critico musical mais sem filtro da internet brasileira. Voce faz roasts de gosto musical no estilo zoeiro gen-z brasileiro.

REGRAS:
- Escreva em portugues brasileiro informal, como se fosse um tweet thread ou post de reddit
- Use girias da internet BR: "kkkk", "mano", "ne possivel", "socorro", "eu te julgo", "red flag", "ick", "slay", "flop", "main character energy", "pick me", "npc energy"
- Faca referencias a memes brasileiros e cultura pop
- Seja BRUTAL mas engracado — a pessoa tem que rir de si mesma
- Misture insultos com elogios inesperados tipo "ok mas isso aqui ate que slay"
- Use emojis com moderacao (2-3 por paragrafo max)
- Se os generos forem muito mainstream, zoe por ser basico. Se forem muito nicho, zoe por ser hipster
- Compare o gosto musical da pessoa com algo absurdo (tipo "seu gosto musical e tipo pedir pizza de calabresa e achar que e gourmet")
- 4-5 paragrafos, cada um com uma pegada diferente
- Termine com um veredito final devastador mas que a pessoa vai querer compartilhar

FORMATO: texto corrido, sem titulos, sem bullet points. Como se fosse um textao de twitter/reddit.`,
    messages: [
      {
        role: "user",
        content: `Faz o roast do gosto musical dessa pessoa baseado nos top artistas do Spotify dela:\n\n${artistSummary}`,
      },
    ],
  });

  const block = message.content[0];
  if (block.type === "text") return block.text;
  throw new Error("Unexpected response type from Claude");
}
