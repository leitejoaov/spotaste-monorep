# YouTube Music Integration — Implementation Plan (v2)

**Goal:** Adicionar YouTube Music como terceira plataforma (junto com Spotify e Last.fm). Usuários podem logar com qualquer combinação dos 3 e conectar os outros depois. YT Music permite criar playlists direto na conta, análise de perfil, e enriquecimento com Last.fm quando disponível.

**Contexto:** A integração Last.fm já existe e funciona como referência. O PlatformContext, sistema de headers, Settings, users table e padrões de auth já estão prontos pra extensão.

**Arquitetura:** Novo microservice `ytmusic-service` (Flask + ytmusicapi) no Docker, porta 5002. Backend consome via HTTP. Frontend ganha terceiro card de login, seletor de plataforma no Text-to-Playlist, e backfill de Spotify IDs.

---

## Visão Geral das Mudanças

### Plataformas: 3 vias de entrada
| Plataforma | Auth | Criar Playlist | Top Tracks | Busca |
|-----------|------|---------------|------------|-------|
| Spotify | OAuth | Sim | API nativa | Spotify API |
| Last.fm | Username | Não | API nativa | Last.fm API + Deezer imgs |
| YT Music | OAuth (TV device flow) | Sim | Liked + History (sintético) | ytmusicapi search |

### Features por combinação de login
| Feature | Spotify | Last.fm | YT Music | Qualquer combo |
|---------|---------|---------|----------|---------------|
| Hub (top artistas) | ✅ | ✅ | ✅ | Merge dedup |
| Julgar Perfil | ✅ | ✅ (enriched) | ✅ | Merge |
| Vibe Profile | ✅ | ✅ | ✅ | Top 20 merged |
| Audio Analysis | ✅ | ✅ | ✅ | Busca unificada |
| Text to Playlist | ✅ (cria no Spotify) | ❌ | ✅ (cria no YT) | Escolhe plataforma |
| Banco de Musicas | ✅ | ✅ | ✅ | Global |
| Minhas Playlists | ✅ | ❌ | ✅ | Filtra por plataforma |

---

## Arquitetura

```
Browser (React SPA)
    |
    v
Express Backend (:3000)
    |--- Spotify Web API (OAuth, tracks, playlists)
    |--- Last.fm API (username, top data, search)
    |--- ytmusic-service (:5002) ← NOVO
    |       |--- ytmusicapi (Python)
    |       |--- OAuth TV device flow
    |       |--- liked songs, history, search, playlists
    |--- Deezer API (imagens fallback)
    |--- Claude Haiku (roast, taste, vibe profile)
    |--- PostgreSQL (features, cache, users, playlists, track_mapping)
    |--- Audio Service (:5001) (Essentia + TF + yt-dlp)
```

---

## Task 1: ytmusic-service (Flask microservice)

### Novos arquivos
```
ytmusic-service/
  app.py              # Flask REST API
  requirements.txt    # ytmusicapi, flask, gunicorn
  Dockerfile          # Python 3.11
```

### Endpoints

| Endpoint | Method | Descrição |
|----------|--------|-----------|
| `/health` | GET | Health check |
| `/auth/setup` | GET | Gera URL + code pro TV device flow |
| `/auth/token` | POST | Troca code por token (polling) |
| `/auth/refresh` | POST | Refresh token |
| `/user/info` | GET | Info do usuário (channelId, nome) |
| `/user/liked-songs` | GET | Liked songs (limit param) |
| `/user/history` | GET | Listening history |
| `/search` | GET | Busca tracks (q param) |
| `/artist/:channelId` | GET | Info do artista + top songs |
| `/playlist/create` | POST | Cria playlist (title, description) |
| `/playlist/:id/add` | POST | Adiciona tracks a playlist (videoIds) |

### Auth flow (TV device flow)
1. Frontend chama backend → backend chama `ytmusic-service /auth/setup`
2. ytmusic-service retorna `{ verification_url, user_code, device_code, interval }`
3. Frontend mostra modal com URL e código pro usuário digitar
4. Frontend faz polling no backend → backend faz polling em `ytmusic-service /auth/token`
5. Quando autorizado, retorna token → frontend salva em sessionStorage

### Top Tracks (sintético)
Como YT Music não tem "top tracks" oficial:
1. Busca liked songs (até 200)
2. Busca listening history (até 200)
3. Score: +1 por ocorrência no history, +5 se liked
4. Se Last.fm conectado: enriquecer com playcounts do Last.fm (match por nome+artista)
5. Ordena por score desc → retorna top N

### Docker
```yaml
# adicionar ao docker-compose.yml
ytmusic-service:
  build: ./ytmusic-service
  ports:
    - "5002:5002"
  restart: unless-stopped
```

---

## Task 2: Database — Migration 005

### Novo arquivo: `db/migrate_005_ytmusic.sql`

```sql
-- Adicionar ytmusic à users table
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN ytmusic_channel_id VARCHAR(128) UNIQUE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Cross-platform track mapping
CREATE TABLE IF NOT EXISTS track_mapping (
  id SERIAL PRIMARY KEY,
  spotify_id VARCHAR(64),
  youtube_id VARCHAR(64),
  lastfm_key VARCHAR(128),  -- "artist_trackname" lowercase
  track_name TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  matched_at TIMESTAMP DEFAULT NOW(),
  match_confidence REAL DEFAULT 1.0,
  UNIQUE(spotify_id, youtube_id)
);
CREATE INDEX IF NOT EXISTS idx_track_mapping_spotify ON track_mapping(spotify_id);
CREATE INDEX IF NOT EXISTS idx_track_mapping_youtube ON track_mapping(youtube_id);
CREATE INDEX IF NOT EXISTS idx_track_mapping_lastfm ON track_mapping(lastfm_key);

-- Adicionar youtube_id e platform_source ao track_features
DO $$ BEGIN
  ALTER TABLE track_features ADD COLUMN youtube_id VARCHAR(64);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE track_features ADD COLUMN platform_source VARCHAR(16) DEFAULT 'spotify';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Playlists: adicionar platform
DO $$ BEGIN
  ALTER TABLE playlists ADD COLUMN platform VARCHAR(16) DEFAULT 'spotify';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
```

### Modificar: `db.ts`
- `findOrCreateUser`: aceitar `"ytmusic"` como platform, usar coluna `ytmusic_channel_id`
- `linkPlatform`: aceitar `"ytmusic"`
- Novas queries:
  - `findTrackMapping(spotifyId?, youtubeId?, lastfmKey?)` — busca mapping
  - `createTrackMapping(spotifyId, youtubeId, lastfmKey, trackName, artistName, confidence)`
  - `getTracksWithoutSpotifyId(limit)` — tracks que têm lastfm_key ou youtube_id mas não spotify_id
  - `updateTrackSpotifyId(trackName, artistName, spotifyId)` — backfill
  - `savePlaylist`: aceitar campo `platform`

---

## Task 3: Backend — ytmusic client + rotas de auth

### Novo arquivo: `packages/backend/src/ytmusic.ts`
HTTP client pro ytmusic-service (mesmo padrão do `essentia.ts`):
- `getAuthSetup()` → `{ verification_url, user_code, device_code, interval }`
- `pollAuthToken(device_code)` → `{ token, refresh_token, channel_id }` ou null
- `refreshToken(refresh_token)` → novo token
- `getUserInfo(token)` → `{ channelId, name }`
- `getLikedSongs(token, limit?)` → tracks[]
- `getHistory(token, limit?)` → tracks[]
- `getTopTracks(token, lastfmUser?)` → tracks[] (sintético: liked + history + lastfm enrich)
- `searchTracks(token, query)` → tracks[]
- `getArtistInfo(token, channelId)` → artist info + top songs
- `createPlaylist(token, title, description)` → playlistId
- `addToPlaylist(token, playlistId, videoIds)` → void

### Novo arquivo: `packages/backend/src/routes/auth-ytmusic.ts`
- `GET /auth/ytmusic/setup` → retorna device code + URL
- `POST /auth/ytmusic/token` → polling do token (body: { device_code })
- `POST /auth/ytmusic/refresh` → refresh token

### Modificar: `packages/backend/src/config.ts`
- Adicionar `ytmusicServiceUrl` (default: `http://127.0.0.1:5002`)

### Modificar: `packages/backend/src/index.ts`
- Montar `ytmusicAuthRouter`
- Nos endpoints existentes:
  - `/api/search-tracks`: adicionar branch YT Music (header `X-YTMusic-Token`)
  - `/api/enqueue-track`: aceitar `ytmusic_` prefixed IDs
  - `/api/judge`: aceitar YT Music artists
  - `/api/analyze-taste`: buscar top tracks do YT Music
  - `/api/playlist/generate`: aceitar `platform` no body, criar no Spotify OU YT Music

---

## Task 4: Backfill de Spotify IDs

### Lógica (novo endpoint + job no auth callback)

Quando um usuário conecta Spotify (seja no login ou no Settings):
1. Buscar tracks no banco que não têm `spotify_id` (só `lastfm_*` ou `ytmusic_*`)
2. Pra cada batch de tracks (10 por vez), buscar no Spotify API: `searchTracks(token, "track:NAME artist:ARTIST")`
3. Se match exato (nome + artista case-insensitive), salvar o `spotify_id` no `track_features` e no `track_mapping`
4. Rate limit: max 50 buscas por conexão, rodar em background

### Modificar: `packages/backend/src/routes/auth.ts`
- Após OAuth callback bem-sucedido, fire-and-forget `backfillSpotifyIds(token)`

### Novo no `packages/backend/src/db.ts`:
- `getTracksWithoutSpotifyId(limit)` — WHERE spotify_id IS NULL OR spotify_id LIKE 'lastfm_%'
- `updateTrackSpotifyId(oldId, newSpotifyId)` — UPDATE track_features SET spotify_id = $2 WHERE spotify_id = $1

### Novo no `packages/backend/src/worker.ts` ou arquivo separado:
- `backfillSpotifyIds(token: string, limit = 50)` — busca e popula em background

---

## Task 5: Frontend — PlatformContext + Login

### Modificar: `PlatformContext.tsx`
Adicionar YT Music ao estado:
```typescript
interface PlatformState {
  spotifyToken: string;
  lastfmUser: string;
  ytmusicToken: string;  // NOVO
  userId: number | null;
}

// Novos helpers:
hasYTMusic: boolean;
setYTMusicToken: (token: string) => void;

// getHeaders() adiciona:
if (state.ytmusicToken) {
  headers["X-YTMusic-Token"] = state.ytmusicToken;
}
```

### Modificar: `useAuth.ts`
- `getAccessToken()`: checar `spotaste_ytmusic_token` também
- `clearAccessToken()`: limpar `spotaste_ytmusic_token`

### Modificar: `Login.tsx`
Adicionar terceiro card "Entrar com YouTube Music" (vermelho, ícone YT):
- Clica → chama `/auth/ytmusic/setup`
- Abre modal com URL + código
- Polling em `/auth/ytmusic/token` a cada `interval` seconds
- Quando token chega → salva em sessionStorage, navega pro Hub

### Novo componente: `DeviceCodeModal.tsx`
- Props: `{ url, code, onSuccess, onCancel }`
- Mostra URL e código grande pra copiar
- Polling interno até sucesso ou timeout (5 min)

### Modificar: `Sidebar.tsx`
- `SPOTIFY_ONLY` → `PLAYLIST_PLATFORMS` — habilitar se tem Spotify OU YT Music
- Playlist History: habilitar se tem Spotify OU YT Music

### Modificar: `Settings.tsx`
- Adicionar card YT Music (conectar/desconectar)
- Mesmo padrão do Spotify e Last.fm

---

## Task 6: Frontend — Text to Playlist (seletor de plataforma)

### Modificar: `TextToPlaylist.tsx`
Antes de gerar:
- Se tem só Spotify → cria no Spotify (sem UI extra)
- Se tem só YT Music → cria no YT Music (sem UI extra)
- Se tem ambos → mostra seletor: "Criar no Spotify" / "Criar no YouTube Music"
- Se não tem nenhum dos dois (só Last.fm) → mostra card pra conectar Spotify ou YT Music

No request pro backend:
- Adicionar `platform: "spotify" | "ytmusic"` no body
- Backend usa o token correspondente pra criar

### Modificar: `/api/playlist/generate` no backend
- Ler `platform` do body
- Se `"ytmusic"`: usar `ytmusic.createPlaylist()` + `ytmusic.addToPlaylist()`
- Na hora do matching, buscar `youtube_id` no `track_mapping` pras tracks selecionadas
- Se não tem `youtube_id`, tentar search no ytmusic-service por nome+artista

---

## Task 7: Frontend — Hub, Judge, Taste (YT Music data)

### Hub
- Se YT Music conectado, buscar top artists do YT Music (via top tracks → extract artists)
- Mostrar seção "Top Artistas (YouTube Music)" quando tem múltiplas plataformas
- Merge e dedup quando mostra "todos"

### Judge
- Funciona igual: manda artists array, backend gera roast
- Se YT Music + Last.fm: enriquecer com playcounts do Last.fm

### Taste Analysis
- Novo branch no backend: se tem `X-YTMusic-Token`, buscar top tracks do YT Music
- Enriquecer com Essentia features do banco
- Se Last.fm conectado: enriquecer com tags/playcounts

### Audio Analysis
- Search: adicionar branch YT Music na busca (`ytmusic.searchTracks`)
- IDs com prefixo `ytmusic_` seguem o mesmo padrão do `lastfm_`

---

## Task 8: ArtistModal + cross-platform links

### Modificar: `ArtistModal.tsx`
- Se YT Music conectado: buscar artist info via ytmusic-service
- Mostrar top tracks do YT Music
- Link pro YouTube Music (se disponível)

---

## Ordem de implementação

1. **ytmusic-service** (Docker + Flask + endpoints) — base de tudo
2. **Migration 005** + queries no db.ts
3. **Backend**: ytmusic.ts client + auth routes
4. **Frontend**: PlatformContext + Login + DeviceCodeModal
5. **Hub + Judge + Taste** — mostrar dados do YT Music
6. **Audio Analysis** — busca via YT Music
7. **Text to Playlist** — seletor de plataforma + criação no YT
8. **Backfill** — popular Spotify IDs quando usuário conecta
9. **Settings + Sidebar** — gerenciar conexões
10. **ArtistModal** — cross-platform enrichment

---

## Env vars novas
```
YTMUSIC_SERVICE_URL=http://127.0.0.1:5002
```

Não precisa de Google Client ID/Secret no backend — o ytmusicapi lida com OAuth internamente via TV device flow.

---

## Riscos e mitigações

| Risco | Mitigação |
|-------|-----------|
| ytmusicapi é API não-oficial | Microservice isolado, se quebrar não afeta Spotify/Last.fm |
| OAuth TV flow é estranho pro usuário | Modal claro com instruções, código grande pra copiar |
| Sem "top tracks" real no YT Music | Sintético via liked + history + Last.fm enrichment |
| Track matching cross-platform impreciso | Confidence score, só usa > 0.7, fallback pra search |
| Rate limits do YouTube | ytmusicapi não tem quota documentada, mas cachear resultados |
