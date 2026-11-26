/**
 * Fecha ISO de calendario (AAAA-MM-DD) válida: formato exacto y día que existe (no admite 2026-02-31 ni 2026-13-01).
 * Solo valida texto: no consulta ni modifica nada.
 */
export function isValidIsoDate(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d <= last;
}
