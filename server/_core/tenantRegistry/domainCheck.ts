/**
 * Dominios propios en el borde: qué puede servir la pasarela sin su autenticación básica y la prueba de extremo a
 * extremo que activa un dominio.
 *
 *  - `GET /_ops/public-host` (solo la pasarela, por la red privada: desde Internet `/_ops/*` responde 404 en Caddy).
 *    204 si el `Host` es un dominio PROPIO ACTIVO de una empresa servible; 403 en cualquier otro caso. Excepción: la
 *    ruta de comprobación (`X-Forwarded-Uri`, que fija la pasarela) de un dominio propio VERIFICADO aún sin activar.
 *  - `GET /.well-known/elephant-domain-check`: en un dominio propio verificado o activo devuelve un valor que solo
 *    depende de la empresa y del dominio. El plano de control lo pide por HTTPS antes de activar: prueba que el DNS,
 *    el certificado, la pasarela y el registro llevan ese dominio a ESA empresa.
 *
 * Nada de esto da acceso a datos: el valor no es secreto (la titularidad ya la probó el TXT) y la empresa sigue
 * saliendo solo del `Host` resuelto en el registro (tenantMiddleware.ts).
 */
import crypto from "node:crypto";
import type { RequestHandler } from "express";
import { normalizeHost } from "./host";
import type { TenantResolver } from "./resolver";
import type { TenantRegistryReader } from "./store";

export const PUBLIC_HOST_PATH = "/_ops/public-host";
export const DOMAIN_CHECK_PATH = "/.well-known/elephant-domain-check";

/** Valor de la comprobación HTTPS de un dominio (mismo cálculo en el Core y en el plano de control). */
export function domainCheckValue(tenantId: string, domain: string): string {
  return `elephant-domain-check=${crypto.createHash("sha256").update(`elephant-domain:${tenantId}:${domain}`).digest("hex").slice(0, 32)}`;
}

const CHECKABLE = new Set(["verified", "active"]);

export function createDomainCheckRouter(d: { resolver: Pick<TenantResolver, "resolveHost">; reader: Pick<TenantRegistryReader, "resolveDomain"> }): RequestHandler {
  /** Dominio propio verificado o activo de una empresa no eliminada (la comprobación previa a activarlo). */
  const checkable = async (rawHost: unknown) => {
    const host = normalizeHost(rawHost);
    const r = host ? await d.reader.resolveDomain(host) : null;
    if (!r || r.domain.kind !== "custom" || !CHECKABLE.has(r.domain.status)) return null;
    if (r.tenant.status === "deleted" || r.tenant.status === "deleting") return null;
    return r;
  };
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path === PUBLIC_HOST_PATH) {
      res.setHeader("Cache-Control", "no-store");
      const uri = String(req.headers["x-forwarded-uri"] ?? "").split("?")[0];
      const decide = async () => {
        if (uri === DOMAIN_CHECK_PATH) return !!(await checkable(req.headers.host));
        const out = await d.resolver.resolveHost(req.headers.host);
        return out.kind === "resolved" && out.tenant.domainKind === "custom";
      };
      decide().then(
        (ok) => void res.status(ok ? 204 : 403).end(),
        () => void res.status(403).end(),
      );
      return;
    }
    if (req.path === DOMAIN_CHECK_PATH) {
      res.setHeader("Cache-Control", "no-store");
      checkable(req.headers.host).then(
        (r) => (r ? void res.type("text/plain").send(domainCheckValue(r.tenant.id, r.domain.domain)) : void res.status(404).type("text/plain").send("Not found")),
        () => void res.status(503).type("text/plain").send("Service unavailable"),
      );
      return;
    }
    next();
  };
}
