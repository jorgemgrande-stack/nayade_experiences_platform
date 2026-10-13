/**
 * Verificación de titularidad de dominios propios: CNAME + TXT.
 *
 *  - CNAME: el dominio apunta al destino de la plataforma (donde terminan los certificados
 *    TLS, que gestiona el proveedor).
 *  - TXT: `_elephant-verify.<dominio>` contiene `elephant-verify=<token>`; prueba que quien
 *    registra el dominio controla su DNS.
 *
 * El resolvedor DNS es inyectable para poder probarlo sin red.
 */
import dns from "node:dns/promises";
import { normalizeHost } from "./host";

export const VERIFY_LABEL = "_elephant-verify";

export interface DnsLookup {
  resolveCname(host: string): Promise<string[]>;
  resolveTxt(host: string): Promise<string[][]>;
}

export const systemDns: DnsLookup = {
  resolveCname: (h) => dns.resolveCname(h),
  resolveTxt: (h) => dns.resolveTxt(h),
};

export interface VerificationResult {
  ok: boolean;
  cname: boolean;
  txt: boolean;
  /** Instrucciones para quien configura el DNS cuando no está listo. */
  pending: string[];
}

export function expectedTxtValue(token: string): string {
  return `elephant-verify=${token}`;
}

export async function verifyDomainOwnership(
  input: { domain: string; token: string; platformTarget: string },
  lookup: DnsLookup = systemDns,
): Promise<VerificationResult> {
  const domain = normalizeHost(input.domain);
  const target = normalizeHost(input.platformTarget);
  const pending: string[] = [];
  if (!domain || !target || !input.token) {
    return { ok: false, cname: false, txt: false, pending: ["Datos de verificación no válidos"] };
  }

  let cname = false;
  try {
    const records = await lookup.resolveCname(domain);
    cname = records.some((r) => normalizeHost(r) === target);
  } catch {
    cname = false;
  }
  if (!cname) pending.push(`Crea un registro CNAME de ${domain} hacia ${target}`);

  let txt = false;
  try {
    const records = await lookup.resolveTxt(`${VERIFY_LABEL}.${domain}`);
    const expected = expectedTxtValue(input.token);
    txt = records.some((chunks) => chunks.join("") === expected);
  } catch {
    txt = false;
  }
  if (!txt) {
    pending.push(`Crea un registro TXT en ${VERIFY_LABEL}.${domain} con el valor ${expectedTxtValue(input.token)}`);
  }

  return { ok: cname && txt, cname, txt, pending };
}
