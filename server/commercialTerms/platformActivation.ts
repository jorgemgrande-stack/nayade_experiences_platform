/**
 * Alta de la plataforma de una empresa cuando sus condiciones comerciales aceptadas se han pagado (circuito de
 * «Contratar plan» desde la ficha de empresa).
 *
 * No añade lógica de cobro ni de aprovisionamiento: reutiliza el alta que ya usa el orquestador
 * (`createContractActivation`, idempotente por tenant), enlaza la suscripción con la plataforma y vuelve a aplicar las
 * licencias y los límites contratados (usuarios, almacenamiento…) del acuerdo.
 *
 * Idempotente: una notificación repetida de Stripe, un reintento del operador o dos ejecuciones a la vez no crean otra
 * plataforma (la empresa ya tiene la suya, o el alta de aprovisionamiento reutiliza el mismo tenant). Nunca lanza: el
 * resultado queda en el historial del acuerdo (`platform_activated` / `platform_activation_failed`) para que el CRM
 * muestre el punto exacto y la acción disponible.
 */
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import { isPlanLine } from "./acceptance";
import type { TermsRecord } from "./store";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface PlatformActivationDeps {
  subscriptions: {
    get(id: number): Promise<{ id: number; companyId: number; tenantId: string | null; version: number; status: string } | null>;
    linkTenant(id: number, input: { tenantId: string; reason?: string | null }, actor: string): Promise<unknown>;
  };
  terms: {
    get(id: number): Promise<TermsRecord | null>;
    events(f: { termsId: number }): Promise<Array<{ kind: string; createdAt: number; id: number }>>;
    list(f: { subscriptionId?: number; companyId?: number; status?: TermsRecord["status"][] }): Promise<TermsRecord[]>;
    log(id: number, e: Row, now: number): Promise<unknown>;
  };
  crmStore: {
    get(entity: string, id: number): Promise<Row | null>;
    list(entity: string, f: Row): Promise<Row[]>;
    update(entity: string, id: number, patch: Row): Promise<unknown>;
  };
  /** `createContractActivation(...)`: crea la plataforma de la empresa y a su administrador (idempotente por tenant). */
  platform: { activate(i: { contract: any; company: any; contact: any }): Promise<{ tenantId: string }> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Licencias y límites del acuerdo sobre la suscripción (`TermsLicences.afterChange`). */
  afterChange?: (subscriptionId: number, actor: string) => Promise<unknown>;
  /** ¿Consta un primer cobro verificado de Stripe para esa suscripción? Sin él (o falso) no se aprovisiona nada. */
  paymentVerified?: (subscriptionId: number) => Promise<boolean>;
  now?: () => number;
}

export type PlatformActivationResult =
  | { status: "activated"; tenantId: string }
  | { status: "already"; tenantId: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

const ACTOR = "system:platform-after-payment";
/** Acuerdos que rigen una suscripción: el aceptado y activo (o programado) es el que da la plataforma. */
const LIVE: TermsRecord["status"][] = ["active", "scheduled"];

export async function activatePlatformAfterPayment(d: PlatformActivationDeps, subscriptionId: number, actor = ACTOR): Promise<PlatformActivationResult> {
  const now = d.now ?? Date.now;
  let termsId: number | null = null;
  const note = (kind: string, reason: string, after: Row | null, syncResult: string) =>
    termsId === null
      ? Promise.resolve()
      : d.terms.log(termsId, { kind, actor, reason: reason.slice(0, 500), before: null, after, effectiveAt: null, acceptanceStatus: "accepted", syncResult, economic: null }, now()).catch(() => undefined);
  try {
    const sub = await d.subscriptions.get(subscriptionId);
    if (!sub || sub.status === "canceled") return { status: "skipped", reason: "La suscripción no existe o está cancelada" };
    // Solo tras un primer cobro verificado (también el botón de reintento del operador)
    if (!d.paymentVerified || !(await d.paymentVerified(subscriptionId))) return { status: "skipped", reason: "Todavía no consta un primer cobro verificado en Stripe: no se da de alta ninguna plataforma" };
    const accepted = (await d.terms.list({ subscriptionId, status: LIVE })).filter((t) => t.acceptanceStatus === "accepted" && t.lines.some(isPlanLine));
    const t = accepted.sort((a, b) => b.id - a.id)[0];
    if (!t) return { status: "skipped", reason: "El acuerdo no lleva un plan Core aceptado: no hay plataforma que dar de alta" };
    termsId = t.id;
    const company = await d.crmStore.get("companies", sub.companyId);
    if (!company) return { status: "failed", reason: "La empresa no existe" };

    // Ya tiene plataforma (reintento, notificación repetida o empresa con plataforma previa): solo se asegura el enlace y las licencias
    const existing: string | null = sub.tenantId ?? company.tenantId ?? null;
    if (existing) {
      if (!sub.tenantId) await d.subscriptions.linkTenant(subscriptionId, { tenantId: existing, reason: "Plataforma de la empresa" }, actor);
      if (!company.tenantId) await d.crmStore.update("companies", company.id, { tenantId: existing, updatedAt: now() });
      // Un alta anterior pudo cortarse DESPUÉS de crear la plataforma (p. ej. al aplicar los límites): si el último resultado
      // registrado no es el correcto, se completa ahora sin crear otra plataforma. Con el alta ya completa no se repite nada
      const last = (await d.terms.events({ termsId: t.id })).filter((e) => e.kind === "platform_activated" || e.kind === "platform_activation_failed").sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)[0];
      if (last?.kind === "platform_activated") return { status: "already", tenantId: existing };
      if (d.afterChange) await d.afterChange(subscriptionId, actor);
      await note("platform_activated", `Plataforma ${existing} completada: licencias y límites aplicados`, { subscriptionId, tenantId: existing }, "applied");
      return { status: "activated", tenantId: existing };
    }

    // El administrador de la plataforma: contacto activo con correo (preferente el principal)
    const contacts = (await d.crmStore.list("contacts", { companyId: company.id })).filter((x) => x.status !== "inactive" && x.email);
    const contact = contacts.find((x) => x.isPrimary) ?? contacts[0] ?? null;
    if (!contact) {
      const reason = "La empresa necesita un contacto activo con correo (será el administrador de la plataforma). Añádelo en la ficha y reintenta el alta.";
      await note("platform_activation_failed", reason, { subscriptionId, step: "contact" }, "failed");
      return { status: "failed", reason };
    }
    const contract = t.contractId !== null ? await d.crmStore.get("contracts", t.contractId) : null;
    const { tenantId } = await d.platform.activate({ contract: contract ?? { modules: [], planId: null }, company, contact });
    await d.crmStore.update("companies", company.id, { tenantId, updatedAt: now() });
    await d.subscriptions.linkTenant(subscriptionId, { tenantId, reason: "Alta de la plataforma tras el pago de las condiciones aceptadas" }, actor);
    // Licencias y límites contratados (plan, operadores, almacenamiento). Un fallo aquí no deshace el alta: se reintenta con el botón
    if (d.afterChange) await d.afterChange(subscriptionId, actor);
    await note("platform_activated", `Plataforma ${tenantId} dada de alta tras el pago`, { subscriptionId, tenantId }, "applied");
    return { status: "activated", tenantId };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "Error del alta";
    opsLog("warn", "CommercialTerms", "platform_activation_failed", { subscriptionId, error: e instanceof Error ? e.name : "error" });
    await note("platform_activation_failed", reason, { subscriptionId, step: "provisioning" }, "failed");
    return { status: "failed", reason };
  }
}

/** `POST /commercial-terms/:id/platform/activate`: reintento del alta por un operador (mismo camino, idempotente). */
export function createPlatformActivationRouter(d: PlatformActivationDeps): Router {
  const r = express.Router();
  r.post("/commercial-terms/:id/platform/activate", requireScope("provisioning:write"), requireScope("subscriptions:write"), (req: Request, res: Response) => {
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!id.success) return void res.status(400).json({ error: "invalid_request" });
    (async () => {
      const t = await d.terms.get(id.data);
      if (!t || t.subscriptionId === null) return void res.status(409).json({ error: "invalid_state", message: "Estas condiciones todavía no tienen suscripción: el cliente debe aceptar y pagar primero" });
      const a = getAuth(req)!;
      const out = await activatePlatformAfterPayment(d, t.subscriptionId, `${a.actor.type}:${a.actor.id}`);
      res.status(out.status === "failed" || out.status === "skipped" ? 409 : 200).json(out);
    })().catch(() => res.status(500).json({ error: "internal_error", message: "Error interno" }));
  });
  return r;
}
