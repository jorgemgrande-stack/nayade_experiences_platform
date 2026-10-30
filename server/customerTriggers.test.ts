/**
 * Disparadores de comunicaciones al cliente conectados en esta fase: compra pendiente de pago, factura rectificativa,
 * dominio propio (pendiente y conectado). Datos ficticios; sin red.
 */
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { billingContact, creditNoteNotice, domainConnectedNotice, domainPendingNotice, purchasePendingNotice, type CustomerNoticeDeps } from "./notifications/customerTriggers";
import type { MailCategory, MailContent } from "./mail/types";

const companies = [{ id: 7, tenantId: "empresa-demo", name: "Empresa Demo, S.L." }];
const contacts = [
  { companyId: 7, email: "baja@empresa-demo.example", status: "inactive", isPrimary: false },
  { companyId: 7, email: "facturacion@empresa-demo.example", status: "active", isPrimary: true },
];
function deps() {
  const sent: Array<{ tenant: string | null; key: string; category: MailCategory; to: string; c: MailContent }> = [];
  const keys = new Set<string>();
  const d: CustomerNoticeDeps = {
    supportEmail: "soporte@bigelephant.es",
    crmStore: {
      list: (async (kind: string, f: Record<string, unknown>) => (kind === "companies" ? companies.filter((c) => c.tenantId === f.tenantId) : contacts.filter((c) => c.companyId === f.companyId))) as never,
      get: (async () => null) as never,
    },
    send: async (tenant, key, category, to, c) => {
      if (!keys.has(key)) (keys.add(key), sent.push({ tenant, key, category, to, c }));
    },
  };
  return { d, sent };
}

describe("avisos al cliente sin evento comercial propio", () => {
  it("destinatario: el contacto principal activo de la empresa (también desde el tenant)", async () => {
    const { d } = deps();
    expect(await billingContact(d.crmStore, { companyId: 7 })).toBe("facturacion@empresa-demo.example");
    expect(await billingContact(d.crmStore, { tenantId: "empresa-demo" })).toBe("facturacion@empresa-demo.example");
    expect(await billingContact(d.crmStore, { tenantId: "otra" })).toBeNull();
  });
  it("compra pendiente de pago: enlace de Stripe, una sola vez por pedido", async () => {
    const { d, sent } = deps();
    const i = { orderId: 31, companyId: 7, tenantId: "empresa-demo", productName: "Hotel Net · PMS", paymentUrl: "https://invoice.stripe.com/i/ficticio" };
    expect(await purchasePendingNotice(d, i)).toBe(true);
    await purchasePendingNotice(d, i);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ category: "module_change", to: "facturacion@empresa-demo.example" });
    expect(sent[0].c.html).toContain("https://invoice.stripe.com/i/ficticio");
    expect(sent[0].c.subject).toBe("Completa el pago de tu compra");
  });
  it("rectificativa expedida: con su número", async () => {
    const { d, sent } = deps();
    await creditNoteNotice(d, { invoiceId: 5, companyId: 7, number: "EBR-2026-000001" });
    expect(sent[0].c.text).toContain("EBR-2026-000001");
    expect(sent[0].key).toBe("notif:billing.credit_note:v1:invoice:5");
  });
  it("dominio propio: registros CNAME y TXT pendientes, y aviso al conectarlo", async () => {
    const { d, sent } = deps();
    await domainPendingNotice(d, { tenantId: "empresa-demo", domain: "www.empresa-demo.example", platformTarget: "edge.bigelephant.es", token: "ci-only-placeholder-not-a-secret-1" });
    await domainConnectedNotice(d, { tenantId: "empresa-demo", domain: "www.empresa-demo.example" });
    expect(sent.map((s) => s.category)).toEqual(["tenant_domain", "tenant_domain"]);
    expect(sent[0].c.text).toContain("_elephant-verify.www.empresa-demo.example");
    expect(sent[0].c.text).toContain("elephant-verify=ci-only-placeholder-not-a-secret-1");
    expect(sent[1].c.subject).toBe("Tu dominio www.empresa-demo.example ya está conectado");
  });
  it("sin contacto: no envía y no falla", async () => {
    const { d, sent } = deps();
    expect(await domainConnectedNotice(d, { tenantId: "sin-empresa", domain: "x.example" })).toBe(false);
    expect(sent).toHaveLength(0);
  });
});
