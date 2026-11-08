/**
 * Hotel Net · sincronización iCal sin base de datos: generación RFC 5545 (CRLF, plegado a 75 octetos, UID estable,
 * VALUE=DATE, sin datos del huésped), lectura de calendarios de ejemplo inventados con la forma de Booking.com, Airbnb,
 * Vrbo y Google, altas/cambios/bajas por UID, ocupación externa, protección SSRF (URL, DNS y redirecciones) y la ruta
 * pública GET /ical/<token>.ics (con el acceso a datos simulado).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ICAL_BUSY_SUMMARY, ICAL_FILE_RE, ICAL_TOKEN_RE, ICAL_UID_DOMAIN, buildCalendar, contentLines, deriveExportToken, durationDays, escapeText, exportTokenHash,
  exportUid, externalUnitsByNight, foldLine, isPublicAddress, maskUrl, newExportNonce, nightRanges, normalizeFeedUrl, parseCalendar, planBlocks, uidHash,
} from "./hotelIcal";
import { fetchIcal, resolvePublicTarget, type HopGetter } from "./hotelIcalFetch";

const ical = vi.hoisted(() => ({
  available: true,
  link: null as null | { id: number },
  body: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n" as string | null,
  tokens: [] as unknown[],
}));
vi.mock("./hotelIcalDb", () => ({
  icalAvailable: async () => ical.available,
  resolveExport: async (t: unknown) => {
    ical.tokens.push(t);
    return ical.link;
  },
  exportCalendar: async () => ical.body,
}));

import { createNetPublicRouter } from "./netPublic/router";

const octets = (s: string) => Buffer.byteLength(s, "utf8");

// ─── Generación ──────────────────────────────────────────────────────────────

describe("exportación iCal (RFC 5545)", () => {
  const now = new Date("2026-11-08T10:20:30.000Z");
  const cal = buildCalendar({ name: "Doble superior", seed: "7:semilla", ranges: [{ start: "2026-12-01", end: "2026-12-04" }, { start: "2026-12-24", end: "2026-12-26" }], now });

  it("VCALENDAR válido con CRLF, VALUE=DATE, DTEND exclusivo y solo «No disponible»", () => {
    expect(cal.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:")).toBe(true);
    expect(cal.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(cal.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(cal).toContain("DTSTART;VALUE=DATE:20261201\r\nDTEND;VALUE=DATE:20261204\r\n");
    expect(cal).toContain("DTSTAMP:20261108T102030Z");
    expect(cal.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(cal.match(/SUMMARY:(.*)\r\n/g)?.every((l) => l === `SUMMARY:${ICAL_BUSY_SUMMARY}\r\n`)).toBe(true);
    expect(cal).not.toMatch(/ATTENDEE|ORGANIZER|DESCRIPTION|LOCATION/);
  });

  it("UID estable por enlace y tramo, con nuestro dominio y sin revelar la empresa", () => {
    const again = buildCalendar({ name: "Doble superior", seed: "7:semilla", ranges: [{ start: "2026-12-01", end: "2026-12-05" }], now: new Date() });
    const uid = (s: string) => /UID:([^\r\n]+)/.exec(s.replace(/\r\n /g, ""))![1];
    expect(uid(again)).toBe(uid(cal));
    expect(uid(cal)).toBe(exportUid("7:semilla", "2026-12-01"));
    expect(uid(cal).endsWith(`@${ICAL_UID_DOMAIN}`)).toBe(true);
    expect(exportUid("8:otra", "2026-12-01")).not.toBe(uid(cal));
  });

  it("plegado a 75 octetos sin partir caracteres UTF-8; al desplegar vuelve el original", () => {
    const long = `X-WR-CALNAME:${"Habitación ñandú 🐘 ".repeat(12)}`;
    const folded = foldLine(long);
    for (const l of folded.split("\r\n")) expect(octets(l)).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n").slice(1).every((l) => l.startsWith(" "))).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
    expect(folded).not.toContain("�");
    expect(foldLine("corta")).toBe("corta");
    const big = buildCalendar({ name: "ñ".repeat(200), seed: "s", ranges: [], now });
    for (const l of big.split("\r\n")) expect(octets(l)).toBeLessThanOrEqual(75);
  });

  it("escapa el texto y agrupa noches consecutivas en tramos", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    expect(nightRanges(["2026-12-03", "2026-12-01", "2026-12-02", "2026-12-10", "2026-12-02", "mal"])).toEqual([
      { start: "2026-12-01", end: "2026-12-04" },
      { start: "2026-12-10", end: "2026-12-11" },
    ]);
    expect(nightRanges(["2026-12-31", "2027-01-01"])).toEqual([{ start: "2026-12-31", end: "2027-01-02" }]);
  });

  it("un calendario propio se lee de vuelta sin eventos (los nuestros no se reimportan)", () => {
    const r = parseCalendar(cal, { today: "2026-11-08" });
    expect(r.invalid).toBe(false);
    expect(r.events).toEqual([]);
    expect(r.skipped.propio).toBe(2);
  });
});

// ─── Lectura ─────────────────────────────────────────────────────────────────

// Calendarios inventados con la forma habitual de cada canal (sin datos reales)
const BOOKING = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Booking.com//iCal//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
  "BEGIN:VEVENT", "UID:a1b2c3d4e5f60718293a4b5c6d7e8f90@booking.example", "DTSTAMP:20261108T080000Z", "DTSTART;VALUE=DATE:20261205", "DTEND;VALUE=DATE:20261208", "SUMMARY:CLOSED - Not available", "END:VEVENT",
  "BEGIN:VEVENT", "UID:00ff00ff00ff00ff00ff00ff00ff00ff@booking.example", "DTSTAMP:20261108T080000Z", "DTSTART;VALUE=DATE:20261220", "DTEND;VALUE=DATE:20261221", "SUMMARY:CLOSED - Not available", "END:VEVENT",
  "END:VCALENDAR", "",
].join("\r\n");

const AIRBNB = [
  "BEGIN:VCALENDAR", "PRODID;X-RICAL-TZSOURCE=TZINFO:-//Airbnb Inc//Hosting Calendar 1.0//EN", "CALSCALE:GREGORIAN", "VERSION:2.0",
  "BEGIN:VEVENT", "DTEND;VALUE=DATE:20261212", "DTSTART;VALUE=DATE:20261209", "UID:1418fb94e984-0f3e5a2b1c9d8e7f6a5b4c3d2e1f0a9b@airbnb.example",
  "DESCRIPTION:Reservation URL: https://www.airbnb.example/hosting/reservations/details/HMXXXXXXX\\nPhone Number (Last 4 Digits): 0000", "SUMMARY:Reserved", "END:VEVENT",
  "BEGIN:VEVENT", "DTEND;VALUE=DATE:20270115", "DTSTART;VALUE=DATE:20270101", "UID:7f562c2c9d74-aa11bb22cc33dd44ee55ff6600112233@airbnb.example", "SUMMARY:Airbnb (Not available)", "END:VEVENT",
  "END:VCALENDAR",
].join("\n");

const VRBO_GOOGLE = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Google Inc//Google Calendar 70.9054//EN", "X-WR-TIMEZONE:Europe/Madrid",
  // Con hora y zona: entra a las 15:00 y sale a las 11:00 → noches del 2 y 3
  "BEGIN:VEVENT", "DTSTART;TZID=Europe/Madrid:20261202T150000", "DTEND;TZID=Europe/Madrid:20261204T110000", "UID:google-evento-1@google.example", "SUMMARY:Bloqueo",
  "BEGIN:VALARM", "ACTION:DISPLAY", "UID:alarma-que-no-cuenta", "TRIGGER:-PT15M", "END:VALARM", "END:VEVENT",
  // En UTC: 23:30Z del 9 es ya día 10 en Madrid
  "BEGIN:VEVENT", "DTSTART:20261209T233000Z", "DURATION:P2D", "UID:vrbo-2@vrbo.example", "SUMMARY:Reserved", "END:VEVENT",
  // Sin fin: una noche
  "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261215", "UID:sin-fin@vrbo.example", "END:VEVENT",
  // Cancelado, libre (TRANSPARENT), sin UID, pasado y fechas rotas: descartados
  "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261216", "DTEND;VALUE=DATE:20261217", "UID:cancelado@vrbo.example", "STATUS:CANCELLED", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261218", "DTEND;VALUE=DATE:20261219", "UID:libre@google.example", "TRANSP:TRANSPARENT", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261218", "DTEND;VALUE=DATE:20261219", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20250101", "DTEND;VALUE=DATE:20250105", "UID:pasado@vrbo.example", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261340", "UID:roto@vrbo.example", "END:VEVENT",
  // Ocurrencia modificada de un evento repetido: UID propio con su RECURRENCE-ID
  "BEGIN:VEVENT", "UID:serie@google.example", "RECURRENCE-ID;VALUE=DATE:20261222", "DTSTART;VALUE=DATE:20261223", "DTEND;VALUE=DATE:20261224", "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("lectura de calendarios de los canales", () => {
  const today = "2026-11-08";

  it("Booking.com: fechas de día completo con CRLF", () => {
    const r = parseCalendar(BOOKING, { today });
    expect(r.invalid).toBe(false);
    expect(r.events).toEqual([
      { uid: "a1b2c3d4e5f60718293a4b5c6d7e8f90@booking.example", start: "2026-12-05", end: "2026-12-08" },
      { uid: "00ff00ff00ff00ff00ff00ff00ff00ff@booking.example", start: "2026-12-20", end: "2026-12-21" },
    ]);
  });

  it("Airbnb: LF, DTEND antes que DTSTART y sin guardar descripción ni teléfono", () => {
    const r = parseCalendar(AIRBNB, { today });
    expect(r.events).toEqual([
      { uid: "1418fb94e984-0f3e5a2b1c9d8e7f6a5b4c3d2e1f0a9b@airbnb.example", start: "2026-12-09", end: "2026-12-12" },
      { uid: "7f562c2c9d74-aa11bb22cc33dd44ee55ff6600112233@airbnb.example", start: "2027-01-01", end: "2027-01-15" },
    ]);
    expect(JSON.stringify(r.events)).not.toMatch(/Phone|Reservation|0000/);
  });

  it("Google y Vrbo: horas con zona o UTC, DURATION, sin fin, alarmas anidadas, cancelados y descartes", () => {
    const r = parseCalendar(VRBO_GOOGLE, { today });
    expect(r.events).toEqual([
      { uid: "google-evento-1@google.example", start: "2026-12-02", end: "2026-12-04" },
      { uid: "vrbo-2@vrbo.example", start: "2026-12-10", end: "2026-12-12" },
      { uid: "sin-fin@vrbo.example", start: "2026-12-15", end: "2026-12-16" },
      { uid: "serie@google.example#2026-12-22", start: "2026-12-23", end: "2026-12-24" },
    ]);
    expect(r.skipped).toMatchObject({ cancelado: 1, libre: 1, sin_uid: 1, fuera_de_plazo: 1, fecha_no_valida: 1 });
  });

  it("líneas plegadas (espacio o tabulador) y parámetros entre comillas con «:»", () => {
    const folded = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:muy-largo-\r\n uid@canal.example\r\nDTSTART;X-P=\"a:b\";VALUE=DATE:2026\r\n\t1203\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    expect(parseCalendar(folded, { today }).events).toEqual([{ uid: "muy-largo-uid@canal.example", start: "2026-12-03", end: "2026-12-04" }]);
    expect(contentLines("A;B=\"x:y\":valor")[0]).toEqual({ name: "A", params: { B: "x:y" }, value: "valor" });
  });

  it("no es un calendario (HTML de error, vacío): inválido; tope de eventos", () => {
    expect(parseCalendar("<html>Error</html>", { today }).invalid).toBe(true);
    expect(parseCalendar("", { today }).invalid).toBe(true);
    const many = ["BEGIN:VCALENDAR", ...Array.from({ length: 5 }, (_, i) => `BEGIN:VEVENT\r\nUID:e${i}\r\nDTSTART;VALUE=DATE:2026120${i + 1}\r\nEND:VEVENT`), "END:VCALENDAR"].join("\r\n");
    const r = parseCalendar(many, { today, maxEvents: 3 });
    expect(r.events).toHaveLength(3);
    expect(r.skipped.demasiados).toBe(2);
  });

  it("DURATION en días, semanas y horas", () => {
    expect(durationDays("P3D")).toBe(3);
    expect(durationDays("P1W")).toBe(7);
    expect(durationDays("PT36H")).toBe(2);
    expect(durationDays("P")).toBeNull();
    expect(durationDays("tres días")).toBeNull();
  });
});

// ─── Altas, cambios y bajas por UID ──────────────────────────────────────────

describe("altas, cambios y bajas por UID", () => {
  const ev = (uid: string, start: string, end: string) => ({ uid, start, end });
  it("nuevos se dan de alta, cambios de fechas y reactivaciones se actualizan, los que faltan se cancelan", () => {
    const stored = [
      { id: 1, uidHash: uidHash("igual"), start: "2026-12-01", end: "2026-12-03", status: "active" as const },
      { id: 2, uidHash: uidHash("movido"), start: "2026-12-05", end: "2026-12-06", status: "active" as const },
      { id: 3, uidHash: uidHash("desaparecido"), start: "2026-12-07", end: "2026-12-08", status: "active" as const },
      { id: 4, uidHash: uidHash("vuelve"), start: "2026-12-09", end: "2026-12-10", status: "cancelled" as const },
      { id: 5, uidHash: uidHash("ya-cancelado"), start: "2026-12-11", end: "2026-12-12", status: "cancelled" as const },
    ];
    const p = planBlocks(stored, [ev("igual", "2026-12-01", "2026-12-03"), ev("movido", "2026-12-05", "2026-12-07"), ev("vuelve", "2026-12-09", "2026-12-10"), ev("nuevo", "2026-12-20", "2026-12-22"), ev("nuevo", "2026-12-20", "2026-12-22")]);
    expect(p.insert).toEqual([ev("nuevo", "2026-12-20", "2026-12-22")]);
    expect(p.update.map((u) => u.id)).toEqual([2, 4]);
    expect(p.cancel).toEqual([3]);
    expect(p.unchanged).toBe(1);
  });
  it("un calendario vacío (todo cancelado en el canal) cancela todos los activos", () => {
    expect(planBlocks([{ id: 9, uidHash: uidHash("x"), start: "2026-12-01", end: "2026-12-02", status: "active" }], []).cancel).toEqual([9]);
  });
});

describe("ocupación por bloqueos externos", () => {
  it("una unidad por URL de tipología y noche; una habitación cuenta una vez aunque la marquen varios canales", () => {
    const m = externalUnitsByNight(
      [
        { feedId: 1, roomTypeId: 10, hotelRoomId: null, start: "2026-12-01", end: "2026-12-03" },
        { feedId: 1, roomTypeId: 10, hotelRoomId: null, start: "2026-12-02", end: "2026-12-04" }, // solape en la misma URL
        { feedId: 2, roomTypeId: 10, hotelRoomId: null, start: "2026-12-02", end: "2026-12-03" },
        { feedId: 3, roomTypeId: 10, hotelRoomId: 101, start: "2026-12-02", end: "2026-12-03" },
        { feedId: 4, roomTypeId: 10, hotelRoomId: 101, start: "2026-12-02", end: "2026-12-03" },
        { feedId: 5, roomTypeId: 20, hotelRoomId: null, start: "2026-11-25", end: "2026-12-02" }, // recortado al rango
      ],
      "2026-12-01",
      "2026-12-05",
    );
    expect(Object.fromEntries(m.get(10)!)).toEqual({ "2026-12-01": 1, "2026-12-02": 3, "2026-12-03": 1 });
    expect(Object.fromEntries(m.get(20)!)).toEqual({ "2026-12-01": 1 });
  });
});

// ─── Tokens ──────────────────────────────────────────────────────────────────

describe("enlaces de exportación", () => {
  it("token derivado de 43 caracteres, distinto por empresa y semilla; la huella no contiene el token", () => {
    const key = "clave-de-pruebas-ical-no-real-0000000000";
    const n = newExportNonce();
    const t = deriveExportToken(n, "empresa-a", key);
    expect(t).toMatch(ICAL_TOKEN_RE);
    expect(ICAL_FILE_RE.exec(`${t}.ics`)?.[1]).toBe(t);
    expect(deriveExportToken(n, "empresa-a", key)).toBe(t);
    expect(deriveExportToken(n, "empresa-b", key)).not.toBe(t);
    expect(deriveExportToken(newExportNonce(), "empresa-a", key)).not.toBe(t);
    expect(exportTokenHash(t, "empresa-a")).not.toBe(exportTokenHash(t, "empresa-b"));
    expect(exportTokenHash(t, "empresa-a")).not.toContain(t);
    for (const bad of [`${t}.ICS`, `${t}`, `${t}.ics.ics`, `../${t}.ics`, `${t.slice(1)}.ics`]) expect(ICAL_FILE_RE.test(bad)).toBe(false);
  });
});

// ─── SSRF ────────────────────────────────────────────────────────────────────

describe("protección SSRF", () => {
  it("direcciones: solo públicas", () => {
    for (const ip of ["8.8.8.8", "151.101.1.140", "2a00:1450:4003:80e::200e", "2001:4860:4860::8888"]) expect(isPublicAddress(ip), ip).toBe(true);
    for (const ip of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "192.0.2.5",
      "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "2001:db8::1", "2002:c0a8:101::1", "no-es-ip",
    ]) expect(isPublicAddress(ip), ip).toBe(false);
  });

  it("URL: solo https al 443, sin credenciales ni máquinas locales; webcal se trata como https", () => {
    expect(normalizeFeedUrl("webcal://calendar.example.org/ical/abc.ics")).toEqual({ ok: true, url: "https://calendar.example.org/ical/abc.ics" });
    expect(normalizeFeedUrl(" https://admin.booking.example/hotel/ical.html?t=x#frag ")).toEqual({ ok: true, url: "https://admin.booking.example/hotel/ical.html?t=x" });
    for (const [u, msg] of [
      ["http://calendar.example.org/a.ics", /https/], ["ftp://x.example/a", /https/], ["file:///etc/passwd", /https/], ["https://user:pw@x.example/a", /usuario/],
      ["https://x.example:8443/a", /puerto/], ["https://localhost/a", /público/], ["https://intranet/a", /público/], ["https://db.internal/a", /público/],
      ["https://127.0.0.1/a", /privada/], ["https://[::1]/a", /privada/], ["https://169.254.169.254/latest/meta-data", /privada/], ["https://2130706433/a", /privada/],
      ["no es una url", /no es válida/], ["", /Pega/],
    ] as const) {
      const r = normalizeFeedUrl(u);
      expect(r.ok, u).toBe(false);
      expect((r as { error: string }).error, u).toMatch(msg);
    }
  });

  it("DNS: si alguna dirección del nombre no es pública, no se conecta", async () => {
    const url = new URL("https://calendario.example.org/a.ics");
    await expect(resolvePublicTarget(url, async () => [{ address: "93.184.216.34", family: 4 }])).resolves.toEqual({ address: "93.184.216.34", family: 4 });
    await expect(resolvePublicTarget(url, async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }])).rejects.toThrow(/privada/);
    await expect(resolvePublicTarget(url, async () => [{ address: "::ffff:127.0.0.1", family: 6 }])).rejects.toThrow(/privada/);
    await expect(resolvePublicTarget(url, async () => [])).rejects.toThrow(/No se encuentra/);
  });

  it("descarga: conecta a la IP validada, sigue redirecciones públicas y rechaza las privadas, http y el exceso", async () => {
    const dnsTable: Record<string, string> = { "canal.example.org": "93.184.216.34", "cdn.example.net": "151.101.1.140", "trampa.example.org": "192.168.0.10" };
    const resolve = async (h: string) => (dnsTable[h] ? [{ address: dnsTable[h], family: 4 as const }] : []);
    const seen: string[] = [];
    const get = (routes: Record<string, { status: number; location?: string; body?: string }>): HopGetter => async (url, address) => {
      seen.push(`${url.host}@${address.address}`);
      const r = routes[url.toString()] ?? { status: 404 };
      return { status: r.status, location: r.location ?? null, body: r.body ?? "" };
    };
    const ok = await fetchIcal("https://canal.example.org/a.ics", {
      resolve,
      get: get({ "https://canal.example.org/a.ics": { status: 302, location: "https://cdn.example.net/b.ics" }, "https://cdn.example.net/b.ics": { status: 200, body: BOOKING } }),
    });
    expect(ok).toEqual({ ok: true, body: BOOKING });
    expect(seen).toEqual(["canal.example.org@93.184.216.34", "cdn.example.net@151.101.1.140"]);

    const toPrivate = await fetchIcal("https://canal.example.org/a.ics", { resolve, get: get({ "https://canal.example.org/a.ics": { status: 301, location: "https://trampa.example.org/x" } }) });
    expect(toPrivate).toEqual({ ok: false, error: expect.stringMatching(/privada/) });
    const toIp = await fetchIcal("https://canal.example.org/a.ics", { resolve, get: get({ "https://canal.example.org/a.ics": { status: 307, location: "https://169.254.169.254/latest" } }) });
    expect(toIp).toEqual({ ok: false, error: expect.stringMatching(/Redirección no admitida.*privada/) });
    const toHttp = await fetchIcal("https://canal.example.org/a.ics", { resolve, get: get({ "https://canal.example.org/a.ics": { status: 302, location: "http://cdn.example.net/b.ics" } }) });
    expect(toHttp).toEqual({ ok: false, error: expect.stringMatching(/Redirección no admitida.*https/) });
    const loop = await fetchIcal("https://canal.example.org/a.ics", { resolve, get: get({ "https://canal.example.org/a.ics": { status: 302, location: "/a.ics" } }) });
    expect(loop).toEqual({ ok: false, error: "Demasiadas redirecciones." });
    expect(await fetchIcal("https://canal.example.org/a.ics", { resolve, get: get({}) })).toEqual({ ok: false, error: expect.stringMatching(/404/) });
    expect(await fetchIcal("https://desconocido.example.org/a.ics", { resolve, get: get({}) })).toEqual({ ok: false, error: expect.stringMatching(/No se encuentra/) });
  });

  it("tiempo máximo: una descarga colgada se corta", async () => {
    const hang: HopGetter = (_u, _a, o) => new Promise((_, reject) => o.signal.addEventListener("abort", () => reject(Object.assign(new Error("abort"), { name: "AbortError" }))));
    const r = await fetchIcal("https://canal.example.org/a.ics", { resolve: async () => [{ address: "93.184.216.34", family: 4 }], get: hang, timeoutMs: 30 });
    expect(r).toEqual({ ok: false, error: "El canal no ha respondido a tiempo." });
  });

  it("el panel enseña la URL del canal enmascarada (lleva su propio secreto)", () => {
    expect(maskUrl("https://admin.booking.example/hotel/hoteladmin/ical.html?t=secreto-del-canal")).toBe("admin.booking.example/hotel/hot…l.html?…");
    expect(maskUrl("https://admin.booking.example/hotel/hoteladmin/ical.html?t=secreto-del-canal")).not.toContain("secreto");
    expect(maskUrl("https://www.airbnb.example/calendar/ical/123.ics?s=abcdef")).not.toContain("abcdef");
  });
});

// ─── Ruta pública ────────────────────────────────────────────────────────────

describe("GET /ical/<token>.ics", () => {
  let server: http.Server;
  let port = 0;
  const token = "A".repeat(43);
  beforeAll(async () => {
    const app = express();
    app.use(createNetPublicRouter({ icalPerIpPerMinute: 1000 }));
    app.use("/lim", createNetPublicRouter({ icalPerIpPerMinute: 2 }));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    ical.available = true;
    ical.link = { id: 1 };
    ical.body = buildCalendar({ name: "Doble", seed: "1:x", ranges: [{ start: "2026-12-01", end: "2026-12-02" }] });
    ical.tokens.length = 0;
  });
  const get = (path: string) =>
    new Promise<{ status: number; text: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      http.get({ host: "127.0.0.1", port, path }, (res) => {
        let t = "";
        res.on("data", (c) => (t += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: t, headers: res.headers }));
      }).on("error", reject);
    });

  it("enlace válido: text/calendar, sin caché ni indexación, el VCALENDAR tal cual", async () => {
    const r = await get(`/ical/${token}.ics`);
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/^text\/calendar; charset=utf-8/);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["x-robots-tag"]).toMatch(/noindex/);
    expect(r.text).toBe(ical.body);
    expect(ical.tokens).toEqual([token]);
  });

  it("formato no válido: misma respuesta que un enlace inexistente o revocado, sin consultar la BD", async () => {
    ical.link = null;
    const missing = await get(`/ical/${token}.ics`);
    expect(missing.status).toBe(404);
    expect(ical.tokens).toEqual([token]);
    ical.tokens.length = 0;
    for (const p of [`/ical/${token}`, `/ical/${token}.ICS`, `/ical/${token.slice(1)}.ics`, "/ical/..%2F..%2Fetc.ics", `/ical/${token}.ics.txt`]) {
      const r = await get(p);
      expect(r.status, p).toBe(404);
      expect(r.text, p).toBe(missing.text);
    }
    expect(ical.tokens).toEqual([]);
    // Rutas sensibles a mayúsculas
    expect((await get(`/ICAL/${token}.ics`)).status).toBe(404);
  });

  it("sin Hotel Net en la empresa del dominio: no disponible (sin mirar el token)", async () => {
    ical.available = false;
    const r = await get(`/ical/${token}.ics`);
    expect(r.status).toBe(404);
    expect(r.text).toMatch(/no está disponible/);
    expect(ical.tokens).toEqual([]);
  });

  it("límite por IP (429)", async () => {
    expect((await get(`/lim/ical/${token}.ics`)).status).toBe(200);
    expect((await get(`/lim/ical/${token}.ics`)).status).toBe(200);
    expect((await get(`/lim/ical/${token}.ics`)).status).toBe(429);
  });
});
