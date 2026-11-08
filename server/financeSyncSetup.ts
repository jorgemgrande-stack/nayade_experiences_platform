/**
 * Elephant Finance Sync: puesta en marcha en autoservicio (extracto bancario, operaciones del datáfono, buzón de
 * tickets y primera conciliación), con el estado calculado a partir de los datos reales de la empresa en curso.
 *
 * Reutiliza lo existente, sin caminos paralelos:
 *  - el buzón se guarda en la bóveda de la empresa (proveedor `imap_tpv`, cifrado de `vault.ts`) con la misma
 *    validación que «Integraciones y pagos»; la contraseña guardada nunca se devuelve (solo su máscara);
 *  - «Comprobar conexión» usa el probador de la bóveda (inicio de sesión y apertura de la carpeta en solo lectura: no
 *    descarga ni marca correos), con un límite de tiempo, y deja el resultado en el estado de integraciones;
 *  - la lectura automática se enciende con el interruptor `email_ingestion_enabled` de la base de ESTA empresa (el que
 *    evalúa la tarea `email-tpv-ingestion` por empresa): nunca un interruptor global ni una variable de entorno.
 *
 * Todo pasa por dependencias inyectables para poder probarlo sin base de datos ni servidores de correo.
 */
import { sql } from "drizzle-orm";
import { getProvider } from "./_core/credentials/catalog";
import { panelIntegrations, fieldProblems, type PanelIntegration } from "./_core/credentials/presentation";
import type { ProviderStatus } from "./_core/credentials/vault";
import type { Connection, CheckOutcome } from "./_core/credentials/health";
import type { TestResult } from "./_core/credentials/testers";
import { financeSyncSetup, type FinanceSyncFacts, type FinanceSyncSetup } from "../shared/financeSyncSetup";

export const MAILBOX_PROVIDER = "imap_tpv";
export const INGESTION_FLAG = "email_ingestion_enabled";
/** Tope de «Comprobar conexión»: el probador ya corta cada socket a los 8 s; esto acota la operación completa. */
export const MAILBOX_TEST_TIMEOUT_MS = 20_000;

export class FinanceSyncSetupError extends Error {
  constructor(
    readonly code: "BAD_REQUEST" | "PRECONDITION_FAILED",
    message: string,
  ) {
    super(message);
  }
}

export interface FinanceSyncCounts {
  bankImports: number;
  bankMovements: number;
  tpvExcelImports: number;
  cardOperations: number;
  emailsRead: number;
  confirmedConciliations: number;
  suggestedConciliations: number;
}

interface HealthLike {
  provider: string;
  connection: Connection;
  stateAt: string | null;
  lastCheck: { message: string } | null;
  lastSync: { message: string } | null;
}

export interface FinanceSyncDeps {
  /** Bóveda por empresa disponible (multiempresa). */
  multi: () => boolean;
  vault: () => {
    status(providerIds?: string[]): Promise<ProviderStatus[]>;
    resolve(provider: string): Promise<Record<string, string>>;
    save(provider: string, values: Record<string, string>, updatedBy: string): Promise<{ saved: string[] }>;
  };
  health: () => Promise<HealthLike[]>;
  /** Prueba de conexión del buzón (sin leer mensajes). */
  probe: (values: Record<string, string>) => Promise<TestResult>;
  recordCheck: (outcome: CheckOutcome, message: string, actor: string) => Promise<void>;
  counts: () => Promise<FinanceSyncCounts>;
  ingestion: {
    get: () => Promise<boolean>;
    set: (enabled: boolean, actor: { id: number; name: string }) => Promise<void>;
  };
}

export interface FinanceSyncSetupView extends FinanceSyncSetup {
  /** Formulario del buzón (mismos campos y estados que «Integraciones y pagos»); null si no hay bóveda por empresa. */
  mailbox: PanelIntegration | null;
  ingestionEnabled: boolean;
  multi: boolean;
}

async function mailboxPanel(deps: FinanceSyncDeps): Promise<PanelIntegration | null> {
  if (!deps.multi()) return null;
  const [statuses, health] = await Promise.all([deps.vault().status([MAILBOX_PROVIDER]), deps.health().catch(() => [] as HealthLike[])]);
  // Esta pantalla solo existe con Finance Sync contratado: el buzón siempre se muestra
  return panelIntegrations(statuses, { licensed: false, can: () => true }, health).find((p) => p.id === MAILBOX_PROVIDER) ?? null;
}

export async function getFinanceSyncSetup(deps: FinanceSyncDeps): Promise<FinanceSyncSetupView> {
  const [counts, mailbox, ingestionEnabled] = await Promise.all([deps.counts(), mailboxPanel(deps), deps.ingestion.get().catch(() => false)]);
  const facts: FinanceSyncFacts = {
    bank: { imports: counts.bankImports, movements: counts.bankMovements },
    cardTerminal: { excelImports: counts.tpvExcelImports, operations: counts.cardOperations },
    mailbox: {
      available: mailbox !== null,
      state: mailbox?.state ?? "off",
      detail: mailbox?.stateDetail ?? null,
      ingestionEnabled,
      emailsRead: counts.emailsRead,
    },
    conciliation: { confirmed: counts.confirmedConciliations, suggested: counts.suggestedConciliations },
  };
  return { ...financeSyncSetup(facts), mailbox, ingestionEnabled, multi: deps.multi() };
}

function requireVault(deps: FinanceSyncDeps): void {
  if (!deps.multi()) throw new FinanceSyncSetupError("PRECONDITION_FAILED", "En esta instalación el buzón lo configura el equipo técnico.");
}

/** Guarda los datos del buzón en la bóveda de la empresa en curso. Un campo secreto vacío se conserva. */
export async function saveMailbox(deps: FinanceSyncDeps, values: Record<string, string>, actor: string): Promise<{ saved: string[] }> {
  requireVault(deps);
  const provider = getProvider(MAILBOX_PROVIDER)!;
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    const f = provider.fields.find((x) => x.key === k);
    // La contraseña en blanco significa «conservar la guardada»: nunca se borra desde aquí
    if (f?.secret && v === "") continue;
    clean[k] = f?.secret ? v : v.trim();
  }
  const problems = fieldProblems(provider, clean);
  if (Object.keys(clean).some((k) => provider.fields.find((f) => f.key === k)?.panel?.hidden)) problems.push("Hay un dato que no se puede cambiar desde aquí.");
  if (problems.length) throw new FinanceSyncSetupError("BAD_REQUEST", problems.join(" "));
  if (!Object.keys(clean).length) return { saved: [] };
  try {
    const r = await deps.vault().save(MAILBOX_PROVIDER, clean, actor);
    // Auditoría sin valores: solo qué campos
    console.warn(JSON.stringify({ ctx: "FinanceSyncSetup", event: "mailbox_saved", fields: r.saved, user: actor }));
    return r;
  } catch (e) {
    throw new FinanceSyncSetupError("BAD_REQUEST", e instanceof Error ? e.message : "No se pudo guardar el buzón");
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<T>((resolve) => (t = setTimeout(() => resolve(onTimeout()), ms)))]).finally(() => clearTimeout(t));
}

/**
 * Comprueba el buzón guardado: inicio de sesión y apertura de la carpeta en solo lectura (no descarga ni marca correos),
 * con límite de tiempo. El resultado (sin secretos) queda en el estado de integraciones de la empresa.
 */
export async function testMailbox(deps: FinanceSyncDeps, actor: string, timeoutMs = MAILBOX_TEST_TIMEOUT_MS): Promise<TestResult> {
  requireVault(deps);
  const values = await deps.vault().resolve(MAILBOX_PROVIDER);
  if (!values.host || !values.user || !values.pass) return { ok: false, message: "Guarda antes el servidor, el usuario y la contraseña del buzón.", outcome: "error" };
  const r = await withTimeout(
    deps.probe(values).catch((): TestResult => ({ ok: false, message: "No se pudo conectar con el servidor IMAP", outcome: "error" })),
    timeoutMs,
    (): TestResult => ({ ok: false, message: "El servidor de correo no respondió a tiempo: revisa el servidor y el puerto.", outcome: "error" }),
  );
  if (r.outcome && r.outcome !== "unsupported") await deps.recordCheck(r.outcome, r.message, actor).catch(() => undefined);
  return r;
}

/** Enciende o apaga la lectura automática del buzón SOLO para la empresa en curso. Encenderla exige el buzón comprobado. */
export async function setMailboxIngestion(deps: FinanceSyncDeps, enabled: boolean, actor: { id: number; name: string }): Promise<{ enabled: boolean }> {
  requireVault(deps);
  if (enabled) {
    const mailbox = await mailboxPanel(deps);
    if (mailbox?.state !== "working") throw new FinanceSyncSetupError("PRECONDITION_FAILED", "Antes de encender la lectura automática, guarda el buzón y pulsa «Comprobar conexión».");
  }
  await deps.ingestion.set(enabled, actor);
  console.warn(JSON.stringify({ ctx: "FinanceSyncSetup", event: enabled ? "ingestion_on" : "ingestion_off", user: actor.id }));
  return { enabled };
}

// ─── Dependencias reales (BD de la empresa en curso) ─────────────────────────────────────────────────────────────────

type Db = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

/** Una tabla que la empresa aún no tiene cuenta como vacía (no rompe la pantalla). */
async function countOf(db: Db, q: ReturnType<typeof sql>): Promise<number> {
  try {
    const [rows] = (await db.execute(q)) as [Array<{ n: number | string | null }>];
    return Number(rows?.[0]?.n ?? 0) || 0;
  } catch (e) {
    if (/ER_NO_SUCH_TABLE|doesn't exist|ER_BAD_FIELD_ERROR/i.test(`${(e as { code?: string }).code ?? ""} ${(e as Error).message ?? ""}`)) return 0;
    throw e;
  }
}

export async function readFinanceSyncCounts(db: Db): Promise<FinanceSyncCounts> {
  const [bankImports, bankMovements, tpvExcelImports, cardOperations, emailsRead, reconciledBatches, confirmedLinks, suggestedBatches, proposedLinks] = await Promise.all([
    countOf(db, sql`SELECT COUNT(*) AS n FROM bank_file_imports WHERE status <> 'error' AND imported_rows > 0`),
    countOf(db, sql`SELECT COUNT(*) AS n FROM bank_movements`),
    countOf(db, sql`SELECT COUNT(*) AS n FROM tpv_file_imports WHERE status = 'ok' AND imported_rows > 0`),
    countOf(db, sql`SELECT COUNT(*) AS n FROM card_terminal_operations`),
    countOf(db, sql`SELECT COUNT(*) AS n FROM email_ingestion_logs WHERE status = 'ok'`),
    countOf(db, sql`SELECT COUNT(*) AS n FROM card_terminal_batches WHERE status = 'reconciled'`),
    countOf(db, sql`SELECT COUNT(*) AS n FROM bank_movement_links WHERE status = 'confirmed'`),
    countOf(db, sql`SELECT COUNT(*) AS n FROM card_terminal_batches WHERE status IN ('suggested', 'auto_ready')`),
    countOf(db, sql`SELECT COUNT(*) AS n FROM bank_movement_links WHERE status = 'proposed'`),
  ]);
  return {
    bankImports,
    bankMovements,
    tpvExcelImports,
    cardOperations,
    emailsRead,
    confirmedConciliations: reconciledBatches + confirmedLinks,
    suggestedConciliations: suggestedBatches + proposedLinks,
  };
}

/** Interruptor de la lectura automática en la base de la empresa (crea su fila si la siembra no la trajo). */
export async function writeIngestionFlag(db: Db, enabled: boolean, actor: { id: number; name: string }): Promise<void> {
  const [rows] = (await db.execute(sql`SELECT enabled FROM feature_flags WHERE ${sql.raw("`key`")} = ${INGESTION_FLAG} LIMIT 1`)) as [Array<{ enabled: number | boolean }>];
  const old = rows?.[0] ? String(!!Number(rows[0].enabled)) : null;
  await db.execute(sql`INSERT INTO feature_flags (${sql.raw("`key`")}, name, description, module, enabled, default_enabled, risk_level)
    VALUES (${INGESTION_FLAG}, 'Ingesta de emails', 'Habilita la lectura de emails IMAP para importación de operaciones', 'email_ingestion', ${enabled ? 1 : 0}, 0, 'medium')
    ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`);
  await db.execute(sql`INSERT INTO config_change_logs (entity_type, ${sql.raw("`key`")}, old_value, new_value, changed_by_id, changed_by_name)
    VALUES ('feature_flag', ${INGESTION_FLAG}, ${old}, ${String(enabled)}, ${actor.id}, ${actor.name.slice(0, 128)})`);
}

export async function defaultFinanceSyncDeps(): Promise<FinanceSyncDeps> {
  const [{ getDb }, { isMultiTenant }, { getVault }, health, { testProvider }, config] = await Promise.all([
    import("./db"),
    import("./_core/tenant"),
    import("./_core/credentials/runtime"),
    import("./_core/credentials/health"),
    import("./_core/credentials/testers"),
    import("./config"),
  ]);
  const db = async (): Promise<Db> => {
    const d = await getDb();
    if (!d) throw new Error("Base de datos no disponible");
    return d as unknown as Db;
  };
  return {
    multi: () => isMultiTenant(),
    vault: () => getVault(),
    health: async () => (await health.integrationHealth()).providers,
    probe: (values) => testProvider(MAILBOX_PROVIDER, values),
    recordCheck: (outcome, message, actor) => health.recordCheck(MAILBOX_PROVIDER, outcome, message, actor),
    counts: async () => readFinanceSyncCounts(await db()),
    ingestion: {
      get: () => config.getFeatureFlag(INGESTION_FLAG, false),
      set: async (enabled, actor) => {
        await writeIngestionFlag(await db(), enabled, actor);
        config.invalidateConfigCache();
      },
    },
  };
}
