/**
 * Cliente del Core hacia la compra de módulos del plano de control (`/cp/v1/commerce/*`).
 *
 *  - El tenant sale SIEMPRE de la sesión del Core (contexto de la petición), nunca del navegador.
 *  - Solo envía QUÉ se quiere (módulos y totales de usuarios, sedes y almacenamiento); importes, precios y
 *    derechos los calcula el plano de control.
 *  - Sin `CP_COMMERCE_URL` y `CP_COMMERCE_TOKEN` la compra no está disponible (nada se llama).
 *  - El token de servicio es solo de servidor: nunca llega al navegador.
 *  - URL: https, o la red privada de Railway (`http://<servicio>.railway.internal:<puerto>`, cifrada por la
 *    plataforma y sin salida a Internet), o localhost fuera de producción.
 */
export interface CommerceInput {
  add?: string[];
  users?: number;
  sites?: number;
  storageGb?: number;
}

export interface ReductionInput {
  remove?: string[];
  users?: number;
  sites?: number;
  storageGb?: number;
}

export class CommerceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CommerceError";
  }
}

export interface CommerceClient {
  preview(tenantId: string, input: CommerceInput): Promise<unknown>;
  purchase(tenantId: string, input: CommerceInput, o: { idempotencyKey: string; buyer: string }): Promise<unknown>;
  status(tenantId: string, orderId: number): Promise<unknown>;
  previewReduction(tenantId: string, input: ReductionInput): Promise<unknown>;
  reduce(tenantId: string, input: ReductionInput, o: { idempotencyKey: string; buyer: string }): Promise<unknown>;
  /** Desistimiento de consumidores: ¿se puede desistir ahora? y última solicitud (ámbito commerce:withdrawal). */
  withdrawalStatus(tenantId: string): Promise<unknown>;
  /** Solicitud de desistimiento (idempotente por clave) → justificante. */
  withdraw(tenantId: string, input: { idempotencyKey: string; requestedBy: string; contactEmail: string; statement?: string }): Promise<unknown>;
  /** Portal de facturación de Stripe: ¿disponible? y sesión para la empresa (solo facturas y método de pago). */
  billingPortalStatus(): Promise<{ enabled: boolean }>;
  billingPortal(tenantId: string, returnUrl: string): Promise<{ url: string }>;
  /** Catálogo de módulos y ampliaciones para el panel de la empresa (solo lectura). */
  catalog(tenantId: string): Promise<unknown>;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

export function commerceClientFromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl: Fetch = fetch as unknown as Fetch): CommerceClient | null {
  const base = (env.CP_COMMERCE_URL ?? "").trim().replace(/\/+$/, "");
  const token = (env.CP_COMMERCE_TOKEN ?? "").trim();
  if (!base || !token) return null;
  const privateNet = /^http:\/\/[a-z0-9-]+\.railway\.internal:\d+$/.test(base);
  if (!/^https:\/\//.test(base) && !privateNet && !(env.NODE_ENV !== "production" && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(base))) {
    throw new Error("CP_COMMERCE_URL debe ser https, la red privada de Railway (http://<servicio>.railway.internal:<puerto>) o localhost fuera de producción");
  }
  const call = async (method: string, path: string, body?: unknown) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const r = await fetchImpl(`${base}/cp/v1/commerce${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: ctrl.signal,
      });
      const json = (await r.json().catch(() => null)) as { error?: string; message?: string } | null;
      if (r.status >= 400) throw new CommerceError(r.status, json?.error ?? "error", json?.message ?? "No se pudo completar la operación");
      return json;
    } catch (e) {
      if (e instanceof CommerceError) throw e;
      throw new CommerceError(503, "unreachable", "El servicio de compras no responde. Inténtalo de nuevo en unos minutos.");
    } finally {
      clearTimeout(t);
    }
  };
  const seg = (tenantId: string) => `/tenants/${encodeURIComponent(tenantId)}`;
  return {
    preview: async (tenantId, input) => ((await call("POST", `${seg(tenantId)}/purchases/preview`, input)) as { preview: unknown }).preview,
    purchase: async (tenantId, input, o) => ((await call("POST", `${seg(tenantId)}/purchases`, { ...input, idempotencyKey: o.idempotencyKey, buyer: o.buyer })) as { purchase: unknown }).purchase,
    status: async (tenantId, orderId) => ((await call("GET", `${seg(tenantId)}/purchases/${orderId}`)) as { purchase: unknown }).purchase,
    previewReduction: async (tenantId, input) => ((await call("POST", `${seg(tenantId)}/reductions/preview`, input)) as { preview: unknown }).preview,
    reduce: async (tenantId, input, o) => ((await call("POST", `${seg(tenantId)}/reductions`, { ...input, idempotencyKey: o.idempotencyKey, buyer: o.buyer })) as { reduction: unknown }).reduction,
    withdrawalStatus: async (tenantId) => ((await call("GET", `${seg(tenantId)}/withdrawal`)) as { withdrawal: unknown }).withdrawal,
    withdraw: async (tenantId, input) => await call("POST", `${seg(tenantId)}/withdrawal`, input),
    billingPortalStatus: async () => (await call("GET", "/billing-portal/status")) as { enabled: boolean },
    catalog: async (tenantId) => ((await call("GET", `${seg(tenantId)}/catalog`)) as { catalog: unknown }).catalog,
    billingPortal: async (tenantId, returnUrl) => (await call("POST", `${seg(tenantId)}/billing-portal`, { returnUrl })) as { url: string },
  };
}
