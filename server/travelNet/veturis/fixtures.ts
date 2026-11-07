/**
 * Respuestas de Veturis SIMULADAS para las pruebas, con la forma de los ejemplos del manual (Veturis XML API Reference
 * V4) y datos ficticios: hoteles, tokens, reservas y localizadores inventados. Ninguna credencial.
 */

export const SEARCH_RESPONSE = `<resultadosRS currency="EUR">
<Version>2.0</Version>
<Language>SPA</Language>
<Response>
<obj>1700000000.FICTICIO-OBJ</obj>
<TotalDestinationHotels>2</TotalDestinationHotels>
<AvailablesHotel>1</AvailablesHotel>
<SessionID>FICTICIO-SESION</SessionID>
<Hotels>
<Hotel>
<HotelDetails>
<ID>100001</ID>
<Name>Hotel Ficticio Centro</Name>
</HotelDetails>
<Accommodations>
<Room>
<RoomType>
<ID>1</ID>
<Name>Doble estándar</Name>
<NumberRooms>2</NumberRooms>
</RoomType>
<Board>
<Board_type><ID>1</ID></Board_type>
<Currency>EUR</Currency>
<Price mandatory="1">149.62</Price>
<PriceAgency>121.07</PriceAgency>
<DirectPayment>0</DirectPayment>
<DATOS>100001H1_TOKEN_NOREEMB</DATOS>
<Refundable>N</Refundable>
<Cancellation><From>2027-01-01</From><Price>121.07</Price></Cancellation>
</Board>
<Board>
<Board_type><ID>2</ID></Board_type>
<Currency>EUR</Currency>
<Price mandatory="0">166.25</Price>
<PriceAgency>134.52</PriceAgency>
<DirectPayment>0</DirectPayment>
<DATOS>100001H1_TOKEN_REEMB</DATOS>
<Refundable>Y</Refundable>
<Cancellation><From>2027-01-08</From><Price>134.52</Price></Cancellation>
</Board>
</Room>
</Accommodations>
</Hotel>
</Hotels>
</Response>
</resultadosRS>`;

export const SEARCH_NO_RESULTS = `<resultadosRS currency="EUR"><Response><obj>0.SINRESULTADOS</obj><TotalDestinationHotels>1</TotalDestinationHotels><AvailablesHotel>0</AvailablesHotel></Response></resultadosRS>`;

/** Detalle vinculante; `priceChange` en euros si el precio cambió desde la búsqueda. */
export const detailResponse = (o: { agency?: string; priceChange?: string | null } = {}) => `<AdditionalInformationRS>
<HotelDetails><ID>100001</ID><Name>Hotel Ficticio Centro</Name><Category><ID>7</ID><Name>4 ESTRELLAS</Name></Category></HotelDetails>
<SearchAvailabilityDetails>
<Check_in_date>2027-01-10</Check_in_date><Check_out_date>2027-01-12</Check_out_date>
<RoomName numberOfRooms="1" RoomID="1">Doble estándar</RoomName>
<BoardID>2</BoardID><BoardName>Alojamiento y desayuno</BoardName>
</SearchAvailabilityDetails>
<AdditionalInformation>
<status>1</status>
<Rooms><Room><RoomID>1</RoomID><Price>166.25</Price><PriceAgency>${o.agency ?? "134.52"}</PriceAgency></Room></Rooms>
<Cancellation><Period><From>2027-01-08</From><To>2027-01-10</To><Amount>166.25</Amount><PriceAgency>134.52</PriceAgency></Period></Cancellation>
<Suplements />
<EssentialInformation><Information><Description>Tasa turística no incluida &amp; a pagar en el hotel.</Description></Information></EssentialInformation>
<PaymentTypes><Type code="SL">Saldo</Type></PaymentTypes>
</AdditionalInformation>
${o.priceChange ? `<PriceChange>${o.priceChange}</PriceChange>` : ""}
<PVP mandatory="0">166.25</PVP>
<PriceAgency>${o.agency ?? "134.52"}</PriceAgency>
<MandatoryPaxes>N</MandatoryPaxes>
</AdditionalInformationRS>`;

export const BOOKING_CONFIRMED = `<BookingConfirmationRS>
<ReservationStatus>1</ReservationStatus><PaymentStatus>1</PaymentStatus><ConfirmationStatus>1</ConfirmationStatus>
<BookingID>90000001</BookingID><SecurityCode>codigo-ficticio-0001</SecurityCode><Locator>FICT001</Locator>
</BookingConfirmationRS>`;

export const BOOKING_PENDING = `<BookingConfirmationRS>
<ReservationStatus>1</ReservationStatus><PaymentStatus>1</PaymentStatus><ConfirmationStatus>0</ConfirmationStatus>
<BookingID>90000002</BookingID><SecurityCode>codigo-ficticio-0002</SecurityCode><ERROR>1</ERROR>
<Errors><Error type="ERROR_CONFIRMACION"><![CDATA[Pendiente de confirmación del hotel]]></Error></Errors>
</BookingConfirmationRS>`;

export const BOOKING_FAILED = `<?xml version="1.0" encoding="UTF-8"?>
<BookingConfirmationRS>
<ReservationStatus>0</ReservationStatus><PaymentStatus>0</PaymentStatus><ConfirmationStatus>0</ConfirmationStatus>
<BookingID/><SecurityCode/><ERROR>1</ERROR>
<Errors><Error type="ERROR_PRERESERVA">Sin cupo</Error><Error type="ERROR_GENERAL">Inténtelo más tarde</Error></Errors>
</BookingConfirmationRS>`;

export const GENERAL_ERROR = `<?xml version="1.0" encoding="UTF-8"?>
<ResponseDetails version="0.1" language="SPA" currency="EUR"><Status>KO</Status><Error><![CDATA[ Error 1824: valor no válido ]]></Error></ResponseDetails>`;

export const AUTH_ERROR = `<ResponseDetails><Status>KO</Status><Error><![CDATA[Usuario o contraseña incorrectos]]></Error></ResponseDetails>`;

export const INVALID_XML = `<resultadosRS><Response><obj>sin cerrar`;

/** Veturis simulado: responde por el elemento raíz de la petición y anota cada llamada (sin credenciales). */
export class FakeVeturis {
  calls: string[] = [];
  creds: Array<{ user: string; agencyUser: string }> = [];
  urls: string[] = [];
  detail = detailResponse();
  booking = BOOKING_CONFIRMED;
  search = SEARCH_RESPONSE;
  status = 200;
  /** Si se define, la confirmación falla con un corte de red. */
  dropBooking = false;
  validUser = ["usuario", "ficticio"].join("-");
  fetch = async (url: string, init: { body: string }) => {
    const p = new URLSearchParams(init.body);
    const root = /<([A-Za-z]+)RQ\b/.exec(p.get("xmlRQ") ?? "")?.[1] ?? "?";
    this.calls.push(root);
    this.urls.push(url);
    this.creds.push({ user: p.get("user") ?? "", agencyUser: p.get("agencyUser") ?? "" });
    if (root === "BookingConfirmation" && this.dropBooking) throw new Error("ECONNRESET");
    const text = p.get("user") !== this.validUser ? AUTH_ERROR : root === "SearchAvailability" ? this.search : root === "AdditionalInformation" ? this.detail : root === "BookingConfirmation" ? this.booking : GENERAL_ERROR;
    return { ok: this.status < 400, status: this.status, text: async () => text };
  };
}
