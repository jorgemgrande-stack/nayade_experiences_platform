/**
 * Antifuerza bruta por cuenta (complementa el límite por IP de `/api/auth/login`).
 *
 * Tras `MAX_FAILURES` fallos de una misma cuenta (empresa + email) en `WINDOW_MS`, la cuenta queda
 * bloqueada `LOCK_MS` aunque los intentos lleguen desde IP distintas. Se aplica igual a emails que
 * no existen (no revela qué cuentas hay). Un acierto limpia el contador.
 *
 * Memoria del proceso, acotada: con varias réplicas el límite es por réplica (pendiente: almacén
 * compartido). No se registran emails ni contraseñas.
 */
import { createHash } from "crypto";
import { getTenantIdOrDefault } from "./tenant";

export const MAX_FAILURES = 10;
export const WINDOW_MS = 15 * 60_000;
export const LOCK_MS = 15 * 60_000;
const MAX_ENTRIES = 20_000;

type Entry = { failures: number; firstAt: number; lockedUntil: number };
const entries = new Map<string, Entry>();

function keyFor(email: string): string {
  // Hash: el mapa no guarda emails en claro
  return createHash("sha256").update(`${getTenantIdOrDefault()}\u0000${email.trim().toLowerCase()}`).digest("base64url");
}

function prune(now: number) {
  if (entries.size < MAX_ENTRIES) return;
  entries.forEach((e, k) => {
    if (e.lockedUntil < now && now - e.firstAt > WINDOW_MS) entries.delete(k);
  });
  // Si aún está lleno, se descartan los más antiguos (orden de inserción)
  while (entries.size >= MAX_ENTRIES) {
    const first = entries.keys().next().value;
    if (first === undefined) break;
    entries.delete(first);
  }
}

/** Milisegundos de bloqueo restantes (0 = puede intentarlo). */
export function loginLockRemaining(email: string, now = Date.now()): number {
  const e = entries.get(keyFor(email));
  return e && e.lockedUntil > now ? e.lockedUntil - now : 0;
}

export function recordLoginFailure(email: string, now = Date.now()): void {
  const k = keyFor(email);
  let e = entries.get(k);
  if (!e || now - e.firstAt > WINDOW_MS) {
    prune(now);
    e = { failures: 0, firstAt: now, lockedUntil: 0 };
    entries.set(k, e);
  }
  e.failures += 1;
  if (e.failures >= MAX_FAILURES) {
    e.lockedUntil = now + LOCK_MS;
    e.failures = 0;
    e.firstAt = now;
  }
}

export function recordLoginSuccess(email: string): void {
  entries.delete(keyFor(email));
}

/** Solo para pruebas. */
export function resetLoginThrottle(): void {
  entries.clear();
}
