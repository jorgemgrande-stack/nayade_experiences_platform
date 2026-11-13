/**
 * Protección SSRF de las descargas de la importación: bloquea redes privadas, loopback, enlace local (incluida la
 * dirección de metadatos de la nube 169.254.169.254), CGNAT, multicast y reservadas, en IPv4 e IPv6 (con las formas
 * mapeadas/embebidas que esconden una IPv4: ::ffff:a.b.c.d, 64:ff9b::/96, 6to4, Teredo).
 */
import net from "node:net";
import dns from "node:dns";

const v4 = new net.BlockList();
for (const [addr, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) v4.addSubnet(addr, bits, "ipv4");

const v6 = new net.BlockList();
v6.addAddress("::", "ipv6");
v6.addAddress("::1", "ipv6");
for (const [addr, bits] of [
  ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8], ["2001:db8::", 32], ["2001::", 32] /* Teredo */, ["2002::", 16] /* 6to4 */,
  ["100::", 64], ["64:ff9b:1::", 48],
] as const) v6.addSubnet(addr, bits, "ipv6");

/** Octetos de la IPv4 embebida en una IPv6 mapeada (::ffff:a.b.c.d o ::ffff:aabb:ccdd) o NAT64 (64:ff9b::/96), si la hay. */
function embeddedV4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const dotted = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return dotted[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

/** ¿Es una dirección IP que NO debe contactarse? Lo que no es una IP válida también se considera bloqueado. */
export function isBlockedAddress(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, "").split("%")[0];
  const family = net.isIP(clean);
  if (family === 4) return v4.check(clean, "ipv4");
  if (family === 6) {
    const inner = embeddedV4(clean);
    if (inner) return v4.check(inner, "ipv4");
    return v6.check(clean, "ipv6");
  }
  return true;
}

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".intranet"];

/** Motivo por el que un host (nombre o IP literal) se rechaza antes de resolverlo, o null. */
export function blockedHostReason(hostname: string): string | null {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h) return "host vacío";
  if (net.isIP(h)) return isBlockedAddress(h) ? "dirección IP de red privada, loopback o reservada" : null;
  if (BLOCKED_HOSTS.has(h) || BLOCKED_SUFFIXES.some((s) => h.endsWith(s))) return "nombre de host interno";
  if (!h.includes(".")) return "nombre de host sin dominio";
  return null;
}

export type Resolver = (hostname: string) => Promise<string[]>;

/** Resolución real (todas las direcciones, A y AAAA). */
export const systemResolver: Resolver = async (hostname) => {
  const all = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return all.map((a) => a.address);
};

/**
 * Resuelve el host y exige que TODAS sus direcciones sean públicas (una sola privada basta para rechazarlo). Devuelve la
 * dirección elegida: el cliente conecta a ESA IP (pinning), de modo que un DNS que cambie entre la comprobación y la
 * conexión (DNS rebinding) no puede llevar la petición a otra red.
 */
export async function resolvePublicAddress(hostname: string, resolver: Resolver = systemResolver, opts: { allowLoopback?: boolean } = {}): Promise<string> {
  // allowLoopback (solo pruebas): únicamente 127.0.0.0/8; el resto de redes privadas y reservadas sigue bloqueado
  const reason = opts.allowLoopback ? null : blockedHostReason(hostname);
  if (reason) throw new Error(`Destino no permitido (${reason})`);
  const bare = hostname.replace(/^[|]$/g, "");
  const addrs = net.isIP(bare) ? [bare] : await resolver(bare);
  if (!addrs.length) throw new Error("El host no se resuelve");
  const bad = (a: string) => isBlockedAddress(a) && !(opts.allowLoopback && net.isIPv4(a) && a.startsWith("127."));
  if (addrs.some(bad)) throw new Error("Destino no permitido (el host resuelve a una red privada o reservada)");
  return addrs[0];
}
