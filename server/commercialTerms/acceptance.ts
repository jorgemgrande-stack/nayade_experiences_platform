/**
 * Contrato y aceptación del cliente de unas condiciones comerciales personalizadas. Reutiliza lo que ya existe:
 *  - los contratos del CRM (`crm_contracts` y sus versiones inmutables; un contrato firmado no se reescribe: unas
 *    condiciones nuevas son SIEMPRE un contrato nuevo, enlazado con el anterior);
 *  - el circuito de aceptación electrónica con evidencias (`crm_contract_acceptances`): enlace personal que se busca
 *    por su huella, huella SHA-256 del documento exacto, identidad declarada, fecha, IP seudonimizada y navegador; si
 *    el documento cambia tras enviarse, el enlace deja de valer. Abrirlo no lo consume: solo la aceptación lo cierra
 *    (y también la caducidad, la retirada o un enlace nuevo).
 *  - el correo transaccional de plataforma (categoría `contract_invitation`, plantilla `contract.terms_invitation`):
 *    «Enviar a aceptación» manda el contrato al representante autorizado que indica el operador, con las mismas cifras
 *    del documento. Con la migración 0051 del CRM el enlace se guarda además CIFRADO (`acceptanceLinks.ts`) y el
 *    operador con el permiso de precios personalizados puede volver a consultarlo, copiarlo, reenviarlo o regenerarlo
 *    (mismo contrato y misma versión) en cualquier momento, con el historial de envíos.
 * Nada de esto cobra: enviar, abrir, reenviar o regenerar el enlace no llama a Stripe ni a la facturación.
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
import type { Keyring } from "../_core/tenantRegistry/crypto";
import type { PdfBlock } from "../documents/brandPdf";
import type { extraTemplates } from "../mail/extraTemplates";
import { openAcceptanceToken, sealAcceptanceToken, type AcceptanceLinkStore, type AcceptanceSend, type AcceptanceSendKind } from "./acceptanceLinks";
import { requireCustomPricing } from "./permission";
import { madridDateTime, money, presentTerms, renderTermsDocument, sha256, type ClientView } from "./presentation";
import { TermsError, type CommercialTermsService } from "./service";
import { TermsConflict, type TermsRecord, type TermsStore } from "./store";

/** Lo que se reutiliza del almacén de aceptaciones de los servicios externos (misma tabla). */
export type AcceptanceStore = Pick<ExternalStore, "insertAcceptance" | "acceptanceByToken" | "acceptances" | "markAccepted" | "setAcceptanceStatus">;

/** Datos de la plantilla `contract.terms_invitation`. */
export type TermsInvitation = Parameters<typeof extraTemplates.termsInvitation>[0];
/** Envío del contrato por el correo de plataforma (lo da `PlatformMailer.termsAcceptanceMail`). */
export interface TermsAcceptanceMail {
  invite(to: string, idempotencyKey: string, i: TermsInvitation): Promise<{ status: string; reason: string | null; duplicate: boolean; id?: number | null }>;
  /** Estado actual del mensaje en la bandeja de salida (aceptado por el proveedor, entregado, rebotado…). */
  status?(id: number): Promise<{ status: string; reason: string | null } | null>;
}

const TOKEN_TTL_MS = 30 * 86_400_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ACTOR = "public:acceptance";
/** Estados del correo que significan «en camino» (encolado, enviándose, aceptado por el proveedor o entregado). */
const MAIL_OK = new Set(["pending", "sending", "accepted", "delivered"]);
/** Motivo legible de un correo que no salió (los códigos son los de la bandeja de salida). */
export function mailReasonText(status: string, reason: string | null): string | null {
  if (MAIL_OK.has(status)) return null;
  const known: Record<string, string> = {
    mode_off: "El correo está desactivado en este entorno.",
    sandbox_recipient_not_allowed: "El correo está en modo de pruebas y este destinatario no está autorizado.",
    scope_not_allowed: "El envío de contratos por correo no está habilitado en este entorno.",
    sender_unavailable: "No hay remitente de correo configurado en este entorno.",
    suppressed: "Este destinatario está bloqueado por rebotes o quejas anteriores.",
    rate_limited_recipient: "Se ha alcanzado el límite de envíos por hora a este destinatario: inténtalo más tarde.",
    rate_limited_tenant: "Se ha alcanzado el límite de envíos por hora: inténtalo más tarde.",
    no_provider: "No hay proveedor de correo configurado en este entorno.",
    invalid_recipient: "La dirección de correo no es válida.",
    mail_not_configured: "El correo de plataforma no está configurado en este entorno.",
  };
  const bounce: Record<string, string> = { bounced: "El correo ha rebotado (dirección inexistente o no válida).", soft_bounced: "Rebote temporal: el proveedor lo reintentará.", blocked: "El proveedor ha bloqueado el envío.", complained: "El destinatario lo marcó como correo no deseado." };
  return (reason && known[reason]) ?? bounce[status] ?? (reason ? `No se ha enviado: ${reason}` : "No se ha enviado el correo.");
}

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
      /** Correo de plataforma; sin él, el envío consta como «no disponible» y el enlace se puede copiar. */
      mail?: TermsAcceptanceMail | null;
      /** Enlaces recuperables (cifrados) e historial de envíos (CRM 0051); sin ellos, el enlace se entrega una sola vez. */
      links?: { store: AcceptanceLinkStore; keyring: Keyring } | null;
      /** Logotipo del PDF del contrato aceptado (sin él, la marca en texto). */
      logo?: () => Promise<Uint8Array | null>;
      /**
       * Tras activar unas condiciones aceptadas (11/11/2026): p. ej. abrir el expediente de implantación de un producto
       * Net de sus partidas. Un fallo nunca deshace la aceptación ni la activación: solo se registra.
       */
      onActivated?: (i: { terms: TermsRecord; subscriptionId: number; contractId: number }) => Promise<unknown>;
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
      next: next ? presentTerms(next) : null,
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
    // No se envía a aceptación lo que no se podría activar, ni un documento que no se puede generar
    await this.d.terms.preflight(t.id);
    await this.document(t.id);
    const sub = t.subscriptionId !== null ? await this.d.subscriptionStore.get(t.subscriptionId) : null;
    // Contrato del CRM: uno nuevo por acuerdo (el anterior de la suscripción, si lo hay, queda como antecedente intacto)
    let contract = t.contractId !== null ? await this.d.crmStore.get("contracts", t.contractId) : null;
    if (contract && contract.status !== "draft" && contract.status !== "sent") throw new TermsError("invalid_state", "El contrato de estas condiciones ya está firmado: no se reescribe");
    const summary = presentTerms(t);
    const fields = { amountCents: summary.recurring.netCents, currency: t.currency, billingInterval: t.interval, autoRenew: true };
    if (!contract) {
      contract = await this.d.crm.createContract({ companyId: t.companyId, ...fields, ...(sub?.contractId ? { previousContractId: sub.contractId } : {}) }, actor);
      // Enlazado ya (con la revisión leída): si otro lo cambió entretanto, se anula el contrato recién creado
      try {
        t.revision = (await this.d.termsStore.patch(t.id, { contractId: contract.id }, null, now, t.revision)).revision;
        t.contractId = contract.id;
      } catch (e) {
        await this.d.crm.setContractStatus(contract.id, "cancelled", actor).catch(() => undefined);
        throw e instanceof TermsConflict ? new TermsError("version_conflict", e.message, { current: e.current }) : e;
      }
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
      t.revision,
    ).catch(async (e) => {
      // Otro cambio se adelantó: el enlace recién creado no vale
      await this.d.acceptances.setAcceptanceStatus(a.id, "revoked");
      throw e instanceof TermsConflict ? new TermsError("version_conflict", e.message, { current: e.current }) : e;
    });
    await this.d.crm.log("contract", contract.id, "note", `Condiciones comerciales personalizadas enviadas a aceptación a ${email} (versión ${contract.version}, huella ${final.sha256.slice(0, 16)}…)`, actor);
    const url = `${this.d.url}?token=${token}`;
    const recoverable = await this.keep(a.id, t.id, contract.id, token, now);
    // El contrato sale por correo al representante; si el correo falla, el enlace sigue valiendo y se reintenta
    const mail = await this.deliver(t.id, a, url, final, "sent", actor);
    return { terms, acceptanceId: a.id, url, expiresAt: a.expiresAt, documentSha256: final.sha256, contract: { id: contract.id, reference: contract.reference, version: contract.version }, recoverable, mail };
  }

  // ── Enlace recuperable y envíos ────────────────────────────────────────────────

  /** Guarda el enlace cifrado (si hay registro 0051). Un fallo no rompe el envío: el enlace se devuelve igualmente. */
  private async keep(acceptanceId: number, termsId: number, contractId: number, token: string, now: number): Promise<boolean> {
    if (!this.d.links) return false;
    try {
      const sealed = sealAcceptanceToken(token, acceptanceId, this.d.links.keyring);
      await this.d.links.store.saveLink({ acceptanceId, termsId, contractId, cipher: sealed.cipher, keyId: sealed.keyId, createdAt: now });
      return true;
    } catch (e) {
      opsLog("warn", "CommercialTerms", "acceptance_link_not_stored", { termsId, acceptanceId, error: e instanceof Error ? e.name : "error" });
      return false;
    }
  }

  /** El enlace guardado de una aceptación, descifrado y comprobado contra su huella; null si no se guardó. */
  private async reveal(a: ContractAcceptance): Promise<string | null> {
    if (!this.d.links) return null;
    const stored = await this.d.links.store.link(a.id);
    if (!stored) return null;
    let token: string;
    try {
      token = openAcceptanceToken(stored, this.d.links.keyring);
    } catch (e) {
      opsLog("error", "CommercialTerms", "acceptance_link_unreadable", { acceptanceId: a.id, error: e instanceof Error ? e.name : "error" });
      return null;
    }
    // Lo descifrado debe ser exactamente el enlace de ESTA aceptación (su huella es la que busca la página pública)
    return (await this.d.acceptances.acceptanceByToken(sha256(token)))?.id === a.id ? token : null;
  }

  /** Datos del correo: las mismas cifras del documento; con cuota global, ningún importe por partida recurrente. */
  private invitation(a: Pick<ContractAcceptance, "signerName" | "expiresAt">, doc: TermsDocument, url: string): TermsInvitation {
    const v = doc.view;
    const pct = (bp: number) => `${(bp / 100).toLocaleString("es-ES", { maximumFractionDigits: 2 })} %`;
    const named = (name: string, quantity: number) => `${name}${quantity > 1 ? ` × ${quantity}` : ""}`;
    return {
      companyName: doc.company.legalName ?? doc.company.name,
      signerName: a.signerName,
      reference: doc.reference,
      version: doc.version,
      packageName: v.packageName,
      services: v.included.map((l) => named(l.name, l.quantity)),
      lines: v.breakdown ? v.breakdown.lines.map((l) => ({ label: named(l.name, l.quantity), cents: l.netCents })) : null,
      netCents: v.recurring.netCents,
      taxes: v.recurring.taxes.map((g) => ({ label: `Impuestos (${pct(g.rateBp)})`, cents: g.taxCents })),
      totalCents: v.recurring.totalCents,
      period: v.interval === "year" ? "anual" : "mensual",
      oneTime: v.oneTime.map((c) => ({ label: c.name, totalCents: c.totalCents })),
      currency: v.currency,
      url,
      expiresAt: a.expiresAt,
    };
  }

  /**
   * Manda el enlace por correo al representante de la aceptación y lo registra (destinatario, fecha, contrato, versión
   * y resultado). Nunca lanza: un fallo del correo se devuelve con su motivo para reintentarlo sin otro contrato.
   */
  private async deliver(termsId: number, a: ContractAcceptance, url: string, doc: TermsDocument, kind: AcceptanceSendKind, actor: string) {
    const at = this.now();
    let mail: { status: string; reason: string | null; outboxId: number | null };
    if (!this.d.mail) mail = { status: "unavailable", reason: "mail_not_configured", outboxId: null };
    else {
      // Una clave por envío: el primer envío de cada enlace es único por enlace; cada reenvío es otro mensaje (su propia
      // clave por instante, para que un historial sin registrar nunca convierta un reenvío en «duplicado» silencioso)
      const key = kind === "resent" ? `terms-acceptance:${a.id}:resend:${at}:${crypto.randomBytes(4).toString("hex")}` : `terms-acceptance:${a.id}:1`;
      try {
        const r = await this.d.mail.invite(a.signerEmail, key, this.invitation(a, doc, url));
        mail = { status: r.status, reason: r.reason, outboxId: r.id ?? null };
      } catch (e) {
        mail = { status: "failed", reason: (e instanceof Error ? e.message : "error").slice(0, 200), outboxId: null };
      }
    }
    const row = this.d.links
      ? await this.d.links.store
          .addSend({ termsId, acceptanceId: a.id, contractId: a.contractId, contractVersion: a.contractVersion, kind, recipientName: a.signerName, recipientEmail: a.signerEmail, outboxId: mail.outboxId, status: mail.status, reason: mail.reason, actor, createdAt: at })
          .catch((e) => void opsLog("warn", "CommercialTerms", "acceptance_send_not_recorded", { termsId, acceptanceId: a.id, error: e instanceof Error ? e.name : "error" }))
      : undefined;
    const ok = MAIL_OK.has(mail.status);
    const what = kind === "resent" ? "reenviado" : kind === "regenerated" ? "con el enlace nuevo enviado" : "enviado";
    await this.d.crm.log("contract", a.contractId, "note", ok ? `Correo del contrato ${what} a ${a.signerEmail} (versión ${a.contractVersion})` : `Correo del contrato a ${a.signerEmail} NO enviado: ${mailReasonText(mail.status, mail.reason)}`, actor).catch(() => undefined);
    if (!ok) opsLog("warn", "CommercialTerms", "acceptance_email_not_sent", { termsId, acceptanceId: a.id, status: mail.status, reason: mail.reason });
    return { to: a.signerEmail, status: mail.status, reason: mail.reason, message: mailReasonText(mail.status, mail.reason), ok, at, sendId: row ? row.id : null };
  }

  /** El acuerdo con su aceptación en curso (la última enviada) y todas las de su contrato. */
  private async current(termsId: number) {
    const t = await this.d.terms.must(termsId);
    const all = t.contractId !== null ? await this.d.acceptances.acceptances(t.contractId) : [];
    return { t, a: all.find((x) => x.id === t.acceptanceId) ?? null, all };
  }

  private linkState(a: ContractAcceptance): "pending" | "accepted" | "revoked" | "expired" {
    return a.status === "pending" && a.expiresAt <= this.now() ? "expired" : a.status;
  }

  /**
   * El enlace en curso para el operador (permiso de precios personalizados): se puede consultar las veces que haga
   * falta y NO se consume. Solo se devuelve mientras sirve (pendiente y sin caducar).
   */
  async link(termsId: number, actor: string) {
    const { t, a } = await this.current(termsId);
    const contract = t.contractId !== null ? await this.d.crmStore.get("contracts", t.contractId) : null;
    if (!a) return { available: !!this.d.links, acceptanceId: null, status: null, url: null, recoverable: false, expiresAt: null, signer: null, contract: null, documentSha256: null };
    const status = this.linkState(a);
    const token = status === "pending" ? await this.reveal(a) : null;
    if (token) opsLog("info", "CommercialTerms", "acceptance_link_viewed", { termsId, acceptanceId: a.id, actor });
    return {
      available: !!this.d.links,
      acceptanceId: a.id,
      status,
      url: token ? `${this.d.url}?token=${token}` : null,
      recoverable: token !== null,
      expiresAt: a.expiresAt,
      signer: { name: a.signerName, email: a.signerEmail, role: a.signerRole },
      contract: contract ? { id: contract.id, reference: contract.reference, version: a.contractVersion } : null,
      documentSha256: a.documentSha256,
    };
  }

  /** Reenvía por correo el MISMO enlace (no crea contrato ni enlace nuevos). Solo si sigue sirviendo. */
  async resend(termsId: number, actor: string) {
    const { t, a } = await this.current(termsId);
    if (t.status !== "pending_acceptance" || t.acceptanceStatus === "accepted" || !a) throw new TermsError("invalid_state", "Estas condiciones no están pendientes de aceptación");
    if (this.linkState(a) !== "pending") throw new TermsError("invalid_state", "El enlace ha caducado o ya no es válido: genera uno nuevo con «Regenerar enlace»", { reason: "link_not_pending" });
    if (!this.d.links) throw new TermsError("invalid_state", "El reenvío del enlace no está disponible en este entorno (falta la migración 0051 del CRM)", { reason: "links_unavailable" });
    const token = await this.reveal(a);
    if (!token) throw new TermsError("invalid_state", "Este enlace no se puede recuperar (se generó antes de poder guardarse): genera uno nuevo con «Regenerar enlace»", { reason: "link_not_recoverable" });
    // Solo se reenvía un enlace que el cliente todavía puede usar (mismo documento, mismo contrato, activable)
    const { doc } = await this.pending(token);
    const url = `${this.d.url}?token=${token}`;
    return { mail: await this.deliver(t.id, a, url, doc, "resent", actor), url, expiresAt: a.expiresAt };
  }

  /**
   * Enlace nuevo para el MISMO contrato y la MISMA versión (el anterior caducó, se revocó o se ha filtrado): no
   * duplica el contrato ni cambia las condiciones. El anterior deja de valer. Por defecto se envía por correo.
   */
  async regenerate(termsId: number, input: { expectedRevision: number; send?: boolean }, actor: string) {
    const { t, a: prev, all } = await this.current(termsId);
    if (t.status !== "pending_acceptance" || t.acceptanceStatus === "accepted" || t.contractId === null) throw new TermsError("invalid_state", "Solo se regenera el enlace de unas condiciones pendientes de aceptación");
    if (t.revision !== input.expectedRevision) throw new TermsError("version_conflict", `Otra persona modificó estas condiciones antes (revisión actual ${t.revision}). Recarga para no perder cambios.`, { current: t.revision });
    const signer = prev ?? all.slice().sort((x, y) => y.id - x.id)[0];
    if (!signer) throw new TermsError("invalid_state", "Estas condiciones no tienen ningún envío previo: envíalas a aceptación");
    const contract = await this.d.crmStore.get("contracts", t.contractId);
    if (!contract || contract.status !== "sent") throw new TermsError("invalid_state", "El contrato de estas condiciones ya no está pendiente de aceptación");
    // Mismo documento que el contrato registrado: si algo cambió, hay que retirarlas y volver a enviarlas
    const doc = await this.document(t.id);
    if (doc.text !== contract.conditions || doc.version !== contract.version) throw new TermsError("invalid_state", "Las condiciones o los datos del cliente han cambiado desde el envío: retíralas y vuelve a enviarlas a aceptación");
    await this.d.terms.preflight(t.id);
    const now = this.now();
    for (const x of all) if (x.status === "pending") await this.d.acceptances.setAcceptanceStatus(x.id, x.expiresAt <= now ? "expired" : "revoked");
    // La revocación y la aceptación compiten por la misma fila: si ganó la aceptación, no se regenera nada
    if ((await this.d.acceptances.acceptances(contract.id)).some((x) => x.status === "accepted")) throw new TermsError("invalid_state", "El cliente acaba de aceptar estas condiciones: ya no hace falta un enlace nuevo");
    const token = crypto.randomBytes(32).toString("base64url");
    const a = await this.d.acceptances.insertAcceptance({
      contractId: contract.id,
      contractVersion: contract.version,
      documentSha256: doc.sha256,
      tokenSha256: sha256(token),
      status: "pending",
      signerName: signer.signerName,
      signerEmail: signer.signerEmail,
      signerRole: signer.signerRole,
      signerTaxId: signer.signerTaxId,
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
    const terms = await this.d.termsStore
      .patch(t.id, { acceptanceId: a.id }, { kind: "acceptance_link_regenerated", actor, reason: "Enlace de aceptación regenerado (mismo contrato y misma versión)", before: { acceptanceId: prev?.id ?? null }, after: { acceptanceId: a.id, contractId: contract.id, contractVersion: contract.version, documentSha256: doc.sha256, signerEmail: a.signerEmail }, effectiveAt: null, acceptanceStatus: "pending", syncResult: null, economic: null }, now, t.revision)
      .catch(async (e) => {
        await this.d.acceptances.setAcceptanceStatus(a.id, "revoked");
        throw e instanceof TermsConflict ? new TermsError("version_conflict", e.message, { current: e.current }) : e;
      });
    await this.d.crm.log("contract", contract.id, "note", `Enlace de aceptación regenerado para ${a.signerEmail} (versión ${contract.version}, huella ${doc.sha256.slice(0, 16)}…); el anterior deja de valer`, actor);
    const url = `${this.d.url}?token=${token}`;
    const recoverable = await this.keep(a.id, t.id, contract.id, token, now);
    const mail = input.send === false ? null : await this.deliver(t.id, a, url, doc, "regenerated", actor);
    return { terms, acceptanceId: a.id, url, expiresAt: a.expiresAt, documentSha256: doc.sha256, contract: { id: contract.id, reference: contract.reference, version: contract.version }, recoverable, mail };
  }

  /** Historial de envíos con el estado actual de cada correo (lo actualizan los eventos del proveedor). */
  private async sendsView(termsId: number) {
    if (!this.d.links) return [];
    const rows: AcceptanceSend[] = (await this.d.links.store.sends(termsId)).slice(0, 50);
    const out = [];
    for (const s of rows) {
      const live = s.outboxId && this.d.mail?.status ? await this.d.mail.status(s.outboxId).catch(() => null) : null;
      const status = live?.status ?? s.status;
      const reason = live ? live.reason : s.reason;
      out.push({ id: s.id, acceptanceId: s.acceptanceId, contractId: s.contractId, contractVersion: s.contractVersion, kind: s.kind, recipientName: s.recipientName, recipientEmail: s.recipientEmail, status, reason, message: mailReasonText(status, reason), ok: MAIL_OK.has(status), actor: s.actor, createdAt: s.createdAt });
    }
    return out;
  }

  /** PDF del contrato ACEPTADO: el texto exacto registrado (comprobado con su huella) y las evidencias de la aceptación. */
  async acceptedContractPdf(termsId: number): Promise<{ pdf: Uint8Array; filename: string }> {
    const t = await this.d.terms.must(termsId);
    if (t.acceptanceStatus !== "accepted" || t.contractId === null) throw new TermsError("invalid_state", "Estas condiciones todavía no están aceptadas");
    const a = (await this.d.acceptances.acceptances(t.contractId)).find((x) => x.status === "accepted");
    const contract = await this.d.crmStore.get("contracts", t.contractId);
    if (!a || !contract) throw new TermsError("invalid_state", "No consta la aceptación de estas condiciones");
    // El texto aceptado: el vigente del contrato o, si cambió después, la versión guardada con la misma huella
    let text: string | null = typeof contract.conditions === "string" && sha256(contract.conditions) === a.documentSha256 ? contract.conditions : null;
    if (text === null)
      for (const v of await this.d.crmStore.list("contractVersions", { contractId: contract.id })) {
        const c = (v.snapshot as { conditions?: unknown } | null)?.conditions;
        if (typeof c === "string" && sha256(c) === a.documentSha256) text = c;
      }
    if (text === null) throw new TermsError("invalid_state", "No se encuentra el texto exacto aceptado de este contrato");
    const reference = contract.reference ?? `CT-${contract.id}`;
    const lines = text.split("\n");
    const blocks: PdfBlock[] = [{ kind: "title", text: "Condiciones comerciales particulares", subtitle: lines[0] ?? reference }];
    for (const l of lines.slice(1)) {
      if (!l.trim()) continue;
      if (HEADING.test(l.trim())) blocks.push({ kind: "heading", text: l.trim() });
      else blocks.push({ kind: "paragraph", text: l.startsWith("- ") ? `• ${l.slice(2)}` : l });
    }
    blocks.push(
      { kind: "spacer", height: 6 },
      {
        kind: "box",
        title: "Aceptado electrónicamente",
        lines: [
          `Aceptado por ${a.acceptedName ?? a.signerName}${a.acceptedTaxId ? ` (NIF ${a.acceptedTaxId})` : ""} el ${madridDateTime(a.acceptedAt ?? 0)}.`,
          `Enlace personal enviado a ${a.signerName}${a.signerRole ? ` · ${a.signerRole}` : ""} (${a.signerEmail}).`,
          `Contrato ${reference}, versión ${a.contractVersion}. Huella SHA-256 del documento aceptado: ${a.documentSha256.slice(0, 32)} ${a.documentSha256.slice(32)}.`,
          ...(a.consentText ? [`Declaración aceptada: ${a.consentText}`] : []),
          `Referencia de la aceptación: ${contract.signatureRef ?? `aceptacion:${a.id}`}.`,
        ],
      },
    );
    const { renderBrandPdf } = await import("../documents/brandPdf");
    const pdf = await renderBrandPdf({
      title: `${reference} · condiciones comerciales particulares`,
      issuer: { legalName: ISSUER.legalName, taxId: ISSUER.taxId, address: `${ISSUER.address.line1}, ${ISSUER.address.line2}, ${ISSUER.address.postalCode} ${ISSUER.address.city}` },
      logoPng: this.d.logo ? await this.d.logo().catch(() => null) : null,
      footerNote: `${reference} · versión ${a.contractVersion} · huella SHA-256 ${a.documentSha256}`,
      blocks,
    });
    return { pdf, filename: `${reference}-v${a.contractVersion}-aceptado.pdf` };
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
      // La revocación y la aceptación compiten por la misma fila: solo una gana. Si ganó la aceptación, no se retira
      await this.revokePending(t.contractId);
      if ((await this.d.acceptances.acceptances(t.contractId)).some((a) => a.id === t.acceptanceId && a.status === "accepted")) throw new TermsError("invalid_state", "El cliente acaba de aceptar estas condiciones: no se retiran");
    }
    const out = await this.d.termsStore
      .patch(t.id, { status: "draft", acceptanceStatus: "pending", acceptanceId: null }, { kind: "acceptance_withdrawn", actor, reason: reason.slice(0, 500), before: { status: "pending_acceptance" }, after: { status: "draft" }, effectiveAt: null, acceptanceStatus: "pending", syncResult: null, economic: null }, this.now(), t.revision)
      .catch((e) => {
        throw e instanceof TermsConflict ? new TermsError("version_conflict", e.message, { current: e.current }) : e;
      });
    if (t.contractId !== null) {
      const c = await this.d.crmStore.get("contracts", t.contractId);
      if (c?.status === "sent") await this.d.crm.setContractStatus(c.id, "draft", actor);
    }
    return out;
  }

  /**
   * Antes de ANULAR unas condiciones con contrato: comprueba la revisión de quien anula, retira el enlace si seguía
   * pendiente y cancela su contrato del CRM (no queda un contrato huérfano que bloquee la renovación del anterior).
   * También es la salida de unas condiciones aceptadas que no se pudieron activar.
   */
  async releaseForCancel(termsId: number, input: { reason: string; expectedRevision: number }, actor: string): Promise<{ revision: number }> {
    let t = await this.d.terms.must(termsId);
    if (t.revision !== input.expectedRevision) throw new TermsError("version_conflict", `Otra persona modificó estas condiciones antes (revisión actual ${t.revision}). Recarga para no perder cambios.`, { current: t.revision });
    if (t.status === "pending_acceptance" && t.acceptanceStatus !== "accepted") t = await this.withdraw(termsId, input, actor);
    if (t.contractId !== null) {
      const c = await this.d.crmStore.get("contracts", t.contractId);
      if (c && c.status !== "cancelled" && c.status !== "active") {
        await this.d.crm.setContractStatus(c.id, "cancelled", actor);
        await this.d.crm.log("contract", c.id, "note", `Condiciones comerciales personalizadas anuladas: ${input.reason}`, actor);
      }
    }
    return { revision: t.revision };
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
    const contract = await this.d.crmStore.get("contracts", a.contractId);
    if (!contract || contract.status !== "sent") throw new TermsError("invalid_state", "Este contrato ya no está pendiente de aceptación: solicita un enlace nuevo");
    const doc = await this.document(t.id);
    // Lo aceptado debe ser exactamente lo presentado: el texto REGISTRADO en el contrato, que debe seguir coincidiendo
    // con las condiciones (si cambiaron el acuerdo, la condición siguiente o los datos del cliente, el enlace no vale)
    if (doc.sha256 !== a.documentSha256 || doc.version !== a.contractVersion || contract.conditions !== doc.text) throw new TermsError("invalid_state", "Las condiciones han cambiado desde que se envió este enlace: solicita uno nuevo");
    // Y deben poder activarse todavía (vigencia no vencida, suscripción operable): no se acepta lo que no se activará
    try {
      await this.d.terms.preflight(t.id);
    } catch (e) {
      if (e instanceof TermsError && e.code !== "not_found") throw new TermsError("invalid_state", "Estas condiciones ya no se pueden aceptar tal como se enviaron: ponte en contacto con Big Elephant para recibir unas actualizadas");
      throw e;
    }
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
      t.revision,
    );
    await this.d.crm.log("contract", a.contractId, "note", `Condiciones comerciales aceptadas electrónicamente por ${name} (versión ${doc.version}, huella ${doc.sha256.slice(0, 16)}…)`, ACTOR);
    // Lo que dependía de la aceptación se activa ahora. Si falla, la aceptación ya consta y se completa desde el CRM
    let activated = false;
    try {
      const subscriptionId = await this.activateAccepted(accepted, a.contractId);
      activated = true;
      if (this.d.onActivated) await this.d.onActivated({ terms: accepted, subscriptionId, contractId: a.contractId }).catch((e) => opsLog("warn", "CommercialTerms", "after_activation_failed", { termsId: t.id, error: e instanceof Error ? e.name : "error" }));
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
    return subscriptionId;
  }

  /**
   * Estado de la aceptación de un acuerdo para el CRM (firmante, fechas, evidencias e historial de envíos; nunca el
   * enlace: ese solo lo da `link` con el permiso de precios personalizados).
   */
  async status(termsId: number) {
    const base = await this.statusBase(termsId);
    return { ...base, currentAcceptanceId: (await this.d.terms.must(termsId)).acceptanceId ?? null, sends: await this.sendsView(termsId), recoverableLinks: !!this.d.links, mailAvailable: !!this.d.mail };
  }

  private async statusBase(termsId: number) {
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
  // Enlace en curso (consultarlo no lo consume), reenvío del mismo enlace y enlace nuevo para el mismo contrato
  r.get("/commercial-terms/:id/acceptance/link", requireCustomPricing(), wrap(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await svc.link(id.parse(req.params.id), who(req)));
  }));
  r.post("/commercial-terms/:id/acceptance/resend", requireCustomPricing(), wrap(async (req, res) => {
    z.object({}).strict().parse(req.body ?? {});
    res.setHeader("Cache-Control", "no-store");
    res.json(await svc.resend(id.parse(req.params.id), who(req)));
  }));
  r.post("/commercial-terms/:id/acceptance/regenerate", requireCustomPricing(), wrap(async (req, res) => {
    const b = z.object({ expectedRevision: z.number().int().min(1), send: z.boolean().optional() }).strict().parse(req.body);
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json(await svc.regenerate(id.parse(req.params.id), b, who(req)));
  }));
  // Contrato aceptado en PDF (texto exacto registrado y evidencias de la aceptación)
  r.get("/commercial-terms/:id/acceptance/contract.pdf", requireScope("subscriptions:read"), wrap(async (req, res) => {
    const { pdf, filename } = await svc.acceptedContractPdf(id.parse(req.params.id));
    res.status(200);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(Buffer.from(pdf));
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
