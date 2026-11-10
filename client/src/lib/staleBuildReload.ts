/**
 * Pantalla abierta durante un despliegue: los ficheros de la versión anterior (las páginas que se cargan al navegar)
 * dejan de existir y al abrir una página nueva el navegador no la encuentra («vite:preloadError»). En lugar del aviso
 * de error, se recarga UNA vez para traer la versión nueva. Nunca en bucle: si vuelve a fallar enseguida (otra causa),
 * sin conexión o sin poder apuntar la recarga (almacenamiento bloqueado), se deja el error con su «Reintentar».
 */
export const STALE_RELOAD_KEY = "es-recarga-version";
/** Ventana en la que no se repite la recarga (evita bucles si el fallo no es por una versión antigua). */
export const STALE_RELOAD_WINDOW_MS = 60_000;

export function shouldReloadForStaleBuild(lastReloadAt: string | null, now: number): boolean {
  const last = lastReloadAt === null ? NaN : Number(lastReloadAt);
  return !Number.isFinite(last) || now - last < 0 || now - last >= STALE_RELOAD_WINDOW_MS;
}

type Store = Pick<Storage, "getItem" | "setItem">;
type Win = Pick<Window, "addEventListener" | "removeEventListener"> & { location: Pick<Location, "reload">; sessionStorage?: Store; navigator?: { onLine?: boolean } };

/** Instala la recarga única. Devuelve la función para quitarla (pruebas). */
export function installStaleBuildReload(win: Win, now: () => number = Date.now): () => void {
  const onError = (event: Event) => {
    // Sin conexión no es una versión antigua: recargar solo mostraría la página de «sin conexión» del navegador
    if (win.navigator?.onLine === false) return;
    let store: Store | null = null;
    try {
      store = win.sessionStorage ?? null;
    } catch {
      store = null;
    }
    // Sin poder apuntar la recarga no se recarga (si no, un fallo persistente recargaría sin fin)
    if (!store) return;
    try {
      if (!shouldReloadForStaleBuild(store.getItem(STALE_RELOAD_KEY), now())) return;
      store.setItem(STALE_RELOAD_KEY, String(now()));
    } catch {
      return;
    }
    event.preventDefault();
    win.location.reload();
  };
  win.addEventListener("vite:preloadError", onError);
  return () => win.removeEventListener("vite:preloadError", onError);
}
