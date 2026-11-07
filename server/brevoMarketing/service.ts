/**
 * Elephant Connect · Brevo marketing: la empresa conecta SU cuenta de Brevo (clave en la bóveda, proveedor
 * `brevo_marketing`), elige una lista y sincroniza con ella los clientes del CRM con consentimiento de marketing.
 *
 *  - Licencia `email-campaigns` (el router la exige con el guardián de rutas; el job la comprueba por empresa).
 *  - Sin clave configurada, la integración está desactivada: no se llama a Brevo.
 *  - Una sola ejecución a la vez por empresa (la BD lo garantiza); las que se quedaron «en curso» por una caída se
 *    cierran como fallidas al empezar la siguiente.
 *  - Reintento controlado: solo de una ejecución fallida o parcial, y solo de la última; con la clave rechazada no se
 *    reintenta (hay que corregirla).
 *  - Desconectar borra la clave de la bóveda y apaga la sincronización automática; consentimientos e historial se
 *    conservan.
 *  - Bajas: se leen de la propia lista de Brevo en cada ejecución (no hay webhook público en esta versión).
 */
import { BrevoApiError, BrevoBudgetExceeded, BrevoMarketingClient, IMPORT_BATCH, REMOVE_BATCH, type FetchLike } from "./client";
import { MAX_CALLS_PER_RUN, STALE_RUN_MS, checkGrant, chunk, planSync } from "./plan";
import { RunInProgress, type BrevoMarketingStore, type Run, type RunStats, type RunTrigger } from "./store";

export class BrevoMarketingError extends Error {
  constructor(
    public code: "invalid_input" | "not_found" | "conflict" | "not_configured" | "rejected" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "BrevoMarketingError";
  }
}

export interface BrevoDeps {
  store: BrevoMarketingStore;
  credentials: { apiKey(): Promise<string | null>; clear(actor: string): Promise<void> };
  /** Licencia `email-campaigns` de la empresa (solo la usa el job; las rutas ya la exigen). */
  licensed?: () => Promise<boolean>;
  fetch?: FetchLike;
  maxCalls?: number;
  maxContacts?: number;
}

const UNSUB_SOURCE = "brevo_unsubscribe";
export const PUBLIC_UNSUB_SOURCE = "public_unsubscribe";

export class BrevoMarketingService {
  constructor(private d: BrevoDeps) {}

  private async client(maxCalls = this.d.maxCalls ?? MAX_CALLS_PER_RUN, signal?: AbortSignal) {
    const key = await this.d.credentials.apiKey();
    if (!key) throw new BrevoMarketingError("not_configured", "Conecta primero tu cuenta de Brevo en Ajustes → Integraciones");
    return new BrevoMarketingClient(key, { fetch: this.d.fetch, maxCalls, signal });
  }
  private wrap(e: unknown): never {
    if (e instanceof BrevoMarketingError) throw e;
    if (e instanceof BrevoApiError) throw new BrevoMarketingError(e.rejected ? "rejected" : "unavailable", e.message);
    throw e;
  }

  async status() {
    const [settings, key, runs, counts] = await Promise.all([this.d.store.settings(), this.d.credentials.apiKey(), this.d.store.runs(1), this.d.store.consentCounts()]);
    return { connected: !!key, ...settings, lastRun: runs[0] ?? null, consents: counts };
  }

  /** Prueba de solo lectura (GET /account). */
  async testConnection() {
    try {
      const c = await this.client(1);
      const a = await c.account();
      return { ok: true, account: a.companyName ?? a.email ?? null };
    } catch (e) {
      return this.wrap(e);
    }
  }

  async lists() {
    try {
      return (await (await this.client(2)).lists(50, 0)).lists;
    } catch (e) {
      return this.wrap(e);
    }
  }

  /** Elige la lista de Brevo (debe existir en la cuenta). */
  async chooseList(listId: number, actor: string) {
    if (!Number.isInteger(listId) || listId <= 0) throw new BrevoMarketingError("invalid_input", "Lista no válida");
    let name: string;
    try {
      name = (await (await this.client(1)).list(listId)).name;
    } catch (e) {
      if (e instanceof BrevoApiError && e.status === 404) throw new BrevoMarketingError("not_found", "Esa lista no existe en tu cuenta de Brevo");
      return this.wrap(e);
    }
    const before = await this.d.store.settings();
    await this.d.store.saveSettings({ listId, listName: name, connected: before.connectedAt == null || before.disconnectedAt != null }, actor);
    return this.d.store.settings();
  }

  async setAutoSync(on: boolean, actor: string) {
    const s = await this.d.store.settings();
    if (on && (!s.listId || !(await this.d.credentials.apiKey()))) throw new BrevoMarketingError("conflict", "Conecta la cuenta y elige una lista antes de activar la sincronización automática");
    await this.d.store.saveSettings({ autoSync: on }, actor);
    return this.d.store.settings();
  }

  /** Borra la clave de la bóveda y apaga la sincronización. Los consentimientos y el historial se conservan. */
  async disconnect(actor: string) {
    await this.d.credentials.clear(actor);
    await this.d.store.saveSettings({ autoSync: false, listId: null, listName: null, disconnected: true }, actor);
    return this.status();
  }

  // ── Consentimiento ────────────────────────────────────────────────────────────

  clients(q: string) {
    return this.d.store.clients(q.slice(0, 100), 50);
  }

  async grantConsent(clientId: number, source: string, evidence: string, actor: string) {
    if (!(await this.d.store.clientExists(clientId))) throw new BrevoMarketingError("not_found", "Cliente no encontrado");
    let g: { source: string; evidence: string };
    try {
      g = checkGrant(source, evidence);
    } catch (e) {
      throw new BrevoMarketingError("invalid_input", (e as Error).message);
    }
    const prev = await this.d.store.consent(clientId);
    await this.d.store.setConsent({ clientId, status: "granted", source: g.source, evidence: g.evidence, updatedBy: actor }, { clientId, previousStatus: prev?.status ?? null, newStatus: "granted", source: g.source, evidence: g.evidence, actor });
    return this.d.store.consent(clientId);
  }

  async withdrawConsent(clientId: number, reason: string, actor: string) {
    const prev = await this.d.store.consent(clientId);
    if (!prev) throw new BrevoMarketingError("not_found", "Ese cliente no tiene consentimiento registrado");
    if (prev.status === "withdrawn") return prev;
    const r = reason.trim().slice(0, 500) || null;
    await this.d.store.setConsent({ clientId, status: "withdrawn", source: "manual", evidence: r, updatedBy: actor }, { clientId, previousStatus: "granted", newStatus: "withdrawn", source: "manual", evidence: r, actor });
    return this.d.store.consent(clientId);
  }

  consentLog(clientId: number) {
    return this.d.store.consentLog(clientId);
  }

  /**
   * Baja desde el enlace público (server/netPublic/brevoUnsubscribe.ts): retira el consentimiento con su historial
   * (idempotente: repetirla no cambia nada) y, SOLO si la empresa tiene su clave de Brevo y una lista elegidas, saca el
   * correo de esa lista. Si Brevo falla, la baja en el CRM queda hecha y la siguiente sincronización lo saca de la lista.
   */
  async publicUnsubscribe(clientId: number): Promise<{ changed: boolean; propagated: boolean }> {
    if (!(await this.d.store.clientExists(clientId))) return { changed: false, propagated: false };
    const changed = await this.d.store.withdrawOnce(clientId, PUBLIC_UNSUB_SOURCE, "Baja con el enlace de las comunicaciones", "public:unsubscribe");
    let propagated = false;
    try {
      const [settings, key, email] = await Promise.all([this.d.store.settings(), this.d.credentials.apiKey(), this.d.store.clientEmail(clientId)]);
      if (key && settings.listId && email) {
        await new BrevoMarketingClient(key, { fetch: this.d.fetch, maxCalls: 1 }).removeFromList(settings.listId, [email.trim().toLowerCase()]);
        propagated = true;
      }
    } catch {
      propagated = false;
    }
    return { changed, propagated };
  }

  // ── Sincronización ────────────────────────────────────────────────────────────

  runs() {
    return this.d.store.runs(20);
  }

  /** Reintenta la última ejecución si falló o quedó parcial (con la clave rechazada, no). */
  async retry(runId: number, actor: string) {
    const [last] = await this.d.store.runs(1);
    if (!last || last.id !== runId) throw new BrevoMarketingError("conflict", "Solo se puede reintentar la última ejecución");
    if (last.status !== "failed" && last.status !== "partial") throw new BrevoMarketingError("conflict", "Esa ejecución terminó bien: no hay nada que reintentar");
    if (last.errorMessage === "Brevo rechaza la clave API") throw new BrevoMarketingError("rejected", "La clave API fue rechazada: corrígela en Ajustes → Integraciones antes de reintentar");
    return this.sync("retry", actor, runId);
  }

  /** Lo que haría una ejecución ahora, sin llamar a Brevo (sin leer sus bajas). */
  async preview() {
    const plan = planSync(await this.d.store.candidates(), await this.d.store.previous(), new Set(), this.d.maxContacts);
    return { toExport: plan.toImport.length, toRemove: plan.toRemove.length, skipped: plan.skipped, truncated: plan.truncated };
  }

  /**
   * Una ejecución: lee las bajas de la lista, retira en el CRM el consentimiento de quien se dio de baja, exporta a
   * quien tiene consentimiento y saca de la lista a quien ya no lo tiene. Con el tope de llamadas agotado queda parcial.
   */
  async sync(trigger: RunTrigger, actor: string, retryOf: number | null = null, signal?: AbortSignal): Promise<Run> {
    const settings = await this.d.store.settings();
    if (!settings.listId) throw new BrevoMarketingError("conflict", "Elige primero la lista de Brevo");
    const client = await this.client(undefined, signal);
    // El corte lo calcula la BD con su reloj (sin desfases de zona horaria entre Node y MySQL)
    await this.d.store.failStaleRuns(STALE_RUN_MS);
    const runId = await this.d.store.startRun(trigger, settings.listId, actor, retryOf);
    const stats: RunStats = { apiCalls: 0, exported: 0, removed: 0, unsubscribed: 0, skipped: 0, errors: 0 };
    let status: "completed" | "partial" | "failed" = "completed";
    let message: string | null = null;
    const listId = settings.listId;
    try {
      // 1. Bajas en Brevo (de la lista o de toda la cuenta)
      const unsub = new Set<string>();
      for (let offset = 0; ; ) {
        const page = await client.listContacts(listId, offset);
        for (const c of page.contacts) if (c.blacklisted || c.unsubscribedFromList) unsub.add(c.email.trim().toLowerCase());
        offset += page.contacts.length;
        if (!page.contacts.length || offset >= page.count) break;
      }
      // 2. Plan
      const plan = planSync(await this.d.store.candidates(), await this.d.store.previous(), unsub, this.d.maxContacts);
      stats.skipped = plan.skipped;
      if (plan.truncated) status = "partial";
      // 3. Las bajas de Brevo mandan: se retira el consentimiento en el CRM
      for (const u of plan.unsubscribed) {
        await this.d.store.setConsent(
          { clientId: u.clientId, status: "withdrawn", source: UNSUB_SOURCE, evidence: "Baja en Brevo", updatedBy: "system:brevo" },
          { clientId: u.clientId, previousStatus: "granted", newStatus: "withdrawn", source: UNSUB_SOURCE, evidence: "Baja en Brevo", actor: "system:brevo" },
        );
        await this.d.store.recordSync([{ clientId: u.clientId, email: u.email, status: "removed" }], runId);
        stats.unsubscribed++;
      }
      // 4. Salen de la lista quienes ya no tienen consentimiento
      for (const batch of chunk(plan.toRemove, REMOVE_BATCH)) {
        try {
          await client.removeFromList(listId, batch.map((b) => b.email));
          await this.d.store.recordSync(batch.map((b) => ({ clientId: b.clientId, email: b.email, status: "removed" as const })), runId);
          stats.removed += batch.length;
        } catch (e) {
          if (!(e instanceof BrevoApiError) || e.rejected) throw e;
          // 400 de Brevo: alguno ya no estaba en la lista; se registran como error para revisarlo
          await this.d.store.recordSync(batch.map((b) => ({ clientId: b.clientId, email: b.email, status: "error" as const, error: e.message })), runId);
          stats.errors += batch.length;
        }
      }
      // 5. Altas y actualizaciones de quien tiene consentimiento
      for (const batch of chunk(plan.toImport, IMPORT_BATCH)) {
        try {
          await client.importToList(listId, batch.map((b) => ({ email: b.email, firstName: b.firstName })));
          await this.d.store.recordSync(batch.map((b) => ({ clientId: b.clientId, email: b.email, status: "synced" as const })), runId);
          stats.exported += batch.length;
        } catch (e) {
          if (!(e instanceof BrevoApiError) || e.rejected) throw e;
          await this.d.store.recordSync(batch.map((b) => ({ clientId: b.clientId, email: b.email, status: "error" as const, error: e.message })), runId);
          stats.errors += batch.length;
        }
      }
      if (stats.errors > 0 && status === "completed") status = "partial";
    } catch (e) {
      if (e instanceof BrevoBudgetExceeded) {
        status = "partial";
        message = e.message;
      } else if (e instanceof BrevoApiError) {
        status = "failed";
        message = e.message;
      } else {
        status = "failed";
        message = "Error interno durante la sincronización";
        await this.d.store.finishRun(runId, status, { ...stats, apiCalls: client.callsMade }, message);
        throw e;
      }
    }
    stats.apiCalls = client.callsMade;
    await this.d.store.finishRun(runId, status, stats, message);
    return (await this.d.store.run(runId))!;
  }

  /** Ejecución del job para la empresa en curso: solo con licencia, clave, lista y la sincronización automática activada. */
  async runScheduled(signal?: AbortSignal): Promise<{ skipped?: string }> {
    if (this.d.licensed && !(await this.d.licensed())) return { skipped: "not_licensed" };
    const s = await this.d.store.settings();
    if (!s.autoSync) return { skipped: "auto_sync_off" };
    if (!s.listId) return { skipped: "no_list" };
    if (!(await this.d.credentials.apiKey())) return { skipped: "not_configured" };
    try {
      await this.sync("job", "system:job", null, signal);
    } catch (e) {
      if (e instanceof RunInProgress) return { skipped: "running" };
      throw e;
    }
    return {};
  }
}

