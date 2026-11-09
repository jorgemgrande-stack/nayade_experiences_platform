/**
 * Pantalla antigua abierta durante un despliegue: al no encontrar la página de la versión anterior se recarga una sola
 * vez (nunca en bucle) para traer la versión nueva.
 */
import { describe, expect, it, vi } from "vitest";
import { STALE_RELOAD_KEY, STALE_RELOAD_WINDOW_MS, installStaleBuildReload, shouldReloadForStaleBuild } from "../client/src/lib/staleBuildReload";

function fakeWindow() {
  const listeners = new Map<string, (e: Event) => void>();
  const data = new Map<string, string>();
  const win = {
    addEventListener: (t: string, l: (e: Event) => void) => listeners.set(t, l),
    removeEventListener: (t: string) => listeners.delete(t),
    location: { reload: vi.fn() },
    sessionStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) },
  };
  const fire = () => {
    const e = { preventDefault: vi.fn() } as unknown as Event;
    listeners.get("vite:preloadError")?.(e);
    return e as unknown as { preventDefault: ReturnType<typeof vi.fn> };
  };
  return { win, fire, data, listeners };
}

describe("recarga tras un despliegue", () => {
  it("recarga una vez y no vuelve a hacerlo dentro de la ventana", () => {
    let now = 1_000_000;
    const { win, fire, data } = fakeWindow();
    installStaleBuildReload(win as never, () => now);
    const first = fire();
    expect(first.preventDefault).toHaveBeenCalled();
    expect(win.location.reload).toHaveBeenCalledTimes(1);
    expect(data.get(STALE_RELOAD_KEY)).toBe(String(now));
    now += 5_000;
    const second = fire();
    expect(second.preventDefault).not.toHaveBeenCalled();
    expect(win.location.reload).toHaveBeenCalledTimes(1);
    now += STALE_RELOAD_WINDOW_MS;
    fire();
    expect(win.location.reload).toHaveBeenCalledTimes(2);
  });

  it("valores raros del almacenamiento no bloquean la recarga", () => {
    expect(shouldReloadForStaleBuild(null, 10)).toBe(true);
    expect(shouldReloadForStaleBuild("x", 10)).toBe(true);
    expect(shouldReloadForStaleBuild(String(20), 10)).toBe(true);
  });

  it("se puede quitar", () => {
    const { win, listeners } = fakeWindow();
    const off = installStaleBuildReload(win as never);
    expect(listeners.has("vite:preloadError")).toBe(true);
    off();
    expect(listeners.has("vite:preloadError")).toBe(false);
  });
});
