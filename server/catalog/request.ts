/** Validación de las peticiones de cotización (API pública y del CRM). */
import { z } from "zod";
import type { QuoteRequest } from "./quote";

const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const count = z.number().int().min(0).max(100_000);

export function quoteRequestSchema(opts: { allowOwned: boolean }) {
  return z
    .object({
      plan: key,
      interval: z.enum(["month", "year"]),
      items: z.array(z.object({ key, quantity: z.number().int().min(1).max(1000).optional() }).strict()).max(60).default([]),
      owned: opts.allowOwned ? z.array(key).max(60).default([]) : z.undefined(),
      users: count.optional(),
      sites: z.number().int().min(1).max(1000).optional(),
      storageGb: count.optional(),
      fiscalEntities: z.number().int().min(1).max(100).optional(),
      /** Empleados gestionados en People (con o sin usuario): tope de la inclusión parcial del plan. */
      employees: count.optional(),
      /**
       * Modelo del contrato para Elephant Net: «legacy» (histórico: Core y Net como dos cuotas, nunca se migra),
       * «composite» (Core incluido en el Net, también en lo ya contratado). Sin indicar, solo los Net nuevos componen.
       */
      contractModel: z.enum(["legacy", "composite"]).optional(),
    })
    .strict();
}

export function parseQuoteRequest(body: unknown, opts: { allowOwned: boolean }): { ok: true; value: QuoteRequest & { employees?: number; contractModel?: "legacy" | "composite" } } | { ok: false; message: string } {
  const r = quoteRequestSchema(opts).safeParse(body);
  if (!r.success) return { ok: false, message: r.error.issues.map((i) => `${i.path.join(".") || "petición"}: ${i.message}`).join("; ") };
  return { ok: true, value: r.data as QuoteRequest & { employees?: number } };
}
