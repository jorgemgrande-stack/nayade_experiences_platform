export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/**
 * Devuelve la URL de login según el modo de autenticación:
 *  - LOCAL_AUTH=true  → /login?returnTo=<returnPath>  (auth propia)
 *  - Por defecto       → Manus OAuth portal
 */
export const isLocalAuth = (): boolean => {
  // VITE_LOCAL_AUTH se inyecta desde el servidor vía Vite define o meta.env
  // Si VITE_OAUTH_PORTAL_URL no está configurado, asumimos modo local
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL ?? "";
  const localAuthFlag = import.meta.env.VITE_LOCAL_AUTH ?? "";
  return localAuthFlag === "true" || !oauthPortalUrl;
};

export const getLoginUrl = (returnPath = "/") => {
  if (isLocalAuth()) {
    // Modo local: formulario propio en /login
    return `/login${returnPath !== "/" ? `?returnTo=${encodeURIComponent(returnPath)}` : ""}`;
  }

  // Modo Manus OAuth
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(JSON.stringify({ origin: window.location.origin, returnPath }));

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};
