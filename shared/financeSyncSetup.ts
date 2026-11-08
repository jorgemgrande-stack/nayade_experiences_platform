/**
 * Elephant Finance Sync: puesta en marcha en autoservicio. Función pura que usan el servidor (financeSync.setup) y el
 * panel: a partir de los datos reales de la empresa decide qué pasos están hechos y si el producto ya funciona sin
 * implantación acompañada.
 *
 * «Listo» = hay un extracto bancario importado y al menos una fuente de operaciones del datáfono (un Excel de
 * operaciones importado o el buzón de tickets comprobado). La conciliación es el paso siguiente: se sugiere, no se exige.
 */
import type { IntegrationState } from "./integrationsPanel";

export const FINANCE_SYNC_SETUP_PATH = "/admin/contabilidad/finance-sync";
export const BANK_MOVEMENTS_PATH = "/admin/contabilidad/movimientos-bancarios";
export const CARD_OPERATIONS_PATH = "/admin/contabilidad/operaciones-tpv";
export const CARD_BATCHES_PATH = "/admin/contabilidad/remesas-tpv";
export const CONCILIATION_PATH = "/admin/contabilidad/conciliacion-tpv";
export const MAILBOX_ANCHOR = `${FINANCE_SYNC_SETUP_PATH}#buzon`;

/** Formatos de extracto que admite la importación (server/bankStatementImport.ts). */
export const BANK_STATEMENT_FORMATS = [
  { label: "Norma 43 (cuaderno 43 de la AEB)", extensions: ".n43, .aeb, .q43, .txt", help: "El fichero que descargan todos los bancos españoles: es el más fiable." },
  { label: "Excel", extensions: ".xlsx, .xls", help: "El extracto en Excel tal y como lo descarga tu banco, con su fila de cabecera." },
  { label: "CSV", extensions: ".csv", help: "Columnas de fecha, concepto e importe (y, si las hay, fecha valor y saldo)." },
] as const;

export type FinanceSyncStepId = "bankStatement" | "cardTerminal" | "mailbox" | "conciliation";
/** done: hecho · todo: pendiente · optional: no hace falta para empezar · blocked: necesita antes otro paso · attention: algo falla */
export type FinanceSyncStepStatus = "done" | "todo" | "optional" | "blocked" | "attention";

export interface FinanceSyncStep {
  id: FinanceSyncStepId;
  title: string;
  description: string;
  status: FinanceSyncStepStatus;
  /** Qué hay ahora mismo, en una frase (p. ej. «2 extractos importados, 340 movimientos»). */
  detail: string;
  href: string;
  action: string;
  /** Necesario para que Finance Sync funcione (los opcionales no cuentan para «listo»). */
  required: boolean;
}

export interface FinanceSyncFacts {
  bank: { imports: number; movements: number };
  cardTerminal: { excelImports: number; operations: number };
  mailbox: {
    /** false: la bóveda por empresa no está disponible (instalación de una sola empresa): lo configura el equipo técnico. */
    available: boolean;
    /** Estado de «Integraciones y pagos» (working = completa y comprobada después del último cambio). */
    state: IntegrationState;
    detail: string | null;
    /** Lectura automática encendida para esta empresa (interruptor `email_ingestion_enabled` de su base). */
    ingestionEnabled: boolean;
    /** Correos de tickets leídos correctamente. */
    emailsRead: number;
  };
  conciliation: { confirmed: number; suggested: number };
}

export interface FinanceSyncSetup {
  steps: FinanceSyncStep[];
  /** Pasos necesarios hechos / pasos necesarios. */
  completed: number;
  total: number;
  ready: boolean;
  /** Qué falta para estar listo (vacío si ya lo está). */
  missing: string[];
}

const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;

/** ¿Funciona el buzón? Completo y comprobado con éxito después del último cambio. */
export function mailboxVerified(m: FinanceSyncFacts["mailbox"]): boolean {
  return m.available && m.state === "working";
}

export function financeSyncSetup(f: FinanceSyncFacts): FinanceSyncSetup {
  const bankDone = f.bank.movements > 0;
  const excelDone = f.cardTerminal.excelImports > 0;
  const mailboxOk = mailboxVerified(f.mailbox);
  const cardDone = excelDone || mailboxOk;

  const cardSources: string[] = [];
  if (excelDone) cardSources.push(n(f.cardTerminal.excelImports, "Excel de operaciones importado", "Excel de operaciones importados"));
  if (mailboxOk) cardSources.push("buzón de tickets comprobado");

  const mailboxStatus: FinanceSyncStepStatus = !f.mailbox.available
    ? "optional"
    : f.mailbox.state === "failing"
      ? "attention"
      : mailboxOk && f.mailbox.ingestionEnabled
        ? "done"
        : excelDone
          ? "optional"
          : "todo";
  const mailboxDetail = !f.mailbox.available
    ? "En esta instalación el buzón lo configura el equipo técnico."
    : f.mailbox.state === "off"
      ? "Sin configurar."
      : f.mailbox.state === "incomplete"
        ? f.mailbox.detail ?? "Faltan datos del buzón."
        : f.mailbox.state === "unchecked"
          ? "Datos guardados: falta pulsar «Comprobar conexión»."
          : f.mailbox.state === "failing"
            ? `La última comprobación falló${f.mailbox.detail ? `: ${f.mailbox.detail}` : "."}`
            : f.mailbox.ingestionEnabled
              ? `Lectura automática encendida (cada 5 minutos). ${n(f.mailbox.emailsRead, "correo leído", "correos leídos")}.`
              : "Conexión comprobada. Falta encender la lectura automática.";

  const conciliationStatus: FinanceSyncStepStatus = f.conciliation.confirmed > 0 ? "done" : bankDone && cardDone ? "todo" : "blocked";

  const steps: FinanceSyncStep[] = [
    {
      id: "bankStatement",
      title: "Importa tu primer extracto bancario",
      description: "Descarga el extracto de tu banco (mejor en Norma 43) e impórtalo: los movimientos quedan listos para conciliar.",
      status: bankDone ? "done" : "todo",
      detail: bankDone ? `${n(f.bank.imports, "extracto importado", "extractos importados")}, ${n(f.bank.movements, "movimiento", "movimientos")}.` : "Todavía no has importado ningún extracto.",
      href: BANK_MOVEMENTS_PATH,
      action: bankDone ? "Ver movimientos" : "Importar extracto",
      required: true,
    },
    {
      id: "cardTerminal",
      title: "Trae las operaciones del datáfono",
      description: "Importa el Excel de operaciones que descargas del portal de tu banco o, si prefieres no hacerlo a mano, configura el buzón donde recibes los tickets.",
      status: cardDone ? "done" : f.mailbox.state === "failing" ? "attention" : "todo",
      detail: cardDone ? `Fuente activa: ${cardSources.join(" y ")}.` : f.cardTerminal.operations > 0 ? `${n(f.cardTerminal.operations, "operación", "operaciones")} registradas, pero ninguna fuente comprobada.` : "Todavía no hay ninguna fuente de operaciones.",
      href: CARD_OPERATIONS_PATH,
      action: excelDone ? "Ver operaciones" : "Importar Excel de operaciones",
      required: true,
    },
    {
      id: "mailbox",
      title: "Buzón de tickets del datáfono (opcional si importas el Excel)",
      description: "Indica el buzón donde tu banco te envía las copias de los tickets: se leen solos cada 5 minutos, sin borrar ni mover tus correos.",
      status: mailboxStatus,
      detail: mailboxDetail,
      href: MAILBOX_ANCHOR,
      action: f.mailbox.state === "off" ? "Configurar el buzón" : "Revisar el buzón",
      required: false,
    },
    {
      id: "conciliation",
      title: "Revisa tu primera conciliación",
      description: "Con banco y datáfono cargados, la plataforma propone qué remesa del datáfono corresponde a cada abono del banco: confírmala o recházala.",
      status: conciliationStatus,
      detail:
        f.conciliation.confirmed > 0
          ? `${n(f.conciliation.confirmed, "conciliación confirmada", "conciliaciones confirmadas")}.`
          : conciliationStatus === "blocked"
            ? "Disponible cuando tengas el extracto y las operaciones del datáfono."
            : f.conciliation.suggested > 0
              ? `${n(f.conciliation.suggested, "sugerencia pendiente", "sugerencias pendientes")} de revisar.`
              : "Aún no hay sugerencias: aparecen al cruzar las remesas del datáfono con los abonos del banco.",
      href: CONCILIATION_PATH,
      action: "Ir a la conciliación",
      required: false,
    },
  ];

  const missing: string[] = [];
  if (!bankDone) missing.push("Importar un extracto bancario.");
  if (!cardDone) missing.push("Importar el Excel de operaciones del datáfono o comprobar el buzón de tickets.");
  const required = steps.filter((s) => s.required);
  return {
    steps,
    completed: required.filter((s) => s.status === "done").length,
    total: required.length,
    ready: missing.length === 0,
    missing,
  };
}
