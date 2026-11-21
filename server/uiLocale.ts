/**
 * Idioma de la interfaz del panel por usuario (tabla `user_ui_prefs`, migración 0085). Acceso aislado: si la tabla aún no
 * existe (migración sin aplicar) la lectura devuelve null y la escritura informa `persisted: false`; el panel sigue
 * funcionando con la elección guardada en el navegador.
 */
import { sql } from "drizzle-orm";
import { normalizeLocale, type Locale } from "../shared/i18n/core";

type Db = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

const rowsOf = (res: unknown): Array<Record<string, unknown>> => {
  const r = Array.isArray(res) ? res[0] : res;
  return Array.isArray(r) ? (r as Array<Record<string, unknown>>) : [];
};

export async function readUiLocale(db: Db, userId: number): Promise<Locale | null> {
  try {
    const res = await db.execute(sql`SELECT ui_locale FROM user_ui_prefs WHERE user_id = ${userId} LIMIT 1`);
    return normalizeLocale(rowsOf(res)[0]?.ui_locale);
  } catch {
    return null;
  }
}

export async function writeUiLocale(db: Db, userId: number, locale: Locale): Promise<boolean> {
  try {
    await db.execute(sql`
      INSERT INTO user_ui_prefs (user_id, ui_locale, updated_at) VALUES (${userId}, ${locale}, ${Date.now()})
      ON DUPLICATE KEY UPDATE ui_locale = VALUES(ui_locale), updated_at = VALUES(updated_at)
    `);
    return true;
  } catch {
    return false;
  }
}
