/**
 * «Integraciones y pagos» en el panel de la empresa: grupos por lo que quiere hacer el usuario, estados y validación
 * previa de formato. Lo comparten el servidor (que prepara la lista) y la página (que avisa antes de guardar).
 * Solo presentación: el servidor vuelve a validar al guardar.
 */

/** Para qué lo quiere el usuario: así se agrupan las integraciones en el panel. */
export type IntegrationGroup = "payments" | "email" | "mailboxes" | "customer" | "marketing";

export const INTEGRATION_GROUPS: Array<{ id: IntegrationGroup; title: string; description: string }> = [
  { id: "payments", title: "Cobrar con tarjeta", description: "Para que tus clientes paguen en línea con tu propio contrato de cobro." },
  { id: "email", title: "Enviar correos", description: "Desde qué dirección reciben tus clientes los correos de la empresa." },
  { id: "mailboxes", title: "Leer correos automáticamente", description: "Buzones de los que se recogen documentos para no teclearlos a mano." },
  { id: "customer", title: "Atención al cliente", description: "Herramientas externas de mensajería y llamadas." },
  { id: "marketing", title: "Publicidad y medición", description: "Medición de tus campañas en redes sociales." },
];

export type IntegrationState = "off" | "incomplete" | "unchecked" | "working" | "failing";

export const STATE_LABEL: Record<IntegrationState, string> = {
  off: "Sin configurar (desactivada)",
  incomplete: "Faltan datos",
  unchecked: "Completa, sin comprobar",
  working: "Funcionando",
  failing: "No funciona",
};

export interface PanelField {
  key: string;
  label: string;
  help: string | null;
  secret: boolean;
  required: boolean;
  control: "text" | "secret" | "choice" | "yesno";
  options: Array<{ value: string; label: string }>;
  /** Expresión del formato admitido (la misma que valida el servidor), para avisar antes de guardar. */
  pattern: string | null;
  formatMessage: string | null;
  example: string | null;
  set: boolean;
  /** Valor visible (no secretos) o máscara (secretos). */
  display: string | null;
}

export interface PanelIntegration {
  id: string;
  group: IntegrationGroup;
  title: string;
  summary: string;
  configured: boolean;
  state: IntegrationState;
  stateLabel: string;
  /** Explicación breve del estado (qué falta o qué dijo la última comprobación). */
  stateDetail: string | null;
  canTest: boolean;
  fields: PanelField[];
}

/** Aviso de formato en español para un valor escrito; null si es válido o está vacío (vacío = conservar o borrar). */
export function fieldFormatProblem(f: Pick<PanelField, "control" | "options" | "pattern" | "formatMessage">, value: string): string | null {
  if (value === "") return null;
  if (f.control === "choice" || f.control === "yesno") return f.options.some((o) => o.value === value) ? null : "Elige una de las opciones.";
  if (value.length > 1024) return "Es demasiado largo.";
  if (!f.pattern) return null;
  try {
    return new RegExp(f.pattern).test(value) ? null : f.formatMessage ?? "El formato no es válido.";
  } catch {
    return null;
  }
}

/** Integraciones agrupadas en el orden de los grupos; los grupos vacíos no se muestran. */
export function groupIntegrations(list: PanelIntegration[]): Array<(typeof INTEGRATION_GROUPS)[number] & { items: PanelIntegration[] }> {
  return INTEGRATION_GROUPS.map((g) => ({ ...g, items: list.filter((p) => p.group === g.id) })).filter((g) => g.items.length > 0);
}
