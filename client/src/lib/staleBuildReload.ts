/**
 * Pantalla abierta durante un despliegue: los ficheros de la versión anterior (las páginas que se cargan al navegar)
 * dejan de existir y al abrir una página nueva el navegador no la encuentra («vite:preloadError»). En lugar del aviso
 * de error, se recarga UNA vez para traer la versión nueva. Si vuelve a fallar enseguida (otra causa), no se recarga
 * en bucle: se deja el error con su botón de «Reintentar».
 */
export const STALE_RELOAD_KEY = "es-recarga-version";
/** Ventana en la que no se repite la recarga (evita bucles si el fallo no es por una versión antigua). */
export const STALE_RELOAD_WINDOW_MS = 60_000;

export function shouldReloadForStaleBuild(lastReloadAt: string | null, now: number): boolean {
  const last = lastReloadAt === null ? NaN : Number(lastReloadAt);
  return !Number.isFinite(last) || now - last < 0 || now - last >= STALE_RELOAD_WINDOW_MS;
}

type Store = Pick<Storage, "getItem" | "setItem">;

/** Instala la recarga única. Devuelve la función para quitarla (pruebas). */
export function installStaleBuildReload(win: Pick<Window, "addEventListener" | "removeEventListener"> & { location: Pick<Location, "reload">; sessionStorage?: Store }, now: () => number = Date.now): () => void {
  const onError = (event: Event) => {
    let store: Store | null = null;
    try {
      store = win.sessionStorage ?? null;
    } catch {
      store = null;
    }
    let last: string | null = null;
    try {
      last = store?.getItem(STALE_RELOAD_KEY) ?? null;
    } catch {
      last = null;
    }
    if (!shouldReloadForStaleBuild(last, now())) return;
    try {
      store?.setItem(STALE_RELOAD_KEY, String(now()));
    } catch {
      // sin almacenamiento: se recarga igualmente (una sola vez por carga de página)
    }
    event.preventDefault();
    win.location.reload();
  };
  win.addEventListener("vite:preloadError", onError);
  return () => win.removeEventListener("vite:preloadError", onError);
}
