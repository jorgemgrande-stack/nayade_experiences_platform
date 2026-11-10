/**
 * Condiciones comerciales personalizadas contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada creada y
 * borrada aquí): migración 0048, revisiones del borrador, materialización en `subscription_items`, concurrencia entre
 * conexiones, restricciones del esquema e historial.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../scripts/db/migrationLib";
import { MysqlCrmStore } from "./crm/mysqlStore";
import { MysqlWebStore } from "./web/store";
import { WebAdminService } from "./web/service";
import { catalogFromWebStore, crmFromStore } from "./subscriptions/ports";
import { SubscriptionService } from "./subscriptions/service";
import { ShadowBillingService } from "./subscriptions/shadow";
import { MysqlSubscriptionStore } from "./subscriptions/store";
import { CommercialTermsService, TermsError, type TermsInput } from "./commercialTerms/service";
import { MysqlTermsStore } from "./commercialTerms/store";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "commercial_terms_test";
const DIR = path.resolve(__dirname, "../db/crm/migrations");
const A = "operator:ana";
const B = "operator:berta";
const T0 = Date.UTC(2026, 10, 1, 10);
const MONTH = (n: number) => Date.UTC(2026, 10 + n, 1, 10);

describe.skipIf(!URL_)("condiciones personalizadas con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let store: MysqlSubscriptionStore;
  let termsStore: MysqlTermsStore;
  let subs: SubscriptionService;
  let shadow: ShadowBillingService;
  let terms: CommercialTermsService;
  let clock = T0;
  const P: Record<string, number> = {};

  const input = (over: Partial<TermsInput> = {}): TermsInput => ({
    pricingMode: "global",
    globalAmountCents: 12900,
    presentation: "global",
    packageName: "Paquete hotel",
    reason: "Acuerdo comercial negociado",
    lines: [
      { kind: "catalog", productKey: "essential", priceId: P.essM },
      { kind: "catalog", productKey: "hotel-net", priceId: P.hotM },
      { kind: "custom", concept: "maintenance", name: "Mantenimiento personalizado", chargeClass: "recurring", unitCents: 5000, taxRateBp: 2100 },
      { kind: "custom", concept: "implementation", name: "Implantación", chargeClass: "initial", unitCents: 50000, taxRateBp: 2100 },
    ],
    adjustments: [{ line: null, type: "discount", mode: "amount", value: 2900, recurrence: "once", note: "bienvenida" }],
    ...over,
  });
  const newSub = (companyId: number) => subs.create({ companyId, interval: "month", plan: { productKey: "essential", priceId: P.essM } }, A);

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 8 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    const { migrations, errors } = loadMigrations(DIR);
    if (errors.length) throw new Error(errors.join("; "));
    for (const m of migrations) for (const s of splitStatements(m.up)) await pool.query(s);
    await pool.query("INSERT INTO crm_companies (id, name, created_at) VALUES (1, 'Acme', 1), (2, 'Otra', 1)");
    const webStore = new MysqlWebStore(pool);
    const web = new WebAdminService({ store: webStore, refs: { moduleIds: ["hotel"], planIds: () => null }, now: () => clock });
    for (const [key, family, act, model] of [
      ["essential", "core_plan", { kind: "plan", ref: "essential" }, "subscription"],
      ["hotel-net", "industry_module", { kind: "module", ref: "hotel" }, "recurring_addon"],
    ] as const) {
      await web.create({ kind: "product", key, family, draft: { name: key, technicalStatus: "available", activation: act, billingModel: model } }, A);
      await web.publish("product", key, 1, A);
    }
    for (const [name, key, amount] of [["essM", "essential", 2900], ["hotM", "hotel-net", 11900]] as const) {
      const p = await web.addPrice(key, { kind: "monthly", amountCents: amount, taxRateBp: 2100 }, A);
      await web.approvePrice(p.id, A);
      P[name] = p.id;
    }
    store = new MysqlSubscriptionStore(pool);
    termsStore = new MysqlTermsStore(pool);
    const crm = crmFromStore(new MysqlCrmStore(pool));
    const catalog = catalogFromWebStore(webStore);
    subs = new SubscriptionService({ store, catalog, crm, now: () => clock });
    shadow = new ShadowBillingService({ store, crm, now: () => clock });
    terms = new CommercialTermsService({ store: termsStore, subscriptions: subs, subscriptionStore: store, catalog, crm, now: () => clock });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("el borrador se guarda por revisiones: nada se reescribe ni se borra, y la revisión antigua se rechaza", async () => {
    const sub = await newSub(1);
    const d = await terms.createForSubscription(sub.id, input(), A);
    expect(d).toMatchObject({ status: "draft", revision: 1, versionNo: 1, pricingMode: "global", globalAmountCents: 12900, presentation: "global" });
    expect(d.lines.map((l) => [l.kind, l.chargeClass, l.officialUnitCents, l.negotiatedUnitCents])).toEqual([
      ["catalog", "recurring", 2900, null],
      ["catalog", "recurring", 11900, null],
      ["custom", "recurring", null, 5000],
      ["custom", "initial", null, 50000],
    ]);
    expect(d.lines[1].catalog).toEqual({ family: "industry_module", activationKind: "module", activationRef: "hotel", lineKind: "module", metric: null });
    const saved = await terms.updateDraft(d.id, input({ globalAmountCents: 9900 }), d.revision, A);
    expect(saved).toMatchObject({ revision: 2, globalAmountCents: 9900 });
    // La partida a medida conserva su identidad entre revisiones solo si se le indica; aquí son partidas nuevas
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT revision, COUNT(*) AS n FROM commercial_terms_lines WHERE terms_id = ? GROUP BY revision ORDER BY revision", [d.id]);
    expect(rows.map((r) => [Number(r.revision), Number(r.n)])).toEqual([[1, 4], [2, 4]]);
    await expect(terms.updateDraft(d.id, input({ globalAmountCents: 100 }), d.revision, B)).rejects.toMatchObject({ code: "version_conflict" });
    expect((await terms.must(d.id)).globalAmountCents).toBe(9900);
    const cancelled = await terms.cancelDraft(d.id, { reason: "Se rehace la oferta" }, saved.revision, A);
    expect(cancelled.status).toBe("cancelled");
  });

  it("la activación materializa en subscription_items con el acuerdo de origen, el importe del periodo y sin activación en las partidas a medida", async () => {
    const sub = await newSub(1);
    const d = await terms.createForSubscription(sub.id, input({ effectiveFrom: MONTH(1) }), A);
    const out = await terms.activate(d.id, { expectedRevision: d.revision, expectedVersion: sub.version }, A);
    expect(out.terms).toMatchObject({ status: "scheduled", effectiveFrom: MONTH(1), activatedBy: A });
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT product_key, product_name, family, activation_kind, activation_ref, price_id, price_source, price_kind, unit_amount_cents, line_amount_cents, terms_id, terms_line_id, discount_kind FROM subscription_items WHERE subscription_id = ? AND terms_id = ? ORDER BY id", [sub.id, d.id]);
    const byName = Object.fromEntries(rows.map((r) => [String(r.product_name), r]));
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.price_source === "contract" && r.discount_kind === null)).toBe(true);
    expect(rows.filter((r) => r.price_kind === "monthly").reduce((a, r) => a + Number(r.line_amount_cents), 0)).toBe(12900);
    expect(byName["hotel-net"]).toMatchObject({ family: "industry_module", activation_kind: "module", activation_ref: "hotel", price_id: P.hotM });
    expect(byName["Mantenimiento personalizado"]).toMatchObject({ family: "service", activation_kind: "none", activation_ref: null, price_id: null });
    expect(String(byName["Mantenimiento personalizado"].product_key)).toMatch(/^custom-/);
    expect(byName["Implantación"]).toMatchObject({ price_kind: "one_time", activation_kind: "none" });
    expect(Number(byName["Implantación"].line_amount_cents)).toBe(50000);
    const credit = rows.find((r) => r.terms_line_id === null)!;
    expect(credit).toMatchObject({ price_kind: "one_time", activation_kind: "none" });
    expect(Number(credit.line_amount_cents)).toBe(-2900);
    expect(Number(credit.unit_amount_cents)).toBe(0);
    // Primera renovación: 129 € − 29 € y la implantación aparte; segunda: solo la cuota
    clock = MONTH(1) + 1000;
    await subs.applyRenewals(sub.id, "system:test");
    const first = (await shadow.simulateCurrent(sub.id, "system:test")).results.map((r) => r.invoice);
    expect(first.map((i) => [i.kind, i.subtotalCents - i.discountCents, i.taxCents]).sort()).toEqual([["one_time", 50000, 10500], ["renewal", 10000, 2100]]);
    const again = await shadow.simulateCurrent(sub.id, "system:test");
    expect(again.results.every((r) => !r.created && r.drift === null)).toBe(true);
    clock = MONTH(2) + 1000;
    await subs.applyRenewals(sub.id, "system:test");
    expect((await shadow.simulateCurrent(sub.id, "system:test")).results.map((r) => [r.invoice.kind, r.invoice.subtotalCents, r.invoice.totalCents])).toEqual([["renewal", 12900, 15609]]);
    clock = T0;
  });

  it("dos administradores desde conexiones distintas: una activación gana y la otra recibe el conflicto", async () => {
    const sub = await newSub(2);
    const a = await terms.createForSubscription(sub.id, input({ pricingMode: "per_item", globalAmountCents: null, adjustments: [], lines: [{ kind: "catalog", productKey: "essential", priceId: P.essM, negotiatedUnitCents: 1900 }] }), A);
    const b = await terms.createForSubscription(sub.id, input({ pricingMode: "per_item", globalAmountCents: null, adjustments: [], lines: [{ kind: "catalog", productKey: "essential", priceId: P.essM, negotiatedUnitCents: 2400 }] }), B);
    expect([a.versionNo, b.versionNo]).toEqual([1, 2]);
    const results = await Promise.allSettled([terms.activate(a.id, { expectedRevision: a.revision, expectedVersion: sub.version }, A), terms.activate(b.id, { expectedRevision: b.revision, expectedVersion: sub.version }, B)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(TermsError);
    const [live] = await pool.query<mysql.RowDataPacket[]>("SELECT line_amount_cents FROM subscription_items WHERE subscription_id = ? AND effective_to IS NULL AND price_kind = 'monthly'", [sub.id]);
    expect(live).toHaveLength(1);
    expect([1900, 2400]).toContain(Number(live[0].line_amount_cents));
    const all = await terms.ofSubscription(sub.id);
    expect(all.terms.map((t) => t.status).sort()).toEqual(["active", "draft"]);
    // Historial: quién, motivo y efecto económico de cada operación
    expect(all.events.every((e) => e.reason.length >= 5 && /^operator:/.test(e.actor) && e.companyId === 2)).toBe(true);
    expect(all.events.find((e) => e.kind === "activated")!.economic).toMatchObject({ before: { recurringNetCents: 2900 } });
  });

  it("el esquema rechaza una partida a medida con producto y una cuota global incoherente", async () => {
    const [t] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM commercial_terms ORDER BY id LIMIT 1");
    await expect(
      pool.query("INSERT INTO commercial_terms_lines (terms_id, revision, line_kind, line_ref, concept, product_key, name, charge_class, quantity, negotiated_unit_cents, tax_rate_bp) VALUES (?, 99, 'custom', 'custom-x', 'other', 'hotel-net', 'Hotel de regalo', 'recurring', 1, 0, 2100)", [t[0].id]),
    ).rejects.toThrow(/chk_terms_line_custom/);
    await expect(pool.query("INSERT INTO commercial_terms (company_id, pricing_mode, global_amount_cents, billing_interval, reason, created_at, created_by) VALUES (1, 'per_item', 100, 'month', 'prueba de esquema', 1, 'x')")).rejects.toThrow(/chk_terms_global/);
    await expect(pool.query("INSERT INTO commercial_terms (company_id, pricing_mode, global_amount_cents, billing_interval, reason, created_at, created_by) VALUES (1, 'global', NULL, 'month', 'prueba de esquema', 1, 'x')")).rejects.toThrow(/chk_terms_global/);
  });
});
