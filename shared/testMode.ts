/**
 * Modo de pruebas de formularios y CRM sin salidas externas.
 *
 * Solo lo activa un administrador autenticado (procedimiento propio); el camino público nunca lee un indicador de prueba.
 * Como defensa en profundidad, una solicitud de prueba solo se acepta con un correo de dominio reservado (RFC 2606 / 6761),
 * que no puede ser de una persona real.
 */
const RESERVED_TLDS = new Set(["invalid", "example", "test", "localhost"]);
const RESERVED_DOMAINS = new Set(["example.com", "example.org", "example.net"]);

export function isReservedTestEmail(email: unknown): boolean {
  if (typeof email !== "string") return false;
  const at = email.trim().toLowerCase().lastIndexOf("@");
  if (at < 1) return false;
  const domain = email.trim().toLowerCase().slice(at + 1);
  if (!domain || /[\s,;<>]/.test(domain)) return false;
  if (RESERVED_DOMAINS.has(domain)) return true;
  return RESERVED_TLDS.has(domain.slice(domain.lastIndexOf(".") + 1));
}

/** El aviso al propietario y las salidas externas solo se omiten en modo de prueba. */
export const sendsExternalNotices = (ctx: { testMode?: boolean }): boolean => ctx.testMode !== true;
