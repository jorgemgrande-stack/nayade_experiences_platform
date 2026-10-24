/**
 * Accesos de las empresas clientes: AISLAMIENTO entre dos empresas reales (opt-in, REGISTRY_TEST_DATABASE_URL).
 *
 * Dos empresas creadas por el flujo público (registro → verificación → aprovisionamiento), cada una con su base de datos,
 * y en cada una un empleado con el MISMO id de usuario. El operador actúa solo por la API del plano de control
 * (`/cp/v1/tenants/:id/access`), que llama al Core por el canal firmado (`/_ops/access`). Se comprueba que:
 *  - la lista de una empresa nunca contiene usuarios de la otra;
 *  - una acción sobre el usuario N de A no toca al usuario N de B (desactivar, reactivar, confirmación de correo);
 *  - la empresa sale del token firmado: el host de otra empresa, un token de otro secreto, un token reutilizado o uno
 *    para una empresa inexistente no sirven;
 *  - sin `support:write` no se ejecuta nada y el historial de cada empresa solo recoge lo suyo.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:ci_only@127.0.0.1:3418/registry_test \
 *     pnpm vitest run server/accesosAislamiento.e2e.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { startElephantStack, type ElephantStack } from "./elephantStack.testkit";
import { signOpsAccessToken } from "./_core/opsAccess/token";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const SECRET = `secreto-accesos-de-pruebas-${crypto.randomBytes(24).toString("hex")}`;

describe.skipIf(!URL_)("Accesos: aislamiento entre dos empresas reales (MySQL real)", () => {
  let s: ElephantStack;
  const A = { tenantId: "", owner: "", employee: "", employeeId: 0 };
  const B = { tenantId: "", owner: "", employee: "", employeeId: 0 };

  const db = async <T = any>(tenantId: string, q: string, params: unknown[] = []) => {
    const c = await s.tenantConn(tenantId);
    try {
      return (await c.query<mysql.RowDataPacket[]>(q, params))[0] as T[];
    } finally {
      await c.end();
    }
  };
  const access = (tenantId: string, token = s.adminToken) => s.cp("GET", `/tenants/${tenantId}/access`, { token });
  const act = (tenantId: string, uid: number, action: string, body: Record<string, unknown>, token = s.adminToken) =>
    s.cp("POST", `/tenants/${tenantId}/access/users/${uid}/${action}`, { token, body });
  const active = async (tenantId: string, uid: number) => Number((await db(tenantId, "SELECT isActive FROM users WHERE id = ?", [uid]))[0]?.isActive);
  const events = async (tenantId: string) =>
    (await s.regPool.query<mysql.RowDataPacket[]>("SELECT action, details FROM tenant_events WHERE tenant_id = ? AND action LIKE 'access.%' ORDER BY id", [tenantId]))[0];
  const core = (token: string, host?: string) => s.request(s.appPort, "POST", "/_ops/access", { token, host, body: {} });

  async function signUp(company: string, email: string) {
    const r = await s.cp("POST", "/public/trial", { body: { email, companyName: company, idempotencyKey: crypto.randomBytes(12).toString("hex") } });
    expect(r.status).toBe(202);
    const v = await s.cp("POST", "/public/trial/verify", { body: s.verificationLink(email) });
    if (v.status !== 200) throw new Error(`verificación: ${v.status} ${v.raw}`);
    const tenantId = String(v.json.domain).split(".")[0];
    s.tenants.push(tenantId);
    return tenantId;
  }

  beforeAll(async () => {
    s = await startElephantStack(URL_!, { label: "acc", opsAccessSecret: SECRET });
    A.owner = `propietaria-${s.run}@empresa-a.example`;
    B.owner = `propietario-${s.run}@empresa-b.example`;
    A.employee = `empleado-${s.run}@empresa-a.example`;
    B.employee = `empleada-${s.run}@empresa-b.example`;
    A.tenantId = await signUp("Empresa Accesos A", A.owner);
    B.tenantId = await signUp("Empresa Accesos B", B.owner);
    expect(A.tenantId).not.toBe(B.tenantId);
    // Un empleado en cada empresa con el MISMO id (las bases son independientes)
    for (const t of [A, B]) {
      await db(t.tenantId, "INSERT INTO users (id, openId, name, email, loginMethod, role, isActive, inviteAccepted) VALUES (100, ?, ?, ?, 'local', 'agente', 1, 1)", [
        `acc-${crypto.randomBytes(8).toString("hex")}`,
        t === A ? "Empleado A" : "Empleada B",
        t.employee,
      ]);
      t.employeeId = 100;
    }
  }, 300_000);

  afterAll(async () => {
    await s?.close();
  });

  it("la lista de cada empresa contiene solo sus usuarios", async () => {
    const ra = await access(A.tenantId);
    const rb = await access(B.tenantId);
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    const ea = ra.json.users.map((u: any) => u.email).sort();
    const eb = rb.json.users.map((u: any) => u.email).sort();
    expect(ea).toEqual([A.employee, A.owner].sort());
    expect(eb).toEqual([B.employee, B.owner].sort());
    expect(ra.raw).not.toContain("empresa-b.example");
    expect(rb.raw).not.toContain("empresa-a.example");
    // La propietaria se marca como tal en SU empresa
    expect(ra.json.users.find((u: any) => u.email === A.owner)?.owner).toBe(true);
    expect(ra.json.tenantId).toBe(A.tenantId);
  });

  it("desactivar el usuario 100 de A no toca al usuario 100 de B; reactivar tampoco", async () => {
    const d = await act(A.tenantId, A.employeeId, "deactivate", { reason: "Prueba de aislamiento entre empresas" });
    expect(d.status).toBe(200);
    expect(d.json).toMatchObject({ ok: true, action: "deactivate", active: false });
    expect(await active(A.tenantId, A.employeeId)).toBe(0);
    expect(await active(B.tenantId, B.employeeId)).toBe(1);
    const r = await act(A.tenantId, A.employeeId, "activate", { reason: "Prueba de aislamiento entre empresas" });
    expect(r.status).toBe(200);
    expect(await active(A.tenantId, A.employeeId)).toBe(1);
    expect(await active(B.tenantId, B.employeeId)).toBe(1);
  });

  it("un envío a A con el correo del usuario de B se rechaza (confirm_mismatch) y no crea ningún enlace", async () => {
    const r = await act(A.tenantId, A.employeeId, "reset", { reason: "Prueba de aislamiento entre empresas", confirmEmail: B.employee });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("confirm_mismatch");
    for (const t of [A, B]) expect(await db(t.tenantId, "SELECT COUNT(*) AS n FROM password_reset_tokens")).toEqual([{ n: 0 }]);
  });

  it("la empresa sale del token firmado: el host de B no cambia nada", async () => {
    const token = await signOpsAccessToken({ tid: A.tenantId, act: "list", op: "operator:prueba" }, SECRET);
    const r = await core(token, s.hostOf(B.tenantId));
    expect(r.status).toBe(200);
    const emails = r.json.users.map((u: any) => u.email);
    expect(emails).toContain(A.owner);
    expect(r.raw).not.toContain("empresa-b.example");
  });

  it("token reutilizado, de otro secreto, sin firmar o de una empresa inexistente: rechazados", async () => {
    const token = await signOpsAccessToken({ tid: B.tenantId, act: "deactivate", uid: B.employeeId, op: "operator:prueba" }, SECRET);
    // El primer uso es legítimo (desactiva al empleado de B); el segundo se rechaza
    expect((await core(token)).status).toBe(200);
    expect((await core(token)).status).toBe(409);
    const reactivate = await signOpsAccessToken({ tid: B.tenantId, act: "activate", uid: B.employeeId, op: "operator:prueba" }, SECRET);
    expect((await core(reactivate)).status).toBe(200);
    expect(await active(A.tenantId, A.employeeId)).toBe(1);

    const forged = await signOpsAccessToken({ tid: A.tenantId, act: "deactivate", uid: A.employeeId, op: "operator:prueba" }, `otro-secreto-${crypto.randomBytes(24).toString("hex")}`);
    expect((await core(forged)).status).toBe(401);
    expect((await core("")).status).toBe(401);
    const ghost = await signOpsAccessToken({ tid: "empresa-que-no-existe", act: "list", op: "operator:prueba" }, SECRET);
    expect((await core(ghost)).status).toBe(404);
    expect(await active(A.tenantId, A.employeeId)).toBe(1);
    expect((await access("empresa-que-no-existe")).status).toBe(404);
  });

  it("sin support:write no se ejecuta nada; con solo lectura se puede consultar", async () => {
    const r = await act(A.tenantId, A.employeeId, "deactivate", { reason: "Intento sin permiso de escritura" }, s.readerToken);
    expect(r.status).toBe(403);
    expect(await active(A.tenantId, A.employeeId)).toBe(1);
    expect((await access(A.tenantId, s.readerToken)).status).toBe(200);
    expect((await access(A.tenantId, "token-inventado")).status).toBe(401);
  });

  it("el historial de cada empresa recoge solo sus acciones, sin correos", async () => {
    const ea = await events(A.tenantId);
    const eb = await events(B.tenantId);
    expect(ea.map((e) => e.action)).toEqual(["access.deactivate", "access.activate", "access.reset"]);
    // Las llamadas directas al Core (sin plano de control) no se anotan en el registro; en B no hubo ninguna por la API
    expect(eb).toEqual([]);
    expect(JSON.stringify(ea)).not.toMatch(/@/);
    expect(ea.at(-1)?.details).toMatchObject({ userId: A.employeeId, result: "confirm_mismatch" });
  });
});
