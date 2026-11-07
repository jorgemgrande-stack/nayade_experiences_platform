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

export class BrevoMarketingClient {
  private calls = 0;
  constructor(
    private apiKey: string,
    private o: { fetch?: FetchLike; maxCalls: number; signal?: AbortSignal },
  ) {}

  get callsMade() {
    return this.calls;
  }

  private async req<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
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
      if (!res.ok) throw new BrevoApiError(res.status, res.status === 401 || res.status === 403 ? "Brevo rechaza la clave API" : `Brevo respondió ${res.status}`);
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
}
