/**
 * Cliente de la API de Brevo para el marketing de la empresa (cuenta y clave PROPIAS, de la bóveda `brevo_marketing`).
 * Es independiente del Brevo del correo de la plataforma (server/mail), que no se usa ni se toca aquí.
 *
 *  - `fetch` inyectable: las pruebas nunca llaman a Brevo.
 *  - Cada llamada se mide por empresa en el Resource Manager (`ext.brevo.calls|errors|ms`) y cuenta contra un TOPE por
 *    ejecución (`maxCalls`): al agotarlo se lanza `BrevoBudgetExceeded` y la ejecución se cierra como parcial.
 *  - Nunca registra la clave ni el cuerpo de las respuestas; los errores llevan solo el código HTTP.
 */
import { endpointOf, meterExternalCall } from "../_core/externalMetering";

export const BREVO_API = "https://api.brevo.com/v3";
/** Contactos por llamada de importación y de baja de la lista (límites documentados de Brevo, con margen). */
export const IMPORT_BATCH = 500;
export const REMOVE_BATCH = 150;
export const LIST_PAGE = 500;

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class BrevoApiError extends Error {
  constructor(
    public status: number | null,
    message: string,
    /** Código de error de Brevo (`code` del cuerpo, p. ej. «invalid_parameter») o la causa de una prueba rechazada; nunca datos. */
    public code: string | null = null,
  ) {
    super(message);
    this.name = "BrevoApiError";
  }
  /** La clave ya no vale (revocada o cambiada): no tiene sentido reintentar. */
  get rejected() {
    return this.status === 401 || this.status === 403;
  }
}
export class BrevoBudgetExceeded extends Error {
  constructor(public limit: number) {
    super(`Tope de ${limit} llamadas a Brevo por ejecución alcanzado`);
    this.name = "BrevoBudgetExceeded";
  }
}

export interface BrevoList {
  id: number;
  name: string;
  subscribers: number | null;
}
export interface BrevoListContact {
  email: string;
  /** Baja global en Brevo (el contacto no quiere correos de la cuenta). */
  blacklisted: boolean;
  /** Se dio de baja de esta lista. */
  unsubscribedFromList: boolean;
}

const TIMEOUT_MS = 15_000;

/** Solo el código (corto) del cuerpo de error de Brevo; en una prueba rechazada, la causa por la lista que trae. */
function errorCodeOf(b: unknown): string | null {
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  for (const k of ["unexistingEmails", "blackListedEmails", "withoutListEmails"]) if (Array.isArray(o[k]) && (o[k] as unknown[]).length) return k;
  return typeof o.code === "string" ? o.code.slice(0, 60) : null;
}

export interface BrevoSender {
  id: number;
  name: string;
  email: string;
  active: boolean;
}
export type BrevoCampaignStatus = "draft" | "sent" | "archive" | "queued" | "suspended" | "in_process" | "in_review" | "cancelling" | "cancelled";
export interface BrevoCampaignStats {
  sent: number;
  delivered: number;
  uniqueViews: number;
  uniqueClicks: number;
  unsubscriptions: number;
  hardBounces: number;
  softBounces: number;
  complaints: number;
}
/** Campaña de correo de Brevo (POST/PUT /emailCampaigns): contenido HTML, remitente por id y la lista de la campaña. */
export interface BrevoCampaignInput {
  name: string;
  subject: string;
  previewText?: string | null;
  sender: { id: number };
  replyTo?: string | null;
  htmlContent: string;
  listIds?: number[];
}

export class BrevoMarketingClient {
  private calls = 0;
  constructor(
    private apiKey: string,
    private o: { fetch?: FetchLike; maxCalls: number; signal?: AbortSignal },
  ) {}

  get callsMade() {
    return this.calls;
  }

  private async req<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
    if (this.calls >= this.o.maxCalls) throw new BrevoBudgetExceeded(this.o.maxCalls);
    this.calls++;
    const url = `${BREVO_API}${path}`;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const onAbort = () => ctl.abort();
    this.o.signal?.addEventListener("abort", onAbort);
    const f = this.o.fetch ?? (globalThis.fetch as unknown as FetchLike);
    const t0 = Date.now();
    let status: number | null = null;
    try {
      const res = await f(url, {
        method,
        headers: { "api-key": this.apiKey, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: ctl.signal,
      });
      status = res.status;
      if (!res.ok) throw new BrevoApiError(res.status, res.status === 401 || res.status === 403 ? "Brevo rechaza la clave API" : `Brevo respondió ${res.status}`, errorCodeOf(await res.json().catch(() => null)));
      return (res.status === 204 ? {} : await res.json().catch(() => ({}))) as T;
    } catch (e) {
      if (e instanceof BrevoApiError) throw e;
      throw new BrevoApiError(null, "No se pudo contactar con Brevo");
    } finally {
      clearTimeout(t);
      this.o.signal?.removeEventListener("abort", onAbort);
      meterExternalCall("brevo", endpointOf(url), Date.now() - t0, status);
    }
  }

  /** Comprobación de solo lectura. */
  async account(): Promise<{ email: string | null; companyName: string | null }> {
    const r = await this.req<{ email?: string; companyName?: string }>("GET", "/account");
    return { email: r.email ?? null, companyName: r.companyName ?? null };
  }

  async lists(limit = 50, offset = 0): Promise<{ lists: BrevoList[]; count: number }> {
    const r = await this.req<{ lists?: Array<{ id: number; name: string; totalSubscribers?: number }>; count?: number }>("GET", `/contacts/lists?limit=${limit}&offset=${offset}&sort=desc`);
    return { lists: (r.lists ?? []).map((l) => ({ id: Number(l.id), name: String(l.name), subscribers: l.totalSubscribers ?? null })), count: Number(r.count ?? 0) };
  }

  async list(listId: number): Promise<BrevoList> {
    const r = await this.req<{ id: number; name: string; totalSubscribers?: number }>("GET", `/contacts/lists/${listId}`);
    return { id: Number(r.id), name: String(r.name), subscribers: r.totalSubscribers ?? null };
  }

  /** Una página de contactos de la lista, con sus bajas. */
  async listContacts(listId: number, offset: number): Promise<{ contacts: BrevoListContact[]; count: number }> {
    const r = await this.req<{ contacts?: Array<{ email: string; emailBlacklisted?: boolean; listUnsubscribed?: number[] }>; count?: number }>(
      "GET",
      `/contacts/lists/${listId}/contacts?limit=${LIST_PAGE}&offset=${offset}`,
    );
    return {
      contacts: (r.contacts ?? []).map((c) => ({ email: String(c.email), blacklisted: !!c.emailBlacklisted, unsubscribedFromList: (c.listUnsubscribed ?? []).includes(listId) })),
      count: Number(r.count ?? 0),
    };
  }

  /** Alta o actualización en la lista (importación asíncrona de Brevo; no cambia las bajas existentes). */
  async importToList(listId: number, contacts: Array<{ email: string; firstName: string | null }>): Promise<void> {
    if (!contacts.length) return;
    await this.req("POST", "/contacts/import", {
      jsonBody: contacts.map((c) => ({ email: c.email, ...(c.firstName ? { attributes: { FIRSTNAME: c.firstName } } : {}) })),
      listIds: [listId],
      updateExistingContacts: true,
      emptyContactsAttributes: false,
    });
  }

  async removeFromList(listId: number, emails: string[]): Promise<void> {
    if (!emails.length) return;
    await this.req("POST", `/contacts/lists/${listId}/contacts/remove`, { emails });
  }

  // ── Campañas de correo (Elephant Campaigns) ─────────────────────────────────────

  /** Remitentes de la cuenta (GET /senders); solo los activos (verificados) sirven para una campaña. */
  async senders(): Promise<BrevoSender[]> {
    const r = await this.req<{ senders?: Array<{ id: number; name?: string; email: string; active?: boolean }> }>("GET", "/senders");
    return (r.senders ?? []).map((x) => ({ id: Number(x.id), name: String(x.name ?? ""), email: String(x.email), active: !!x.active }));
  }

  async folders(): Promise<Array<{ id: number; name: string }>> {
    const r = await this.req<{ folders?: Array<{ id: number; name: string }> }>("GET", "/contacts/folders?limit=50&offset=0&sort=desc");
    return (r.folders ?? []).map((f) => ({ id: Number(f.id), name: String(f.name) }));
  }

  async createFolder(name: string): Promise<number> {
    return Number((await this.req<{ id: number }>("POST", "/contacts/folders", { name })).id);
  }

  async createList(name: string, folderId: number): Promise<number> {
    return Number((await this.req<{ id: number }>("POST", "/contacts/lists", { name, folderId })).id);
  }

  /** Atributo de contacto de texto (POST /contacts/attributes/normal/{nombre}); si ya existe, Brevo responde 400. */
  async createTextAttribute(name: string): Promise<void> {
    await this.req("POST", `/contacts/attributes/normal/${encodeURIComponent(name)}`, { type: "text" });
  }

  /** Importación asíncrona a una lista con atributos; devuelve el proceso de Brevo para comprobar cuándo termina. */
  async importContacts(listId: number, contacts: Array<{ email: string; attributes: Record<string, string> }>): Promise<number | null> {
    if (!contacts.length) return null;
    const r = await this.req<{ processId?: number }>("POST", "/contacts/import", {
      jsonBody: contacts.map((c) => ({ email: c.email, attributes: c.attributes })),
      listIds: [listId],
      updateExistingContacts: true,
      emptyContactsAttributes: false,
      disableNotification: true,
    });
    return r.processId == null ? null : Number(r.processId);
  }

  async process(processId: number): Promise<{ status: string }> {
    const r = await this.req<{ status?: string }>("GET", `/processes/${processId}`);
    return { status: String(r.status ?? "") };
  }

  private campaignBody(c: BrevoCampaignInput) {
    return {
      name: c.name,
      subject: c.subject,
      sender: c.sender,
      htmlContent: c.htmlContent,
      ...(c.previewText ? { previewText: c.previewText } : {}),
      ...(c.replyTo ? { replyTo: c.replyTo } : {}),
      ...(c.listIds?.length ? { recipients: { listIds: c.listIds } } : {}),
    };
  }

  /** Crea la campaña SIEMPRE como borrador (sin `scheduledAt`): enviar o programar es otra llamada, reservada antes. */
  async createEmailCampaign(c: BrevoCampaignInput): Promise<number> {
    return Number((await this.req<{ id: number }>("POST", "/emailCampaigns", this.campaignBody(c))).id);
  }

  async updateEmailCampaign(id: number, c: BrevoCampaignInput): Promise<void> {
    await this.req("PUT", `/emailCampaigns/${id}`, this.campaignBody(c));
  }

  /** Programa una campaña ya creada (PUT /emailCampaigns/{id} con `scheduledAt`, ISO con zona). */
  async scheduleEmailCampaign(id: number, scheduledAt: string): Promise<void> {
    await this.req("PUT", `/emailCampaigns/${id}`, { scheduledAt });
  }

  async sendEmailCampaignNow(id: number): Promise<void> {
    await this.req("POST", `/emailCampaigns/${id}/sendNow`);
  }

  async sendTestEmail(id: number, emailTo: string[]): Promise<void> {
    await this.req("POST", `/emailCampaigns/${id}/sendTest`, { emailTo });
  }

  async emailCampaign(id: number): Promise<{ status: BrevoCampaignStatus; sentDate: string | null; stats: BrevoCampaignStats | null }> {
    const r = await this.req<{ status?: string; sentDate?: string; statistics?: { globalStats?: Record<string, number | null> } }>("GET", `/emailCampaigns/${id}?statistics=globalStats&excludeHtmlContent=true`);
    const g = r.statistics?.globalStats;
    const n = (k: string) => Number(g?.[k] ?? 0) || 0;
    return {
      status: String(r.status ?? "draft") as BrevoCampaignStatus,
      sentDate: r.sentDate ?? null,
      stats: g ? { sent: n("sent"), delivered: n("delivered"), uniqueViews: n("uniqueViews"), uniqueClicks: n("uniqueClicks"), unsubscriptions: n("unsubscriptions"), hardBounces: n("hardBounces"), softBounces: n("softBounces"), complaints: n("complaints") } : null,
    };
  }
}
