/**
 * «Integraciones y pagos» para una pyme: agrupado por lo que quiere hacer, solo lo que le sirve, sin jerga y con
 * avisos de formato en español. La forma de guardar y cifrar no cambia (vault.ts sigue validando con validateFields).
 */
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PROVIDERS, getProvider, validateFields } from "./_core/credentials/catalog";
import { fieldProblems, integrationState, integrationVisible, panelIntegrations } from "./_core/credentials/presentation";
import { fieldFormatProblem, groupIntegrations, INTEGRATION_GROUPS } from "../shared/integrationsPanel";
import type { ProviderStatus } from "./_core/credentials/vault";

const ESSENTIAL = new Set(["crm-contacts", "crm-leads", "crm-quotes", "shop-catalog", "shop-checkout", "shop-orders", "bill-invoices", "bill-payments", "bill-cash", "comms-email", "admin-panel"]);
const essential = { licensed: true, can: (id: string) => ESSENTIAL.has(id) };

function status(id: string, set: Record<string, string> = {}, at = "2026-10-01T10:00:00.000Z"): ProviderStatus {
  const p = getProvider(id)!;
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    configured: Object.keys(set).length > 0,
    fields: p.fields.map((f) => ({
      key: f.key, label: f.label, secret: f.secret, required: !!f.required, options: f.options, hint: f.hint,
      set: f.key in set, display: f.key in set ? (f.secret ? "••••" + set[f.key].slice(-4) : set[f.key]) : null, updatedAt: f.key in set ? at : null,
    })),
  };
}
const all = (configured: Record<string, Record<string, string>> = {}) => PROVIDERS.map((p) => status(p.id, configured[p.id] ?? {}));

describe("qué integraciones ve una pyme Essential", () => {
  it("solo cobro con tarjeta y correo propio, agrupados por lo que quiere hacer", () => {
    const list = panelIntegrations(all(), essential);
    expect(list.map((p) => p.id)).toEqual(["redsys", "mail_smtp"]);
    expect(groupIntegrations(list).map((g) => g.title)).toEqual(["Cobrar con tarjeta", "Enviar correos"]);
  });

  it("lo heredado o sectorial queda oculto salvo que la empresa lo tenga configurado o contratado", () => {
    const ghl = getProvider("ghl")!;
    expect(integrationVisible(ghl, false, essential)).toBe(false);
    expect(integrationVisible(ghl, true, essential)).toBe(true);
    expect(integrationVisible(getProvider("meta")!, false, { licensed: false, can: () => true })).toBe(false);
    expect(integrationVisible(getProvider("vapi")!, false, essential)).toBe(false);
    expect(integrationVisible(getProvider("vapi")!, false, { licensed: true, can: (c) => c === "voice-ai" })).toBe(true);
    expect(integrationVisible(getProvider("imap_tpv")!, false, { licensed: true, can: (c) => c === "bank-import-pos" })).toBe(true);
    const withGhl = panelIntegrations(all({ ghl: { apiKey: "clave-de-prueba-123" } }), essential).map((p) => p.id);
    expect(withGhl).toContain("ghl");
  });

  it("cada integración pertenece a un grupo conocido", () => {
    const groups = new Set(INTEGRATION_GROUPS.map((g) => g.id));
    for (const p of PROVIDERS) expect(groups.has(p.panel.group), p.id).toBe(true);
  });
});

describe("textos sin jerga", () => {
  const JERGA = /\b(tenant|API|IMAP|SMTP|TLS|webhook|token|SHA-256|Location ID|Conversions API|true|false|test|production)\b/;

  it("lo que ve una pyme (títulos, resúmenes, etiquetas y opciones) no usa términos técnicos ni ingleses", () => {
    const list = panelIntegrations(all(), essential);
    for (const p of list) {
      expect(p.title + " " + p.summary, p.id).not.toMatch(JERGA);
      for (const f of p.fields) {
        expect(f.label, `${p.id}.${f.key}`).not.toMatch(JERGA);
        for (const o of f.options) expect(o.label, `${p.id}.${f.key}`).not.toMatch(JERGA);
      }
    }
  });

  it("todos los campos tienen nombre para el panel y los de las pymes, ayuda de dónde encontrarlos", () => {
    for (const p of PROVIDERS) for (const f of p.fields) expect(f.panel?.label, `${p.id}.${f.key}`).toBeTruthy();
    for (const p of panelIntegrations(all(), essential)) for (const f of p.fields) expect(f.help, `${p.id}.${f.key}`).toBeTruthy();
  });

  it("Redsys: «Modo pruebas / real», ayuda del banco; los Sí/No como interruptor", () => {
    const redsys = panelIntegrations(all(), essential).find((p) => p.id === "redsys")!;
    const env = redsys.fields.find((f) => f.key === "environment")!;
    expect(env.options.map((o) => o.label)).toEqual(["Modo pruebas (no se cobra)", "Modo real (cobros de verdad)"]);
    expect(env.options.map((o) => o.value)).toEqual(["test", "production"]);
    expect(redsys.fields.find((f) => f.key === "merchantCode")!.help).toContain("Te lo da tu banco al contratar el TPV virtual");
    const smtp = panelIntegrations(all(), essential).find((p) => p.id === "mail_smtp")!;
    const secure = smtp.fields.find((f) => f.key === "secure")!;
    expect(secure.control).toBe("yesno");
    expect(secure.options).toEqual([{ value: "true", label: "Sí" }, { value: "false", label: "No" }]);
  });

  it("el catálogo técnico no dice «tenant» en lo que hereda el panel", () => {
    expect(getProvider("redsys")!.description).not.toMatch(/tenant/);
  });
});

describe("validación de formatos en español", () => {
  const redsys = getProvider("redsys")!;

  it("el servidor avisa con el nombre del campo y qué hacer", () => {
    expect(fieldProblems(redsys, { merchantCode: "12AB" })).toEqual(["Número de comercio (FUC): Escribe solo cifras, entre 6 y 12, sin espacios ni letras."]);
    expect(fieldProblems(redsys, { merchantKey: "con espacios no vale" })[0]).toMatch(/^Clave secreta del comercio: /);
    expect(fieldProblems(redsys, { environment: "otro" })).toEqual(["Modo: elige una de las opciones."]);
    expect(fieldProblems(redsys, { merchantCode: "999008881", merchantTerminal: "1", environment: "test" })).toEqual([]);
    expect(fieldProblems(redsys, { merchantTerminal: "" })).toEqual([]);
  });

  it("acepta y rechaza exactamente lo mismo que la bóveda", () => {
    const samples: Array<[string, Record<string, string>]> = [
      ["redsys", { merchantCode: "1" }], ["redsys", { merchantCode: "999008881" }], ["redsys", { merchantKey: crypto.randomBytes(24).toString("base64") }],
      ["mail_smtp", { host: "smtp mal" }], ["mail_smtp", { fromEmail: "hola@empresa.es" }], ["mail_smtp", { secure: "si" }],
      ["imap_expenses", { port: "x" }], ["imap_expenses", { port: "993" }],
    ];
    for (const [id, values] of samples) expect(fieldProblems(getProvider(id)!, values).length > 0, `${id} ${JSON.stringify(values)}`).toBe(validateFields(getProvider(id)!, values).length > 0);
  });

  it("la página avisa antes de guardar con el mismo patrón", () => {
    const f = panelIntegrations(all(), essential).find((p) => p.id === "redsys")!.fields.find((x) => x.key === "merchantCode")!;
    expect(fieldFormatProblem(f, "abc")).toBe("Escribe solo cifras, entre 6 y 12, sin espacios ni letras.");
    expect(fieldFormatProblem(f, "999008881")).toBeNull();
    expect(fieldFormatProblem(f, "")).toBeNull();
    const yes = { control: "yesno" as const, options: [{ value: "true", label: "Sí" }, { value: "false", label: "No" }], pattern: null, formatMessage: null };
    expect(fieldFormatProblem(yes, "true")).toBeNull();
    expect(fieldFormatProblem(yes, "quizá")).toBe("Elige una de las opciones.");
  });
});

describe("estado: completa y funcionando", () => {
  const fields = (set: string[], at = "2026-10-01T10:00:00.000Z") =>
    [
      { label: "Modo", required: true, key: "environment" },
      { label: "Número de comercio (FUC)", required: true, key: "merchantCode" },
      { label: "Clave secreta del comercio", required: true, key: "merchantKey" },
    ].map((f) => ({ ...f, set: set.includes(f.key), updatedAt: set.includes(f.key) ? at : null }));
  const health = (connection: "connected" | "disconnected" | "error" | "not_checked", at: string | null, message = "") => ({ provider: "redsys", connection, stateAt: at, lastCheck: at ? { message } : null, lastSync: null });

  it("sin datos: desactivada; con datos a medias: dice qué falta", () => {
    expect(integrationState(fields([]), undefined).state).toBe("off");
    expect(integrationState(fields(["merchantCode"]), undefined)).toEqual({ state: "incomplete", detail: "Falta: Modo, Clave secreta del comercio." });
  });

  it("completa: sin comprobar hasta que una comprobación posterior al último cambio va bien o mal", () => {
    const full = ["environment", "merchantCode", "merchantKey"];
    expect(integrationState(fields(full), undefined).state).toBe("unchecked");
    expect(integrationState(fields(full), health("connected", "2026-10-02T10:00:00.000Z", "Datos correctos")).state).toBe("working");
    expect(integrationState(fields(full), health("disconnected", "2026-10-02T10:00:00.000Z", "Rechazadas")).state).toBe("failing");
    // Cambió los datos después de la última comprobación: hay que volver a comprobar
    expect(integrationState(fields(full, "2026-10-03T10:00:00.000Z"), health("connected", "2026-10-02T10:00:00.000Z")).state).toBe("unchecked");
  });

  it("la lista del panel lleva el estado y su texto", () => {
    const list = panelIntegrations(all({ redsys: { environment: "test", merchantCode: "999008881" } }), essential);
    const r = list.find((p) => p.id === "redsys")!;
    expect([r.state, r.stateLabel, r.stateDetail]).toEqual(["incomplete", "Faltan datos", "Falta: Clave secreta del comercio."]);
    expect(list.find((p) => p.id === "mail_smtp")!.stateLabel).toBe("Sin configurar (desactivada)");
  });
});

describe("página de Integraciones", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/admin/settings/Integrations.tsx"), "utf8");
  it("no pinta valores técnicos ni la jerga anterior", () => {
    expect(src).not.toMatch(/La cuenta es del propio tenant|configuración del servidor|>\s*\{o\}\s*</);
    expect(src).toContain("Integraciones y pagos");
  });
});
