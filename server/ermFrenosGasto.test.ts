/**
 * Frenos de gasto del Resource Manager sin cortar lo crítico: IA de la plataforma con límite real (texto, imagen y
 * audio), rutas de acceso y de cobro fuera de los límites de tasa, y avisos críticos fuera de la cuota diaria de correo.
 */
import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Metrics } from "./_core/metering";
import { MemoryUsageStore, UsageAggregator } from "./_core/erm/usage";
import { DEFAULT_QUOTAS, QuotaEngine } from "./_core/erm/quota";
import { TenantConcurrencyLimiter, TenantRateLimiter } from "./_core/erm/limiters";
import { isCriticalPath, tenantResourceGuard } from "./_core/erm/middleware";
import { ESTIMATED_COST_MODEL } from "./_core/erm/costs";
import { QuotaExceededError, type Quota, type QuotaPolicyReader } from "./_core/erm/types";
import { runWithTenant } from "./_core/tenant";
import { CRITICAL_MAIL_CATEGORIES } from "./mailer";

class Policy implements QuotaPolicyReader {
  quotas: Quota[] = [];
  async listQuotas(tenantId: string) {
    return this.quotas.filter((q) => q.tenantId === tenantId);
  }
}

afterEach(() => {
  delete process.env.TENANT_MODE;
});

describe("IA de la plataforma con límite real", () => {
  it("texto, imagen y audio tienen cuota mensual dura por defecto y su coste estimado", () => {
    for (const m of [Metrics.LLM_TOKENS_INPUT, Metrics.LLM_TOKENS_OUTPUT, Metrics.AI_IMAGES, Metrics.AI_AUDIO_SECONDS]) {
      const q = DEFAULT_QUOTAS.find((x) => x.metric === m);
      expect(q, m).toMatchObject({ period: "month", enforcement: "hard" });
      expect(ESTIMATED_COST_MODEL.rates.some((r) => r.metric === m), m).toBe(true);
    }
  });

  it("al agotar las imágenes del mes se bloquea la siguiente, solo en esa empresa", async () => {
    process.env.TENANT_MODE = "multi";
    const now = Date.UTC(2026, 9, 30, 12);
    const store = new MemoryUsageStore();
    const agg = new UsageAggregator(store, { now: () => now });
    const engine = new QuotaEngine(new Policy(), store, agg, { now: () => now, ttlMs: 0 });
    const limit = DEFAULT_QUOTAS.find((x) => x.metric === Metrics.AI_IMAGES)!.limit;
    agg.record({ tenantId: "a", metric: Metrics.AI_IMAGES, quantity: limit, unit: "image", at: now });
    await expect(engine.assert(Metrics.AI_IMAGES, 1, "a")).rejects.toBeInstanceOf(QuotaExceededError);
    await expect(engine.assert(Metrics.AI_IMAGES, 1, "b")).resolves.not.toThrow();
  });
});

describe("lo crítico no lo cortan los límites", () => {
  it("rutas de acceso, cobro y salud son críticas; el resto no", () => {
    for (const p of ["/healthz", "/readyz", "/api/auth/login", "/api/auth/reset-password", "/api/oauth/callback", "/api/redsys/notification", "/api/redsys/restaurant-notification"]) expect(isCriticalPath(p), p).toBe(true);
    for (const p of ["/api/trpc/products.list", "/api/redsys/form", "/api/authx", "/api/ghl/webhook"]) expect(isCriticalPath(p), p).toBe(false);
  });

  it("con la tasa agotada, el acceso y la notificación de cobro siguen respondiendo", async () => {
    process.env.TENANT_MODE = "multi";
    const store = new MemoryUsageStore();
    const policy = new Policy();
    policy.quotas = [{ tenantId: "t", metric: Metrics.HTTP_REQUEST, period: "minute", limit: 2, enforcement: "hard" }];
    const engine = new QuotaEngine(policy, store, new UsageAggregator(store), { defaults: [], ttlMs: 0 });
    const app = express();
    app.use((_req, _res, next) => runWithTenant("t", () => next()));
    app.use(tenantResourceGuard(engine, new TenantRateLimiter(), new TenantConcurrencyLimiter()));
    app.all("*", (_req, res) => res.send("ok"));
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const call = (path: string, method = "GET") =>
      new Promise<number>((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path, method }, (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        });
        req.on("error", reject);
        req.end();
      });
    try {
      const normal = [await call("/x"), await call("/x"), await call("/x")];
      expect(normal).toEqual([200, 200, 429]);
      expect(await call("/api/auth/login", "POST")).toBe(200);
      expect(await call("/api/redsys/notification", "POST")).toBe(200);
      expect(await call("/healthz")).toBe(200);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("los avisos de acceso, seguridad, cobro y obligaciones legales no los bloquea la cuota diaria de correo", () => {
    for (const c of ["password_reset", "security_notice", "email_verification", "user_invite", "payment_failed", "invoice_available", "withdrawal_receipt"] as const) expect(CRITICAL_MAIL_CATEGORIES.has(c), c).toBe(true);
    for (const c of ["marketing", "service_notice", "operational", "survey"] as const) expect(CRITICAL_MAIL_CATEGORIES.has(c), c).toBe(false);
  });
});
