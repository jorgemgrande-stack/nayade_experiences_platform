/**
 * Cliente de la API XML de Veturis con las credenciales PROPIAS de la empresa (bóveda, proveedor `veturis`): nunca
 * variables de entorno ni cuentas de otra empresa. Un POST form-encoded con `xmlRQ` y las cuatro credenciales fuera del
 * XML, como exige el manual.
 *
 *  - Entorno de pruebas por defecto; producción solo si la empresa lo elige en su integración.
 *  - `fetch` inyectable: las pruebas nunca llaman a Veturis.
 *  - Cada llamada se mide por empresa (`ext.veturis.calls|errors|ms`) y cuenta contra un tope por ejecución.
 *  - Nunca registra credenciales ni cuerpos; los errores llevan solo el código HTTP o el mensaje de Veturis.
 *  - Un 502/504 o un corte de red en una CONFIRMACIÓN no significa que no se hiciera (manual): se informa como dudoso.
 */
import { meterExternalCall } from "../../_core/externalMetering";
import { VeturisApiError, buildAdditionalInformationXml, buildBookingConfirmationXml, buildSearchXml, generalError, mapAdditionalInformation, mapBookingConfirmation, mapSearch, type BookingParams, type BookingResult, type OfferDetail, type SearchParams, type SearchResult } from "./protocol";
import { XmlParseError, parseXml } from "./xml";

export const VETURIS_URLS = { test: "http://testxmlservices.veturis.com/xmlWebServices.php", live: "https://xmlservices.veturis.com/xmlWebServices.php" } as const;
export type VeturisEnvironment = keyof typeof VETURIS_URLS;

export interface VeturisCredentials {
  user: string;
  password: string;
  agencyUser: string;
  agencyPassword: string;
  environment: VeturisEnvironment;
}

export type VeturisFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class VeturisNetworkError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
  ) {
    super(message);
    this.name = "VeturisNetworkError";
  }
  get rejected() {
    return this.status === 401 || this.status === 403;
  }
}
export class VeturisBudgetExceeded extends Error {
  constructor(public readonly limit: number) {
    super(`Tope de ${limit} llamadas a Veturis por ejecución alcanzado`);
    this.name = "VeturisBudgetExceeded";
  }
}

const TIMEOUT_MS = 20_000;
const OPERATION: Record<string, string> = { SearchAvailability: "busqueda", AdditionalInformation: "detalle", BookingConfirmation: "reserva" };

export class VeturisClient {
  private calls = 0;
  constructor(
    private creds: VeturisCredentials,
    private o: { fetch?: VeturisFetch; maxCalls: number; signal?: AbortSignal },
  ) {}

  get callsMade() {
    return this.calls;
  }
  get environment() {
    return this.creds.environment;
  }

  private async post(xmlRQ: string): Promise<Record<string, unknown>> {
    if (this.calls >= this.o.maxCalls) throw new VeturisBudgetExceeded(this.o.maxCalls);
    this.calls++;
    const op = OPERATION[/<([A-Za-z]+)RQ\b/.exec(xmlRQ)?.[1] ?? ""] ?? "otra";
    const body = new URLSearchParams({ xmlRQ, user: this.creds.user, password: this.creds.password, agencyUser: this.creds.agencyUser, agencyPassword: this.creds.agencyPassword }).toString();
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const onAbort = () => ctl.abort();
    this.o.signal?.addEventListener("abort", onAbort);
    const t0 = Date.now();
    let status: number | null = null;
    try {
      const f = this.o.fetch ?? (globalThis.fetch as unknown as VeturisFetch);
      const res = await f(VETURIS_URLS[this.creds.environment], { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: ctl.signal });
      status = res.status;
      if (!res.ok) throw new VeturisNetworkError(res.status === 401 || res.status === 403 ? "Veturis rechaza las credenciales" : `Veturis respondió HTTP ${res.status}`, res.status);
      const parsed = parseXml(await res.text());
      const err = generalError(parsed);
      if (err) {
        status = 400;
        throw err;
      }
      return parsed;
    } catch (e) {
      if (e instanceof VeturisNetworkError || e instanceof VeturisApiError) throw e;
      if (e instanceof XmlParseError) throw new VeturisApiError(e.message);
      throw new VeturisNetworkError("No se pudo contactar con Veturis", null);
    } finally {
      clearTimeout(t);
      this.o.signal?.removeEventListener("abort", onAbort);
      meterExternalCall("veturis", op, Date.now() - t0, status);
    }
  }

  async search(p: SearchParams): Promise<SearchResult> {
    return mapSearch(await this.post(buildSearchXml(p)));
  }
  async detail(searchObj: string, offerToken: string): Promise<OfferDetail> {
    return mapAdditionalInformation(await this.post(buildAdditionalInformationXml(searchObj, offerToken)));
  }
  async book(p: BookingParams): Promise<BookingResult> {
    return mapBookingConfirmation(await this.post(buildBookingConfirmationXml(p)));
  }
}
