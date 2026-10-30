/**
 * Registro de dispositivos y aviso de «nuevo inicio de sesión» (`security.new_login`) de los usuarios de la empresa
 * en curso (tabla `user_devices` de db/migrations/0016_user_devices.sql, en la base de cada empresa).
 *
 *  - Huella: SHA-256 de una cookie de dispositivo persistente y aleatoria más el navegador y el sistema normalizados
 *    (sin versiones: una actualización del navegador no es un dispositivo nuevo). No se guarda la IP ni el
 *    user-agent completo; solo una etiqueta aproximada («Chrome en Windows»).
 *  - Idempotencia por usuario y dispositivo: clave única (usuario, huella) y `notified_at` reclamado de forma
 *    atómica. Un dispositivo avisa una sola vez.
 *  - El PRIMER dispositivo que se registra de un usuario no avisa (punto de partida: al desplegar, nadie recibe un
 *    aviso por su dispositivo de siempre). A partir de ahí, cada dispositivo nuevo avisa.
 *  - Nunca bloquea ni retrasa el inicio de sesión: la cookie se fija de forma síncrona y el registro y el aviso van
 *    en segundo plano; cualquier fallo (sin tabla, sin base, sin correo) solo deja una traza sin datos personales.
 */
import crypto from "node:crypto";
import type { CookieOptions, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { getTenantDatabase } from "../_core/dbRegistry";
import { parseCookieHeader } from "../_core/sessionCookie";
import { getTrustedBaseUrl } from "../_core/publicUrl";
import { opsLog } from "../_core/ops/log";
import { brandName } from "../tenantBrand";
import { newLoginContent } from "../mail/accountSecurityTemplates";
import type { MailParams } from "../mailer";

export const DEVICE_COOKIE_HOST = "__Host-be_device";
export const DEVICE_COOKIE_LEGACY = "be_device";
/** 400 días: el máximo que admiten los navegadores para una cookie persistente. */
const DEVICE_COOKIE_MAX_AGE_MS = 400 * 86_400_000;
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{43}$/;

// ─── Huella y etiqueta ─────────────────────────────────────────────────────────

/** Navegador y sistema sin versiones, a partir del user-agent. Nunca devuelve el user-agent original. */
export function describeUserAgent(ua: string | null | undefined): { key: string; label: string } {
  const s = String(ua ?? "").slice(0, 512);
  const browser =
    /Edg(e|A|iOS)?\//.test(s) ? "Edge"
    : /OPR\/|Opera/.test(s) ? "Opera"
    : /SamsungBrowser\//.test(s) ? "Samsung Internet"
    : /Firefox\/|FxiOS\//.test(s) ? "Firefox"
    : /Chrome\/|CriOS\//.test(s) ? "Chrome"
    : /Safari\//.test(s) && /Version\//.test(s) ? "Safari"
    : null;
  const os =
    /iPhone/.test(s) ? "iPhone"
    : /iPad/.test(s) ? "iPad"
    : /Android/.test(s) ? "Android"
    : /CrOS/.test(s) ? "ChromeOS"
    : /Windows/.test(s) ? "Windows"
    : /Mac OS X|Macintosh/.test(s) ? "macOS"
    : /Linux/.test(s) ? "Linux"
    : null;
  const label = browser && os ? `${browser} en ${os}` : browser ?? (os ? `Navegador en ${os}` : "Navegador desconocido");
  return { key: `${browser ?? "?"}|${os ?? "?"}`.toLowerCase(), label };
}

/** Huella del dispositivo: hash de la cookie de dispositivo y del navegador y sistema normalizados. */
export function deviceFingerprint(deviceId: string, userAgent: string | null | undefined): string {
  return crypto.createHash("sha256").update(`dev:v1:${deviceId}|${describeUserAgent(userAgent).key}`).digest("hex");
}

/** Cookie de dispositivo de la petición (por HTTPS, solo la `__Host-`: no la puede fijar otro host). */
export function readDeviceId(req: Pick<Request, "headers" | "secure">): string | null {
  const cookies = parseCookieHeader(req.headers.cookie);
  const v = req.secure ? cookies[DEVICE_COOKIE_HOST] : cookies[DEVICE_COOKIE_LEGACY] ?? cookies[DEVICE_COOKIE_HOST];
  return v && DEVICE_ID_RE.test(v) ? v : null;
}

/** Huella del dispositivo de la petición en curso (sin cookie: `null`). */
export function currentFingerprint(req: Pick<Request, "headers" | "secure">): string | null {
  const id = readDeviceId(req);
  return id ? deviceFingerprint(id, req.headers["user-agent"]) : null;
}

function ensureDeviceCookie(req: Request, res: Response): string {
  const existing = readDeviceId(req);
  const id = existing ?? crypto.randomBytes(32).toString("base64url");
  const base: CookieOptions = { httpOnly: true, sameSite: "lax", path: "/", maxAge: DEVICE_COOKIE_MAX_AGE_MS };
  // Se renueva siempre (la caducidad corre desde el último inicio de sesión)
  if (req.secure) res.cookie(DEVICE_COOKIE_HOST, id, { ...base, secure: true });
  else res.cookie(DEVICE_COOKIE_LEGACY, id, base);
  return id;
}

// ─── Almacén ───────────────────────────────────────────────────────────────────

export interface DeviceRow {
  id: number;
  fingerprint: string;
  label: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface DeviceStore {
  /** Registra el dispositivo (o actualiza su última vez). `true` si es la primera vez que se ve. */
  touch(userId: number, fingerprint: string, label: string): Promise<boolean>;
  /** Dispositivos del usuario distintos de este. */
  countOthers(userId: number, fingerprint: string): Promise<number>;
  /** Reclama el aviso de este dispositivo (una sola vez). `true` si lo reclama esta llamada. */
  claimNotice(userId: number, fingerprint: string): Promise<boolean>;
  list(userId: number): Promise<DeviceRow[]>;
  forget(userId: number, id: number): Promise<boolean>;
  contact(userId: number): Promise<{ email: string | null; name: string | null; isActive: boolean } | null>;
}

/** Tabla ausente (empresa aún sin la migración 0016). */
export class DevicesUnavailableError extends Error {
  constructor() {
    super("Registro de dispositivos no disponible");
  }
}
const missingTable = (e: unknown) => /ER_NO_SUCH_TABLE|doesn't exist/i.test(String((e as { code?: string }).code ?? "") + String((e as Error)?.message ?? ""));
const affected = (r: unknown) => Number(((Array.isArray(r) ? r[0] : r) as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
const rowsOf = (r: unknown) => ((Array.isArray(r) ? r[0] : r) as Array<Record<string, unknown>>) ?? [];
const toDate = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));

type Db = NonNullable<Awaited<ReturnType<typeof getTenantDatabase>>>;

/** Almacén real: la base de la empresa en curso (cada empresa, su propia tabla). */
export function sqlDeviceStore(resolve: () => Promise<Db | null> = () => getTenantDatabase()): DeviceStore {
  const run = async <T>(fn: (d: Db) => Promise<T>): Promise<T> => {
    const d = await resolve();
    if (!d) throw new DevicesUnavailableError();
    try {
      return await fn(d);
    } catch (e) {
      if (missingTable(e)) throw new DevicesUnavailableError();
      throw e;
    }
  };
  return {
    touch: (userId, fp, label) =>
      run(async (d) => {
        const ins = await d.execute(sql`INSERT IGNORE INTO user_devices (user_id, fingerprint, label) VALUES (${userId}, ${fp}, ${label})`);
        if (affected(ins) === 1) return true;
        await d.execute(sql`UPDATE user_devices SET last_seen_at = CURRENT_TIMESTAMP(3), label = ${label} WHERE user_id = ${userId} AND fingerprint = ${fp}`);
        return false;
      }),
    countOthers: (userId, fp) =>
      run(async (d) => Number(rowsOf(await d.execute(sql`SELECT COUNT(*) AS n FROM user_devices WHERE user_id = ${userId} AND fingerprint <> ${fp}`))[0]?.n ?? 0)),
    claimNotice: (userId, fp) =>
      run(async (d) => affected(await d.execute(sql`UPDATE user_devices SET notified_at = CURRENT_TIMESTAMP(3) WHERE user_id = ${userId} AND fingerprint = ${fp} AND notified_at IS NULL`)) === 1),
    list: (userId) =>
      run(async (d) =>
        rowsOf(await d.execute(sql`SELECT id, fingerprint, label, first_seen_at, last_seen_at FROM user_devices WHERE user_id = ${userId} ORDER BY last_seen_at DESC LIMIT 50`)).map((r) => ({
          id: Number(r.id),
          fingerprint: String(r.fingerprint),
          label: String(r.label),
          firstSeenAt: toDate(r.first_seen_at),
          lastSeenAt: toDate(r.last_seen_at),
        })),
      ),
    forget: (userId, id) => run(async (d) => affected(await d.execute(sql`DELETE FROM user_devices WHERE id = ${id} AND user_id = ${userId}`)) === 1),
    contact: (userId) =>
      run(async (d) => {
        const r = rowsOf(await d.execute(sql`SELECT email, name, isActive FROM users WHERE id = ${userId} LIMIT 1`))[0];
        return r ? { email: r.email ? String(r.email) : null, name: r.name ? String(r.name) : null, isActive: !!Number(r.isActive) } : null;
      }),
  };
}

// ─── Registro e inicio de sesión ───────────────────────────────────────────────

export interface DeviceDeps {
  store: DeviceStore;
  send: (m: MailParams) => Promise<boolean>;
  brand: () => string;
  baseUrl: () => string;
  now: () => Date;
}

export type LoginDeviceOutcome = "notified" | "known" | "first_device" | "not_sent" | "unavailable";

/** Registra el dispositivo de un inicio de sesión correcto y, si es nuevo para el usuario, le avisa una vez. */
export async function processLoginDevice(deps: DeviceDeps, i: { userId: number; fingerprint: string; label: string }): Promise<LoginDeviceOutcome> {
  try {
    const isNew = await deps.store.touch(i.userId, i.fingerprint, i.label);
    if (!isNew) return "known";
    if ((await deps.store.countOthers(i.userId, i.fingerprint)) === 0) return "first_device";
    if (!(await deps.store.claimNotice(i.userId, i.fingerprint))) return "known";
    const who = await deps.store.contact(i.userId);
    if (!who?.email || !who.isActive) return "not_sent";
    const m = newLoginContent({ brand: deps.brand(), name: who.name, at: deps.now(), device: i.label, changePasswordUrl: `${deps.baseUrl()}/recuperar-contrasena` });
    const ok = await deps.send({ to: who.email, subject: m.subject, html: m.html, text: m.text, category: "security_notice", idempotencyKey: `security.new_login:${i.userId}:${i.fingerprint.slice(0, 32)}` });
    return ok ? "notified" : "not_sent";
  } catch (e) {
    if (e instanceof DevicesUnavailableError) return "unavailable";
    throw e;
  }
}

async function defaultSend(m: MailParams): Promise<boolean> {
  const { sendEmail } = await import("../mailer");
  return sendEmail(m);
}

export const defaultDeviceDeps = (): DeviceDeps => ({ store: sqlDeviceStore(), send: defaultSend, brand: brandName, baseUrl: getTrustedBaseUrl, now: () => new Date() });

/**
 * Punto de enganche del inicio de sesión (contraseña o pase del acceso centralizado): fija la cookie de dispositivo
 * de forma síncrona y registra y avisa en segundo plano. Nunca lanza ni espera: el inicio de sesión no depende de esto.
 */
export function trackLoginDevice(req: Request, res: Response, userId: number, deps: () => DeviceDeps = defaultDeviceDeps): void {
  try {
    if (!Number.isInteger(userId) || userId <= 0) return;
    const deviceId = ensureDeviceCookie(req, res);
    const ua = req.headers["user-agent"];
    const fingerprint = deviceFingerprint(deviceId, ua);
    const { label } = describeUserAgent(ua);
    void Promise.resolve()
      .then(() => processLoginDevice(deps(), { userId, fingerprint, label }))
      .then(
        (outcome) => {
          if (outcome === "unavailable" || outcome === "not_sent") opsLog("warn", "Auth", "login_device", { outcome });
        },
        (e: unknown) => opsLog("warn", "Auth", "login_device_failed", { error: e instanceof Error ? e.name : "error" }),
      );
  } catch (e) {
    opsLog("warn", "Auth", "login_device_failed", { error: e instanceof Error ? e.name : "error" });
  }
}

/** Dispositivos del usuario para su perfil (marca el de la petición en curso; nunca devuelve la huella). */
export async function listMyDevices(store: DeviceStore, userId: number, current: string | null) {
  try {
    const rows = await store.list(userId);
    return { available: true, devices: rows.map((r) => ({ id: r.id, label: r.label, firstSeenAt: r.firstSeenAt.toISOString(), lastSeenAt: r.lastSeenAt.toISOString(), current: r.fingerprint === current })) };
  } catch (e) {
    if (e instanceof DevicesUnavailableError) return { available: false, devices: [] };
    throw e;
  }
}
