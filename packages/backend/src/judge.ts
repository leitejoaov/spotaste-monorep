import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

export interface JudgeMessage {
  text: string;
  mood: string;
}

// Valid moods the frontend will have expressions for
const VALID_MOODS = [
  "shocked",     // chocado, surpreso
  "disgusted",   // enojado, nojo
  "laughing",    // rindo, achando hilario
  "judging",     // julgando, desaprovando
  "impressed",   // impressionado positivamente
  "crying",      // chorando de rir ou de tristeza
  "angry",       // com raiva
  "confused",    // confuso
  "sarcastic",   // sarcastico, ironia
  "dead",        // morto, sem palavras
];

function parseMessages(text: string): JudgeMessage[] {
  let parsed: any;

  try {
    parsed = JSON.parse(text.trim());
  } catch {
    // Try extracting JSON from markdown code blocks
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch { /* fall through */ }
    }
  }

  // Valid structured format: [{text, mood}]
  if (Array.isArray(parsed) && parsed.length > 0) {
    if (typeof parsed[0] === "object" && parsed[0].text) {
      return parsed
        .filter((m: any) => m.text?.trim())
        .map((m: any) => ({
          text: m.text,
          mood: VALID_MOODS.includes(m.mood) ? m.mood : "judging",
        }));
    }
    // Fallback: array of strings (old format)
    if (typeof parsed[0] === "string") {
      return parsed
        .filter((m: string) => m.trim())
        .map((m: string) => ({ text: m, mood: "judging" }));
    }
  }

  // Last fallback: split by paragraphs
  return text
    .split("\n")
    .filter((p) => p.trim().length > 0)
    .map((p) => ({ text: p, mood: "judging" }));
}

const FORMAT_INSTRUCTIONS = `FORMATO: Responda APENAS com um JSON array de objetos. Cada objeto tem "text" (a mensagem) e "mood" (a expressao facial do critico).

Moods disponiveis: "shocked", "disgusted", "laughing", "judging", "impressed", "crying", "angry", "confused", "sarcastic", "dead"

REGRAS DE FORMATO:
- 8-12 mensagens no total
- Cada mensagem deve ser CURTA: 1 frase apenas, maximo 2 frases curtas
- Varie os moods conforme o tom da mensagem
- Comece com "shocked" ou "confused" ao ver o perfil
- Termine com "dead" ou "laughing" no veredito final

Exemplo:
[{"text":"mano... eu abri esse perfil e ja quero fechar kkkk","mood":"shocked"},{"text":"tu escuta isso de LIVRE vontade??","mood":"disgusted"}]

Nao inclua NADA fora do JSON. Sem markdown, sem code blocks. Apenas o array JSON puro.`;

interface ArtistInput {
  name: string;
  genres: string[];
}

export async function getMusicTasteAnalysis(artists: ArtistInput[]): Promise<JudgeMessage[]> {
  const artistSummary = artists
    .map((a) => `${a.name} (genres: ${a.genres.join(", ")})`)
    .join("\n");

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2000,
    system: `Voce e o critico musical mais sem filtro da internet brasileira. Voce faz roasts de gosto musical no estilo zoeiro gen-z brasileiro.

REGRAS:
- Portugues brasileiro informal, estilo mensagem de whatsapp/twitter
- Girias: "kkkk", "mano", "ne possivel", "socorro", "red flag", "ick", "slay", "flop"
- Seja BRUTAL mas engracado
- Mensagens CURTAS e diretas, como se tivesse mandando audio transcrito
- Use emojis com moderacao
- Se for mainstream, zoe por basico. Se for nicho, zoe por hipster

${FORMAT_INSTRUCTIONS}`,
    messages: [
      {
        role: "user",
        content: `Faz o roast do gosto musical dessa pessoa baseado nos top artistas:\n\n${artistSummary}`,
      },
    ],
  });

  const block = message.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Claude");
  return parseMessages(block.text);
}

export async function getEnrichedMusicTasteAnalysis(
  artists: { name: string; genres: string[]; playcount?: number }[],
  totalScrobbles?: number,
  memberSince?: number
): Promise<JudgeMessage[]> {
  const artistList = artists
    .map(
      (a) =>
        `${a.name} (${a.genres.join(", ") || "sem genero"})${
          a.playcount ? ` — ${a.playcount} plays` : ""
        }`
    )
    .join("\n");

  const statsLine = [
    totalScrobbles ? `Total de scrobbles: ${totalScrobbles.toLocaleString()}` : "",
    memberSince
      ? `Membro desde: ${new Date(memberSince * 1000).getFullYear()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2000,
    system: `Voce e um critico musical gen-z brasileiro BRUTALMENTE sincero e engraçado.
Voce recebe os artistas mais ouvidos do usuario COM a quantidade de vezes que ele ouviu cada um.
Use esses numeros pra piadas ESPECIFICAS (ex: "847 plays em 3 meses?? isso da tipo 9 por dia mano").
Quanto maior o numero, mais zoa.
Girias: kkkkk, ne possivel, mlk, mano, vey.
Mensagens CURTAS, estilo whatsapp.

${FORMAT_INSTRUCTIONS}`,
    messages: [
      {
        role: "user",
        content: `Top artistas:\n${artistList}\n\n${statsLine}`,
      },
    ],
  });

  return parseMessages((msg.content[0] as any).text);
}
