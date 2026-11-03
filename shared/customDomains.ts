/**
 * Dominios propios de las empresas: vista que el plano de control devuelve al panel (autoservicio) y utilidades de
 * nombres compartidas por el servidor y el cliente.
 */

/** Etapa visible de un dominio propio, en el orden del asistente. */
export const DOMAIN_STAGES = ["pending_verification", "pending_dns", "pending_certificate", "checking", "active", "error", "disconnected"] as const;
export type DomainStage = (typeof DOMAIN_STAGES)[number];

export const DOMAIN_STAGE_LABELS: Record<DomainStage, string> = {
  pending_verification: "Pendiente de verificación",
  pending_dns: "Pendiente de DNS",
  pending_certificate: "Pendiente de certificado",
  checking: "Comprobando",
  active: "Activo",
  error: "Error",
  disconnected: "Desconectado",
};

export interface DomainRecordView {
  type: "CNAME" | "TXT" | "A" | "NS";
  /** Nombre relativo a la zona, como lo piden los paneles DNS («www», «_elephant-verify.www»; «@» en la raíz). */
  name: string;
  /** Nombre completo. */
  fqdn: string;
  value: string;
  purpose: "ownership" | "traffic" | "certificate" | "other";
  /** ¿Se ve ya en el DNS público? */
  ok: boolean;
}

export interface CustomDomainView {
  domain: string;
  stage: DomainStage;
  primary: boolean;
  /** Dominio raíz (sin subdominio): muchos paneles DNS no admiten CNAME en la raíz. */
  apex: boolean;
  /** Zona DNS estimada (dominio registrable), donde se crean los registros. */
  zone: string;
  records: DomainRecordView[];
  certificate: "issued" | "pending" | "failed" | "unknown" | null;
  https: { ok: boolean; detail: string; checkedAt: string } | null;
  /** Qué falta o qué pasa, en una frase para la empresa. */
  message: string;
  createdAt: string;
  activatedAt: string | null;
  lastCheckedAt: string | null;
}

export interface DomainsOverview {
  /** Subdominio de plataforma: siempre disponible como respaldo. */
  fallback: string | null;
  /** Dominio principal (enlaces, correos, sitemap). */
  primary: string | null;
  domains: CustomDomainView[];
  allowance: { allowed: boolean; reason: string | null; max: number | null; used: number };
  /** ¿La plataforma da de alta los dominios en el proveedor automáticamente? Si no, el último paso lo completa soporte. */
  automatic: boolean;
}

/**
 * Sufijos públicos de dos niveles más habituales para las empresas clientes (España, Europa y Latinoamérica). No es
 * la lista pública completa: solo decide cómo se muestran los nombres relativos y el aviso de dominio raíz.
 */
const SECOND_LEVEL = new Set([
  "com.es", "org.es", "nom.es", "gob.es", "edu.es",
  "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk",
  "com.mx", "org.mx", "com.ar", "com.co", "com.pe", "com.br", "com.uy", "com.ec", "com.ve", "com.bo", "com.py", "cl.cl",
  "com.pt", "co.at", "or.at", "com.au", "net.au", "co.nz", "co.za", "com.tr",
]);

/** Dominio registrable (zona) de un nombre ya normalizado: «www.cliente.es» → «cliente.es». */
export function registrableDomain(domain: string): string {
  const labels = domain.split(".");
  if (labels.length <= 2) return domain;
  const lastTwo = labels.slice(-2).join(".");
  return SECOND_LEVEL.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

export const isApexDomain = (domain: string) => registrableDomain(domain) === domain;

/** Nombre relativo a la zona: («_elephant-verify.www.cliente.es», «cliente.es») → «_elephant-verify.www»; la zona → «@». */
export function relativeName(fqdn: string, zone: string): string {
  const f = fqdn.replace(/\.$/, "").toLowerCase();
  const z = zone.replace(/\.$/, "").toLowerCase();
  if (f === z) return "@";
  return f.endsWith(`.${z}`) ? f.slice(0, -(z.length + 1)) : f;
}
