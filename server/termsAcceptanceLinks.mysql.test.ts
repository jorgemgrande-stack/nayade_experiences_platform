/**
 * Enlace recuperable y envíos de la aceptación de condiciones personalizadas contra MySQL real (opt-in,
 * REGISTRY_TEST_DATABASE_URL; BD aislada creada y borrada aquí): migración 0051 del CRM aditiva, enlace cifrado en
 * reposo (nunca en claro), historial de envíos y el recorrido completo con los almacenes reales (CRM, suscripciones,
 * acuerdos y aceptaciones): enviar, recuperar, reenviar, regenerar y aceptar. Correo en memoria; sin Stripe.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../scripts/db/migrationLib";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { CrmService } from "./crm/service";
import { MysqlCrmStore } from "./crm/mysqlStore";
import { MysqlWebStore } from "./web/store";
import { WebAdminService } from "./web/service";
import { catalogFromWebStore, crmFromStore } from "./subscriptions/ports";
import { SubscriptionService } from "./subscriptions/service";
import { MysqlSubscriptionStore } from "./subscriptions/store";
import { CommercialTermsService } from "./commercialTerms/service";
import { MysqlTermsStore } from "./commercialTerms/store";
import { MysqlExternalStore } from "./external/store";
import { MysqlAcceptanceLinkStore, openAcceptanceToken } from "./commercialTerms/acceptanceLinks";
import { TermsAcceptanceService, type TermsAcceptanceMail, type TermsInvitation } from "./commercialTerms/acceptance";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "terms_acceptance_links_test";
const DIR = path.resolve(__dirname, "../db/crm/migrations");
const A = "operator:ana";
const T0 = Date.UTC(2026, 10, 11, 10);

describe.skipIf(!URL_)("enlace de aceptación recuperable con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let links: MysqlAcceptanceLinkStore;
  let acceptances: MysqlExternalStore;
  let svc: TermsAcceptanceService;
  let subs: SubscriptionService;
  let terms: CommercialTermsService;
  let clock = T0;
  const sent: Array<{ to: string; key: string; i: TermsInvitation }> = [];
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const mail: TermsAcceptanceMail = {
    invite: async (to, key, i) => {
      sent.push({ to, key, i });
      return { status: "pending", reason: null, duplicate: false, id: sent.length };
    },
  };
  const P: Record<string, number> = {};

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
    await pool.query("INSERT INTO crm_companies (id, name, legal_name, created_at) VALUES (1, 'Prueba', 'Prueba Técnica, S.L.', 1)");
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
    const store = new MysqlSubscriptionStore(pool);
    const termsStore = new MysqlTermsStore(pool);
    const crmStore = new MysqlCrmStore(pool);
    const catalog = catalogFromWebStore(webStore);
    subs = new SubscriptionService({ store, catalog, crm: crmFromStore(crmStore), now: () => clock });
    terms = new CommercialTermsService({ store: termsStore, subscriptions: subs, subscriptionStore: store, catalog, crm: crmFromStore(crmStore), now: () => clock });
    links = new MysqlAcceptanceLinkStore(pool);
    acceptances = new MysqlExternalStore(pool, "test");
    svc = new TermsAcceptanceService({ terms, termsStore, subscriptions: subs, subscriptionStore: store, crm: new CrmService({ store: crmStore }), crmStore, acceptances, url: "https://admin.example.test/cp/v1/public/contract-acceptance/condiciones", now: () => clock, mail, links: { store: links, keyring: ring } });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("la migración 0051 es aditiva: crea solo sus dos tablas y no contiene borrados ni cambios", async () => {
    const up = fs.readFileSync(path.join(DIR, "0051_terms_acceptance_links.sql"), "utf8").replace(/^--.*$/gm, "");
    expect(up).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|DROP|UPDATE)\b/i);
    expect(up.match(/CREATE TABLE/g)).toHaveLength(2);
    expect(up).not.toMatch(/ALTER TABLE/i);
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_name LIKE 'commercial_terms_acceptance%' ORDER BY table_name", [DB]);
    expect(rows.map((r) => r.t)).toEqual(["commercial_terms_acceptance_links", "commercial_terms_acceptance_sends"]);
  });

  it("enviar, recuperar (cifrado en reposo), reenviar, regenerar y aceptar con los almacenes reales", async () => {
    const sub = await subs.create({ companyId: 1, interval: "month", plan: { productKey: "essential", priceId: P.essM } }, A);
    const draft = await terms.createForSubscription(sub.id, { pricingMode: "global", globalAmountCents: 12900, presentation: "global", packageName: "Paquete", requiresAcceptance: true, reason: "Acuerdo comercial negociado", lines: [{ kind: "catalog", productKey: "essential", priceId: P.essM }, { kind: "catalog", productKey: "hotel-net", priceId: P.hotM }] }, A);
    const out = await svc.request(draft.id, { signer: { name: "Marta Ruiz", email: "marta@cliente-prueba.example" }, expectedRevision: draft.revision }, A);
    expect(out.recoverable).toBe(true);
    expect(out.mail).toMatchObject({ ok: true, to: "marta@cliente-prueba.example" });
    expect(sent[0]).toMatchObject({ to: "marta@cliente-prueba.example", key: `terms-acceptance:${out.acceptanceId}:1` });
    expect(sent[0].i).toMatchObject({ url: out.url, netCents: 12900, lines: null, companyName: "Prueba Técnica, S.L." });
    const token = out.url.split("token=")[1];
    // En la base solo está cifrado (y descifra únicamente como el de su aceptación)
    const [raw] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM commercial_terms_acceptance_links WHERE acceptance_id = ?", [out.acceptanceId]);
    expect(JSON.stringify(raw)).not.toContain(token);
    const stored = (await links.link(out.acceptanceId))!;
    expect(openAcceptanceToken(stored, ring)).toBe(token);
    expect(() => openAcceptanceToken({ ...stored, acceptanceId: stored.acceptanceId + 1 }, ring)).toThrow();
    // Recuperar no consume; reenviar no crea contrato
    for (let n = 0; n < 2; n++) expect((await svc.link(draft.id, A)).url).toBe(out.url);
    await svc.view(token);
    const re = await svc.resend(draft.id, A);
    expect(re.url).toBe(out.url);
    expect(sent[1].key).toBe(`terms-acceptance:${out.acceptanceId}:2`);
    // Regenerar: mismo contrato y versión; el antiguo deja de valer
    const t1 = (await terms.must(draft.id)).revision;
    const regen = await svc.regenerate(draft.id, { expectedRevision: t1 }, A);
    expect(regen.contract).toMatchObject({ id: out.contract.id, version: out.contract.version });
    expect(regen.documentSha256).toBe(out.documentSha256);
    await expect(svc.view(token)).rejects.toThrow();
    const newToken = regen.url.split("token=")[1];
    expect((await svc.view(newToken)).version).toBe(out.contract.version);
    const history = await links.sends(draft.id);
    expect(history.map((s) => s.kind)).toEqual(["regenerated", "resent", "sent"]);
    expect(history.every((s) => s.contractId === out.contract.id && s.recipientEmail === "marta@cliente-prueba.example")).toBe(true);
    // Una sola aceptación
    const [x, y] = await Promise.allSettled([svc.accept(newToken, { name: "Marta Ruiz", accept: true }, { ip: null, userAgent: null }), svc.accept(newToken, { name: "Otra", accept: true }, { ip: null, userAgent: null })]);
    expect([x.status, y.status].sort()).toEqual(["fulfilled", "rejected"]);
    const rows = await acceptances.acceptances(out.contract.id);
    expect(rows.filter((r) => r.status === "accepted")).toHaveLength(1);
    const pdf = await svc.acceptedContractPdf(draft.id);
    expect(Buffer.from(pdf.pdf).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
