export function getAccessToken(): string {
  return (
    sessionStorage.getItem("spotaste_spotify_token") ||
    sessionStorage.getItem("spotaste_token") ||
    ""
  );
}

export function clearAccessToken() {
  sessionStorage.removeItem("spotaste_spotify_token");
  sessionStorage.removeItem("spotaste_lastfm_user");
  sessionStorage.removeItem("spotaste_ytmusic_token");
  sessionStorage.removeItem("spotaste_user_id");
  sessionStorage.removeItem("spotaste_token");
}
