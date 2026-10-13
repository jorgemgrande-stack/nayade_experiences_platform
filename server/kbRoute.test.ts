/**
 * Seguridad y regresión de /kb y /kb.json (públicos, sin autenticación).
 * Los "secretos" de estas pruebas son valores canario inventados: no son credenciales reales.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: new Map<unknown, unknown[]>(),
  whereTables: [] as unknown[],
}));

vi.mock("mysql2/promise", () => ({
  default: { createPool: () => ({}) },
  createPool: () => ({}),
}));

// Base de datos simulada: devuelve las filas registradas por tabla. Ignora el `where`
// a propósito (devuelve SIEMPRE todas las filas, incluidas las sensibles) para demostrar
// que el filtrado de la aplicación no depende de que la BD filtre.
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => ({
    select: () => ({
      from: (table: unknown) => {
        const rows = state.rows.get(table) ?? [];
        return Object.assign(Promise.resolve(rows), {
          where: () => {
            state.whereTables.push(table);
            return Promise.resolve(rows);
          },
        });
      },
    }),
  }),
}));

import { siteSettings, locations } from "../drizzle/schema";
import { kbRouter } from "./kbRoute";
import {
  KB_PUBLIC_SETTING_KEYS,
  isPublicKbSettingKey,
  pickPublicKbSettings,
} from "./kbPublicSettings";

const CANARY = {
  ghlApiKey: "CANARY_GHL_API_KEY_DO_NOT_LEAK",
  ghlLocationId: "CANARY_GHL_LOCATION_DO_NOT_LEAK",
  ghlInboxToken: "CANARY_INBOX_TOKEN_DO_NOT_LEAK",
  ghlInboxLocationId: "CANARY_INBOX_LOCATION_DO_NOT_LEAK",
  ghlInboxWebhookSecret: "CANARY_INBOX_WEBHOOK_SECRET_DO_NOT_LEAK",
  vapiApiKey: "CANARY_VAPI_KEY_DO_NOT_LEAK",
  vapiWebhookSecret: "CANARY_VAPI_WEBHOOK_SECRET_DO_NOT_LEAK",
  legalCompanyIban: "CANARY_IBAN_DO_NOT_LEAK",
  someFutureSecretSetting: "CANARY_FUTURE_SECRET_DO_NOT_LEAK",
};
const CANARY_VALUES = Object.values(CANARY);

const PUBLIC_ROWS = [
  { key: "company_name", value: "Empresa de Prueba", type: "text" },
  { key: "phone", value: "+34 600 000 000", type: "text" },
  { key: "faqs", value: "<p>Pregunta frecuente</p>", type: "text" },
  { key: "legalCompanyName", value: "Razón Social de Prueba S.L.", type: "text" },
];
const SENSITIVE_ROWS = Object.entries(CANARY).map(([key, value]) => ({ key, value, type: "text" }));

function handlerFor(path: string) {
  const layer = (kbRouter as any).stack.find((l: any) => l.route?.path === path);
  if (!layer) throw new Error(`ruta ${path} no registrada`);
  return layer.route.stack[0].handle as (req: unknown, res: unknown) => Promise<void>;
}

async function call(path: string) {
  const out: { status: number; headers: Record<string, string>; body: unknown } = {
    status: 200,
    headers: {},
    body: undefined,
  };
  const res = {
    setHeader: (k: string, v: string) => {
      out.headers[k.toLowerCase()] = v;
    },
    status(code: number) {
      out.status = code;
      return res;
    },
    json(b: unknown) {
      out.body = b;
      return res;
    },
    send(b: unknown) {
      out.body = b;
      return res;
    },
  };
  await handlerFor(path)({}, res);
  return out;
}

beforeEach(() => {
  state.rows.clear();
  state.whereTables.length = 0;
  state.rows.set(siteSettings, [...PUBLIC_ROWS, ...SENSITIVE_ROWS]);
  state.rows.set(locations, [
    { id: 1, name: "Sede Principal", address: "Calle Falsa 1", description: "<p>Sede</p>", isActive: true },
  ]);
});

describe("lista blanca de ajustes públicos", () => {
  it("ninguna clave de la lista blanca tiene aspecto de credencial", () => {
    for (const key of KB_PUBLIC_SETTING_KEYS) {
      expect(isPublicKbSettingKey(key), `la clave ${key} fue rechazada`).toBe(true);
    }
    const sensitive = /(token|secret|api[_-]?key|password|passwd|iban|webhook|credential|private)/i;
    expect(KB_PUBLIC_SETTING_KEYS.filter((k) => sensitive.test(k))).toEqual([]);
  });

  it("rechaza las claves conocidas de credenciales y datos bancarios", () => {
    for (const key of Object.keys(CANARY)) {
      expect(isPublicKbSettingKey(key), key).toBe(false);
    }
  });

  it("rechaza cualquier clave desconocida (la lista es explícita)", () => {
    expect(isPublicKbSettingKey("cualquier_clave_nueva")).toBe(false);
    expect(isPublicKbSettingKey("")).toBe(false);
  });

  it("pickPublicKbSettings devuelve solo claves permitidas y no vacías", () => {
    const picked = pickPublicKbSettings([
      ...PUBLIC_ROWS,
      ...SENSITIVE_ROWS,
      { key: "tagline", value: "" },
      { key: "about", value: null },
    ]);
    expect(Object.keys(picked).sort()).toEqual(
      ["company_name", "faqs", "legalCompanyName", "phone"].sort(),
    );
    expect(JSON.stringify(picked)).not.toMatch(/CANARY/);
  });
});

describe("GET /kb.json", () => {
  it("no expone credenciales ni datos bancarios aunque la BD los devuelva", async () => {
    const r = await call("/kb.json");
    expect(r.status).toBe(200);
    const serialized = JSON.stringify(r.body);
    for (const c of CANARY_VALUES) expect(serialized).not.toContain(c);
    for (const k of Object.keys(CANARY)) expect(serialized).not.toContain(`"${k}"`);
  });

  it("publica los ajustes públicos permitidos", async () => {
    const r = await call("/kb.json");
    const settings = (r.body as any).settings as Record<string, string>;
    expect(settings.company_name).toBe("Empresa de Prueba");
    expect(settings.phone).toBe("+34 600 000 000");
    expect(settings.legalCompanyName).toBe("Razón Social de Prueba S.L.");
    expect(Object.keys(settings).every((k) => isPublicKbSettingKey(k))).toBe(true);
  });

  it("restringe también la consulta a la BD (defensa en profundidad)", async () => {
    await call("/kb.json");
    expect(state.whereTables).toContain(siteSettings);
  });

  it("mantiene la forma de la respuesta para los consumidores", async () => {
    const r = await call("/kb.json");
    expect(Object.keys(r.body as object).sort()).toEqual(
      ["experiences", "generatedAt", "hotel", "locations", "packs", "settings", "spa"].sort(),
    );
    expect((r.body as any).locations[0]).toMatchObject({ name: "Sede Principal", address: "Calle Falsa 1" });
    expect(r.headers["cache-control"]).toContain("public");
  });
});

describe("GET /kb (texto)", () => {
  it("no expone credenciales ni datos bancarios aunque la BD los devuelva", async () => {
    const r = await call("/kb");
    expect(r.status).toBe(200);
    const text = String(r.body);
    for (const c of CANARY_VALUES) expect(text).not.toContain(c);
    expect(text).not.toMatch(/IBAN|WEBHOOK SECRET|API KEY|INBOX TOKEN/i);
  });

  it("sigue publicando la información general del negocio", async () => {
    const r = await call("/kb");
    const text = String(r.body);
    expect(text).toContain("COMPANY NAME: Empresa de Prueba");
    expect(text).toContain("PHONE: +34 600 000 000");
    expect(text).toContain("LEGALCOMPANYNAME: Razón Social de Prueba S.L.");
    expect(text).toContain("## INFORMACIÓN GENERAL");
    expect(text).toContain("Sede Principal");
  });
});
