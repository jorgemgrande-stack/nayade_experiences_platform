/**
 * Límite de peticiones por procedimiento tRPC real, también en lotes y con nombres codificados.
 * Adaptado de Skicenter (server/trpcRateLimit.test.ts, 7b03841c y bd86d5ed). Usa express-rate-limit real sobre
 * un servidor local efímero: sin BD ni servicios externos.
 */
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import rateLimit from "express-rate-limit";
import {
  FORM_PROCEDURES,
  UPLOAD_PROCEDURES,
  LOOKUP_PROCEDURES,
  MAX_LOOKUP_CALLS_PER_BATCH,
  classifyTrpcPath,
  createTrpcRateLimitMiddleware,
  isLeadProcedurePath,
} from "./_core/publicEndpointGuards";
import { createAuthGuardMiddleware } from "./authGuard";
import { appRouter } from "./routers";

const servers: http.Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
});

async function start(max: { form: number; upload: number; lookup: number }) {
  const limiter = (n: number) => rateLimit({ windowMs: 60_000, max: n, standardHeaders: true, legacyHeaders: false });
  const app = express();
  app.use("/api/trpc", createTrpcRateLimitMiddleware({ form: limiter(max.form), upload: limiter(max.upload), lookup: limiter(max.lookup) }));
  app.use("/api/trpc", (_req, res) => void res.json({ ok: true }));
  const server = app.listen(0);
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return async (p: string) => (await fetch(base + "/api/trpc/" + p)).status;
}

describe("clasificación por nombre real", () => {
  it("reconoce procedimientos sueltos, en lote y codificados", () => {
    expect(classifyTrpcPath("/public.submitLead")).toEqual({ form: 1, upload: 0, lookup: 0 });
    expect(classifyTrpcPath("/auth.me,public.submitLead,discounts.validate")).toEqual({ form: 1, upload: 0, lookup: 1 });
    expect(classifyTrpcPath("/public%2EsubmitLead")).toEqual({ form: 1, upload: 0, lookup: 0 });
    expect(classifyTrpcPath("/auth.me%2Cdiscounts.validate")).toEqual({ form: 0, upload: 0, lookup: 1 });
    expect(classifyTrpcPath("/ticketing.uploadCouponAttachment")).toEqual({ form: 0, upload: 1, lookup: 0 });
    expect(classifyTrpcPath("/public.getExperiences")).toEqual({ form: 0, upload: 0, lookup: 0 });
    expect(classifyTrpcPath("/%E0%A4%A")).toEqual({ form: 0, upload: 0, lookup: 0 }); // mal codificada: no rompe
  });

  it("isLeadProcedurePath sigue reconociendo formularios y subidas públicas", () => {
    expect(isLeadProcedurePath("/reservations.cartCheckout")).toBe(true);
    expect(isLeadProcedurePath("/a.b,ticketing.createSubmission")).toBe(true);
    expect(isLeadProcedurePath("/discounts.validate")).toBe(false);
  });

  it("las listas son procedimientos que existen y son públicos en Core", async () => {
    const procedures = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures;
    const guard = createAuthGuardMiddleware(true);
    for (const name of [FORM_PROCEDURES, UPLOAD_PROCEDURES, LOOKUP_PROCEDURES].flatMap((s) => Array.from(s))) {
      expect(procedures[name], name).toBeDefined();
      let passed = false;
      await guard({ url: `/api/trpc/${name}`, headers: {} } as any, { status: () => ({ json: () => undefined }) } as any, () => void (passed = true));
      // discounts.validate es público en la lista blanca; todos los demás también
      expect(passed, `${name} es público`).toBe(true);
    }
  });
});

describe("límite real", () => {
  it("un lote con 4 × discounts.validate → 429 aunque sea la primera petición", async () => {
    const get = await start({ form: 10, upload: 10, lookup: 10 });
    expect(MAX_LOOKUP_CALLS_PER_BATCH).toBe(3);
    expect(await get(Array(4).fill("discounts.validate").join(","))).toBe(429);
    expect(await get(Array(3).fill("discounts.validate").join(","))).toBe(200);
  });

  it("discounts.validate tiene su propio límite por IP", async () => {
    const get = await start({ form: 10, upload: 10, lookup: 2 });
    expect(await get("discounts.validate")).toBe(200);
    expect(await get("discounts.validate")).toBe(200);
    expect(await get("discounts.validate")).toBe(429);
    // No afecta a otras consultas públicas
    expect(await get("public.getExperiences")).toBe(200);
  });

  it("el nombre codificado o escondido en un lote no esquiva el límite", async () => {
    const get = await start({ form: 1, upload: 10, lookup: 10 });
    expect(await get("public.submitLead")).toBe(200);
    expect(await get("public%2EsubmitLead")).toBe(429);
    expect(await get("auth.me,public.submitLead")).toBe(429);
  });

  it("un lote con más de 3 formularios se rechaza", async () => {
    const get = await start({ form: 100, upload: 100, lookup: 100 });
    expect(await get(Array(4).fill("public.submitLead").join(","))).toBe(429);
  });
});
