/**
 * Recursos HUÉRFANOS del aprovisionamiento (solo lectura; nunca borra nada): lo que un alta interrumpida, una baja o una
 * prueba de restauración pueden dejar en los servidores de bases de datos.
 *  - bases `es_*` que no son la base activa de ninguna empresa del registro (ni de la plataforma);
 *  - copias de pruebas de restauración (`es_<empresa>_rAAAAMMDDhhmmss`), que se informan aparte: son esperables;
 *  - empresas con acceso cuya base activa no existe en ningún servidor;
 *  - usuarios MySQL de empresa (`esu_<huella>`) que no corresponden a ninguna empresa del registro, y usuarios de copias
 *    restauradas (`esr_<huella>`) cuya copia ya no existe.
 * Decidir qué se elimina corresponde a una persona (supresión con doble aprobación, CICLO_VIDA_TENANT.md).
 */
import { databaseNameFor, userNameFor } from "./mysqlAdapters";
import { restoredUserFor } from "../ops/backupRestore";

/** Bases de la plataforma en el mismo servidor (no son de ninguna empresa). */
export const PLATFORM_DATABASES: ReadonlySet<string> = new Set(["es_registry", "es_crm", "es_erm", "es_billing"]);
const RESTORE_COPY = /^(es_[a-z0-9_]+)_r\d{14}$/;
const WITH_ACCESS = new Set(["provisioning", "trial", "active", "grace", "suspended"]);

export interface OrphanInput {
  /** Bases por servidor (alias → nombres). */
  serverDatabases: Record<string, string[]>;
  /** Usuarios MySQL con prefijo `esu_` o `esr_` por servidor. */
  serverUsers: Record<string, string[]>;
  tenants: Array<{ id: string; status: string; activeDatabase: string | null }>;
}

export function orphanReport(i: OrphanInput) {
  const tenantDbs = new Map<string, string>(); // base esperada → empresa
  for (const t of i.tenants) {
    try {
      tenantDbs.set(databaseNameFor(t.id), t.id);
    } catch {
      /* identificador histórico sin nombre derivable: solo cuenta su base activa */
    }
    if (t.activeDatabase) tenantDbs.set(t.activeDatabase, t.id);
  }
  const active = new Set(i.tenants.map((t) => t.activeDatabase).filter((x): x is string => !!x));
  const all = Object.entries(i.serverDatabases).flatMap(([server, dbs]) => dbs.map((db) => ({ server, db })));
  const orphanDatabases: Array<{ server: string; database: string; reason: string }> = [];
  const restoreCopies: Array<{ server: string; database: string; tenantId: string | null }> = [];
  for (const { server, db } of all) {
    if (!db.startsWith("es_") || PLATFORM_DATABASES.has(db) || active.has(db)) continue;
    const copy = RESTORE_COPY.exec(db);
    if (copy) {
      restoreCopies.push({ server, database: db, tenantId: tenantDbs.get(copy[1]) ?? null });
      continue;
    }
    const owner = tenantDbs.get(db);
    const t = owner ? i.tenants.find((x) => x.id === owner) : undefined;
    orphanDatabases.push({ server, database: db, reason: t ? `empresa ${t.id} en estado «${t.status}» sin esta base como activa` : "ninguna empresa del registro" });
  }
  const present = new Set(all.map((x) => x.db));
  const missingDatabases = i.tenants
    .filter((t) => WITH_ACCESS.has(t.status) && t.status !== "provisioning")
    .filter((t) => !t.activeDatabase || !present.has(t.activeDatabase))
    .map((t) => ({ tenantId: t.id, status: t.status, reason: t.activeDatabase ? "su base activa no existe en ningún servidor" : "sin base activa en el registro" }));
  const knownUsers = new Set(i.tenants.map((t) => userNameFor(t.id)));
  for (const c of restoreCopies) knownUsers.add(restoredUserFor(c.database));
  const orphanUsers = Object.entries(i.serverUsers).flatMap(([server, users]) => users.filter((u) => /^es[ur]_/.test(u) && !knownUsers.has(u)).map((u) => ({ server, user: u })));
  return {
    ok: orphanDatabases.length === 0 && missingDatabases.length === 0 && orphanUsers.length === 0,
    orphanDatabases,
    missingDatabases,
    orphanUsers,
    restoreCopies,
  };
}
