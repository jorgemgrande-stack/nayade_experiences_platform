/**
 * Ski Net · firma remota del contrato de alquiler (capacidad `ski-rental` de la sede + módulo activado en la sede).
 *
 *  - El mostrador emite un enlace por contrato PENDIENTE (`net_public_links`, tipo `ski_contract`, con la sede) que
 *    caduca (24 h por defecto, 7 días como mucho) y es de UN SOLO USO: al firmar pasa a `used`.
 *  - La página muestra el contenido exacto que se firma (el JSON canónico guardado con su huella SHA-256) y registra la
 *    firma con el MISMO servicio que la firma en mostrador (SkiRentalUnitsService.signContract): nombre escrito,
 *    aceptación expresa, IP y navegador de quien firma y la comprobación de la huella. Quien la recoge queda como
 *    `public:link:<id>` (no hay empleado).
 *  - Dos envíos a la vez: el almacén solo firma un contrato pendiente, así que solo uno firma; el otro ve «ya firmado».
 */
import { TRPCError } from "@trpc/server";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { SdkError, toTrpcError } from "../sdk";
import { SkiRentalError } from "../skiRental/service";
import { UnitRuleError, checkSignature, type ContractContent } from "../skiRental/units";
import { activeLink, consumeLink, issueLink, reactivateLink, revokeLink, type NetLink } from "./links";
import { publicUrl } from "./html";

/** Servicio del módulo (el mismo del mostrador), cargado al usarlo: el router del módulo importa este fichero. */
const units = async () => (await import("../skiRental/router")).skiRentalUnitsService;

export const SKI_CAPABILITY = "ski-rental";
export const SIGN_LINK_DEFAULT_HOURS = 24;
export const SIGN_LINK_MAX_HOURS = 7 * 24;

/** ¿Puede firmarse a distancia en esta sede? Licencia activa (no solo lectura). Si no se sabe, no. */
export async function remoteSigningAvailable(siteId: string | null): Promise<boolean> {
  if (!siteId) return false;
  try {
    return (await getCapabilityAccess().check(SKI_CAPABILITY, { write: true, siteId })).allowed;
  } catch {
    return false;
  }
}

export interface PublicContract {
  deliveryId: number;
  siteId: string;
  contentHash: string;
  content: ContractContent;
}

/** Contrato pendiente del enlace; null si ya se firmó, no existe o no se puede leer. */
export async function contractOfLink(link: NetLink): Promise<PublicContract | null> {
  if (!link.siteId) return null;
  const d = await (await units()).getDelivery(link.siteId, link.targetId);
  const c = d.contract;
  if (!c || c.status !== "pending") return null;
  try {
    return { deliveryId: d.id, siteId: link.siteId, contentHash: c.contentHash, content: JSON.parse(c.content) as ContractContent };
  } catch {
    return null;
  }
}

export type RemoteSignResult = { ok: true; signerName: string; contentHash: string } | { ok: false; error: string } | { ok: false; used: true };

/**
 * Firma con el enlace (una sola vez). Primero se valida la firma (nombre y aceptación: un error se muestra y el enlace
 * sigue valiendo); después se CONSUME el enlace y solo firma la llamada que lo ha consumido (dos envíos a la vez: uno
 * firma, el otro ve «no válido»). Si la firma falla por otra causa, el enlace vuelve a valer.
 */
export async function signWithLink(link: NetLink, input: { signerName: string; accepted: boolean }, evidence: { ip: string | null; userAgent: string | null }): Promise<RemoteSignResult> {
  if (!link.siteId) return { ok: false, used: true };
  try {
    checkSignature(input);
  } catch (e) {
    if (e instanceof UnitRuleError) return { ok: false, error: e.message };
    throw e;
  }
  if (!(await consumeLink(link.id))) return { ok: false, used: true };
  try {
    const r = await (await units()).signContract(link.siteId, link.targetId, input, evidence, `public:link:${link.id}`);
    if (r.alreadySigned) return { ok: false, used: true };
    return { ok: true, signerName: r.contract.signerName ?? input.signerName, contentHash: r.contract.contentHash };
  } catch (e) {
    await reactivateLink(link.id);
    if (e instanceof SkiRentalError && e.code === "invalid_input") return { ok: false, error: e.message };
    throw e;
  }
}

// ─── Mostrador ─────────────────────────────────────────────────────────────────

async function counter<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SdkError) throw toTrpcError(e);
    if (e instanceof SkiRentalError) throw new TRPCError({ code: e.code === "not_found" ? "NOT_FOUND" : e.code === "conflict" ? "CONFLICT" : "BAD_REQUEST", message: e.message });
    if (e instanceof Error && e.name === "NetLinksNotInstalled") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La firma remota aún no está instalada en esta empresa (falta la actualización 0046_net_rutas_publicas)." });
    }
    throw e;
  }
}

/** Entrega de la sede con su contrato (la licencia de la sede la comprueba el servicio). */
async function pendingContract(siteId: string, deliveryId: number) {
  const d = await (await units()).getDelivery(siteId, deliveryId);
  if (!d.contract) throw new TRPCError({ code: "NOT_FOUND", message: "La entrega no tiene contrato." });
  return d;
}

export function signLinkStatus(siteId: string, deliveryId: number) {
  return counter(async () => {
    const d = await pendingContract(siteId, deliveryId);
    const l = d.contract!.status === "pending" ? await activeLink("ski_contract", deliveryId) : null;
    return { contractStatus: d.contract!.status, link: l && l.siteId === siteId ? { createdAt: l.createdAt, expiresAt: l.expiresAt } : null };
  });
}

/** Emite (o rota) el enlace de firma de un contrato pendiente. La URL con el token solo se devuelve aquí, una vez. */
export function issueSignLink(siteId: string, deliveryId: number, hours: number | undefined, actor: string) {
  return counter(async () => {
    const d = await pendingContract(siteId, deliveryId);
    if (d.contract!.status !== "pending") throw new TRPCError({ code: "CONFLICT", message: "El contrato ya está firmado." });
    if (!(await remoteSigningAvailable(siteId))) throw new TRPCError({ code: "FORBIDDEN", message: "La firma remota necesita la licencia de Ski Net activa en esta sede." });
    const h = Math.min(SIGN_LINK_MAX_HOURS, Math.max(1, Math.round(hours ?? SIGN_LINK_DEFAULT_HOURS)));
    const { link, token } = await issueLink({ kind: "ski_contract", targetId: deliveryId, siteId, expiresAt: Date.now() + h * 3_600_000, actor });
    return { url: publicUrl(`/firma/${token}`), expiresAt: link.expiresAt };
  });
}

export function revokeSignLink(siteId: string, deliveryId: number, actor: string) {
  return counter(async () => {
    await pendingContract(siteId, deliveryId);
    return { revoked: (await revokeLink("ski_contract", deliveryId, actor)) > 0 };
  });
}
