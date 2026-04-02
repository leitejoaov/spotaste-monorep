import { useNavigate } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";

export default function Terms() {
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
            <FileText className="text-spotify-green" size={22} />
            <span className="font-display font-bold text-lg bg-gradient-to-r from-spotify-green to-emerald-400 bg-clip-text text-transparent">
              Termos de Uso
            </span>
          </div>
          <div className="w-20" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10">
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8 space-y-8 text-[15px] leading-relaxed text-gray-300">
          <div>
            <h1 className="font-display font-extrabold text-3xl text-white mb-2">Termos de Uso</h1>
            <p className="text-sm text-spotify-text">Ultima atualizacao: Abril 2026</p>
          </div>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">1. Aceitacao dos Termos</h2>
            <p>
              Ao usar o Spotaste, voce concorda com estes Termos de Uso e com nossa{" "}
              <button onClick={() => navigate("/privacy")} className="text-spotify-green hover:underline">
                Politica de Privacidade
              </button>. Se nao concordar, nao use o servico.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">2. Descricao do Servico</h2>
            <p>
              Spotaste e um projeto open-source gratuito que analisa gosto musical usando dados de
              plataformas de streaming (Spotify, YouTube Music, Last.fm), inteligencia artificial e
              analise de audio. O servico inclui:
            </p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>Analise e roast de gosto musical</li>
              <li>Perfil de vibe baseado em dados reais de audio</li>
              <li>Criacao de playlists personalizadas por IA</li>
              <li>Banco global de musicas analisadas</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">3. Contas e Autenticacao</h2>
            <p>
              O Spotaste usa autenticacao OAuth via Spotify e YouTube Music (Google). Ao fazer login,
              voce autoriza o Spotaste a acessar dados especificos da sua conta conforme descrito na
              Politica de Privacidade. Voce e responsavel por manter a seguranca da sua sessao.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">4. Uso Aceitavel</h2>
            <p>Voce concorda em nao:</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>Usar o servico para fins ilegais</li>
              <li>Tentar acessar dados de outros usuarios</li>
              <li>Fazer engenharia reversa ou atacar a infraestrutura do servico</li>
              <li>Usar bots ou automacao para abusar das APIs</li>
              <li>Violar os termos de servico do Spotify, YouTube ou Last.fm</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">5. Conteudo Gerado por IA</h2>
            <p>
              Os roasts, analises e playlists sao gerados por inteligencia artificial (Claude, da Anthropic).
              O conteudo e humoristico e nao representa opinioes reais. O Spotaste nao se responsabiliza
              por conteudo ofensivo gerado pela IA.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">6. Disponibilidade</h2>
            <p>
              O Spotaste e fornecido "como esta", sem garantias. O servico pode ficar indisponivel
              a qualquer momento sem aviso previo. Nao garantimos uptime, precisao dos dados ou
              disponibilidade de funcionalidades especificas.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">7. Propriedade Intelectual</h2>
            <p>
              O codigo do Spotaste e open-source sob licenca MIT. Os dados musicais pertencem
              as respectivas plataformas (Spotify, YouTube, Last.fm). As analises de IA sao
              geradas sob demanda e nao constituem propriedade intelectual do Spotaste.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">8. Limitacao de Responsabilidade</h2>
            <p>
              O Spotaste nao se responsabiliza por danos diretos ou indiretos decorrentes do uso
              do servico, incluindo mas nao limitado a: perda de dados, interrupcao de servico,
              ou conteudo gerado pela IA.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">9. Alteracoes nos Termos</h2>
            <p>
              Podemos atualizar estes termos a qualquer momento. Alteracoes significativas serao
              comunicadas no repositorio do projeto. O uso continuado do servico apos alteracoes
              constitui aceitacao dos novos termos.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">10. Contato</h2>
            <p>
              Duvidas sobre os termos? Abra uma issue no{" "}
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
