/**
 * connect.* — Elephant Connect («Amplía tu empresa») en el panel: el catálogo con el estado de cada módulo para la
 * empresa de la SESIÓN (licencias reales del registro) y si esta persona puede contratar en línea.
 *
 * La compra reutiliza `subscription.purchasePreview` → `purchase` → `purchaseStatus` (idempotente por clave, importes
 * del plano de control y activación solo con el cobro verificado). No está en TRPC_ROUTER_CAPABILITIES: ver qué se
 * puede ampliar tiene que funcionar sin el módulo contratado.
 *
 * `connect.request`: «Solicitar información» y «Me interesa». Si el plano de control acepta solicitudes, crea una
 * oportunidad en su CRM con la identidad del usuario de la sesión; si aún no las acepta (404), «Solicitar
 * información» abre una incidencia de soporte como hasta ahora y «Me interesa» no está disponible. La respuesta dice
 * lo que ha pasado DE VERDAD (`via`), para que el panel no prometa otra cosa.
 */
import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getTenantId, getTenantMode } from "../_core/tenant";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { opsLog } from "../_core/ops/log";
import { CommerceError, commerceClientFromEnv } from "../commerceClient";
import { PANEL_ROLES } from "../subscriptionDb";
import { buildSubscriptionOverview, safeUpgradeUrl } from "../subscriptionOverview";
import { resolveSupportContact } from "../supportContact";
import { isTrialTenant } from "../trialPayments";
import { buildConnectCatalog, type ChannelCatalogItem, type ConnectItem } from "../connectMarketplace";
import { advertisesRequests, parseMarketplaceHeaders, parseMarketplaceRoot } from "../connectCard";
import { brandHeaders, type ConnectBrandHeaders, type PurchaseBlock } from "../../shared/connectMarketplace";
import { CONNECT_EVENT_TYPES, autoplayDelay, resolveSlides, type ResolvedSlide } from "../../shared/connectShowcase";
import { acceptEvents, forwardEvents, openPathResolver } from "../connectShowcase";
import { panelExtensionSources } from "../_core/modules/panelNavigation";

export interface ConnectCatalogView {
  /** false: fuera de multiempresa (la página lo explica y ofrece contacto). En multiempresa, sin canal es un error. */
  available: boolean;
  purchasesEnabled: boolean;
  /** Esta persona puede contratar en línea ahora mismo. */
  canPurchase: boolean;
  /** Por qué no (null si puede). */
  purchaseBlock: PurchaseBlock;
  plan: { key: string; name: string } | null;
  items: ConnectItem[];
  upgradeUrl: string | null;
  supportEmail: string | null;
  /** Se pueden enviar solicitudes al equipo desde el panel (oportunidad en el CRM o, si no, soporte). */
  requestsEnabled: boolean;
  /** El plano de control acepta solicitudes como oportunidad del CRM: hay «Me interesa» para lo que está por llegar. */
  interestEnabled: boolean;
  /** Cabeceras de Elephant Connect y Elephant Net (del catálogo central o, si no vienen, las de siempre). */
  brands: ConnectBrandHeaders;
  /** Diapositivas del carrusel publicadas por el canal (ya comprobadas contra el catálogo de la empresa). */
  slides: ResolvedSlide[];
  /** Pausa entre diapositivas (ms); 0 = sin rotación automática. */
  autoplayMs: number;
}

/** Ruta real de cada módulo instalado (portada de su entrada de menú). Si algo falla, sin «Abrir módulo». */
function moduleOpenPath(): (capabilities: string[]) => string | null {
  try {
    return openPathResolver(panelExtensionSources().map((s) => ({ capability: s.capability, panel: s.manifest.panel ?? null })));
  } catch {
    return () => null;
  }
}

/**
 * Lo que ha pasado de verdad: `lead` (oportunidad en el CRM: creada, la misma repetida o ya había una abierta, con su
 * referencia) o `ticket` (incidencia de soporte, cuando el plano de control aún no acepta solicitudes o es un aviso
 * sobre algo ya contratado).
 */
export type ConnectRequestResult =
  | { via: "lead"; outcome: "created" | "replayed" | "duplicate"; reference: string | null; email: string }
  | { via: "ticket"; email: string };

/** Errores del canal de solicitudes en palabras de la persona (nunca el texto técnico del servicio). */
const REQUEST_ERRORS: Record<number, { code: TRPCError["code"]; message: string }> = {
  400: { code: "BAD_REQUEST", message: "No hemos podido enviar la solicitud: revisa el mensaje e inténtalo de nuevo." },
  403: { code: "FORBIDDEN", message: "Ahora mismo no se pueden enviar solicitudes desde el panel. Escríbenos y te ayudamos." },
  404: { code: "NOT_FOUND", message: "Este producto ya no está disponible en tu catálogo." },
  409: { code: "CONFLICT", message: "Esta solicitud no encaja con el estado actual del producto. Recarga la página e inténtalo de nuevo." },
};

const OUTCOMES = ["created", "replayed", "duplicate"] as const;
function leadResult(raw: unknown, email: string): ConnectRequestResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as { outcome?: unknown; reference?: unknown };
  const outcome = (OUTCOMES as readonly unknown[]).includes(r.outcome) ? (r.outcome as (typeof OUTCOMES)[number]) : "created";
  const reference = typeof r.reference === "string" && /^[A-Za-z0-9-]{1,40}$/.test(r.reference) ? r.reference : null;
  return { via: "lead", outcome, reference, email };
}

/**
 * ¿Acepta el plano de control solicitudes? Lo anuncia el catálogo o lo sabemos por la última llamada (correcta → sí;
 * 404 → no, durante unos minutos, para volver a probar cuando se publique).
 */
const NO_REQUESTS_TTL_MS = 10 * 60_000;
let requestsProbe: { supported: boolean; at: number } | null = null;
export function _resetConnectRequestsProbeForTests() {
  requestsProbe = null;
}
const knownUnsupported = () => !!requestsProbe && !requestsProbe.supported && Date.now() - requestsProbe.at < NO_REQUESTS_TTL_MS;
const knownSupported = () => !!requestsProbe?.supported;

const TRPC_CODE: Record<number, TRPCError["code"]> = { 400: "BAD_REQUEST", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 503: "PRECONDITION_FAILED" };

export const connectRouter = router({
  catalog: protectedProcedure.query(async ({ ctx }): Promise<ConnectCatalogView> => {
    const role = String(ctx.user.role);
    if (!(PANEL_ROLES as readonly string[]).includes(role)) throw new TRPCError({ code: "FORBIDDEN" });
    const upgradeUrl = process.env.ELEPHANT_PRICING_URL ?? process.env.CP_TRIAL_PRICING_URL ?? null;
    const supportEmail = (await resolveSupportContact().catch(() => ({ email: null }))).email;
    const client = commerceClientFromEnv();
    const base = { upgradeUrl: safeUpgradeUrl(upgradeUrl), supportEmail };
    if (getTenantMode() !== "multi") {
      return { available: false, purchasesEnabled: false, canPurchase: false, purchaseBlock: "unavailable", plan: null, items: [], requestsEnabled: false, interestEnabled: false, brands: brandHeaders(null), slides: [], autoplayMs: autoplayDelay(null), ...base };
    }
    // En multiempresa el catálogo existe siempre: sin canal con el plano de control es una avería (configuración del
    // Core), no un catálogo vacío. Se devuelve un error recuperable para que la página ofrezca reintentar.
    if (!client) {
      opsLog("error", "Connect", "catalog_channel_missing", { tenantId: getTenantId() });
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "El catálogo no está disponible en este momento. Inténtalo de nuevo en unos minutos." });
    }
    const access = getCapabilityAccess();
    try {
      const tenantId = getTenantId();
      const [catalog, grants] = await Promise.all([client.catalog(tenantId) as Promise<{ purchasesEnabled: boolean; items: ChannelCatalogItem[]; marketplace?: unknown }>, access.list(tenantId)]);
      const now = access.currentTime();
      const overview = buildSubscriptionOverview({ mode: "multi", enforcing: access.enforcing(), grants, now });
      const items = buildConnectCatalog(catalog, grants, now, overview.plan?.key ?? null, moduleOpenPath());
      const purchaseBlock: PurchaseBlock = role !== "admin" ? "role" : (await isTrialTenant()) ? "trial" : !catalog.purchasesEnabled ? "closed" : null;
      const interestEnabled = !knownUnsupported() && (advertisesRequests(catalog) || knownSupported());
      const showcase = parseMarketplaceRoot(catalog.marketplace);
      return {
        available: true,
        purchasesEnabled: catalog.purchasesEnabled,
        canPurchase: purchaseBlock === null,
        purchaseBlock,
        plan: overview.plan,
        items,
        requestsEnabled: true,
        interestEnabled,
        brands: brandHeaders(parseMarketplaceHeaders(catalog.marketplace)),
        slides: resolveSlides(showcase.slides, { items, canPurchase: purchaseBlock === null, now: Date.now() }),
        autoplayMs: autoplayDelay(showcase.autoplayMs),
        ...base,
      };
    } catch {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo consultar el catálogo. Inténtalo de nuevo en unos minutos." });
    }
  }),

  /**
   * Medición del marketplace (vistas de tarjetas, fichas y diapositivas, clics y contrataciones). Sin datos
   * personales; deduplicada por sesión; nunca falla para la persona (si el canal no la recibe, se ignora).
   */
  track: protectedProcedure
    .input(
      z
        .object({
          events: z
            .array(
              z
                .object({
                  id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
                  type: z.enum(CONNECT_EVENT_TYPES),
                  productKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/).optional(),
                  slideId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
                  at: z.string().datetime(),
                })
                .strict(),
            )
            .max(50),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }): Promise<{ accepted: number }> => {
      if (!(PANEL_ROLES as readonly string[]).includes(String(ctx.user.role))) throw new TRPCError({ code: "FORBIDDEN" });
      if (getTenantMode() !== "multi") return { accepted: 0 };
      const client = commerceClientFromEnv();
      const tenantId = getTenantId();
      const now = Date.now();
      // La sesión se identifica en memoria (empresa + persona) y nunca se envía al canal
      const scope = crypto.createHash("sha256").update(`${tenantId}|${ctx.user.id}`).digest("hex").slice(0, 24);
      const events = acceptEvents(scope, input.events, now);
      await forwardEvents(client, tenantId, events, now);
      return { accepted: events.length };
    }),

  /**
   * «Solicitar información» (`info`), «Me interesa» (`waitlist`) o aviso sobre algo ya contratado (`contact`, siempre
   * por soporte) de un producto del catálogo. Sin cargos.
   */
  request: protectedProcedure
    .input(z.object({ key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/), type: z.enum(["info", "waitlist", "contact"]), message: z.string().trim().max(2000).optional() }).strict())
    .mutation(async ({ ctx, input }): Promise<ConnectRequestResult> => {
      if (!(PANEL_ROLES as readonly string[]).includes(String(ctx.user.role))) throw new TRPCError({ code: "FORBIDDEN" });
      const client = commerceClientFromEnv();
      if (getTenantMode() !== "multi" || !client) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Las solicitudes desde el panel no están disponibles: escríbenos por correo." });
      const email = typeof ctx.user.email === "string" ? ctx.user.email.trim() : "";
      if (!z.string().email().safeParse(email).success) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Tu usuario no tiene un correo válido para que podamos responderte." });
      const name = (typeof ctx.user.name === "string" && ctx.user.name.trim()) || email;
      const tenantId = getTenantId();
      const message = input.message || undefined;
      try {
        // Solo productos del catálogo publicado para esta empresa
        const catalog = (await client.catalog(tenantId)) as { items?: Array<{ key: string; name: string }> };
        const product = catalog.items?.find((i) => i.key === input.key);
        if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Este producto ya no está en el catálogo." });

        if (input.type !== "contact" && !knownUnsupported()) {
          // La misma solicitud (persona, producto, tipo y mensaje) el mismo día no crea dos oportunidades
          const day = new Date().toISOString().slice(0, 10);
          const idempotencyKey = "cx-" + crypto.createHash("sha256").update([tenantId, ctx.user.id, input.type, input.key, message ?? "", day].join("|")).digest("hex").slice(0, 40);
          try {
            const r = await client.request(tenantId, { type: input.type, interest: input.key, ...(message ? { message } : {}), requester: { name: name.slice(0, 160), email }, idempotencyKey });
            requestsProbe = { supported: true, at: Date.now() };
            return leadResult(r, email);
          } catch (e) {
            if (!(e instanceof CommerceError)) throw e;
            if (e.code !== "route_missing") {
              const known = REQUEST_ERRORS[e.status];
              if (known) throw new TRPCError(known);
              throw e;
            }
            requestsProbe = { supported: false, at: Date.now() };
            opsLog("warn", "Connect", "requests_endpoint_missing", { tenantId });
          }
        }
        // Sin solicitudes en el plano de control: «Me interesa» no existe; la información, por soporte como hasta ahora
        if (input.type === "waitlist") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Ahora mismo no podemos registrar tu interés desde el panel. Escríbenos y te avisamos." });
        const description =
          input.type === "contact"
            ? `Necesito ayuda con «${product.name}» en mi empresa.${message ? `\n\n${message}` : ""}`
            : `Me interesa «${product.name}» para mi empresa. Quiero recibir información.${message ? `\n\n${message}` : ""}`;
        const title = input.type === "contact" ? `Consulta sobre ${product.name}` : `Solicitud de información: ${product.name}`;
        await client.openTicket(tenantId, { title: title.slice(0, 200), description, category: input.type === "contact" ? "account" : "billing", requestedBy: email });
        return { via: "ticket", email };
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        if (e instanceof CommerceError) throw new TRPCError({ code: TRPC_CODE[e.status] ?? "INTERNAL_SERVER_ERROR", message: e.message });
        throw e;
      }
    }),
});
