/**
 * Prueba gratuita → solicitud web «Prueba de 15 días» del CRM comercial (incidencia Quantum Soulrise, 13/11/2026).
 *
 * Antes, una prueba solo llegaba al CRM al verificar el correo (empresa y plataforma); una solicitud sin verificar no
 * aparecía en «Leads» ni en «Solicitudes web» y su aviso («Prueba de 15 días») nunca se generaba. Ahora, al RECIBIRLA:
 *  - lead (o el existente de ese correo) + solicitud de tipo `trial`, con su referencia, y el aviso interno del tipo;
 *  - idempotente por prueba (misma clave): reintentos del formulario, del alta o de la recuperación no duplican nada;
 *  - el consentimiento comercial es el del formulario (no condiciona el aviso interno, que es operativo).
 * El estado de la prueba (pendiente de verificación, verificada, activa, fallida…) se sigue en «Pruebas».
 */
import crypto from "node:crypto";
import type { WebRequestService } from "../crm/webRequests";
import type { CrmService } from "../crm/service";
import type { CrmStore } from "../crm/store";
import type { TrialRequest } from "./store";

/** Clave de idempotencia de la solicitud de una prueba (CHAR(36) en el CRM). */
export const trialRequestKey = (trialId: number) => "trial-" + crypto.createHash("sha256").update(`trial:${trialId}`).digest("hex").slice(0, 30);

export const TRIAL_REQUEST_PRIVACY_FALLBACK = "prueba-gratuita";

export async function recordTrialRequest(requests: Pick<WebRequestService, "receive">, t: TrialRequest): Promise<{ reference: string; outcome: string }> {
  const c = t.configuration as TrialRequest["configuration"] & {
    profile?: { fullName?: string | null; phone?: string | null; sector?: string | null; country?: string | null; marketingConsent?: boolean | null } | null;
    privacy?: { version?: string | null } | null;
    attribution?: { landingPath?: string | null; source?: string | null; medium?: string | null; campaign?: string | null } | null;
  };
  const p = c.profile ?? null;
  const a = c.attribution ?? null;
  const utm = Object.fromEntries(Object.entries({ utm_source: a?.source, utm_medium: a?.medium, utm_campaign: a?.campaign }).filter(([, v]) => typeof v === "string" && v)) as Record<string, string>;
  const message = [
    `Prueba gratuita de 15 días solicitada desde la web (prueba n.º ${t.id}).`,
    "Estado: pendiente de verificación del correo. La empresa y su plataforma se crean al verificarlo; el seguimiento, en «Pruebas».",
    p?.country ? `País: ${p.country}.` : "",
  ].filter(Boolean).join("\n");
  const { outcome, request } = await requests.receive(
    {
      type: "trial",
      name: (p?.fullName ?? "").trim() || t.email,
      email: t.email,
      phone: p?.phone ?? null,
      company: t.companyName,
      sector: p?.sector ?? null,
      message,
      interest: "essential",
      sourcePage: a?.landingPath ?? "/prueba-gratuita",
      utm: Object.keys(utm).length ? utm : null,
      marketingConsent: !!p?.marketingConsent,
      privacyVersion: c.privacy?.version ?? TRIAL_REQUEST_PRIVACY_FALLBACK,
    },
    { idempotencyKey: trialRequestKey(t.id), ipHash: null },
  );
  return { reference: request.reference, outcome };
}

export type TrialLeadLink = "converted" | "already_linked" | "no_request" | "converted_elsewhere" | "disqualified";

/**
 * Prueba aprovisionada (correo verificado, empresa y plataforma creadas): el lead de su solicitud «Prueba de 15 días» pasa
 * a «Convertido» enlazado a ESA empresa (reutiliza su contacto por correo) y la solicitud queda atendida, con constancia
 * en el historial. Idempotente: si ya está convertido en esa empresa no hace nada; nunca toca un lead convertido en otra
 * empresa ni uno descartado (decisión del equipo). La solicitud y su referencia se conservan.
 */
export async function linkTrialLead(
  d: { store: Pick<CrmStore, "list" | "get">; crm: Pick<CrmService, "convertLead" | "log">; requests: Pick<WebRequestService, "setStatus"> },
  t: Pick<TrialRequest, "id">,
  target: { companyId: number; tenantId: string },
  actor: string,
): Promise<TrialLeadLink> {
  const request = (await d.store.list("leadRequests", { idempotencyKey: trialRequestKey(t.id) }, { limit: 1 }))[0];
  if (!request) return "no_request";
  const lead = await d.store.get("leads", request.leadId);
  if (!lead) return "no_request";
  let outcome: TrialLeadLink;
  if (lead.status === "converted") {
    if (lead.convertedCompanyId !== target.companyId) return "converted_elsewhere";
    outcome = "already_linked";
  } else if (lead.status === "disqualified") {
    return "disqualified";
  } else {
    await d.crm.convertLead(lead.id, { companyId: target.companyId }, actor);
    await d.crm.log("lead", lead.id, "note", `Prueba gratuita n.º ${t.id} verificada y aprovisionada automáticamente: empresa #${target.companyId}, plataforma ${target.tenantId} (solicitud ${request.reference})`, actor);
    outcome = "converted";
  }
  if (request.status === "pending") await d.requests.setStatus(request.id, "attended", actor);
  return outcome;
}
