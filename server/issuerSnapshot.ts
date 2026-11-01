/**
 * Copia de los datos del emisor para una factura, abono o ticket facturado que se emite AHORA (db/migrations/0020).
 *
 * Cada alta en `invoices` la guarda en `issuerSnapshot`: la factura se pinta siempre con esos datos aunque la empresa
 * cambie después su razón social, su NIF o su domicilio. Nunca lanza: si no se pueden leer los datos, null (el
 * documento se pinta entonces con los datos en vigor), y el alta sigue adelante.
 */
import type { IssuerSnapshot } from "./invoiceHtml";

export async function issuerSnapshotForNewInvoice(): Promise<IssuerSnapshot | null> {
  try {
    const { captureIssuerSnapshot } = await import("./invoiceHtml");
    return await captureIssuerSnapshot();
  } catch (e) {
    console.warn("[issuerSnapshot] No se pudo copiar el emisor de la factura:", (e as Error).message);
    return null;
  }
}
