/**
 * Presentación de las integraciones en el panel de la empresa («Integraciones y pagos»): qué ve una persona no
 * técnica, agrupado por lo que quiere hacer, y con avisos de formato en español.
 *
 * Solo presentación y validación previa: cómo se guardan y cifran las credenciales sigue en la bóveda (`vault.ts`),
 * que vuelve a validar con `validateFields`. Credenciales propias de cada empresa: lo que no está configurado queda
 * desactivado y nunca se usa una cuenta ajena.
 */
import { PROVIDERS, type ProviderDef } from "./catalog";
import type { ProviderStatus } from "./vault";
import type { Connection } from "./health";
import { INTEGRATION_GROUPS, STATE_LABEL, type IntegrationState, type PanelField, type PanelIntegration } from "../../../shared/integrationsPanel";

export { INTEGRATION_GROUPS, STATE_LABEL };
export type { IntegrationState, PanelField, PanelIntegration };

export interface VisibilityInput {
  /** true si la empresa usa licencias por capacidad (pyme). */
  licensed: boolean;
  can: (capabilityId: string) => boolean;
}

/**
 * Se muestra si ya está configurada (nunca se esconde algo que la empresa tiene guardado) o si le sirve: las heredadas
 * o sectoriales solo si están configuradas; las demás si la empresa tiene alguna capacidad que las use. Sin licencias
 * por capacidad, todas las no heredadas.
 */
export function integrationVisible(p: ProviderDef, configured: boolean, v: VisibilityInput): boolean {
  if (configured) return true;
  if (p.panel.legacy) return false;
  if (!v.licensed || !p.panel.requires?.length) return true;
  return p.panel.requires.some((c) => v.can(c));
}

interface HealthLike {
  provider: string;
  connection: Connection;
  stateAt: string | null;
  lastCheck: { message: string } | null;
  lastSync: { message: string } | null;
}

/** Estado: completa (todos los obligatorios) y funcionando (la última comprobación, posterior al último cambio, fue bien). */
export function integrationState(
  fields: Array<{ label: string; required: boolean; set: boolean; updatedAt: string | null }>,
  health: HealthLike | undefined,
): { state: IntegrationState; detail: string | null } {
  if (!fields.some((f) => f.set)) return { state: "off", detail: "Mientras no la configures, no se usa." };
  const missing = fields.filter((f) => f.required && !f.set).map((f) => f.label);
  if (missing.length) return { state: "incomplete", detail: `Falta: ${missing.join(", ")}.` };
  const lastChange = Math.max(...fields.map((f) => (f.updatedAt ? Date.parse(f.updatedAt) : 0)));
  const checkedAt = health?.stateAt ? Date.parse(health.stateAt) : -1;
  if (!health || health.connection === "not_checked" || checkedAt < lastChange) {
    return { state: "unchecked", detail: "Pulsa «Probar conexión» para comprobar que funciona." };
  }
  const message = health.lastCheck?.message || health.lastSync?.message || null;
  if (health.connection === "connected") return { state: "working", detail: message };
  return { state: "failing", detail: message };
}

function panelFields(p: ProviderDef, status: ProviderStatus): PanelField[] {
  return p.fields.map((f) => {
    const s = status.fields.find((x) => x.key === f.key);
    const ui = f.panel;
    const control: PanelField["control"] = ui?.control === "yesno" ? "yesno" : f.options ? "choice" : f.secret ? "secret" : "text";
    return {
      key: f.key,
      label: ui?.label ?? f.label,
      help: ui?.help ?? null,
      secret: f.secret,
      required: !!f.required,
      control,
      options:
        control === "yesno"
          ? [{ value: "true", label: "Sí" }, { value: "false", label: "No" }]
          : (f.options ?? []).map((o) => ({ value: o, label: ui?.optionLabels?.[o] ?? o })),
      pattern: f.pattern ? f.pattern.source : null,
      formatMessage: ui?.formatMessage ?? null,
      example: f.hint ?? null,
      set: !!s?.set,
      display: s?.display ?? null,
    };
  });
}

/** Lista para el panel: solo las que le sirven a la empresa, en el orden de los grupos. */
export function panelIntegrations(statuses: ProviderStatus[], v: VisibilityInput, health: HealthLike[] = []): PanelIntegration[] {
  const out: PanelIntegration[] = [];
  for (const g of INTEGRATION_GROUPS) {
    for (const p of PROVIDERS.filter((x) => x.panel.group === g.id)) {
      const status = statuses.find((s) => s.id === p.id);
      if (!status) continue;
      if (!integrationVisible(p, status.configured, v)) continue;
      const fields = panelFields(p, status);
      const st = integrationState(
        status.fields.map((f) => ({ label: fields.find((x) => x.key === f.key)?.label ?? f.label, required: f.required, set: f.set, updatedAt: f.updatedAt })),
        health.find((h) => h.provider === p.id),
      );
      out.push({
        id: p.id,
        group: p.panel.group,
        title: p.panel.title,
        summary: p.panel.summary,
        configured: status.configured,
        state: st.state,
        stateLabel: STATE_LABEL[st.state],
        stateDetail: st.detail,
        canTest: p.check !== null,
        fields,
      });
    }
  }
  return out;
}

/** Problemas de formato en español, con el nombre que ve el usuario. Vacío = se puede guardar. */
export function fieldProblems(p: ProviderDef, values: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    const f = p.fields.find((x) => x.key === k);
    if (!f) {
      problems.push("Hay un dato que no corresponde a esta integración. Recarga la página e inténtalo de nuevo.");
      continue;
    }
    if (v === "") continue;
    const label = f.panel?.label ?? f.label;
    if (f.options && !f.options.includes(v)) problems.push(`${label}: elige una de las opciones.`);
    else if ((f.pattern && !f.pattern.test(v)) || v.length > 1024) problems.push(`${label}: ${f.panel?.formatMessage ?? "el formato no es válido."}`);
  }
  return problems;
}
