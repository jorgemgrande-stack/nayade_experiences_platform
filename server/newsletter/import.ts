/**
 * Newsletter · importación de contactos HISTÓRICOS (preparada; en esta fase nunca envía correos ni crea consentimientos).
 *
 * Un fichero histórico no acredita consentimiento comercial: cada contacto nuevo entra como `imported` (fuera de todo
 * envío y de toda audiencia) hasta que la propia persona se inscriba desde la web y confirme. Reglas del plan:
 *  - `create`             correo nuevo → fila `imported` con idioma, nombre, origen `import:<etiqueta>`, sin correos.
 *  - `match_active`       ya activo: no se toca nada (conserva idioma, consentimiento e historial).
 *  - `match_pending`      ya pendiente: no se toca nada.
 *  - `match_unsubscribed` baja previa: la baja PREVALECE; no se reactiva ni se cambia de lista.
 *  - `match_imported`     ya importado (otro lote): una sola fila por correo; el segundo lote solo lo registra.
 *    En las coincidencias, si el fichero trae nombre y la ficha no tiene, se rellena (es el único cambio permitido).
 *  - `reject`             correo no válido, repetido dentro del fichero o fila mal formada.
 * Repetir el mismo fichero → 0 creados, todo `match_imported`. La huella (`fingerprint`) ata la vista previa a la
 * aplicación: el fichero y el idioma por defecto tienen que ser los mismos.
 */
import crypto from "node:crypto";
import { NewsletterImportError, parseNewsletterImport, type ImportRow, type ParseInput, type ParsedImport } from "../../shared/newsletterImport";
import { normalizeLocale } from "../../shared/i18n";
import { NewsletterError, type ImportCreate, type NewsletterStore, type Subscriber, type TenantLocales } from "./service";

export type ImportAction = "create" | "match_active" | "match_pending" | "match_unsubscribed" | "match_imported" | "reject";
export const IMPORT_ACTIONS: readonly ImportAction[] = ["create", "match_active", "match_pending", "match_unsubscribed", "match_imported", "reject"];
export interface ImportPlanRow {
  line: number;
  email: string | null;
  name: string | null;
  locale: string | null;
  action: ImportAction;
  /** Motivo del rechazo o nota de la coincidencia. */
  reason: string | null;
  /** Coincidencia a la que se le rellenará el nombre. */
  fillName?: boolean;
}
export interface ImportPlan {
  rows: ImportPlanRow[];
  counts: Record<ImportAction, number> & { total: number };
  columns: string[];
  ignored: string[];
  defaultLocale: string;
  label: string;
}

const sha256 = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");
export const importSource = (label: string) => `import:${label}`.slice(0, 64);

export function planNewsletterImport(parsed: ParsedImport, existingByEmail: ReadonlyMap<string, Subscriber>, opts: { defaultLocale: string; label: string }): ImportPlan {
  const rows: ImportPlanRow[] = [];
  const counts: ImportPlan["counts"] = { create: 0, match_active: 0, match_pending: 0, match_unsubscribed: 0, match_imported: 0, reject: 0, total: 0 };
  const REASON = { invalid_email: "Correo no válido", duplicate: "Repetido dentro del fichero", malformed: "Fila mal formada" } as const;
  for (const r of parsed.rejected) {
    rows.push({ line: r.line, email: r.email, name: null, locale: null, action: "reject", reason: r.detail ? `${REASON[r.reason]}: ${r.detail}` : REASON[r.reason] });
    counts.reject++;
  }
  for (const r of parsed.rows) {
    const cur = existingByEmail.get(r.email);
    if (!cur) {
      rows.push({ line: r.line, email: r.email, name: r.name, locale: r.locale, action: "create", reason: null });
      counts.create++;
      continue;
    }
    const action: ImportAction = cur.status === "active" ? "match_active" : cur.status === "pending" ? "match_pending" : cur.status === "unsubscribed" ? "match_unsubscribed" : "match_imported";
    const fillName = !!r.name && !cur.name;
    const note = cur.status === "unsubscribed" ? "Baja previa: prevalece, no se reactiva" : cur.status === "active" ? "Ya activo: conserva su idioma y consentimiento" : cur.status === "pending" ? "Pendiente de confirmar: sin cambios" : "Ya importado en otro lote";
    rows.push({ line: r.line, email: r.email, name: cur.name ?? r.name, locale: cur.locale, action, reason: fillName ? `${note} · se añade el nombre` : note, fillName });
    counts[action]++;
  }
  counts.total = rows.length;
  rows.sort((a, b) => a.line - b.line);
  return { rows, counts, columns: parsed.columns, ignored: parsed.ignored, defaultLocale: opts.defaultLocale, label: opts.label };
}

export interface PreviewInput {
  format: "csv" | "xlsx";
  fileName: string;
  /** CSV: texto; Excel: base64. */
  content: string;
  label: string;
  defaultLocale: string;
}
export interface PreviewResult {
  plan: ImportPlan;
  fingerprint: string;
  sha256: string;
  /** Primeras filas por acción (hasta 50 cada una) para la vista previa. */
  sample: Record<ImportAction, ImportPlanRow[]>;
}

const cleanLabel = (v: string) => v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);

function parseOrThrow(input: ParseInput, t: TenantLocales, defaultLocale: string): ParsedImport {
  try {
    return parseNewsletterImport(input, { defaultLocale, tenantLocales: t.tenantLocales });
  } catch (e) {
    if (e instanceof NewsletterImportError) throw new NewsletterError("invalid_input", e.message);
    throw e;
  }
}

export class NewsletterImporter {
  constructor(private store: NewsletterStore, private locales: () => Promise<TenantLocales>, private now: () => number) {}

  private async prepare(i: PreviewInput) {
    const t = await this.locales();
    const label = cleanLabel(i.label);
    if (label.length < 2) throw new NewsletterError("invalid_input", "Pon una etiqueta al lote (mínimo 2 caracteres).");
    const def = normalizeLocale(i.defaultLocale);
    if (!def || !(t.tenantLocales.includes(def) || def === t.defaultLocale)) throw new NewsletterError("invalid_input", `El idioma por defecto tiene que ser uno de la empresa (${[t.defaultLocale, ...t.tenantLocales].filter((x, k, a) => a.indexOf(x) === k).join(", ")}).`);
    const parsed = parseOrThrow(i.format === "xlsx" ? { format: "xlsx", base64: i.content } : { format: "csv", text: i.content }, t, def);
    const contentHash = sha256(i.format === "xlsx" ? Buffer.from(i.content.replace(/^data:[^,]*,/, ""), "base64") : i.content);
    const existing = new Map((await this.store.byEmails(parsed.rows.map((r) => r.email))).map((s) => [s.email, s]));
    const plan = planNewsletterImport(parsed, existing, { defaultLocale: def, label });
    const fingerprint = sha256(`${contentHash}:${def}:${label}`).slice(0, 32);
    return { plan, parsed, fingerprint, contentHash, label, def };
  }

  async preview(i: PreviewInput): Promise<PreviewResult> {
    const { plan, fingerprint, contentHash } = await this.prepare(i);
    const sample = Object.fromEntries(IMPORT_ACTIONS.map((a) => [a, plan.rows.filter((r) => r.action === a).slice(0, 50)])) as Record<ImportAction, ImportPlanRow[]>;
    return { plan, fingerprint, sha256: contentHash, sample };
  }

  /** Aplica el plan de la vista previa (misma huella). `sendMails` solo admite false en esta fase. */
  async apply(i: PreviewInput & { fingerprint: string; sendMails?: boolean }, actor: string) {
    if (i.sendMails) throw new NewsletterError("invalid_input", "El envío de correos a los contactos importados no está autorizado en esta fase: solo se admite importar sin enviar.");
    const { plan, parsed, fingerprint, contentHash, label, def } = await this.prepare(i);
    if (fingerprint !== i.fingerprint) throw new NewsletterError("conflict", "El fichero o las opciones han cambiado desde la vista previa: vuelve a cargarlo.");
    const byEmail = new Map(parsed.rows.map((r) => [r.email, r]));
    const creates: ImportCreate[] = plan.rows.filter((r) => r.action === "create").map((r) => ({ email: r.email!, name: r.name, locale: r.locale!, source: importSource(label) }));
    const existing = new Map((await this.store.byEmails(plan.rows.filter((r) => r.fillName && r.email).map((r) => r.email!))).map((s) => [s.email, s]));
    const fillNames = plan.rows.filter((r) => r.fillName && r.email && existing.get(r.email)).map((r) => ({ id: existing.get(r.email!)!.id, name: byEmail.get(r.email!)?.name ?? r.name ?? "" })).filter((f) => f.name);
    const matched = plan.counts.match_active + plan.counts.match_pending + plan.counts.match_unsubscribed + plan.counts.match_imported;
    const report = { counts: plan.counts, columns: plan.columns, ignored: plan.ignored, rejected: plan.rows.filter((r) => r.action === "reject").slice(0, 500), fingerprint };
    const r = await this.store.applyImport({
      batch: { label, fileName: i.fileName.slice(0, 200), sha256: contentHash, format: i.format, defaultLocale: def, rowCount: parsed.rowCount, matchedCount: matched, rejectedCount: plan.counts.reject, actor, reportJson: JSON.stringify(report).slice(0, 2_000_000) },
      creates,
      fillNames,
      now: this.now(),
    });
    return { importId: r.importId, created: r.created, matched: matched + r.raced, rejected: plan.counts.reject, rows: parsed.rowCount, sendMails: false as const, fingerprint };
  }
}

export type { ImportRow };
