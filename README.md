# Spotaste

App de analise de gosto musical que conecta com Spotify e/ou Last.fm, usa IA (Claude) pra analisar seu perfil e analisa audio real das musicas com Essentia.

**Live em [spotaste.cc](https://spotaste.cc)**

## Features

**Julgar Perfil** — IA faz um roast zoeiro gen-z do seu gosto musical, com expressoes faciais dinamicas por mensagem (chat-style). Usuarios Last.fm ganham roast enriquecido com play counts

**Vibe Profile** — Analise detalhada das suas top 20 tracks com atributos inferidos pela IA + dados reais do audio (BPM, key, energy, moods)

**Audio Analysis** — Busca musicas por nome/artista ou cola link do Spotify, enfileira pra analise em background. Funciona sem login (busca via Last.fm com capas via Deezer). Mostra energy, danceability, moods (happy, sad, relaxed, party, etc.) extraidos do audio real

**Text to Playlist** — Descreve uma vibe em texto livre (ex: "noite de chuva lendo um livro"), a IA gera um perfil sonoro, o algoritmo encontra as musicas que mais combinam no banco e cria uma playlist no Spotify automaticamente (requer Spotify)

**Banco de Musicas** — Explore todas as musicas ja analisadas com busca em tempo real, mood tags e paginacao (20 por pagina)

**Minhas Playlists** — Historico de playlists criadas com sistema de rating (6 opcoes) que calcula accuracy de vibe e de musica (requer Spotify)

**Modal de Artista** — Clique em qualquer artista pra ver top 10 musicas, generos, popularidade e links pro Spotify

**Configuracoes** — Conectar/desconectar Last.fm, gerenciar plataformas

## Tech Stack

| Camada | Tecnologias |
|--------|------------|
| Frontend | React, TypeScript, Vite, Tailwind CSS, Framer Motion |
| Backend | Node.js, Express, TypeScript |
| IA | Claude Haiku 4.5 (Anthropic) |
| Audio | Essentia + TensorFlow (8 modelos MusiCNN), yt-dlp, Flask |
| Banco | PostgreSQL 16, SQLite (sql.js) |
| APIs | Spotify Web API, Last.fm API, Deezer API (imagens) |
| Infra | Docker Compose, pnpm workspaces, Cloudflare Tunnel |

## Arquitetura

```
Browser (React SPA)
    |
    | Vite proxy /api /auth (dev) | static files (prod)
    v
Express Backend (:3000)
    |
    |--- Spotify Web API (OAuth, tracks, artists, playlists)
    |--- Last.fm API (top artists/tracks, scrobbles, search)
    |--- Deezer API (album covers, artist images - fallback)
    |--- Claude Haiku API (roast, taste analysis, vibe profile)
    |--- PostgreSQL (:5432) (track features, playlists, ratings, cache, users)
    |--- SQLite (taste analysis cache per user)
    |--- Audio Service (:5001)
              |
              |--- yt-dlp (download audio do YouTube)
              |--- Essentia + TF (analise de audio + mood classification)
```

## Pre-requisitos

- [Node.js](https://nodejs.org/) v18+
- [pnpm](https://pnpm.io/) v8+
- [Docker](https://www.docker.com/) e Docker Compose (ou [Rancher Desktop](https://rancherdesktop.io/))
- Conta de desenvolvedor no [Spotify](https://developer.spotify.com/dashboard)
- API key da [Anthropic](https://console.anthropic.com/)
- API key do [Last.fm](https://www.last.fm/api/account/create) (opcional, pra funcionalidades sem Spotify)

## Setup

### 1. Clonar o repositorio

```bash
git clone https://github.com/leitejoaov/spotaste-monorep.git
cd spotaste
```

### 2. Configurar o Spotify Dashboard

1. Acesse [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Crie um app (ou use um existente)
3. Em **Settings > Redirect URIs**, adicione: `http://127.0.0.1:3000/auth/callback`
4. Copie o **Client ID** e **Client Secret**

### 3. Configurar variaveis de ambiente

```bash
cp .env.example .env
```

Edite o `.env` com suas credenciais:

```env
SPOTIFY_CLIENT_ID=seu_client_id
SPOTIFY_CLIENT_SECRET=seu_client_secret
REDIRECT_URI=http://127.0.0.1:3000/auth/callback
FRONTEND_URL=http://127.0.0.1:5173
PORT=3000
ANTHROPIC_API_KEY=sua_api_key
AUDIO_SERVICE_URL=http://127.0.0.1:5001
DATABASE_URL=postgresql://spotaste:spotaste@localhost:5432/spotaste
LASTFM_API_KEY=sua_lastfm_api_key
```

> **Importante:** Use sempre `127.0.0.1` e nunca `localhost`. O Spotify bloqueia `localhost` como redirect URI.

### 4. Instalar dependencias

```bash
pnpm install
```

### 5. Subir os servicos Docker

```bash
docker compose up -d
```

Isso sobe:
- **audio-service** (Flask + Essentia + 8 modelos TF) na porta 5001
- **PostgreSQL 16** na porta 5432

O primeiro build do audio-service baixa ~300MB de modelos de ML. Builds subsequentes usam cache.

### 6. Rodar as migrations

```bash
docker compose exec postgres psql -U spotaste -d spotaste -f /dev/stdin < db/schema.sql
docker compose exec postgres psql -U spotaste -d spotaste -f /dev/stdin < db/migrate_001_add_moods.sql
docker compose exec postgres psql -U spotaste -d spotaste -f /dev/stdin < db/migrate_002_playlists.sql
docker compose exec postgres psql -U spotaste -d spotaste -f /dev/stdin < db/migrate_003_judge_cache.sql
docker compose exec postgres psql -U spotaste -d spotaste -f /dev/stdin < db/migrate_004_lastfm.sql
```

### 7. Rodar o app

Em dois terminais separados:

```bash
# Terminal 1 - Backend
pnpm dev:backend

# Terminal 2 - Frontend
pnpm dev:frontend
```

### 8. Acessar

Abra **http://127.0.0.1:5173** no navegador e faca login com Spotify ou entre com seu username do Last.fm.

### Producao

Para rodar em producao com Cloudflare Tunnel:

```bash
# Build do frontend
pnpm --filter @spotaste/frontend build

# Backend servindo static files
NODE_ENV=production FRONTEND_URL=https://spotaste.cc REDIRECT_URI=https://spotaste.cc/auth/callback pnpm --filter @spotaste/backend dev

# Tunnel (em outro terminal)
cloudflared tunnel run spotaste
```

## Como funciona

### Plataformas

O Spotaste suporta duas plataformas de entrada:

- **Spotify** — Login via OAuth, acesso completo a todas as features incluindo criacao de playlists
- **Last.fm** — Entrada por username, acesso a analise de perfil, audio analysis e banco de musicas. Nao cria playlists (Last.fm nao tem essa API)

### Analise de audio

Quando voce loga, suas top tracks sao enfileiradas automaticamente pra analise (ate 100 tracks, com dedup cross-platform). Um worker background processa 5 musicas por ciclo (a cada 30s):

1. Busca o audio no YouTube via yt-dlp
2. Extrai features basicas com Essentia (BPM, key, energy, danceability, loudness)
3. Classifica moods com 8 modelos TensorFlow MusiCNN (happy, sad, aggressive, relaxed, party, instrumental, acoustic, danceability)
4. Salva no PostgreSQL — cache global compartilhado entre usuarios

### Text to Playlist

1. Voce descreve a vibe que quer (ex: "musicas pra treinar pesado")
2. Claude Haiku gera um perfil numerico com targets pra cada feature (energy, BPM, moods) e pesos de importancia
3. O algoritmo calcula um **weighted Euclidean distance score** pra cada musica no banco
4. As 20 musicas com maior score sao selecionadas
5. Uma playlist e criada automaticamente na sua conta Spotify
6. Voce pode avaliar cada musica com 6 opcoes de rating que medem accuracy de vibe e de musica

### Sistema de rating

Cada musica numa playlist gerada pode ser avaliada:

| Rating | Musica | Vibe |
|--------|--------|------|
| Curti a musica e a vibe ta certa | OK | OK |
| Curti a vibe | - | OK |
| Curti a musica | OK | - |
| Nao gostei da musica mas ta com a vibe | X | OK |
| Gostei da musica mas nao ta na vibe | OK | X |
| Nao curti a musica nem a vibe | X | X |

O sistema calcula automaticamente a **accuracy de vibe** (% de tracks com vibe correta) e **accuracy de musica** (% de tracks curtidas).

## Estrutura do projeto

```
spotaste/
├── docker-compose.yml              # Audio service + PostgreSQL
├── db/
│   ├── schema.sql                  # Tabelas principais
│   └── migrate_*.sql               # Migrations incrementais
├── audio-service/
│   ├── app.py                      # Flask API de analise de audio
│   ├── download_models.py          # Download dos modelos TF na build
│   ├── requirements.txt
│   └── Dockerfile
├── packages/
│   ├── backend/src/
│   │   ├── index.ts                # Express app + endpoints
│   │   ├── config.ts               # Variaveis de ambiente
│   │   ├── spotify.ts              # Spotify Web API client
│   │   ├── lastfm.ts               # Last.fm API client + Deezer fallback
│   │   ├── claude.ts               # Claude taste analysis + vibe profile
│   │   ├── judge.ts                # Claude roast prompt (com moods)
│   │   ├── essentia.ts             # Audio service HTTP client
│   │   ├── db.ts                   # PostgreSQL queries + migrations
│   │   ├── cache.ts                # SQLite cache (taste analysis)
│   │   ├── matcher.ts              # Algoritmo de matching weighted distance
│   │   ├── worker.ts               # Background queue processor
│   │   └── routes/
│   │       ├── auth.ts             # Spotify OAuth flow
│   │       ├── auth-lastfm.ts      # Last.fm auth flow
│   │       └── settings.ts         # User settings endpoints
│   └── frontend/src/
│       ├── pages/                  # Login, Hub, Judge, TasteAnalysis,
│       │                           # AudioFeatures, Library, TextToPlaylist,
│       │                           # PlaylistHistory, Settings, AuthCallback
│       ├── components/             # Sidebar, ArtistCard, ArtistModal,
│       │                           # LastfmInput, SpotifyButton, TrackRating
│       ├── context/                # PlatformContext (Spotify/Last.fm)
│       ├── hooks/useAuth.ts        # Token management (sessionStorage)
│       └── images/                 # Reaction faces (judge moods)
└── .env.example
```

## Seguranca

- Token do Spotify armazenado em `sessionStorage` (nunca exposto em URLs)
- OAuth com `state` parameter anti-CSRF
- Rate limiting: 30 req/min geral, 10 req/min em endpoints que chamam Claude
- PostgreSQL acessivel apenas em localhost
- Input validation com limites de tamanho
- Endpoints autenticados exigem Bearer token
- Graceful shutdown no backend (libera porta no Ctrl+C)

## Licenca

MIT
