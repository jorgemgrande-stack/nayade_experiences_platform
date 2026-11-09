/**
 * Primera sesión de una empresa en prueba (encargo del 09/11/2026, fase 5): guía breve de tres pasos —datos de la
 * empresa, primer cliente y primer presupuesto— con su estado REAL (los datos del asistente, `setupWizard.status.facts`),
 * y los hitos de activación que el Core comunica al plano de control (primer acceso y primera acción útil).
 * Lógica pura, sin React ni base de datos. No pide datos fiscales para empezar.
 */

/** Lo que la guía necesita de `setupWizard.status.facts` (server/routers/setupWizard.ts). */
export interface FirstStepFacts {
  /** Nombre comercial, país, moneda y zona horaria guardados. */
  identity: boolean;
  clients: number;
  /** Presupuestos (desde el 09/11/2026; si falta, se usan los documentos: presupuestos + facturas). */
  quotes?: number;
  documents: number;
  products: number;
  sales: number;
}

export type FirstStepId = "company" | "client" | "quote";

export interface FirstStep {
  id: FirstStepId;
  title: string;
  text: string;
  href: string;
  cta: string;
  done: boolean;
}

export const FIRST_STEP_HREF: Record<FirstStepId, string> = {
  company: "/admin/primeros-pasos",
  client: "/admin/crm/clientes?nuevo=1",
  quote: "/admin/crm?tab=quotes&nuevo=1",
};

/**
 * Pasos de la guía que puede dar esta persona (`can`: capacidad contratada y permiso de escritura), en orden y con su
 * estado. El de la empresa solo pide nombre comercial, país, moneda y zona horaria: nunca datos fiscales.
 */
export function trialFirstSteps(facts: FirstStepFacts, can: { clients: boolean; quotes: boolean }): FirstStep[] {
  const quotes = facts.quotes ?? facts.documents;
  const steps: FirstStep[] = [
    { id: "company", title: "Completa los datos de tu empresa", text: "Nombre comercial, país y moneda. Los datos fiscales pueden esperar a tu primera factura.", href: FIRST_STEP_HREF.company, cta: "Completar", done: facts.identity },
  ];
  if (can.clients) steps.push({ id: "client", title: "Crea tu primer cliente", text: "Con su nombre y un contacto basta para empezar.", href: FIRST_STEP_HREF.client, cta: "Crear cliente", done: facts.clients > 0 });
  if (can.quotes) steps.push({ id: "quote", title: "Genera tu primer presupuesto", text: "Prepáralo en un par de minutos y envíalo por correo desde el panel.", href: FIRST_STEP_HREF.quote, cta: "Crear presupuesto", done: quotes > 0 });
  return steps;
}

/** Clave del almacenamiento del navegador para ocultar la guía (se puede volver a mostrar). */
export const FIRST_STEPS_HIDDEN_KEY = "be-trial-first-steps-hidden";

// ── Hitos de activación ───────────────────────────────────────────────────────
export const TRIAL_MILESTONES = ["first_access", "first_action"] as const;
export type TrialMilestone = (typeof TRIAL_MILESTONES)[number];

/**
 * Primera acción útil a partir de los datos reales de la empresa: la primera que exista de cliente, presupuesto o
 * factura, venta o producto. `null` si aún no hay ninguna. Solo una clave corta, sin datos personales.
 */
export function firstActionOf(facts: FirstStepFacts): "client" | "document" | "sale" | "product" | null {
  if (facts.clients > 0) return "client";
  if ((facts.quotes ?? 0) > 0 || facts.documents > 0) return "document";
  if (facts.sales > 0) return "sale";
  if (facts.products > 0) return "product";
  return null;
}
