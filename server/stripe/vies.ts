/**
 * Validación de NIF-IVA intracomunitarios en VIES (Comisión Europea) antes de aplicar la INVERSIÓN DEL SUJETO
 * PASIVO a una empresa de otro Estado miembro.
 *
 *  - Cliente de la API REST oficial (`check-vat-number`). Cada consulta lleva como solicitante el NIF-IVA del
 *    emisor (IRON ELEPHANT CONSULTING, S.L.): VIES devuelve entonces un NÚMERO DE CONSULTA, prueba de la
 *    diligencia debida ante la Administración.
 *  - Tres resultados: `valid`, `invalid` y `unavailable` (VIES o el Estado miembro no responden, límite de
 *    peticiones, tiempo agotado, error de red). Indisponible NUNCA equivale a válido: el cobro con inversión se
 *    bloquea y el comprador puede reintentar más tarde.
 *  - Cada comprobación se REGISTRA (CRM 0021) con su fecha, número de consulta y nombre y dirección que devuelve
 *    VIES. Una comprobación válida se reutiliza mientras no caduque (CP_VIES_MAX_AGE_DAYS, 30 por defecto); al
 *    caducar se repite (nuevo Checkout o renovación cobrada).
 *
 * Nada de esto decide un tratamiento fiscal: es la verificación que exige el escenario `reverse_charge`.
 */
import { opsLog } from "../_core/ops/log";
import { ISSUER } from "./issuer";
import { checkTaxId, vatPrefix } from "./taxIds";
import { EU_COUNTRIES } from "./buyerProfile";

export type VatCheckStatus = "valid" | "invalid" | "unavailable";

export interface VatCheck {
  status: VatCheckStatus;
  /** País ISO (ES, FR, GR…). */
  country: string;
  /** NIF-IVA sin el prefijo del Estado. */
  vatNumber: string;
  checkedAt: number;
  /** Número de consulta de VIES (prueba de la comprobación); null si VIES no lo dio. */
  consultationNumber: string | null;
  traderName: string | null;
  traderAddress: string | null;
  /** Código del motivo (p. ej. MS_UNAVAILABLE, TIMEOUT, INVALID_INPUT, network). */
  detail: string | null;
  orderId: number | null;
}

/** Puerto de VIES (la implementación real o un doble en las pruebas). */
export interface ViesPort {
  check(country: string, vatNumber: string): Promise<Omit<VatCheck, "orderId" | "checkedAt"> & { checkedAt?: number }>;
}

/** Persistencia de las comprobaciones (CRM 0021). */
export interface VatCheckStore {
  recordVatCheck(c: VatCheck): Promise<void>;
  /** Última comprobación VÁLIDA de ese número, o null. */
  lastValidVatCheck(country: string, vatNumber: string): Promise<VatCheck | null>;
  /** ¿Existe la tabla de comprobaciones? Sin ella no hay evidencia: la inversión no se aplica. */
  hasVatCheckTable(): Promise<boolean>;
}

export const VIES_URL = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";
/** Errores de VIES que significan «no se ha podido comprobar» (no «no válido»). */
const UNAVAILABLE = new Set(["MS_UNAVAILABLE", "SERVICE_UNAVAILABLE", "TIMEOUT", "MS_MAX_CONCURRENT_REQ", "GLOBAL_MAX_CONCURRENT_REQ", "SERVER_BUSY", "IP_BLOCKED", "VAT_BLOCKED"]);
const clean = (v: unknown) => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s && s !== "---" ? s.slice(0, 400) : null;
};

/**
 * Cliente de la API REST de VIES. `fetch` inyectable (pruebas). Tiempo máximo por consulta: 8 s.
 * Solicitante: el NIF-IVA del emisor, para obtener el número de consulta.
 */
export function viesClient(opts: { fetch?: typeof fetch; url?: string; timeoutMs?: number; requester?: { country: string; vatNumber: string } | null } = {}): ViesPort {
  const doFetch = opts.fetch ?? fetch;
  const requester = opts.requester === undefined ? { country: "ES", vatNumber: ISSUER.taxId } : opts.requester;
  return {
    async check(country, vatNumber) {
      const c = country.toUpperCase();
      const base = { country: c, vatNumber, consultationNumber: null, traderName: null, traderAddress: null };
      try {
        const res = await doFetch(opts.url ?? VIES_URL, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ countryCode: vatPrefix(c), vatNumber, ...(requester ? { requesterMemberStateCode: vatPrefix(requester.country), requesterNumber: requester.vatNumber } : {}) }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
        });
        if (!res.ok) return { ...base, status: "unavailable", detail: `http_${res.status}` };
        const j = (await res.json()) as Record<string, unknown>;
        const wrappers = Array.isArray(j.errorWrappers) ? (j.errorWrappers as Array<{ error?: string }>) : [];
        const err = String(j.userError ?? wrappers[0]?.error ?? "").toUpperCase();
        if (j.actionSucceed === false || (err && UNAVAILABLE.has(err))) return { ...base, status: "unavailable", detail: err || "action_failed" };
        if (j.valid === true) return { ...base, status: "valid", consultationNumber: clean(j.requestIdentifier), traderName: clean(j.name), traderAddress: clean(j.address), detail: null };
        if (j.valid === false) return { ...base, status: "invalid", detail: err || "INVALID" };
        return { ...base, status: "unavailable", detail: "unexpected_response" };
      } catch (e) {
        const name = e instanceof Error ? e.name : "error";
        return { ...base, status: "unavailable", detail: name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "network" };
      }
    },
  };
}

/** Días de validez de una comprobación válida (CP_VIES_MAX_AGE_DAYS; 1 a 365; 30 por defecto). */
export function viesMaxAgeDaysFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.CP_VIES_MAX_AGE_DAYS ?? "").trim();
  if (!raw) return 30;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 365) throw new Error("CP_VIES_MAX_AGE_DAYS debe ser un número entero de días entre 1 y 365");
  return n;
}

export interface VatVerifierDeps {
  vies: ViesPort;
  store: VatCheckStore;
  now?: () => number;
  maxAgeDays?: number;
}

/**
 * Verificación con registro y reutilización. `verify` devuelve SIEMPRE un resultado (nunca lanza por VIES):
 *  - forma no válida o país fuera de la UE → `invalid` sin consultar;
 *  - comprobación válida y reciente → se reutiliza (`reused`);
 *  - si no, consulta VIES y registra el resultado (también los no válidos y los indisponibles).
 */
export class VatVerifier {
  private now: () => number;
  readonly maxAgeMs: number;
  constructor(private d: VatVerifierDeps) {
    this.now = d.now ?? Date.now;
    this.maxAgeMs = (d.maxAgeDays ?? 30) * 86_400_000;
  }

  async verify(country: string, rawVat: string, ctx: { orderId?: number | null; force?: boolean } = {}): Promise<VatCheck & { reused: boolean }> {
    const c = country.trim().toUpperCase();
    const t = checkTaxId(c, rawVat);
    const now = this.now();
    const vatNumber = t.ok ? t.normalized.slice(2) : rawVat.replace(/[\s.\-/]/g, "").toUpperCase();
    const blank = { country: c, vatNumber, checkedAt: now, consultationNumber: null, traderName: null, traderAddress: null, orderId: ctx.orderId ?? null };
    if (!EU_COUNTRIES.has(c) || !t.ok || t.scheme !== "eu_vat") return { ...blank, status: "invalid", detail: "format", reused: false };
    if (!(await this.d.store.hasVatCheckTable())) return { ...blank, status: "unavailable", detail: "storage_missing", reused: false };
    if (!ctx.force) {
      const last = await this.d.store.lastValidVatCheck(c, vatNumber);
      if (last && now - last.checkedAt < this.maxAgeMs) return { ...last, reused: true };
    }
    const r = await this.d.vies.check(c, vatNumber);
    const check: VatCheck = { ...r, country: c, vatNumber, checkedAt: r.checkedAt ?? now, orderId: ctx.orderId ?? null };
    await this.d.store.recordVatCheck(check);
    opsLog(check.status === "valid" ? "info" : "warn", "Vies", "vat_checked", { country: c, status: check.status, detail: check.detail, orderId: check.orderId, consultation: !!check.consultationNumber });
    return { ...check, reused: false };
  }
}

/** España también es UE, pero el NIF español no lleva inversión: VIES solo para los escenarios que la aplican. */
export const needsVies = (taxExpectation: string | null | undefined) => taxExpectation === "reverse_charge";
