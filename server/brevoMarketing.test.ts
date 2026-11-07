/**
 * Elephant Connect · Brevo marketing: plan de sincronización (consentimiento, bajas, cambio de correo, tope), cliente
 * HTTP con tope de llamadas y medición, y servicio completo contra un Brevo SIMULADO (ninguna llamada real): conexión,
 * lista, consentimiento con prueba, sincronización con bajas, errores, reintento controlado, una ejecución a la vez,
 * job desactivado sin licencia o sin sincronización automática y desconexión. Proveedor separado del correo.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PROVIDERS, getProvider, validateFields } from "./_core/credentials/catalog";
import { testProvider } from "./_core/credentials/testers";
import { TRPC_ROUTER_CAPABILITIES } from "./_core/capabilities/routeGuard";
import { BrevoBudgetExceeded, BrevoMarketingClient, type FetchLike } from "./brevoMarketing/client";
import { MAX_CONTACTS_PER_RUN, checkGrant, normalizeEmail, planSync } from "./brevoMarketing/plan";
import { BrevoMarketingService } from "./brevoMarketing/service";
import { MemoryBrevoMarketingStore, RunInProgress } from "./brevoMarketing/store";

// Prefijo de claves de Brevo construido en ejecución: los valores de prueba no deben parecer claves reales (gitleaks)
const FAKE_PREFIX = ["xkey", "sib-"].join("");

/** Brevo simulado: listas, contactos de cada lista con sus bajas y registro de llamadas. */
class FakeBrevo {
  calls: string[] = [];
  key = FAKE_PREFIX + "buena-clave-de-pruebas-123456";
  lists = new Map<number, { name: string; contacts: Map<string, { blacklisted: boolean; unsub: boolean }> }>([[7, { name: "Clientes", contacts: new Map() }]]);
  failNext: number | null = null;
  fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const path = u.pathname.replace("/v3", "");
    this.calls.push(`${init.method} ${path}`);
    const reply = (status: number, body: unknown = {}) => ({ ok: status < 300, status, json: async () => body });
    if (init.headers["api-key"] !== this.key) return reply(401);
    if (this.failNext) {
      const s = this.failNext;
      this.failNext = null;
      return reply(s);
    }
    if (path === "/account") return reply(200, { email: "cuenta@empresa.test", companyName: "Empresa de pruebas" });
    if (path === "/contacts/lists") return reply(200, { lists: Array.from(this.lists.entries()).map(([id, l]) => ({ id, name: l.name, totalSubscribers: l.contacts.size })), count: this.lists.size });
    const one = /^\/contacts\/lists\/(\d+)$/.exec(path);
    if (one) {
      const l = this.lists.get(Number(one[1]));
      return l ? reply(200, { id: Number(one[1]), name: l.name }) : reply(404);
    }
    const cs = /^\/contacts\/lists\/(\d+)\/contacts$/.exec(path);
    if (cs) {
      const l = this.lists.get(Number(cs[1]))!;
      const off = Number(u.searchParams.get("offset"));
      const all = Array.from(l.contacts.entries());
      return reply(200, { contacts: all.slice(off, off + 500).map(([email, c]) => ({ email, emailBlacklisted: c.blacklisted, listUnsubscribed: c.unsub ? [Number(cs[1])] : [] })), count: all.length });
    }
    if (path === "/contacts/import") {
      const b = JSON.parse(init.body!);
      for (const c of b.jsonBody) this.lists.get(b.listIds[0])!.contacts.set(c.email, this.lists.get(b.listIds[0])!.contacts.get(c.email) ?? { blacklisted: false, unsub: false });
      return reply(202, { processId: 1 });
    }
    const rm = /^\/contacts\/lists\/(\d+)\/contacts\/remove$/.exec(path);
    if (rm) {
      for (const e of JSON.parse(init.body!).emails) this.lists.get(Number(rm[1]))!.contacts.delete(e);
      return reply(201, {});
    }
    return reply(404);
  };
  emails(listId = 7) {
    return Array.from(this.lists.get(listId)!.contacts.keys()).sort();
  }
}

describe("proveedor y plan", () => {
  it("brevo_marketing es un proveedor propio de la empresa, separado del correo de la plataforma, con prueba de solo lectura", async () => {
    const p = getProvider("brevo_marketing")!;
    expect(p.panel).toMatchObject({ group: "marketing", requires: ["email-campaigns"] });
    expect(p.fields.map((f) => [f.key, f.secret, f.env])).toEqual([["apiKey", true, undefined]]);
    expect(PROVIDERS.some((x) => x.fields.some((f) => f.env === "BREVO_API_KEY"))).toBe(false);
    expect(validateFields(p, { apiKey: "otra-cosa" })).toEqual(["apiKey: formato no válido"]);
    const brevo = new FakeBrevo();
    expect(await testProvider("brevo_marketing", { apiKey: brevo.key }, brevo.fetch as never)).toMatchObject({ ok: true, outcome: "connected" });
    expect(await testProvider("brevo_marketing", { apiKey: FAKE_PREFIX + "mala-clave-0000000000000000" }, brevo.fetch as never)).toMatchObject({ ok: false, outcome: "rejected" });
    expect(brevo.calls).toEqual(["GET /account", "GET /account"]);
    expect(TRPC_ROUTER_CAPABILITIES.brevoMarketing).toBe("email-campaigns");
  });

  it("plan: solo con consentimiento y correo válido; las bajas de Brevo mandan; cambio de correo; sin duplicados", () => {
    const prev = new Map([
      [3, { email: "antes@x.test", status: "synced" as const }],
      [4, { email: "d@x.test", status: "synced" as const }],
    ]);
    const plan = planSync(
      [
        { clientId: 1, email: " A@X.test ", name: "Ana María", consent: "granted" },
        { clientId: 2, email: "b@x.test", name: null, consent: null },
        { clientId: 3, email: "nuevo@x.test", name: "Cris", consent: "granted" },
        { clientId: 4, email: "d@x.test", name: "Dani", consent: "withdrawn" },
        { clientId: 5, email: "baja@x.test", name: "Eva", consent: "granted" },
        { clientId: 6, email: "a@x.test", name: "Duplicado", consent: "granted" },
        { clientId: 7, email: "no-es-correo", name: "Fede", consent: "granted" },
      ],
      prev,
      new Set(["baja@x.test"]),
    );
    expect(plan.toImport).toEqual([
      { clientId: 1, email: "a@x.test", firstName: "Ana" },
      { clientId: 3, email: "nuevo@x.test", firstName: "Cris" },
    ]);
    expect(plan.toRemove).toEqual([
      { clientId: 3, email: "antes@x.test" },
      { clientId: 4, email: "d@x.test" },
    ]);
    expect(plan.unsubscribed).toEqual([{ clientId: 5, email: "baja@x.test" }]);
    expect(plan.skipped).toBe(2);
    const many = Array.from({ length: 12 }, (_, i) => ({ clientId: i + 1, email: `c${i}@x.test`, name: null, consent: "granted" as const }));
    expect(planSync(many, new Map(), new Set(), 10)).toMatchObject({ truncated: true });
    expect(MAX_CONTACTS_PER_RUN).toBeGreaterThan(0);
    expect(normalizeEmail("x@y")).toBeNull();
    expect(() => checkGrant("form", "no")).toThrow(/prueba/);
    expect(() => checkGrant("presunto", "Formulario web 12/2026")).toThrow(/Origen/);
  });

  it("cliente: tope de llamadas por ejecución", async () => {
    const brevo = new FakeBrevo();
    const c = new BrevoMarketingClient(brevo.key, { fetch: brevo.fetch, maxCalls: 2 });
    await c.account();
    await c.lists();
    await expect(c.account()).rejects.toBeInstanceOf(BrevoBudgetExceeded);
    expect(c.callsMade).toBe(2);
  });
});

describe("servicio contra Brevo simulado", () => {
  let brevo: FakeBrevo;
  let store: MemoryBrevoMarketingStore;
  let key: string | null;
  let licensed: boolean;
  let svc: BrevoMarketingService;
  const make = (o: { maxCalls?: number; maxContacts?: number } = {}) =>
    new BrevoMarketingService({
      store,
      credentials: { apiKey: async () => key, clear: async () => void (key = null) },
      licensed: async () => licensed,
      fetch: brevo.fetch,
      ...o,
    });

  beforeEach(() => {
    brevo = new FakeBrevo();
    store = new MemoryBrevoMarketingStore();
    store.clientRows = [
      { id: 1, name: "Ana Uno", email: "ana@cliente.test" },
      { id: 2, name: "Bea Dos", email: "bea@cliente.test" },
      { id: 3, name: "Sin Consentimiento", email: "sin@cliente.test" },
    ];
    key = null;
    licensed = true;
    svc = make();
  });

  it("sin clave la integración está desactivada: no se llama a Brevo", async () => {
    await expect(svc.lists()).rejects.toMatchObject({ code: "not_configured" });
    expect(await svc.runScheduled()).toEqual({ skipped: "auto_sync_off" });
    expect(brevo.calls).toEqual([]);
    expect((await svc.status()).connected).toBe(false);
  });

  it("recorrido: probar, elegir lista, consentimiento con prueba, sincronizar, bajas de Brevo y retirada en el CRM", async () => {
    key = brevo.key;
    expect(await svc.testConnection()).toEqual({ ok: true, account: "Empresa de pruebas" });
    expect((await svc.lists()).map((l) => l.name)).toEqual(["Clientes"]);
    await expect(svc.chooseList(99, "u")).rejects.toMatchObject({ code: "not_found" });
    expect((await svc.chooseList(7, "u")).listName).toBe("Clientes");
    await expect(svc.grantConsent(1, "form", "", "u")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.grantConsent(9, "form", "Formulario web", "u")).rejects.toMatchObject({ code: "not_found" });
    await svc.grantConsent(1, "form", "Casilla del formulario de reserva v2", "user:1");
    await svc.grantConsent(2, "in_person", "Hoja firmada en tienda", "user:1");
    expect(await svc.preview()).toEqual({ toExport: 2, toRemove: 0, skipped: 0, truncated: false });

    const r1 = await svc.sync("manual", "user:1");
    expect(r1).toMatchObject({ status: "completed", exported: 2, removed: 0, apiCalls: 2 });
    expect(brevo.emails()).toEqual(["ana@cliente.test", "bea@cliente.test"]);
    expect(brevo.emails()).not.toContain("sin@cliente.test");

    // Bea se da de baja en Brevo y Ana retira el consentimiento en el CRM
    brevo.lists.get(7)!.contacts.set("bea@cliente.test", { blacklisted: false, unsub: true });
    await svc.withdrawConsent(1, "Lo pidió por teléfono", "user:1");
    const r2 = await svc.sync("manual", "user:1");
    expect(r2).toMatchObject({ status: "completed", exported: 0, removed: 1, unsubscribed: 1 });
    expect(brevo.emails()).toEqual(["bea@cliente.test"]);
    expect((await store.consent(2))!).toMatchObject({ status: "withdrawn", source: "brevo_unsubscribe" });
    expect((await svc.consentLog(2)).map((l) => `${l.previousStatus}>${l.newStatus}:${l.source}`)).toEqual(["null>granted:in_person", "granted>withdrawn:brevo_unsubscribe"]);
    // Una baja no se revierte sola: ya no se vuelve a exportar
    const r3 = await svc.sync("manual", "user:1");
    expect(r3).toMatchObject({ exported: 0, removed: 0 });
  });

  it("errores: clave rechazada → fallida y sin reintento; tope de llamadas → parcial y reintento controlado", async () => {
    key = brevo.key;
    await svc.chooseList(7, "u");
    await svc.grantConsent(1, "form", "Formulario web", "u");
    key = FAKE_PREFIX + "revocada-000000000000000000";
    const bad = await svc.sync("manual", "u");
    expect(bad).toMatchObject({ status: "failed", errorMessage: "Brevo rechaza la clave API" });
    await expect(svc.retry(bad.id, "u")).rejects.toMatchObject({ code: "rejected" });
    key = brevo.key;
    const tight = make({ maxCalls: 1 });
    const partial = await tight.sync("manual", "u");
    expect(partial).toMatchObject({ status: "partial", apiCalls: 1 });
    expect(partial.errorMessage).toMatch(/Tope de 1 llamadas/);
    await expect(svc.retry(bad.id, "u")).rejects.toThrow(/última/);
    const again = await svc.retry(partial.id, "u");
    expect(again).toMatchObject({ status: "completed", trigger: "retry", retryOf: partial.id, exported: 1 });
    await expect(svc.retry(again.id, "u")).rejects.toThrow(/terminó bien/);
    // Un error puntual de Brevo en un lote deja la ejecución parcial y el contacto marcado
    await svc.grantConsent(2, "form", "Formulario web", "u");
    brevo.failNext = null;
    const flaky: FetchLike = async (url, init) => (url.endsWith("/contacts/import") ? { ok: false, status: 400, json: async () => ({}) } : brevo.fetch(url, init));
    const r = await new BrevoMarketingService({ store, credentials: { apiKey: async () => key, clear: async () => undefined }, fetch: flaky }).sync("manual", "u");
    expect(r).toMatchObject({ status: "partial", errors: 2 });
    expect((await svc.clients("bea"))[0]).toMatchObject({ syncStatus: "error", lastError: "Brevo respondió 400" });
  });

  it("una ejecución a la vez; una «en curso» antigua se da por caída", async () => {
    key = brevo.key;
    await svc.chooseList(7, "u");
    const id = await store.startRun("manual", 7, "u", null);
    await expect(svc.sync("manual", "u")).rejects.toBeInstanceOf(RunInProgress);
    store._ageRun(id, new Date(Date.now() - 31 * 60_000));
    expect((await svc.sync("manual", "u")).status).toBe("completed");
    expect((await store.run(id))!.status).toBe("failed");
  });

  it("job: solo con licencia, sincronización automática, lista y clave; desconectar lo apaga y conserva el historial", async () => {
    key = brevo.key;
    await svc.chooseList(7, "u");
    await svc.grantConsent(1, "form", "Formulario web", "u");
    expect(await svc.runScheduled()).toEqual({ skipped: "auto_sync_off" });
    await svc.setAutoSync(true, "u");
    licensed = false;
    expect(await svc.runScheduled()).toEqual({ skipped: "not_licensed" });
    licensed = true;
    expect(await svc.runScheduled()).toEqual({});
    expect((await svc.runs())[0]).toMatchObject({ trigger: "job", status: "completed", exported: 1 });
    const st = await svc.disconnect("u");
    expect(st).toMatchObject({ connected: false, autoSync: false, listId: null });
    expect(await svc.runScheduled()).toEqual({ skipped: "auto_sync_off" });
    expect((await svc.runs()).length).toBe(1);
    expect((await store.consent(1))!.status).toBe("granted");
    await expect(svc.setAutoSync(true, "u")).rejects.toMatchObject({ code: "conflict" });
  });
});
