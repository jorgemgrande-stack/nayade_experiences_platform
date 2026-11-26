/**
 * CIRCUITO COMPLETO de la venta online de Quantum (rama integrada de los cinco cambios: preparación de venta, reembolsos y
 * disputas, compra ligada a edición, endurecimiento de cartCheckout y condiciones/idioma/participantes):
 *
 *   producto → variante → participantes → cupón → disponibilidad → reserva de plazas → Checkout (Stripe Connect) →
 *   webhook firmado → confirmación → matrícula → incidencias (reembolso/disputa) → expiración.
 *
 * Qué es REAL en estas pruebas: el router `reservations.cartCheckout`, `editionPurchaseDb`, `inventoryHoldsDb` (con las
 * sentencias SQL reales interpretadas por una BD simulada), `consumeOrderDiscount`, `recordCheckoutExtras`,
 * `sendShopOrderConfirmation`, `learningFlow`, el puerto real `realShopPort`, el servicio Connect (`startShopCheckout`,
 * `handleConnectEvent`), el receptor del webhook con la firma real del SDK y la pasarela real de Stripe contra un
 * servidor HTTP local que imita la idempotencia de Stripe (mismos parámetros por clave) y registra clave y cuenta.
 * Qué es SIMULADO: MySQL (memoria; la autoridad es el CI con circuitoVentaOnline.e2e.mysql.test.ts), el cierre contable de
 * `applyPaymentResult` (factura, REAV, CRM: solo se modela el orden de sus efectos relevantes aquí) y el LMS (reglas y
 * matrículas en memoria). Ninguna llamada a Stripe, Redsys ni correo reales; cobros reales apagados.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import Stripe from "stripe";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const H = vi.hoisted(() => {
  process.env.TENANT_MODE = "multi";
  process.env.APP_URL = "https://quantum.example.invalid";
  process.env.CONNECT_STRIPE_MODE = "test";
  process.env.CONNECT_STRIPE_API_KEY = ["rk", "test", "q".repeat(24)].join("_");
  process.env.CONNECT_STRIPE_WEBHOOK_SECRET = ["whsec", "w".repeat(32)].join("_");
  // Clave del Stripe CORPORATIVO: no debe aparecer jamás en una petición de cobro de la tienda
  process.env.CP_STRIPE_API_KEY = ["sk", "live", "CORPORATIVA", "z".repeat(20)].join("_");
  return {
    T: new Map<string, any>(),
    cur: (() => { throw new Error("sin empresa"); }) as () => any,
    mails: [] as any[],
    alerts: [] as any[],
    deps: null as any,
  };
});

// ─── Dobles (módulos) ────────────────────────────────────────────────────────

vi.mock("./db", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getDb: async () => H.cur().db,
    getExperienceById: async (id: number) => H.cur().products[id],
    // Igual que la real: los suplementos (supplementGroup) solo salen si se piden
    getVariantsByExperience: async (id: number, o?: { includeSupplements?: boolean }) => (H.cur().variants[id] ?? []).filter((v: any) => o?.includeSupplements || !v.supplementGroup),
    generateReservationNumber: async () => `R-${H.cur().nextRes}`,
    createReservation: async (data: any) => {
      await Promise.resolve(); // cede el turno: dos compradores se intercalan
      const t = H.cur();
      const r = {
        id: t.nextRes++, status: "pending_payment", merchantOrder: data.merchantOrder, merchant_order: data.merchantOrder,
        productId: data.productId, productName: data.productName, bookingDate: data.bookingDate, people: data.people,
        amountTotal: data.amountTotal, amountPaid: 0, customerName: data.customerName, customerEmail: data.customerEmail,
        notes: data.notes ?? null, channel: "ONLINE_DIRECTO", quoteId: null, changesLog: [] as any[], createdAt: Date.now(),
        confirmationEmailSentAt: null, invoiceNumber: null, variantId: null,
        inventory_kind: null, inventory_ref_id: null, inventory_units: null, hold_status: null, hold_release_reason: null, hold_expires_at: null,
        stay_check_in: null, stay_check_out: null,
      };
      t.res.push(r);
      return { id: r.id };
    },
    createVentaPerdidaLead: async (rows: any[]) => { H.cur().lost.push(...rows.map((r) => r.merchantOrder)); },
    logActivity: async () => {},
  };
});
// Red de seguridad: si alguna ruta llega a la base real del tenant, recibe la BD simulada de la empresa en curso
vi.mock("./_core/dbRegistry", async (importOriginal) => ({ ...(await importOriginal<any>()), getTenantDatabase: async () => H.cur().db }));
vi.mock("./redsys", async (importOriginal) => ({ ...(await importOriginal<any>()), generateMerchantOrder: () => `QSR${String(++H.cur().seq).padStart(7, "0")}`, isRedsysConfigured: () => false }));
vi.mock("./inventoryDb", async (importOriginal) => ({ ...(await importOriginal<any>()), assertStockAvailable: async () => {}, markOrderStockLine: async () => {} }));
vi.mock("./pricingRulesDb", async (importOriginal) => ({ ...(await importOriginal<any>()), activeRules: async () => [] }));
vi.mock("./_core/notification", async (importOriginal) => ({ ...(await importOriginal<any>()), notifyOwner: async (n: any) => { H.alerts.push({ tenant: H.cur().id, ...n }); return true; } }));
vi.mock("./tenantBrand", async (importOriginal) => ({ ...(await importOriginal<any>()), brandName: () => "Quantum Soulrise", companyName: () => "Quantum Soulrise" }));
vi.mock("./config", async (importOriginal) => ({ ...(await importOriginal<any>()), getSystemSetting: async (_k: string, d: string) => d, getBusinessEmail: async () => null }));
vi.mock("./emailManager", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  sendManagedEmail: async (m: any) => { H.mails.push({ tenant: H.cur().id, ...m }); return { sent: true }; },
  logDirectEmail: async () => {},
}));
vi.mock("./mailer", async (importOriginal) => ({ ...(await importOriginal<any>()), sendEmail: async () => true }));

// LMS en memoria: las reglas, las matrículas y su estado (la lógica de learningFlow es la real)
vi.mock("./learningDb", () => ({
  isMissingLearningSchema: () => false,
  listRules: async () => H.cur().rules,
  grantFromPayment: async (p: any) => {
    const t = H.cur();
    if (!t.enrol.some((e: any) => e.order_id === p.orderId)) t.enrol.push({ id: t.enrol.length + 1, order_id: p.orderId, user_id: p.userId, source: "payment", status: "active", suspendedWhy: "" });
    return { granted: [{ created: true }] };
  },
  revokeEnrollment: async (id: number) => { H.cur().enrol.find((e: any) => e.id === id).status = "revoked"; },
  suspendEnrollment: async (id: number, reason: string) => { const e = H.cur().enrol.find((x: any) => x.id === id); e.status = "suspended"; e.suspendedWhy = reason; },
  reactivateEnrollment: async (id: number) => { H.cur().enrol.find((e: any) => e.id === id).status = "active"; },
}));
vi.mock("./communitiesDb", () => ({ ensureAccount: async () => ({ userId: 2, invite: null, created: false }) }));
vi.mock("./enrollmentCommerceDb", () => ({ readLinkedQuotes: async () => [] }));

// Cierre del pago: modela, EN EL MISMO ORDEN que redsysRoutes.applyPaymentResult, lo que afecta al circuito
// (transición condicional pending→paid, restauración de una reserva cancelada por la limpieza, retención de plazas,
// consumo del cupón, matrícula y correo). La factura/REAV/CRM reales se verifican en el MySQL del CI.
vi.mock("./redsysRoutes", async () => {
  const inv: any = await import("./inventoryHoldsDb");
  const shop: any = await import("./shopOrdersDb");
  const learn: any = await import("./learningFlow");
  return {
    orderEffectsPending: async () => false,
    applyPaymentResult: async (r: any) => {
      const t = H.cur();
      const rows = t.res.filter((x: any) => x.merchantOrder === r.merchantOrder);
      if (!rows.length) return;
      const expected = rows.reduce((s: number, x: any) => s + (x.amountTotal ?? 0), 0);
      if (r.isAuthorized && r.amount > expected) return;
      let affected = 0;
      for (const x of rows) if (x.status === "pending_payment") { x.status = r.isAuthorized ? "paid" : "failed"; affected++; }
      if (affected === 0) {
        if (r.isAuthorized && rows[0].status === "cancelled") {
          for (const x of rows) x.status = "paid"; // carrera con la limpieza de abandonados: el cobro es real
          t.restored.push(r.merchantOrder);
          affected = rows.length;
        } else return;
      }
      if (r.isAuthorized) {
        for (const x of rows) { x.paidAt = Date.now(); x.amountPaid = rows.length > 1 && expected > 0 ? Math.round(r.amount * x.amountTotal / expected) : r.amount; }
      }
      await inv.applyPaymentToInventoryHolds(r.merchantOrder, r.isAuthorized);
      if (r.isAuthorized) {
        await shop.consumeOrderDiscount(r.merchantOrder, r.amount);
        await learn.grantLearningFromOrder(r.merchantOrder);
        t.invoices.push(r.merchantOrder);
        await shop.sendShopOrderConfirmation(r.merchantOrder);
      }
    },
  };
});

// Almacén de pedidos para la idempotencia (la consulta SQL real se verifica en el CI con MySQL)
vi.mock("./shopOrdersDb", async (importOriginal) => {
  const actual: any = await importOriginal();
  const rules: any = await import("./shopCheckoutRules");
  const extras: any = await import("../shared/checkoutExtras");
  return {
    ...actual,
    findPendingOrderByFingerprint: async (email: string, fp: string) =>
      H.cur().res.find((r: any) => r.status === "pending_payment" && r.customerEmail === email && rules.fingerprintFromLog(r.changesLog) === fp)?.merchantOrder ?? null,
    countPendingDiscountHolds: async (id: number) => new Set(H.cur().res.filter((r: any) => r.status === "pending_payment" && rules.discountFromLog(r.changesLog)?.id === id).map((r: any) => r.merchantOrder)).size,
    __extras: extras,
  };
});

// Cobros por empresa: el almacén y las dependencias de CADA empresa (cuenta, pasarela real hacia el servidor local, puerto real)
vi.mock("./paymentsConnect/store", async (importOriginal) => ({ ...(await importOriginal<any>()), mysqlPaymentStore: () => H.cur().store }));
vi.mock("./paymentsConnect/runtime", async (importOriginal) => ({ ...(await importOriginal<any>()), realPaymentsDeps: (tenantId: string, config: any) => H.deps(tenantId, config) }));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { runWithTenant, getTenantIdOrDefault } from "./_core/tenant";
import { discountCodes, discountCodeUses, experiences, experienceVariants, reservations, systemSettings } from "../drizzle/schema";
import { fingerprintFromLog } from "./shopCheckoutRules";
import { consentFromLog, localeFromLog, participantsFromLog, CHECKOUT_SETTINGS } from "../shared/checkoutExtras";
import { stripeConnectGateway } from "./paymentsConnect/gateway";
import { createConnectWebhookRouter, CONNECT_WEBHOOK_PATH } from "./paymentsConnect/webhookRoute";
import { MemoryAccountIndex, MemoryPaymentStore } from "./paymentsConnect/testing";
import { realShopPort } from "./paymentsConnect/shopPort";
import { activeConnectConfig } from "./paymentsConnect/activeConfig";
import { liveAllowedFor, type ConnectConfig } from "./paymentsConnect/config";
import { syncInventoryHolds } from "./inventoryHoldsDb";
import { siteUiText } from "../shared/siteUiText";

H.cur = () => {
  const t = H.T.get(getTenantIdOrDefault());
  if (!t) throw new Error(`Empresa sin estado de prueba: ${getTenantIdOrDefault()}`);
  return t;
};

const DAY = 86_400_000;
const TEST_CFG: ConnectConfig = { mode: "test", apiKey: process.env.CONNECT_STRIPE_API_KEY!, webhookSecret: process.env.CONNECT_STRIPE_WEBHOOK_SECRET! };
const CORPORATE_KEY = process.env.CP_STRIPE_API_KEY!;
const ACCT = { quantum: "acct_1QuantumSoulrise01", otra: "acct_1OtraEmpresaTest02" } as Record<string, string>;
const OWNER: Record<string, string> = { [ACCT.quantum]: "quantum", [ACCT.otra]: "otra" };

// ─── Stripe simulado en HTTP local (la pasarela REAL del Core habla con él) ──────────────────────────────────────────

interface StripeCall { path: string; auth: string; account: string; idem: string; form: Record<string, string> }
const stripeSrv = { calls: [] as StripeCall[], keys: new Map<string, { form: string; id: string }>(), n: 0, port: 0, server: null as unknown as http.Server };

function startStripe(): Promise<void> {
  stripeSrv.server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const form = Object.fromEntries(new URLSearchParams(body));
      const call: StripeCall = { path: req.url ?? "", auth: String(req.headers.authorization ?? ""), account: String(req.headers["stripe-account"] ?? ""), idem: String(req.headers["idempotency-key"] ?? ""), form };
      stripeSrv.calls.push(call);
      res.setHeader("content-type", "application/json");
      if (req.method === "POST" && call.path.startsWith("/v1/checkout/sessions")) {
        // Como Stripe: la misma clave con los MISMOS parámetros devuelve la misma sesión; con otros, error de idempotencia
        const seen = stripeSrv.keys.get(call.idem);
        if (seen && seen.form !== body) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: { type: "idempotency_error", message: "Keys for idempotent requests can only be used with the same parameters they were first used with." } }));
          return;
        }
        const id = seen?.id ?? `cs_test_${++stripeSrv.n}`;
        if (!seen) stripeSrv.keys.set(call.idem, { form: body, id });
        res.end(JSON.stringify({ id, object: "checkout.session", url: `https://checkout.stripe.test/c/pay/${id}` }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { type: "invalid_request_error", message: "ruta inesperada" } }));
    });
  });
  return new Promise((r) => stripeSrv.server.listen(0, "127.0.0.1", () => { stripeSrv.port = (stripeSrv.server.address() as AddressInfo).port; r(); }));
}
const sessionsFor = (acct?: string) => stripeSrv.calls.filter((c) => c.path.startsWith("/v1/checkout/sessions") && (!acct || c.account === acct));

// ─── BD simulada por empresa ─────────────────────────────────────────────────────────────────────────────────────────

const dialect = new MySqlDialect();

function makeDb(t: any): any {
  const paramsOf = (cond: any): any[] => (cond ? (dialect.sqlToQuery(cond).params as any[]) : []);
  const matchRes = (cond: any) => {
    const params = paramsOf(cond);
    const strs = params.filter((p) => typeof p === "string") as string[];
    const nums = params.filter((p) => typeof p === "number") as number[];
    let rows: any[] = t.res;
    const mo = strs.find((s) => t.res.some((r: any) => r.merchantOrder === s));
    if (mo) rows = rows.filter((r) => r.merchantOrder === mo);
    else if (nums.length) rows = rows.filter((r) => nums.includes(r.id));
    if (strs.includes("pending_payment")) rows = rows.filter((r) => r.status === "pending_payment");
    if (strs.includes("ONLINE_DIRECTO")) rows = rows.filter((r) => r.channel === "ONLINE_DIRECTO");
    return rows;
  };
  const rowsOf = (table: any, cond: any): any[] => {
    if (table === reservations) return matchRes(cond).map((r) => ({ ...r }));
    if (table === discountCodes) return t.code ? [{ ...t.code, origin: "manual", compensationVoucherId: null }] : [];
    if (table === discountCodeUses) {
      const [codeId, resId] = paramsOf(cond);
      return t.uses.filter((u: any) => u.discountCodeId === codeId && u.reservationId === resId);
    }
    if (table === systemSettings) return t.settings;
    if (table === experienceVariants) return t.variants[paramsOf(cond)[0]] ?? [];
    if (table === experiences) {
      const p = t.products[paramsOf(cond)[0]];
      return p ? [p] : [];
    }
    return [];
  };
  const edition = (id: number) => t.editions.find((e: any) => e.id === id);
  const holdRows = (f: (r: any) => boolean) => t.res.filter(f).map((r: any) => ({ ...r }));
  const ok = (n: number): [any] => [{ affectedRows: n }];

  function exec(q: any): [any] {
    const { sql: raw, params } = dialect.sqlToQuery(q);
    const s = raw.replace(/\s+/g, " ").trim();
    const p = params as any[];
    if (s.startsWith("SELECT * FROM product_editions WHERE experience_id")) return [t.editions.filter((e: any) => e.experience_id === p[0]).map((e: any) => ({ ...e }))];
    if (s.startsWith("SELECT capacity, reserved FROM product_editions")) return [[{ ...edition(p[0]) }]];
    if (s.startsWith("UPDATE product_editions SET reserved = reserved + ?, updated_at = ? WHERE id = ? AND experience_id = ?")) {
      const [seats, , id, exp, startsAfter, seats2] = p;
      const e = edition(id);
      if (!e || e.experience_id !== exp || e.status !== "open" || !(e.starts_at > startsAfter)) return ok(0);
      if (e.capacity != null && e.reserved + seats2 > e.capacity) return ok(0);
      e.reserved += seats;
      return ok(1);
    }
    if (s.startsWith("UPDATE product_editions SET reserved = reserved + ?, updated_at = ? WHERE id = ? AND status <> 'cancelled'")) {
      const [units, , id, units2] = p;
      const e = edition(id);
      if (!e || e.status === "cancelled" || (e.capacity != null && e.reserved + units2 > e.capacity)) return ok(0);
      e.reserved += units;
      return ok(1);
    }
    if (s.startsWith("UPDATE product_editions SET reserved = GREATEST(reserved - ?, 0)")) {
      const e = edition(p[2]);
      if (e) e.reserved = Math.max(0, e.reserved - p[0]);
      return ok(1);
    }
    if (/^SELECT .* FROM reservations WHERE inventory_kind = 'edition_seat' AND inventory_ref_id = \? AND hold_status IN/.test(s)) {
      return [holdRows((r) => r.inventory_kind === "edition_seat" && r.inventory_ref_id === p[0] && ["retenida", "confirmada"].includes(r.hold_status ?? ""))];
    }
    if (s.startsWith("SELECT id, status, inventory_kind") && s.includes("FROM reservations WHERE id = ?")) return [holdRows((r) => r.id === p[0])];
    if (s.startsWith("SELECT id, status, inventory_kind") && s.includes("WHERE inventory_kind IS NOT NULL AND (")) {
      const now = p[0];
      return [holdRows((r) => r.inventory_kind != null && (
        (["retenida", "confirmada"].includes(r.hold_status ?? "") && ["cancelled", "failed"].includes(r.status)) ||
        (r.hold_status === "retenida" && (r.status === "paid" || (r.hold_expires_at ?? Infinity) <= now)) ||
        (r.hold_status === "liberada" && r.status === "paid")))];
    }
    if (s.startsWith("SELECT id FROM reservations WHERE merchant_order = ? AND inventory_kind IS NOT NULL")) return [holdRows((r) => r.merchant_order === p[0] && r.inventory_kind != null).map((r: any) => ({ id: r.id }))];
    if (s.startsWith("UPDATE reservations SET inventory_kind = 'edition_seat'")) {
      const r = t.res.find((x: any) => x.id === p[3]);
      Object.assign(r, { inventory_kind: "edition_seat", inventory_ref_id: p[0], inventory_units: p[1], hold_status: "retenida", hold_expires_at: p[2], hold_release_reason: null });
      return ok(1);
    }
    if (s.startsWith("UPDATE reservations SET hold_status = 'liberada'")) {
      const r = t.res.find((x: any) => x.id === p[2]);
      if (!["retenida", "confirmada"].includes(r.hold_status ?? "")) return ok(0);
      r.hold_status = "liberada";
      r.hold_release_reason = p[0];
      return ok(1);
    }
    if (s.startsWith("UPDATE reservations SET hold_status = ?")) {
      t.res.find((x: any) => x.id === p[2]).hold_status = p[0];
      return ok(1);
    }
    if (s.startsWith("UPDATE reservations SET status = 'cancelled'")) {
      let n = 0;
      for (const r of t.res) if (r.merchant_order === p[1] && r.status === "pending_payment") (r.status = "cancelled"), n++;
      return ok(n);
    }
    if (s.startsWith("UPDATE reservations SET variant_id = ?")) {
      t.res.find((x: any) => x.id === p[1]).variantId = p[0];
      return ok(1);
    }
    // LMS
    if (s.startsWith("SELECT id, product_id, variant_id, customer_name, customer_email, amount_paid, amount_total FROM reservations WHERE merchant_order = ?")) {
      return [t.res.filter((r: any) => r.merchantOrder === p[0] && r.status === "paid").map((r: any) => ({ id: r.id, product_id: r.productId, variant_id: r.variantId, customer_name: r.customerName, customer_email: r.customerEmail, amount_paid: r.amountPaid, amount_total: r.amountTotal }))];
    }
    if (s.startsWith("SELECT order_id, user_id FROM learning_enrollments WHERE source = 'payment' AND idempotency_key NOT LIKE 'pay:order-supplement:%' AND order_id IN")) {
      return [t.enrol.filter((e: any) => p.includes(e.order_id)).map((e: any) => ({ order_id: e.order_id, user_id: e.user_id }))];
    }
    if (s.startsWith("SELECT e.id AS id, e.status AS status FROM learning_enrollments e JOIN reservations r")) {
      const ids = new Set(t.res.filter((r: any) => r.merchantOrder === p[0]).map((r: any) => r.id));
      return [t.enrol.filter((e: any) => ids.has(e.order_id)).map((e: any) => ({ id: e.id, status: e.status }))];
    }
    if (s.startsWith("SELECT detail FROM learning_access_events WHERE enrollment_id = ?")) {
      const e = t.enrol.find((x: any) => x.id === p[0]);
      return [[{ detail: JSON.stringify({ reason: e?.suspendedWhy ?? "" }) }]];
    }
    if (s.startsWith("SELECT changes_log FROM reservations WHERE merchant_order = ?")) return [t.res.filter((r: any) => r.merchantOrder === p[0]).slice(0, 1).map((r: any) => ({ changes_log: r.changesLog }))];
    // Suplementos pagados (0091): este circuito no concede Lifetime; solo se simula que no hay filas
    if (s.includes("order_supplement_lines") && (s.startsWith("SELECT") || s.startsWith("UPDATE"))) return s.startsWith("SELECT") ? [[]] : ok(0);
    if (s.startsWith("INSERT IGNORE INTO order_supplement_lines")) return ok(1);
    if (s.startsWith("SELECT supplement_variant_id AS s, programme_variant_id AS p FROM supplement_variant_scope")) return [[]];
    throw new Error("SQL no simulado: " + s);
  }

  const query = (table: any, cond: any) => {
    const rows = rowsOf(table, cond);
    const p: any = Promise.resolve(rows);
    p.limit = async () => rows.slice(0, 1);
    p.orderBy = () => p;
    return p;
  };
  const fake: any = {
    execute: async (q: any) => {
      await Promise.resolve();
      return exec(q);
    },
    select: () => ({ from: (table: any) => ({ where: (cond: any) => query(table, cond), then: undefined }) }),
    update: (table: any) => ({
      set: (v: any) => ({
        where: async (cond: any) => {
          if (table === discountCodes) {
            const c = t.code;
            const okU = c.maxUses === null || c.currentUses < c.maxUses;
            if (okU) c.currentUses++;
            return [{ affectedRows: okU ? 1 : 0 }];
          }
          if (table === reservations) {
            const rows = matchRes(cond);
            for (const r of rows) Object.assign(r, v);
            return [{ affectedRows: rows.length }];
          }
          return [{ affectedRows: 1 }];
        },
      }),
    }),
    insert: (table: any) => ({ values: async (v: any) => { if (table === discountCodeUses) t.uses.push(v); } }),
    transaction: async (fn: any) => fn(fake),
  };
  return fake;
}

function newTenant(id: string) {
  const t: any = {
    id, products: {}, variants: {}, editions: [], res: [], nextRes: 1, seq: 0, code: null, uses: [], settings: [], rules: [], enrol: [],
    lost: [] as string[], restored: [] as string[], invoices: [] as string[], store: new MemoryPaymentStore(),
  };
  t.db = makeDb(t);
  return t;
}

async function connectAccountFor(t: any, mode: "test", accountId: string) {
  await t.store.insertAccount(mode, accountId, Date.now(), null);
  await t.store.updateAccount(mode, { status: "verificada", chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, requirementsDue: [], disabledReason: null, now: Date.now() });
  await t.store.setOnline(mode, true, Date.now(), null);
}

// ─── Receptor del webhook REAL (firma del SDK) ───────────────────────────────────────────────────────────────────────

let webhookPort = 0;
let webhookServer: http.Server;
function startWebhook(): Promise<void> {
  const app = express();
  app.use(
    createConnectWebhookRouter({
      configs: () => [TEST_CFG],
      tenantOfAccount: async (a) => OWNER[a] ?? null,
      tenantAllowed: async () => true,
      runInTenant: (id, fn) => runWithTenant(id, fn),
      paymentsFor: (tenantId, cfg) => H.deps(tenantId, cfg),
    }),
  );
  webhookServer = http.createServer(app);
  return new Promise((r) => webhookServer.listen(0, "127.0.0.1", () => { webhookPort = (webhookServer.address() as AddressInfo).port; r(); }));
}
let evSeq = 0;
async function deliver(ev: Record<string, unknown>, o: { secret?: string } = {}): Promise<{ status: number; json: any }> {
  const body = JSON.stringify(ev);
  const sig = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: o.secret ?? TEST_CFG.webhookSecret });
  const r = await fetch(`http://127.0.0.1:${webhookPort}${CONNECT_WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": sig }, body });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const sessionEvent = (type: string, session: string, mo: string, amount: number, over: { account?: string; tenant?: string; id?: string; pi?: string; paid?: boolean } = {}) => ({
  id: over.id ?? `evt_${++evSeq}`, type, livemode: false, account: over.account ?? ACCT.quantum, created: Math.floor(Date.now() / 1000),
  data: { object: { id: session, payment_status: over.paid === false ? "unpaid" : "paid", amount_total: amount, currency: "eur", payment_intent: over.pi ?? `pi_${session}`, metadata: { tenant_id: over.tenant ?? "quantum", merchant_order: mo } } },
});
const chargeEvent = (type: string, pi: string, over: Record<string, unknown>, account = ACCT.quantum) => ({ id: `evt_${++evSeq}`, type, livemode: false, account, data: { object: { id: "ch_1", payment_intent: pi, currency: "eur", ...over } } });

// ─── Helpers de escenario ────────────────────────────────────────────────────────────────────────────────────────────

const caller = () =>
  appRouter.createCaller({
    user: null,
    req: { protocol: "https", headers: {}, socket: {} } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  });
const as = <T>(tenant: string, fn: () => T) => runWithTenant(tenant, fn);
const Q = () => H.T.get("quantum");

const RETIRO = 10;
const VIDEO = 11; // RECONNECT con variante y matrícula
const buyer = (over: Record<string, unknown> = {}) => ({ customerName: "Lena Beispiel", customerEmail: "lena@example.invalid", origin: "https://quantum.example.invalid", provider: "stripe" as const, ...over });
const line = (productId: number, over: Record<string, unknown> = {}) => ({ productId, bookingDate: "", people: 2, extras: [] as any, ...over });
const checkout = (items: any[], over: Record<string, unknown> = {}, tenant = "quantum") => as(tenant, () => caller().reservations.cartCheckout({ ...buyer(), consentAccepted: true, items, ...over }));
const sessionOf = (url: string) => url.split("/").pop()!;
const orderRows = (mo: string, tenant = "quantum") => H.T.get(tenant).res.filter((r: any) => r.merchantOrder === mo);
const reserved = (id = 1) => Q().editions.find((e: any) => e.id === id).reserved;
const edition = (over: Record<string, unknown> = {}) => ({ id: 1, experience_id: RETIRO, label: "Retiro de primavera", starts_at: Date.now() + 30 * DAY, ends_at: Date.now() + 33 * DAY, timezone: "Europe/Madrid", location_note: "Casa de retiros", capacity: 6, reserved: 0, status: "open", price_override: "450.00", ...over });
const code = (over: Record<string, unknown> = {}) => ({ id: 7, code: "AMIGOS", discountType: "percent", discountPercent: "10.00", discountAmount: null, status: "active", expiresAt: null, maxUses: 1, currentUses: 0, ...over });
const useCoupon = { discountCodeId: 7, discountCode: "AMIGOS" };

function seedQuantum() {
  const t = newTenant("quantum");
  H.T.set("quantum", t);
  t.products[RETIRO] = { id: RETIRO, title: "Retiro Quantum", basePrice: "500.00", pricingType: "per_person", isActive: true, isPublished: true, offerMode: "fixed", minPersons: 1, maxPersons: null };
  t.variants[RETIRO] = [
    { id: 101, priceType: "fixed", priceModifier: "480.00", name: "Individual", minQty: null, maxQty: 1 },
    { id: 102, priceType: "per_person", priceModifier: "400.00", name: "Desde 2 participantes", minQty: 2, maxQty: null },
    { id: 103, priceType: "percentage", priceModifier: "12.50", name: "Habitación individual (+12,5 %)", minQty: null, maxQty: null },
  ];
  t.products[VIDEO] = { id: VIDEO, title: "RECONNECT", basePrice: "0.00", pricingType: "per_person", isActive: true, isPublished: true, offerMode: "fixed", minPersons: 1, maxPersons: null };
  t.variants[VIDEO] = [
    { id: 201, priceType: "fixed", priceModifier: "49.00", name: "RECONNECT ON DEMAND", minQty: null, maxQty: 1 },
    { id: 202, priceType: "fixed", priceModifier: "290.00", name: "RECONNECT LIVE", minQty: null, maxQty: 1 },
  ];
  t.rules = [{ id: 1, active: true, experienceId: VIDEO, variantId: 201 }]; // LIVE no tiene matrícula
  t.editions.push(edition());
  t.code = code();
  t.settings = [
    { key: CHECKOUT_SETTINGS.consentRequired, value: "true" },
    { key: CHECKOUT_SETTINGS.termsUrl, value: "/agb" },
    { key: CHECKOUT_SETTINGS.privacyUrl, value: "/datenschutz" },
    { key: CHECKOUT_SETTINGS.participants, value: "true" },
  ];
  return t;
}

beforeAll(async () => {
  await startStripe();
  await startWebhook();
  H.deps = (tenantId: string, config: ConnectConfig) => ({
    store: H.T.get(tenantId).store,
    gateway: stripeConnectGateway(config, { host: "127.0.0.1", port: stripeSrv.port, protocol: "http", maxNetworkRetries: 0 }),
    config,
    quotes: { byToken: async () => null, markPaid: async () => {}, noteIncident: async () => {} },
    shop: realShopPort(),
    index: new MemoryAccountIndex(),
    tenantId,
  });
});
afterAll(async () => {
  await new Promise<void>((r) => stripeSrv.server.close(() => r()));
  await new Promise<void>((r) => webhookServer.close(() => r()));
});

beforeEach(async () => {
  H.mails.length = 0;
  H.alerts.length = 0;
  stripeSrv.calls.length = 0;
  stripeSrv.keys.clear();
  stripeSrv.n = 0;
  H.T.clear();
  const q = seedQuantum();
  await connectAccountFor(q, "test", ACCT.quantum);
  const o = newTenant("otra");
  H.T.set("otra", o);
  await connectAccountFor(o, "test", ACCT.otra);
  o.products[RETIRO] = { ...q.products[RETIRO], title: "Retiro de OTRA empresa" };
  o.editions.push(edition({ id: 1, capacity: 1 }));
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("1. compra completa de un retiro con edición, variante «desde 2 participantes», cupón, condiciones y participantes", () => {
  it("precio, plazas, huella, consentimiento y sesión SOLO en la cuenta conectada; el webhook paga una vez y cierra el circuito", async () => {
    const r = await checkout([line(RETIRO, { people: 2, variantId: 102, editionId: 1, participants: ["  Lena Beispiel ", "Jonas Muster", "Sobrante"] })], { ...useCoupon, consentAccepted: true, locale: "de-AT" });
    // Precio: la opción de importe fijo sustituye al precio de la edición (400 € × 2 = 800 €); cupón 10 % → 720 €
    expect(r.totalAmountCents).toBe(80000);
    const mo = r.merchantOrder;
    const rows = orderRows(mo);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amountTotal: 80000, bookingDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), inventory_kind: "edition_seat", inventory_ref_id: 1, inventory_units: 2, hold_status: "retenida", variantId: 102, });
    expect(rows[0].notes).toContain("Convocatoria: Retiro de primavera");
    expect(reserved()).toBe(2);
    // Huella e historial: huella, cupón (importes en céntimos), idioma, aceptación (huella del texto, IP) y participantes recortados
    const log = rows[0].changesLog;
    expect(fingerprintFromLog(log)).toMatch(/^[0-9a-f]{40}$/);
    expect(JSON.parse(log.find((e: any) => e.action === "descuento_codigo").to)).toMatchObject({ id: 7, discountCents: 8000, originalCents: 80000, finalCents: 72000 });
    expect(localeFromLog(log)).toBe("de");
    const consent = consentFromLog(log)!;
    expect(consent.textHash).toMatch(/^[0-9a-f]{64}$/);
    expect(consent.locale).toBe("de");
    expect(consent.urls).toMatchObject({ terms: "/agb", privacy: "/datenschutz" });
    expect(participantsFromLog(log)).toEqual(["Lena Beispiel", "Jonas Muster"]);
    // El cupón NO se consume al crear el pedido
    expect(Q().code.currentUses).toBe(0);
    expect(Q().uses).toHaveLength(0);
    // Sesión de Stripe: una sola, en la cuenta conectada de Quantum, con la clave de la plataforma Connect y nunca la corporativa
    const calls = sessionsFor();
    expect(calls).toHaveLength(1);
    expect(calls[0].account).toBe(ACCT.quantum);
    expect(calls[0].auth).toBe(`Bearer ${TEST_CFG.apiKey}`);
    expect(stripeSrv.calls.every((c) => !c.auth.includes(CORPORATE_KEY) && !c.auth.includes("sk_live"))).toBe(true);
    expect(calls[0].form["line_items[0][price_data][unit_amount]"]).toBe("72000");
    expect(calls[0].form["line_items[0][price_data][currency]"]).toBe("eur");
    expect(calls[0].form["metadata[merchant_order]"]).toBe(mo);
    expect(calls[0].form["metadata[tenant_id]"]).toBe("quantum");
    expect(r.stripeUrl).toMatch(/^https:\/\/checkout\.stripe\.test\/c\/pay\/cs_test_1$/);
    const session = sessionOf(r.stripeUrl!);
    expect((await Q().store.getCheckout(session))).toMatchObject({ kind: "shop_order", merchantOrder: mo, amountCents: 72000, accountId: ACCT.quantum, status: "pending" });
    // Pendiente: ni pagada, ni factura, ni matrícula, ni correo
    expect(rows[0].status).toBe("pending_payment");
    expect(Q().invoices).toHaveLength(0);
    expect(H.mails).toHaveLength(0);

    // Webhook firmado
    const ev = sessionEvent("checkout.session.completed", session, mo, 72000, { pi: "pi_retiro_1" });
    expect((await deliver(ev)).json).toMatchObject({ outcome: "applied" });
    expect(rows[0].status).toBe("paid");
    expect(rows[0].hold_status).toBe("confirmada");
    expect(reserved()).toBe(2); // la confirmación no mueve el contador
    expect(Q().code.currentUses).toBe(1);
    expect(Q().uses).toHaveLength(1);
    expect(Q().uses[0]).toMatchObject({ discountCodeId: 7, channel: "online", reservationId: rows[0].id, finalAmount: "720.00", discountAmount: "80.00" });
    expect(Q().invoices).toEqual([mo]);
    // Correo al comprador en SU idioma (alemán) con los participantes
    expect(H.mails).toHaveLength(1);
    expect(H.mails[0].subject).toContain(siteUiText("de").emConfirmedSubject);
    expect(H.mails[0].subject).not.toContain(siteUiText("es").emConfirmedSubject);
    expect(H.mails[0].html).toContain("Jonas Muster");
    expect(H.mails[0].recipientEmail).toBe("lena@example.invalid");

    // Repeticiones: mismo evento, otro id y otro tipo para el mismo pago → nada se duplica
    expect((await deliver(ev)).json).toMatchObject({ outcome: "duplicate" });
    expect((await deliver(sessionEvent("checkout.session.completed", session, mo, 72000, { pi: "pi_retiro_1" }))).json).toMatchObject({ outcome: "duplicate" });
    expect((await deliver(sessionEvent("checkout.session.async_payment_succeeded", session, mo, 72000, { pi: "pi_retiro_1" }))).json).toMatchObject({ outcome: "duplicate" });
    expect(Q().code.currentUses).toBe(1);
    expect(Q().uses).toHaveLength(1);
    expect(H.mails).toHaveLength(1);
    expect(Q().invoices).toHaveLength(1);
    expect(reserved()).toBe(2);
  });

  it("la edición compone con una opción porcentual (se calcula sobre el precio de la edición) y sin opción usa el precio de la edición", async () => {
    const pct = await checkout([line(RETIRO, { people: 2, variantId: 103, editionId: 1 })]);
    expect(pct.totalAmountCents).toBe(2 * 50625); // 450 € + 12,5 % = 506,25 € por persona
    const plain = await checkout([line(RETIRO, { people: 3, editionId: 1 })], { customerEmail: "otra-persona@example.invalid" });
    expect(plain.totalAmountCents).toBe(3 * 45000);
    expect(sessionsFor().map((c) => c.form["line_items[0][price_data][unit_amount]"])).toEqual(["101250", "135000"]);
  });

  it("límites de la opción frente a la edición: «desde 2» con 1 persona y «individual» con 2 se rechazan antes de retener plazas", async () => {
    await expect(checkout([line(RETIRO, { people: 1, variantId: 102, editionId: 1 })])).rejects.toThrow(/al menos 2 participantes/);
    await expect(checkout([line(RETIRO, { people: 2, variantId: 101, editionId: 1 })])).rejects.toThrow(/como máximo 1 participante/);
    expect(reserved()).toBe(0);
    expect(Q().res).toHaveLength(0);
    expect(sessionsFor()).toHaveLength(0);
  });

  it("sin aceptar las condiciones (la empresa las exige) no se crea pedido, ni plazas, ni sesión", async () => {
    await expect(checkout([line(RETIRO, { variantId: 102, editionId: 1 })], { locale: "de", consentAccepted: false })).rejects.toThrow(siteUiText("de").coConsentMissing);
    expect(Q().res).toHaveLength(0);
    expect(reserved()).toBe(0);
    expect(sessionsFor()).toHaveLength(0);
  });

  it("RECONNECT con opción: el pago concede la matrícula de ON DEMAND una sola vez y LIVE no la tiene", async () => {
    Q().settings = []; // sin condiciones ni participantes
    const od = await checkout([line(VIDEO, { people: 1, variantId: 201 })]);
    const live = await checkout([line(VIDEO, { people: 1, variantId: 202 })], { customerEmail: "live@example.invalid" });
    expect(od.totalAmountCents).toBe(4900);
    expect(live.totalAmountCents).toBe(29000);
    await deliver(sessionEvent("checkout.session.completed", sessionOf(od.stripeUrl!), od.merchantOrder, 4900));
    await deliver(sessionEvent("checkout.session.completed", sessionOf(live.stripeUrl!), live.merchantOrder, 29000));
    expect(Q().enrol).toHaveLength(1);
    expect(Q().enrol[0]).toMatchObject({ order_id: orderRows(od.merchantOrder)[0].id, status: "active" });
    expect(orderRows(live.merchantOrder)[0].status).toBe("paid");
  });
});

describe("2. doble clic y duplicados", () => {
  const same = () => checkout([line(RETIRO, { people: 2, variantId: 102, editionId: 1 })], { ...useCoupon, consentAccepted: true });

  it("dos peticiones seguidas: un pedido, una retención de plazas, un cupón por consumir y la MISMA sesión de Stripe", async () => {
    Q().code = code({ maxUses: 5 });
    const a = await same();
    await new Promise((r) => setTimeout(r, 1100)); // más de un segundo: Stripe compara los parámetros de la misma clave
    const b = await same();
    expect(b.merchantOrder).toBe(a.merchantOrder);
    expect(b.stripeUrl).toBe(a.stripeUrl);
    expect(Q().res).toHaveLength(1);
    expect(reserved()).toBe(2);
    expect(Q().code.currentUses).toBe(0);
    expect(sessionsFor().every((c) => c.account === ACCT.quantum)).toBe(true);
  });

  it("dos peticiones en paralelo (Promise.all): un solo pedido y una sola retención", async () => {
    Q().code = code({ maxUses: 5 });
    const [a, b, c] = await Promise.all([same(), same(), same()]);
    expect(new Set([a.merchantOrder, b.merchantOrder, c.merchantOrder]).size).toBe(1);
    expect(Q().res).toHaveLength(1);
    expect(reserved()).toBe(2);
    expect(new Set([a.stripeUrl, b.stripeUrl, c.stripeUrl]).size).toBe(1);
  });

  it("repetir el clic cuando el pedido ya retiene las ÚLTIMAS plazas de la edición reutiliza el pedido (no «la fecha está completa»)", async () => {
    Q().editions[0] = edition({ capacity: 2 });
    Q().code = code({ maxUses: 5 });
    const a = await same();
    expect(reserved()).toBe(2); // la edición queda llena con esta compra
    const b = await same();
    expect(b.merchantOrder).toBe(a.merchantOrder);
    expect(b.stripeUrl).toBe(a.stripeUrl);
    expect(Q().res).toHaveLength(1);
    expect(reserved()).toBe(2);
  });

  it("dos ediciones distintas del mismo producto (misma cantidad, mismo importe) NO se confunden: son dos pedidos con sus plazas", async () => {
    Q().editions.push(edition({ id: 2, label: "Retiro de otoño", starts_at: Date.now() + 90 * DAY }));
    const a = await checkout([line(RETIRO, { people: 2, variantId: 102, editionId: 1 })], { consentAccepted: true });
    const b = await checkout([line(RETIRO, { people: 2, variantId: 102, editionId: 2 })], { consentAccepted: true });
    expect(b.merchantOrder).not.toBe(a.merchantOrder);
    expect(orderRows(a.merchantOrder)[0].inventory_ref_id).toBe(1);
    expect(orderRows(b.merchantOrder)[0].inventory_ref_id).toBe(2);
    expect(reserved(1)).toBe(2);
    expect(reserved(2)).toBe(2);
  });

  it("otros nombres de participantes en el mismo carrito son otro pedido (no se arrastran los nombres del primero)", async () => {
    const a = await checkout([line(RETIRO, { people: 2, variantId: 102, editionId: 1, participants: ["A Uno", "B Dos"] })], { consentAccepted: true });
    const b = await checkout([line(RETIRO, { people: 2, variantId: 102, editionId: 1, participants: ["C Tres", "D Cuatro"] })], { consentAccepted: true });
    expect(b.merchantOrder).not.toBe(a.merchantOrder);
    expect(participantsFromLog(orderRows(b.merchantOrder)[0].changesLog)).toEqual(["C Tres", "D Cuatro"]);
  });
});

describe("3. concurrencia", () => {
  it("dos compradores a la última plaza: solo uno recibe Checkout; el otro no deja pedido ni plazas ni sesión", async () => {
    Q().editions[0] = edition({ capacity: 1 });
    Q().settings = [];
    const mk = (email: string) => checkout([line(RETIRO, { people: 1, editionId: 1 })], { customerEmail: email });
    const out = await Promise.allSettled([mk("a@example.invalid"), mk("b@example.invalid")]);
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const lost = out.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect(String(lost.reason.message)).toMatch(/completado|completa|plazas/i);
    expect(reserved()).toBe(1);
    expect(Q().res.filter((r: any) => r.hold_status === "retenida")).toHaveLength(1);
    expect(Q().res.filter((r: any) => r.status === "pending_payment")).toHaveLength(1);
    expect(sessionsFor()).toHaveLength(1);
  });

  it("dos compradores con un cupón de un solo uso: el segundo espera (pago en curso) y, con ambos pedidos ya creados, el uso no pasa del límite", async () => {
    Q().settings = [];
    const a = await checkout([line(RETIRO, { people: 1, editionId: 1 })], { ...useCoupon, customerEmail: "a@example.invalid" });
    await expect(checkout([line(RETIRO, { people: 1, editionId: 1 })], { ...useCoupon, customerEmail: "b@example.invalid" })).rejects.toThrow(/otro pago en curso/);
    expect(Q().res).toHaveLength(1);
    expect(reserved()).toBe(1);
    // El primero paga: el cupón se consume una vez
    await deliver(sessionEvent("checkout.session.completed", sessionOf(a.stripeUrl!), a.merchantOrder, 40500));
    expect(Q().code.currentUses).toBe(1);
    // El segundo, ya con el cupón agotado, ni siquiera inicia el pago
    await expect(checkout([line(RETIRO, { people: 1, editionId: 1 })], { ...useCoupon, customerEmail: "b@example.invalid" })).rejects.toThrow(/agotado/);
  });

  it("dos pagos simultáneos de pedidos que ya tenían el cupón de un solo uso: ambos se honran, el contador no pasa del límite y el exceso queda anotado", async () => {
    Q().settings = [];
    Q().code = code({ maxUses: 2 }); // dos pedidos pueden coexistir…
    const a = await checkout([line(RETIRO, { people: 1, editionId: 1 })], { ...useCoupon, customerEmail: "a@example.invalid" });
    const b = await checkout([line(RETIRO, { people: 1, editionId: 1 })], { ...useCoupon, customerEmail: "b@example.invalid" });
    Q().code.maxUses = 1; // …y el límite baja a uno antes de que paguen (p. ej. lo corrige la administración)
    const [ra, rb] = await Promise.all([
      deliver(sessionEvent("checkout.session.completed", sessionOf(a.stripeUrl!), a.merchantOrder, 40500)),
      deliver(sessionEvent("checkout.session.completed", sessionOf(b.stripeUrl!), b.merchantOrder, 40500)),
    ]);
    expect([ra.json.outcome, rb.json.outcome]).toEqual(["applied", "applied"]);
    expect(Q().code.currentUses).toBe(1);
    expect(Q().uses).toHaveLength(2);
    expect(orderRows(a.merchantOrder)[0].status).toBe("paid");
    expect(orderRows(b.merchantOrder)[0].status).toBe("paid");
    const notes = [a, b].flatMap((o) => orderRows(o.merchantOrder)[0].changesLog).filter((e: any) => e.action === "descuento_agotado_en_pago");
    expect(notes).toHaveLength(1);
  });
});

describe("4. expiración y pago tardío", () => {
  it("checkout.session.expired cancela el pedido, libera las plazas y registra la venta perdida; repetido no libera dos veces", async () => {
    const r = await checkout([line(RETIRO, { people: 2, variantId: 102, editionId: 1 })], { consentAccepted: true });
    expect(reserved()).toBe(2);
    const ev = sessionEvent("checkout.session.expired", sessionOf(r.stripeUrl!), r.merchantOrder, 80000);
    expect((await deliver(ev)).json).toMatchObject({ outcome: "applied" });
    expect(orderRows(r.merchantOrder)[0]).toMatchObject({ status: "cancelled", hold_status: "liberada" });
    expect(reserved()).toBe(0);
    expect(Q().lost).toEqual([r.merchantOrder]);
    expect((await deliver(ev)).json).toMatchObject({ outcome: "duplicate" });
    expect(reserved()).toBe(0);
    // Las plazas liberadas se pueden comprar de nuevo y un reintento del mismo carrito es un pedido NUEVO
    const again = await checkout([line(RETIRO, { people: 2, variantId: 102, editionId: 1 })], { consentAccepted: true });
    expect(again.merchantOrder).not.toBe(r.merchantOrder);
    expect(reserved()).toBe(2);
  });

  it("pago tardío tras expirar con sitio libre: el pedido pasa a pagado y las plazas se vuelven a ocupar", async () => {
    const r = await checkout([line(RETIRO, { people: 2, variantId: 102, editionId: 1 })], { consentAccepted: true });
    const session = sessionOf(r.stripeUrl!);
    await deliver(sessionEvent("checkout.session.expired", session, r.merchantOrder, 80000));
    expect(reserved()).toBe(0);
    expect((await deliver(sessionEvent("checkout.session.completed", session, r.merchantOrder, 80000))).json).toMatchObject({ outcome: "applied" });
    expect(Q().restored).toEqual([r.merchantOrder]);
    expect(orderRows(r.merchantOrder)[0]).toMatchObject({ status: "paid", hold_status: "confirmada" });
    expect(reserved()).toBe(2);
  });

  it("pago tardío tras expirar con la edición ya llena: queda en conflicto (pagada sin plaza) SIN sobrevender", async () => {
    Q().editions[0] = edition({ capacity: 2 });
    const a = await checkout([line(RETIRO, { people: 2, variantId: 102, editionId: 1 })], { consentAccepted: true });
    await deliver(sessionEvent("checkout.session.expired", sessionOf(a.stripeUrl!), a.merchantOrder, 80000));
    // Otra persona compra las dos plazas liberadas
    const b = await checkout([line(RETIRO, { people: 2, variantId: 102, editionId: 1 })], { consentAccepted: true, customerEmail: "otra@example.invalid" });
    expect(reserved()).toBe(2);
    await deliver(sessionEvent("checkout.session.completed", sessionOf(a.stripeUrl!), a.merchantOrder, 80000));
    expect(orderRows(a.merchantOrder)[0]).toMatchObject({ status: "paid", hold_status: "conflicto" });
    expect(reserved()).toBe(2); // sin sobreventa
    expect(orderRows(b.merchantOrder)[0].hold_status).toBe("retenida");
  });

  it("la limpieza periódica libera una retención caducada y el pedido sigue siendo pagable (pago tardío re-ocupa)", async () => {
    const r = await checkout([line(RETIRO, { people: 1, variantId: 103, editionId: 1 })], { consentAccepted: true });
    orderRows(r.merchantOrder)[0].hold_expires_at = Date.now() - 1000;
    expect((await as("quantum", () => syncInventoryHolds())).expired).toBe(1);
    expect(reserved()).toBe(0);
    await deliver(sessionEvent("checkout.session.completed", sessionOf(r.stripeUrl!), r.merchantOrder, 50625));
    expect(orderRows(r.merchantOrder)[0]).toMatchObject({ status: "paid", hold_status: "confirmada" });
    expect(reserved()).toBe(1);
  });
});

describe("5. reembolsos y disputas tras el pago", () => {
  async function paid(over: { variant?: number; product?: number; people?: number; amount?: number } = {}) {
    Q().settings = [];
    const product = over.product ?? VIDEO;
    const r = await checkout([line(product, { people: over.people ?? 1, variantId: over.variant ?? 201, ...(product === RETIRO ? { editionId: 1 } : {}) })]);
    const amount = over.amount ?? 4900;
    const pi = `pi_${r.merchantOrder}`;
    expect((await deliver(sessionEvent("checkout.session.completed", sessionOf(r.stripeUrl!), r.merchantOrder, amount, { pi }))).json.outcome).toBe("applied");
    return { ...r, pi, amount };
  }
  const enrol = () => Q().enrol[0];

  it("reembolso total: marca el pedido, avisa, revoca la matrícula y NO toca reservas ni plazas ni stock; el evento repetido es idempotente", async () => {
    const o = await paid();
    const ev = chargeEvent("charge.refunded", o.pi, { amount: 4900, amount_refunded: 4900, refunded: true });
    expect((await deliver(ev)).json).toMatchObject({ outcome: "refunded" });
    expect(enrol().status).toBe("revoked");
    const row = orderRows(o.merchantOrder)[0];
    expect(row.status).toBe("paid"); // el Core no cancela ni reembolsa: solo marca
    expect(row.changesLog.filter((e: any) => e.action === "stripe_refund_full")).toHaveLength(1);
    expect(H.alerts).toHaveLength(1);
    expect(H.alerts[0].title).toContain("reembolso total");
    expect(stripeSrv.calls.filter((c) => !c.path.startsWith("/v1/checkout/sessions"))).toHaveLength(0); // ninguna llamada de reembolso
    expect((await deliver(ev)).json).toMatchObject({ outcome: "duplicate" });
    expect(H.alerts).toHaveLength(1);
    expect(row.changesLog.filter((e: any) => e.action === "stripe_refund_full")).toHaveLength(1);
  });

  it("reembolso parcial: marca y avisa, la matrícula sigue activa; el resto después lo convierte en total", async () => {
    const o = await paid();
    expect((await deliver(chargeEvent("charge.refunded", o.pi, { amount: 4900, amount_refunded: 1000, refunded: false }))).json).toMatchObject({ outcome: "partial_refund" });
    expect(enrol().status).toBe("active");
    expect(orderRows(o.merchantOrder)[0].changesLog.filter((e: any) => e.action === "stripe_refund_partial")).toHaveLength(1);
    expect((await deliver(chargeEvent("charge.refunded", o.pi, { amount: 4900, amount_refunded: 4900, refunded: true }))).json).toMatchObject({ outcome: "refunded" });
    expect(enrol().status).toBe("revoked");
    expect(H.alerts).toHaveLength(2);
  });

  it("disputa abierta suspende, ganada reabre y perdida revoca (solo reabre lo suspendido por Stripe)", async () => {
    const o = await paid();
    const dispute = (type: string, status: string) => chargeEvent(type, o.pi, { id: "dp_1", amount: 4900, status, reason: "fraudulent" });
    expect((await deliver(dispute("charge.dispute.created", "needs_response"))).json).toMatchObject({ outcome: "dispute_open" });
    expect(enrol().status).toBe("suspended");
    expect((await deliver(dispute("charge.dispute.closed", "won"))).json).toMatchObject({ outcome: "dispute_won" });
    expect(enrol().status).toBe("active");
    // Una suspensión MANUAL no se reabre con una disputa ganada
    enrol().status = "suspended";
    enrol().suspendedWhy = "Suspendida por la administración";
    await deliver(dispute("charge.dispute.closed", "won"));
    expect(enrol().status).toBe("suspended");
    expect((await deliver(dispute("charge.dispute.closed", "lost"))).json).toMatchObject({ outcome: "dispute_lost" });
    expect(enrol().status).toBe("revoked");
  });

  it("un retiro con edición pagado y reembolsado: la plaza confirmada y el contador NO cambian (decisión manual de la administración)", async () => {
    Q().code = null;
    Q().settings = [];
    const r = await checkout([line(RETIRO, { people: 2, variantId: 102, editionId: 1 })]);
    const pi = "pi_retiro_refund";
    await deliver(sessionEvent("checkout.session.completed", sessionOf(r.stripeUrl!), r.merchantOrder, 80000, { pi }));
    expect((await deliver(chargeEvent("charge.refunded", pi, { amount: 80000, amount_refunded: 80000, refunded: true }))).json).toMatchObject({ outcome: "refunded" });
    expect(orderRows(r.merchantOrder)[0]).toMatchObject({ status: "paid", hold_status: "confirmada" });
    expect(reserved()).toBe(2);
    expect(Q().invoices).toEqual([r.merchantOrder]); // no se emite nada nuevo
  });

  it("un cobro desconocido se ignora y un evento de otra cuenta queda aislado", async () => {
    const o = await paid();
    expect((await deliver(chargeEvent("charge.refunded", "pi_ajeno", { amount_refunded: 100, amount: 100 }))).json).toMatchObject({ outcome: "ignored" });
    expect((await deliver(chargeEvent("charge.refunded", o.pi, { amount_refunded: 4900, amount: 4900, refunded: true }, ACCT.otra))).json).toMatchObject({ outcome: "ignored" }); // en la base de la otra empresa ese cobro no existe
    expect(enrol().status).toBe("active");
    expect(H.alerts).toHaveLength(0);
  });
});

describe("6. aislamiento multiempresa", () => {
  it("un evento de otra cuenta conectada (con el pedido de Quantum) no lo paga ni lo toca; un metadato de otra empresa tampoco", async () => {
    const r = await checkout([line(RETIRO, { people: 2, variantId: 102, editionId: 1 })], { consentAccepted: true });
    const session = sessionOf(r.stripeUrl!);
    expect((await deliver(sessionEvent("checkout.session.completed", session, r.merchantOrder, 80000, { account: ACCT.otra, tenant: "otra" }))).json).toMatchObject({ outcome: "isolated" });
    expect((await deliver(sessionEvent("checkout.session.completed", session, r.merchantOrder, 80000, { tenant: "otra" }))).json).toMatchObject({ outcome: "isolated" });
    expect(orderRows(r.merchantOrder)[0].status).toBe("pending_payment");
    expect(Q().uses).toHaveLength(0);
    expect(H.mails).toHaveLength(0);
    expect(reserved()).toBe(2);
  });

  it("con una firma que no es la del destino Connect no se aplica nada", async () => {
    const r = await checkout([line(RETIRO, { people: 2, variantId: 102, editionId: 1 })], { consentAccepted: true });
    const bad = await deliver(sessionEvent("checkout.session.completed", sessionOf(r.stripeUrl!), r.merchantOrder, 80000), { secret: ["whsec", "x".repeat(32)].join("_") });
    expect(bad.status).toBe(400);
    expect(orderRows(r.merchantOrder)[0].status).toBe("pending_payment");
  });

  it("un producto o una edición de otra empresa da NOT_FOUND / no corresponde, sin retener nada", async () => {
    // El producto 99 solo existe en la base de «otra»
    H.T.get("otra").products[99] = { ...Q().products[RETIRO], id: 99 };
    await expect(checkout([line(99, { editionId: 1 })])).rejects.toMatchObject({ code: "NOT_FOUND" });
    // La edición 1 de «otra» (capacidad 1) no es la de Quantum: se compra con la de Quantum, y la de «otra» no se mueve
    Q().settings = [];
    await checkout([line(RETIRO, { people: 2, editionId: 1 })]);
    expect(reserved()).toBe(2);
    expect(H.T.get("otra").editions[0].reserved).toBe(0);
    // Una edición de OTRO producto de la misma empresa se rechaza
    Q().editions.push(edition({ id: 5, experience_id: VIDEO }));
    await expect(checkout([line(RETIRO, { people: 1, editionId: 5 })], { customerEmail: "x@example.invalid" })).rejects.toThrow(/no corresponde/);
  });

  it("los consentimientos y las huellas no cruzan empresas: el mismo carrito del mismo comprador en dos empresas son dos pedidos independientes", async () => {
    Q().settings = [{ key: CHECKOUT_SETTINGS.consentRequired, value: "true" }];
    const O = H.T.get("otra");
    O.settings = [];
    O.editions[0] = edition({ capacity: 6 });
    const a = await checkout([line(RETIRO, { people: 2, editionId: 1 })], { consentAccepted: true });
    const b = await checkout([line(RETIRO, { people: 2, editionId: 1 })], { consentAccepted: true }, "otra");
    expect(orderRows(a.merchantOrder)).toHaveLength(1);
    expect(orderRows(b.merchantOrder, "otra")).toHaveLength(1);
    expect(consentFromLog(orderRows(a.merchantOrder)[0].changesLog)).not.toBeNull();
    expect(consentFromLog(orderRows(b.merchantOrder, "otra")[0].changesLog)).toBeNull(); // «otra» no exige condiciones
    // Cada sesión, en su cuenta conectada
    expect(sessionsFor(ACCT.quantum)).toHaveLength(1);
    expect(sessionsFor(ACCT.otra)).toHaveLength(1);
    // Pagar uno no toca el otro
    await deliver(sessionEvent("checkout.session.completed", sessionOf(a.stripeUrl!), a.merchantOrder, 90000));
    expect(orderRows(a.merchantOrder)[0].status).toBe("paid");
    expect(orderRows(b.merchantOrder, "otra")[0].status).toBe("pending_payment");
  });
});

describe("7. productos que no se pueden vender online", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["bajo petición", { offerMode: "on_request" }],
    ["precio visible solo por solicitud", { offerMode: "priced_request" }],
    ["próximamente", { offerMode: "coming_soon" }],
    ["inactivo", { isActive: false }],
    ["sin publicar", { isPublished: false }],
  ];
  for (const [name, over] of cases) {
    it(`${name}: ni plazas ni Checkout aunque tenga edición abierta`, async () => {
      Q().products[RETIRO] = { ...Q().products[RETIRO], ...over };
      await expect(checkout([line(RETIRO, { editionId: 1, variantId: 102 })], { consentAccepted: true })).rejects.toThrow();
      expect(Q().res).toHaveLength(0);
      expect(reserved()).toBe(0);
      expect(sessionsFor()).toHaveLength(0);
    });
  }

  it("producto con ediciones pero ninguna abierta (cerrada, borrador, ya empezada o cancelada): no entra al carrito", async () => {
    for (const over of [{ status: "closed" }, { status: "draft" }, { status: "cancelled" }, { starts_at: Date.now() - DAY }]) {
      Q().editions[0] = edition(over);
      await expect(checkout([line(RETIRO, { editionId: 1, variantId: 102 })], { consentAccepted: true })).rejects.toThrow(/no tiene fechas abiertas/);
      await expect(checkout([line(RETIRO, { variantId: 102 })], { consentAccepted: true })).rejects.toThrow(/no tiene fechas abiertas/);
    }
    expect(Q().res).toHaveLength(0);
    expect(sessionsFor()).toHaveLength(0);
  });

  it("con ediciones abiertas, sin elegir fecha no se paga; una edición llena se rechaza con aviso", async () => {
    await expect(checkout([line(RETIRO, { variantId: 102 })], { consentAccepted: true })).rejects.toThrow(/Elige la fecha/);
    Q().editions[0] = edition({ capacity: 2, reserved: 2 });
    await expect(checkout([line(RETIRO, { editionId: 1, variantId: 102 })], { consentAccepted: true })).rejects.toThrow(/completa/);
    expect(Q().res).toHaveLength(0);
  });

  it("un carrito con un producto vendible y otro no vendible no deja plazas retenidas del primero", async () => {
    Q().products[VIDEO] = { ...Q().products[VIDEO], offerMode: "on_request" };
    await expect(checkout([line(RETIRO, { editionId: 1, variantId: 102 }), line(VIDEO, { people: 1, variantId: 201 })], { consentAccepted: true })).rejects.toThrow();
    expect(reserved()).toBe(0);
    expect(Q().res).toHaveLength(0);
  });

  it("carrito de dos líneas con una edición que se llena a mitad de crear el pedido: se anula la primera línea y no queda nada retenido", async () => {
    Q().settings = [];
    Q().editions.push(edition({ id: 2, label: "Otra fecha", capacity: 1, reserved: 0 }));
    // la segunda edición se llena justo entre la validación y la retención
    const real = Q().db.execute;
    let first = true;
    Q().db.execute = async (q: any) => {
      const { sql: text, params } = dialect.sqlToQuery(q);
      if (first && text.includes("UPDATE product_editions SET reserved = reserved + ?") && (params as any[])[2] === 2) {
        first = false;
        Q().editions[1].reserved = 1; // otro comprador se lleva la última plaza justo antes de retenerla
      }
      return real(q);
    };
    await expect(checkout([line(RETIRO, { people: 2, editionId: 1 }), line(RETIRO, { people: 1, editionId: 2 })], { customerEmail: "dos@example.invalid" })).rejects.toThrow();
    Q().db.execute = real;
    expect(reserved(1)).toBe(0);
    expect(Q().res.every((r: any) => r.status === "cancelled" && r.hold_status === "liberada")).toBe(true);
    expect(sessionsFor()).toHaveLength(0);
  });
});

describe("8. modo Prueba oculto al público en production y cobro real apagado", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });
  const liveEnv = () => {
    process.env.CONNECT_STRIPE_LIVE_API_KEY = ["rk", "live", "L".repeat(24)].join("_");
    process.env.CONNECT_STRIPE_LIVE_WEBHOOK_SECRET = ["whsec", "L".repeat(32)].join("_");
    process.env.CONNECT_STRIPE_LIVE_CLIENT_ID = ["ca", "C".repeat(24)].join("_");
    process.env.CONNECT_STRIPE_LIVE_TENANTS = "quantum";
  };

  it("en production, una empresa autorizada para Real sin cobro real listo NO expone Prueba: ni Stripe público ni Checkout", async () => {
    liveEnv();
    process.env.NODE_ENV = "production";
    Q().settings = [];
    expect(await as("quantum", () => activeConnectConfig())).toBeNull();
    await expect(checkout([line(RETIRO, { editionId: 1, variantId: 102 })])).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const theme = await as("quantum", async () => (await import("./paymentsConnect/publicApi")).stripeAvailableForPublic());
    expect(theme).toBe(false);
    expect(Q().res).toHaveLength(0);
    expect(reserved()).toBe(0);
    expect(stripeSrv.calls).toHaveLength(0);
  });

  it("fuera de production se conserva Prueba y una empresa NO autorizada para Real mantiene Prueba también en production", async () => {
    liveEnv();
    process.env.NODE_ENV = "development";
    expect((await as("quantum", () => activeConnectConfig()))?.mode).toBe("test");
    process.env.NODE_ENV = "production";
    expect((await as("otra", () => activeConnectConfig()))?.mode).toBe("test");
  });

  it("con el cobro real apagado (sin variables LIVE) no existe configuración real para ninguna empresa y todo Checkout usa la cuenta de Prueba", async () => {
    expect(liveAllowedFor("quantum")).toBeNull();
    expect(liveAllowedFor("otra")).toBeNull();
    Q().settings = [];
    await checkout([line(RETIRO, { people: 1, editionId: 1 })]);
    expect(sessionsFor().every((c) => c.auth === `Bearer ${TEST_CFG.apiKey}` && c.account === ACCT.quantum)).toBe(true);
    expect(stripeSrv.calls.some((c) => c.auth.includes("rk_live") || c.auth.includes("sk_live"))).toBe(false);
  });

  it("un evento live (livemode) no se aplica con la configuración de Prueba", async () => {
    Q().settings = [];
    const r = await checkout([line(RETIRO, { people: 1, editionId: 1 })]);
    const ev = sessionEvent("checkout.session.completed", sessionOf(r.stripeUrl!), r.merchantOrder, 40500);
    expect((await deliver({ ...ev, livemode: true })).json).toMatchObject({ outcome: "mode_mismatch" });
    expect(orderRows(r.merchantOrder)[0].status).toBe("pending_payment");
  });
});

describe("9. suplementos opcionales (alimentación): solo si se marcan, calculados por el servidor", () => {
  const SUP_IND = 301;
  const SUP_GRP = 302;
  beforeEach(() => {
    Q().variants[RETIRO].push(
      { id: SUP_IND, priceType: "per_person", priceModifier: "120.00", name: "Alimentación ayurvédica", minQty: 1, maxQty: 1, supplementGroup: "alim" },
      { id: SUP_GRP, priceType: "per_person", priceModifier: "90.00", name: "Alimentación ayurvédica (desde 2)", minQty: 2, maxQty: null, supplementGroup: "alim" },
    );
  });

  it("sin marcar, el total del programa no cambia; marcado suma 90 € por persona desde 2 (aunque el cliente envíe el id individual)", async () => {
    const sin = await checkout([line(RETIRO, { people: 2, variantId: 102, editionId: 1 })]);
    expect(sin.totalAmountCents).toBe(80000);
    const con = await checkout([line(RETIRO, { people: 2, variantId: 102, editionId: 1, supplementIds: [SUP_IND] })]);
    expect(con.totalAmountCents).toBe(80000 + 2 * 9000);
    const rows = orderRows(con.merchantOrder);
    expect(rows[0].amountTotal).toBe(98000);
    expect(rows[0].productName).toContain("Alimentación ayurvédica (desde 2) (suplemento opcional)");
  });

  it("un participante único paga la tarifa individual aunque envíe el id del tramo de grupo; el cliente no puede fijar importes", async () => {
    const r = await checkout([line(RETIRO, { people: 1, variantId: 101, editionId: 1, supplementIds: [SUP_GRP], supplementCents: 1, supplementPrice: 0.01 })]);
    expect(r.totalAmountCents).toBe(48000 + 12000);
  });

  it("un suplemento no es una opción del programa; un id inexistente o de otra empresa se rechaza sin retener plazas", async () => {
    await expect(checkout([line(RETIRO, { people: 2, variantId: SUP_GRP, editionId: 1 })])).rejects.toThrow(/ya no está disponible/);
    await expect(checkout([line(RETIRO, { people: 2, variantId: 102, editionId: 1, supplementIds: [999] })])).rejects.toThrow(/No se ha realizado ningún cobro/);
    // La otra empresa no tiene suplementos: el id de Quantum no le sirve
    await expect(checkout([line(RETIRO, { people: 2, editionId: 1, supplementIds: [SUP_IND] })], {}, "otra")).rejects.toThrow();
    expect(reserved()).toBe(0);
  });
});
