/**
 * Elephant Copilot avanzado (capacidad `copilot-advanced`) — lógica pura compartida por el servidor y el panel.
 *
 *  - Herramientas de SOLO LECTURA que define el Core (ventas, reservas, ocupación, clientes, oportunidades,
 *    presupuestos, facturas pendientes, ausencias de RRHH…). La IA solo elige herramienta y parámetros de esta lista;
 *    nunca escribe consultas a la base de datos.
 *  - Cada herramienta exige un permiso del panel (con el rol legado de respaldo) y la capacidad que licencia sus datos:
 *    quien no ve facturación o RRHH en el panel tampoco la ve en Copilot.
 *  - Redacción asistida (respuesta a un cliente, descripción de producto, resumen de un cliente): texto que el usuario
 *    revisa y copia; Copilot no envía ni guarda nada en el CRM.
 *
 * Nada de esto llama a servicios externos: lo usan server/copilot/* y la pantalla /admin/copilot.
 */

export const COPILOT_CAPABILITY = "copilot-advanced";

/** Topes técnicos de cada petición (no son cuotas comerciales: el consumo de IA lo mide y limita el ERM). */
export const COPILOT_LIMITS = {
  questionMax: 2000,
  draftInputMax: 4000,
  draftNotesMax: 1000,
  /** Mensajes anteriores de la conversación que se envían a la IA. */
  historyMax: 12,
  /** Herramientas que la IA puede usar en una misma pregunta. */
  toolCallsMax: 4,
  /** Caracteres del resultado de una herramienta que se pasan a la IA. */
  toolResultMax: 6000,
  /** Tokens de salida de cada llamada a la IA. */
  maxTokens: 900,
  /** Protección contra ráfagas: preguntas y borradores de un usuario en la ventana indicada. */
  burstMax: 30,
  burstWindowSeconds: 600,
  titleMax: 80,
  conversationsMax: 50,
  rowsMax: 50,
  rangeDaysMax: 366,
} as const;

// ── Permisos y herramientas ──────────────────────────────────────────────────────

/** Permiso del panel que exige cada grupo de datos, con los roles legados que lo tienen sin RBAC. */
export const COPILOT_PERMISSIONS = {
  crm: { key: "crm.view", fallbackRoles: ["admin", "agente", "readonly"] },
  finance: { key: "accounting.reports.view", fallbackRoles: ["admin"] },
  hr: { key: "hr.view", fallbackRoles: ["admin"] },
} as const;
export type CopilotPermission = keyof typeof COPILOT_PERMISSIONS;

export const COPILOT_TOOL_NAMES = [
  "ventas_periodo",
  "top_productos",
  "reservas_proximas",
  "ocupacion",
  "buscar_clientes",
  "ficha_cliente",
  "oportunidades_abiertas",
  "presupuestos_pendientes",
  "facturas_pendientes",
  "ausencias_rrhh",
] as const;
export type CopilotToolName = (typeof COPILOT_TOOL_NAMES)[number];

export interface CopilotToolMeta {
  name: CopilotToolName;
  /** Nombre visible en el panel. */
  label: string;
  /** Descripción para la IA (qué devuelve y cuándo usarla). */
  description: string;
  permission: CopilotPermission;
  /** Basta con una de estas capacidades (activa o en solo lectura). */
  capabilities: readonly string[];
  /** Esquema JSON de los parámetros (formato de herramientas de la API de chat). */
  parameters: Record<string, unknown>;
  /** Consulta rápida que el panel ejecuta sin IA (parámetros por defecto). */
  quick?: { label: string; args: Record<string, unknown> };
}

const day = { type: "string", description: "Fecha AAAA-MM-DD (hora de Madrid)." };
const limit = (max: number) => ({ type: "integer", minimum: 1, maximum: max });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

export const COPILOT_TOOLS: readonly CopilotToolMeta[] = [
  {
    name: "ventas_periodo",
    label: "Ventas por periodo",
    description: "Ventas cobradas entre dos fechas, tal como quedan registradas en las reservas pagadas: pedidos de la tienda online, reservas y presupuestos cobrados y ventas del TPV (cada venta del TPV genera su reserva pagada). Total con impuestos, número de operaciones, ticket medio y evolución por día, semana o mes. No incluye otros movimientos de caja ni descuenta abonos o devoluciones. Sin fechas: últimos 30 días.",
    permission: "finance",
    capabilities: ["shop-orders", "bill-cash"],
    parameters: obj({ desde: day, hasta: day, agrupar: { type: "string", enum: ["dia", "semana", "mes"] } }),
    quick: { label: "Ventas de los últimos 30 días", args: {} },
  },
  {
    name: "top_productos",
    label: "Productos más vendidos",
    description: "Productos con más ventas cobradas entre dos fechas, por importe o por personas. Sin fechas: últimos 30 días.",
    permission: "finance",
    capabilities: ["shop-orders", "bill-cash"],
    parameters: obj({ desde: day, hasta: day, orden: { type: "string", enum: ["importe", "personas"] }, limite: limit(10) }),
    quick: { label: "Top productos del mes", args: {} },
  },
  {
    name: "reservas_proximas",
    label: "Reservas próximas",
    description: "Reservas no anuladas (pagadas o pendientes de pago) con fecha de actividad desde `desde` (por defecto hoy) durante `dias` días: producto, hora, personas, cliente y estado del pago.",
    permission: "crm",
    capabilities: ["shop-orders", "bookings-generic"],
    parameters: obj({ desde: day, dias: limit(31), limite: limit(50) }),
    quick: { label: "Reservas de los próximos 7 días", args: { dias: 7 } },
  },
  {
    name: "ocupacion",
    label: "Ocupación",
    description: "Ocupación por día y producto: personas reservadas frente al aforo de sus horarios activos (si el producto tiene horarios con aforo). Por defecto hoy y los 6 días siguientes.",
    permission: "crm",
    capabilities: ["shop-orders", "bookings-generic"],
    parameters: obj({ desde: day, dias: limit(14) }),
    quick: { label: "Ocupación de esta semana", args: {} },
  },
  {
    name: "buscar_clientes",
    label: "Buscar clientes",
    description: "Busca clientes del CRM por nombre, correo o empresa. Sin texto: los clientes con más gasto. Devuelve id, nombre, empresa, reservas, gasto total y última reserva.",
    permission: "crm",
    capabilities: ["crm-contacts", "crm-accounts"],
    parameters: obj({ texto: { type: "string", maxLength: 80 }, limite: limit(10) }),
    quick: { label: "Mejores clientes", args: {} },
  },
  {
    name: "ficha_cliente",
    label: "Ficha de un cliente",
    description: "Datos de un cliente del CRM por su id (usa antes buscar_clientes si no lo sabes): contacto, notas, etiquetas y sus últimas reservas.",
    permission: "crm",
    capabilities: ["crm-contacts", "crm-accounts"],
    parameters: obj({ clienteId: { type: "integer", minimum: 1 } }, ["clienteId"]),
  },
  {
    name: "oportunidades_abiertas",
    label: "Oportunidades abiertas",
    description: "Solicitudes y oportunidades del CRM abiertas (nuevas, contactadas o en proceso) con su prioridad y origen; recuento por estado. Sin fechas: todas las abiertas.",
    permission: "crm",
    capabilities: ["crm-leads"],
    parameters: obj({ desde: day, hasta: day, limite: limit(20) }),
    quick: { label: "Oportunidades abiertas", args: {} },
  },
  {
    name: "presupuestos_pendientes",
    label: "Presupuestos pendientes",
    description: "Presupuestos enviados o vistos por el cliente sin respuesta todavía: número, título, importe, fecha de envío y validez.",
    permission: "crm",
    capabilities: ["crm-quotes"],
    parameters: obj({ limite: limit(20) }),
    quick: { label: "Presupuestos sin respuesta", args: {} },
  },
  {
    name: "facturas_pendientes",
    label: "Facturas pendientes de cobro",
    description: "Facturas emitidas o enviadas sin cobrar (descontando sus abonos): número, cliente, importe pendiente y días desde la emisión.",
    permission: "finance",
    capabilities: ["bill-invoices"],
    parameters: obj({ limite: limit(30) }),
    quick: { label: "Facturas pendientes", args: {} },
  },
  {
    name: "ausencias_rrhh",
    label: "Ausencias del equipo",
    description: "Resumen de RRHH entre dos fechas: ausencias aprobadas por tipo (vacaciones, bajas, permisos), solicitudes pendientes de aprobar y fichajes abiertos ahora. Sin fechas: los próximos 7 días.",
    permission: "hr",
    capabilities: ["people-hr"],
    parameters: obj({ desde: day, hasta: day }),
    quick: { label: "Ausencias de la semana", args: {} },
  },
];

export const COPILOT_TOOL_BY_NAME: Record<CopilotToolName, CopilotToolMeta> = Object.fromEntries(COPILOT_TOOLS.map((t) => [t.name, t])) as Record<CopilotToolName, CopilotToolMeta>;
export const isToolName = (v: unknown): v is CopilotToolName => typeof v === "string" && (COPILOT_TOOL_NAMES as readonly string[]).includes(v);

/** Lo que puede ver el usuario en curso: permisos del panel y capacidades contratadas de la empresa. */
export interface CopilotAccess {
  permissions: ReadonlySet<CopilotPermission>;
  capabilities: ReadonlySet<string>;
}

/** Herramientas que puede usar quien tiene ese acceso. Pura: la usan el servidor, el panel y las pruebas. */
export function allowedTools(access: CopilotAccess): CopilotToolMeta[] {
  return COPILOT_TOOLS.filter((t) => access.permissions.has(t.permission) && t.capabilities.some((c) => access.capabilities.has(c)));
}

/** Capacidades que consulta Copilot para decidir sus herramientas y borradores. */
export const COPILOT_DATA_CAPABILITIES: readonly string[] = Array.from(new Set([...COPILOT_TOOLS.flatMap((t) => t.capabilities), "shop-catalog"]));

// ── Redacción asistida ───────────────────────────────────────────────────────────

export const COPILOT_DRAFT_KINDS = ["respuesta_cliente", "descripcion_producto", "resumen_cliente"] as const;
export type CopilotDraftKind = (typeof COPILOT_DRAFT_KINDS)[number];
export const COPILOT_DRAFT_LABELS: Record<CopilotDraftKind, string> = {
  respuesta_cliente: "Respuesta a un cliente",
  descripcion_producto: "Descripción de producto",
  resumen_cliente: "Resumen de un cliente",
};
export const COPILOT_TONES = ["cercano", "profesional", "formal"] as const;
export type CopilotTone = (typeof COPILOT_TONES)[number];

/** Qué exige cada borrador: el resumen y la ficha usan datos del CRM; la descripción, el catálogo. */
export function draftAllowed(kind: CopilotDraftKind, access: CopilotAccess): boolean {
  const has = (...caps: string[]) => caps.some((c) => access.capabilities.has(c));
  if (!access.permissions.has("crm")) return false;
  if (kind === "resumen_cliente") return has("crm-contacts", "crm-accounts");
  if (kind === "descripcion_producto") return has("shop-catalog");
  return true;
}

// ── Fechas (hora de Madrid) ──────────────────────────────────────────────────────

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isDay(v: unknown): v is string {
  if (typeof v !== "string" || !DAY_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const MADRID = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" });
const MADRID_FULL = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** Día AAAA-MM-DD de un instante en hora de Madrid. */
export function madridDay(ms: number): string {
  return MADRID.format(new Date(ms));
}

export function addDays(dayStr: string, n: number): string {
  const d = new Date(`${dayStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Instante (ms) en que empieza ese día en Madrid. */
export function madridDayStartMs(dayStr: string): number {
  const utcMidnight = Date.parse(`${dayStr}T00:00:00Z`);
  // Diferencia de Madrid con UTC a mediodía de ese día (1 h en invierno, 2 h en verano)
  const noon = utcMidnight + 12 * 3600_000;
  const p = Object.fromEntries(MADRID_FULL.formatToParts(new Date(noon)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return utcMidnight - (asUtc - noon);
}

export class CopilotInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CopilotInputError";
  }
}

/**
 * Intervalo [desde, hasta] (ambos incluidos) a partir de lo que pide la herramienta: si falta `desde`, `defaultDays`
 * días hacia atrás (o hacia delante con `forward`) desde hoy. Valida formato, orden y longitud máxima.
 */
export function resolveRange(args: { desde?: string; hasta?: string }, now: number, defaultDays: number, forward = false): { from: string; to: string } {
  const today = madridDay(now);
  for (const v of [args.desde, args.hasta]) if (v != null && !isDay(v)) throw new CopilotInputError(`Fecha no válida: ${String(v)} (formato AAAA-MM-DD).`);
  let from = args.desde;
  let to = args.hasta;
  if (!from && !to) {
    from = forward ? today : addDays(today, -(defaultDays - 1));
    to = forward ? addDays(today, defaultDays - 1) : today;
  } else if (!from) from = addDays(to!, -(defaultDays - 1));
  else if (!to) to = forward ? addDays(from, defaultDays - 1) : today < from ? from : today;
  if (to! < from!) throw new CopilotInputError("La fecha final es anterior a la inicial.");
  if (daysBetween(from!, to!) + 1 > COPILOT_LIMITS.rangeDaysMax) throw new CopilotInputError(`El periodo no puede superar ${COPILOT_LIMITS.rangeDaysMax} días.`);
  return { from: from!, to: to! };
}

/** Clave de agrupación de un día: el propio día, el lunes de su semana o el mes. */
export function bucketOf(dayStr: string, by: "dia" | "semana" | "mes"): string {
  if (by === "mes") return dayStr.slice(0, 7);
  if (by === "semana") {
    const wd = new Date(`${dayStr}T00:00:00Z`).getUTCDay(); // 0 = domingo
    return addDays(dayStr, -((wd + 6) % 7));
  }
  return dayStr;
}

/** ¿Se ofrece ese horario el día indicado? `daysOfWeek`: «1,2,3» (0 = domingo); vacío = todos los días. */
export function slotRunsOn(daysOfWeek: string | null, dayStr: string): boolean {
  if (!daysOfWeek || !daysOfWeek.trim()) return true;
  const wd = new Date(`${dayStr}T00:00:00Z`).getUTCDay();
  return daysOfWeek.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n)).some((n) => n === wd || (n === 7 && wd === 0));
}

// ── Textos para la IA ───────────────────────────────────────────────────────────

/** Resultado de una herramienta como texto para la IA, recortado al máximo (sin cortar a medias sin avisar). */
export function toolResultText(result: unknown, max: number = COPILOT_LIMITS.toolResultMax): string {
  const text = JSON.stringify(result);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… [resultado recortado: pide un periodo o un límite menor si necesitas el detalle]`;
}

export function buildChatSystemPrompt(p: { companyName: string; today: string; userName: string | null; tools: readonly CopilotToolMeta[] }): string {
  const lines = [
    `Eres Elephant Copilot, el asistente interno de ${p.companyName || "la empresa"} dentro de su panel de gestión. Hoy es ${p.today} (hora de Madrid).${p.userName ? ` Hablas con ${p.userName}, del equipo.` : ""}`,
    "Responde siempre en español, de forma breve, clara y profesional. Usa listas o tablas sencillas en texto cuando ayuden.",
    "Para cualquier dato de la empresa (ventas, reservas, clientes, facturas, ocupación, equipo…) usa SOLO las herramientas disponibles y cita las cifras tal y como las devuelven, con su periodo. Nunca inventes cifras, nombres ni fechas.",
    "Si ninguna herramienta disponible tiene ese dato, dilo con claridad: puede ser que no exista o que el usuario no tenga permiso para verlo. No sugieras consultas a la base de datos.",
    "No puedes modificar nada: solo consultas y redactas textos que el usuario copia. Los importes están en euros salvo que se indique otra moneda.",
  ];
  if (p.tools.length === 0) lines.push("Este usuario no tiene ninguna herramienta de datos disponible: solo puedes ayudarle a redactar y a resolver dudas generales del panel.");
  else lines.push(`Herramientas disponibles: ${p.tools.map((t) => t.name).join(", ")}.`);
  return lines.join("\n");
}

const TONE_TEXT: Record<CopilotTone, string> = { cercano: "cercano y amable", profesional: "profesional y claro", formal: "formal y cortés (de usted)" };

export interface DraftPromptInput {
  kind: CopilotDraftKind;
  companyName: string;
  tone: CopilotTone;
  /** Mensaje del cliente, notas sobre el producto o lo que haya escrito el usuario. */
  text?: string | null;
  notes?: string | null;
  /** Datos de la empresa ya consultados (ficha del cliente o del producto), en JSON. */
  context?: unknown;
}

export function buildDraftMessages(p: DraftPromptInput): Array<{ role: "system" | "user"; content: string }> {
  const base = `Eres Elephant Copilot y redactas textos para el equipo de ${p.companyName || "la empresa"}. Escribe en español con un tono ${TONE_TEXT[p.tone]}. Devuelve solo el texto final listo para copiar, sin comentarios ni comillas. No inventes datos (precios, fechas, condiciones) que no estén en la información facilitada; si falta algo importante, deja un hueco entre corchetes, por ejemplo [fecha].`;
  const ctx = p.context == null ? "" : `\n\nDatos de la empresa:\n${toolResultText(p.context)}`;
  const notes = p.notes?.trim() ? `\n\nIndicaciones del usuario: ${p.notes.trim()}` : "";
  if (p.kind === "respuesta_cliente") {
    return [
      { role: "system", content: `${base} Redacta una respuesta al mensaje de un cliente: saluda, responde a lo que pregunta y cierra con una despedida y el nombre de la empresa.` },
      { role: "user", content: `Mensaje del cliente:\n${(p.text ?? "").trim()}${notes}${ctx}` },
    ];
  }
  if (p.kind === "descripcion_producto") {
    return [
      { role: "system", content: `${base} Redacta la descripción comercial de un producto o servicio para la web: un párrafo de presentación (2-4 frases) y, si hay datos, una lista breve de lo que incluye. Máximo 180 palabras.` },
      { role: "user", content: `${(p.text ?? "").trim() || "Producto del catálogo"}${notes}${ctx}` },
    ];
  }
  return [
    { role: "system", content: `${base} Resume para uso interno la relación de la empresa con este cliente: quién es, qué ha contratado, gasto y última actividad, y una o dos sugerencias de seguimiento. Máximo 150 palabras.` },
    { role: "user", content: `Resume este cliente.${notes}${ctx}` },
  ];
}

/** Título de una conversación a partir de su primera pregunta. */
export function titleFrom(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= COPILOT_LIMITS.titleMax ? one || "Conversación" : `${one.slice(0, COPILOT_LIMITS.titleMax - 1).trimEnd()}…`;
}

export const formatEuros = (n: number) => `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
