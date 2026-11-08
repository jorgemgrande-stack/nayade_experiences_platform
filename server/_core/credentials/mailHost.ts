/**
 * Servidores de correo (IMAP) que escribe la empresa: protección SSRF. Antes de conectar se resuelve el nombre y se
 * rechaza cualquier destino que no sea una dirección pública de Internet (loopback, privadas, enlace local con
 * 169.254.169.254, CGNAT, ULA, reservadas…) y los nombres internos (`localhost`, `*.railway.internal`, `*.internal`,
 * `*.local`). La conexión se hace a la IP ya validada, con el nombre original como SNI y para validar el certificado:
 * así un DNS que cambie entre la comprobación y la conexión (DNS rebinding) no lleva a otra máquina.
 */
import dns from "node:dns/promises";
import net from "node:net";
import { isPublicAddress } from "../../hotelIcal";

export class MailHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailHostError";
  }
}

export type HostResolver = (hostname: string) => Promise<string[]>;

export const systemHostResolver: HostResolver = async (hostname) => (await dns.lookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

const INTERNAL_NAME_RE = /(^|\.)(localhost|internal|local|localdomain)$/i;

const PRIVATE_MESSAGE = "El servidor de correo apunta a una dirección privada o interna: escribe el servidor público de tu proveedor.";

export interface MailHostTarget {
  /** IP pública validada a la que se conecta. */
  address: string;
  /** Nombre para SNI y para validar el certificado (undefined si se escribió una IP). */
  servername: string | undefined;
}

/** Problema del nombre sin resolverlo (formato o nombre interno); null si no hay ninguno. */
export function mailHostNameProblem(raw: string): string | null {
  const host = raw.trim().replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host) return "Falta el servidor de correo.";
  if (net.isIP(host)) return isPublicAddress(host) ? null : PRIVATE_MESSAGE;
  if (INTERNAL_NAME_RE.test(host) || !host.includes(".")) return PRIVATE_MESSAGE;
  return null;
}

/** Resuelve el servidor y devuelve la IP pública a la que conectar, o lanza MailHostError. */
export async function resolveMailHost(raw: string, resolve: HostResolver = systemHostResolver): Promise<MailHostTarget> {
  const problem = mailHostNameProblem(raw);
  if (problem) throw new MailHostError(problem);
  const host = raw.trim().replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (net.isIP(host)) return { address: host, servername: undefined };
  let list: string[];
  try {
    list = await resolve(host);
  } catch {
    throw new MailHostError(`No se encuentra el servidor ${host}: revisa que esté bien escrito.`);
  }
  if (!list.length) throw new MailHostError(`No se encuentra el servidor ${host}: revisa que esté bien escrito.`);
  // Basta una dirección interna para rechazarlo (si no, un DNS con varias respuestas podría colarla)
  if (list.some((a) => !isPublicAddress(a))) throw new MailHostError(PRIVATE_MESSAGE);
  return { address: list[0], servername: host };
}
