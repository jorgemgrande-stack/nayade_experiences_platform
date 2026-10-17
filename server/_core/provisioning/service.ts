/**
 * Servicio de aprovisionamiento: ejecuta el alta de un tenant como pasos idempotentes y
 * reanudables, con estados intermedios persistidos, reintentos acotados, auditoría (a través
 * del registro) y compensación explícita (`abort`).
 */
import { RegistryError } from "../tenantRegistry/contract";
import { opsLog } from "../ops/log";
import { recordFailure } from "../ops/failureAlerts";
import type { Actor, TenantRegistryService } from "../tenantRegistry/service";
import type { TenantRegistryReader } from "../tenantRegistry/store";
import type { DatabaseProvisioner, ModuleInstaller, ProvisioningListFilter, ProvisioningStore, SchemaApplier, TenantSeeder, WelcomeNotifier } from "./ports";
import {
  PROVISION_STEPS,
  ProvisioningError,
  TENANT_ID_RE,
  type ProvisionRequest,
  type ProvisionResult,
  type ProvisionStep,
  type ProvisioningRecord,
} from "./types";

export interface EntitlementGranter {
  grant(tenantId: string, moduleId: string, actor: Actor, opts?: { validUntil?: Date | null }): Promise<void>;
}
export interface QuotaSetter {
  set(
    q: { tenantId: string; metric: string; period: "minute" | "hour" | "day" | "month"; limit: number; enforcement: "hard" | "soft" },
    actor: Actor,
  ): Promise<void>;
}

export interface ProvisioningDeps {
  registry: TenantRegistryService;
  reader: TenantRegistryReader;
  databases: DatabaseProvisioner;
  schema: SchemaApplier;
  seeder: TenantSeeder;
  entitlements: EntitlementGranter;
  quotas: QuotaSetter;
  store: ProvisioningStore;
  welcome?: WelcomeNotifier;
  /** Instala las migraciones de los módulos contratados (opcional). */
  modules?: ModuleInstaller;
  now?: () => number;
  /** Reintentos por paso dentro de una misma ejecución. */
  maxAttemptsPerStep?: number;
  sleep?: (ms: number) => Promise<void>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export function validateRequest(r: ProvisionRequest): void {
  if (!TENANT_ID_RE.test(r.tenantId)) throw new ProvisioningError("invalid_request", "Identificador de tenant no válido");
  if (!r.displayName?.trim()) throw new ProvisioningError("invalid_request", "Falta el nombre");
  if (!EMAIL_RE.test(r.adminEmail)) throw new ProvisioningError("invalid_request", "Correo del administrador no válido");
  if (!DOMAIN_RE.test(r.platformDomain)) throw new ProvisioningError("invalid_request", "Dominio de plataforma no válido");
  if (r.trialDays !== undefined && !(r.trialDays >= 1 && r.trialDays <= 90)) {
    throw new ProvisioningError("invalid_request", "Días de prueba fuera de rango");
  }
  if (r.serverAlias !== undefined && !/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(r.serverAlias)) {
    throw new ProvisioningError("invalid_request", "Servidor de base de datos no válido");
  }
}

export class ProvisioningService {
  private readonly now: () => number;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;

  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private d: ProvisioningDeps) {
    this.now = d.now ?? Date.now;
    this.maxAttempts = d.maxAttemptsPerStep ?? 3;
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async status(tenantId: string): Promise<ProvisioningRecord | null> {
    return this.d.store.get(tenantId);
  }

  /** Listado global de altas (los más recientes primero), filtrable por estado. */
  async list(f: ProvisioningListFilter): Promise<{ items: ProvisioningRecord[]; total: number }> {
    if (!this.d.store.list) throw new ProvisioningError("conflict", "El listado de altas no está disponible");
    return this.d.store.list(f);
  }

  /**
   * Reintento de un alta con la petición GUARDADA (quien reintenta no puede cambiarla). Idempotente:
   * reanuda en el primer paso no completado; un alta ya completada se devuelve tal cual sin repetir
   * nada; una abortada no se reanuda.
   */
  async retry(tenantId: string, actor: Actor): Promise<ProvisionResult> {
    const rec = await this.d.store.get(tenantId);
    if (!rec) throw new ProvisioningError("not_found", "Sin alta para ese tenant");
    if (rec.status === "aborted") throw new ProvisioningError("aborted", "El alta fue abortada: no se puede reintentar");
    return this.run(rec.request, actor);
  }

  /**
   * Ejecuta (o reanuda) el alta. Idempotente: con el mismo `tenantId` y la misma solicitud
   * continúa en el primer paso no completado.
   */
  async run(request: ProvisionRequest, actor: Actor): Promise<ProvisionResult> {
    validateRequest(request);
    // Dos altas simultáneas del mismo tenant (p. ej. doble verificación) se serializan en este
    // proceso: la segunda espera y reanuda sobre el estado ya persistido, sin pasos en paralelo.
    const prev = this.inflight.get(request.tenantId) ?? Promise.resolve();
    const mine = prev.then(() => this.runSerialized(request, actor));
    const tail = mine.catch(() => undefined);
    this.inflight.set(request.tenantId, tail);
    try {
      return await mine;
    } finally {
      if (this.inflight.get(request.tenantId) === tail) this.inflight.delete(request.tenantId);
    }
  }

  /**
   * Invitación nueva para el administrador inicial de un alta completada, solo si aún no la aceptó.
   * Devuelve `null` si ya definió su contraseña (que use la recuperación de contraseña).
   */
  async reissueAdminInvite(tenantId: string): Promise<string | null> {
    const rec = await this.d.store.get(tenantId);
    if (!rec || rec.status !== "completed") throw new ProvisioningError("not_found", "No hay un alta completada para ese tenant");
    if (!this.d.seeder.reissueAdminInvite) return null;
    const out = await this.d.seeder.reissueAdminInvite(await this.dsn(tenantId), { email: rec.request.adminEmail.toLowerCase() });
    return out?.inviteToken ?? null;
  }

  private async runSerialized(request: ProvisionRequest, actor: Actor): Promise<ProvisionResult> {
    let rec = await this.d.store.get(request.tenantId);
    if (rec?.status === "aborted") throw new ProvisioningError("aborted", "El alta fue abortada");
    if (rec && rec.request.displayName !== request.displayName.trim() && rec.status !== "failed") {
      // La solicitud de un alta en curso no se reescribe silenciosamente
      throw new ProvisioningError("conflict", "Ya existe un alta en curso con otros datos");
    }
    if (!rec) {
      rec = {
        tenantId: request.tenantId,
        request: { ...request, displayName: request.displayName.trim() },
        steps: {},
        status: "pending",
        attempts: 0,
        lastError: null,
        updatedAt: this.now(),
      };
    } else {
      rec.request = { ...rec.request, ...request, displayName: request.displayName.trim() };
    }
    if (rec.status === "completed") return this.result(rec);

    rec.status = "running";
    rec.attempts++;
    await this.save(rec);

    const runCtx: { inviteToken?: string } = {};
    for (const step of PROVISION_STEPS) {
      if (rec.steps[step]?.state === "done") continue;
      let lastErr: unknown;
      let ok = false;
      for (let attempt = 1; attempt <= this.maxAttempts && !ok; attempt++) {
        try {
          const out = await this.execute(step, rec, actor, runCtx);
          rec.steps[step] = { state: "done", at: this.now(), ...(out?.info ? { info: out.info } : {}) };
          ok = true;
        } catch (e) {
          lastErr = e;
          // Los errores de contrato (p. ej. transición no válida) no se reintentan
          if (e instanceof RegistryError && e.code !== "stale_version") break;
          if (attempt < this.maxAttempts) await this.sleep(200 * 2 ** (attempt - 1));
        }
      }
      if (!ok) {
        const msg = lastErr instanceof Error ? lastErr.message.slice(0, 300) : "error";
        rec.steps[step] = { state: "failed", at: this.now(), error: msg };
        rec.status = "failed";
        rec.lastError = `${step}: ${msg}`;
        await this.save(rec);
        // Sin datos de la solicitud (correo, nombre): solo empresa, paso, intento y tipo de error
        opsLog("error", "Provisioning", "step_failed", {
          tenantId: rec.tenantId,
          step,
          attempts: rec.attempts,
          error: lastErr instanceof RegistryError ? `RegistryError:${lastErr.code}` : lastErr instanceof Error ? lastErr.name : "error",
        });
        recordFailure("provisioning.failed", rec.tenantId);
        return { ...this.result(rec), failedStep: step, error: msg };
      }
      await this.save(rec); // checkpoint tras cada paso
    }

    rec.status = "completed";
    rec.lastError = null;
    await this.save(rec);
    return { ...this.result(rec), adminInviteToken: runCtx.inviteToken };
  }

  /**
   * Compensación: solo para altas que NUNCA llegaron a activarse. Pasa el tenant a
   * `deleting` → elimina la BD y sus credenciales → `deleted`. Requiere un operador.
   */
  async abort(tenantId: string, actor: Actor, reason: string): Promise<void> {
    if (actor.type !== "operator") throw new RegistryError("forbidden", "Solo un operador puede abortar un alta");
    const rec = await this.d.store.get(tenantId);
    if (!rec) throw new ProvisioningError("not_found", "No hay alta para ese tenant");
    if (rec.steps.activate?.state === "done") {
      throw new ProvisioningError("conflict", "El tenant ya está activado: use el ciclo de vida normal");
    }
    const t = await this.d.reader.getTenant(tenantId);
    if (t && t.status === "provisioning") {
      await this.d.registry.setStatus(tenantId, "deleting", actor, { reason });
    }
    await this.d.databases.dropDatabase(tenantId);
    if (t && (await this.d.reader.getTenant(tenantId))?.status === "deleting") {
      await this.d.registry.setStatus(tenantId, "deleted", actor, { reason });
    }
    rec.status = "aborted";
    rec.lastError = null;
    await this.save(rec);
  }

  // ── Pasos ──────────────────────────────────────────────────────────────────

  private async execute(
    step: ProvisionStep,
    rec: ProvisioningRecord,
    actor: Actor,
    runCtx: { inviteToken?: string },
  ): Promise<{ info?: Record<string, string | number | boolean | null> } | void> {
    const r = rec.request;
    const id = r.tenantId;
    const domain = `${id}.${r.platformDomain}`;

    switch (step) {
      case "register": {
        const existing = await this.d.reader.getTenant(id);
        if (existing) {
          if (existing.status !== "provisioning") throw new ProvisioningError("conflict", "El tenant ya existe y no está en alta");
          return;
        }
        await this.d.registry.createTenant({ id, displayName: r.displayName }, actor);
        return;
      }
      case "database": {
        // Idempotente: reutiliza la BD y rota su credencial; re-registra el DSN cifrado
        const { dsn, serverAlias } = await this.d.databases.ensureDatabase(id, r.serverAlias ? { serverAlias: r.serverAlias } : undefined);
        const pending = (await this.d.reader.listDatabases(id)).filter((x) => x.state === "pending");
        if (!pending.length && !(await this.d.reader.getActiveDatabase(id))) {
          await this.d.registry.registerDatabase(id, dsn, actor, { serverAlias });
        } else if (pending.length) {
          // Credencial rotada por ensureDatabase: se sustituye el DSN pendiente
          await this.d.registry.registerDatabase(id, dsn, actor, { serverAlias });
        }
        return;
      }
      case "schema": {
        const dsn = await this.dsn(id);
        const v = await this.d.schema.apply(dsn);
        // Triggers que la baseline no puede llevar: los crea la conexión de administración
        const triggers = this.d.databases.ensureTriggers ? await this.d.databases.ensureTriggers(id) : [];
        await this.d.registry.setSchemaVersion(id, v.schemaVersion, actor);
        return { info: { baseline: v.baselineVersion, schema: v.schemaVersion, triggersCreated: triggers.length } };
      }
      case "activate_database": {
        if (await this.d.reader.getActiveDatabase(id)) return;
        const pending = (await this.d.reader.listDatabases(id)).filter((x) => x.state === "pending");
        const latest = pending.sort((a, b) => b.id - a.id)[0];
        if (!latest) throw new ProvisioningError("conflict", "No hay base de datos pendiente de activar");
        await this.d.registry.activateDatabase(id, latest.id, actor);
        return;
      }
      case "modules": {
        const ids = r.modules ?? [];
        if (!this.d.modules || ids.length === 0) return { info: { installed: 0 } };
        const out = await this.d.modules.install(await this.dsn(id), ids);
        return { info: { installed: out.installed.length } };
      }
      case "admin": {
        const dsn = await this.dsn(id);
        const out = await this.d.seeder.seedAdmin(dsn, { email: r.adminEmail.toLowerCase(), name: r.adminName ?? "Administrador" });
        if (out.inviteToken) runCtx.inviteToken = out.inviteToken;
        return { info: { created: out.created } };
      }
      case "domain": {
        const existing = (await this.d.reader.listDomains(id)).find((x) => x.domain === domain);
        if (!existing) await this.d.registry.addDomain(id, domain, "platform_subdomain", actor, { primary: true });
        const cur = (await this.d.reader.listDomains(id)).find((x) => x.domain === domain);
        if (cur && cur.status !== "active") await this.d.registry.activateDomain(domain, actor);
        return { info: { domain } };
      }
      case "branding": {
        const b = r.brand ?? {};
        const settings: Record<string, string> = { brand_name: b.name ?? r.displayName, brand_domain: domain };
        if (b.phone) settings.brand_phone = b.phone;
        if (b.email) settings.email_reservations = b.email;
        if (b.logoUrl) settings.brand_logo_url = b.logoUrl;
        if (b.primaryColor) settings.brand_primary_color = b.primaryColor;
        if (b.accentColor) settings.brand_accent_color = b.accentColor;
        await this.d.seeder.seedBranding(await this.dsn(id), settings);
        return;
      }
      case "template": {
        if (r.templateId && this.d.seeder.seedTemplate) await this.d.seeder.seedTemplate(await this.dsn(id), r.templateId);
        return;
      }
      case "entitlements": {
        const until = new Date(this.now() + (r.trialDays ?? 15) * 86_400_000);
        for (const m of r.modules ?? []) await this.d.entitlements.grant(id, m, actor, { validUntil: until });
        return { info: { modules: (r.modules ?? []).length } };
      }
      case "quotas": {
        for (const q of r.quotas ?? []) await this.d.quotas.set({ tenantId: id, ...q }, actor);
        return { info: { quotas: (r.quotas ?? []).length } };
      }
      case "activate": {
        const t = await this.d.reader.getTenant(id);
        if (t?.status === "provisioning") await this.d.registry.setStatus(id, "trial", actor, {});
        // Alta reanudada: la invitación se creó en una ejecución anterior y se perdió con ella. Se
        // emite una nueva (solo si el administrador no la aceptó) para que pueda entrar.
        if (!runCtx.inviteToken && this.d.seeder.reissueAdminInvite) {
          const again = await this.d.seeder.reissueAdminInvite(await this.dsn(id), { email: r.adminEmail.toLowerCase() });
          if (again) runCtx.inviteToken = again.inviteToken;
        }
        if (this.d.welcome) {
          try {
            await this.d.welcome.notify({ tenantId: id, adminEmail: r.adminEmail, domain, inviteToken: runCtx.inviteToken });
          } catch {
            /* la bienvenida es de mejor esfuerzo: no invalida el alta */
          }
        }
        return;
      }
    }
  }

  private async dsn(tenantId: string): Promise<string> {
    const active = await this.d.reader.getActiveDatabase(tenantId);
    if (active) return (await this.d.registry.getActiveDsn(tenantId))!;
    // Antes de activar, la BD pendiente más reciente
    const pending = (await this.d.reader.listDatabases(tenantId)).filter((x) => x.state === "pending");
    if (!pending.length) throw new ProvisioningError("conflict", "El tenant no tiene base de datos registrada");
    return this.d.registry.decryptDatabase(pending.sort((a, b) => b.id - a.id)[0]);
  }

  private result(rec: ProvisioningRecord): ProvisionResult {
    return {
      tenantId: rec.tenantId,
      status: rec.status,
      completedSteps: PROVISION_STEPS.filter((s) => rec.steps[s]?.state === "done"),
      domain: `${rec.tenantId}.${rec.request.platformDomain}`,
    };
  }

  private async save(rec: ProvisioningRecord): Promise<void> {
    rec.updatedAt = this.now();
    await this.d.store.put(rec);
  }
}
