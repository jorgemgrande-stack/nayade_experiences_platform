/**
 * Importar y exportar clientes del CRM (BD de la empresa en curso): lectura para la vista previa, alta en bloque y
 * exportación. La decisión de qué hacer con cada fila es de `clientImport.ts` (puro).
 */
import { TRPCError } from "@trpc/server";
import { asc, count, sql } from "drizzle-orm";
import { clients } from "../drizzle/schema";
import { getDb } from "./db";
import { assertBusinessQuota } from "./businessQuotas";
import type { ClientCsvField } from "../shared/clientImportCsv";
import type { ExistingClient, ImportPlan } from "./clientImport";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
  return db;
}

const FIELDS = {
  id: clients.id, name: clients.name, email: clients.email, phone: clients.phone, company: clients.company, nif: clients.nif,
  address: clients.address, city: clients.city, postalCode: clients.postalCode, country: clients.country, notes: clients.notes,
};

/** Todos los clientes de la empresa con los datos que se comparan y rellenan. */
export async function loadClientsForImport(): Promise<ExistingClient[]> {
  const db = await requireDb();
  return (await db.select(FIELDS).from(clients).orderBy(asc(clients.id))) as ExistingClient[];
}

/** Exportación: todos los clientes con las columnas de la plantilla. */
export async function listClientsForExport(): Promise<Array<Partial<Record<ClientCsvField, string | null>>>> {
  const rows = await loadClientsForImport();
  return rows.map(({ id: _id, ...r }) => r);
}

const COLUMN: Record<ClientCsvField, string> = {
  name: "name", email: "email", phone: "phone", company: "company", nif: "nif", address: "address",
  city: "city", postalCode: "postalCode", country: "country", notes: "notes",
};

export interface ApplyResult {
  created: number;
  updated: number;
  skipped: number;
}

/**
 * Aplica el plan revisado: altas y relleno de datos vacíos, todo o nada (una transacción). `excludeLines`: filas
 * que la persona desmarcó en la revisión. Respeta el límite de contactos del plan contando todas las altas.
 */
export async function applyClientImport(plan: ImportPlan, excludeLines: ReadonlySet<number>): Promise<ApplyResult> {
  const db = await requireDb();
  const creates = plan.rows.filter((r) => r.action === "create" && !excludeLines.has(r.line));
  const updates = plan.rows.filter((r) => r.action === "update" && !excludeLines.has(r.line));
  if (creates.length) {
    await assertBusinessQuota("contacts", async () => Number((await db.select({ n: count() }).from(clients))[0]?.n ?? 0), creates.length);
  }
  try {
    await db.transaction(async (tx) => {
      for (const r of creates) {
        const v = r.values;
        await tx.insert(clients).values({
          source: "import",
          name: v.name!,
          email: v.email!,
          phone: v.phone ?? "",
          company: v.company ?? "",
          nif: v.nif ?? "",
          address: v.address ?? null,
          city: v.city ?? "",
          postalCode: v.postalCode ?? "",
          country: v.country ?? "ES",
          notes: v.notes ?? null,
          tags: [],
        });
      }
      for (const r of updates) {
        const sets = Object.entries(r.fill ?? {}).map(([f, val]) => {
          const col = sql.identifier(COLUMN[f as ClientCsvField]);
          // Solo si sigue vacío: nunca se sobrescribe un dato que alguien haya escrito entretanto
          return sql`${col} = IF(${col} IS NULL OR ${col} = '', ${val}, ${col})`;
        });
        if (sets.length) await tx.execute(sql`UPDATE clients SET ${sql.join(sets, sql`, `)} WHERE id = ${r.clientId!}`);
      }
    });
  } catch (e) {
    const cause = (e as { cause?: { code?: string } })?.cause ?? (e as { code?: string });
    if (cause?.code === "ER_DUP_ENTRY") {
      throw new TRPCError({ code: "CONFLICT", message: "Alguien ha dado de alta uno de estos clientes mientras revisabas. Vuelve a subir el fichero para ver la vista previa actualizada." });
    }
    throw e;
  }
  return { created: creates.length, updated: updates.length, skipped: plan.rows.length - creates.length - updates.length };
}
