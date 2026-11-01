/**
 * Automatización de la contabilidad corporativa: lleva al libro, sin intervención, los hechos económicos confirmados.
 *
 * Cada pasada (cada 15 minutos, una réplica con `GET_LOCK`) hace, de forma idempotente y con un fallo por paso que no
 * detiene los demás:
 *  1. Ejercicio: si no hay NINGÚN ejercicio dado de alta, da de alta el del año en curso (doce periodos abiertos, sin
 *     saldos: la apertura histórica queda pendiente y el control diario lo avisa). Después lo hace el cierre anual.
 *  2. Configuración fiscal: si nadie la ha guardado, guarda solo los datos confirmados del emisor (razón social, NIF,
 *     ejercicio natural) con los valores neutros, SIN validar: la gestoría la valida en el CRM.
 *  3. Facturas propias: BORRADORES de las mensualidades devengadas de los servicios externos y su estado de cobro
 *     (`InvoicingService.generateExternal`, idempotente por `external:<id>:<AAAA-MM>`). Nunca expide.
 *  4. Libro: contabiliza las facturas expedidas sin asiento (`invoice:<id>`).
 *  5. Stripe: lee por API las transacciones de saldo y los payouts (solo lectura), los importa con la misma
 *     deduplicación que el CSV (`stripe-txn:<id>`, `stripe-payout:<id>`) y contabiliza lo pendiente. Sin permisos de
 *     lectura en la clave, el paso queda `unavailable` y el control diario lo muestra.
 *
 * El resultado de cada pasada se guarda en la auditoría de finanzas (`automation.run`) cuando cambia algo o cada hora:
 * es lo que leen el control diario y el panel para no presentar como «sin alertas» una fuente que no se sincroniza.
 */
import type { SchedulerLock } from "../trials/scheduler";
import type { GenerateReport } from "../invoicing/service";
import { madridDateKey } from "../utils/timezone";
import type { FinanceService } from "./service";
import type { FinanceStore } from "./store";
import type { StripeApiBalanceReader, StripeApiStatus } from "./stripeBalanceApi";
import type { FinanceStripeService } from "./stripeService";
import type { FinanceTaxService } from "./taxService";
import type { FinanceActor } from "./types";

export const FINANCE_AUTOMATION_LOCK = "elephant_finance_automation";
export const FINANCE_AUTOMATION_ACTOR: FinanceActor = { by: "system:finance-automation", requestId: null };
export const FINANCE_AUTOMATION_INTERVAL_MS = 15 * 60_000;
/** Ventana de lectura de Stripe: lo de los últimos 40 días (la deduplicación hace inocuo releerlo). */
export const STRIPE_LOOKBACK_DAYS = 40;
const FIRST_TICK_MS = 90_000;
const PERSIST_EVERY_MS = 3_600_000;

export type StepStatus = "ok" | "skipped" | "unavailable" | "error";
export interface StepResult {
  status: StepStatus;
  detail: string | null;
  /** Hubo cambios en esta pasada (algo creado, importado o contabilizado). */
  changed?: boolean;
  [k: string]: unknown;
}

export interface AutomationReport {
  at: number;
  fiscalYear: StepResult;
  taxSettings: StepResult;
  invoiceDrafts: StepResult;
  invoiceSync: StepResult;
  stripe: StepResult & { source?: StripeApiStatus; missing?: string[] };
}

/** Notas de la configuración fiscal sembrada: qué está confirmado y qué debe validar la gestoría. */
export const SEEDED_TAX_NOTES = [
  "Configuración inicial guardada automáticamente con los datos confirmados del emisor (server/stripe/issuer.ts): razón social, NIF, domicilio fiscal en Madrid y moneda EUR; ejercicio natural 2026.",
  "Pendiente de validar con la gestoría: régimen de IVA (general), periodicidad trimestral (sin REDEME ni SII), tipo del Impuesto sobre Sociedades (25 % general o 15 % de entidad de nueva creación y su primer ejercicio con base positiva), método de los pagos fraccionados, empleados y retenciones (111/115), operaciones intracomunitarias (349) y el tratamiento del IVA de las comisiones de Stripe (exenta o inversión del sujeto pasivo).",
].join("\n");

export interface FinanceAutomationDeps {
  finance: FinanceService;
  ledger: Pick<FinanceStore, "addAudit" | "lastAudit">;
  stripe?: FinanceStripeService | null;
  stripeApi?: Pick<StripeApiBalanceReader, "read"> | null;
  tax?: Pick<FinanceTaxService, "settings" | "saveSettings"> | null;
  invoicing?: { generateExternal(actor: string): Promise<GenerateReport> } | null;
  issuer: { legalName: string; taxId: string };
  now?: () => number;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export class FinanceAutomation {
  private readonly now: () => number;
  constructor(private readonly d: FinanceAutomationDeps) {
    this.now = d.now ?? Date.now;
  }

  private async step(f: () => Promise<StepResult>): Promise<StepResult> {
    try {
      return await f();
    } catch (e) {
      return { status: "error", detail: errText(e) };
    }
  }

  async run(): Promise<AutomationReport> {
    const actor = FINANCE_AUTOMATION_ACTOR;
    const today = madridDateKey(new Date(this.now()));
    const year = Number(today.slice(0, 4));
    const fiscalYear = await this.step(async () => {
      const years = await this.d.finance.fiscalYears();
      if (years.some((y) => y.year === year)) return { status: "ok", detail: `Ejercicio ${year} dado de alta` };
      if (years.length) return { status: "unavailable", detail: `El ejercicio ${year} no está dado de alta (se crea al cerrar el anterior o a mano)` };
      await this.d.finance.createFiscalYear(year, actor);
      return { status: "ok", detail: `Ejercicio ${year} dado de alta automáticamente, sin saldos; el asiento de apertura queda pendiente`, changed: true };
    });
    const taxSettings = await this.step(async () => {
      if (!this.d.tax) return { status: "skipped", detail: "Gestoría no montada (migración 0037)" };
      const cur = await this.d.tax.settings();
      if (cur.configured) return { status: "ok", detail: cur.validatedAt ? "Guardada y validada" : "Guardada, pendiente de validar con la gestoría", validated: !!cur.validatedAt };
      await this.d.tax.saveSettings({ legalName: this.d.issuer.legalName, taxId: this.d.issuer.taxId, fiscalYearStartMonth: 1, notes: SEEDED_TAX_NOTES }, actor);
      return { status: "ok", detail: "Datos confirmados del emisor guardados; pendiente de validar con la gestoría", validated: false, changed: true };
    });
    const invoiceDrafts = await this.step(async () => {
      if (!this.d.invoicing) return { status: "skipped", detail: "Facturación propia no montada" };
      const r = await this.d.invoicing.generateExternal(actor.by);
      return { status: "ok", detail: `${r.created.length} borradores nuevos, ${r.existing} ya existentes, ${r.payments.length} cobros actualizados`, created: r.created.length, payments: r.payments.length, warnings: r.warnings.slice(0, 10), changed: r.created.length + r.payments.length > 0 };
    });
    const invoiceSync = await this.step(async () => {
      const st = await this.d.finance.syncStatus();
      if (st.pending === null) return { status: "skipped", detail: "Facturación propia no montada" };
      if (st.pending === 0) return { status: "ok", detail: `Sin facturas expedidas pendientes (${st.synced} ya contabilizadas)`, posted: 0, errors: 0 };
      const r = await this.d.finance.syncInvoices(actor);
      return { status: r.errors.length ? "error" : "ok", detail: `${r.posted} contabilizadas, ${r.skipped} ya hechas${r.errors.length ? `, ${r.errors.length} con error: ${r.errors[0].message}` : ""}`, posted: r.posted, errors: r.errors.length, changed: r.posted > 0 };
    });
    const stripe = await this.step(async () => {
      if (!this.d.stripe) return { status: "skipped", detail: "Stripe de finanzas no montado (migración 0036)" };
      if (!this.d.stripeApi) return { status: "unavailable", detail: "Sin lector de Stripe por API: solo importación de informes CSV", source: "not_configured" as const };
      const read = await this.d.stripeApi.read(Math.floor(this.now() / 1000) - STRIPE_LOOKBACK_DAYS * 86_400);
      if (read.status !== "ok") return { status: read.status === "error" ? "error" : "unavailable", detail: read.message, source: read.status, missing: read.missing };
      const imp = await this.d.stripe.importFromApi(read, actor);
      const inserted = (imp.balance?.inserted ?? 0) + (imp.payouts?.inserted ?? 0) + (imp.payouts?.refreshed ?? 0);
      // Contabilizar deja su propia auditoría: con novedades, o una vez por hora para lo que quedó pendiente
      const lastPost = await this.d.ledger.lastAudit("stripe.post");
      const posted = inserted > 0 || !lastPost || this.now() - lastPost.at >= PERSIST_EVERY_MS ? await this.d.stripe.post(today, actor) : { posted: 0, skipped: 0, errors: [] as unknown[], truncated: false, pendingFeeVat: undefined as number | undefined };
      return {
        status: posted.errors.length ? "error" : "ok",
        detail: `${read.txns.length} transacciones y ${read.payouts.length} payouts leídos; ${inserted} nuevos; ${posted.posted} contabilizados${posted.pendingFeeVat ? `; ${posted.pendingFeeVat} pendientes del IVA de la comisión` : ""}${posted.errors.length ? `; ${posted.errors.length} con error` : ""}`,
        source: "ok" as const,
        missing: [],
        inserted,
        posted: posted.posted,
        pendingFeeVat: posted.pendingFeeVat ?? 0,
        errors: posted.errors.length,
        truncated: read.truncated,
        changed: inserted + posted.posted > 0,
      };
    });
    return { at: this.now(), fiscalYear, taxSettings, invoiceDrafts, invoiceSync, stripe };
  }

  /** Una pasada y su registro: se guarda si cambió algo, si cambió el estado de algún paso o cada hora. */
  async tick(): Promise<AutomationReport> {
    const r = await this.run();
    const last = await this.d.ledger.lastAudit("automation.run");
    const prev = last?.summary as Partial<AutomationReport> | undefined;
    const steps = ["fiscalYear", "taxSettings", "invoiceDrafts", "invoiceSync", "stripe"] as const;
    const changed = steps.some((k) => r[k].changed || prev?.[k]?.status !== r[k].status || prev?.[k]?.detail !== r[k].detail);
    if (!last || changed || r.at - last.at >= PERSIST_EVERY_MS) {
      await this.d.ledger.addAudit({ at: r.at, actor: FINANCE_AUTOMATION_ACTOR.by, action: "automation.run", entity: "automation", entityId: null, summary: r as unknown as Record<string, unknown>, requestId: null });
    }
    return r;
  }

  /** Última pasada registrada (la lee el control diario). */
  async last(): Promise<AutomationReport | null> {
    const a = await this.d.ledger.lastAudit("automation.run");
    return a?.summary ? (a.summary as unknown as AutomationReport) : null;
  }
}

/** Arranca la tarea (encendida siempre que la contabilidad esté montada: solo escribe en el libro propio y borradores). */
export function startFinanceAutomation(o: {
  automation: Pick<FinanceAutomation, "tick">;
  lock: SchedulerLock;
  timers?: { setInterval: typeof setInterval; clearInterval: typeof clearInterval; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
  log?: (data: Record<string, unknown>) => void;
}): { stop: () => void; tick: () => Promise<void> } {
  const log = o.log ?? ((data) => console.log(JSON.stringify({ ctx: "FinanceAutomation", ...data })));
  log({ event: "scheduler", intervalMs: FINANCE_AUTOMATION_INTERVAL_MS });
  let busy = false;
  let stopped = false;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const release = await o.lock.acquire(FINANCE_AUTOMATION_LOCK);
      if (!release) return;
      try {
        const r = await o.automation.tick();
        const summary = Object.fromEntries((["fiscalYear", "taxSettings", "invoiceDrafts", "invoiceSync", "stripe"] as const).map((k) => [k, r[k].status]));
        if (Object.values(summary).some((s) => s === "error") || (["fiscalYear", "taxSettings", "invoiceDrafts", "invoiceSync", "stripe"] as const).some((k) => r[k].changed)) log({ event: "tick", ...summary });
      } finally {
        await release();
      }
    } catch (e) {
      log({ event: "tick", error: "tick_failed", message: errText(e).slice(0, 200) });
    } finally {
      busy = false;
    }
  };
  const timers = o.timers ?? { setInterval, clearInterval, setTimeout, clearTimeout };
  const first = timers.setTimeout(() => void tick(), FIRST_TICK_MS);
  const every = timers.setInterval(() => void tick(), FINANCE_AUTOMATION_INTERVAL_MS);
  (first as { unref?: () => void }).unref?.();
  (every as { unref?: () => void }).unref?.();
  return {
    tick,
    stop: () => {
      stopped = true;
      timers.clearTimeout(first);
      timers.clearInterval(every);
    },
  };
}
