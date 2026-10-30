/**
 * Correo de pruebas gestionado desde el CRM (server/mail/sandboxAccess.ts): buzones y tipos internos que se suman a los
 * del entorno solo en sandbox; nunca en off ni para tipos dirigidos a clientes, y sin ampliar el ámbito de empresas.
 * Datos sintéticos (dominios .example).
 */
import { describe, it, expect } from "vitest";
import { MemorySettingsStore } from "../crm/leadNotices";
import { mailPolicyFromEnv } from "./policy";
import { memoryProvider } from "./providers";
import { MailService, type SendInput } from "./service";
import { MemoryMailStore } from "./store";
import { SandboxAccess, normalizeSandboxAccess, validateSandboxAccess } from "./sandboxAccess";

const ENV = { MAIL_SENDING_DOMAIN: "envios.example", MAIL_SANDBOX_ALLOWLIST: "equipo@envios.example", MAIL_SCOPE_TENANTS: "platform", MAIL_SCOPE_CATEGORIES: "lead_request_notice" };

async function make(mode: "sandbox" | "off" = "sandbox") {
  const access = new SandboxAccess({ settings: new MemorySettingsStore(), now: () => 1 });
  const provider = memoryProvider();
  const policy = mailPolicyFromEnv({ ...ENV, MAIL_MODE: mode } as NodeJS.ProcessEnv);
  const svc = new MailService({ lane: "platform", store: new MemoryMailStore(), provider, policy, now: () => 1_800_000_000_000, sandboxAccess: () => access.snapshot() });
  return { access, provider, svc };
}
let n = 0;
const msg = (over: Partial<SendInput> = {}): SendInput => ({
  tenantId: "platform",
  idempotencyKey: `prueba:${++n}`,
  category: "operational",
  to: "pruebas@buzon.example",
  subject: "[PRUEBA] Alerta",
  html: "<p>Alerta</p>",
  text: "Alerta",
  sender: { lane: "platform" },
  ...over,
});

describe("autorizaciones del sandbox desde el CRM", () => {
  it("sin autorizar: el buzón y el tipo quedan fuera; autorizados, sale", async () => {
    const { access, provider, svc } = await make();
    expect(await svc.send(msg())).toMatchObject({ status: "skipped", reason: "sandbox_recipient_not_allowed" });
    await access.save({ addresses: ["Pruebas@Buzon.example"], categories: [] }, 0, "operator:1");
    expect(await svc.send(msg())).toMatchObject({ status: "skipped", reason: "scope_not_allowed" });
    await access.save({ addresses: ["pruebas@buzon.example"], categories: ["operational"] }, 1, "operator:1");
    expect(String((await svc.send(msg())).reason)).not.toMatch(/not_allowed/);
    expect(provider.sent.map((m) => m.to)).toEqual(["pruebas@buzon.example"]);
    expect((await access.history()).length).toBe(2);
  });

  it("no abre nada fuera del sandbox ni del ámbito de empresas, ni tipos dirigidos a clientes", async () => {
    const off = await make("off");
    await off.access.save({ addresses: ["pruebas@buzon.example"], categories: ["operational"] }, 0, "operator:1");
    expect(await off.svc.send(msg())).toMatchObject({ status: "skipped", reason: "mode_off" });
    const { access, provider, svc } = await make();
    await access.save({ addresses: ["pruebas@buzon.example"], categories: ["operational"] }, 0, "operator:1");
    expect(await svc.send(msg({ tenantId: "acme", sender: { lane: "platform" } }))).toMatchObject({ status: "skipped", reason: "scope_not_allowed" });
    expect(await svc.send(msg({ category: "tenant_welcome" }))).toMatchObject({ status: "skipped", reason: "scope_not_allowed" });
    expect(provider.sent).toHaveLength(0);
    expect(() => validateSandboxAccess({ addresses: [], categories: ["tenant_welcome"] })).toThrow(/no habilitables/);
    expect(() => validateSandboxAccess({ addresses: ["buzon.example"], categories: [] })).toThrow(/no válidas/);
    expect(() => validateSandboxAccess({ addresses: Array.from({ length: 11 }, (_, i) => `p${i}@buzon.example`), categories: [] })).toThrow(/Como mucho/);
  });

  it("un valor guardado fuera de lo previsto no abre nada de más; versiones en conflicto se rechazan", async () => {
    expect(normalizeSandboxAccess({ addresses: ["ok@buzon.example", "mal", 3], categories: ["operational", "marketing"] })).toEqual({ addresses: ["ok@buzon.example"], categories: ["operational"] });
    expect(normalizeSandboxAccess(null)).toEqual({ addresses: [], categories: [] });
    const { access } = await make();
    await access.save({ addresses: [], categories: ["operational"] }, 0, "operator:1");
    await expect(access.save({ addresses: [], categories: [] }, 0, "operator:2")).rejects.toThrow(/Otra persona/);
  });
});
