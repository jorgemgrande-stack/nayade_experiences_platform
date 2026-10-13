/**
 * Comparación segura y enlaces firmados sin estado (HMAC).
 *
 * Los enlaces públicos a documentos no pueden basarse en un número correlativo
 * (FAC-AAAA-NNNN): se enumeran. Se firman con HMAC-SHA256 sobre el identificador, sin
 * necesidad de columnas ni migraciones.
 */
import { createHash, createHmac, timingSafeEqual } from "crypto";

/** Comparación de cadenas en tiempo constante (compara hashes de igual longitud). */
export function secureEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a === "" || b === "") return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function signingKey(): string {
  // Misma fuente que las sesiones. El valor de desarrollo coincide con el de localAuth.
  return process.env.JWT_SECRET || "local-dev-secret-change-me";
}

function sign(purpose: string, value: string): string {
  return createHmac("sha256", signingKey()).update(`${purpose}:${value}`).digest("hex").slice(0, 32);
}

export function signInvoiceLink(invoiceNumber: string): string {
  return sign("invoice-preview", invoiceNumber);
}

export function verifyInvoiceLink(invoiceNumber: string, signature: unknown): boolean {
  return secureEqual(signature, signInvoiceLink(invoiceNumber));
}

/** Ruta relativa a la vista de factura, con firma. */
export function invoicePreviewPath(invoiceNumber: string): string {
  return `/api/invoices/preview?n=${encodeURIComponent(invoiceNumber)}&sig=${signInvoiceLink(invoiceNumber)}`;
}
