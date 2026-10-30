/**
 * Autorizaciones del correo de PRUEBAS gestionadas desde el CRM (ajuste «mail_sandbox», con versión e historial): buzones
 * y tipos de aviso INTERNOS que se suman a los del entorno (MAIL_SANDBOX_ALLOWLIST / MAIL_SCOPE_CATEGORIES).
 *
 * Solo actúan con el correo en modo sandbox: no cambian el modo, no abren live, no amplían el ámbito de empresas y los
 * tipos se limitan a avisos internos (nada que vaya a clientes). El entorno sigue siendo el techo.
 */
import { CrmError } from "../crm/types";
import type { SettingsStore } from "../crm/leadNotices";
import { normalizeEmail } from "./policy";

export const SANDBOX_ACCESS_KEY = "mail_sandbox";
/** Tipos que se pueden habilitar desde el CRM: alertas administrativas y avisos internos de solicitudes. */
export const MANAGED_CATEGORIES = ["operational", "lead_request_notice"] as const;
export const MAX_MANAGED_ADDRESSES = 10;

export interface SandboxAccessValue {
  addresses: string[];
  categories: string[];
}
export interface SandboxAccessSnapshot {
  addresses: ReadonlySet<string>;
  categories: ReadonlySet<string>;
}

const EMPTY: SandboxAccessSnapshot = { addresses: new Set(), categories: new Set() };

/** Valor guardado → valor válido (descarta lo que no cumpla: un ajuste antiguo o manipulado no abre nada de más). */
export function normalizeSandboxAccess(v: unknown): SandboxAccessValue {
  const o = (v && typeof v === "object" ? v : {}) as Partial<Record<keyof SandboxAccessValue, unknown>>;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
  const addresses = Array.from(new Set(list(o.addresses).map((a) => normalizeEmail(a)).filter((a): a is string => !!a))).slice(0, MAX_MANAGED_ADDRESSES);
  const categories = Array.from(new Set(list(o.categories).filter((c) => (MANAGED_CATEGORIES as readonly string[]).includes(c))));
  return { addresses, categories };
}

/** Comprueba lo que envía el CRM: direcciones completas (sin dominios ni comodines), como mucho 10, y tipos previstos. */
export function validateSandboxAccess(v: { addresses: string[]; categories: string[] }): SandboxAccessValue {
  const bad = v.addresses.filter((a) => !normalizeEmail(a));
  if (bad.length) throw new CrmError("invalid_input", `Direcciones no válidas: ${bad.join(", ")}`);
  const unknown = v.categories.filter((c) => !(MANAGED_CATEGORIES as readonly string[]).includes(c));
  if (unknown.length) throw new CrmError("invalid_input", `Tipos de correo no habilitables desde el CRM: ${unknown.join(", ")}`);
  const value = normalizeSandboxAccess(v);
  if (new Set(v.addresses.map((a) => a.trim().toLowerCase())).size > MAX_MANAGED_ADDRESSES) throw new CrmError("invalid_input", `Como mucho ${MAX_MANAGED_ADDRESSES} buzones de prueba`);
  return value;
}

export class SandboxAccess {
  private cur: SandboxAccessSnapshot = EMPTY;
  constructor(private d: { settings: SettingsStore; now?: () => number; log?: (event: string, data: Record<string, unknown>) => void }) {}

  /** Lo vigente (síncrono, para el servicio de correo). */
  snapshot(): SandboxAccessSnapshot {
    return this.cur;
  }

  /** Relee el ajuste; si la lectura falla (p. ej. sin la migración 0025), conserva lo último leído. */
  async refresh(): Promise<void> {
    try {
      const v = normalizeSandboxAccess((await this.d.settings.get(SANDBOX_ACCESS_KEY))?.value);
      this.cur = { addresses: new Set(v.addresses), categories: new Set(v.categories) };
    } catch (e) {
      this.d.log?.("sandbox_access_unavailable", { error: e instanceof Error ? e.message.slice(0, 120) : "error" });
    }
  }

  async read() {
    const row = await this.d.settings.get(SANDBOX_ACCESS_KEY);
    return { value: normalizeSandboxAccess(row?.value), version: row?.version ?? 0, updatedBy: row?.updatedBy ?? null, updatedAt: row?.updatedAt ?? null };
  }

  async save(input: { addresses: string[]; categories: string[] }, expectedVersion: number, by: string) {
    const value = validateSandboxAccess(input);
    await this.d.settings.save(SANDBOX_ACCESS_KEY, value, expectedVersion, by.slice(0, 100), null, (this.d.now ?? Date.now)());
    await this.refresh();
    return this.read();
  }

  history(limit = 20) {
    return this.d.settings.history(SANDBOX_ACCESS_KEY, limit);
  }
}
