/**
 * Contratación, aceptación y cobro recurrente de servicios de clientes externos (tecnología propia, fuera de Elephant
 * Core). Reutiliza el CRM (empresas, contratos y versiones) y Stripe Billing (Customer por empresa, Checkout, suscripción
 * y webhooks); nunca aprovisiona tenants, bases de datos, dominios ni licencias.
 *
 *   contrato (CRM) → aceptación digital con evidencias → autorización del método de pago SIN cargo (Checkout setup)
 *   → suscripción de Stripe sin cargo hasta el primer vencimiento (día 1, Europe/Madrid) → Stripe cobra cada mes
 *
 * Reglas:
 *  - Aceptar el contrato y autorizar el método de pago son pasos distintos (la autorización exige la aceptación).
 *  - Importe, IVA y calendario salen del contrato; nunca del navegador ni del cliente.
 *  - Un cargo ordinario por periodo: lo emite Stripe (una suscripción por contrato, clave de idempotencia por contrato).
 *    Elephant nunca crea cargos sueltos; los reintentos son los de Stripe.
 *  - Si el método de pago llega después del primer vencimiento, no se cobra con retroactividad: queda pendiente de
 *    decisión, y la decisión (nueva fecha) se registra en el contrato.
 *  - Impago: estado «pago pendiente» del día 1 al 5 y, cumplido el margen, alerta administrativa una sola vez por
 *    factura. Nunca se detiene la infraestructura del cliente.
 */
import crypto from "node:crypto";
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import type { CrmService } from "../crm/service";
import type { CrmStore } from "../crm/store";
import type { StripeMode } from "../stripe/config";
import type { GwInvoice, GwSubscription, StripeGateway } from "../stripe/gateway";
import type { StripeStore } from "../stripe/store";
import { billingTerms, renderContract, sha256, taxCents } from "./document";
import { chargeInstant, graceEnd, localDate, periodLabel } from "./schedule";
import type { ExternalStore } from "./store";
import { ExternalError, type ContractAcceptance, type ExternalStatus, type ExternalSubscription } from "./types";

export interface ExternalUrls {
  /** Página pública de aceptación (https); se le añade `?token=…`. */
  acceptance: string;
  /** Vuelta de Stripe tras autorizar el método de pago. */
  setupSuccess: string;
  setupCancel: string;
  /** Vuelta desde el portal de facturación. */
  portalReturn: string;
}

export interface ExternalDeps {
  store: ExternalStore;
  crm: Pick<CrmService, "createContract" | "setContractStatus" | "log">;
  crmStore: Pick<CrmStore, "get" | "list">;
  stripeStore?: Pick<StripeStore, "customerByCompany" | "linkCustomer">;
  gateway?: StripeGateway;
  mode: StripeMode;
  namespace: string;
  urls: ExternalUrls;
  /** Sal para seudonimizar la IP del firmante (sin ella no se guarda la IP). */
  ipSalt?: string;
  /**
   * Cobros REALES de servicios externos (CP_EXTERNAL_LIVE_ENABLED=1, interruptor protegido). En modo live, sin él no se
   * abre la autorización del método de pago ni se crea ninguna suscripción: nunca se cobra de verdad por accidente.
   */
  liveEnabled?: boolean;
  now?: () => number;
}

export interface CreateExternalInput {
  companyId: number;
  service: { key: string; name: string };
  amountCents: number;
  currency?: string;
  taxRateBp: number;
  /** Día de cobro (1–28) y primer vencimiento «AAAA-MM-DD» (debe caer en ese día). */
  billingDay?: number;
  firstChargeDate: string;
  billingHour?: number;
  timezone?: string;
  graceDays?: number;
  externalRef?: string | null;
  /** Condiciones del servicio (alcance, soporte, duración, baja…). */
  conditions: string;
  noticeDays?: number;
  /** SOLO PRUEBAS: reloj de prueba de Stripe para el Customer (validación en sandbox). */
  testClock?: { frozenTime: number };
}

const KEY_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TOKEN_TTL_MS = 14 * 86_400_000;
const SETUP_TTL_MS = 23 * 3600_000;
const LIVE_STATES: ExternalStatus[] = ["awaiting_acceptance", "awaiting_payment_method", "scheduled", "active", "past_due", "needs_decision"];

export class ExternalService {
  private now: () => number;
  constructor(private d: ExternalDeps) {
    this.now = d.now ?? Date.now;
  }

  private async must(id: number) {
    const x = await this.d.store.get(id);
    if (!x) throw new ExternalError("not_found", "Contratación externa no encontrada");
    return x;
  }
  private async contractOf(x: ExternalSubscription) {
    const c = await this.d.crmStore.get("contracts", x.contractId);
    if (!c) throw new ExternalError("not_found", "Contrato no encontrado");
    return c;
  }
  private stripe() {
    if (this.d.mode === "live" && !this.d.liveEnabled) throw new ExternalError("unavailable", "Los cobros reales de servicios externos no están activados en este entorno (requiere autorización: CP_EXTERNAL_LIVE_ENABLED)");
    const g = this.d.gateway;
    if (!g || !this.d.stripeStore || !g.createSetupSession || !g.createServiceSubscription || !g.ensureServiceProduct || !g.ensureTaxRate || !g.setDefaultPaymentMethod || !g.setupSession)
      throw new ExternalError("unavailable", "Stripe no está configurado en este entorno");
    return { g: g as Required<StripeGateway>, store: this.d.stripeStore };
  }

  /** Documento del contrato en su versión actual (y su huella). */
  async document(x: ExternalSubscription) {
    const contract = await this.contractOf(x);
    const company = await this.d.crmStore.get("companies", x.companyId);
    if (!company) throw new ExternalError("not_found", "Empresa no encontrada");
    const text = renderContract({ contract, company, external: x });
    return { text, sha256: sha256(text), version: contract.version, contract, company };
  }

  // ── 1. Contratación ────────────────────────────────────────────────────────

  async create(input: CreateExternalInput, actor: string): Promise<ExternalSubscription> {
    const company = await this.d.crmStore.get("companies", input.companyId);
    if (!company) throw new ExternalError("not_found", "Empresa no encontrada");
    // Un cliente de la plataforma Elephant no se factura como externo (lo haría dos veces)
    if (company.tenantId) throw new ExternalError("invalid_state", "La empresa ya es cliente de Elephant Core: sus servicios se contratan desde Contrataciones");
    if (!KEY_RE.test(input.service.key ?? "")) throw new ExternalError("invalid_input", "Clave de servicio no válida (minúsculas, números y guiones)");
    const name = String(input.service.name ?? "").trim();
    if (name.length < 3 || name.length > 160) throw new ExternalError("invalid_input", "Nombre del servicio no válido");
    if (!Number.isInteger(input.amountCents) || input.amountCents < 100 || input.amountCents > 10_000_000) throw new ExternalError("invalid_input", "Importe no válido");
    if (!Number.isInteger(input.taxRateBp) || input.taxRateBp < 0 || input.taxRateBp > 3000) throw new ExternalError("invalid_input", "IVA no válido");
    const billingDay = input.billingDay ?? 1;
    if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 28) throw new ExternalError("invalid_input", "El día de cobro debe estar entre el 1 y el 28");
    const billingHour = input.billingHour ?? 8;
    if (!Number.isInteger(billingHour) || billingHour < 1 || billingHour > 20) throw new ExternalError("invalid_input", "Hora de cobro no válida");
    const timezone = input.timezone ?? "Europe/Madrid";
    const graceDays = input.graceDays ?? 5;
    if (!Number.isInteger(graceDays) || graceDays < 1 || graceDays > 15) throw new ExternalError("invalid_input", "Margen de pago no válido");
    let firstChargeAt: number;
    try {
      firstChargeAt = chargeInstant(input.firstChargeDate, billingHour, timezone);
    } catch {
      throw new ExternalError("invalid_input", "Primer vencimiento no válido (AAAA-MM-DD)");
    }
    if (localDate(firstChargeAt, timezone).day !== billingDay) throw new ExternalError("invalid_input", `El primer vencimiento debe caer en el día de cobro (${billingDay})`);
    if (firstChargeAt <= this.now()) throw new ExternalError("invalid_input", "El primer vencimiento ya ha pasado");
    const conditions = String(input.conditions ?? "").trim();
    if (conditions.length < 20) throw new ExternalError("invalid_input", "Indica las condiciones del servicio");
    // Sin duplicados: una contratación viva por empresa y servicio
    const dup = (await this.d.store.list({ companyId: company.id })).find((x) => x.serviceKey === input.service.key && LIVE_STATES.includes(x.status));
    if (dup) throw new ExternalError("conflict", `La empresa ya tiene una contratación viva de «${dup.serviceName}» (#${dup.id})`);

    const terms = { serviceName: name, amountCents: input.amountCents, currency: (input.currency ?? "EUR").toUpperCase(), taxRateBp: input.taxRateBp, billingDay, billingHour, timezone, graceDays, firstChargeAt };
    const contract = await this.d.crm.createContract(
      {
        companyId: company.id,
        amountCents: terms.amountCents,
        currency: terms.currency,
        billingInterval: "month",
        startDate: firstChargeAt,
        autoRenew: true,
        ...(input.noticeDays !== undefined ? { noticeDays: input.noticeDays } : {}),
        // Las condiciones económicas también van en el texto del contrato (y en su versión inmutable)
        conditions: [...billingTerms(terms), "", conditions].join("\n"),
      },
      actor,
    );
    let testClockId: string | null = null;
    if (input.testClock) {
      if (this.d.mode !== "test" || !this.d.gateway?.createTestClock) throw new ExternalError("invalid_state", "Los relojes de prueba solo existen en el sandbox de Stripe");
      testClockId = (await this.d.gateway.createTestClock(Math.floor(input.testClock.frozenTime / 1000), `Elephant ${company.name} ${input.service.key}`)).id;
    }
    const now = this.now();
    const x = await this.d.store.insert({
      contractId: contract.id,
      companyId: company.id,
      serviceKey: input.service.key,
      serviceName: name,
      amountCents: terms.amountCents,
      currency: terms.currency,
      taxRateBp: terms.taxRateBp,
      interval: "month",
      billingDay,
      billingHour,
      timezone,
      graceDays,
      firstChargeAt,
      externalRef: input.externalRef?.trim() || null,
      status: "awaiting_acceptance",
      stripeCustomerId: null,
      stripeSetupSessionId: null,
      stripePaymentMethodId: null,
      stripeSubscriptionId: null,
      stripeTestClockId: testClockId,
      lastInvoiceId: null,
      lastInvoiceStatus: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      graceUntil: null,
      decisionReason: null,
      createdBy: actor,
      createdAt: now,
    });
    await this.d.store.event({ externalId: x.id, kind: "created", ref: null, detail: { contractId: contract.id, amountCents: x.amountCents, taxRateBp: x.taxRateBp, firstChargeAt }, actor, at: now });
    await this.d.crm.log("contract", contract.id, "note", `Servicio externo ${name}: ${x.amountCents / 100} ${x.currency} + IVA ${x.taxRateBp / 100} %, cobro el día ${billingDay}. Sin aprovisionamiento en Elephant Core`, actor);
    return x;
  }

  // ── 2. Aceptación digital ──────────────────────────────────────────────────

  /** Prepara (o renueva) el enlace de aceptación para el representante. Revoca los enlaces anteriores sin usar. */
  async requestAcceptance(id: number, signer: { name: string; email: string; role?: string | null; taxId?: string | null }, actor: string) {
    const x = await this.must(id);
    if (x.status !== "awaiting_acceptance") throw new ExternalError("invalid_state", "El contrato ya está aceptado");
    const name = String(signer.name ?? "").trim();
    const email = String(signer.email ?? "").trim().toLowerCase();
    if (name.length < 3 || name.length > 160 || !EMAIL_RE.test(email)) throw new ExternalError("invalid_input", "Indica el nombre y el correo del representante autorizado");
    let contract = await this.contractOf(x);
    if (contract.status === "draft") contract = await this.d.crm.setContractStatus(contract.id, "sent", actor);
    else if (contract.status !== "sent") throw new ExternalError("invalid_state", `El contrato está en «${contract.status}»`);
    for (const a of await this.d.store.acceptances(contract.id)) if (a.status === "pending") await this.d.store.setAcceptanceStatus(a.id, "revoked");
    const doc = await this.document(x);
    const token = crypto.randomBytes(32).toString("base64url");
    const now = this.now();
    const a = await this.d.store.insertAcceptance({
      contractId: contract.id,
      contractVersion: doc.version,
      documentSha256: doc.sha256,
      tokenSha256: sha256(token),
      status: "pending",
      signerName: name,
      signerEmail: email,
      signerRole: signer.role?.trim() || null,
      signerTaxId: signer.taxId?.trim() || null,
      acceptedName: null,
      acceptedTaxId: null,
      acceptedAt: null,
      acceptedIpHash: null,
      acceptedUserAgent: null,
      consentText: null,
      expiresAt: now + TOKEN_TTL_MS,
      createdBy: actor,
      createdAt: now,
    });
    await this.d.store.event({ externalId: x.id, kind: "acceptance_requested", ref: String(a.id), detail: { signerEmail: email, version: doc.version, documentSha256: doc.sha256 }, actor, at: now });
    return { acceptanceId: a.id, url: `${this.d.urls.acceptance}?token=${token}`, expiresAt: a.expiresAt, documentSha256: doc.sha256, version: doc.version };
  }

  private async pendingByToken(token: string) {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token ?? "")) throw new ExternalError("not_found", "Enlace no válido");
    const a = await this.d.store.acceptanceByToken(sha256(token));
    if (!a) throw new ExternalError("not_found", "Enlace no válido");
    if (a.status === "accepted") throw new ExternalError("invalid_state", "Este contrato ya está aceptado");
    if (a.status !== "pending") throw new ExternalError("invalid_state", "Este enlace ya no es válido: solicita uno nuevo");
    if (a.expiresAt <= this.now()) {
      await this.d.store.setAcceptanceStatus(a.id, "expired");
      throw new ExternalError("invalid_state", "Este enlace ha caducado: solicita uno nuevo");
    }
    const x = await this.d.store.byContract(a.contractId);
    if (!x) throw new ExternalError("not_found", "Contratación no encontrada");
    const doc = await this.document(x);
    // El contrato cambió después de enviar el enlace: lo aceptado no sería lo presentado
    if (doc.sha256 !== a.documentSha256 || doc.version !== a.contractVersion) throw new ExternalError("invalid_state", "El contrato ha cambiado desde que se envió este enlace: solicita uno nuevo");
    return { a, x, doc };
  }

  /** Lo que ve el firmante: el documento exacto, su huella y la declaración que debe confirmar. */
  async viewAcceptance(token: string) {
    const { a, x, doc } = await this.pendingByToken(token);
    return { signerName: a.signerName, signerRole: a.signerRole, company: doc.company.legalName ?? doc.company.name, document: doc.text, documentSha256: doc.sha256, version: doc.version, declaration: this.declaration(x, a), expiresAt: a.expiresAt };
  }

  private declaration(x: ExternalSubscription, a: Pick<ContractAcceptance, "signerName">) {
    return `Yo, ${a.signerName}, declaro que tengo poder suficiente para obligar al cliente y acepto el contrato anterior (versión y huella indicadas), incluido el cobro recurrente de ${(x.amountCents / 100).toFixed(2)} ${x.currency} más IVA cada mes.`;
  }

  /** Aceptación del firmante: evidencias (identidad declarada, fecha, versión, huella, IP seudonimizada y navegador). */
  async accept(token: string, input: { name: string; taxId?: string | null; accept: boolean }, ctx: { ip: string | null; userAgent: string | null }) {
    const { a, x, doc } = await this.pendingByToken(token);
    if (input.accept !== true) throw new ExternalError("invalid_input", "Debes marcar la aceptación del contrato");
    const name = String(input.name ?? "").trim();
    if (name.length < 3 || name.length > 160) throw new ExternalError("invalid_input", "Escribe tu nombre completo");
    const now = this.now();
    const ok = await this.d.store.markAccepted(a.id, {
      acceptedName: name,
      acceptedTaxId: input.taxId?.trim().slice(0, 32) || null,
      acceptedAt: now,
      acceptedIpHash: ctx.ip && this.d.ipSalt ? sha256(`${this.d.ipSalt}:${ctx.ip}`) : null,
      acceptedUserAgent: ctx.userAgent?.slice(0, 300) ?? null,
      consentText: this.declaration(x, a),
    });
    if (!ok) throw new ExternalError("invalid_state", "Este contrato ya está aceptado");
    await this.d.crm.setContractStatus(x.contractId, "signed", "public:acceptance", { signatureMethod: "electronic", signatureRef: `aceptacion:${a.id}:${doc.sha256.slice(0, 16)}` });
    const cur = await this.must(x.id);
    await this.d.store.update(cur.id, cur.version, { status: "awaiting_payment_method" }, now);
    await this.d.store.event({ externalId: x.id, kind: "accepted", ref: String(a.id), detail: { acceptedName: name, version: doc.version, documentSha256: doc.sha256 }, actor: "public:acceptance", at: now });
    await this.d.crm.log("contract", x.contractId, "note", `Contrato aceptado electrónicamente por ${name} (versión ${doc.version}, huella ${doc.sha256.slice(0, 16)}…)`, "public:acceptance");
    return { accepted: true, version: doc.version, documentSha256: doc.sha256, acceptedAt: now };
  }

  // ── 3. Autorización del método de pago (sin cargo) ────────────────────────

  async paymentSetup(id: number, actor: string): Promise<{ url: string | null; sessionId: string; expiresAt: number; reused: boolean }> {
    const x = await this.must(id);
    if (x.status !== "awaiting_payment_method") throw new ExternalError("invalid_state", x.status === "awaiting_acceptance" ? "Primero el cliente debe aceptar el contrato" : "El método de pago ya está autorizado");
    const { g } = this.stripe();
    const now = this.now();
    // Como mucho una sesión abierta: se reutiliza mientras le quede margen
    if (x.stripeSetupSessionId) {
      const s = await g.setupSession(x.stripeSetupSessionId);
      if (s && s.status === "open" && s.expiresAt * 1000 > now + 30 * 60_000) return { url: s.url, sessionId: s.id, expiresAt: s.expiresAt * 1000, reused: true };
      if (s && s.status === "complete") throw new ExternalError("invalid_state", "El cliente ya autorizó su método de pago; falta su confirmación (webhook)");
    }
    const customerId = await this.ensureCustomer(x);
    const n = (await this.d.store.events(x.id)).filter((e) => e.kind === "setup_session").length + 1;
    const tax = taxCents(x);
    const notice = [
      `Autorizas a ${"Big Elephant"} a cobrar en este método de pago las cuotas recurrentes de ${x.serviceName}: ${(x.amountCents / 100).toFixed(2)} € + IVA (${(tax / 100).toFixed(2)} €) = ${((x.amountCents + tax) / 100).toFixed(2)} € al mes,`,
      `el día ${x.billingDay} de cada mes desde el ${new Intl.DateTimeFormat("es-ES", { timeZone: x.timezone, dateStyle: "long" }).format(new Date(x.firstChargeAt))}. Hoy no se cobra nada.`,
      "Podrás consultar facturas, cambiar el método de pago o solicitar la baja conforme al contrato desde el portal de facturación.",
    ].join(" ");
    const s = await g.createSetupSession(
      {
        customerId,
        currency: x.currency,
        metadata: { es_external_id: String(x.id), es_contract_id: String(x.contractId), es_company_id: String(x.companyId), es_env: this.d.namespace },
        successUrl: `${this.d.urls.setupSuccess}?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: this.d.urls.setupCancel,
        expiresAt: Math.floor((now + SETUP_TTL_MS) / 1000),
        notice,
      },
      `es-${this.d.namespace}-ext-${x.id}-setup-${n}`,
    );
    await this.d.store.update(x.id, x.version, { stripeCustomerId: customerId, stripeSetupSessionId: s.id }, now);
    await this.d.store.event({ externalId: x.id, kind: "setup_session", ref: s.id, detail: { customerId }, actor, at: now });
    return { url: s.url, sessionId: s.id, expiresAt: s.expiresAt * 1000, reused: false };
  }

  private async ensureCustomer(x: ExternalSubscription): Promise<string> {
    const { g, store } = this.stripe();
    const link = await store.customerByCompany(x.companyId);
    if (link) return link.stripeCustomerId;
    const company = (await this.d.crmStore.get("companies", x.companyId))!;
    const contacts = (await this.d.crmStore.list("contacts", { companyId: x.companyId })) as Array<{ email?: string | null; status?: string; isPrimary?: boolean }>;
    const email = company.billingEmail ?? contacts.filter((c) => c.status !== "inactive" && c.email).sort((a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary))[0]?.email ?? null;
    const created = await g.createCustomer(
      {
        name: company.legalName ?? company.name,
        email,
        metadata: { es_company_id: String(company.id), es_env: this.d.namespace, es_external: "1" },
        ...(company.country ? { address: { country: company.country, postalCode: company.postalCode, line1: company.address, city: company.city } } : {}),
        ...(x.stripeTestClockId ? { testClock: x.stripeTestClockId } : {}),
      },
      `es-${this.d.namespace}-customer-${company.id}-ext`,
    );
    const { link: linked } = await store.linkCustomer({ companyId: company.id, tenantId: null, stripeCustomerId: created.id, now: this.now() });
    return linked.stripeCustomerId;
  }

  /** Checkout setup completado (webhook o conciliación): fija el método de pago y programa la suscripción. */
  async handleSetupSession(sessionId: string): Promise<string> {
    const x = await this.d.store.bySetupSession(sessionId);
    if (!x) return "Sesión no es de un servicio externo";
    const { g } = this.stripe();
    const s = await g.setupSession(sessionId);
    if (!s || s.metadata.es_external_id !== String(x.id) || s.metadata.es_env !== this.d.namespace || s.customerId !== x.stripeCustomerId) throw new ExternalError("conflict", "La sesión de Stripe no corresponde a esta contratación");
    if (s.status !== "complete" || !s.paymentMethodId) return `Sesión ${s.status ?? "?"}`;
    if (x.status !== "awaiting_payment_method") return `Ya procesada (${x.status})`;
    await g.setDefaultPaymentMethod(x.stripeCustomerId!, s.paymentMethodId);
    const now = this.now();
    let cur = await this.d.store.update(x.id, x.version, { stripePaymentMethodId: s.paymentMethodId }, now);
    await this.d.store.event({ externalId: x.id, kind: "payment_method_authorized", ref: s.id, detail: { setupIntentId: s.setupIntentId }, actor: "system:stripe", at: now });
    cur = await this.schedule(cur, "system:stripe");
    return `Método autorizado; ${cur.status}`;
  }

  /** Programa la suscripción de Stripe (sin cargo hasta el primer vencimiento). Nunca cobra con retroactividad. */
  private async schedule(x: ExternalSubscription, actor: string): Promise<ExternalSubscription> {
    const now = this.now();
    if (x.firstChargeAt <= now) {
      const cur = await this.d.store.update(x.id, x.version, { status: "needs_decision", decisionReason: "El método de pago se autorizó después del primer vencimiento: decide la primera mensualidad" }, now);
      await this.d.store.event({ externalId: x.id, kind: "needs_decision", ref: String(x.firstChargeAt), detail: { firstChargeAt: x.firstChargeAt }, actor, at: now });
      opsLog("warn", "External", "needs_decision", { externalId: x.id });
      recordFailure("external.needs_decision");
      return cur;
    }
    const { g } = this.stripe();
    const productId = await g.ensureServiceProduct({ id: `es_ext_${x.serviceKey.replace(/-/g, "_")}`, name: x.serviceName, metadata: { es_external_service: x.serviceKey } });
    const taxRateId = await g.ensureTaxRate({ percentageBp: x.taxRateBp, displayName: "IVA", country: "ES", description: `IVA ${x.taxRateBp / 100} % (España)` });
    const sub = await g.createServiceSubscription(
      {
        customerId: x.stripeCustomerId!,
        productId,
        unitAmount: x.amountCents,
        currency: x.currency,
        interval: "month",
        taxRateId,
        trialEnd: Math.floor(x.firstChargeAt / 1000),
        defaultPaymentMethod: x.stripePaymentMethodId!,
        metadata: { es_external_id: String(x.id), es_contract_id: String(x.contractId), es_company_id: String(x.companyId), es_env: this.d.namespace },
        description: `${x.serviceName} — cuota mensual (contrato #${x.contractId})`,
      },
      // Una suscripción por contrato y fecha de primer cargo: repetir nunca crea otra
      `es-${this.d.namespace}-ext-${x.id}-sub-${x.firstChargeAt}`,
    );
    const cur = await this.d.store.update(x.id, x.version, { status: "scheduled", stripeSubscriptionId: sub.id, decisionReason: null }, now);
    await this.d.store.event({ externalId: x.id, kind: "scheduled", ref: sub.id, detail: { firstChargeAt: x.firstChargeAt, productId, taxRateId }, actor, at: now });
    return cur;
  }

  /** Decisión sobre la primera mensualidad (método autorizado tarde): nueva fecha de primer cargo, registrada en el contrato. */
  async decideFirstCharge(id: number, input: { firstChargeDate: string; reason: string }, actor: string) {
    const x = await this.must(id);
    if (x.status !== "needs_decision") throw new ExternalError("invalid_state", "No hay ninguna decisión pendiente");
    const reason = String(input.reason ?? "").trim();
    if (reason.length < 10) throw new ExternalError("invalid_input", "Explica la decisión (al menos 10 caracteres)");
    let at: number;
    try {
      at = chargeInstant(input.firstChargeDate, x.billingHour, x.timezone);
    } catch {
      throw new ExternalError("invalid_input", "Fecha no válida (AAAA-MM-DD)");
    }
    if (at <= this.now()) throw new ExternalError("invalid_input", "La nueva fecha debe ser futura (no se cobra con retroactividad)");
    if (localDate(at, x.timezone).day !== x.billingDay) throw new ExternalError("invalid_input", `Debe caer en el día de cobro (${x.billingDay})`);
    const now = this.now();
    const cur = await this.d.store.update(x.id, x.version, { firstChargeAt: at }, now);
    await this.d.store.event({ externalId: x.id, kind: "first_charge_decided", ref: String(at), detail: { from: x.firstChargeAt, to: at, reason }, actor, at: now });
    await this.d.crm.log("contract", x.contractId, "note", `Cambio del calendario de cobro: primer cargo el ${input.firstChargeDate}. Motivo: ${reason}`, actor);
    return this.schedule(cur, actor);
  }

  // ── 4. Cobros, renovaciones e impagos (webhooks y conciliación) ───────────

  /** Estado de cobro releído de Stripe. Idempotente: cada factura se registra una sola vez por resultado. */
  async handleSubscription(sub: GwSubscription, invoice?: GwInvoice | null): Promise<string> {
    const x = (await this.d.store.byStripeSubscription(sub.id)) ?? null;
    if (!x) return "Suscripción no registrada";
    if (sub.metadata.es_external_id !== String(x.id) || sub.metadata.es_env !== this.d.namespace || sub.customerId !== x.stripeCustomerId) throw new ExternalError("conflict", "La suscripción de Stripe no corresponde a esta contratación");
    const g = this.d.gateway!;
    const inv = invoice && invoice.subscriptionId === sub.id ? invoice : sub.latestInvoiceId ? await g.invoice(sub.latestInvoiceId) : null;
    const now = this.now();
    const patch: Parameters<ExternalStore["update"]>[2] = {};
    let status: ExternalStatus = x.status;
    if (sub.status === "canceled" || sub.status === "incomplete_expired") status = "canceled";
    else if (inv && (inv.total ?? inv.subtotal ?? 0) > 0) {
      const periodStart = inv.periodStart !== null ? inv.periodStart * 1000 : null;
      patch.lastInvoiceId = inv.id;
      patch.lastInvoiceStatus = inv.status;
      if (inv.status === "paid") {
        status = "active";
        patch.graceUntil = null;
        if (periodStart !== null) patch.currentPeriodStart = periodStart;
        if (sub.currentPeriodEnd) patch.currentPeriodEnd = sub.currentPeriodEnd * 1000;
        const { created } = await this.d.store.event({ externalId: x.id, kind: "invoice_paid", ref: inv.id, detail: { amountPaid: inv.amountPaid, subtotal: inv.subtotal, tax: inv.taxCents, period: periodStart ? periodLabel(periodStart, x.timezone) : null, number: inv.number }, actor: "system:stripe", at: now });
        if (created) opsLog("info", "External", "invoice_paid", { externalId: x.id, invoiceId: inv.id });
      } else if (inv.status === "open") {
        status = "past_due";
        if (periodStart !== null) patch.graceUntil = graceEnd(periodStart, x.graceDays, x.timezone);
        const { created } = await this.d.store.event({ externalId: x.id, kind: "invoice_payment_failed", ref: inv.id, detail: { amountDue: inv.total ?? inv.subtotal, period: periodStart ? periodLabel(periodStart, x.timezone) : null, hostedInvoiceUrl: inv.hostedInvoiceUrl }, actor: "system:stripe", at: now });
        if (created) {
          opsLog("warn", "External", "invoice_payment_failed", { externalId: x.id, invoiceId: inv.id });
          recordFailure("external.payment_failed");
        }
      }
    } else if (sub.status === "trialing" && x.status === "scheduled") status = "scheduled";
    if (status !== x.status) patch.status = status;
    if (!Object.keys(patch).length) return `Sin cambios (${x.status})`;
    await this.d.store.update(x.id, x.version, patch, now);
    return `${x.status} → ${status}`;
  }

  /**
   * Evaluación del margen de cobro (día 5): facturas pendientes con el margen cumplido → alerta administrativa, una sola
   * vez por factura. Nunca crea cargos ni detiene la infraestructura del cliente.
   */
  async evaluateOverdue(): Promise<Array<{ externalId: number; invoiceId: string | null; graceUntil: number }>> {
    const now = this.now();
    const out: Array<{ externalId: number; invoiceId: string | null; graceUntil: number }> = [];
    for (const x of await this.d.store.list({ status: "past_due" })) {
      if (x.graceUntil === null || x.graceUntil > now) continue;
      const { created } = await this.d.store.event({ externalId: x.id, kind: "overdue_after_grace", ref: x.lastInvoiceId ?? String(x.graceUntil), detail: { graceUntil: x.graceUntil, invoiceId: x.lastInvoiceId }, actor: "system:overdue", at: now });
      if (!created) continue;
      out.push({ externalId: x.id, invoiceId: x.lastInvoiceId, graceUntil: x.graceUntil });
      opsLog("error", "External", "overdue_after_grace", { externalId: x.id, invoiceId: x.lastInvoiceId });
      recordFailure("external.overdue_after_grace");
      await this.d.crm.log("contract", x.contractId, "note", `Factura ${x.lastInvoiceId ?? ""} sin cobrar al cumplirse el margen (día ${x.billingDay + x.graceDays - 1}): revisar con el cliente. El servicio no se detiene automáticamente`, "system:overdue");
    }
    return out;
  }

  /** Enlace al portal de facturación de Stripe (facturas y método de pago) para enviarlo al cliente. */
  async portalLink(id: number): Promise<string> {
    const x = await this.must(id);
    if (!x.stripeCustomerId) throw new ExternalError("invalid_state", "El cliente aún no tiene cuenta de cobro en Stripe");
    const g = this.d.gateway;
    if (!g) throw new ExternalError("unavailable", "Stripe no está configurado en este entorno");
    return (await g.createPortalSession({ customerId: x.stripeCustomerId, returnUrl: this.d.urls.portalReturn })).url;
  }

  async detail(id: number) {
    const x = await this.must(id);
    const doc = await this.document(x).catch(() => null);
    return {
      external: x,
      monthly: { net: x.amountCents, tax: taxCents(x), total: x.amountCents + taxCents(x) },
      contract: doc ? { id: doc.contract.id, reference: doc.contract.reference, status: doc.contract.status, version: doc.version, signatureMethod: doc.contract.signatureMethod, signedAt: doc.contract.signedAt } : null,
      documentSha256: doc?.sha256 ?? null,
      acceptances: (await this.d.store.acceptances(x.contractId)).map(({ acceptedIpHash: _ip, ...a }) => a),
      events: await this.d.store.events(x.id),
    };
  }

  list(f: { companyId?: number; status?: string } = {}) {
    return this.d.store.list(f);
  }
}
