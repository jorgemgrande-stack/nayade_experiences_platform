/** Despacho de avisos desde el entorno: apagado sin fecha; fecha ISO o ms; un valor no válido impide arrancar. */
import { describe, it, expect } from "vitest";
import { notificationsFromEnv } from "./notifications/config";

describe("configuración del despacho de avisos", () => {
  it("sin CP_NOTIFICATIONS_SINCE no se despacha; ISO o ms; otro valor no arranca", () => {
    expect(notificationsFromEnv({})).toBeUndefined();
    expect(notificationsFromEnv({ CP_NOTIFICATIONS_SINCE: " " })).toBeUndefined();
    expect(notificationsFromEnv({ CP_NOTIFICATIONS_SINCE: "2026-10-21T00:00:00Z" })).toEqual({ since: Date.UTC(2026, 9, 21) });
    expect(notificationsFromEnv({ CP_NOTIFICATIONS_SINCE: "1792540800000" })).toEqual({ since: 1792540800000 });
    expect(() => notificationsFromEnv({ CP_NOTIFICATIONS_SINCE: "mañana" })).toThrow(/no es una fecha válida/);
  });
});
