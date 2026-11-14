/**
 * Ventanas emergentes: la apertura automática nunca se abre antes de saber si la web usa aviso de cookies ni, si lo
 * usa, antes de la decisión. Se simula con temporizadores falsos: el retardo se cumple, el tema carga tarde, el aviso
 * aparece tarde y la decisión llega después.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cookieGate, createAutoOpener } from "../client/src/lib/autoOpenGate";

const neutral = { neutralSite: true, analytics: null };

describe("puerta de cookies", () => {
  it("espera al tema, luego a la decisión, y se abre si no hay aviso", () => {
    const base = { theme: undefined, decided: false, bannerRoute: true };
    expect(cookieGate({ ...base, themeLoaded: false })).toBe("wait-theme");
    expect(cookieGate({ ...base, themeLoaded: true, theme: neutral })).toBe("wait-decision");
    expect(cookieGate({ ...base, themeLoaded: true, theme: undefined })).toBe("clear");
    expect(cookieGate({ ...base, themeLoaded: false, decided: true })).toBe("clear");
    expect(cookieGate({ ...base, themeLoaded: false, bannerRoute: false })).toBe("clear");
  });
});

describe("apertura automática con el aviso de cookies", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const s = { themeLoaded: false, theme: undefined as typeof neutral | undefined, decided: false };
    const open = vi.fn();
    const o = createAutoOpener({
      gate: () => cookieGate({ ...s, bannerRoute: true }),
      open,
      graceMs: 1200,
      later: (fn, ms) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      },
    });
    return { s, open, o };
  };

  it("red lenta: el retardo (3 s) se cumple antes que el tema y el aviso, y no se abre hasta la decisión", () => {
    const { s, open, o } = setup();
    setTimeout(() => o.trigger(), 3000);
    vi.advanceTimersByTime(3500);
    expect(open).not.toHaveBeenCalled(); // sin tema: no se sabe si hay aviso
    s.themeLoaded = true;
    s.theme = neutral;
    o.recheck(false); // el tema llega a los 3,5 s; el aviso aún no se ha pintado
    vi.advanceTimersByTime(5000);
    expect(open).not.toHaveBeenCalled(); // aviso presente o a punto de estarlo: sin decisión no se abre
    s.decided = true;
    o.recheck(); // «cookieConsentChanged»
    vi.advanceTimersByTime(1000);
    expect(open).not.toHaveBeenCalled(); // margen para que el aviso se cierre
    vi.advanceTimersByTime(300);
    expect(open).toHaveBeenCalledTimes(1);
    o.recheck();
    vi.advanceTimersByTime(5000);
    expect(open).toHaveBeenCalledTimes(1); // una sola vez
  });

  it("web sin aviso (el tema falla o la ruta no lo tiene): se abre en cuanto se sabe, sin margen", () => {
    const { s, open, o } = setup();
    o.trigger();
    expect(open).not.toHaveBeenCalled();
    s.themeLoaded = true; // sin tema útil → no hay aviso
    o.recheck(false);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("decisión previa: se abre al cumplirse el retardo, aunque el tema aún no haya cargado", () => {
    const { s, open, o } = setup();
    s.decided = true;
    setTimeout(() => o.trigger(), 3000);
    vi.advanceTimersByTime(2999);
    expect(open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("no se abre si la puerta se cierra durante el margen, ni tras disponer", () => {
    const { s, open, o } = setup();
    s.themeLoaded = true;
    s.theme = neutral;
    o.trigger();
    s.decided = true;
    o.recheck();
    s.decided = false; // p. ej. se borra la decisión
    vi.advanceTimersByTime(2000);
    expect(open).not.toHaveBeenCalled();
    s.decided = true;
    o.recheck();
    o.dispose();
    vi.advanceTimersByTime(2000);
    expect(open).not.toHaveBeenCalled();
  });
});
