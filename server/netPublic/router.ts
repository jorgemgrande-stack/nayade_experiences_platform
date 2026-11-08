/**
 * Elephant Net · rutas públicas (sin sesión), páginas HTML del servidor con formularios (sin JavaScript), como el área
 * de puntos (server/loyaltyPortal.ts). No pasan por /api/trpc: no cambian la lista blanca de server/authGuard.ts.
 *
 *  - GET/POST /mesa/<token>      Restaurant Net · carta de la mesa y pedido pendiente de confirmar (sin cobro).
 *  - GET/POST /check-in/<token>  Hotel Net · registro de viajeros antes de llegar (sin datos de pago).
 *  - GET/POST /firma/<token>     Ski Net · firma remota del contrato de alquiler (un solo uso).
 *  - GET/POST /baja/<token>      Connect Brevo · baja de las comunicaciones comerciales (idempotente).
 *  - GET/POST /contrato/<token>  Contratos y firma electrónica · firma (o rechazo) a distancia del contrato (un solo uso).
 *  - GET /ical/<token>.ics        Hotel Net · calendario iCal de disponibilidad de una tipología o habitación (canales).
 *
 * Antiabuso: límite por IP (todas las peticiones y, más estricto, los envíos; en la carta de mesa, más alto porque un
 * comedor comparte la IP de su wifi) y por enlace (envíos con el mismo token, p. ej. por mesa); rutas sensibles a
 * mayúsculas; cuerpo como mucho de 8 KB y solo formularios (`netPublicBodyParser`, montado ANTES del lector
 * general de 50 MB); el token se valida por formato antes de tocar la BD. Cada superficie exige su capacidad (y su
 * módulo) en la empresa del dominio; un enlace no válido, de otra empresa, revocado, usado o caducado responde siempre
 * la misma página.
 */
import crypto from "node:crypto";
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { getTenantIdOrDefault } from "../_core/tenant";
import { SdkError } from "../sdk";
import { ALLERGEN_LABEL } from "../../shared/restaurantNet";
import { esc, failure, fmtDay, fmtEur, invalidLink, notice, page, tooLarge, unavailable } from "./html";
import { NetLinksNotInstalled, resolveLink } from "./links";
import { SUBMIT_KEY_RE, TABLE_ORDER_LIMITS, estimatedTotal, orderLinesFromForm, pendingOfLink, publicMenu, submitTableRequest, tableOfLink, tableOrderingAvailable } from "./restaurantTable";
import { GUEST_FIELDS, checkinOfLink, guestsFromForm, onlineCheckinAvailable, saveSubmission, type PublicCheckin } from "./hotelCheckin";
import { contractOfLink, remoteSigningAvailable, signWithLink, type PublicContract } from "./skiSign";
import { unsubscribe, unsubscribeAvailable, verifyUnsubscribeToken } from "./brevoUnsubscribe";
import { contractOfLink as esignContractOfLink, contractSigningAvailable, rejectWithLink, resolveEsignLink, signWithLink as esignSignWithLink, type PublicContract as EsignPublicContract } from "./contractSign";
import { ESIGN_LIMITS, SIMPLE_SIGNATURE_NOTICE, formatAmount } from "../../shared/contractsEsign";
import { DOC_TYPES, SEXES } from "../hotelGuests";
import { ICAL_FILE_RE } from "../hotelIcal";
import { exportCalendar, icalAvailable, resolveExport } from "../hotelIcalDb";

/** Rutas públicas de este módulo (las comprueba el lector de cuerpos y la prueba de rutas). */
export const NET_PUBLIC_PATH = /^\/(mesa|check-in|firma|baja|contrato|ical)\/[^/]+\/?$/;
export const NET_PUBLIC_BODY_LIMIT = 8 * 1024;

const urlencoded = express.urlencoded({ extended: false, limit: NET_PUBLIC_BODY_LIMIT, parameterLimit: 400 });

/**
 * Lector del cuerpo de los envíos a estas rutas: solo formularios y como mucho 8 KB. Se monta antes del lector general
 * (50 MB) del arranque; si el cuerpo ya se leyó (pruebas), no hace nada.
 */
export const netPublicBodyParser: RequestHandler = (req, res, next) => {
  if (req.method !== "POST" || !NET_PUBLIC_PATH.test(req.path)) return next();
  if (Number(req.headers["content-length"] ?? 0) > NET_PUBLIC_BODY_LIMIT) return tooLarge(res);
  const type = String(req.headers["content-type"] ?? "");
  if (type && !/^application\/x-www-form-urlencoded\b/i.test(type)) {
    return page(res, 415, "Solicitud no válida", `<div class="sheet"><p>Formato de envío no admitido.</p></div>`);
  }
  urlencoded(req, res, (err?: unknown) => {
    if (err) return (err as { type?: string }).type === "entity.too.large" ? tooLarge(res) : page(res, 400, "Solicitud no válida", `<div class="sheet"><p>Solicitud no válida.</p></div>`);
    next();
  });
};

const tokenOf = (req: Request) => String(req.params.token ?? "").slice(0, 120);
const bodyOf = (req: Request): Record<string, unknown> => (req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {});
const evidence = (req: Request) => {
  const ua = req.headers["user-agent"];
  return { ip: req.ip ?? null, userAgent: typeof ua === "string" ? ua.slice(0, 300) : null };
};

function tooMany(_req: Request, res: Response) {
  page(res, 429, "Demasiadas solicitudes", `<div class="sheet"><h1>Un momento</h1><p>Has hecho demasiadas solicitudes seguidas. Espera unos minutos y vuelve a intentarlo.</p></div>`);
}

/** Errores sin datos del enlace en el registro (nunca el token). */
function handleError(res: Response, title: string, e: unknown, what: string) {
  if (e instanceof NetLinksNotInstalled || e instanceof SdkError) return unavailable(res, title);
  if (e && typeof e === "object" && (e as { code?: string }).code === "PRECONDITION_FAILED") return unavailable(res, title);
  console.error(JSON.stringify({ ctx: "NetPublic", event: "error", what, error: e instanceof Error ? e.message.slice(0, 200) : "error" }));
  return failure(res, title);
}

export interface NetPublicRouterOptions {
  /** Peticiones por IP y minuto (todas). */
  perIpPerMinute?: number;
  /** Envíos por IP cada 10 minutos. */
  postsPerIp?: number;
  /** Envíos con el mismo enlace cada 10 minutos (p. ej. por mesa). */
  postsPerLink?: number;
  /** Carta de mesa: peticiones por IP y minuto (la wifi del comedor es una sola IP). */
  mesaPerIpPerMinute?: number;
  /** Carta de mesa: envíos por IP cada 10 minutos. */
  mesaPostsPerIp?: number;
  /** Calendarios iCal: peticiones por IP y minuto (los canales consultan muchos calendarios desde pocas IP). */
  icalPerIpPerMinute?: number;
}

/** Ruta sin barra final (la misma clave por enlace con y sin ella). El token conserva sus mayúsculas: es parte del secreto. */
export const normalizedPath = (req: Request) => req.path.replace(/\/+$/, "");

// ─── Restaurant Net: carta de la mesa ──────────────────────────────────────────

const MESA = "Carta";

function menuPage(res: Response, status: number, table: { code: string; restaurantName: string }, menu: Awaited<ReturnType<typeof publicMenu>>, pending: number, msg = "") {
  const groups = new Map<string, typeof menu>();
  for (const m of menu) {
    const k = m.category?.trim() || "Carta";
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  const key = crypto.randomBytes(16).toString("hex");
  const items = Array.from(groups.entries())
    .map(([cat, list]) =>
      `<h3>${esc(cat)}</h3><ul>` +
      list
        .map((m) => {
          const allergens = m.allergens.map((a) => ALLERGEN_LABEL[a] ?? a).join(", ");
          return `<li><div><strong>${esc(m.name)}</strong>${m.description ? `<div class="muted">${esc(m.description)}</div>` : ""}${allergens ? `<div class="muted">Alérgenos: ${esc(allergens)}</div>` : ""}<div>${esc(fmtEur(m.price))}</div></div>` +
            `<input type="number" name="q${m.id}" min="0" max="${TABLE_ORDER_LIMITS.maxQtyPerLine}" inputmode="numeric" placeholder="0" aria-label="Unidades de ${esc(m.name)}"></li>`;
        })
        .join("") +
      `</ul>`,
    )
    .join("");
  page(
    res,
    status,
    `${table.restaurantName} · Mesa ${table.code}`,
    `${msg}<div class="sheet"><h1>${esc(table.restaurantName)}</h1><p class="muted">Mesa ${esc(table.code)}</p>` +
      (pending ? `<p>Tienes ${pending} pedido${pending === 1 ? "" : "s"} esperando a que el camarero lo${pending === 1 ? "" : "s"} confirme.</p>` : "") +
      `<p class="muted">Elige los platos y envía el pedido: el camarero lo confirmará. El pago se hace en la mesa.</p></div>` +
      (menu.length
        ? `<form method="post"><div class="sheet">${items}</div><div class="sheet"><label for="n">Comentarios para el camarero (opcional)</label>` +
          `<textarea id="n" name="n" maxlength="${TABLE_ORDER_LIMITS.noteMax}" rows="2"></textarea><input type="hidden" name="k" value="${key}"><p></p><button type="submit">Enviar pedido al camarero</button></div></form>`
        : `<div class="sheet"><p>La carta no está disponible ahora mismo. Pide al camarero.</p></div>`),
  );
}

async function restaurantGet(req: Request, res: Response) {
  try {
    if (!(await tableOrderingAvailable())) return unavailable(res, MESA);
    const link = await resolveLink("restaurant_table", tokenOf(req));
    const table = link ? await tableOfLink(link) : null;
    if (!link || !table) return invalidLink(res, MESA);
    const [menu, pending] = await Promise.all([publicMenu(table.restaurantId), pendingOfLink(link.id)]);
    menuPage(res, 200, table, menu, pending.length);
  } catch (e) {
    handleError(res, MESA, e, "mesa.get");
  }
}

const tableForm = z.object({ k: z.string().regex(SUBMIT_KEY_RE), n: z.string().max(TABLE_ORDER_LIMITS.noteMax).optional() });

async function restaurantPost(req: Request, res: Response) {
  try {
    if (!(await tableOrderingAvailable())) return unavailable(res, MESA);
    const link = await resolveLink("restaurant_table", tokenOf(req));
    const table = link ? await tableOfLink(link) : null;
    if (!link || !table) return invalidLink(res, MESA);
    const menu = await publicMenu(table.restaurantId);
    const body = bodyOf(req);
    const f = tableForm.safeParse({ k: body.k, n: typeof body.n === "string" ? body.n : undefined });
    const pending = (await pendingOfLink(link.id)).length;
    if (!f.success) return menuPage(res, 400, table, menu, pending, notice("err", "El pedido no es válido. Vuelve a intentarlo."));
    const { lines, error } = orderLinesFromForm(body, menu);
    if (error) return menuPage(res, 400, table, menu, pending, notice("err", error));
    const r = await submitTableRequest(link, table, lines, f.data.n ?? null, f.data.k);
    if (!r.ok) return menuPage(res, 409, table, menu, pending, notice("err", r.error));
    page(
      res,
      200,
      `${table.restaurantName} · Mesa ${table.code}`,
      `${notice("ok", "Pedido enviado. El camarero lo confirmará en breve.")}<div class="sheet"><h1>Tu pedido</h1><ul>` +
        lines.map((l) => `<li><span>${l.quantity} × ${esc(l.name)}</span><span>${esc(fmtEur(l.unitPrice * l.quantity))}</span></li>`).join("") +
        `</ul><p class="muted">Importe orientativo: ${esc(fmtEur(estimatedTotal(lines)))}. No se cobra nada ahora: el pago se hace en la mesa.</p>` +
        `<p><a href="${esc(req.originalUrl.split("?")[0])}">Volver a la carta</a></p></div>`,
    );
  } catch (e) {
    handleError(res, MESA, e, "mesa.post");
  }
}

// ─── Hotel Net: check-in online ────────────────────────────────────────────────

const CHECKIN = "Check-in online";

const FIELD_LABEL: Record<(typeof GUEST_FIELDS)[number], string> = {
  firstName: "Nombre", lastName: "Primer apellido", secondLastName: "Segundo apellido", sex: "Sexo", birthDate: "Fecha de nacimiento", nationality: "Nacionalidad",
  docType: "Tipo de documento", docNumber: "Número de documento", docSupportNumber: "Número de soporte (DNI/NIE)", docIssueDate: "Fecha de expedición",
  address: "Dirección", city: "Localidad", postalCode: "Código postal", country: "País", phone: "Teléfono", email: "Correo electrónico", kinship: "Parentesco con el adulto (menores)",
};
const SEX_LABEL: Record<string, string> = { H: "Hombre", M: "Mujer", X: "Otro" };

function guestFieldset(i: number, v: Record<string, string>): string {
  const input = (f: (typeof GUEST_FIELDS)[number], type = "text", extra = "") =>
    `<label for="g${i}_${f}">${FIELD_LABEL[f]}</label><input id="g${i}_${f}" name="g${i}_${f}" type="${type}" value="${esc(v[f] ?? "")}"${extra}>`;
  const select = (f: "sex" | "docType", opts: readonly string[], label: (o: string) => string) =>
    `<label for="g${i}_${f}">${FIELD_LABEL[f]}</label><select id="g${i}_${f}" name="g${i}_${f}"><option value=""></option>${opts.map((o) => `<option value="${o}"${v[f] === o ? " selected" : ""}>${esc(label(o))}</option>`).join("")}</select>`;
  return (
    `<fieldset><legend>${i === 0 ? "Titular" : `Acompañante ${i}`}</legend>` +
    input("firstName", "text", ' maxlength="120" autocomplete="given-name"') + input("lastName", "text", ' maxlength="160"') + input("secondLastName", "text", ' maxlength="160"') +
    `<div class="row"><div>${select("sex", SEXES, (o) => SEX_LABEL[o] ?? o)}</div><div>${input("birthDate", "date")}</div></div>` +
    input("nationality", "text", ' maxlength="80"') +
    `<div class="row"><div>${select("docType", DOC_TYPES, (o) => (o === "PASAPORTE" ? "Pasaporte" : o === "OTRO" ? "Otro" : o))}</div><div>${input("docNumber", "text", ' maxlength="64"')}</div></div>` +
    `<div class="row"><div>${input("docSupportNumber", "text", ' maxlength="64"')}</div><div>${input("docIssueDate", "date")}</div></div>` +
    input("address", "text", ' maxlength="255" autocomplete="street-address"') +
    `<div class="row"><div>${input("city", "text", ' maxlength="120"')}</div><div>${input("postalCode", "text", ' maxlength="16"')}</div></div>` +
    input("country", "text", ' maxlength="80"') + input("phone", "tel", ' maxlength="40"') + input("email", "email", ' maxlength="255"') +
    (i > 0 ? input("kinship", "text", ' maxlength="40"') : "") +
    `</fieldset>`
  );
}

function checkinPage(res: Response, status: number, c: PublicCheckin, values: Array<Record<string, string>>, msg = "") {
  const r = c.reservation;
  const head =
    `<div class="sheet"><h1>${esc(CHECKIN)}</h1><p>Reserva ${esc(r.reservationNumber ?? `#${r.id}`)}${r.roomName ? ` · ${esc(r.roomName)}` : ""}</p>` +
    `<p class="muted">Llegada: ${esc(fmtDay(r.checkIn))} · Salida: ${esc(fmtDay(r.checkOut))}</p>` +
    `<p class="muted">Los datos se piden por el registro de viajeros (RD 933/2021). No se piden datos de pago. Puedes corregirlos con este enlace hasta el día de llegada.</p></div>`;
  if (c.closedReason) return page(res, 200, CHECKIN, `${head}<div class="sheet"><p>${esc(c.closedReason)}</p></div>`);
  const sets = Array.from({ length: c.slots }, (_, i) => guestFieldset(i, values[i] ?? {})).join("");
  page(res, status, CHECKIN, `${msg}${head}<form method="post"><div class="sheet">${sets}<button type="submit">Enviar mis datos</button></div></form>`);
}

/** Campos que nunca se devuelven a la página (ni al corregir un envío con errores). */
export const CHECKIN_NEVER_ECHOED = ["docNumber", "docSupportNumber"] as const;
const withoutDocuments = (values: Array<Record<string, string>>) =>
  values.map((v) => ({ ...v, ...Object.fromEntries(CHECKIN_NEVER_ECHOED.map((f) => [f, ""])) }));

/**
 * Lo ya enviado NO se vuelve a mostrar (quien tenga el enlace no ve documentos, fechas ni direcciones): solo un resumen,
 * y para corregir se envían de nuevo los datos completos, que sustituyen a los anteriores.
 */
const receivedNotice = (n: number) =>
  notice("ok", `Datos recibidos de ${n} persona${n === 1 ? "" : "s"}, pendientes de revisión en recepción. Si necesitas corregir algo, vuelve a enviar los datos completos: sustituyen a los anteriores.`);

async function checkinGet(req: Request, res: Response) {
  try {
    if (!(await onlineCheckinAvailable())) return unavailable(res, CHECKIN);
    const link = await resolveLink("hotel_checkin", tokenOf(req));
    const c = link ? await checkinOfLink(link) : null;
    if (!link || !c) return invalidLink(res, CHECKIN);
    checkinPage(res, 200, c, [], c.submission?.status === "pending" ? receivedNotice(c.submission.guestCount) : "");
  } catch (e) {
    handleError(res, CHECKIN, e, "checkin.get");
  }
}

async function checkinPost(req: Request, res: Response) {
  try {
    if (!(await onlineCheckinAvailable())) return unavailable(res, CHECKIN);
    const link = await resolveLink("hotel_checkin", tokenOf(req));
    const c = link ? await checkinOfLink(link) : null;
    if (!link || !c) return invalidLink(res, CHECKIN);
    if (c.closedReason) return checkinPage(res, 409, c, []);
    const { guests, values, errors } = guestsFromForm(bodyOf(req), c.slots, c.reservation.checkIn);
    if (errors.length) return checkinPage(res, 400, c, withoutDocuments(values), `<div class="notice err">${errors.slice(0, 12).map(esc).join("<br>")}</div>`);
    const saved = await saveSubmission(link, c.reservation.id, guests);
    if (!saved) return checkinPage(res, 409, { ...c, closedReason: "Recepción ya ha registrado estos datos." }, []);
    page(res, 200, CHECKIN, `${notice("ok", "Datos recibidos. ¡Gracias!")}<div class="sheet"><h1>${esc(CHECKIN)}</h1><p>Recepción ya tiene tus datos para el registro de viajeros. Si necesitas corregir algo, vuelve a abrir este enlace antes del día de llegada y envía de nuevo los datos completos.</p></div>`);
  } catch (e) {
    handleError(res, CHECKIN, e, "checkin.post");
  }
}

// ─── Ski Net: firma remota ─────────────────────────────────────────────────────

const FIRMA = "Firma del contrato";

function contractPage(res: Response, status: number, c: PublicContract, msg = "", signerName = "") {
  const x = c.content;
  page(
    res,
    status,
    FIRMA,
    `${msg}<div class="sheet"><h1>${esc(FIRMA)}</h1><p>${esc(x.storeName)} · ${esc(x.customerName)}</p><p class="muted">Del ${esc(fmtDay(x.startDate))} al ${esc(fmtDay(x.expectedReturnDate))}</p>` +
      `<ul>${x.lines.map((l) => `<li><span>${esc(l.model)}${l.size ? ` · talla ${esc(l.size)}` : ""}</span><span class="muted">${esc(l.code)}</span></li>`).join("")}</ul></div>` +
      `<div class="sheet"><h2>Condiciones (versión ${esc(x.termsVersion)})</h2><div class="terms">${esc(x.terms)}</div><p class="muted">Huella del contrato (SHA-256): ${esc(c.contentHash)}</p></div>` +
      `<form method="post"><div class="sheet"><label for="signerName">Nombre y apellidos de quien firma</label><input id="signerName" name="signerName" maxlength="120" required value="${esc(signerName)}" autocomplete="name">` +
      `<label><input type="checkbox" name="accepted" value="1" required>He leído y acepto las condiciones del alquiler</label><p></p><button type="submit">Firmar el contrato</button></div></form>`,
  );
}

async function signGet(req: Request, res: Response) {
  try {
    const link = await resolveLink("ski_contract", tokenOf(req));
    if (!link) return invalidLink(res, FIRMA);
    if (!(await remoteSigningAvailable(link.siteId))) return unavailable(res, FIRMA);
    const c = await contractOfLink(link);
    if (!c) return invalidLink(res, FIRMA);
    contractPage(res, 200, c);
  } catch (e) {
    handleError(res, FIRMA, e, "firma.get");
  }
}

const signForm = z.object({ signerName: z.string().max(120).default(""), accepted: z.literal("1").optional() });

async function signPost(req: Request, res: Response) {
  try {
    const link = await resolveLink("ski_contract", tokenOf(req));
    if (!link) return invalidLink(res, FIRMA);
    if (!(await remoteSigningAvailable(link.siteId))) return unavailable(res, FIRMA);
    const c = await contractOfLink(link);
    if (!c) return invalidLink(res, FIRMA);
    const body = bodyOf(req);
    const f = signForm.safeParse({ signerName: typeof body.signerName === "string" ? body.signerName : "", accepted: body.accepted === "1" ? "1" : undefined });
    if (!f.success) return contractPage(res, 400, c, notice("err", "Revisa el nombre de quien firma."));
    const r = await signWithLink(link, { signerName: f.data.signerName, accepted: f.data.accepted === "1" }, evidence(req));
    if (!r.ok) return "used" in r ? invalidLink(res, FIRMA) : contractPage(res, 400, c, notice("err", r.error), f.data.signerName);
    page(res, 200, FIRMA, `${notice("ok", "Contrato firmado.")}<div class="sheet"><h1>${esc(FIRMA)}</h1><p>Firmado por ${esc(r.signerName)}. La tienda ya tiene el contrato firmado.</p><p class="muted">Huella del contrato (SHA-256): ${esc(r.contentHash)}</p></div>`);
  } catch (e) {
    handleError(res, FIRMA, e, "firma.post");
  }
}

// ─── Connect Brevo: baja ───────────────────────────────────────────────────────

const BAJA = "Darse de baja";

async function unsubGet(req: Request, res: Response) {
  try {
    if (!(await unsubscribeAvailable())) return unavailable(res, BAJA);
    if (verifyUnsubscribeToken(tokenOf(req)) == null) return invalidLink(res, BAJA);
    page(res, 200, BAJA, `<div class="sheet"><h1>${esc(BAJA)}</h1><p>Confirma que no quieres recibir más comunicaciones comerciales por correo.</p><form method="post"><button type="submit">Confirmar la baja</button></form></div>`);
  } catch (e) {
    handleError(res, BAJA, e, "baja.get");
  }
}

async function unsubPost(req: Request, res: Response) {
  try {
    if (!(await unsubscribeAvailable())) return unavailable(res, BAJA);
    const clientId = verifyUnsubscribeToken(tokenOf(req));
    if (clientId == null) return invalidLink(res, BAJA);
    await unsubscribe(clientId);
    page(res, 200, BAJA, `${notice("ok", "Baja registrada.")}<div class="sheet"><h1>${esc(BAJA)}</h1><p>No recibirás más comunicaciones comerciales por correo. Los avisos de tus reservas o compras se siguen enviando.</p></div>`);
  } catch (e) {
    handleError(res, BAJA, e, "baja.post");
  }
}

// ─── Contratos y firma electrónica: firma a distancia ──────────────────────────

const CONTRATO = "Firma del contrato";

function esignPage(res: Response, status: number, c: EsignPublicContract, msg = "", values: { signerName?: string; signerTaxId?: string } = {}) {
  const x = c.content;
  const amount = x.amount != null ? formatAmount(Number(x.amount)) : null;
  page(
    res,
    status,
    CONTRATO,
    `${msg}<div class="sheet"><h1>${esc(x.title)}</h1><p>${esc(x.company)} · ${esc(x.customerName)}</p><p class="muted">Fecha: ${esc(fmtDay(x.contractDate))}${amount ? ` · Importe: ${esc(amount)}` : ""}</p></div>` +
      `<div class="sheet"><h2>Texto del contrato</h2><div class="terms">${esc(x.body)}</div><p class="muted">Huella del contrato (SHA-256): ${esc(c.hash)}</p></div>` +
      `<form method="post"><div class="sheet"><input type="hidden" name="action" value="sign">` +
      `<label for="signerName">Nombre y apellidos de quien firma</label><input id="signerName" name="signerName" maxlength="${ESIGN_LIMITS.nameMax}" required value="${esc(values.signerName ?? "")}" autocomplete="name">` +
      `<label for="signerTaxId">DNI/NIF (opcional)</label><input id="signerTaxId" name="signerTaxId" maxlength="${ESIGN_LIMITS.taxIdMax}" value="${esc(values.signerTaxId ?? "")}">` +
      `<label><input type="checkbox" name="accepted" value="1" required>He leído y acepto el contrato</label>` +
      `<p class="muted">${esc(SIMPLE_SIGNATURE_NOTICE)} Al firmar se guardan tu nombre, tu DNI/NIF si lo indicas, la fecha, la IP y el navegador.</p>` +
      `<button type="submit">Firmar el contrato</button></div></form>` +
      `<form method="post"><div class="sheet"><input type="hidden" name="action" value="reject"><h2>¿No estás de acuerdo?</h2>` +
      `<label for="reason">Motivo (opcional)</label><textarea id="reason" name="reason" maxlength="${ESIGN_LIMITS.reasonMax}" rows="2"></textarea><p></p>` +
      `<button type="submit">Rechazar el contrato</button></div></form>`,
  );
}

async function esignLinkAndContract(req: Request) {
  const link = await resolveEsignLink(tokenOf(req));
  const c = link ? await esignContractOfLink(link, evidence(req)) : null;
  return link && c ? { link, c } : null;
}

async function esignGet(req: Request, res: Response) {
  try {
    if (!(await contractSigningAvailable())) return unavailable(res, CONTRATO);
    const r = await esignLinkAndContract(req);
    if (!r) return invalidLink(res, CONTRATO);
    esignPage(res, 200, r.c);
  } catch (e) {
    handleError(res, CONTRATO, e, "contrato.get");
  }
}

const esignForm = z.object({
  action: z.enum(["sign", "reject"]),
  signerName: z.string().max(ESIGN_LIMITS.nameMax).default(""),
  signerTaxId: z.string().max(ESIGN_LIMITS.taxIdMax + 10).default(""),
  accepted: z.literal("1").optional(),
  reason: z.string().max(ESIGN_LIMITS.reasonMax).default(""),
});

async function esignPost(req: Request, res: Response) {
  try {
    if (!(await contractSigningAvailable())) return unavailable(res, CONTRATO);
    const r = await esignLinkAndContract(req);
    if (!r) return invalidLink(res, CONTRATO);
    const body = bodyOf(req);
    const s = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
    const f = esignForm.safeParse({ action: s("action") || "sign", signerName: s("signerName"), signerTaxId: s("signerTaxId"), accepted: body.accepted === "1" ? "1" : undefined, reason: s("reason") });
    if (!f.success) return esignPage(res, 400, r.c, notice("err", "Revisa los datos del formulario."));
    if (f.data.action === "reject") {
      const x = await rejectWithLink(r.link, f.data.reason, evidence(req));
      if (!x.ok) return invalidLink(res, CONTRATO);
      return page(res, 200, CONTRATO, `${notice("ok", "Contrato rechazado.")}<div class="sheet"><h1>${esc(CONTRATO)}</h1><p>${esc(r.c.content.company)} verá en su panel que has rechazado este contrato. El enlace ya no se puede usar.</p></div>`);
    }
    const x = await esignSignWithLink(r.link, { signerName: f.data.signerName, signerTaxId: f.data.signerTaxId, accepted: f.data.accepted === "1" }, evidence(req));
    if (!x.ok) return "used" in x ? invalidLink(res, CONTRATO) : esignPage(res, 400, r.c, notice("err", x.error), { signerName: f.data.signerName, signerTaxId: f.data.signerTaxId });
    page(
      res,
      200,
      CONTRATO,
      `${notice("ok", "Contrato firmado.")}<div class="sheet"><h1>${esc(CONTRATO)}</h1><p>Firmado por ${esc(x.signerName)}. ${esc(r.c.content.company)} ya tiene el contrato firmado.</p>` +
        `<p class="muted">Huella del contrato (SHA-256): ${esc(x.contentHash)}</p><p class="muted">${esc(SIMPLE_SIGNATURE_NOTICE)}</p></div>`,
    );
  } catch (e) {
    handleError(res, CONTRATO, e, "contrato.post");
  }
}

// ─── Hotel Net: calendario iCal de disponibilidad ──────────────────────────────

const ICAL = "Calendario";

/**
 * GET /ical/<token>.ics: VCALENDAR de la tipología o habitación del enlace (solo «No disponible», sin datos del
 * huésped). Exige Hotel Net en la empresa del dominio; un enlace con otro formato, inexistente, de otra empresa o
 * revocado responde siempre la misma página. Sin caché ni indexación.
 */
async function icalGet(req: Request, res: Response) {
  try {
    if (!(await icalAvailable())) return unavailable(res, ICAL);
    const m = ICAL_FILE_RE.exec(String(req.params.file ?? "").slice(0, 120));
    const link = m ? await resolveExport(m[1]) : null;
    const body = link ? await exportCalendar(link) : null;
    if (!link || body == null) return invalidLink(res, ICAL);
    res.status(200);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="disponibilidad.ics"');
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(body);
  } catch (e) {
    if (e instanceof Error && e.name === "IcalNotInstalled") return unavailable(res, ICAL);
    handleError(res, ICAL, e, "ical.get");
  }
}

// ─── Montaje ───────────────────────────────────────────────────────────────────

export function createNetPublicRouter(opts: NetPublicRouterOptions = {}): Router {
  // Rutas exactas (en minúsculas): /MESA/… no entra aquí ni se salta el lector de 8 KB
  const r = express.Router({ caseSensitive: true, strict: false });
  const ip = (req: Request) => `ip:${ipKeyGenerator(req.ip ?? "")}`;
  const limiter = (windowMs: number, limit: number, keyGenerator: (req: Request) => string) =>
    rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, keyGenerator, handler: tooMany });
  const all = limiter(60_000, opts.perIpPerMinute ?? 60, (req) => `all:${ip(req)}`);
  const posts = limiter(10 * 60_000, opts.postsPerIp ?? 30, (req) => `posts:${ip(req)}`);
  // Un comedor comparte la IP de su wifi: en la carta, límites por IP más altos y el freno real es el de cada mesa
  const mesaAll = limiter(60_000, opts.mesaPerIpPerMinute ?? 240, (req) => `mesa-all:${ip(req)}`);
  const mesaPosts = limiter(10 * 60_000, opts.mesaPostsPerIp ?? 120, (req) => `mesa-posts:${ip(req)}`);
  const icalAll = limiter(60_000, opts.icalPerIpPerMinute ?? 300, (req) => `ical-all:${ip(req)}`);
  // Por enlace (mesa, reserva, contrato o contacto): la huella de la ruta normalizada con la empresa, nunca el token
  const perLink = limiter(10 * 60_000, opts.postsPerLink ?? 10, (req) => `link:${crypto.createHash("sha256").update(`${getTenantIdOrDefault()}:${normalizedPath(req)}`).digest("hex")}`);
  const post = [all, posts, perLink, netPublicBodyParser] as RequestHandler[];

  r.get("/mesa/:token", mesaAll, restaurantGet);
  r.post("/mesa/:token", mesaAll, mesaPosts, perLink, netPublicBodyParser, restaurantPost);
  r.get("/check-in/:token", all, checkinGet);
  r.post("/check-in/:token", ...post, checkinPost);
  r.get("/firma/:token", all, signGet);
  r.post("/firma/:token", ...post, signPost);
  r.get("/baja/:token", all, unsubGet);
  r.post("/baja/:token", ...post, unsubPost);
  r.get("/contrato/:token", all, esignGet);
  r.post("/contrato/:token", ...post, esignPost);
  r.get("/ical/:file", icalAll, icalGet);
  r.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    return failure(res, "Error");
  });
  return r;
}
