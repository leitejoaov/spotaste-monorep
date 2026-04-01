# Spotaste Monorepo

## O que o app faz
App de análise de gosto musical via Spotify + IA + análise real de áudio.

### Features
1. **Julgar Perfil** — Roast zoeiro gen-z do gosto musical via Claude Haiku (cache 30 dias no PostgreSQL)
2. **Vibe Profile** — Top 20 tracks analisadas pelo Claude + dados reais do Essentia (energy, moods, BPM, key, etc.)
3. **Audio Analysis** — Busca por nome/artista ou cola link, enfileira pra análise em background, mostra resultados com moods
4. **Text to Playlist** — Descreve uma vibe em texto, Claude gera perfil sonoro, matching algorithm encontra tracks, cria playlist no Spotify
5. **Banco de Musicas** — Todas as tracks analisadas com busca debounced e mood tags
6. **Minhas Playlists** — Histórico de playlists criadas, com sistema de rating (6 opções) e accuracy de vibe/música
7. **Modal de Artista** — Top 10 músicas, gêneros, popularidade, links pro Spotify

### Fluxo
- Login via Spotify OAuth → Hub com top artistas + artistas recomendados + cards de features
- No login, top tracks são enfileiradas progressivamente pra análise em background (pula pages já analisadas)
- Worker processa fila a cada 30s (5 por ciclo) e re-analisa tracks sem mood data
- Track features cacheadas globalmente no PostgreSQL — compartilhadas entre todos os usuários

## Estrutura
```
├── docker-compose.yml         # audio-service + PostgreSQL 16
├── db/
│   ├── schema.sql             # track_features, analysis_queue
│   ├── migrate_001_add_moods.sql    # mood columns
│   ├── migrate_002_playlists.sql    # playlists, playlist_tracks
│   └── migrate_003_judge_cache.sql  # judge_cache
├── packages/backend/src/
│   ├── config.ts              # env vars, dotenv
│   ├── spotify.ts             # OAuth, search, top tracks/artists, related artists, playlist creation
│   ├── judge.ts               # Claude roast prompt (gen-z BR)
│   ├── claude.ts              # Claude taste analysis + vibe profile generation
│   ├── essentia.ts            # HTTP client pro audio-service
│   ├── db.ts                  # PostgreSQL pool, todas as queries, migrations
│   ├── cache.ts               # SQLite (sql.js) cache de taste analysis (5 dias)
│   ├── matcher.ts             # Weighted Euclidean distance scoring pra text-to-playlist
│   ├── worker.ts              # Background worker (fila + re-análise de moods)
│   ├── index.ts               # Express app, todos os endpoints
│   └── routes/auth.ts         # OAuth callback + enqueue progressivo de tracks
├── packages/frontend/src/
│   ├── pages/                 # Login, Hub, Judge, TasteAnalysis, AudioFeatures, Library, TextToPlaylist, PlaylistHistory
│   └── components/            # ArtistCard, ArtistModal, SpotifyButton, TrackRating
└── audio-service/             # Flask + Essentia + essentia-tensorflow + yt-dlp (Docker)
    ├── app.py                 # Análise de áudio com 8 modelos TF (moods) + features básicas
    ├── download_models.py     # Download dos modelos na build
    └── Dockerfile
```

## URLs (dev)
- Frontend: http://127.0.0.1:5173
- Backend: http://127.0.0.1:3000
- Audio Service: http://127.0.0.1:5001
- PostgreSQL: postgresql://spotaste:spotaste@localhost:5432/spotaste
- **IMPORTANTE**: Usar sempre `127.0.0.1`, nunca `localhost` (política do Spotify)
- Redirect URI no Spotify Dashboard: `http://127.0.0.1:3000/auth/callback`

## Comandos
```bash
docker compose up -d           # audio-service + postgres
pnpm dev:backend               # backend na porta 3000
pnpm dev:frontend              # frontend na porta 5173
```

## Env vars necessárias
- `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`
- `REDIRECT_URI=http://127.0.0.1:3000/auth/callback`
- `FRONTEND_URL=http://127.0.0.1:5173`
- `PORT=3000`
- `ANTHROPIC_API_KEY`
- `AUDIO_SERVICE_URL` (default: `http://127.0.0.1:5001`)
- `DATABASE_URL` (default: `postgresql://spotaste:spotaste@localhost:5432/spotaste`)

## Spotify OAuth Scopes
`user-top-read user-read-playback-state user-read-recently-played playlist-modify-private playlist-modify-public`

## Decisões técnicas
- Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) — modelo mais barato
- PostgreSQL 16 (Docker) — track features, fila de análise, playlists, ratings, judge cache
- SQLite via sql.js — cache de taste analysis por usuário (5 dias)
- Essentia + TensorFlow (8 modelos MusiCNN) — mood/genre classification real do áudio
- Worker reseta items stuck em `processing` ao iniciar
- Matching algorithm usa weighted Euclidean distance com pesos por feature gerados pelo Claude
- Rating system com 6 opções que calculam accuracy de vibe e música
- dotenv precisa de path explícito (`../../../.env`) porque pnpm muda o CWD
