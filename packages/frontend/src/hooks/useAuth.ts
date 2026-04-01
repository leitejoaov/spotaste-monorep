export function getAccessToken(): string {
  return sessionStorage.getItem("spotaste_token") || "";
}

export function clearAccessToken(): void {
  sessionStorage.removeItem("spotaste_token");
}
