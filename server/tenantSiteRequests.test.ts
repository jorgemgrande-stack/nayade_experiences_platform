/**
 * Web de cada empresa: una consulta no contratada no puede tumbar las públicas. Detectado en la validación real del CMS
 * en live (23/10/2026): la petición agrupada «public.getTheme,config.getPublicSettings» respondía 403 a una empresa sin
 * la capacidad admin-panel y su web quedaba en blanco.
 */
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { capabilityForProcedure, capabilityRouteGuard } from "./_core/capabilities/routeGuard";
import type { CapabilityAccess } from "./_core/capabilities/access";

vi.mock("./_core/ops/log", () => ({ opsLog: () => undefined }));
vi.mock("./_core/ops/failureAlerts", () => ({ recordFailure: () => undefined }));

/** Empresa con solo las capacidades CMS de Essential (sin admin-panel). */
const cmsOnly = { check: async (cap: string) => ({ allowed: cap.startsWith("cms-"), reason: `Capacidad no contratada: ${cap}`, status: null }) } as unknown as CapabilityAccess;

function run(url: string) {
  const res = { statusCode: 200, status(c: number) { this.statusCode = c; return this; }, json: vi.fn() };
  const next = vi.fn();
  return capabilityRouteGuard(() => cmsOnly)({ url, method: "GET" } as Request, res as unknown as Response, next).then(() => ({ status: res.statusCode, next: next.mock.calls.length }));
}

describe("consultas públicas de la web de cada empresa", () => {
  it("los ajustes públicos no exigen la capacidad del panel; el resto de config sí", () => {
    expect(capabilityForProcedure("config.getPublicSettings")).toBeUndefined();
    expect(capabilityForProcedure("config.getSettings")).toBe("admin-panel");
  });

  it("la petición que fallaba en live pasa sin admin-panel", async () => {
    expect(await run("/public.getTheme,config.getPublicSettings?batch=1&input=%7B%7D")).toEqual({ status: 200, next: 1 });
  });

  it("una consulta no contratada sigue rechazándose (sola)", async () => {
    expect((await run("/config.getSettings?input=%7B%7D")).status).toBe(403);
  });

  it("en la web de cada empresa el cliente no agrupa consultas; con una sola empresa, sí", () => {
    const main = fs.readFileSync(new URL("../client/src/main.tsx", import.meta.url), "utf8");
    expect(main).toContain("links: [isTenantSite() ? httpLink(linkOptions) : httpBatchLink(linkOptions)]");
  });
});
