/**
 * Clases de objetos y política de acceso por categoría.
 *
 *  - PÚBLICOS AUTORIZADOS: recursos que la web de la empresa muestra a cualquier visitante (imágenes de
 *    catálogo y CMS, logotipos, cartas de restaurante, imágenes del blog, imágenes generadas).
 *    Se sirven por `/files/<id>/<nombre>` solo en el host de su empresa, con caché.
 *  - PRIVADOS: todo lo demás (facturas, presupuestos, contratos, justificantes, documentos de clientes
 *    y empleados, adjuntos, exportaciones, documentos internos). Se sirven por `/api/files/<id>` tras
 *    comprobar en servidor sesión, usuario activo, permiso y empresa; o con un enlace firmado del Core.
 *
 * El bucket es SIEMPRE privado: ninguna categoría depende de una URL pública del proveedor.
 */
import type { DetectedType } from "./contentType";

export type Visibility = "public" | "private";

export interface CategoryPolicy {
  visibility: Visibility;
  /** Permiso RBAC y roles heredados que pueden leer (solo privados). */
  permission: string;
  fallbackRoles: string[];
  /** Tamaño máximo propio (se aplica el menor entre este y STORAGE_MAX_BYTES). */
  maxBytes: number;
  /** Tipos admitidos (detectados por contenido). */
  types: readonly DetectedType[];
}

const MB = 1024 * 1024;
const IMAGES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"] as const;
const PUBLIC_IMAGES = [...IMAGES, "image/svg+xml"] as const;
const DOCS = [
  ...IMAGES,
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.ms-excel",
  "application/x-ole-storage",
] as const;
const PROOFS = [...IMAGES, "application/pdf"] as const;
/** Documentos que genera el propio servidor (PDF, o HTML de respaldo si falla el PDF). */
const GENERATED_DOCS = ["application/pdf", "text/html"] as const;
const ATTACHMENTS = [...DOCS, "application/xml", "text/plain", "text/csv", "application/zip"] as const;

const STAFF = { permission: "crm.view", fallbackRoles: ["admin", "agente", "readonly"] };
const ACCOUNTING = { permission: "accounting.expenses.view", fallbackRoles: ["admin"] };
const HR = { permission: "hr.view", fallbackRoles: ["admin"] };
const ADMIN = { permission: "settings.manage", fallbackRoles: ["admin"] };

export const CATEGORIES = {
  // Públicos autorizados
  media: { visibility: "public", ...ADMIN, maxBytes: 10 * MB, types: PUBLIC_IMAGES },
  "restaurant-menu": { visibility: "public", ...ADMIN, maxBytes: 15 * MB, types: [...IMAGES, "application/pdf"] },
  generated: { visibility: "public", ...ADMIN, maxBytes: 10 * MB, types: IMAGES },
  // Privados: documentos comerciales del equipo
  invoice: { visibility: "private", ...STAFF, maxBytes: 20 * MB, types: GENERATED_DOCS },
  quote: { visibility: "private", ...STAFF, maxBytes: 20 * MB, types: GENERATED_DOCS },
  reservation: { visibility: "private", ...STAFF, maxBytes: 20 * MB, types: GENERATED_DOCS },
  voucher: { visibility: "private", ...STAFF, maxBytes: 20 * MB, types: ["application/pdf"] },
  "transfer-proof": { visibility: "private", ...STAFF, maxBytes: 10 * MB, types: PROOFS },
  "partner-proof": { visibility: "private", ...STAFF, maxBytes: 8 * MB, types: PROOFS },
  coupon: { visibility: "private", permission: "crm.view", fallbackRoles: ["admin"], maxBytes: 10 * MB, types: PROOFS },
  // Privados: contabilidad
  expense: { visibility: "private", ...ACCOUNTING, maxBytes: 20 * MB, types: ATTACHMENTS },
  settlement: { visibility: "private", ...ACCOUNTING, maxBytes: 20 * MB, types: GENERATED_DOCS },
  "gestoria-export": { visibility: "private", ...ACCOUNTING, maxBytes: 200 * MB, types: ["application/zip"] },
  // Privados: personas
  "hr-doc": { visibility: "private", ...HR, maxBytes: 20 * MB, types: DOCS },
  "hr-photo": { visibility: "private", ...HR, maxBytes: 5 * MB, types: IMAGES },
  // Privado por defecto (documentos internos)
  internal: { visibility: "private", ...ADMIN, maxBytes: 20 * MB, types: ATTACHMENTS },
} as const satisfies Record<string, CategoryPolicy>;

export type FileCategory = keyof typeof CATEGORIES;

export function isCategory(c: unknown): c is FileCategory {
  return typeof c === "string" && Object.prototype.hasOwnProperty.call(CATEGORIES, c);
}

export function policyOf(c: string): CategoryPolicy {
  return (isCategory(c) ? CATEGORIES[c] : CATEGORIES.internal) as CategoryPolicy;
}

/**
 * Categoría por defecto a partir de la clave heredada que pasaban los llamadores (`invoices/…`,
 * `nayade/uploads/…`). Solo se usa si el llamador no la indica; lo desconocido es PRIVADO.
 */
export function categoryFromLegacyKey(relKey: string): FileCategory {
  const k = relKey.replace(/^\/+/, "");
  const rules: Array<[RegExp, FileCategory]> = [
    [/^nayade\/uploads\//, "media"],
    [/^nayade\/restaurants\/menus\//, "restaurant-menu"],
    [/^generated\//, "generated"],
    [/^invoices\//, "invoice"],
    [/^quotes\//, "quote"],
    [/^reservations\//, "reservation"],
    [/^vouchers\//, "voucher"],
    [/^transfer-proofs\//, "transfer-proof"],
    [/^partners\/delegacion\//, "partner-proof"],
    [/^(nayade\/coupons|ticketing)\//, "coupon"],
    [/^expenses\//, "expense"],
    [/^(settlements|partner-billing)\//, "settlement"],
    [/^gestoria\//, "gestoria-export"],
    [/^nayade\/monitors\/photos\//, "hr-photo"],
    [/^nayade\/monitors\/docs\//, "hr-doc"],
  ];
  for (const [re, c] of rules) if (re.test(k)) return c;
  return "internal";
}
