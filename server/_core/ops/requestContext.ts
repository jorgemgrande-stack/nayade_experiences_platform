/**
 * Identificador de correlación por petición (`X-Request-Id`).
 *
 *  - Se acepta el valor entrante SOLO si es seguro (8–64 caracteres de [A-Za-z0-9._:-]); si no, se
 *    genera uno nuevo. Nunca se refleja tal cual un valor arbitrario (inyección en logs o cabeceras).
 *  - Se devuelve siempre en la respuesta y viaja en AsyncLocalStorage para que `opsLog` lo añada a
 *    cada línea de log de la petición.
 *  - AsyncLocalStorage no atraviesa de forma fiable la lectura del cuerpo (callbacks de streams): por
 *    eso hay un segundo middleware, `rebindRequestContext`, que se monta después de los parsers.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const REQUEST_ID_HEADER = "X-Request-Id";

const SAFE_ID = /^[A-Za-z0-9._:-]{8,64}$/;

const storage = new AsyncLocalStorage<{ requestId: string }>();
const byRequest = new WeakMap<Request, string>();

/** Devuelve el identificador entrante si es seguro; si no, `null`. */
export function sanitizeRequestId(raw: unknown): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" && SAFE_ID.test(v) ? v : null;
}

export function newRequestId(): string {
  return randomUUID();
}

/** Identificador de la petición en curso (o `undefined` fuera de una petición). */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Identificador asignado a una petición concreta (sirve aunque se haya perdido el contexto). */
export function requestIdOf(req: Request): string | undefined {
  return byRequest.get(req);
}

/** Ejecuta `fn` con un identificador de correlación (tareas, pruebas). */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

/** Primer middleware: asigna el identificador, lo devuelve en la respuesta y abre el contexto. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = sanitizeRequestId(req.headers["x-request-id"]) ?? newRequestId();
  byRequest.set(req, id);
  res.setHeader(REQUEST_ID_HEADER, id);
  storage.run({ requestId: id }, next);
}

/** Tras los parsers del cuerpo: vuelve a entrar en el contexto de la petición. */
export function rebindRequestContext(req: Request, _res: Response, next: NextFunction): void {
  const id = byRequest.get(req);
  if (!id || storage.getStore()?.requestId === id) return next();
  storage.run({ requestId: id }, next);
}
