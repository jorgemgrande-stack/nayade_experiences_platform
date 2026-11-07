/**
 * Protocolo XML de Veturis (Veturis XML API Reference Manual V4.x), portado del origen sin acoplamientos: construcción
 * de las peticiones (búsqueda, detalle vinculante y confirmación) y lectura de sus respuestas a un modelo normalizado.
 *
 * Precios: en la búsqueda `<PriceAgency>` es el NETO de la agencia y `<Price>` el PVP recomendado (u obligatorio con
 * mandatory="1"); en el detalle, `<PriceAgency>` es el neto y, si el precio cambió desde la búsqueda, `<PriceChange>`
 * trae el neto nuevo que hay que aceptar. Importes en euros con decimales en el XML; aquí se devuelven en céntimos.
 * Una reserva solo es válida con ConfirmationStatus=1 y un BookingID (regla del manual).
 */
import { asArray, attrValue, obj, textNumber, textValue } from "./xml";

export class VeturisApiError extends Error {
  constructor(
    message: string,
    public readonly errorType?: string,
  ) {
    super(message);
    this.name = "VeturisApiError";
  }
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const cents = (euros: number) => Math.round(euros * 100);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HOTEL_ID = /^\d{1,12}$/;

export interface RoomRequest {
  adults: number;
  childrenAges: number[];
}

/**
 * Agrupa habitaciones en bloques <Occupancy> TODO o NADA (manual V4.1 y soporte de Veturis): solo un bloque Rooms="N"
 * si todas las habitaciones comparten adultos y número de niños (con todas las edades concatenadas); si una difiere,
 * un bloque Rooms="1" por habitación.
 */
export function groupOccupancies(rooms: RoomRequest[]) {
  if (!rooms.length) return [];
  const key = (r: RoomRequest) => `${r.adults}-${r.childrenAges.length}`;
  if (!rooms.every((r) => key(r) === key(rooms[0]))) return rooms.map((r) => ({ rooms: 1, adults: r.adults, children: r.childrenAges.length, childrenAges: [...r.childrenAges] }));
  return [{ rooms: rooms.length, adults: rooms[0].adults, children: rooms[0].childrenAges.length, childrenAges: rooms.flatMap((r) => r.childrenAges) }];
}

export interface SearchParams {
  hotelIds: string[];
  checkIn: string;
  checkOut: string;
  rooms: RoomRequest[];
  countryCode?: string | null;
}

export function checkSearch(p: SearchParams): string | null {
  if (!p.hotelIds.length || p.hotelIds.length > 100 || p.hotelIds.some((h) => !HOTEL_ID.test(h))) return "Indica entre 1 y 100 hoteles de Veturis (identificadores numéricos)";
  if (!DAY.test(p.checkIn) || !DAY.test(p.checkOut) || p.checkOut <= p.checkIn) return "Fechas de entrada y salida no válidas";
  if (!p.rooms.length || p.rooms.length > 9) return "Indica entre 1 y 9 habitaciones";
  for (const r of p.rooms) {
    if (!Number.isInteger(r.adults) || r.adults < 1 || r.adults > 9) return "Cada habitación lleva entre 1 y 9 adultos";
    if (r.childrenAges.length > 6 || r.childrenAges.some((a) => !Number.isInteger(a) || a < 0 || a > 17)) return "Edades de los niños no válidas (0 a 17)";
  }
  return null;
}

export function buildSearchXml(p: SearchParams, language = "SPA"): string {
  const occ = groupOccupancies(p.rooms)
    .map((o) => `<Occupancy><Rooms>${o.rooms}</Rooms><Adults>${o.adults}</Adults><Children>${o.children}</Children>${o.childrenAges.length ? `<Ages>${o.childrenAges.map((a) => `<Age>${a}</Age>`).join("")}</Ages>` : ""}</Occupancy>`)
    .join("");
  return `${XML_HEADER}
<SearchAvailabilityRQ version="2.0" language="${language}">
<Request>
<HotelList>${p.hotelIds.join("/")}</HotelList>
<Check_in_date>${p.checkIn}</Check_in_date>
<Check_out_date>${p.checkOut}</Check_out_date>
${occ}
${p.countryCode && /^[A-Z]{2,3}$/.test(p.countryCode) ? `<CountryCode>${p.countryCode}</CountryCode>` : ""}
</Request>
</SearchAvailabilityRQ>`;
}

export function buildAdditionalInformationXml(searchObj: string, offerToken: string, language = "SPA"): string {
  return `${XML_HEADER}
<AdditionalInformationRQ version="3.8" language="${language}">
<Request>
<obj>${esc(searchObj)}</obj>
<DATOS>${esc(offerToken)}</DATOS>
</Request>
</AdditionalInformationRQ>`;
}

export interface BookingParams {
  searchObj: string;
  offerToken: string;
  client: { name: string; surnames: string; email: string | null; phone: string | null };
  reference: string;
  /** Neto aceptado (céntimos) si cambió en la revalidación. */
  priceChangeCents?: number | null;
}

export function buildBookingConfirmationXml(p: BookingParams, language = "SPA"): string {
  return `${XML_HEADER}
<BookingConfirmationRQ version="2.0" language="${language}">
<Request>
<obj>${esc(p.searchObj)}</obj>
<DATOS>${esc(p.offerToken)}</DATOS>
<client>
<name>${esc(p.client.name)}</name>
<surnames>${esc(p.client.surnames)}</surnames>
<documentNumber></documentNumber>
<country></country>
<region></region>
<EMail>${p.client.email ? esc(p.client.email) : ""}</EMail>
<PostCode></PostCode>
<Phone>${p.client.phone ? esc(p.client.phone) : ""}</Phone>
</client>
<payment>
<Type>SL</Type>
</payment>
<Reference>${esc(p.reference.slice(0, 50))}</Reference>
${p.priceChangeCents != null ? `<PriceChange>${(p.priceChangeCents / 100).toFixed(2)}</PriceChange>` : ""}
</Request>
</BookingConfirmationRQ>`;
}

/** «General Error Response»: <ResponseDetails><Status>KO</Status><Error>…</Error></ResponseDetails>. */
export function generalError(parsed: Record<string, unknown>): VeturisApiError | null {
  const d = obj(parsed.ResponseDetails);
  if (!d || textValue(d.Status) !== "KO") return null;
  const [first] = asArray(d.Error);
  return new VeturisApiError(textValue(first).trim() || "Error desconocido de Veturis");
}

// ── Búsqueda ────────────────────────────────────────────────────────────────────

export interface Offer {
  offerToken: string;
  roomName: string;
  boardId: string;
  currency: string;
  /** Neto de la agencia (céntimos). */
  netCents: number;
  /** PVP recomendado u obligatorio de Veturis (céntimos), solo informativo: el PVP lo calcula Travel Net. */
  listCents: number;
  priceIsMandatory: boolean;
  refundable: "yes" | "no" | "unknown";
  cancellationFrom: string | null;
  cancellationCents: number | null;
  availableRooms: number | null;
}
export interface HotelAvailability {
  hotelId: string;
  name: string;
  offers: Offer[];
}
export interface SearchResult {
  searchObj: string;
  available: number;
  hotels: HotelAvailability[];
}

export function mapSearch(parsed: Record<string, unknown>): SearchResult {
  const response = obj(obj(parsed.resultadosRS)?.Response);
  if (!response) return { searchObj: "", available: 0, hotels: [] };
  const hotels: HotelAvailability[] = [];
  for (const raw of asArray(obj(response.Hotels)?.Hotel)) {
    const h = obj(raw);
    const details = obj(h?.HotelDetails);
    if (!h || !details) continue;
    const offers: Offer[] = [];
    for (const r of asArray(obj(h.Accommodations)?.Room)) {
      const room = obj(r);
      const type = obj(room?.RoomType);
      if (!room || !type) continue;
      for (const b of asArray(room.Board)) {
        const board = obj(b);
        if (!board) continue;
        const agency = textNumber(board.PriceAgency);
        const list = textNumber(board.Price);
        const refundable = textValue(board.Refundable);
        const cancel = obj(board.Cancellation);
        const token = textValue(board.DATOS);
        if (!token) continue;
        offers.push({
          offerToken: token,
          roomName: textValue(type.Name),
          boardId: textValue(obj(board.Board_type)?.ID),
          currency: textValue(board.Currency) || "EUR",
          netCents: cents(agency > 0 ? agency : list),
          listCents: cents(list),
          priceIsMandatory: attrValue(board.Price, "mandatory") === "1",
          refundable: refundable === "Y" ? "yes" : refundable === "N" ? "no" : "unknown",
          cancellationFrom: cancel ? textValue(cancel.From) || null : null,
          cancellationCents: cancel ? cents(textNumber(cancel.Price)) : null,
          availableRooms: type.NumberRooms != null ? textNumber(type.NumberRooms) : null,
        });
      }
    }
    hotels.push({ hotelId: textValue(details.ID), name: textValue(details.Name), offers });
  }
  return { searchObj: textValue(response.obj), available: textNumber(response.AvailablesHotel), hotels };
}

// ── Detalle vinculante (revalidación) ────────────────────────────────────────────

export interface OfferDetail {
  hotelId: string;
  hotelName: string;
  roomName: string;
  boardName: string;
  /** Neto vinculante (céntimos): PriceChange si lo hay; si no, PriceAgency. */
  netCents: number;
  priceChanged: boolean;
  cancellation: Array<{ from: string; cents: number }>;
  essentialInformation: string[];
}

export function mapAdditionalInformation(parsed: Record<string, unknown>): OfferDetail {
  const root = obj(parsed.AdditionalInformationRS);
  if (!root) throw new VeturisApiError("Respuesta de detalle de Veturis sin la raíz esperada");
  const info = obj(root.AdditionalInformation);
  const search = obj(root.SearchAvailabilityDetails);
  const hotel = obj(root.HotelDetails);
  const priceChangeText = textValue(root.PriceChange);
  const priceChange = priceChangeText ? Number(priceChangeText.replace(",", ".")) : NaN;
  // PriceAgency de la raíz, o el de las habitaciones si la raíz no lo trae
  const rooms = asArray(obj(info?.Rooms)?.Room).map(obj);
  const agency = textNumber(root.PriceAgency) || rooms.reduce((a, r) => a + textNumber(r?.PriceAgency), 0);
  const pvp = textNumber(root.PVP);
  const changed = Number.isFinite(priceChange) && priceChange > 0;
  const net = changed ? priceChange : agency > 0 ? agency : pvp;
  if (!(net > 0)) throw new VeturisApiError("Veturis no devolvió un precio para la oferta: vuelve a buscar");
  return {
    hotelId: textValue(hotel?.ID),
    hotelName: textValue(hotel?.Name),
    roomName: textValue(search?.RoomName),
    boardName: textValue(search?.BoardName),
    netCents: cents(net),
    priceChanged: changed,
    cancellation: asArray(obj(info?.Cancellation)?.Period).map((p) => ({ from: textValue(obj(p)?.From), cents: cents(textNumber(obj(p)?.PriceAgency) || textNumber(obj(p)?.Amount)) })),
    essentialInformation: asArray(obj(info?.EssentialInformation)?.Information)
      .map((i) => textValue(obj(i)?.Description))
      .filter(Boolean),
  };
}

// ── Confirmación ────────────────────────────────────────────────────────────────

export interface BookingResult {
  status: "confirmed" | "pending" | "failed";
  bookingId: string | null;
  securityCode: string | null;
  locator: string | null;
  errors: string[];
}

export function mapBookingConfirmation(parsed: Record<string, unknown>): BookingResult {
  const root = obj(parsed.BookingConfirmationRS);
  if (!root) throw new VeturisApiError("Respuesta de confirmación de Veturis sin la raíz esperada");
  const reservation = textValue(root.ReservationStatus) === "1";
  const payment = textValue(root.PaymentStatus) === "1";
  const confirmation = textValue(root.ConfirmationStatus) === "1";
  const bookingId = textValue(root.BookingID) || null;
  return {
    status: confirmation && bookingId ? "confirmed" : reservation || payment ? "pending" : "failed",
    bookingId,
    securityCode: textValue(root.SecurityCode) || null,
    locator: textValue(root.Locator) || null,
    errors: asArray(obj(root.Errors)?.Error)
      .map((e) => textValue(e).trim())
      .filter(Boolean),
  };
}
