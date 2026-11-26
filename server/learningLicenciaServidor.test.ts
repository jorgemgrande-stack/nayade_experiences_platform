/**
 * Elephant Academy (Learning) · exigencia de licencia en servidor: matriz de puntos de entrada.
 * Sin base de datos: dobles en memoria (MemoryEntitlementStore, servidor Express efímero, módulos simulados con vi.mock).
 * Las pruebas con MySQL real de Learning (`learning*.mysql.test.ts`) no se tocan. Ver docs/academy/licencia-servidor.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { ModuleRegistry } from "./_core/modules/registry";
import { MemoryEntitlementStore, ModuleAccess } from "./_core/modules/entitlements";
import { LEARNING_ENFORCE_ENV, LEARNING_STUDENT_PROCEDURES, learningLicenseGuard, moduleRouteGuard } from "./_core/modules/routeGuard";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { runWithTenant } from "./_core/tenant";

const sweepSpy = vi.fn(async () => ({ quotes: 0, granted: 0, needsTerms: 0, orders: 0 }));
let currentAccess: ModuleAccess;

vi.mock("./learningFlow", () => ({ sweepLearningGrants: () => sweepSpy() }));
vi.mock("./learningDb", () => ({ isMissingLearningSchema: () => false }));
vi.mock("./_core/modules/runtime", async (orig) => ({ ...(await orig<typeof import("./_core/modules/runtime")>()), getModuleAccess: () => currentAccess }));

function buildAccess(store: MemoryEntitlementStore): ModuleAccess {
  const reg = new ModuleRegistry("1.0.0");
  BUILTIN_MODULES.forEach((m) => reg.register(m));
  return new ModuleAccess(reg, store);
}

const store = new MemoryEntitlementStore();
beforeEach(() => {
  process.env.TENANT_MODE = "multi";
  sweepSpy.mockClear();
  currentAccess = buildAccess(store);
});
afterEach(() => {
  delete process.env.TENANT_MODE;
  delete process.env[LEARNING_ENFORCE_ENV];
  store.setFailing(false);
  for (const t of ["quantum", "con", "otra", "ex"]) store.revoke(t, "learning");
});

const dump = async (t: string) => JSON.stringify(await store.listEntitlements(t));

async function serve(mount: (app: express.Express, access: ModuleAccess) => void) {
  const app = express();
  app.use((req, _res, next) => runWithTenant(String(req.headers["x-test-tenant"] ?? "quantum"), () => next()));
  mount(app, currentAccess);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const call = (path: string, tenant: string, method = "GET") =>
    new Promise<number>((resolve, reject) => {
      const rq = http.request({ host: "127.0.0.1", port, path, method, headers: { "x-test-tenant": tenant } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); });
      rq.on("error", reject);
      rq.end();
    });
  return { call, close: async () => { server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); } };
}
const trpcServer = () => serve((app, a) => { app.use("/api/trpc", moduleRouteGuard(() => a)); app.use("/api/trpc", (_q, r) => r.json({ ok: true })); });
const expressServer = () => serve((app, a) => { app.use("/api/learning", learningLicenseGuard(() => a)); app.use("/api/learning", (_q, r) => r.json({ ok: true })); });
const grant = (tenantId: string, extra: Record<string, unknown> = {}) => {
  store.grant({ tenantId, moduleId: "learning", validUntil: null, source: "operator", ...extra } as never);
  currentAccess = buildAccess(store);
};

// Procedimientos del alumno, leídos del router: si alguien añade uno nuevo, esta matriz lo ve
const routerSrc = readFileSync(new URL("./routers/learning.ts", import.meta.url), "utf8");
const myStart = routerSrc.indexOf("const my = router({");
const myEnd = routerSrc.indexOf("router({", myStart + 20);
const myBlock = routerSrc.slice(myStart, myEnd > 0 ? myEnd : undefined);
const myProcs = Array.from(myBlock.matchAll(/^  (\w+): protectedProcedure/gm)).map((m) => `learning.my.${m[1]}`);

describe("a) guarda apagada = comportamiento actual en todos los puntos de entrada", () => {
  it("tRPC: aula, administración y ampliaciones responden igual con o sin licencia", async () => {
    const s = await trpcServer();
    for (const p of [...myProcs, "learning.admin.enrollments", "learning.admin.revoke", "learning.admin.editor.publish", "learning.admin.sweep"]) {
      expect(await s.call(`/api/trpc/${p}`, "otra"), p).toBe(200);
    }
    await s.close();
  });
  it("Express: recursos, vista previa, subida y materiales pasan igual", async () => {
    const s = await expressServer();
    for (const [p, m] of [["/api/learning/resource/1", "GET"], ["/api/learning/preview/resource/1", "GET"], ["/api/learning/upload/1", "POST"], ["/api/learning/materials/1/stage", "POST"], ["/api/learning/preview/file/1", "GET"]] as const) {
      expect(await s.call(p, "otra", m), p).toBe(200);
    }
    await s.close();
  });
  it("barrido y ganchos: corren igual y el interruptor apagado no consulta la licencia (ni aunque el origen falle)", async () => {
    store.setFailing(true);
    const { runLearningSweep } = await import("./learningSweepJob");
    const { learningLicensed } = await import("./learningLicense");
    await runWithTenant("otra", async () => {
      expect(await learningLicensed()).toBe(true);
      expect(await runLearningSweep()).toEqual({ quotes: 0, granted: 0, needsTerms: 0, orders: 0 });
    });
    expect(sweepSpy).toHaveBeenCalledTimes(1);
  });
  it("modo single (instalación de Náyade): tampoco se bloquea nada", async () => {
    process.env.TENANT_MODE = "single";
    const { learningLicensed } = await import("./learningLicense");
    expect(await learningLicensed()).toBe(true);
  });
});

describe("b) guarda encendida: sin licencia / con licencia / derecho heredado de Quantum", () => {
  beforeEach(() => { process.env[LEARNING_ENFORCE_ENV] = "1"; });

  it("tRPC: administración y ampliaciones exigen licencia (403 sin ella, 200 con ella)", async () => {
    grant("con");
    const s = await trpcServer();
    const gated = ["learning.admin.enrollments", "learning.admin.revoke", "learning.admin.grantForOrder", "learning.admin.sweep", "learning.admin.editor.publish", "learning.admin.materials.publish", "learning.my.startExtension"];
    for (const p of gated) {
      expect(await s.call(`/api/trpc/${p}`, "otra"), `${p} sin licencia`).toBe(403);
      expect(await s.call(`/api/trpc/${p}`, "con"), `${p} con licencia`).toBe(200);
    }
    // Un lote que mezcla aula y administración exige licencia (basta un procedimiento no permitido)
    expect(await s.call("/api/trpc/learning.my.courses,learning.admin.enrollments?batch=1", "otra")).toBe(403);
    await s.close();
  });

  it("Express: vista previa, subida y materiales exigen licencia", async () => {
    grant("con");
    const s = await expressServer();
    for (const [p, m] of [["/api/learning/preview/resource/1", "GET"], ["/api/learning/upload/1", "POST"], ["/api/learning/materials/1/stage", "POST"], ["/api/learning/preview/file/1", "GET"]] as const) {
      expect(await s.call(p, "otra", m), `${p} sin`).toBe(403);
      expect(await s.call(p, "con", m), `${p} con`).toBe(200);
    }
    await s.close();
  });

  it("barrido: no opera sobre una empresa sin licencia y sí sobre la que la tiene", async () => {
    grant("con");
    const { runLearningSweep } = await import("./learningSweepJob");
    expect(await runWithTenant("otra", () => runLearningSweep())).toEqual({ skipped: "sin_licencia" });
    expect(sweepSpy).not.toHaveBeenCalled();
    await runWithTenant("con", () => runLearningSweep());
    expect(sweepSpy).toHaveBeenCalledTimes(1);
  });

  it("barrido: si la licencia no se puede verificar, se cierra (no concede)", async () => {
    grant("con");
    store.setFailing(true);
    const { runLearningSweep } = await import("./learningSweepJob");
    expect(await runWithTenant("con", () => runLearningSweep())).toEqual({ skipped: "sin_licencia" });
    expect(sweepSpy).not.toHaveBeenCalled();
  });

  it("derecho heredado de Quantum: su entitlement concedido a mano basta y la guarda NO modifica ningún dato", async () => {
    grant("quantum");
    const before = await dump("quantum");
    const { learningLicensed } = await import("./learningLicense");
    const t = await trpcServer();
    const e = await expressServer();
    expect(await t.call("/api/trpc/learning.admin.enrollments", "quantum")).toBe(200);
    expect(await e.call("/api/learning/upload/1", "quantum", "POST")).toBe(200);
    expect(await runWithTenant("quantum", () => learningLicensed())).toBe(true);
    await t.close();
    await e.close();
    expect(await dump("quantum")).toBe(before);
  });

  it("licencia suspendida o caducada = sin licencia (administración cerrada)", async () => {
    grant("ex", { validUntil: new Date(Date.now() - 1000) });
    grant("con", { status: "suspended" });
    const t = await trpcServer();
    expect(await t.call("/api/trpc/learning.admin.enrollments", "ex")).toBe(403);
    expect(await t.call("/api/trpc/learning.admin.enrollments", "con")).toBe(403);
    await t.close();
  });

  it("ganchos de comercio: solo conceden tras learningLicensed(); reembolsos y disputas NO se condicionan", () => {
    const shop = readFileSync(new URL("./shopOrdersDb.ts", import.meta.url), "utf8");
    const ed = readFileSync(new URL("./editionsDb.ts", import.meta.url), "utf8");
    const port = readFileSync(new URL("./paymentsConnect/shopPort.ts", import.meta.url), "utf8");
    expect(shop).toMatch(/learningLicensed\(\)\) await \(await import\("\.\/learningFlow"\)\)\.grantLearningFromOrder/);
    expect(ed).toMatch(/learningLicensed\(\)\) await safeGrantAfterConfirm/);
    expect(port).not.toContain("learningLicense");
    expect(readFileSync(new URL("./learningFlow.ts", import.meta.url), "utf8")).not.toContain("learningLicense");
  });
});

describe("c) aislamiento entre empresas", () => {
  beforeEach(() => { process.env[LEARNING_ENFORCE_ENV] = "1"; });
  it("la licencia de A no abre B (tRPC, Express y barrido)", async () => {
    grant("con");
    const t = await trpcServer();
    const e = await expressServer();
    expect(await t.call("/api/trpc/learning.admin.enrollments", "con")).toBe(200);
    expect(await t.call("/api/trpc/learning.admin.enrollments", "otra")).toBe(403);
    expect(await e.call("/api/learning/upload/1", "otra", "POST")).toBe(403);
    await t.close();
    await e.close();
    const { learningLicensed } = await import("./learningLicense");
    expect(await runWithTenant("otra", () => learningLicensed())).toBe(false);
    expect(await runWithTenant("con", () => learningLicensed())).toBe(true);
  });
  it("el recurso se autoriza contra la BD de la empresa en curso: la ruta no acepta tenant del cliente", () => {
    const routes = readFileSync(new URL("./learningRoutes.ts", import.meta.url), "utf8");
    expect(routes).toMatch(/authorizeResource\(Number\(user\.id\), Number\(idText\)\)/);
    expect(routes).not.toMatch(/req\.(query|body|headers)[^;]*tenant/i);
  });
});

describe("d) alumno matriculado de una empresa que pierde la licencia (derechos adquiridos)", () => {
  beforeEach(() => { process.env[LEARNING_ENFORCE_ENV] = "1"; });
  it("política: el alumno sigue viendo su aula y abriendo sus recursos; la gestión y la venta se cierran", async () => {
    // «otra» = empresa que perdió (o nunca tuvo) la licencia
    const t = await trpcServer();
    const e = await expressServer();
    for (const p of ["courses", "course", "lesson", "progress", "activate"]) expect(await t.call(`/api/trpc/learning.my.${p}`, "otra"), p).toBe(200);
    expect(await t.call("/api/trpc/learning.my.startExtension", "otra")).toBe(403);
    expect(await t.call("/api/trpc/learning.admin.extend", "otra")).toBe(403);
    expect(await e.call("/api/learning/resource/7", "otra")).toBe(200);
    expect(await e.call("/api/learning/resource/7", "otra", "POST")).toBe(403);
    expect(await e.call("/api/learning/resource/7/x", "otra")).toBe(403);
    await t.close();
    await e.close();
  });
  it("las concesiones nuevas se cierran, las protecciones del alumno (reembolso/disputa) no pasan por la guarda", async () => {
    const { learningLicensed } = await import("./learningLicense");
    expect(await runWithTenant("otra", () => learningLicensed())).toBe(false);
    expect(readFileSync(new URL("./paymentsConnect/shopPort.ts", import.meta.url), "utf8")).toContain("changeLearningAccessForOrder");
  });
  it("la lista del alumno es explícita: todo `learning.my.*` nuevo queda cerrado hasta clasificarlo", () => {
    expect(myProcs.length).toBeGreaterThanOrEqual(6);
    expect(myProcs.filter((p) => LEARNING_STUDENT_PROCEDURES.has(p)).sort()).toEqual(["learning.my.activate", "learning.my.course", "learning.my.courses", "learning.my.lesson", "learning.my.progress"]);
    expect(myProcs.filter((p) => !LEARNING_STUDENT_PROCEDURES.has(p))).toEqual(["learning.my.startExtension"]);
    for (const p of Array.from(LEARNING_STUDENT_PROCEDURES)) expect(myProcs).toContain(p);
  });
});

describe("e) caracterización: learning.manage está declarado pero NO se comprueba (estado actual, sin cambiarlo)", () => {
  it("solo aparece en el manifiesto; ningún código de servidor ni compartido lo consulta", () => {
    const hits: string[] = [];
    const walk = (dir: URL) => {
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        const u = new URL(d.name + (d.isDirectory() ? "/" : ""), dir);
        if (d.isDirectory()) { if (d.name !== "node_modules") walk(u); continue; }
        if (!/\.(ts|tsx)$/.test(d.name) || /\.test\.ts$/.test(d.name)) continue;
        if (readFileSync(u, "utf8").includes("learning.manage")) hits.push(d.name);
      }
    };
    walk(new URL("./", import.meta.url));
    walk(new URL("../shared/", import.meta.url));
    expect(hits).toEqual(["builtin.ts"]);
  });
  it("la administración de Learning (`adminProcedure`) se decide por «settings.manage» o rol admin, no por learning.manage", () => {
    const trpc = readFileSync(new URL("./_core/trpc.ts", import.meta.url), "utf8");
    const i = trpc.indexOf("export const adminProcedure");
    expect(trpc.slice(i, i + 700)).toContain('"settings.manage"');
    expect(routerSrc).toContain("adminProcedure");
    expect(routerSrc).not.toContain("learning.manage");
  });
});
