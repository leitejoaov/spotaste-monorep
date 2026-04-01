import { useNavigate } from "react-router-dom";
import { ArrowLeft, Shield } from "lucide-react";

export default function Privacy() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-b from-spotify-dark via-[#0d1117] to-spotify-dark text-white">
      <header className="sticky top-0 z-20 bg-spotify-dark/80 backdrop-blur-lg border-b border-white/5">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-spotify-text hover:text-white transition-colors"
          >
            <ArrowLeft size={20} />
            <span className="text-sm font-medium">Voltar</span>
          </button>
          <div className="flex items-center gap-2">
            <Shield className="text-spotify-green" size={22} />
            <span className="font-display font-bold text-lg bg-gradient-to-r from-spotify-green to-emerald-400 bg-clip-text text-transparent">
              Privacidade
            </span>
          </div>
          <div className="w-20" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10">
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8 space-y-8 text-[15px] leading-relaxed text-gray-300">
          <div>
            <h1 className="font-display font-extrabold text-3xl text-white mb-2">Politica de Privacidade</h1>
            <p className="text-sm text-spotify-text">Ultima atualizacao: Abril 2026</p>
          </div>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">1. O que e o Spotaste</h2>
            <p>
              Spotaste e um projeto open-source que analisa seu gosto musical usando dados da sua conta Spotify,
              inteligencia artificial (Claude, da Anthropic) e analise real de audio (Essentia).
              O app nao tem fins comerciais e nao vende dados de ninguem.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">2. Quais dados acessamos</h2>
            <p>Quando voce faz login com Spotify, pedimos acesso a:</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li><strong>Top artistas e musicas</strong> — pra analisar seu gosto musical</li>
              <li><strong>Playback atual</strong> — pra contexto (nao armazenamos)</li>
              <li><strong>Musicas ouvidas recentemente</strong> — pra contexto (nao armazenamos)</li>
              <li><strong>Criar playlists</strong> — quando voce usa o Text to Playlist</li>
            </ul>
            <p>
              Nao acessamos seu email, nome completo, dados de pagamento, ou qualquer informacao pessoal
              alem do seu ID de usuario do Spotify.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">3. O que armazenamos</h2>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li><strong>Analise de audio das musicas</strong> — dados tecnicos como BPM, key, energy, moods (global, compartilhado entre usuarios)</li>
              <li><strong>Cache de analises da IA</strong> — pra nao repetir chamadas caras a API</li>
              <li><strong>Playlists geradas</strong> — com seus ratings pra medir accuracy</li>
              <li><strong>Roast do perfil</strong> — cache por 30 dias vinculado ao seu Spotify ID</li>
            </ul>
            <p>
              Nao armazenamos seu token de acesso do Spotify no servidor. O token fica apenas no seu navegador
              (sessionStorage) e e descartado quando voce fecha a aba.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">4. Com quem compartilhamos</h2>
            <p>Seus dados nao sao compartilhados com terceiros. As unicas APIs externas que usamos:</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li><strong>Spotify Web API</strong> — pra acessar seus dados musicais (com sua autorizacao)</li>
              <li><strong>Anthropic Claude API</strong> — pra gerar analises com IA (enviamos apenas nomes de musicas/artistas, nunca dados pessoais)</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">5. Como revogar acesso</h2>
            <p>
              Voce pode revogar o acesso do Spotaste a qualquer momento em{" "}
              <a
                href="https://www.spotify.com/account/apps/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-spotify-green hover:underline"
              >
                spotify.com/account/apps
              </a>.
              Apos revogar, o app nao consegue mais acessar seus dados do Spotify.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">6. Codigo aberto</h2>
            <p>
              O codigo-fonte do Spotaste e 100% aberto e pode ser auditado em{" "}
              <a
                href="https://github.com/leitejoaov/spotaste-monorep"
                target="_blank"
                rel="noopener noreferrer"
                className="text-spotify-green hover:underline"
              >
                github.com/leitejoaov/spotaste-monorep
              </a>.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">7. Contato</h2>
            <p>
              Duvidas sobre privacidade? Abra uma issue no{" "}
              <a
                href="https://github.com/leitejoaov/spotaste-monorep/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="text-spotify-green hover:underline"
              >
                repositorio do projeto
              </a>.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
