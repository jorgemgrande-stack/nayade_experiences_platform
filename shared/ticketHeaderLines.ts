/**
 * Líneas de cabecera de los tickets impresos (TPV y reserva) a partir de `config.ticketHeader`. Solo lo que la
 * empresa tiene configurado: si falta un dato, la línea no se imprime (nunca un nombre o domicilio ajeno).
 */
export interface TicketHeaderData {
  address?: string | null;
  city?: string | null;
  legalName?: string | null;
  taxId?: string | null;
  fiscalAddress?: string | null;
}

export interface TicketHeaderLines {
  /** Dirección comercial (local, tienda). */
  commercial: string | null;
  /** Razón social y NIF. */
  fiscal: string | null;
  /** Domicilio fiscal; se omite si repite la dirección comercial. */
  fiscalAddress: string | null;
}

const clean = (v: string | null | undefined) => (v ?? "").trim();
const norm = (v: string) => v.toLowerCase().replace(/[\s·,.]+/g, " ").trim();

export function ticketHeaderLines(c: TicketHeaderData | null | undefined): TicketHeaderLines {
  const commercial = [clean(c?.address), clean(c?.city)].filter(Boolean).join(" · ");
  const taxId = clean(c?.taxId);
  const fiscal = [clean(c?.legalName), taxId ? `NIF: ${taxId}` : ""].filter(Boolean).join(" · ");
  const fiscalAddress = clean(c?.fiscalAddress);
  const repeats = !!fiscalAddress && !!commercial && norm(fiscalAddress) === norm(commercial);
  return {
    commercial: commercial || null,
    fiscal: fiscal || null,
    fiscalAddress: fiscalAddress && !repeats ? fiscalAddress : null,
  };
}
