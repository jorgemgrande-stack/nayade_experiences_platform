/**
 * Disparadores de las comunicaciones al CLIENTE que nacen de un hecho del plano de control sin evento comercial
 * propio: compra de módulo pendiente de pago, factura rectificativa expedida y dominio propio (pendiente de validar
 * y conectado). Mismo criterio que el despachador: destinatario = contacto principal activo de la empresa del CRM,
 * clave de idempotencia por hecho, bandeja de la plataforma con su política (modo, autorizados, ámbito y límites).
 * Nunca rompen la operación que los llama.
 */
import { opsLog } from "../_core/ops/log";
import type { CrmStore } from "../crm/store";
import { extraTemplates } from "../mail/extraTemplates";
import type { MailCategory, MailContent } from "../mail/types";
import { VERIFY_LABEL } from "../_core/tenantRegistry/domainVerification";
import { TEMPLATE_CATALOG, type Vars } from "./catalog";

export interface CustomerNoticeDeps {
  send: (tenantId: string | null, idempotencyKey: string, category: MailCategory, to: string, c: MailContent) => Promise<unknown>;
  crmStore: Pick<CrmStore, "list" | "get">;
  supportEmail: string | null;
}

type Contact = { status?: string; email?: string | null; isPrimary?: boolean };

/** Contacto principal activo (con correo) de una empresa del CRM, o de la empresa enlazada a un tenant si es única. */
export async function billingContact(crmStore: CustomerNoticeDeps["crmStore"], o: { companyId?: number | null; tenantId?: string | null }): Promise<string | null> {
  let companyId = o.companyId ?? null;
  if (!companyId && o.tenantId) {
    const linked = (await crmStore.list("companies", { tenantId: o.tenantId })) as Array<{ id: number }>;
    companyId = linked.length === 1 ? linked[0].id : null;
  }
  if (!companyId) return null;
  const contacts = ((await crmStore.list("contacts", { companyId })) as Contact[]).filter((c) => c.status !== "inactive" && c.email);
  return (contacts.find((c) => c.isPrimary) ?? contacts[0])?.email ?? null;
}

async function deliver(d: CustomerNoticeDeps, o: { tenantId: string | null; companyId?: number | null; key: string; category: MailCategory; content: MailContent; what: string }): Promise<boolean> {
  try {
    const to = await billingContact(d.crmStore, o);
    if (!to) {
      opsLog("warn", "Notifications", "no_recipient", { notice: o.what, tenantId: o.tenantId });
      return false;
    }
    await d.send(o.tenantId, o.key.slice(0, 190), o.category, to, o.content);
    return true;
  } catch (e) {
    opsLog("error", "Notifications", "notice_failed", { notice: o.what, error: e instanceof Error ? e.name : "error" });
    return false;
  }
}

/** Plantilla del catálogo con SOLO sus variables permitidas. */
function fromCatalog(id: string, vars: Vars, supportEmail: string | null): { content: MailContent; category: MailCategory; version: number } {
  const spec = TEMPLATE_CATALOG.find((t) => t.id === id && t.render);
  if (!spec) throw new Error(`Plantilla sin render: ${id}`);
  const allowed: Vars = {};
  for (const k of spec.variables) allowed[k] = vars[k] ?? null;
  return { content: spec.render!(allowed, { supportEmail }), category: spec.category, version: spec.version };
}

/** Compra de módulo enviada a Stripe con el cobro pendiente: enlace de pago de Stripe. Una vez por pedido. */
export function purchasePendingNotice(d: CustomerNoticeDeps, i: { orderId: number; companyId: number; tenantId: string | null; productName: string | null; paymentUrl: string | null }) {
  const t = fromCatalog("module.purchase_requested", { productName: i.productName, paymentUrl: i.paymentUrl }, d.supportEmail);
  return deliver(d, { tenantId: i.tenantId, companyId: i.companyId, key: `notif:module.purchase_requested:v${t.version}:order:${i.orderId}`, category: t.category, content: t.content, what: "module.purchase_requested" });
}

/** Factura rectificativa expedida (con su número). Una vez por rectificativa. */
export function creditNoteNotice(d: CustomerNoticeDeps, i: { invoiceId: number; companyId: number; number: string }) {
  const t = fromCatalog("billing.credit_note", { documentNumber: i.number }, d.supportEmail);
  return deliver(d, { tenantId: null, companyId: i.companyId, key: `notif:billing.credit_note:v${t.version}:invoice:${i.invoiceId}`, category: t.category, content: t.content, what: "billing.credit_note" });
}

/** Dominio propio dado de alta: registros DNS que faltan (CNAME al destino de la plataforma y TXT de titularidad). */
export function domainPendingNotice(d: CustomerNoticeDeps, i: { tenantId: string; domain: string; platformTarget: string; token: string | null }) {
  const content = extraTemplates.domainPending({ domain: i.domain, record: "CNAME", value: i.platformTarget, txt: i.token ? { name: `${VERIFY_LABEL}.${i.domain}`, value: `elephant-verify=${i.token}` } : null });
  return deliver(d, { tenantId: i.tenantId, key: `domain:${i.tenantId}:${i.domain}:pending:${(i.token ?? "sin-token").slice(0, 12)}`, category: "tenant_domain", content, what: "tenant.domain_pending" });
}

/** Dominio propio activado: la plataforma ya responde en él. */
export function domainConnectedNotice(d: CustomerNoticeDeps, i: { tenantId: string; domain: string }) {
  return deliver(d, { tenantId: i.tenantId, key: `domain:${i.tenantId}:${i.domain}:active`, category: "tenant_domain", content: extraTemplates.domainConnected({ domain: i.domain }), what: "tenant.domain_connected" });
}
