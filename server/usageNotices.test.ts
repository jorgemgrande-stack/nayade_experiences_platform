/**
 * Avisos de consumo a cada empresa (80 % / 100 % de un límite de su plan): solo a su propio contacto, una vez por
 * recurso, periodo y umbral, y solo a empresas en uso.
 */
import { describe, it, expect } from "vitest";
import { MemoryUsageStore, hourOf } from "./_core/erm/usage";
import type { DefaultQuota } from "./_core/erm/quota";
import { crmContactOf, formatUsageAmount, runUsageNotices, type UsageNotice } from "./commerce/usageNotices";
import { platformTemplates } from "./mail/templates";

const NOW = Date.UTC(2026, 9, 15, 10, 30);
const DEFAULTS: DefaultQuota[] = [
  { metric: "http.request", period: "minute", limit: 1200, enforcement: "hard" },
  { metric: "email.sent", period: "day", limit: 100, enforcement: "hard" },
  { metric: "llm.tokens.input", period: "month", limit: 1000, enforcement: "soft" },
];

async function setup() {
  const usage = new MemoryUsageStore();
  const h = hourOf(NOW);
  await usage.add([
    { tenantId: "cerca", metric: "email.sent", hourStart: h, quantity: 85 },
    { tenantId: "lleno", metric: "email.sent", hourStart: h, quantity: 120 },
    { tenantId: "lleno", metric: "llm.tokens.input", hourStart: h, quantity: 1500 },
    { tenantId: "calma", metric: "email.sent", hourStart: h, quantity: 3 },
    { tenantId: "suspendida", metric: "email.sent", hourStart: h, quantity: 500 },
    { tenantId: "sincontacto", metric: "email.sent", hourStart: h, quantity: 99 },
  ]);
  const tenants = [
    { id: "cerca", status: "active" },
    { id: "lleno", status: "trial" },
    { id: "calma", status: "active" },
    { id: "suspendida", status: "suspended" },
    { id: "sincontacto", status: "active" },
  ];
  const contacts: Record<string, string> = { cerca: "admin@cerca.example", lleno: "admin@lleno.example", calma: "admin@calma.example", suspendida: "admin@suspendida.example" };
  const sent: Array<{ to: string; n: UsageNotice }> = [];
  const run = () =>
    runUsageNotices({
      reader: { listTenants: async () => tenants },
      quotas: { listQuotas: async () => [] },
      usage,
      defaults: DEFAULTS,
      recipientOf: async (id) => contacts[id] ?? null,
      hostOf: async (id) => `${id}.plataforma.example`,
      notify: async (to, n) => void sent.push({ to, n }),
      now: NOW,
    });
  return { run, sent };
}

describe("avisos de consumo", () => {
  it("80 % y 100 %, a su propio contacto, solo empresas en uso; sin contacto se cuenta y no se envía", async () => {
    const { run, sent } = await setup();
    const r = await run();
    expect(r).toEqual({ checked: 4, notified: 3, withoutRecipient: 1 });
    const byTenant = (id: string) => sent.filter((s) => s.n.tenantId === id);
    expect(byTenant("cerca")).toEqual([
      expect.objectContaining({ to: "admin@cerca.example", n: expect.objectContaining({ label: "Correos enviados", level: "warning", used: "85", limit: "100", hard: true, host: "cerca.plataforma.example" }) }),
    ]);
    expect(byTenant("lleno").map((s) => [s.to, s.n.level, s.n.hard])).toEqual([
      ["admin@lleno.example", "exceeded", true],
      ["admin@lleno.example", "exceeded", false],
    ]);
    expect(byTenant("calma")).toEqual([]);
    expect(byTenant("suspendida")).toEqual([]);
    // Nunca el contacto de otra empresa
    for (const s of sent) expect(s.to).toBe(`admin@${s.n.tenantId}.example`);
  });

  it("clave estable por empresa, recurso, periodo, inicio del periodo y umbral (idempotente al repetir)", async () => {
    const { run, sent } = await setup();
    await run();
    const first = sent.map((s) => s.n.key);
    await run();
    expect(sent.slice(first.length).map((s) => s.n.key)).toEqual(first);
    expect(first[0]).toBe(`usage:cerca:email.sent:day:${Date.UTC(2026, 9, 15)}:80`);
    expect(first.some((k) => k.endsWith(":100"))).toBe(true);
  });

  it("cifras legibles", () => {
    expect(formatUsageAmount(15000, "tokens")).toBe("15.000 tokens");
    expect(formatUsageAmount(5 * 1024 ** 3, "bytes")).toBe("5 GB");
    expect(formatUsageAmount(1536, "bytes")).toBe("1,5 KB");
  });

  it("contacto principal de la única empresa del CRM enlazada a la plataforma", async () => {
    const data: Record<string, unknown[]> = {
      companies: [{ id: 7, tenantId: "cerca" }],
      contacts: [
        { companyId: 7, email: "otra@cerca.example", status: "active", isPrimary: false },
        { companyId: 7, email: "admin@cerca.example", status: "active", isPrimary: true },
      ],
    };
    const store = {
      list: async (kind: string, f: Record<string, unknown>) => (data[kind] ?? []).filter((x) => Object.entries(f).every(([k, v]) => (x as Record<string, unknown>)[k] === v)),
    };
    expect(await crmContactOf(store, "cerca")).toBe("admin@cerca.example");
    expect(await crmContactOf(store, "otra")).toBeNull();
  });

  it("plantilla: qué recurso, cuánto, qué pasa ahora y enlace al consumo", () => {
    const t = platformTemplates();
    const warn = t.usageThreshold({ label: "Correos enviados", periodLabel: "hoy", used: "85", limit: "100", level: "warning", hard: true, host: "cerca.plataforma.example" });
    expect(warn.subject).toContain("Estás cerca del límite");
    expect(warn.html).toContain("https://cerca.plataforma.example/admin/suscripcion/consumo");
    const full = t.usageThreshold({ label: "Correos enviados", periodLabel: "hoy", used: "120", limit: "100", level: "exceeded", hard: true, host: null });
    expect(full.subject).toContain("Has alcanzado el límite");
    expect(full.text).toContain("Hasta el próximo periodo no se puede usar más");
  });
});
