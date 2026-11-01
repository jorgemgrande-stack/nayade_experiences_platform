/**
 * «Primeros pasos» v3: recorrido (buildSetupPlan) — orden de negocio fijo, pasos destacados por tipo de actividad, pasos según lo contratado,
 * pasos «de hacer» completados por datos reales, reanudación y compatibilidad con progresos anteriores. Y la mezcla
 * de la actividad reciente del Inicio.
 */
import { describe, it, expect } from "vitest";
import {
  activityInfo,
  activityProfile,
  availableActivities,
  buildSetupPlan,
  commsSchema,
  configurationStepNumber,
  configurationSteps,
  emptyProgress,
  fiscalSchema,
  identitySchema,
  markStep,
  parseProgress,
  type SetupFacts,
  type SetupProgress,
} from "../shared/setupWizard";
import { capabilitiesOfTier } from "./catalog/capabilities";
import { mergeRecent } from "./coreHomeDb";
import fs from "node:fs";
import path from "node:path";

const NOW = Date.UTC(2026, 9, 31, 9);
const NO_FACTS: SetupFacts = { identity: false, fiscal: false, brand: false, activity: false, clients: 0, products: 0, sales: 0, documents: 0, webEdited: false, comms: false };
const ESSENTIAL = new Set(capabilitiesOfTier("essential"));
const plan = (o: { progress?: SetupProgress; activity?: string | null; caps?: Set<string> | null; facts?: Partial<SetupFacts> } = {}) =>
  buildSetupPlan({ progress: o.progress ?? emptyProgress(), activity: o.activity ?? null, capabilities: o.caps === undefined ? ESSENTIAL : o.caps, facts: { ...NO_FACTS, ...o.facts } });
const ids = (p: ReturnType<typeof plan>) => p.steps.map((s) => s.id);

describe("un único número de pasos (bienvenida, asistente e Inicio)", () => {
  it("la bienvenida y el resumen no se cuentan ni se numeran", () => {
    const p = plan();
    expect(configurationSteps(p.steps).map((s) => s.id)).toEqual(["company", "fiscal", "activity", "brand", "web", "client", "product", "operation", "document", "comms"]);
    expect(configurationStepNumber(p.steps, "welcome")).toBeNull();
    expect(configurationStepNumber(p.steps, "finish")).toBeNull();
    expect(configurationStepNumber(p.steps, "company")).toBe(1);
    expect(configurationStepNumber(p.steps, "comms")).toBe(10);
  });
  it("las tres pantallas usan el mismo recuento", () => {
    const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../client/src", f), "utf8");
    expect(src("pages/admin/home/EssentialHome.tsx")).toContain("steps={configurationSteps(w.plan.steps).length}");
    const wizard = src("pages/admin/setup/PrimerosPasos.tsx");
    expect(wizard).toContain("configurationSteps(steps).length");
    expect(wizard).toContain("Paso ${stepNumber} de ${configCount}");
    expect(wizard).not.toContain("d.plan.total} pasos");
    expect(src("components/onboarding/SetupStatusCard.tsx")).toContain("configurationSteps(plan.steps)");
    expect(src("pages/admin/setup/PrimerosPasosSteps.tsx")).toContain("const rest = configurationSteps(steps)");
  });
});

describe("recorrido por defecto (empresa Essential nueva)", () => {
  it("bienvenida primero, todos los pasos del plan en orden de negocio, sin sectorial ni «users»", () => {
    const p = plan();
    expect(ids(p)).toEqual(["welcome", ...["company", "fiscal", "activity", "brand", "web", "client", "product", "operation", "document", "comms"], "finish"]);
    expect(p.hidden).toEqual(expect.arrayContaining(["sector"]));
    expect(p.nextStep).toBe("welcome");
    expect(p.percent).toBe(0);
    expect(p.steps.every((s) => !s.recommended)).toBe(true);
  });
  it("sin licencias por capacidad (instalación de una sola empresa): todo salvo lo sectorial", () => {
    const p = plan({ caps: null });
    expect(ids(p)).not.toContain("sector");
    expect(ids(p)).toContain("web");
  });
});

describe("adaptación por tipo de actividad (destaca pasos; el orden de negocio no cambia)", () => {
  const rec = (p: ReturnType<typeof plan>) => p.steps.filter((s) => s.recommended).map((s) => s.id);
  it("el orden es el mismo con cualquier tipo de actividad", () => {
    for (const activity of [null, "comercio", "servicios", "web"]) expect(ids(plan({ activity }))).toEqual(ids(plan()));
  });
  it("comercio: productos y primera venta destacados", () => {
    expect(rec(plan({ activity: "comercio" }))).toEqual(["product", "operation"]);
  });
  it("servicios profesionales: primer cliente y primer presupuesto o factura", () => {
    expect(rec(plan({ activity: "servicios" }))).toEqual(["client", "document"]);
  });
  it("empresa con web: la página web destacada", () => {
    const p = plan({ activity: "web" });
    expect(p.steps.find((s) => s.id === "web")?.recommended).toBe(true);
  });
  it("sectorial: el módulo sectorial (tras el correo, antes del resumen), solo si está contratado", () => {
    const caps = new Set([...ESSENTIAL, "hotel-net"]);
    const p = plan({ activity: "sectorial", caps });
    expect(ids(p).slice(-2)).toEqual(["sector", "finish"]);
    expect(p.steps.find((s) => s.id === "sector")?.recommended).toBe(true);
    // Sin módulo sectorial no hay paso sectorial aunque el valor guardado lo pida
    expect(ids(plan({ activity: "sectorial" }))).not.toContain("sector");
  });
  it("«sectorial» solo se puede elegir con un módulo sectorial contratado", () => {
    expect(availableActivities(ESSENTIAL).map((a) => a.id)).toEqual(["comercio", "servicios", "web"]);
    expect(availableActivities(new Set([...ESSENTIAL, "restaurant-net"])).map((a) => a.id)).toContain("sectorial");
    expect(availableActivities(null).map((a) => a.id)).not.toContain("sectorial");
  });
  it("valores de la versión anterior siguen funcionando (textos y orden)", () => {
    expect(activityProfile("hosteleria")).toBe("comercio");
    expect(activityProfile("formacion")).toBe("servicios");
    expect(activityProfile("desconocido")).toBeNull();
    expect(activityInfo("formacion").clientNoun).toBe("alumno");
    expect(rec(plan({ activity: "hosteleria" }))).toEqual(["product", "operation"]);
  });
});

describe("pasos según lo contratado", () => {
  it("sin CMS no hay paso de web; sin CRM no hay paso de clientes; sin ventas ni caja no hay venta; sin presupuestos ni facturas no hay documento", () => {
    const caps = new Set(Array.from(ESSENTIAL).filter((c) => !["cms-editor", "cms-pages-forms", "crm-contacts", "crm-quotes", "shop-orders", "bill-invoices", "bill-cash"].includes(c)));
    const p = plan({ caps });
    expect(ids(p)).not.toEqual(expect.arrayContaining(["web"]));
    expect(ids(p)).not.toContain("client");
    expect(ids(p)).not.toContain("operation");
    expect(ids(p)).not.toContain("document");
    expect(p.hidden).toEqual(expect.arrayContaining(["web", "client", "operation", "document", "sector"]));
  });
  it("basta una de las capacidades del paso (solo caja para «Primera venta»; solo facturas para «Primer presupuesto o factura»)", () => {
    expect(ids(plan({ caps: new Set(["bill-cash"]) }))).toContain("operation");
    expect(ids(plan({ caps: new Set(["bill-cash"]) }))).not.toContain("document");
    expect(ids(plan({ caps: new Set(["bill-invoices"]) }))).toEqual(expect.arrayContaining(["document"]));
    expect(ids(plan({ caps: new Set(["bill-invoices"]) }))).not.toContain("operation");
  });
});

describe("completado por datos reales, no por clic", () => {
  it("marcar «hecho» un paso de hacer sin el dato no lo completa; el dato sí, aunque no se marque", () => {
    let progress = markStep(emptyProgress(), "client", "done", NOW);
    expect(plan({ progress }).steps.find((s) => s.id === "client")?.status).toBe("pending");
    const withClient = plan({ facts: { clients: 1 } }).steps.find((s) => s.id === "client");
    expect(withClient).toMatchObject({ status: "done", byData: true });
    // Omitido sin dato: omitido (no bloquea); con dato: hecho
    progress = markStep(emptyProgress(), "product", "skipped", NOW);
    expect(plan({ progress }).steps.find((s) => s.id === "product")?.status).toBe("skipped");
    expect(plan({ progress, facts: { products: 2 } }).steps.find((s) => s.id === "product")?.status).toBe("done");
  });
  it("lo que ya consta no se vuelve a pedir: identidad, datos fiscales, logotipo y comunicaciones existentes cuentan como hechos", () => {
    const p = plan({ facts: { identity: true, fiscal: true, brand: true, comms: true } });
    for (const id of ["company", "fiscal", "brand", "comms"] as const) expect(p.steps.find((s) => s.id === id)).toMatchObject({ status: "done", byData: true });
    // La bienvenida sigue pendiente hasta que la empresa empieza o elige explorar
    expect(p.nextStep).toBe("welcome");
  });
  it("logotipo y correo tampoco se completan con un clic: hace falta el dato (logotipo subido, remitente o respuesta)", () => {
    const progress = markStep(markStep(emptyProgress(), "brand", "done", NOW), "comms", "done", NOW);
    const p = plan({ progress });
    expect(p.steps.find((s) => s.id === "brand")?.status).toBe("pending");
    expect(p.steps.find((s) => s.id === "comms")?.status).toBe("pending");
  });
  it("primera venta y primer presupuesto o factura son pasos distintos, cada uno con su dato", () => {
    const sale = plan({ facts: { sales: 1 } });
    expect(sale.steps.find((s) => s.id === "operation")).toMatchObject({ status: "done", byData: true });
    expect(sale.steps.find((s) => s.id === "document")?.status).toBe("pending");
    const doc = plan({ facts: { documents: 1 } });
    expect(doc.steps.find((s) => s.id === "document")).toMatchObject({ status: "done", byData: true });
    expect(doc.steps.find((s) => s.id === "operation")?.status).toBe("pending");
  });
});

describe("reanudación y puesta en marcha", () => {
  it("«explorar primero» resuelve la bienvenida; se reanuda en el primer paso pendiente real", () => {
    const progress = markStep(emptyProgress(), "welcome", "skipped", NOW);
    expect(plan({ progress }).nextStep).toBe("company");
    expect(plan({ progress, facts: { identity: true, fiscal: true } }).nextStep).toBe("activity");
    // El progreso guardado sobrevive a la lectura (otra sesión, otro navegador)
    const again = parseProgress(JSON.stringify(progress));
    expect(again.steps.welcome.status).toBe("skipped");
    expect(plan({ progress: again }).nextStep).toBe("company");
  });
  it("con todo resuelto queda la puesta en marcha; al terminar, 100 % y sin siguiente paso", () => {
    let progress = emptyProgress();
    for (const s of ["welcome", ...["company", "fiscal", "activity", "brand", "web", "client", "product", "operation", "document", "comms"]] as const) progress = markStep(progress, s, "skipped", NOW);
    expect(plan({ progress }).nextStep).toBe("finish");
    progress = markStep(progress, "finish", "done", NOW + 1);
    const p = plan({ progress });
    // Puesta en marcha registrada, pero el avance solo cuenta lo hecho de verdad (lo omitido no suma)
    expect(p).toMatchObject({ nextStep: null, percent: 0, completedAt: NOW + 1 });
    const all = plan({ progress, facts: { identity: true, fiscal: true, activity: true, brand: true, webEdited: true, clients: 1, products: 1, sales: 1, documents: 1, comms: true } });
    expect(all.percent).toBe(100);
  });
  it("progreso de la versión anterior: no vuelve a ver la bienvenida y conserva lo hecho", () => {
    const old = JSON.stringify({ version: 1, steps: { company: { status: "done", at: 1 }, activity: { status: "done", at: 2 }, users: { status: "skipped", at: 3 } }, completedAt: null, updatedAt: 3 });
    const progress = parseProgress(old);
    expect(progress.steps.welcome.status).toBe("done");
    expect(progress.steps.fiscal.status).toBe("done");
    expect(progress.steps.users.status).toBe("skipped");
    expect(plan({ progress, activity: "servicios", facts: { identity: true, fiscal: true, activity: true } }).nextStep).toBe("brand");
  });
  it("progreso anterior con «Ventas, facturación y TPV» omitido: quedan omitidos la primera venta y el primer documento", () => {
    const old = JSON.stringify({ version: 1, steps: { operation: { status: "skipped", at: 5 } }, completedAt: null, updatedAt: 5 });
    const progress = parseProgress(old);
    expect(progress.steps.operation.status).toBe("skipped");
    expect(progress.steps.document).toEqual({ status: "skipped", at: 5 });
  });
});

describe("validación de los nuevos pasos (mensajes en español)", () => {
  it("identidad, fiscales y comunicaciones", () => {
    expect(identitySchema.safeParse({ tradeName: "", country: "XX", currency: "EUR", timezone: "Europe/Madrid" }).error!.issues.map((i) => i.message)).toEqual(
      expect.arrayContaining(["Indica el nombre comercial (mínimo 2 caracteres)", "Elige un país de la lista"]),
    );
    expect(fiscalSchema.parse({ legalName: "Ferretería Sol, S.L.", taxId: "b12345678", address: "Calle Mayor 1" }).taxId).toBe("B12345678");
    expect(commsSchema.parse({})).toEqual({ fromName: "", replyTo: "", whatsapp: "" });
    expect(commsSchema.safeParse({ replyTo: "no-es-correo" }).error!.issues[0].message).toBe("Indica un email válido");
    expect(commsSchema.safeParse({ whatsapp: "llámame" }).success).toBe(false);
    expect(commsSchema.parse({ whatsapp: "+34 600 000 000" }).whatsapp).toBe("+34 600 000 000");
  });
});

describe("actividad reciente del Inicio", () => {
  it("lo más reciente primero, recortado y sin fechas vacías", () => {
    const it = (kind: "client" | "quote", at: number) => ({ kind, title: kind, detail: null, at, href: "/" });
    const out = mergeRecent([[it("client", 10), it("client", 30)], [it("quote", 20), it("quote", 0)]], 2);
    expect(out.map((x) => x.at)).toEqual([30, 20]);
  });
});
