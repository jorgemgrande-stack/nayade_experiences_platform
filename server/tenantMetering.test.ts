/**
 * Interfaces preparatorias: contexto de tenant, registro de acceso a datos y medición.
 * Verifican que (1) el comportamiento actual (modo single) no cambia y (2) el modo multi
 * falla de forma segura y aísla los tenants.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";

const created = vi.hoisted(() => ({ uris: [] as string[], pools: [] as any[] }));

vi.mock("mysql2/promise", () => {
  const createPool = (opts: { uri: string }) => {
    created.uris.push(opts.uri);
    const pool = { __uri: opts.uri, end: vi.fn(async () => undefined) };
    created.pools.push(pool);
    return pool;
  };
  return { default: { createPool }, createPool };
});
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: (pool: { __uri: string }) => ({ __pool: pool }),
}));

import {
  DEFAULT_TENANT_ID,
  TenantResolutionError,
  getTenantId,
  getTenantIdOrDefault,
  isValidTenantId,
  runWithTenant,
} from "./_core/tenant";
import {
  _resetRegistryForTests,
  closeAllDatabases,
  getTenantDatabase,
  setConnectionResolver,
} from "./_core/dbRegistry";
import { InMemoryMeterSink, Metrics, measure, meter, setMeterSink } from "./_core/metering";
import { requestMeter, routeGroup } from "./_core/requestMeter";

const ENV = { ...process.env };
beforeEach(() => {
  created.uris.length = 0;
  created.pools.length = 0;
  _resetRegistryForTests();
  setMeterSink(null);
  delete process.env.TENANT_MODE;
  process.env.DATABASE_URL = "mysql://u:p@db-single.invalid:3306/app";
});
afterEach(() => {
  process.env = { ...ENV };
  setMeterSink(null);
});

describe("contexto de tenant", () => {
  it("en modo single el tenant por defecto es 'default'", () => {
    expect(getTenantId()).toBe(DEFAULT_TENANT_ID);
  });

  it("runWithTenant fija el tenant y lo restaura al salir", () => {
    expect(runWithTenant("acme", () => getTenantId())).toBe("acme");
    expect(getTenantId()).toBe(DEFAULT_TENANT_ID);
  });

  it("el tenant se mantiene a través de operaciones asíncronas y no se mezcla", async () => {
    const run = (id: string, ms: number) =>
      runWithTenant(id, async () => {
        await new Promise((r) => setTimeout(r, ms));
        return getTenantId();
      });
    const out = await Promise.all([run("uno", 30), run("dos", 5), run("tres", 15)]);
    expect(out).toEqual(["uno", "dos", "tres"]);
  });

  it("rechaza identificadores no válidos", () => {
    for (const bad of ["", "A", "con espacios", "../x", "a;drop", "x".repeat(64), "-ab"]) {
      expect(isValidTenantId(bad), bad).toBe(false);
      expect(() => runWithTenant(bad, () => 1)).toThrow(TenantResolutionError);
    }
    expect(isValidTenantId("cliente-1_a")).toBe(true);
  });

  it("en modo multi, una operación sin tenant lanza (fallo seguro)", () => {
    process.env.TENANT_MODE = "multi";
    expect(() => getTenantId()).toThrow(TenantResolutionError);
    expect(getTenantIdOrDefault()).toBe("unresolved");
    expect(runWithTenant("acme", () => getTenantId())).toBe("acme");
  });
});

describe("registro de acceso a datos", () => {
  it("modo single: misma base de datos para cualquier tenant y un único pool", async () => {
    const a = await getTenantDatabase();
    const b = await getTenantDatabase("otro");
    const c = await runWithTenant("acme", () => getTenantDatabase());
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(created.uris).toEqual(["mysql://u:p@db-single.invalid:3306/app"]);
  });

  it("llamadas simultáneas en frío comparten un único pool (sin carrera)", async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => getTenantDatabase()));
    expect(new Set(results).size).toBe(1);
    expect(created.uris).toHaveLength(1);
  });

  it("modo multi: la creación simultánea de un mismo tenant también comparte pool", async () => {
    process.env.TENANT_MODE = "multi";
    setConnectionResolver(async (t) => `mysql://u:p@db-${t}.invalid:3306/${t}`);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => runWithTenant("acme", () => getTenantDatabase())),
    );
    expect(new Set(results).size).toBe(1);
    expect(created.uris).toHaveLength(1);
  });

  it("modo single sin DATABASE_URL devuelve null (como getDb hoy)", async () => {
    delete process.env.DATABASE_URL;
    expect(await getTenantDatabase()).toBeNull();
    expect(created.uris).toHaveLength(0);
  });

  it("modo multi: cada tenant obtiene su propio pool y se reutiliza", async () => {
    process.env.TENANT_MODE = "multi";
    setConnectionResolver((t) => `mysql://u:p@db-${t}.invalid:3306/${t}`);
    const a1 = await runWithTenant("acme", () => getTenantDatabase());
    const b1 = await runWithTenant("beta", () => getTenantDatabase());
    const a2 = await runWithTenant("acme", () => getTenantDatabase());
    expect(a1).not.toBe(b1);
    expect(a1).toBe(a2);
    expect(created.uris).toEqual([
      "mysql://u:p@db-acme.invalid:3306/acme",
      "mysql://u:p@db-beta.invalid:3306/beta",
    ]);
  });

  it("modo multi: sin tenant, sin resolvedor o con tenant desconocido, falla (nunca usa otra BD)", async () => {
    process.env.TENANT_MODE = "multi";
    await expect(getTenantDatabase()).rejects.toThrow(TenantResolutionError);
    await expect(runWithTenant("acme", () => getTenantDatabase())).rejects.toThrow(/resolvedor/);

    setConnectionResolver(async () => null);
    await expect(runWithTenant("fantasma", () => getTenantDatabase())).rejects.toThrow(/desconocido/);
    // DATABASE_URL (single) nunca se usa como respaldo en multi
    expect(created.uris).toHaveLength(0);
  });

  it("closeAllDatabases cierra los pools y permite recrearlos", async () => {
    await getTenantDatabase();
    await closeAllDatabases();
    expect(created.pools[0].end).toHaveBeenCalled();
    await getTenantDatabase();
    expect(created.pools).toHaveLength(2);
  });
});

describe("medición", () => {
  it("por defecto no hace nada y nunca lanza", () => {
    expect(() => meter("x", 1)).not.toThrow();
  });

  it("registra eventos con el tenant actual y metadatos", () => {
    const sink = new InMemoryMeterSink();
    setMeterSink(sink);
    runWithTenant("acme", () => meter(Metrics.EMAIL_SENT, 1, "count", { channel: "smtp" }));
    meter(Metrics.EMAIL_SENT);
    expect(sink.events).toHaveLength(2);
    expect(sink.events[0]).toMatchObject({ tenantId: "acme", metric: "email.sent", quantity: 1, unit: "count" });
    expect(sink.events[0].meta).toEqual({ channel: "smtp" });
    expect(sink.events[1].tenantId).toBe(DEFAULT_TENANT_ID);
  });

  it("un destino que falla no rompe la operación medida", () => {
    setMeterSink({
      record() {
        throw new Error("destino roto");
      },
    });
    expect(() => meter("x", 1)).not.toThrow();
  });

  it("ignora cantidades no finitas", () => {
    const sink = new InMemoryMeterSink();
    setMeterSink(sink);
    meter("x", Number.NaN);
    meter("x", Infinity);
    expect(sink.events).toHaveLength(0);
  });

  it("measure registra la duración y propaga resultado y errores", async () => {
    const sink = new InMemoryMeterSink();
    setMeterSink(sink);
    await expect(measure("job", async () => 42)).resolves.toBe(42);
    await expect(measure("job", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(sink.events.map((e) => e.meta?.ok)).toEqual([true, false]);
    expect(sink.events.every((e) => e.unit === "ms")).toBe(true);
  });

  it("el tenant no aparece como identificador de usuario ni datos personales en los eventos", () => {
    const sink = new InMemoryMeterSink();
    setMeterSink(sink);
    meter(Metrics.STORAGE_WRITE_BYTES, 10, "byte", { backend: "local" });
    expect(JSON.stringify(sink.events)).not.toMatch(/@|email|phone/i);
  });
});

describe("enganches de medición", () => {
  it("storagePut registra los bytes escritos", async () => {
    process.env.LOCAL_STORAGE_PATH = path.join(os.tmpdir(), "elephant-meter-test");
    const { storagePut } = await import("./storage");
    const sink = new InMemoryMeterSink();
    setMeterSink(sink);
    await storagePut("meter-test/a.txt", Buffer.from("hola mundo"), "text/plain");
    const ev = sink.events.find((e) => e.metric === Metrics.STORAGE_WRITE_BYTES);
    expect(ev).toBeTruthy();
    expect(ev!.quantity).toBe(10);
    expect(ev!.unit).toBe("byte");
  });

  it("sendEmail registra un envío con su canal", async () => {
    delete process.env.BREVO_API_KEY;
    delete process.env.SMTP_HOST;
    const { sendEmail } = await import("./mailer");
    const sink = new InMemoryMeterSink();
    setMeterSink(sink);
    await sendEmail({ to: "persona@example.invalid", subject: "x", html: "<p>x</p>" } as any);
    const ev = sink.events.find((e) => e.metric === Metrics.EMAIL_SENT);
    expect(ev).toBeTruthy();
    expect(ev!.meta?.channel).toBe("smtp");
  });
});

describe("requestMeter", () => {
  it("agrupa por familia de ruta (baja cardinalidad)", () => {
    expect(routeGroup("/api/trpc/crm.leads.list?batch=1")).toBe("trpc");
    expect(routeGroup("/api/ghl/templates")).toBe("ghl");
    expect(routeGroup("/api/upload/image")).toBe("upload");
    expect(routeGroup("/api/invoices/preview?n=FAC-1")).toBe("api");
    expect(routeGroup("/experiencias/slug-largo-123")).toBe("web");
  });

  it("registra recuento, duración y estado de cada petición", async () => {
    const sink = new InMemoryMeterSink();
    setMeterSink(sink);
    const app = express();
    app.use(requestMeter);
    app.get("/api/trpc/x", (_req, res) => res.status(404).send("no"));
    const server = await new Promise<http.Server>((r) => {
      const s = app.listen(0, "127.0.0.1", () => r(s));
    });
    const port = (server.address() as AddressInfo).port;
    await new Promise<void>((resolve, reject) => {
      http.get({ host: "127.0.0.1", port, path: "/api/trpc/x?batch=1" }, (res) => {
        res.resume();
        res.on("end", () => resolve());
      }).on("error", reject);
    });
    await new Promise<void>((r) => server.close(() => r()));
    // "finish" se emite justo después de cerrar la respuesta
    await new Promise((r) => setTimeout(r, 20));
    const req = sink.events.find((e) => e.metric === Metrics.HTTP_REQUEST);
    expect(req?.meta).toEqual({ group: "trpc", method: "GET", status: "4xx" });
    expect(sink.events.some((e) => e.metric === Metrics.HTTP_REQUEST_MS)).toBe(true);
    // Ninguna etiqueta contiene la ruta completa ni parámetros
    expect(JSON.stringify(sink.events)).not.toContain("batch=1");
  });
});
