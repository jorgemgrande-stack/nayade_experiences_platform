/**
 * Newsletter · dependencias reales para la empresa en curso: CRM (cliente y consentimiento de marketing), correo de la
 * empresa (remitente autorizado, política de correo y límites del servicio de correo) y su identidad legal.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { ENV } from "../_core/env";
import { sessionSecret } from "../_core/sessionSecret";
import { getTenantIdOrDefault } from "../_core/tenant";
import { publicBaseUrl } from "../_core/productIdentity";
import { brandName, issuerName } from "../tenantBrand";
import { getSystemSettingSync } from "../config";
import type { MailIdentity } from "./core";
import { NewsletterService, type CrmPort, type MailPort } from "./service";
import { mysqlNewsletterStore } from "./store";

type Row = Record<string, unknown>;
type Tx = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };
const rowsOf = (r: unknown): Row[] => (Array.isArray((r as unknown[])?.[0]) ? ((r as unknown[])[0] as Row[]) : []);

/** Cliente del CRM con ese correo (o nuevo, origen «newsletter») + consentimiento de marketing concedido. */
export const crmPort: CrmPort = {
  async grant(email, evidence) {
    const db = await getDb();
    if (!db) throw new Error("Base de datos no disponible");
    const find = async (tx: Tx) => rowsOf(await tx.execute(sql`SELECT id FROM clients WHERE LOWER(email) = ${email} LIMIT 1`))[0];
    return db.transaction(async (tx) => {
      let c = await find(tx);
      if (!c) {
        const name = email.split("@")[0].slice(0, 80) || "Suscriptor";
        try {
          await tx.execute(sql`INSERT INTO clients (name, email, source) VALUES (${name}, ${email}, 'newsletter')`);
        } catch {
          /* otro alta del mismo correo a la vez: se lee el que ganó */
        }
        c = await find(tx);
      }
      if (!c) throw new Error("No se pudo localizar ni crear el cliente");
      const clientId = Number(c.id);
      const cur = rowsOf(await tx.execute(sql`SELECT status FROM customer_marketing_consents WHERE client_id = ${clientId} FOR UPDATE`))[0];
      const ev = evidence.slice(0, 500);
      await tx.execute(sql`INSERT INTO customer_marketing_consents (client_id, status, source, evidence, granted_at, withdrawn_at, updated_by)
        VALUES (${clientId}, 'granted', 'form', ${ev}, CURRENT_TIMESTAMP(3), NULL, 'newsletter:double_opt_in')
        ON DUPLICATE KEY UPDATE status = 'granted', source = 'form', evidence = VALUES(evidence), granted_at = CURRENT_TIMESTAMP(3), withdrawn_at = NULL, updated_by = VALUES(updated_by)`);
      await tx.execute(sql`INSERT INTO customer_marketing_consent_log (client_id, previous_status, new_status, source, evidence, actor)
        VALUES (${clientId}, ${cur ? String(cur.status) : null}, 'granted', 'form', ${ev}, 'newsletter:double_opt_in')`);
      return clientId;
    });
  },
  async withdraw(clientId, evidence) {
    const db = await getDb();
    if (!db) throw new Error("Base de datos no disponible");
    await db.transaction(async (tx) => {
      const cur = rowsOf(await tx.execute(sql`SELECT status FROM customer_marketing_consents WHERE client_id = ${clientId} FOR UPDATE`))[0];
      if (cur?.status === "withdrawn") return;
      const ev = evidence.slice(0, 500);
      await tx.execute(sql`INSERT INTO customer_marketing_consents (client_id, status, source, evidence, granted_at, withdrawn_at, updated_by)
        VALUES (${clientId}, 'withdrawn', 'form', ${ev}, NULL, CURRENT_TIMESTAMP(3), 'newsletter:unsubscribe')
        ON DUPLICATE KEY UPDATE status = 'withdrawn', evidence = VALUES(evidence), withdrawn_at = CURRENT_TIMESTAMP(3), updated_by = VALUES(updated_by)`);
      await tx.execute(sql`INSERT INTO customer_marketing_consent_log (client_id, previous_status, new_status, source, evidence, actor)
        VALUES (${clientId}, ${cur ? String(cur.status) : null}, 'withdrawn', 'form', ${ev}, 'newsletter:unsubscribe')`);
    });
  },
};

/** Correo por el servicio de correo de la empresa (política, remitente autorizado y supresiones incluidos). */
export const mailPort: MailPort = {
  async send(m) {
    const { sendEmail } = await import("../mailer");
    try {
      const ok = await sendEmail({ to: m.to, subject: m.subject, html: m.html, text: m.text, category: m.category, idempotencyKey: m.idempotencyKey });
      return ok ? { ok: true } : { ok: false, error: "El servicio de correo no envió el mensaje (política de correo, modo de pruebas o cuota)." };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "error" };
    }
  },
};

export function identity(): MailIdentity {
  let brand = "";
  try {
    brand = brandName();
  } catch {
    brand = "";
  }
  const get = (k: string) => getSystemSettingSync(k, "").trim();
  let legal = "";
  try {
    legal = issuerName();
  } catch {
    legal = brand;
  }
  const nif = get("brand_nif") || get("site_legal_cif");
  const legalLine = [legal, nif && `NIF/CIF ${nif}`, get("brand_address") || get("site_legal_address"), get("site_legal_email") || get("email_reservations")].filter(Boolean).join(" · ");
  return { brand: brand || "Newsletter", legalLine };
}

export function unsubscribeSecrets(): string[] {
  const own = (process.env.NET_UNSUBSCRIBE_SECRET ?? "").trim();
  return Array.from(new Set([own.length >= 32 ? own : "", sessionSecret() ?? ""].filter(Boolean)));
}

export function newsletterService(): NewsletterService {
  return new NewsletterService({
    store: mysqlNewsletterStore,
    crm: crmPort,
    mail: mailPort,
    tenantId: getTenantIdOrDefault(),
    now: () => Date.now(),
    secrets: unsubscribeSecrets,
    baseUrl: publicBaseUrl,
    identity,
  });
}
export const ipSecret = () => ENV.cookieSecret;
