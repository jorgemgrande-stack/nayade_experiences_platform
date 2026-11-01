/**
 * Datos del cliente que figuran en una factura nueva de un presupuesto (pago por enlace, cuotas, confirmación
 * manual de pago o de transferencia): los fiscales del cliente vinculado, como la factura libre. Nombre fiscal
 * (la empresa si la tiene), NIF y dirección completa; sin cliente vinculado, los datos de la oportunidad.
 * Solo para facturas que se emiten ahora: las ya emitidas no se tocan.
 */
import { eq } from "drizzle-orm";
import { clients } from "../drizzle/schema";

export interface InvoiceClientData {
  clientName: string;
  clientEmail: string;
  clientPhone: string | null;
  clientNif: string | null;
  clientAddress: string | null;
}

type ClientRow = { name?: string | null; email?: string | null; phone?: string | null; company?: string | null; nif?: string | null; address?: string | null; postalCode?: string | null; city?: string | null };
type Fallback = { name?: string | null; email?: string | null; phone?: string | null };

const clean = (v: string | null | undefined) => (typeof v === "string" ? v.trim() : "");

/** Dirección fiscal en una línea: calle, código postal y ciudad (lo mismo que la factura libre). */
export function clientFiscalAddress(c: Pick<ClientRow, "address" | "postalCode" | "city">): string | null {
  return [clean(c.address), clean(c.postalCode), clean(c.city)].filter(Boolean).join(", ") || null;
}

/** Datos de la factura con el cliente vinculado (si lo hay) y, en lo que falte, los de la oportunidad o la reserva. */
export function invoiceClientFrom(client: ClientRow | null | undefined, fallback: Fallback): InvoiceClientData {
  const name = clean(client?.company) || clean(client?.name) || clean(fallback.name) || "Cliente";
  return {
    clientName: name,
    clientEmail: clean(fallback.email) || clean(client?.email),
    clientPhone: clean(fallback.phone) || clean(client?.phone) || null,
    clientNif: client ? clean(client.nif) || null : null,
    clientAddress: client ? clientFiscalAddress(client) : null,
  };
}

/**
 * Cliente vinculado a un presupuesto: el de su oportunidad (`clients.leadId`) o, si no, el de su correo.
 * `dbx` es la BD de la empresa en curso.
 */
export async function invoiceClientForQuote(dbx: any, quote: { leadId?: number | null }, fallback: Fallback): Promise<InvoiceClientData> {
  let client: ClientRow | undefined;
  try {
    if (quote.leadId) [client] = await dbx.select().from(clients).where(eq(clients.leadId, quote.leadId)).limit(1);
    const email = clean(fallback.email);
    if (!client && email) [client] = await dbx.select().from(clients).where(eq(clients.email, email)).limit(1);
  } catch (e) {
    console.error("[invoiceClient] No se pudo leer el cliente del presupuesto:", e);
  }
  return invoiceClientFrom(client ?? null, fallback);
}
