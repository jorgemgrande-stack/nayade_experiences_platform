/**
 * Comparación segura y enlaces firmados sin estado (HMAC).
 *
 * Los enlaces públicos a documentos no pueden basarse en un número correlativo
 * (FAC-AAAA-NNNN): se enumeran. Se firman con HMAC-SHA256 sobre el identificador, sin
 * necesidad de columnas ni migraciones.
 */
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { sessionSecret } from "./sessionSecret";
import { getTenantId, isMultiTenant } from "./tenant";

/** Comparación de cadenas en tiempo constante (compara hashes de igual longitud). */
export function secureEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a === "" || b === "") return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * En multiempresa la firma incluye el tenant: los números de factura se repiten entre empresas
 * (FAC-AAAA-0001 existe en todas) y un enlace firmado de A no debe abrir la factura homónima de B.
 * En instalación única no cambia (los enlaces ya enviados siguen siendo válidos).
 */
function invoicePurpose(): string {
  return isMultiTenant() ? `invoice-preview:${getTenantId()}` : "invoice-preview";
}

function sign(purpose: string, value: string): string {
  // Misma clave que las sesiones. En producción sin JWT_SECRET no hay firma: ningún enlace valida.
  const key = sessionSecret();
  if (!key) return "";
  return createHmac("sha256", key).update(`${purpose}:${value}`).digest("hex").slice(0, 32);
}

export function signInvoiceLink(invoiceNumber: string): string {
  return sign(invoicePurpose(), invoiceNumber);
}

export function verifyInvoiceLink(invoiceNumber: string, signature: unknown): boolean {
  return secureEqual(signature, signInvoiceLink(invoiceNumber));
}

/** Ruta relativa a la vista de factura, con firma. */
export function invoicePreviewPath(invoiceNumber: string): string {
  return `/api/invoices/preview?n=${encodeURIComponent(invoiceNumber)}&sig=${signInvoiceLink(invoiceNumber)}`;
}
