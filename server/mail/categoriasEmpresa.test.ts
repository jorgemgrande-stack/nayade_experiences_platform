/**
 * Correo operativo de las empresas (12/11/2026): guarda estática.
 *
 * El alcance de producción (MAIL_SCOPE_CATEGORIES) abre solo categorías transaccionales concretas; un envío sin
 * `category` sale como «legacy» y queda bloqueado. Esta prueba lee el código del servidor y exige que toda llamada
 * a `sendEmail(` / `sendTenantMail(` / `sharedSendEmail(` lleve `category:`, salvo las excepciones documentadas
 * abajo (envoltorios que reenvían la categoría de quien llama y envíos de prueba que se quedan en «legacy»).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TENANT_TRANSACTIONAL_SCOPE, TENANT_TRANSACTIONAL_SCOPE_ENV } from "./tenantTransactionalScope";
import { TRANSACTIONAL_CATEGORIES } from "./tenantPostmark";
import { mailPolicyFromEnv, scopeAllows } from "./policy";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SERVER = path.join(ROOT, "server");

/** Llamadas sin `category:` permitidas, por fichero (número exacto) y por qué. */
const SIN_CATEGORIA: Record<string, { n: number; motivo: string }> = {
  "server/accountSecurity/devices.ts": { n: 1, motivo: "defaultSend reenvía los parámetros; quien llama pone security_notice" },
  "server/accountSecurity/emailChange.ts": { n: 1, motivo: "defaultSend reenvía los parámetros; quien llama pone email_verification/security_notice" },
  "server/automations/actions.ts": { n: 1, motivo: "firma de la dependencia; runAction pone marketing u operational" },
  "server/mailer.ts": { n: 1, motivo: "sendEmail reenvía a sendTenantMail los parámetros con su categoría" },
  "server/routers/ticketing.ts": { n: 1, motivo: "envoltorio local con categoría obligatoria que la reenvía" },
  // Envíos de prueba o vista previa a una dirección que escribe el administrador: se quedan en «legacy» (bloqueados)
  "server/routers/cancellations.ts": { n: 1, motivo: "envío de prueba de las 8 plantillas de anulación" },
  "server/routers/emailCommunications.ts": { n: 1, motivo: "correo de prueba del centro de comunicaciones" },
  "server/routers/emailTemplatesRouter.ts": { n: 2, motivo: "pruebas del editor de plantillas" },
  "server/routers.ts": { n: 1, motivo: "vista previa de plantillas" },
};

function ficheros(dir: string, out: string[] = []): string[] {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) {
      if (f.name !== "node_modules") ficheros(p, out);
    } else if (f.name.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(f.name)) out.push(p);
  }
  return out;
}

/** Llamadas (con sus argumentos completos) sin `category`, agrupadas por fichero relativo. */
function llamadasSinCategoria(): Record<string, string[]> {
  const res: Record<string, string[]> = {};
  for (const f of ficheros(SERVER)) {
    const src = fs.readFileSync(f, "utf8");
    const re = /\b(sendEmail|sendTenantMail|sharedSendEmail)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      // Declaraciones de función: no son llamadas
      if (/function\s*$/.test(src.slice(Math.max(0, m.index - 30), m.index))) continue;
      let i = m.index + m[0].length;
      let depth = 1;
      while (i < src.length && depth > 0) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") depth--;
        i++;
      }
      const call = src.slice(m.index, i);
      // Menciones en comentarios: «sendEmail()»
      if (/\(\s*\)$/.test(call)) continue;
      if (/category\s*[:,}]/.test(call)) continue;
      const rel = path.relative(ROOT, f).split(path.sep).join("/");
      (res[rel] ??= []).push(call.replace(/\s+/g, " ").slice(0, 120));
    }
  }
  return res;
}

describe("correo operativo de las empresas: categorías explícitas", () => {
  it("ninguna llamada de envío queda sin categoría fuera de las excepciones documentadas", () => {
    const encontradas = llamadasSinCategoria();
    const resumen = Object.fromEntries(Object.entries(encontradas).map(([f, c]) => [f, c.length]));
    const esperado = Object.fromEntries(Object.entries(SIN_CATEGORIA).map(([f, v]) => [f, v.n]));
    expect(resumen, JSON.stringify(encontradas, null, 2)).toEqual(esperado);
  });

  it("los envoltorios locales del CRM y de ticketing exigen categoría", () => {
    const crm = fs.readFileSync(path.join(SERVER, "routers", "crm.ts"), "utf8");
    const tk = fs.readFileSync(path.join(SERVER, "routers", "ticketing.ts"), "utf8");
    expect(crm).toMatch(/async function sendEmail\(\{[^}]*category[^}]*\}: \{[^}]*category: MailCategory/);
    expect(tk).toMatch(/async function sendEmail\(opts: \{[^}]*category: MailCategory/);
  });

  it("los recordatorios automáticos sin consentimiento comprobado no salen («legacy», fuera del ámbito)", () => {
    const job = fs.readFileSync(path.join(SERVER, "emailAutomationJob.ts"), "utf8");
    expect(job).toMatch(/sendEmail\(\{[^)]*category: "legacy"/);
  });
});

describe("alcance transaccional de las empresas", () => {
  it("son exactamente las seis categorías transaccionales acordadas", () => {
    expect([...TENANT_TRANSACTIONAL_SCOPE].sort()).toEqual(
      ["cancellation", "invoice_available", "operational", "payment_confirmed", "quote_sent", "refund_recorded"],
    );
    expect(TENANT_TRANSACTIONAL_SCOPE_ENV).toBe(TENANT_TRANSACTIONAL_SCOPE.join(","));
  });

  it("no abre nada comercial, masivo ni sin clasificar", () => {
    for (const c of ["legacy", "marketing", "survey", "service_notice"]) {
      expect(TENANT_TRANSACTIONAL_SCOPE as readonly string[]).not.toContain(c);
    }
  });

  it("todas son transaccionales también para el Postmark propio de la empresa", () => {
    for (const c of TENANT_TRANSACTIONAL_SCOPE) expect(TRANSACTIONAL_CATEGORIES.has(c)).toBe(true);
  });

  it("con el alcance de producción ampliado, pasan las transaccionales y siguen bloqueadas legacy y marketing", () => {
    const actual = "email_verification,tenant_welcome,user_invite,password_reset,signup_confirmation";
    const p = mailPolicyFromEnv({ MAIL_MODE: "live", MAIL_SCOPE_CATEGORIES: `${actual},${TENANT_TRANSACTIONAL_SCOPE_ENV}` } as NodeJS.ProcessEnv);
    for (const c of TENANT_TRANSACTIONAL_SCOPE) expect(scopeAllows(p, "empresa", c)).toBe(true);
    for (const c of ["legacy", "marketing", "survey", "service_notice", undefined]) expect(scopeAllows(p, "empresa", c)).toBe(false);
  });

  it("plantillas del gestor: lo comercial es «marketing»; lo de la reserva, operativo", async () => {
    const { categoryForTemplate } = await import("./types");
    for (const k of ["commercial_reminder_1", "commercial_reminder_3", "marketing_x", "newsletter", "promo_verano", "campaign_a"]) expect(categoryForTemplate(k), k).toBe("marketing");
    for (const k of ["cancellation_accepted", "installment_reminder", "pending_payment_reminder", "reservation_confirmation"]) expect(categoryForTemplate(k), k).toBe("operational");
    expect(categoryForTemplate("quote_sent")).toBe("quote_sent");
  });

  it("automatizaciones: operativo solo para reservas y facturas; leads y presupuestos sin respuesta, «marketing»", () => {
    const src = fs.readFileSync(path.join(__dirname, "../automations/actions.ts"), "utf8");
    // Lo comercial (también leads y presupuestos con una regla «operativa») exige consentimiento y enlace de baja
    expect(src).toContain('const commercial = action.purpose === "commercial" || !(e.type === "reservation" || e.type === "invoice");');
    expect(src).toContain("if (commercial) {");
    expect(src).toContain('const category = commercial ? "marketing" : "operational";');
  });
});
