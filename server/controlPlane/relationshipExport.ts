/**
 * Documentación de la RELACIÓN CONTRACTUAL de una empresa con Elephant Source (lo que NO va en su exportación de
 * datos operativos, porque vive en el plano de control y no en la base de la empresa): ficha del registro, pedidos
 * (contrato, plan y estado), facturación interna, facturas de Stripe y documentos fiscales, y tickets de soporte
 * con sus mensajes PÚBLICOS (nunca las notas internas).
 *
 * Solo para operadores (scopes billing:read y tickets:read) y como paquete JSON que el equipo entrega a la
 * persona propietaria por el procedimiento verificable de docs/elephant-source/EXPORTACION_DATOS.md. Las facturas de
 * Stripe se describen con su número, importes y estado; los PDF oficiales se obtienen de Stripe (no se inventan).
 * Todo opcional: si una fuente no está configurada se indica en `sources` como «no disponible», nunca como vacía.
 */
export interface RelationshipSources {
  tenant: (id: string) => Promise<Record<string, unknown> | null>;
  orders?: () => Promise<Array<Record<string, unknown> & { id: number; tenantId: string | null }>>;
  billing?: (tenantId: string) => Promise<{ subscription: unknown; invoices: unknown[] }>;
  stripeInvoices?: (orderId: number) => Promise<unknown[]>;
  fiscalDocuments?: (orderId: number) => Promise<unknown[]>;
  tickets?: (tenantId: string) => Promise<Array<{ ticket: Record<string, unknown>; events: Array<Record<string, unknown> & { internal: boolean }> }>>;
}

export type SourceState = "incluido" | "no disponible";

export interface RelationshipExport {
  format: "elephant-source-relationship";
  formatVersion: 1;
  tenantId: string;
  generatedAt: string;
  generatedBy: string;
  complete: boolean;
  sources: Record<"registro" | "pedidos" | "facturacion" | "stripe" | "documentosFiscales" | "soporte", SourceState>;
  tenant: Record<string, unknown>;
  orders: Array<Record<string, unknown>>;
  billing: { subscription: unknown; invoices: unknown[] } | null;
  stripeInvoices: unknown[];
  fiscalDocuments: unknown[];
  tickets: Array<{ ticket: Record<string, unknown>; messages: Array<Record<string, unknown>> }>;
  notes: string[];
}

export class RelationshipNotFoundError extends Error {
  constructor() {
    super("Empresa no encontrada");
    this.name = "RelationshipNotFoundError";
  }
}

export async function buildRelationshipExport(tenantId: string, s: RelationshipSources, o: { now: number; by: string }): Promise<RelationshipExport> {
  const tenant = await s.tenant(tenantId);
  if (!tenant) throw new RelationshipNotFoundError();
  const orders = s.orders ? (await s.orders()).filter((x) => x.tenantId === tenantId) : [];
  const stripeInvoices: unknown[] = [];
  const fiscalDocuments: unknown[] = [];
  for (const ord of orders) {
    if (s.stripeInvoices) stripeInvoices.push(...(await s.stripeInvoices(ord.id)));
    if (s.fiscalDocuments) fiscalDocuments.push(...(await s.fiscalDocuments(ord.id)));
  }
  const tickets = s.tickets
    ? (await s.tickets(tenantId)).map((t) => ({
        ticket: t.ticket,
        // Nunca las notas internas del equipo
        messages: t.events.filter((e) => !e.internal && e.kind === "comment").map(({ internal: _i, ...e }) => e),
      }))
    : [];
  const sources: RelationshipExport["sources"] = {
    registro: "incluido",
    pedidos: s.orders ? "incluido" : "no disponible",
    facturacion: s.billing ? "incluido" : "no disponible",
    stripe: s.stripeInvoices ? "incluido" : "no disponible",
    documentosFiscales: s.fiscalDocuments ? "incluido" : "no disponible",
    soporte: s.tickets ? "incluido" : "no disponible",
  };
  return {
    format: "elephant-source-relationship",
    formatVersion: 1,
    tenantId,
    generatedAt: new Date(o.now).toISOString(),
    generatedBy: o.by,
    complete: Object.values(sources).every((v) => v === "incluido"),
    sources,
    tenant,
    orders,
    billing: s.billing ? await s.billing(tenantId) : null,
    stripeInvoices,
    fiscalDocuments,
    tickets,
    notes: [
      "Documentación de la relación con Elephant Source. Los datos operativos de la empresa están en su exportación de datos (panel › Suscripción › Exportar mis datos).",
      "Las facturas oficiales en PDF son las emitidas por Stripe y el sistema de facturación; aquí figuran su número, importes y estado.",
      "Los tickets incluyen solo los mensajes visibles para la empresa, no las notas internas del equipo.",
      "Las fuentes marcadas «no disponible» no estaban configuradas al generar el paquete: el paquete NO está completo.",
    ],
  };
}
