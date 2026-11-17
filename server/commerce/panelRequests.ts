/**
 * Solicitudes desde el marketplace del PANEL de cada empresa (`POST /cp/v1/commerce/tenants/:t/requests`), llamado
 * por el servidor del Core con la empresa y la persona de la sesión:
 *  - `info`: «Solicitar información» de un producto bajo solicitud (o disponible sin compra en línea).
 *  - `waitlist`: «Me interesa» de un producto próximamente o en preparación.
 *  - `implementation`: «Contratar e iniciar implantación» de un producto Net de clase B (shared/netOffer.ts): la
 *    solicitud abre el expediente de implantación (captación de soluciones asistidas, idempotente) y el equipo prepara
 *    el contrato. Sin cobro.
 *
 * Reutiliza las solicitudes web del CRM (WebRequestService): la solicitud cuelga de un lead, con su idempotencia,
 * sus duplicados en 24 h y el aviso interno al equipo (leadNotices). Sin tipos nuevos en la base: Connect y extras
 * van como «Información sobre una extensión» y Elephant Net como «Información sobre un módulo sectorial»; el interés
 * por algo que aún no existe se distingue por la página de origen y el mensaje.
 *
 * Garantías: solo productos que esa empresa ve en su catálogo (nunca internos ni retirados); el contacto es el de la
 * sesión que envía el Core (nunca un campo libre del navegador); la clave de idempotencia se aísla por empresa. Nada
 * se contrata ni se cobra.
 *
 * Solicitud ASISTIDA (17/11/2026): desde una sesión de soporte delegado con modificación, el Core envía `assisted.grantId`
 * en lugar de `requester`. Aquí se comprueba la concesión (existe, es de ESTA empresa, vigente y con modificación), el
 * contacto es el de la ficha de la empresa en el CRM (nunca el del operador) y el mensaje deja constancia de quién la
 * inició y de que no equivale a aceptación contractual ni autoriza cargos.
 *
 * Ámbito: `commerce:support` o `commerce:purchase` (el token del Core).
 */
import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import { quoteCatalogFromSite } from "../catalog/snapshot";
import { withoutInternal, type SiteDocument } from "../web/service";
import type { WebRequestService } from "../crm/webRequests";
import type { CrmStore } from "../crm/store";
import { CrmError, type LeadRequestType } from "../crm/types";
import { panelCatalog } from "./panelCatalog";
import { ASSISTED_CONTRACT_COPY, offerSaleKind } from "../../shared/netOffer";
import { STATUS_LABEL, type ImplementationStore } from "../implementation/store";
import { addonAssistedOf, assistedRegistryOf } from "../../shared/addonAssisted";
import { grantActive, type SupportGrant } from "../_core/support/grants";

/** Lector de concesiones de soporte delegado (solicitudes asistidas). */
export type SupportGrantLookup = (id: string) => Promise<SupportGrant | null>;
/** Texto del operador sin prefijo técnico (`operator:jorge` → `jorge`). */
const operatorName = (op: string) => op.replace(/^(operator|crm):/, "").slice(0, 80);

export const PANEL_REQUEST_SOURCE = "panel:/admin/ampliar";
/** Versión de privacidad de las solicitudes del panel: la persona ya es cliente y actúa desde su cuenta. */
export const PANEL_PRIVACY_VERSION = "panel-cliente";

const tenant = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);
export const panelRequestBody = z
  .object({
    type: z.enum(["info", "waitlist", "implementation"]),
    interest: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    message: z.string().trim().max(2000).optional(),
    requester: z.object({ name: z.string().trim().min(1).max(160), email: z.string().trim().toLowerCase().email().max(200) }).strict().optional(),
    /** Solicitud asistida desde soporte delegado: la concesión que la respalda (en lugar de `requester`). */
    assisted: z.object({ grantId: z.string().regex(/^[a-f0-9]{16,64}$/) }).strict().optional(),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  })
  .strict()
  .refine((b) => !!b.requester !== !!b.assisted, { message: "requester o assisted (uno de los dos)" });
export type PanelRequestBody = z.infer<typeof panelRequestBody>;

/**
 * Clave de idempotencia guardada en el CRM, aislada por empresa: huella de empresa + clave del Core. La columna del CRM
 * es CHAR(36) (pensada para UUID): la clave compuesta en claro (`panel:<empresa>:<clave>`) no cabía y MySQL la rechazaba.
 */
export const panelIdempotencyKey = (tenantId: string, key: string) => "panel-" + crypto.createHash("sha256").update(`${tenantId}:${key}`).digest("hex").slice(0, 30);

export class PanelRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Línea de la empresa en el mensaje de la solicitud: también identifica de qué empresa es (openRequestFor). */
const companyLine = (name: string, tenantId: string) => `Empresa cliente: ${name} (${tenantId}).`;
/** Solo la 2.ª línea, la que escribe el servidor: el mensaje libre va después y podría imitarla (otra empresa). */
const fromTenant = (message: string | null, tenantId: string) => {
  const l = (message ?? "").split("\n")[1] ?? "";
  return l.startsWith("Empresa cliente: ") && l.endsWith(` (${tenantId}).`);
};
/** Origen de cada tipo de solicitud del panel para un producto (la contratación asistida y el interés se distinguen así). */
const sourceFor = (key: string, type: PanelRequestBody["type"]) => `${PANEL_REQUEST_SOURCE}/${key}${type === "waitlist" ? "#me-interesa" : type === "implementation" ? ASSISTED_CONTRACT_COPY.sourceFragment : ""}`;
const REQUEST_STATUS_LABEL: Record<string, string> = { pending: "Pendiente de atender", attended: "Atendida", discarded: "Descartada" };

export type PanelRequestResult = { outcome: string; reference: string; status: string; progress?: string; contactEmail?: string };

/**
 * Contratación ya en curso de esa empresa para ese producto: el expediente de implantación abierto (cualquier estado
 * antes de «Iniciada» o «Cancelada») o, si aún no lo hay, su solicitud pendiente del mismo tipo hecha desde el panel.
 * Cerrado el expediente o atendida/descartada la solicitud sin expediente, se puede pedir de nuevo.
 */
async function openRequestFor(
  d: { requests: WebRequestService; crm: CrmStore; implementations?: Pick<ImplementationStore, "openFor"> | null },
  tenantId: string,
  companyId: number | null,
  key: string,
  type: PanelRequestBody["type"],
): Promise<PanelRequestResult | null> {
  if (type === "implementation" && companyId !== null && d.implementations) {
    const order = await d.implementations.openFor(companyId, key);
    if (order) return { outcome: "duplicate", reference: order.reference, status: order.status, progress: `Expediente de implantación ${order.reference}: ${STATUS_LABEL[order.status].toLowerCase()}` };
  }
  const source = sourceFor(key, type);
  const pending = (await d.crm.list("leadRequests", { interest: key, status: "pending" }, { desc: true, limit: 200 })).find((r) => r.sourcePage === source && fromTenant(r.message, tenantId));
  return pending ? { outcome: "duplicate", reference: pending.reference, status: pending.status, progress: `Solicitud ${pending.reference}: ${REQUEST_STATUS_LABEL[pending.status].toLowerCase()}` } : null;
}

/**
 * Registra la solicitud. `site`: el sitio publicado; `internal`: la empresa puede ver productos internos de prueba.
 */
export async function receivePanelRequest(
  d: { site: SiteDocument; internal: boolean; requests: WebRequestService; crm: CrmStore; implementations?: Pick<ImplementationStore, "openFor"> | null; planOf?: ((tenantId: string) => Promise<string | null>) | null; supportGrant?: SupportGrantLookup | null },
  tenantId: string,
  b: PanelRequestBody,
): Promise<PanelRequestResult> {
  // Asistida: la concesión manda (la de otra empresa, revocada, caducada o de solo lectura no registra nada)
  let operator: string | null = null;
  if (b.assisted) {
    if (!d.supportGrant) throw new PanelRequestError(503, "assisted_unavailable", "Las solicitudes asistidas no están disponibles ahora mismo");
    const g = await d.supportGrant(b.assisted.grantId);
    if (!g || g.tenantId !== tenantId || !grantActive(g) || g.readOnly) throw new PanelRequestError(403, "assisted_forbidden", "El acceso de soporte no permite registrar solicitudes en nombre de esta empresa");
    operator = operatorName(g.operator);
  }
  const visible = d.internal ? d.site : withoutInternal(d.site);
  const item = panelCatalog(quoteCatalogFromSite(visible).products, { version: "", purchasesEnabled: false }).items.find((i) => i.key === b.interest);
  if (!item) throw new PanelRequestError(404, "not_found", "Ese producto no está en tu catálogo");
  // Un Connect asistido o una ampliación (13/11/2026) «próximamente» o «en preparación» se contrata igual (shared/netOffer.ts → offerSaleKind)
  const upcoming = (item.commercialStatus === "coming_soon" || item.commercialStatus === "in_preparation") && !assistedRegistryOf(item.key);
  if (b.type === "waitlist" && !upcoming) throw new PanelRequestError(409, "invalid_state", "Ese producto ya se puede solicitar: pide información");
  if (b.type === "info" && upcoming) throw new PanelRequestError(409, "invalid_state", "Ese producto todavía no está disponible: usa «Me interesa»");
  // «Contratar e iniciar implantación» (clase B): solo un producto Net de empresa bajo solicitud, operativo y con precio
  // publicado. Abre la solicitud de implantación (el expediente lo abre la captación, idempotente); nunca cobra nada
  const assisted = b.type === "implementation";
  if (assisted && (item.legacy || offerSaleKind({ key: item.key, commercialStatus: item.commercialStatus, technicalStatus: item.technicalStatus ?? null, hasMonthlyPrice: !!item.monthly }) !== "assisted_contract")) {
    throw new PanelRequestError(409, "invalid_state", "Ese producto no se contrata con implantación asistida desde el panel: pide información");
  }
  // Ampliación de otro plan (13/11/2026): el marketplace no la ofrece; aquí se comprueba con el plan vigente si se
  // conoce (sin lector de plan o si falla, manda lo que ofrece el marketplace)
  const addonPlans = assisted ? (addonAssistedOf(item.key)?.plans ?? []) : [];
  if (addonPlans.length > 0 && d.planOf) {
    const plan = await d.planOf(tenantId).catch(() => null);
    if (plan && !addonPlans.includes(plan)) throw new PanelRequestError(409, "invalid_state", "Esa ampliación no es para tu plan actual");
  }

  const company = (await d.crm.list("companies", {}, { desc: true, limit: 5000 })).find((c) => c.tenantId === tenantId) ?? null;
  // Contacto de la solicitud: la persona de la sesión o, si es asistida, el correo de la ficha de la empresa
  const validEmail = (v: string | null | undefined) => { const e = (v ?? "").trim().toLowerCase(); return z.string().email().safeParse(e).success ? e : ""; };
  const contactEmail = b.assisted ? validEmail(company?.email) || validEmail(company?.billingEmail) : b.requester!.email;
  if (b.assisted && !contactEmail) {
    throw new PanelRequestError(409, "no_contact", "La ficha de la empresa en el CRM no tiene correo de contacto: complétalo y vuelve a enviar la solicitud");
  }
  const requester = b.assisted ? { name: (company?.name ?? tenantId).slice(0, 160), email: contactEmail } : b.requester!;
  // Una sola contratación en curso por empresa y producto: si ya hay expediente abierto o solicitud pendiente, se
  // devuelve esa (con su estado) y no se crea otra, la pulse quien la pulse y con el mensaje que sea
  // (el reintento con la misma clave sigue siendo un reintento: lo resuelve la idempotencia de las solicitudes)
  const retry = (await d.crm.list("leadRequests", { idempotencyKey: panelIdempotencyKey(tenantId, b.idempotencyKey) }, { limit: 1 })).length > 0;
  const current = retry ? null : await openRequestFor(d, tenantId, company?.id ?? null, item.key, b.type);
  // Ya en curso: se responde a quien la abrió (quizá la propia empresa con su correo), no se promete otro contacto
  if (current) return current;
  const type: LeadRequestType = /^net_|^industry_module$/.test(item.family) ? "module_info" : "extension_info";
  const price = item.monthly ? `${(item.monthly.amountCents / 100).toFixed(2).replace(".", ",")} € al mes${item.monthly.taxIncluded ? "" : " (IVA aparte)"}` : null;
  const lead = assisted
    ? `Quiere contratar ${item.name} e iniciar la implantación (precio publicado: ${price}). Preparar el contrato (condiciones personalizadas con los compromisos de implantación); sin cobro en el panel.`
    : b.type === "waitlist"
      ? `Me interesa ${item.name} (próximamente). Avisadnos cuando esté disponible.`
      : `Solicita información sobre ${item.name}.`;
  const assistedLine = operator
    ? `Solicitud asistida por Soporte Big Elephant (${operator}) desde el panel de la empresa, con su acceso de soporte con modificación. No equivale a la aceptación del contrato ni autoriza cargos: la aceptación la hace la empresa.`
    : "";
  const message = [lead, companyLine(company?.name ?? tenantId, tenantId), assistedLine, b.message ? `Mensaje: ${b.message}` : ""].filter(Boolean).join("\n");
  try {
    const { outcome, request } = await d.requests.receive(
      {
        type,
        name: requester.name,
        email: requester.email,
        company: company?.name ?? tenantId,
        message,
        interest: item.key,
        sourcePage: sourceFor(item.key, b.type),
        marketingConsent: false,
        privacyVersion: PANEL_PRIVACY_VERSION,
      },
      // La clave del Core, aislada por empresa: la de otra empresa nunca devuelve esta solicitud
      { idempotencyKey: panelIdempotencyKey(tenantId, b.idempotencyKey), ipHash: null },
    );
    return { outcome, reference: request.reference, status: request.status, ...(b.assisted ? { contactEmail } : {}) };
  } catch (e) {
    if (e instanceof CrmError && e.code === "conflict") throw new PanelRequestError(409, "conflict", e.message);
    throw e;
  }
}

/** Token del Core: `commerce:support` o `commerce:purchase`. */
function requireCore(req: Request, res: Response, next: NextFunction) {
  const scopes = getAuth(req)?.scopes;
  if (!scopes || !(scopes.has("commerce:support") || scopes.has("commerce:purchase"))) return void res.status(403).json({ error: "forbidden", scope: "commerce:support" });
  next();
}

/** Rutas del Core (montar bajo /commerce). */
export function createPanelRequestsRouter(d: { site: () => Promise<SiteDocument>; requests: WebRequestService; crm: CrmStore; internalTenants?: ReadonlySet<string>; implementations?: Pick<ImplementationStore, "openFor"> | null; planOf?: ((tenantId: string) => Promise<string | null>) | null; supportGrant?: SupportGrantLookup | null }): Router {
  const r = express.Router();
  r.post("/tenants/:tenantId/requests", requireCore, (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const t = tenant.safeParse(req.params.tenantId);
    const b = panelRequestBody.safeParse(req.body);
    if (!t.success || !b.success) return void res.status(400).json({ error: "invalid_request", message: b.success ? "tenantId" : b.error.issues.map((i) => i.path.join(".") || i.message).join(", ") });
    d.site()
      .then((site) => receivePanelRequest({ site, internal: !!d.internalTenants?.has(t.data), requests: d.requests, crm: d.crm, implementations: d.implementations ?? null, planOf: d.planOf ?? null, supportGrant: d.supportGrant ?? null }, t.data, b.data))
      .then((x) => void res.status(x.outcome === "created" ? 201 : 200).json({ request: x }))
      .catch((e) => {
        if (e instanceof PanelRequestError) return void res.status(e.status).json({ error: e.code, message: e.message });
        opsLog("error", "Commerce", "panel_request_failed", { error: e instanceof Error ? e.name : "error" });
        res.status(500).json({ error: "internal_error", message: "Error interno" });
      });
  });
  return r;
}
