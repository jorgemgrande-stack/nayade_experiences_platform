/**
 * El alta de la newsletter funciona SIN sesión: va por la ruta REST pública `POST /api/newsletter/subscribe` (un visitante
 * no pasa por /api/trpc, que exige sesión salvo lista blanca). Aplicación Express real; servicio y bloque simulados.
 */
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NewsletterError } from "./newsletter/service";

const subscribe = vi.fn(async (_i: unknown) => undefined);
let block: Record<string, unknown> | null = { slug: "inicio", data: { successMessage: "Danke!", consentText: "Ich stimme zu." }, localized: null };

vi.mock("./newsletter/runtime", () => ({
  newsletterService: () => ({ subscribe }),
  unsubscribeSecrets: () => ["s"],
  ipSecret: () => "x".repeat(40),
}));
vi.mock("./pageBuilderDb", () => ({ getPublishedNewsletterBlock: async () => block }));

describe("newsletter · alta pública sin sesión (ruta REST)", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    const { createNewsletterPublicRouter } = await import("./newsletter/publicRoutes");
    const app = express();
    app.set("trust proxy", true); // cada petición de la prueba llega con su propia IP (el límite por visitante es por IP)
    app.use(express.json());
    app.use(createNewsletterPublicRouter());
    await new Promise<void>((ok) => (server = app.listen(0, "127.0.0.1", ok)));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

  let n = 0;
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/newsletter/subscribe`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.0.${Math.floor(++n / 250)}.${n % 250}`, origin: base, referer: `${base}/`, ...headers }, body: JSON.stringify(body) });
  const ok = { slug: "inicio", blockId: "b1", email: "persona@sintetico.invalid", consent: true, website: "", elapsedMs: 5000, locale: "de", page: "/" };

  it("un visitante sin cookie ni sesión se inscribe: 200 y el mensaje del bloque", async () => {
    const r = await post(ok);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, message: "Danke!" });
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe.mock.calls[0][0]).toMatchObject({ email: "persona@sintetico.invalid", consent: true, locale: "de", source: "web:inicio" });
  });
  it("campo trampa o relleno demasiado rápido: misma respuesta, sin inscribir", async () => {
    subscribe.mockClear();
    expect((await post({ ...ok, website: "http://spam" })).status).toBe(200);
    expect((await post({ ...ok, elapsedMs: 200 })).status).toBe(200);
    expect(subscribe).not.toHaveBeenCalled();
  });
  it("origen ajeno: 403 en el idioma del visitante", async () => {
    const r = await post(ok, { origin: "https://otra-web.example", referer: "https://otra-web.example/" });
    expect(r.status).toBe(403);
    expect((await r.json()).error).toContain("Formular");
  });
  it("bloque no publicado: 404 con mensaje alemán, no español", async () => {
    block = null;
    const r = await post(ok);
    block = { slug: "inicio", data: { successMessage: "Danke!", consentText: "Ich stimme zu." }, localized: null };
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe("Dieses Formular ist nicht mehr verfügbar.");
  });
  it("correo no válido o sin consentimiento: 400 en alemán; fallo interno: 412 con mensaje de error del idioma", async () => {
    subscribe.mockRejectedValueOnce(new NewsletterError("invalid_input", "invalid_email"));
    const a = await post(ok);
    expect(a.status).toBe(400);
    expect((await a.json()).error).toBe("Bitte gib eine gültige E-Mail-Adresse ein.");
    subscribe.mockRejectedValueOnce(new NewsletterError("no_consent", "no_consent"));
    expect((await (await post(ok)).json()).error).toBe("Um dich anzumelden, musst du der Einwilligung zustimmen.");
    subscribe.mockRejectedValueOnce(new NewsletterError("unavailable", "x"));
    const c = await post({ ...ok, locale: "en" });
    expect(c.status).toBe(412);
    expect((await c.json()).error).toBe("We could not complete your subscription. Please try again in a few minutes.");
  });
  it("cuerpo inválido: 400 sin error interno", async () => {
    expect((await post({ slug: "" })).status).toBe(400);
  });
});
