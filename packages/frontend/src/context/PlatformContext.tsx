import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";

interface PlatformState {
  spotifyToken: string;
  lastfmUser: string;
  userId: number | null;
}

interface PlatformContextType extends PlatformState {
  setSpotifyToken: (token: string) => void;
  setLastfmUser: (username: string) => void;
  setUserId: (id: number) => void;
  isLoggedIn: boolean;
  hasSpotify: boolean;
  hasLastfm: boolean;
  hasBoth: boolean;
  logout: () => void;
  getHeaders: () => Record<string, string>;
}

const PlatformContext = createContext<PlatformContextType | null>(null);

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlatformState>(() => ({
    spotifyToken:
      sessionStorage.getItem("spotaste_spotify_token") ||
      sessionStorage.getItem("spotaste_token") ||
      "",
    lastfmUser: sessionStorage.getItem("spotaste_lastfm_user") || "",
    userId: sessionStorage.getItem("spotaste_user_id")
      ? Number(sessionStorage.getItem("spotaste_user_id"))
      : null,
  }));

  const setSpotifyToken = useCallback((token: string) => {
    sessionStorage.setItem("spotaste_spotify_token", token);
    sessionStorage.setItem("spotaste_token", token);
    setState((s) => ({ ...s, spotifyToken: token }));
  }, []);

  const setLastfmUser = useCallback((username: string) => {
    sessionStorage.setItem("spotaste_lastfm_user", username);
    setState((s) => ({ ...s, lastfmUser: username }));
  }, []);

  const setUserId = useCallback((id: number) => {
    sessionStorage.setItem("spotaste_user_id", String(id));
    setState((s) => ({ ...s, userId: id }));
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem("spotaste_spotify_token");
    sessionStorage.removeItem("spotaste_lastfm_user");
    sessionStorage.removeItem("spotaste_user_id");
    sessionStorage.removeItem("spotaste_token");
    setState({ spotifyToken: "", lastfmUser: "", userId: null });
  }, []);

  const isLoggedIn = !!(state.spotifyToken || state.lastfmUser);
  const hasSpotify = !!state.spotifyToken;
  const hasLastfm = !!state.lastfmUser;
  const hasBoth = hasSpotify && hasLastfm;

  const getHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (state.spotifyToken) {
      headers["Authorization"] = `Bearer ${state.spotifyToken}`;
    }
    if (state.lastfmUser) {
      headers["X-Lastfm-User"] = state.lastfmUser;
    }
    if (state.userId) {
      headers["X-User-Id"] = String(state.userId);
    }
    return headers;
  }, [state]);

  return (
    <PlatformContext.Provider
      value={{
        ...state,
        setSpotifyToken,
        setLastfmUser,
        setUserId,
        isLoggedIn,
        hasSpotify,
        hasLastfm,
        hasBoth,
        logout,
        getHeaders,
      }}
    >
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform() {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error("usePlatform must be inside PlatformProvider");
  return ctx;
}
