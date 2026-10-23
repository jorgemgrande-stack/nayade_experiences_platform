/**
 * Avisos internos (nueva solicitud de presupuesto o de grupo, nueva reserva): en multiempresa van solo al correo de la
 * propia empresa, nunca al ADMIN_EMAIL de la instalación (recibiría las solicitudes de todas las empresas).
 */
import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const settings: Record<string, string> = {};
vi.mock("./db", () => ({ getDb: async () => null }));

import { internalNoticeEmail, installationAdminCopy } from "./config";
import * as config from "./config";

const prevMode = process.env.TENANT_MODE;
const prevAdmin = process.env.ADMIN_EMAIL;
afterEach(() => {
  if (prevMode === undefined) delete process.env.TENANT_MODE;
  else process.env.TENANT_MODE = prevMode;
  if (prevAdmin === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = prevAdmin;
  vi.restoreAllMocks();
  for (const k of Object.keys(settings)) delete settings[k];
});

describe("destinatario de los avisos internos", () => {
  it("multiempresa: nunca ADMIN_EMAIL de la instalación (ni como destinatario ni como copia)", async () => {
    process.env.TENANT_MODE = "multi";
    process.env.ADMIN_EMAIL = "instalacion@plataforma.example";
    const r = await internalNoticeEmail();
    expect(r).not.toBe("instalacion@plataforma.example");
    expect(installationAdminCopy()).toBeNull();
  });

  it("una única empresa: se conserva el comportamiento (ADMIN_EMAIL si está definido)", async () => {
    delete process.env.TENANT_MODE;
    process.env.ADMIN_EMAIL = "admin@unica.example";
    expect(await internalNoticeEmail()).toBe("admin@unica.example");
    expect(installationAdminCopy()).toBe("admin@unica.example");
    delete process.env.ADMIN_EMAIL;
    expect(installationAdminCopy()).toBeNull();
  });

  it("ningún aviso interno lee ADMIN_EMAIL directamente", () => {
    for (const f of ["./routers.ts", "./routers/crm.ts", "./reservationEmails.ts"]) {
      const src = fs.readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src, f).not.toContain("process.env.ADMIN_EMAIL");
    }
    expect(typeof config.internalNoticeEmail).toBe("function");
  });
});
