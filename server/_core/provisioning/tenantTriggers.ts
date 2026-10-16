/**
 * Triggers que la app necesita en la BD de cada tenant y que la baseline NO puede llevar:
 *
 *  - La baseline sale de `SHOW CREATE TABLE`, que no incluye triggers.
 *  - Con el binlog activo (defecto de MySQL 8), crear un trigger exige SUPER (o
 *    `log_bin_trust_function_creators`): el usuario propio del tenant no puede (error 1419). Si
 *    estuvieran en la baseline, el alta de tenants fallaría.
 *
 * Por eso los crea la conexión de ADMINISTRACIÓN del aprovisionamiento, justo después de aplicar el
 * esquema, con DEFINER = usuario propio del tenant (el trigger vive y muere con el tenant, no
 * depende del usuario administrador). Idempotente: si el trigger ya existe, no se toca.
 */
export interface TenantTrigger {
  name: string;
  timing: "BEFORE" | "AFTER";
  event: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  statement: string;
}

export const TENANT_TRIGGERS: readonly TenantTrigger[] = [
  {
    // Igual que en la BD de Náyade (ensureReservationPublicToken en server/_core/index.ts): el código
    // da por hecho que MySQL genera el token público de la reserva si no se pasa.
    name: "reservations_set_public_token",
    timing: "BEFORE",
    event: "INSERT",
    table: "reservations",
    statement: "SET NEW.public_token = COALESCE(NEW.public_token, SHA2(CONCAT(UUID(), UUID(), RAND()), 256))",
  },
];

/** `CREATE DEFINER = ?@? TRIGGER …` con nombres calificados por la BD del tenant (los `?` son el definer). */
export function createTriggerSql(db: string, t: TenantTrigger): string {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(db)) throw new Error("Nombre de base de datos no válido");
  return `CREATE DEFINER = ?@? TRIGGER IF NOT EXISTS \`${db}\`.\`${t.name}\` ${t.timing} ${t.event} ON \`${db}\`.\`${t.table}\` FOR EACH ROW ${t.statement}`;
}
