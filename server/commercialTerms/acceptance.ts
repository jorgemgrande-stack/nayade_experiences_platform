/**
 * Contrato y aceptación del cliente de unas condiciones comerciales personalizadas. Reutiliza lo que ya existe:
 *  - los contratos del CRM (`crm_contracts` y sus versiones inmutables; un contrato firmado no se reescribe: unas
 *    condiciones nuevas son SIEMPRE un contrato nuevo, enlazado con el anterior);
 *  - el circuito de aceptación electrónica con evidencias (`crm_contract_acceptances`): enlace personal de un solo
 *    uso (solo se guarda su huella), huella SHA-256 del documento exacto, identidad declarada, fecha, IP seudonimizada
 *    y navegador; si el documento cambia tras enviarse, el enlace deja de valer.
 *
 * Unas condiciones que exigen aceptación NO se activan por adelantado: se activan al aceptarse (o se prepara la
 * contratación del paquete). Si la activación automática falla, la aceptación queda registrada y el administrador
 * la completa desde el CRM.
 */
import crypto from "node:crypto";
import express, { type Request, type Response, type Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import type { CrmService } from "../crm/service";
import type { CrmStore } from "../crm/store";
import { CONTRACT_CSS, contractHeaderHtml } from "../external/presentation";
import type { ExternalStore } from "../external/store";
import type { ContractAcceptance } from "../external/types";
import { ISSUER } from "../stripe/issuer";
import type { SubscriptionService } from "../subscriptions/service";
import type { SubscriptionStore } from "../subscriptions/store";
import { requireCustomPricing } from "./permission";
import { madridDateTime, money, presentTerms, renderTermsDocument, sha256, type ClientView } from "./presentation";
import { TermsError, type CommercialTermsService } from "./service";
import type { TermsRecord, TermsStore } from "./store";

/** Lo que se reutiliza del almacén de aceptaciones de los servicios externos (misma tabla). */
export type AcceptanceStore = Pick<ExternalStore, "insertAcceptance" | "acceptanceByToken" | "acceptances" | "markAccepted" | "setAcceptanceStatus">;

const TOKEN_TTL_MS = 30 * 86_400_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ACTOR = "public:acceptance";

export interface TermsDocument {
  text: string;
  sha256: string;
  view: ClientView;
  reference: string;
  /** Versión del contrato del CRM (0 si todavía no hay contrato). */
  version: number;
  company: { name: string; legalName: string | null };
}

export class TermsAcceptanceService {
  private now: () => number;
  constructor(
    private d: {
      terms: CommercialTermsService;
      termsStore: TermsStore;
      subscriptions: SubscriptionService;
      subscriptionStore: SubscriptionStore;
      crm: CrmService;
      crmStore: CrmStore;
      acceptances: AcceptanceStore;
      /** URL pública de la página de aceptación (sin el token). */
      url: string;
      ipSalt?: string;
      now?: () => number;
    },
  ) {
    this.now = d.now ?? Date.now;
  }

  // ── Documento ──────────────────────────────────────────────────────────────────

  /** Documento contractual del acuerdo, con la presentación elegida. Determinista (misma huella mientras no cambie). */
  async document(termsId: number, as?: { reference: string; version: number }): Promise<TermsDocument> {
    const t = await this.d.terms.must(termsId);
    const next = t.nextTermsId !== null ? await this.d.termsStore.get(t.nextTermsId) : null;
    const company = await this.d.crmStore.get("companies", t.companyId);
    if (!company) throw new TermsError("not_found", "Empresa no encontrada");
    const sub = t.subscriptionId !== null ? await this.d.subscriptionStore.get(t.subscriptionId) : null;
    const contract = t.contractId !== null ? await this.d.crmStore.get("contracts", t.contractId) : null;
    const reference = as?.reference ?? contract?.reference ?? `CP-${t.id}`;
    const version = as?.version ?? contract?.version ?? 0;
    // Antes de activarse la fecha es la prevista; después, la real
    const view = presentTerms(t, next);
    const text = renderTermsDocument({
      view,
      reference,
      version,
      issuer: { legalName: ISSUER.legalName, taxId: ISSUER.taxId, address: `${ISSUER.address.line1}, ${ISSUER.address.line2}, ${ISSUER.address.postalCode} ${ISSUER.address.city}` },
      client: { name: company.name, legalName: company.legalName ?? null, taxId: company.taxId ?? null },
      subscriptionReference: sub?.reference ?? null,
      startsOnAcceptance: t.effectiveFrom === null,
    });
    return { text, sha256: sha256(text), view, reference, version, company: { name: company.name, legalName: company.legalName ?? null } };
  }

  // ── Solicitud de aceptación ────────────────────────────────────────────────────

  private async revokePending(contractId: number) {
    for (const a of await this.d.acceptances.acceptances(contractId)) if (a.status === "pending") await this.d.acceptances.setAcceptanceStatus(a.id, "revoked");
  }

  /**
   * Envía las condiciones a aceptación: crea (o actualiza, si sigue en borrador) su contrato en el CRM con el texto
   * exacto, lo marca enviado y genera el enlace personal del firmante. Repetirlo genera un enlace nuevo y revoca el
   * anterior. El acuerdo queda «pendiente de aceptación» y ya no se edita (hay que retirarlo antes).
   */
  async request(termsId: number, input: { signer: { name: string; email: string; role?: string | null; taxId?: string | null }; expectedRevision: number }, actor: string) {
    const t = await this.d.terms.must(termsId);
    if (!t.requiresAcceptance) throw new TermsError("invalid_state", "Estas condiciones no exigen la aceptación del cliente: márcalo en el borrador");
    if (t.status !== "draft" && t.status !== "pending_acceptance") throw new TermsError("invalid_state", "Estas condiciones ya no están pendientes");
    if (t.acceptanceStatus === "accepted") throw new TermsError("invalid_state", "Estas condiciones ya están aceptadas");
    if (t.revision !== input.expectedRevision) throw new TermsError("version_conflict", `Otra persona modificó estas condiciones antes (revisión actual ${t.revision}). Recarga para no perder cambios.`, { current: t.revision });
    const name = String(input.signer.name ?? "").trim();
    const email = String(input.signer.email ?? "").trim().toLowerCase();
    if (name.length < 3 || name.length > 160 || !EMAIL_RE.test(email)) throw new TermsError("invalid_input", "Indica el nombre y el correo del representante autorizado del cliente");
    const now = this.now();
    const sub = t.subscriptionId !== null ? await this.d.subscriptionStore.get(t.subscriptionId) : null;
    // Contrato del CRM: uno nuevo por acuerdo (el anterior de la suscripción, si lo hay, queda como antecedente intacto)
    let contract = t.contractId !== null ? await this.d.crmStore.get("contracts", t.contractId) : null;
    if (contract && contract.status !== "draft" && contract.status !== "sent") throw new TermsError("invalid_state", "El contrato de estas condiciones ya está firmado: no se reescribe");
    const summary = presentTerms(t);
    const fields = { amountCents: summary.recurring.netCents, currency: t.currency, billingInterval: t.interval, autoRenew: true };
    if (!contract) {
      contract = await this.d.crm.createContract({ companyId: t.companyId, ...fields, ...(sub?.contractId ? { previousContractId: sub.contractId } : {}) }, actor);
      await this.d.termsStore.patch(t.id, { contractId: contract.id }, null, now);
    }
    // El texto lleva la referencia y la versión del contrato: se fija la versión que tendrá tras guardar el texto
    const draft = await this.document(t.id, { reference: contract.reference ?? `CT-${contract.id}`, version: contract.version + 1 });
    contract = await this.d.crm.updateContract(contract.id, { ...fields, conditions: draft.text, reason: `Condiciones comerciales personalizadas ${t.id} (revisión ${t.revision})` }, actor);
    const doc = await this.document(t.id, { reference: contract.reference ?? `CT-${contract.id}`, version: contract.version });
    if (doc.text !== contract.conditions) contract = await this.d.crm.updateContract(contract.id, { conditions: doc.text, reason: "Texto definitivo del contrato" }, actor);
    const final = await this.document(t.id, { reference: contract.reference ?? `CT-${contract.id}`, version: contract.version });
    if (contract.status === "draft") contract = await this.d.crm.setContractStatus(contract.id, "sent", actor);
    await this.revokePending(contract.id);
    const token = crypto.randomBytes(32).toString("base64url");
    const a = await this.d.acceptances.insertAcceptance({
      contractId: contract.id,
      contractVersion: contract.version,
      documentSha256: final.sha256,
      tokenSha256: sha256(token),
      status: "pending",
      signerName: name,
      signerEmail: email,
      signerRole: input.signer.role?.trim() || null,
      signerTaxId: input.signer.taxId?.trim() || null,
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
    const terms = await this.d.termsStore.patch(
      t.id,
      { status: "pending_acceptance", acceptanceStatus: "pending", contractId: contract.id, contractVersion: contract.version, acceptanceId: a.id },
      { kind: "acceptance_requested", actor, reason: t.reason, before: { status: t.status }, after: { status: "pending_acceptance", contractId: contract.id, contractVersion: contract.version, documentSha256: final.sha256, signerEmail: email }, effectiveAt: t.effectiveFrom, acceptanceStatus: "pending", syncResult: null, economic: null },
      now,
    );
    await this.d.crm.log("contract", contract.id, "note", `Condiciones comerciales personalizadas enviadas a aceptación a ${email} (versión ${contract.version}, huella ${final.sha256.slice(0, 16)}…)`, actor);
    return { terms, acceptanceId: a.id, url: `${this.d.url}?token=${token}`, expiresAt: a.expiresAt, documentSha256: final.sha256, contract: { id: contract.id, reference: contract.reference, version: contract.version } };
  }

  /** Retira unas condiciones enviadas a aceptación: revoca el enlace y las devuelve a borrador (el contrato vuelve a borrador). */
  async withdraw(termsId: number, input: { reason: string; expectedRevision: number }, actor: string) {
    const t = await this.d.terms.must(termsId);
    if (t.status !== "pending_acceptance") throw new TermsError("invalid_state", "Estas condiciones no están pendientes de aceptación");
    if (t.acceptanceStatus === "accepted") throw new TermsError("invalid_state", "Estas condiciones ya están aceptadas: no se retiran");
    if (t.revision !== input.expectedRevision) throw new TermsError("version_conflict", `Otra persona modificó estas condiciones antes (revisión actual ${t.revision}). Recarga para no perder cambios.`, { current: t.revision });
    const reason = String(input.reason ?? "").trim();
    if (reason.length < 5) throw new TermsError("invalid_input", "Indica el motivo (al menos 5 caracteres)");
    if (t.contractId !== null) {
      await this.revokePending(t.contractId);
      const c = await this.d.crmStore.get("contracts", t.contractId);
      if (c?.status === "sent") await this.d.crm.setContractStatus(c.id, "draft", actor);
    }
    return this.d.termsStore.patch(t.id, { status: "draft", acceptanceStatus: "pending", acceptanceId: null }, { kind: "acceptance_withdrawn", actor, reason: reason.slice(0, 500), before: { status: "pending_acceptance" }, after: { status: "draft" }, effectiveAt: null, acceptanceStatus: "pending", syncResult: null, economic: null }, this.now());
  }

  // ── Página pública ─────────────────────────────────────────────────────────────

  private async pending(token: string): Promise<{ a: ContractAcceptance; t: TermsRecord; doc: TermsDocument }> {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token ?? "")) throw new TermsError("not_found", "Enlace no válido");
    const a = await this.d.acceptances.acceptanceByToken(sha256(token));
    if (!a) throw new TermsError("not_found", "Enlace no válido");
    if (a.status === "accepted") throw new TermsError("invalid_state", "Estas condiciones ya están aceptadas");
    if (a.status !== "pending") throw new TermsError("invalid_state", "Este enlace ya no es válido: solicita uno nuevo");
    if (a.expiresAt <= this.now()) {
      await this.d.acceptances.setAcceptanceStatus(a.id, "expired");
      throw new TermsError("invalid_state", "Este enlace ha caducado: solicita uno nuevo");
    }
    const t = (await this.d.termsStore.list({ status: ["pending_acceptance"] })).find((x) => x.acceptanceId === a.id && x.contractId === a.contractId);
    if (!t) throw new TermsError("invalid_state", "Este enlace ya no es válido: solicita uno nuevo");
    const doc = await this.document(t.id);
    // Lo aceptado debe ser exactamente lo presentado
    if (doc.sha256 !== a.documentSha256 || doc.version !== a.contractVersion) throw new TermsError("invalid_state", "Las condiciones han cambiado desde que se envió este enlace: solicita uno nuevo");
    return { a, t, doc };
  }

  private declaration(a: Pick<ContractAcceptance, "signerName">, doc: TermsDocument) {
    const v = doc.view;
    const per = v.interval === "year" ? "al año" : "al mes";
    return `Yo, ${a.signerName}, declaro que tengo poder suficiente para obligar a ${doc.company.legalName ?? doc.company.name} y acepto las condiciones comerciales particulares ${doc.reference} (versión ${doc.version}, huella ${doc.sha256.slice(0, 16)}…), con una cuota de ${money(v.recurring.netCents, v.currency)} ${per} más impuestos${v.oneTime.length ? " y los pagos únicos indicados" : ""}.`;
  }

  /** Lo que ve el firmante: el documento exacto, su huella y la declaración que debe confirmar. */
  async view(token: string) {
    const { a, doc } = await this.pending(token);
    return { signerName: a.signerName, signerRole: a.signerRole, company: doc.company.legalName ?? doc.company.name, document: doc.text, documentSha256: doc.sha256, reference: doc.reference, version: doc.version, declaration: this.declaration(a, doc), expiresAt: a.expiresAt };
  }

  /** Aceptación: evidencias, contrato firmado y activación de las condiciones (o contratación del paquete). */
  async accept(token: string, input: { name: string; taxId?: string | null; accept: boolean }, ctx: { ip: string | null; userAgent: string | null }) {
    const { a, t, doc } = await this.pending(token);
    if (input.accept !== true) throw new TermsError("invalid_input", "Debes marcar la aceptación de las condiciones");
    const name = String(input.name ?? "").trim();
    if (name.length < 3 || name.length > 160) throw new TermsError("invalid_input", "Escribe tu nombre completo");
    const now = this.now();
    const ok = await this.d.acceptances.markAccepted(a.id, {
      acceptedName: name,
      acceptedTaxId: input.taxId?.trim().slice(0, 32) || null,
      acceptedAt: now,
      acceptedIpHash: ctx.ip && this.d.ipSalt ? sha256(`${this.d.ipSalt}:${ctx.ip}`) : null,
      acceptedUserAgent: ctx.userAgent?.slice(0, 300) ?? null,
      consentText: this.declaration(a, doc),
    });
    if (!ok) throw new TermsError("invalid_state", "Estas condiciones ya están aceptadas");
    await this.d.crm.setContractStatus(a.contractId, "signed", ACTOR, { signatureMethod: "electronic", signatureRef: `aceptacion:${a.id}:${doc.sha256.slice(0, 16)}` });
    const accepted = await this.d.termsStore.patch(
      t.id,
      { acceptanceStatus: "accepted" },
      { kind: "accepted", actor: ACTOR, reason: `Aceptación electrónica de ${name}`, before: { acceptanceStatus: "pending" }, after: { acceptanceStatus: "accepted", acceptanceId: a.id, contractId: a.contractId, contractVersion: doc.version, documentSha256: doc.sha256, acceptedName: name }, effectiveAt: t.effectiveFrom, acceptanceStatus: "accepted", syncResult: null, economic: null },
      now,
    );
    await this.d.crm.log("contract", a.contractId, "note", `Condiciones comerciales aceptadas electrónicamente por ${name} (versión ${doc.version}, huella ${doc.sha256.slice(0, 16)}…)`, ACTOR);
    // Lo que dependía de la aceptación se activa ahora. Si falla, la aceptación ya consta y se completa desde el CRM
    let activated = false;
    try {
      await this.activateAccepted(accepted, a.contractId);
      activated = true;
    } catch (e) {
      opsLog("warn", "CommercialTerms", "activation_after_acceptance_failed", { termsId: t.id, error: e instanceof Error ? e.name : "error" });
      await this.d.termsStore.log(t.id, { kind: "activation_failed", actor: ACTOR, reason: (e instanceof Error ? e.message : "Error").slice(0, 500), before: null, after: null, effectiveAt: null, acceptanceStatus: "accepted", syncResult: "failed", economic: null }, this.now()).catch(() => undefined);
    }
    return { accepted: true, activated, reference: doc.reference, version: doc.version, documentSha256: doc.sha256, acceptedAt: now, view: doc.view };
  }

  /** Activa unas condiciones ya aceptadas y enlaza la suscripción con el contrato firmado que las formaliza. */
  async activateAccepted(t: TermsRecord, contractId: number) {
    const reason = "Aceptación del cliente";
    let subscriptionId: number;
    if (t.subscriptionId === null) {
      const out = await this.d.terms.prepareContracting(t.id, { expectedRevision: t.revision, reason }, ACTOR);
      subscriptionId = out.subscription.id;
    } else {
      const sub = await this.d.subscriptionStore.get(t.subscriptionId);
      if (!sub) throw new TermsError("not_found", "Suscripción no encontrada");
      await this.d.terms.activate(t.id, { expectedRevision: t.revision, expectedVersion: sub.version, reason }, ACTOR);
      subscriptionId = sub.id;
    }
    const cur = await this.d.subscriptionStore.get(subscriptionId);
    if (cur && cur.contractId !== contractId) {
      await this.d.subscriptions.linkContract(subscriptionId, { contractId, reason: "Contrato de las condiciones comerciales aceptadas" }, cur.version, ACTOR).catch((e) => opsLog("warn", "CommercialTerms", "contract_link_failed", { subscriptionId, error: e instanceof Error ? e.name : "error" }));
    }
  }

  /** Estado de la aceptación de un acuerdo para el CRM (firmante, fechas y evidencias; nunca el enlace). */
  async status(termsId: number) {
    const t = await this.d.terms.must(termsId);
    const all = t.contractId !== null ? await this.d.acceptances.acceptances(t.contractId) : [];
    const contract = t.contractId !== null ? await this.d.crmStore.get("contracts", t.contractId) : null;
    return {
      acceptanceStatus: t.acceptanceStatus,
      requiresAcceptance: t.requiresAcceptance,
      contract: contract ? { id: contract.id, reference: contract.reference, version: contract.version, status: contract.status, signedAt: contract.signedAt ?? null } : null,
      acceptances: all.map((a) => ({ id: a.id, status: a.status, signerName: a.signerName, signerEmail: a.signerEmail, signerRole: a.signerRole, contractVersion: a.contractVersion, documentSha256: a.documentSha256, acceptedName: a.acceptedName, acceptedAt: a.acceptedAt, expiresAt: a.expiresAt, createdBy: a.createdBy, createdAt: a.createdAt })),
      timeZone: "Europe/Madrid" as const,
    };
  }
}

// ── Rutas del operador ───────────────────────────────────────────────────────────

const fail = (res: Response, e: unknown) => {
  if (e instanceof TermsError) return void res.status(e.code === "not_found" ? 404 : e.code === "invalid_input" ? 400 : 409).json({ error: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) });
  if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: e.issues.map((i) => `${i.path.join(".") || "cuerpo"}: ${i.message}`).join("; ") });
  if (e instanceof Error && e.name === "CrmError") return void res.status(409).json({ error: "invalid_state", message: e.message });
  opsLog("error", "CommercialTerms", "acceptance_error", { error: e instanceof Error ? e.name : "error" });
  res.status(500).json({ error: "internal_error", message: "Error interno" });
};

/** `/cp/v1/commercial-terms/:id/{document,acceptance…}`: documento, envío a aceptación, retirada y estado. */
export function createTermsAcceptanceRouter(svc: TermsAcceptanceService): Router {
  const r = express.Router();
  const id = z.coerce.number().int().positive();
  const who = (req: Request) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}`;
  const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response) => fn(req, res).catch((e) => fail(res, e));
  r.get("/commercial-terms/:id/document", requireScope("subscriptions:read"), wrap(async (req, res) => void res.json(await svc.document(id.parse(req.params.id)))));
  r.get("/commercial-terms/:id/acceptance", requireScope("subscriptions:read"), wrap(async (req, res) => void res.json(await svc.status(id.parse(req.params.id)))));
  r.post("/commercial-terms/:id/acceptance", requireCustomPricing(), wrap(async (req, res) => {
    const b = z.object({ signer: z.object({ name: z.string().trim().min(3).max(160), email: z.string().trim().max(254), role: z.string().max(120).nullable().optional(), taxId: z.string().max(32).nullable().optional() }).strict(), expectedRevision: z.number().int().min(1) }).strict().parse(req.body);
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json(await svc.request(id.parse(req.params.id), b, who(req)));
  }));
  r.post("/commercial-terms/:id/acceptance/withdraw", requireCustomPricing(), wrap(async (req, res) => {
    const b = z.object({ reason: z.string().trim().min(5).max(500), expectedRevision: z.number().int().min(1) }).strict().parse(req.body);
    res.json({ terms: await svc.withdraw(id.parse(req.params.id), b, who(req)) });
  }));
  return r;
}

// ── Página pública de aceptación (sin scripts: formulario HTML) ──────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const shell = (title: string, body: string) =>
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${CONTRACT_CSS}</style></head><body><div class="doc"><article class="sheet">${contractHeaderHtml()}<div style="margin-top:24px">${body}</div></article></div><footer class="site">Big Elephant · ${esc(ISSUER.legalName)}</footer></body></html>`;
const HEADING = /^[A-ZÁÉÍÓÚÑ ,]{4,}$/;
/** El texto registrado, maquetado: título, partes, apartados y listas. No reescribe nada. */
export function documentHtml(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [`<h1>${esc(lines[0] ?? "")}</h1>`];
  let list = false;
  const close = () => {
    if (list) out.push("</ul>");
    list = false;
  };
  for (const l of lines.slice(1)) {
    if (!l.trim()) {
      close();
      continue;
    }
    if (HEADING.test(l.trim())) {
      close();
      out.push(`<h3>${esc(l.trim())}</h3>`);
    } else if (l.startsWith("- ")) {
      if (!list) out.push("<ul>");
      list = true;
      out.push(`<li>${esc(l.slice(2))}</li>`);
    } else {
      close();
      out.push(`<p>${esc(l)}</p>`);
    }
  }
  close();
  return out.join("\n");
}

export function createTermsPublicAcceptanceRouter(svc: TermsAcceptanceService): Router {
  const r = express.Router();
  r.use(rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? "")}` }));
  const send = (res: Response, status: number, html: string) => {
    res.status(status);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    res.send(html);
  };
  const failPage = (res: Response, e: unknown) => {
    if (e instanceof TermsError) return send(res, e.code === "not_found" ? 404 : e.code === "invalid_input" ? 400 : 409, shell("Aceptación de condiciones", `<h1>Aceptación de condiciones</h1><p class="err">${esc(e.message)}</p>`));
    opsLog("error", "CommercialTerms", "acceptance_page_error", { error: e instanceof Error ? e.name : "error" });
    send(res, 500, shell("Aceptación de condiciones", `<h1>Aceptación de condiciones</h1><p class="err">No se ha podido completar la operación. Inténtalo más tarde.</p>`));
  };
  r.get("/", (req, res) => {
    const token = String(req.query.token ?? "");
    svc
      .view(token)
      .then((v) => {
        const form = `<section class="accept" id="aceptar"><h3>Aceptación</h3>
<p>Firmante: <strong>${esc(v.signerName)}</strong>${v.signerRole ? ` · ${esc(v.signerRole)}` : ""}, en nombre de <strong>${esc(v.company)}</strong>.</p>
<form method="post" action="">
<input type="hidden" name="token" value="${esc(token)}">
<label>Nombre completo<input type="text" name="name" required maxlength="160" autocomplete="name"></label>
<label>NIF del firmante (opcional)<input type="text" name="taxId" maxlength="32"></label>
<label class="check"><input type="checkbox" name="accept" value="1" required><span>${esc(v.declaration)}</span></label>
<p class="muted">Aceptar estas condiciones no realiza ningún cobro. Huella del documento: ${esc(v.documentSha256)}. Enlace personal válido hasta el ${esc(madridDateTime(v.expiresAt))}.</p>
<div class="actions"><button class="btn" type="submit">Aceptar las condiciones</button></div>
</form></section>`;
        send(res, 200, shell("Aceptación de condiciones", `${documentHtml(v.document)}${form}`));
      })
      .catch((e) => failPage(res, e));
  });
  r.post("/", express.urlencoded({ extended: false, limit: "8kb" }), (req, res) => {
    const b = (req.body ?? {}) as Record<string, string>;
    svc
      .accept(String(b.token ?? req.query.token ?? ""), { name: String(b.name ?? ""), taxId: b.taxId ? String(b.taxId) : null, accept: b.accept === "1" }, { ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null })
      .then((a) =>
        send(
          res,
          200,
          shell(
            "Condiciones aceptadas",
            `<h1>Condiciones aceptadas</h1><p class="ok">Hemos registrado tu aceptación de ${esc(a.reference)} (versión ${a.version}, ${esc(madridDateTime(a.acceptedAt))}).</p><p>No se ha realizado ningún cobro. ${a.activated ? "Las condiciones quedan activadas conforme al documento aceptado." : "Tu contacto de Big Elephant completará la activación de las condiciones."}</p><p class="muted">Huella del documento aceptado: ${esc(a.documentSha256)}.</p>`,
          ),
        ),
      )
      .catch((e) => failPage(res, e));
  });
  return r;
}
