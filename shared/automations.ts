/**
 * Elephant Connect · Automatizaciones avanzadas (capacidad `automations-advanced`): definición compartida por el servidor
 * y el panel. Una regla de la empresa tiene UN disparador (hechos que el Core ya registra, detectados con una consulta
 * periódica; sin bus de eventos nuevo), condiciones simples sobre sus campos (todas deben cumplirse) y de uno a cinco
 * pasos con retardo, cada uno con una acción que reutiliza lo que ya hace el Core: correo transaccional con la marca y
 * el correo de la empresa, tarea del CRM, aviso al equipo en la campana del panel, etapa del embudo o etiqueta de la
 * oportunidad.
 *
 * Operativo y transaccional: los envíos de marketing son de Elephant Campaigns. Un correo «comercial» (seguimiento de
 * un presupuesto) solo sale a quien tiene el consentimiento de marketing concedido.
 */
import { z } from "zod";

export const AUTOMATIONS_CAPABILITY = "automations-advanced";

/** Límites técnicos. */
export const AUTOMATION_LIMITS = {
  nameMax: 120,
  conditionsMax: 8,
  stepsMax: 5,
  subjectMax: 160,
  bodyMax: 2000,
  titleMax: 160,
  /** Retardo máximo de un paso: 90 días. */
  delayMaxMinutes: 90 * 24 * 60,
  dailyCapDefault: 50,
  dailyCapMax: 500,
  /** Tope diario de acciones de toda la empresa (todas sus reglas). */
  companyDailyMax: 1000,
  /** Acciones como máximo por empresa y pasada de la tarea programada. */
  perRun: 200,
  /** Intentos como máximo de un paso que falla (el primero y dos reintentos). */
  maxAttempts: 3,
  /** Un paso que debió ejecutarse hace más de esto (tarea parada) ya no se ejecuta: queda omitido «fuera de plazo». */
  catchUpMinutes: 3 * 24 * 60,
  /** Ventana de la simulación: lo ocurrido en los últimos 7 días. */
  simulateLookbackDays: 7,
  simulateMax: 50,
} as const;

// ─── Disparadores ────────────────────────────────────────────────────────────

export type AutomationEntityType = "lead" | "quote" | "reservation" | "invoice";
export type FieldType = "text" | "number" | "choice";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: ReadonlyArray<{ value: string; label: string }>;
}

export interface TriggerDef {
  label: string;
  description: string;
  entity: AutomationEntityType;
  /** «after»: el retardo cuenta desde el hecho; «before»: antes de la fecha de la reserva. */
  timing: "after" | "before";
  /** Cómo se lee el retardo en el editor. */
  delayLabel: string;
  fields: readonly FieldDef[];
}

const opt = (...vals: Array<[string, string]>) => vals.map(([value, label]) => ({ value, label }));
const CHANNELS = opt(["ONLINE_DIRECTO", "Web"], ["ONLINE_ASISTIDO", "Web asistida"], ["VENTA_DELEGADA", "Venta delegada"], ["TELEFONO", "Teléfono"], ["EMAIL", "Correo"], ["TPV_FISICO", "TPV"], ["PARTNER", "Colaborador"], ["TICKETING", "Ticketing"], ["MANUAL", "Manual"], ["API", "API"]);
const RESERVATION_FIELDS: readonly FieldDef[] = [
  { key: "product", label: "Producto", type: "text" },
  { key: "amount", label: "Importe (€)", type: "number" },
  { key: "people", label: "Personas", type: "number" },
  { key: "channel", label: "Canal", type: "choice", options: CHANNELS },
];

export const AUTOMATION_TRIGGERS = {
  lead_created: {
    label: "Oportunidad nueva",
    description: "Cuando entra una solicitud u oportunidad nueva en el CRM.",
    entity: "lead",
    timing: "after",
    delayLabel: "después de recibirla",
    fields: [
      { key: "source", label: "Origen", type: "text" },
      { key: "priority", label: "Prioridad", type: "choice", options: opt(["baja", "Baja"], ["media", "Media"], ["alta", "Alta"]) },
      { key: "status", label: "Estado", type: "choice", options: opt(["nuevo", "Nuevo"], ["contactado", "Contactado"], ["en_proceso", "En proceso"], ["convertido", "Convertido"], ["perdido", "Perdido"]) },
      { key: "company", label: "Empresa del cliente", type: "text" },
      { key: "product", label: "Producto de interés", type: "text" },
      { key: "people", label: "Personas", type: "number" },
      { key: "budget", label: "Presupuesto indicado (€)", type: "number" },
    ],
  },
  quote_unanswered: {
    label: "Presupuesto enviado sin respuesta",
    description: "Presupuestos enviados que siguen sin aceptar ni pagar. Si el cliente responde, los pasos pendientes ya no se ejecutan.",
    entity: "quote",
    timing: "after",
    delayLabel: "después de enviarlo, si sigue sin respuesta",
    fields: [
      { key: "total", label: "Total (€)", type: "number" },
      { key: "title", label: "Título", type: "text" },
      { key: "viewed", label: "Lo ha abierto", type: "choice", options: opt(["si", "Sí"], ["no", "No"]) },
    ],
  },
  reservation_paid: {
    label: "Reserva confirmada",
    description: "Reservas pagadas (confirmadas) y no anuladas.",
    entity: "reservation",
    timing: "after",
    delayLabel: "después de confirmarse",
    fields: RESERVATION_FIELDS,
  },
  reservation_upcoming: {
    label: "Reserva próxima",
    description: "Reservas confirmadas cuya fecha se acerca (no anuladas). Si la tarea programada estuvo parada, un paso pendiente solo se recupera mientras la reserva no haya empezado.",
    entity: "reservation",
    timing: "before",
    delayLabel: "antes de la reserva",
    fields: RESERVATION_FIELDS,
  },
  invoice_unpaid: {
    label: "Factura sin cobrar",
    description: "Facturas emitidas que siguen sin cobrar (ni anuladas ni abonadas). Si se cobran, los pasos pendientes ya no se ejecutan.",
    entity: "invoice",
    timing: "after",
    delayLabel: "después de emitirla, si sigue sin cobrar",
    fields: [
      { key: "total", label: "Total (€)", type: "number" },
      { key: "status", label: "Estado", type: "choice", options: opt(["generada", "Emitida"], ["enviada", "Enviada"]) },
    ],
  },
} as const satisfies Record<string, TriggerDef>;

export type AutomationTrigger = keyof typeof AUTOMATION_TRIGGERS;
export const AUTOMATION_TRIGGER_KEYS = Object.keys(AUTOMATION_TRIGGERS) as AutomationTrigger[];

export const ENTITY_LABELS: Record<AutomationEntityType, string> = { lead: "Oportunidad", quote: "Presupuesto", reservation: "Reserva", invoice: "Factura" };

/** Variables que se pueden usar en los textos: {{nombre}}, {{referencia}}… */
export const TEMPLATE_VARIABLES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "nombre", label: "Nombre del cliente" },
  { key: "referencia", label: "Número de presupuesto, reserva o factura" },
  { key: "fecha", label: "Fecha de la reserva o del hecho" },
  { key: "importe", label: "Importe" },
  { key: "producto", label: "Producto o título" },
  { key: "empresa", label: "Nombre de tu empresa" },
];

// ─── Condiciones ─────────────────────────────────────────────────────────────

export const CONDITION_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "empty", "not_empty"] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];
export const CONDITION_OP_LABELS: Record<ConditionOp, string> = {
  eq: "es", neq: "no es", gt: "mayor que", gte: "mayor o igual que", lt: "menor que", lte: "menor o igual que", contains: "contiene", empty: "está vacío", not_empty: "no está vacío",
};
/** Operadores con sentido para cada tipo de campo. */
export const OPS_FOR: Record<FieldType, readonly ConditionOp[]> = {
  text: ["eq", "neq", "contains", "empty", "not_empty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "empty", "not_empty"],
  choice: ["eq", "neq"],
};
export const opNeedsValue = (op: ConditionOp) => op !== "empty" && op !== "not_empty";

export interface AutomationCondition {
  field: string;
  op: ConditionOp;
  value: string;
}

// ─── Acciones ────────────────────────────────────────────────────────────────

export const ACTION_KINDS = ["email", "task", "notify", "lead_stage", "lead_tag"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export const ACTION_LABELS: Record<ActionKind, string> = {
  email: "Enviar un correo al cliente",
  task: "Crear una tarea en el CRM",
  notify: "Avisar al equipo en el panel",
  lead_stage: "Mover la oportunidad de etapa",
  lead_tag: "Poner una etiqueta a la oportunidad",
};
/** Correo operativo (de la reserva, la factura…) o comercial (seguimiento): el comercial exige consentimiento. */
export const EMAIL_PURPOSES = ["operational", "commercial"] as const;
export type EmailPurpose = (typeof EMAIL_PURPOSES)[number];
export const EMAIL_PURPOSE_LABELS: Record<EmailPurpose, string> = {
  operational: "Operativo (sobre su reserva, presupuesto o factura)",
  commercial: "Comercial (solo a quien aceptó comunicaciones comerciales, con enlace de baja; necesita Elephant Campaigns)",
};

export type AutomationAction =
  | { kind: "email"; purpose: EmailPurpose; subject: string; body: string }
  | { kind: "task"; title: string; dueInDays: number; priority: "baja" | "media" | "alta"; assignedTo: number | null }
  | { kind: "notify"; title: string; body: string }
  | { kind: "lead_stage"; stageId: number }
  | { kind: "lead_tag"; tagId: number };

export interface AutomationStep {
  /** Clave estable del paso (la asigna el servidor): identifica sus ejecuciones aunque cambie el orden de los pasos. */
  key?: string;
  delayMinutes: number;
  action: AutomationAction;
}

export interface AutomationRuleInput {
  name: string;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  steps: AutomationStep[];
  dailyCap: number;
}

// ─── Validación (zod) ────────────────────────────────────────────────────────

const text = (max: number) => z.string().trim().min(1).max(max);
export const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("email"), purpose: z.enum(EMAIL_PURPOSES), subject: text(AUTOMATION_LIMITS.subjectMax), body: text(AUTOMATION_LIMITS.bodyMax) }),
  z.object({ kind: z.literal("task"), title: text(AUTOMATION_LIMITS.titleMax), dueInDays: z.number().int().min(0).max(60), priority: z.enum(["baja", "media", "alta"]), assignedTo: z.number().int().positive().nullable() }),
  z.object({ kind: z.literal("notify"), title: text(AUTOMATION_LIMITS.titleMax), body: z.string().trim().max(500) }),
  z.object({ kind: z.literal("lead_stage"), stageId: z.number().int().positive() }),
  z.object({ kind: z.literal("lead_tag"), tagId: z.number().int().positive() }),
]);
export const conditionSchema = z.object({ field: z.string().min(1).max(40), op: z.enum(CONDITION_OPS), value: z.string().max(200) });
export const STEP_KEY_RE = /^[a-z0-9]{4,16}$/;
export const stepSchema = z.object({ key: z.string().regex(STEP_KEY_RE).optional(), delayMinutes: z.number().int().min(0).max(AUTOMATION_LIMITS.delayMaxMinutes), action: actionSchema });
export const ruleInputSchema = z.object({
  name: text(AUTOMATION_LIMITS.nameMax),
  trigger: z.enum(AUTOMATION_TRIGGER_KEYS as [AutomationTrigger, ...AutomationTrigger[]]),
  conditions: z.array(conditionSchema).max(AUTOMATION_LIMITS.conditionsMax),
  steps: z.array(stepSchema).min(1).max(AUTOMATION_LIMITS.stepsMax),
  dailyCap: z.number().int().min(1).max(AUTOMATION_LIMITS.dailyCapMax),
});

/**
 * Comprobaciones que zod no expresa: campos y operadores válidos para el disparador, valores numéricos, acciones de
 * oportunidad solo donde hay oportunidad y pasos en orden. Devuelve la regla normalizada (pasos ordenados) o los errores.
 */
export function validateRule(input: AutomationRuleInput): { ok: true; rule: AutomationRuleInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const t = AUTOMATION_TRIGGERS[input.trigger] as TriggerDef | undefined;
  if (!t) return { ok: false, errors: ["El disparador no existe."] };
  for (const c of input.conditions) {
    const f = t.fields.find((x) => x.key === c.field);
    if (!f) {
      errors.push(`El campo «${c.field}» no existe en «${t.label}».`);
      continue;
    }
    if (!OPS_FOR[f.type].includes(c.op)) errors.push(`«${f.label}» no admite la comparación «${CONDITION_OP_LABELS[c.op]}».`);
    if (opNeedsValue(c.op)) {
      if (!c.value.trim()) errors.push(`Falta el valor de la condición sobre «${f.label}».`);
      else if (f.type === "number" && toNumber(c.value) == null) errors.push(`El valor de «${f.label}» debe ser un número.`);
      else if (f.type === "choice" && !f.options?.some((o) => o.value === c.value)) errors.push(`El valor de «${f.label}» no es una opción válida.`);
    }
  }
  const hasLead = t.entity === "lead" || t.entity === "quote";
  for (const s of input.steps) {
    if ((s.action.kind === "lead_stage" || s.action.kind === "lead_tag") && !hasLead) errors.push(`«${ACTION_LABELS[s.action.kind]}» solo está disponible con oportunidades y presupuestos.`);
  }
  if (errors.length) return { ok: false, errors };
  // Pasos en el orden en que ocurren: después del hecho, de menos a más retardo; antes de la reserva, de más a menos
  const keys = input.steps.map((s) => s.key).filter((k): k is string => !!k);
  if (new Set(keys).size !== keys.length) return { ok: false, errors: ["Hay dos pasos con la misma clave."] };
  const used = new Set(keys);
  const withKeys = input.steps.map((s) => (s.key ? s : { ...s, key: newStepKey(used) }));
  const steps = withKeys.sort((a, b) => (t.timing === "before" ? b.delayMinutes - a.delayMinutes : a.delayMinutes - b.delayMinutes));
  return { ok: true, rule: { ...input, name: input.name.trim(), steps } };
}

/** Clave nueva de paso, distinta de las usadas (y de las que pudo tener un paso borrado: aleatoria). */
export function newStepKey(used: Set<string>): string {
  for (;;) {
    const k = `s${Math.random().toString(36).slice(2, 10)}`.padEnd(6, "0");
    if (!used.has(k)) {
      used.add(k);
      return k;
    }
  }
}
/** Clave de un paso guardado (las reglas siempre las llevan; por si acaso, la posición). */
export const stepKeyOf = (s: Pick<AutomationStep, "key">, i: number) => s.key ?? `p${i}`;

export function toNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** «2 días», «3 h», «30 min», «al momento». */
export function delayText(minutes: number): string {
  if (minutes <= 0) return "al momento";
  if (minutes % 1440 === 0) return `${minutes / 1440} ${minutes === 1440 ? "día" : "días"}`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

// ─── Plantillas de regla listas para activar (se crean apagadas) ─────────────

export interface RuleTemplate {
  key: string;
  title: string;
  summary: string;
  rule: AutomationRuleInput;
}

export const RULE_TEMPLATES: readonly RuleTemplate[] = [
  {
    key: "recordatorio-reserva",
    title: "Recordatorio de la reserva el día antes",
    summary: "Correo al cliente 24 horas antes de su reserva confirmada.",
    rule: {
      name: "Recordatorio de la reserva (24 h antes)",
      trigger: "reservation_upcoming",
      conditions: [],
      dailyCap: 100,
      steps: [
        {
          delayMinutes: 24 * 60,
          action: {
            kind: "email",
            purpose: "operational",
            subject: "Tu reserva en {{empresa}}: {{fecha}}",
            body: "Te recordamos tu reserva de {{producto}} el {{fecha}} (localizador {{referencia}}).\nSi necesitas cambiar algo, responde a este correo.",
          },
        },
      ],
    },
  },
  {
    key: "seguimiento-presupuesto",
    title: "Seguimiento de presupuestos sin respuesta",
    summary: "A los 3 días, tarea para llamar al cliente; a los 7, correo de seguimiento (solo con consentimiento comercial).",
    rule: {
      name: "Seguimiento de presupuesto sin respuesta",
      trigger: "quote_unanswered",
      conditions: [],
      dailyCap: 50,
      steps: [
        { delayMinutes: 3 * 1440, action: { kind: "task", title: "Llamar a {{nombre}} por el presupuesto {{referencia}}", dueInDays: 1, priority: "media", assignedTo: null } },
        {
          delayMinutes: 7 * 1440,
          action: {
            kind: "email",
            purpose: "commercial",
            subject: "¿Te ayudamos con tu presupuesto {{referencia}}?",
            body: "Hace unos días te enviamos el presupuesto {{referencia}} ({{producto}}, {{importe}}).\n¿Tienes alguna duda? Responde a este correo y te ayudamos.",
          },
        },
      ],
    },
  },
  {
    key: "oportunidad-nueva",
    title: "Atención a las oportunidades nuevas",
    summary: "Aviso al equipo en el panel y tarea de primer contacto para el día siguiente.",
    rule: {
      name: "Primer contacto con las oportunidades nuevas",
      trigger: "lead_created",
      conditions: [],
      dailyCap: 100,
      steps: [
        { delayMinutes: 0, action: { kind: "notify", title: "Oportunidad nueva: {{nombre}}", body: "Interés: {{producto}}." } },
        { delayMinutes: 0, action: { kind: "task", title: "Primer contacto con {{nombre}}", dueInDays: 1, priority: "alta", assignedTo: null } },
      ],
    },
  },
  {
    key: "reserva-grupo",
    title: "Aviso de reservas de grupo",
    summary: "Aviso al equipo cuando se confirma una reserva de 10 personas o más.",
    rule: {
      name: "Reserva de grupo confirmada",
      trigger: "reservation_paid",
      conditions: [{ field: "people", op: "gte", value: "10" }],
      dailyCap: 50,
      steps: [{ delayMinutes: 0, action: { kind: "notify", title: "Reserva de grupo: {{nombre}} ({{producto}})", body: "Reserva {{referencia}} para el {{fecha}}, {{importe}}." } }],
    },
  },
  {
    key: "factura-sin-cobrar",
    title: "Facturas sin cobrar",
    summary: "A los 15 días, recordatorio al cliente; a los 30, aviso al equipo.",
    rule: {
      name: "Factura sin cobrar",
      trigger: "invoice_unpaid",
      conditions: [],
      dailyCap: 50,
      steps: [
        {
          delayMinutes: 15 * 1440,
          action: { kind: "email", purpose: "operational", subject: "Factura {{referencia}} pendiente de pago", body: "Según nuestros registros, la factura {{referencia}} de {{importe}} sigue pendiente de pago.\nSi ya la has pagado, no tengas en cuenta este mensaje." },
        },
        { delayMinutes: 30 * 1440, action: { kind: "notify", title: "Factura {{referencia}} sin cobrar a los 30 días", body: "{{nombre}} · {{importe}}" } },
      ],
    },
  },
];

/** Recordatorios que el Core ya envía por su cuenta (para no duplicarlos con una plantilla). */
export interface CoreReminders {
  /** Recordatorios automáticos del Centro de comunicaciones (emailAutomationJob encendido y con reglas activas). */
  emailAutomation: boolean;
  /** Recordatorios de cita de Care Net activados en sus ajustes. */
  careNetReminders: boolean;
}

/** Aviso de una plantilla si duplicaría recordatorios que el Core ya envía; null si no. */
export function templateWarning(key: string, core: CoreReminders): string | null {
  if (key === "recordatorio-reserva") {
    const active = [core.emailAutomation ? "los recordatorios automáticos del Centro de comunicaciones" : null, core.careNetReminders ? "los recordatorios de cita de Care Net" : null].filter(Boolean);
    if (active.length) return `Ya están activos ${active.join(" y ")}: con esta plantilla el cliente podría recibir dos recordatorios de la misma reserva. Desactiva uno de los dos o añade una condición sobre el producto.`;
  }
  if (key === "seguimiento-presupuesto" && core.emailAutomation)
    return "Ya están activos los recordatorios automáticos del Centro de comunicaciones, que también hacen seguimiento de presupuestos: con esta plantilla el cliente podría recibir dos seguimientos. Desactívalos allí o quita el paso de correo.";
  return null;
}

// ─── Ejecuciones (historial) ─────────────────────────────────────────────────

export const RUN_STATUSES = ["running", "done", "skipped", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_STATUS_LABELS: Record<RunStatus, string> = { running: "En curso", done: "Hecho", skipped: "Omitido", failed: "Fallido" };

/** Motivos de omisión o fallo (los textos del panel). */
export const RUN_REASON_LABELS: Record<string, string> = {
  sin_correo: "El cliente no tiene un correo válido",
  cliente_en_pausa: "El cliente tiene las comunicaciones automáticas en pausa",
  sin_consentimiento: "Correo comercial: el cliente no ha aceptado comunicaciones comerciales",
  sin_enlace_de_baja: "Correo comercial: no hay enlace de baja disponible (necesita Elephant Campaigns)",
  prueba_gratuita: "Durante la prueba gratuita solo se escribe a los buzones de la empresa",
  correo_no_disponible: "El correo de la empresa no está disponible",
  sin_oportunidad: "No hay oportunidad asociada",
  sin_embudo: "El embudo de ventas avanzado no está contratado",
  sin_tareas: "Las tareas del CRM no están incluidas en el plan",
  sin_etiquetas: "Las etiquetas del CRM no están incluidas en el plan",
  etapa_no_existe: "La etapa ya no existe",
  etiqueta_no_existe: "La etiqueta ya no existe",
  responsable_no_valido: "El responsable de la tarea ya no está en el equipo",
  fuera_de_plazo: "Su momento pasó hace más de 3 días (la tarea programada estuvo parada)",
  envio_fallido: "El envío falló",
  error: "Error al ejecutar la acción",
};
