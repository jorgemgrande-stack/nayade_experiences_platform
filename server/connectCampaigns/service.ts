/**
 * Elephant Connect · Campaigns: campañas de correo redactadas en el Core y enviadas con la cuenta de Brevo PROPIA de la
 * empresa (la clave de la bóveda `brevo_marketing`, la misma de la sincronización). Postmark no se usa para campañas.
 *
 *  - Licencia `email-campaigns` (guardián de rutas `brevoMarketing` + comprobación en el procedimiento; el job la mira
 *    por empresa). Sin clave configurada no se llama a Brevo: la pantalla explica cómo conectarla.
 *  - Audiencia = etiquetas del CRM ∩ consentimiento de marketing concedido (plan.ts). Cada campaña tiene SU lista en
 *    Brevo (carpeta «Elephant Campaigns») con solo esos contactos, importados con el enlace de baja propio y firmado de
 *    cada cliente (atributo BAJA_URL), que la plantilla pone en el pie.
 *  - Ciclo: draft → preparing (lista e importación en Brevo) → scheduled | sent, o failed. La campaña de Brevo se crea
 *    SIEMPRE como borrador; enviar o programar es una llamada aparte que se reserva antes en la BD (`claimSend`): dos
 *    peticiones a la vez, un reintento o el job nunca envían dos veces. Si Brevo no confirma ese paso, la campaña queda
 *    fallida y bloqueada (hay que comprobarlo en Brevo y, si hace falta, duplicarla).
 *  - Bajas: una retirada de consentimiento (cualquier vía) saca el correo de las listas de las campañas aún no enviadas
 *    (`onWithdrawn`); además, antes de reservar el envío y en cada actualización de una programada se vuelve a calcular
 *    la audiencia y se saca a quien ya no tiene consentimiento (`reconcile`). Al leer las estadísticas se leen las bajas
 *    de la lista de la campaña y se retira el consentimiento en el CRM: una baja nunca entra en otra campaña.
 */
import { BrevoApiError, BrevoBudgetExceeded, BrevoMarketingClient, IMPORT_BATCH, LIST_PAGE, REMOVE_BATCH, type BrevoCampaignInput, type FetchLike } from "../brevoMarketing/client";
import { chunk } from "../brevoMarketing/plan";
import type { BrevoMarketingStore } from "../brevoMarketing/store";
import { checkBlocks, missingForSend, NAME_MAX, PREVIEW_MAX, SUBJECT_MAX, type CampaignBlock } from "../../shared/connectCampaigns";
import { FOLDER_NAME, MAX_CALLS_PER_STEP, MAX_RECIPIENTS, UNSUB_ATTRIBUTE, UNSUB_TAG, checkSchedule, importsState, planAudience, testErrorMessage } from "./plan";
import type { Campaign, CampaignStore, DraftInput, TagMode } from "./store";

export class CampaignError extends Error {
  constructor(
    public code: "invalid_input" | "not_found" | "conflict" | "not_configured" | "rejected" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "CampaignError";
  }
}

export interface CampaignDeps {
  store: CampaignStore;
  /** Almacén de Brevo marketing: los consentimientos (retirar la baja leída de Brevo). */
  consents: Pick<BrevoMarketingStore, "withdrawOnce">;
  credentials: { apiKey(): Promise<string | null> };
  /** HTML de la campaña con la plantilla y la marca de la empresa. */
  render(d: { title: string; previewText: string | null; blocks: CampaignBlock[]; unsubscribeHref: string }): string;
  /** Enlace público de baja firmado del cliente (server/netPublic/brevoUnsubscribe.ts). */
  unsubscribeUrl(clientId: number): string;
  licensed?: () => Promise<boolean>;
  fetch?: FetchLike;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Comprobaciones de la importación tras preparar el envío en la misma petición. */
  pollAttempts?: number;
}

export interface DraftPayload {
  name: string;
  subject: string;
  previewText?: string | null;
  senderId?: number | null;
  replyTo?: string | null;
  blocks: unknown;
  tagIds: number[];
  tagMode: TagMode;
}

const STATS_EVERY_MS = 60 * 60_000;
/** Una preparación sin lista de Brevo pasado este plazo se da por interrumpida. */
export const STUCK_PREPARING_MS = 30 * 60_000;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const SYSTEM = "system:campaigns";

export class CampaignService {
  constructor(private d: CampaignDeps) {}

  private now() {
    return this.d.now?.() ?? new Date();
  }
  private async client(maxCalls = MAX_CALLS_PER_STEP, signal?: AbortSignal) {
    const key = await this.d.credentials.apiKey();
    if (!key) throw new CampaignError("not_configured", "Conecta primero la cuenta de Brevo de tu empresa en Ajustes → Integraciones");
    return new BrevoMarketingClient(key, { fetch: this.d.fetch, maxCalls, signal });
  }
  private wrap(e: unknown): never {
    if (e instanceof CampaignError) throw e;
    if (e instanceof BrevoApiError) throw new CampaignError(e.rejected ? "rejected" : "unavailable", e.message);
    if (e instanceof BrevoBudgetExceeded) throw new CampaignError("unavailable", e.message);
    throw e;
  }
  private async must(id: number): Promise<Campaign> {
    const c = await this.d.store.get(id);
    if (!c) throw new CampaignError("not_found", "Campaña no encontrada");
    return c;
  }

  // ── Consulta ──────────────────────────────────────────────────────────────────

  async status() {
    return { connected: !!(await this.d.credentials.apiKey()) };
  }

  /** Remitentes activos (verificados) de la cuenta de Brevo de la empresa. */
  async senders() {
    try {
      return (await (await this.client(1)).senders()).filter((s) => s.active).map(({ id, name, email }) => ({ id, name, email }));
    } catch (e) {
      return this.wrap(e);
    }
  }

  tags() {
    return this.d.store.tags();
  }
  list() {
    return this.d.store.list(100);
  }
  async get(id: number) {
    const c = await this.must(id);
    return { ...c, events: await this.d.store.events(id) };
  }

  /** Cuántos recibirían la campaña ahora (segmento ∩ consentimiento), sin llamar a Brevo. */
  async audience(tagIds: number[], mode: TagMode) {
    const a = planAudience(await this.d.store.audience(tagIds, mode), await this.d.store.withdrawnEmails());
    return { recipients: a.recipients.length, skipped: a.skipped, withdrawn: a.withdrawn, tooMany: a.recipients.length > MAX_RECIPIENTS, max: MAX_RECIPIENTS };
  }

  html(c: Pick<Campaign, "subject" | "name" | "previewText" | "blocks">, unsubscribeHref: string) {
    return this.d.render({ title: c.subject || c.name, previewText: c.previewText, blocks: c.blocks, unsubscribeHref });
  }

  /** Vista previa con un enlace de baja de ejemplo (no da de baja a nadie). */
  async preview(id: number) {
    const c = await this.must(id);
    return { html: this.html(c, "#enlace-de-baja"), subject: c.subject, previewText: c.previewText };
  }

  // ── Redacción ─────────────────────────────────────────────────────────────────

  private async draft(p: DraftPayload): Promise<DraftInput> {
    const name = p.name.trim().slice(0, NAME_MAX);
    if (!name) throw new CampaignError("invalid_input", "Pon un nombre a la campaña");
    let blocks: CampaignBlock[];
    try {
      blocks = checkBlocks(p.blocks);
    } catch (e) {
      throw new CampaignError("invalid_input", (e as Error).message);
    }
    const replyTo = (p.replyTo ?? "").trim().toLowerCase() || null;
    if (replyTo && !EMAIL_RE.test(replyTo)) throw new CampaignError("invalid_input", "El correo de respuesta no es válido");
    let senderName: string | null = null;
    let senderEmail: string | null = null;
    if (p.senderId) {
      // El remitente tiene que ser uno activo de la cuenta de Brevo de la empresa
      const s = (await this.senders()).find((x) => x.id === p.senderId);
      if (!s) throw new CampaignError("invalid_input", "Ese remitente no está verificado en tu cuenta de Brevo");
      senderName = s.name;
      senderEmail = s.email;
    }
    const tagIds = Array.from(new Set(p.tagIds.filter((t) => Number.isInteger(t) && t > 0))).slice(0, 20);
    return {
      name,
      subject: p.subject.replace(/[\r\n]+/g, " ").trim().slice(0, SUBJECT_MAX),
      previewText: (p.previewText ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, PREVIEW_MAX) || null,
      senderId: p.senderId ?? null,
      senderName,
      senderEmail,
      replyTo,
      blocks,
      tagIds,
      tagMode: p.tagMode === "all" ? "all" : "any",
    };
  }

  async create(p: DraftPayload, actor: string) {
    const id = await this.d.store.create(await this.draft(p), actor);
    await this.d.store.event(id, "created", null, actor);
    return this.d.store.get(id);
  }

  async update(id: number, p: DraftPayload, actor: string) {
    const c = await this.must(id);
    if (c.status !== "draft") throw new CampaignError("conflict", "Solo se puede editar un borrador");
    if (!(await this.d.store.updateDraft(id, await this.draft(p), actor))) throw new CampaignError("conflict", "La campaña ya no es un borrador");
    return this.d.store.get(id);
  }

  /** Copia como borrador nuevo (p. ej. para repetir una campaña fallida o ya enviada). */
  async duplicate(id: number, actor: string) {
    const c = await this.must(id);
    const nid = await this.d.store.create(
      { name: `${c.name} (copia)`.slice(0, NAME_MAX), subject: c.subject, previewText: c.previewText, senderId: c.senderId, senderName: c.senderName, senderEmail: c.senderEmail, replyTo: c.replyTo, blocks: c.blocks, tagIds: c.tagIds, tagMode: c.tagMode },
      actor,
    );
    await this.d.store.event(nid, "created", `Copia de la campaña ${id}`, actor);
    return this.d.store.get(nid);
  }

  // ── Brevo ─────────────────────────────────────────────────────────────────────

  private brevoInput(c: Campaign, listId: number | null): BrevoCampaignInput {
    return {
      name: `${c.name} · #${c.id}`.slice(0, 200),
      subject: c.subject,
      previewText: c.previewText,
      sender: { id: c.senderId! },
      replyTo: c.replyTo,
      htmlContent: this.html(c, UNSUB_TAG),
      ...(listId ? { listIds: [listId] } : {}),
    };
  }

  /**
   * Crea (como borrador) o actualiza en Brevo la campaña con el contenido actual. La de pruebas (sin lista) y la del
   * envío (con la lista de la campaña desde su creación) son dos campañas distintas de Brevo.
   */
  private async upsertBrevo(client: BrevoMarketingClient, c: Campaign, kind: "send" | "test"): Promise<number> {
    const existing = kind === "test" ? c.brevoTestCampaignId : c.brevoCampaignId;
    const input = kind === "test" ? { ...this.brevoInput(c, null), name: `[Prueba] ${c.name} · #${c.id}`.slice(0, 200) } : this.brevoInput(c, c.brevoListId);
    if (existing) {
      await client.updateEmailCampaign(existing, input);
      return existing;
    }
    const id = await client.createEmailCampaign(input);
    if (await this.d.store.setBrevoCampaign(c.id, id, kind)) return id;
    // Otra petición la creó a la vez: se usa la suya (la nuestra queda como borrador sin enviar en Brevo)
    const now = await this.must(c.id);
    return (kind === "test" ? now.brevoTestCampaignId : now.brevoCampaignId) ?? id;
  }

  /** Envío de prueba a un buzón (Brevo exige que sea un contacto de la cuenta; máximo 50 pruebas al día). */
  async sendTest(id: number, email: string, actor: string) {
    const to = email.trim().toLowerCase();
    if (!EMAIL_RE.test(to)) throw new CampaignError("invalid_input", "Escribe un correo válido para la prueba");
    const c = await this.must(id);
    if (c.status !== "draft" && c.status !== "failed") throw new CampaignError("conflict", "Las pruebas se envían desde un borrador");
    if (c.sendClaimedAt) throw new CampaignError("conflict", "Esta campaña ya se pidió a Brevo: duplícala para hacer pruebas");
    const missing = missingForSend(c);
    if (missing.length) throw new CampaignError("invalid_input", `Falta ${missing.join(", ")}`);
    try {
      const client = await this.client(3);
      const brevoId = await this.upsertBrevo(client, c, "test");
      await client.sendTestEmail(brevoId, [to]);
    } catch (e) {
      if (e instanceof BrevoApiError && !e.rejected && e.status === 400) throw new CampaignError("invalid_input", testErrorMessage(e.code));
      return this.wrap(e);
    }
    await this.d.store.event(id, "test", to, actor);
    return { ok: true };
  }

  private async ensureFolder(client: BrevoMarketingClient): Promise<number> {
    const s = await this.d.store.settings();
    if (s.folderId) return s.folderId;
    const found = (await client.folders()).find((f) => f.name === FOLDER_NAME);
    const folderId = found?.id ?? (await client.createFolder(FOLDER_NAME));
    await this.d.store.saveSettings({ folderId });
    return folderId;
  }

  private async ensureAttribute(client: BrevoMarketingClient) {
    if ((await this.d.store.settings()).attributeReady) return;
    try {
      await client.createTextAttribute(UNSUB_ATTRIBUTE);
    } catch (e) {
      // 400: el atributo ya existe en la cuenta
      if (!(e instanceof BrevoApiError) || e.status !== 400) throw e;
    }
    await this.d.store.saveSettings({ attributeReady: true });
  }

  /**
   * Enviar ya o programar: comprueba la campaña y la audiencia, reserva el paso a «preparing» (una sola petición lo
   * consigue), crea la lista de la campaña en Brevo e importa solo a los contactos con consentimiento. Después intenta
   * terminar en la misma petición (`advance`); si Brevo aún importa, lo terminan «Actualizar» o el job.
   */
  async launch(id: number, when: { at: Date | null }, actor: string) {
    const c = await this.must(id);
    if (c.status !== "draft" && c.status !== "failed") throw new CampaignError("conflict", "Esta campaña ya se está enviando o se envió");
    if (c.sendClaimedAt) throw new CampaignError("conflict", "Esta campaña ya se pidió a Brevo: compruébala allí o duplícala");
    const missing = missingForSend(c);
    if (missing.length) throw new CampaignError("invalid_input", `Falta ${missing.join(", ")}`);
    if (when.at) {
      try {
        checkSchedule(when.at, this.now());
      } catch (e) {
        throw new CampaignError("invalid_input", (e as Error).message);
      }
    }
    const aud = planAudience(await this.d.store.audience(c.tagIds, c.tagMode), await this.d.store.withdrawnEmails());
    if (!aud.recipients.length) throw new CampaignError("invalid_input", "Nadie del segmento tiene el consentimiento de marketing concedido");
    if (aud.recipients.length > MAX_RECIPIENTS) throw new CampaignError("invalid_input", `El segmento tiene ${aud.recipients.length} contactos: el máximo por campaña es ${MAX_RECIPIENTS}`);
    const client = await this.client();
    if (!(await this.d.store.claimLaunch(id, when.at, actor))) throw new CampaignError("conflict", "Esta campaña ya se está enviando o se envió");
    await this.d.store.event(id, when.at ? "schedule" : "send", when.at ? `Programada para ${when.at.toISOString()}` : `${aud.recipients.length} destinatarios`, actor);
    try {
      const folderId = await this.ensureFolder(client);
      await this.ensureAttribute(client);
      const listId = await client.createList(`Campaña #${id} · ${c.name}`.slice(0, 190), folderId);
      await this.d.store.saveRecipients(id, listId, aud.recipients);
      const processIds: number[] = [];
      for (const batch of chunk(aud.recipients, IMPORT_BATCH)) {
        const p = await client.importContacts(
          listId,
          batch.map((r) => ({ email: r.email, attributes: { [UNSUB_ATTRIBUTE]: this.d.unsubscribeUrl(r.clientId), ...(r.firstName ? { FIRSTNAME: r.firstName } : {}) } })),
        );
        if (p != null) processIds.push(p);
      }
      await this.d.store.setPrepared(id, { listId, processIds, recipients: aud.recipients.length });
    } catch (e) {
      await this.fail(id, e instanceof BrevoApiError || e instanceof BrevoBudgetExceeded ? `No se pudo preparar el envío en Brevo (${e.message})` : "Error interno al preparar el envío");
      if (!(e instanceof BrevoApiError || e instanceof BrevoBudgetExceeded)) throw e;
      return this.d.store.get(id);
    }
    for (let i = 0; i < (this.d.pollAttempts ?? 3); i++) {
      const r = await this.advance(id, actor);
      if (r?.status !== "preparing") return r;
      await (this.d.sleep ?? ((ms) => new Promise((res) => setTimeout(res, ms))))(2000);
    }
    return this.d.store.get(id);
  }

  /** Fallo ANTES de reservar el envío: si otra petición ya lo reservó (o envió), no se toca la campaña. */
  private async fail(id: number, message: string, actor = SYSTEM) {
    if (await this.d.store.failUnclaimed(id, message)) await this.d.store.event(id, "failed", message, actor);
  }

  /**
   * Quita de la lista de Brevo de la campaña a quien ya no está en la audiencia (retiró el consentimiento, se dio de
   * baja o ya no tiene la etiqueta) y devuelve cuántos quedan. Se hace antes de reservar el envío y, en las
   * programadas, en cada actualización hasta que Brevo la envía.
   */
  private async reconcile(client: BrevoMarketingClient, c: Campaign, actor: string): Promise<number> {
    const listId = c.brevoListId!;
    const active = await this.d.store.activeRecipients(c.id, listId);
    const aud = planAudience(await this.d.store.audience(c.tagIds, c.tagMode), await this.d.store.withdrawnEmails());
    const ok = new Set(aud.recipients.map((r) => `${r.clientId}:${r.email}`));
    const gone = active.filter((r) => !ok.has(`${r.clientId}:${r.email}`));
    for (const batch of chunk(gone, REMOVE_BATCH)) {
      try {
        await client.removeFromList(listId, batch.map((b) => b.email));
      } catch (e) {
        // 400: ya no estaban en la lista; cualquier otro error se propaga (no se envía sin haberlos sacado)
        if (!(e instanceof BrevoApiError) || e.status !== 400) throw e;
      }
      await this.d.store.markRemoved(c.id, listId, batch.map((b) => b.clientId));
    }
    if (gone.length) await this.d.store.event(c.id, "removed", `${gone.length} sacados de la lista de la campaña por no tener ya el consentimiento`, actor);
    return active.length - gone.length;
  }

  /**
   * Una retirada de consentimiento (enlace de baja, CRM o baja leída de Brevo): saca ese correo YA de las listas de
   * las campañas que aún no se han enviado («preparing» o «scheduled») y, si se pide, lo da de baja de los correos de
   * la cuenta de Brevo. Si Brevo falla, la comprobación antes del envío y la del job lo vuelven a intentar.
   */
  async onWithdrawn(clientId: number, o: { blacklist: boolean }): Promise<{ removed: number }> {
    const pending = await this.d.store.pendingListsOf(clientId);
    if (!pending.length) return { removed: 0 };
    if (!(await this.d.credentials.apiKey())) return { removed: 0 };
    const client = await this.client(Math.min(MAX_CALLS_PER_STEP, pending.length + 1));
    let removed = 0;
    const byEmail = new Map<string, typeof pending>();
    for (const x of pending) byEmail.set(x.email, [...(byEmail.get(x.email) ?? []), x]);
    for (const [email, rows] of Array.from(byEmail.entries())) {
      try {
        await client.unlinkContact(email, Array.from(new Set(rows.map((r) => r.listId))), o.blacklist);
      } catch (e) {
        // 404: el contacto ya no existe en Brevo (no recibirá nada); cualquier otro fallo lo repite la comprobación previa
        if (!(e instanceof BrevoApiError) || e.status !== 404) continue;
      }
      for (const r of rows) {
        await this.d.store.markRemoved(r.campaignId, r.listId, [clientId]);
        await this.d.store.event(r.campaignId, "removed", "Sacado de la lista de la campaña al retirar el consentimiento", SYSTEM);
        removed++;
      }
    }
    return { removed };
  }

  /**
   * Una campaña «preparing»: si la importación terminó, crea o actualiza la campaña de Brevo con su lista, reserva el
   * envío y lo pide (ya o programado). Si la importación sigue, no hace nada. Idempotente.
   */
  async advance(id: number, actor = SYSTEM, signal?: AbortSignal) {
    let c = await this.must(id);
    if (c.status !== "preparing" || c.sendClaimedAt) return c;
    if (!c.brevoListId) {
      // La preparación se cortó a mitad (el proceso se reinició): pasado el plazo, fallida con su motivo
      if (c.launchedAt && new Date(c.launchedAt).getTime() < this.now().getTime() - STUCK_PREPARING_MS) {
        await this.fail(id, "La preparación del envío no terminó (se interrumpió antes de crear la lista en Brevo): vuelve a enviarla", actor);
        return this.d.store.get(id);
      }
      return c;
    }
    const client = await this.client(MAX_CALLS_PER_STEP, signal);
    let brevoId: number;
    try {
      const statuses: string[] = [];
      for (const p of c.processIds) statuses.push((await client.process(p)).status);
      const st = importsState(statuses);
      if (st === "failed") {
        await this.fail(id, "Brevo no pudo importar los contactos de la campaña", actor);
        return this.d.store.get(id);
      }
      if (st === "wait") return c;
      // Otra petición pudo reservar el envío mientras tanto: no se toca nada
      c = await this.must(id);
      if (c.status !== "preparing" || c.sendClaimedAt) return c;
      // Quien retiró el consentimiento desde la preparación sale de la lista antes de enviar
      if ((await this.reconcile(client, c, actor)) === 0) {
        await this.fail(id, "Nadie de la lista conserva el consentimiento de marketing: no se envía", actor);
        return this.d.store.get(id);
      }
      c = await this.must(id);
      brevoId = await this.upsertBrevo(client, c, "send");
    } catch (e) {
      if (!(e instanceof BrevoApiError || e instanceof BrevoBudgetExceeded)) throw e;
      // Antes de reservar el envío: no se ha pedido nada a Brevo, se puede volver a intentar
      await this.fail(id, `Brevo no aceptó la campaña (${e.message}${e instanceof BrevoApiError && e.code ? `: ${e.code}` : ""})`, actor);
      return this.d.store.get(id);
    }
    if (!(await this.d.store.claimSend(id))) return this.d.store.get(id);
    brevoId = (await this.must(id)).brevoCampaignId ?? brevoId;
    const at = c.scheduledAt ? new Date(c.scheduledAt) : null;
    const sendNow = !at || at.getTime() <= this.now().getTime() + 60_000;
    try {
      if (sendNow) await client.sendEmailCampaignNow(brevoId);
      else await client.scheduleEmailCampaign(brevoId, at!.toISOString());
    } catch (e) {
      if (!(e instanceof BrevoApiError || e instanceof BrevoBudgetExceeded)) throw e;
      // Con el envío ya reservado por esta petición: fallida y bloqueada (Brevo pudo haberlo recibido)
      const msg = `Brevo no confirmó el ${sendNow ? "envío" : "programa"} (${e.message}). Compruébalo en Brevo antes de duplicar la campaña`;
      await this.d.store.setStatus(id, "failed", { errorMessage: msg });
      await this.d.store.event(id, "failed", msg, actor);
      return this.d.store.get(id);
    }
    if (sendNow) {
      await this.d.store.setStatus(id, "sent", { sentAt: this.now(), errorMessage: null });
      await this.d.store.event(id, "sent", `Enviada a Brevo (${c.recipients} destinatarios)`, actor);
    } else {
      await this.d.store.setStatus(id, "scheduled", { errorMessage: null });
      await this.d.store.event(id, "scheduled", `Programada en Brevo para ${at!.toISOString()}`, actor);
    }
    return this.d.store.get(id);
  }

  /**
   * Estadísticas de Brevo (y avance de una preparada o programada). Con la campaña enviada, lee también las bajas de su
   * lista en Brevo y retira el consentimiento en el CRM de esos clientes.
   */
  async refresh(id: number, actor = SYSTEM, signal?: AbortSignal) {
    let c = await this.must(id);
    try {
      if (c.status === "preparing") return await this.advance(id, actor, signal);
      if (!c.brevoCampaignId || (c.status !== "scheduled" && c.status !== "sent")) return c;
      const client = await this.client(MAX_CALLS_PER_STEP, signal);
      const r = await client.emailCampaign(c.brevoCampaignId);
      const s = r.stats;
      await this.d.store.saveStats(
        id,
        s ? { sent: s.sent, delivered: s.delivered, opens: s.uniqueViews, clicks: s.uniqueClicks, unsubscribed: s.unsubscriptions, bounces: s.hardBounces + s.softBounces, complaints: s.complaints } : null,
        r.status,
      );
      if (c.status === "scheduled" && r.status === "sent") {
        await this.d.store.setStatus(id, "sent", { sentAt: r.sentDate ? new Date(r.sentDate) : this.now() });
        await this.d.store.event(id, "sent", "Enviada por Brevo a la hora programada", actor);
      } else if (c.status === "scheduled" && (r.status === "suspended" || r.status === "cancelled" || r.status === "cancelling")) {
        await this.d.store.event(id, "brevo", `En Brevo figura como «${r.status}»`, actor);
      }
      c = (await this.d.store.get(id))!;
      // Programada: hasta que Brevo la envíe, quien retire el consentimiento sale de su lista
      if (c.status === "scheduled" && c.brevoListId) await this.reconcile(client, c, actor);
      if (c.status === "sent" && c.brevoListId) await this.readUnsubscribes(client, c, actor);
    } catch (e) {
      return this.wrap(e);
    }
    return this.d.store.get(id);
  }

  private async readUnsubscribes(client: BrevoMarketingClient, c: Campaign, actor: string) {
    const byEmail = await this.d.store.recipientsByEmail(c.id, c.brevoListId!);
    let n = 0;
    for (let offset = 0; ; ) {
      const page = await client.listContacts(c.brevoListId!, offset);
      for (const x of page.contacts) {
        if (!x.blacklisted && !x.unsubscribedFromList) continue;
        for (const clientId of byEmail.get(x.email.trim().toLowerCase()) ?? [])
          if (await this.d.consents.withdrawOnce(clientId, "brevo_unsubscribe", `Baja en la campaña #${c.id}`, "system:brevo")) {
            n++;
            await this.onWithdrawn(clientId, { blacklist: false }).catch(() => undefined);
          }
      }
      offset += page.contacts.length;
      if (!page.contacts.length || offset >= page.count || page.contacts.length < LIST_PAGE) break;
    }
    if (n) await this.d.store.event(c.id, "unsubscribed", `${n} bajas leídas de Brevo: consentimiento retirado en el CRM`, actor);
  }

  /** Job: avanza las preparadas y actualiza estadísticas (cada hora) de la empresa en curso, con licencia y clave. */
  async tick(signal?: AbortSignal): Promise<{ skipped?: string; checked?: number }> {
    if (this.d.licensed && !(await this.d.licensed())) return { skipped: "not_licensed" };
    if (!(await this.d.credentials.apiKey())) return { skipped: "not_configured" };
    const ids = await this.d.store.due(10, STATS_EVERY_MS);
    for (const id of ids) {
      if (signal?.aborted) break;
      try {
        await this.refresh(id, SYSTEM, signal);
      } catch (e) {
        if (e instanceof CampaignError && e.code === "rejected") return { skipped: "rejected", checked: ids.indexOf(id) };
        // Una campaña con Brevo caído no frena las demás; se reintenta en la siguiente pasada
      }
    }
    return { checked: ids.length };
  }
}
