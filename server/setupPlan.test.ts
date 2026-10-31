/**
 * «Primeros pasos» v2: recorrido adaptado (buildSetupPlan) — orden por tipo de actividad, pasos según lo contratado,
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

const NOW = Date.UTC(2026, 9, 31, 9);
const NO_FACTS: SetupFacts = { identity: false, fiscal: false, brand: false, activity: false, clients: 0, products: 0, sales: 0, webEdited: false, comms: false };
const ESSENTIAL = new Set(capabilitiesOfTier("essential"));
const plan = (o: { progress?: SetupProgress; activity?: string | null; caps?: Set<string> | null; facts?: Partial<SetupFacts> } = {}) =>
  buildSetupPlan({ progress: o.progress ?? emptyProgress(), activity: o.activity ?? null, capabilities: o.caps === undefined ? ESSENTIAL : o.caps, facts: { ...NO_FACTS, ...o.facts } });
const ids = (p: ReturnType<typeof plan>) => p.steps.map((s) => s.id);

describe("recorrido por defecto (empresa Essential nueva)", () => {
  it("bienvenida primero, todos los pasos del plan en el orden de referencia, sin sectorial ni «users»", () => {
    const p = plan();
    expect(ids(p)).toEqual(["welcome", "company", "fiscal", "brand", "activity", "client", "product", "web", "operation", "comms", "finish"]);
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

describe("adaptación por tipo de actividad", () => {
  it("comercio: productos y ventas primero (prioritarios)", () => {
    const p = plan({ activity: "comercio" });
    expect(ids(p).slice(5, 10)).toEqual(["product", "operation", "client", "web", "comms"]);
    expect(p.steps.filter((s) => s.recommended).map((s) => s.id)).toEqual(["product", "operation"]);
  });
  it("servicios profesionales: CRM y servicios primero", () => {
    expect(ids(plan({ activity: "servicios" })).slice(5, 7)).toEqual(["client", "product"]);
  });
  it("empresa con web: la página web primero", () => {
    const p = plan({ activity: "web" });
    expect(ids(p)[5]).toBe("web");
    expect(p.steps.find((s) => s.id === "web")?.recommended).toBe(true);
  });
  it("sectorial: el módulo sectorial justo tras la actividad, solo si está contratado", () => {
    const caps = new Set([...ESSENTIAL, "hotel-net"]);
    expect(ids(plan({ activity: "sectorial", caps }))[5]).toBe("sector");
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
    expect(ids(plan({ activity: "hosteleria" }))[5]).toBe("product");
  });
});

describe("pasos según lo contratado", () => {
  it("sin CMS no hay paso de web; sin CRM no hay paso de clientes; sin ventas ni caja no hay paso de ventas", () => {
    const caps = new Set(Array.from(ESSENTIAL).filter((c) => !["cms-editor", "cms-pages-forms", "crm-contacts", "crm-quotes", "shop-orders", "bill-invoices", "bill-cash"].includes(c)));
    const p = plan({ caps });
    expect(ids(p)).not.toEqual(expect.arrayContaining(["web"]));
    expect(ids(p)).not.toContain("client");
    expect(ids(p)).not.toContain("operation");
    expect(p.hidden).toEqual(expect.arrayContaining(["web", "client", "operation", "sector"]));
  });
  it("basta una de las capacidades del paso (p. ej. solo caja para «Ventas, facturación y TPV»)", () => {
    expect(ids(plan({ caps: new Set(["bill-cash"]) }))).toContain("operation");
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
  it("logotipo y comunicaciones también se completan al guardarlos (sin dato obligatorio)", () => {
    const progress = markStep(markStep(emptyProgress(), "brand", "done", NOW), "comms", "done", NOW);
    const p = plan({ progress });
    expect(p.steps.find((s) => s.id === "brand")?.status).toBe("done");
    expect(p.steps.find((s) => s.id === "comms")?.status).toBe("done");
  });
});

describe("reanudación y puesta en marcha", () => {
  it("«explorar primero» resuelve la bienvenida; se reanuda en el primer paso pendiente real", () => {
    const progress = markStep(emptyProgress(), "welcome", "skipped", NOW);
    expect(plan({ progress }).nextStep).toBe("company");
    expect(plan({ progress, facts: { identity: true, fiscal: true } }).nextStep).toBe("brand");
    // El progreso guardado sobrevive a la lectura (otra sesión, otro navegador)
    const again = parseProgress(JSON.stringify(progress));
    expect(again.steps.welcome.status).toBe("skipped");
    expect(plan({ progress: again }).nextStep).toBe("company");
  });
  it("con todo resuelto queda la puesta en marcha; al terminar, 100 % y sin siguiente paso", () => {
    let progress = emptyProgress();
    for (const s of ["welcome", "company", "fiscal", "brand", "activity", "client", "product", "web", "operation", "comms"] as const) progress = markStep(progress, s, "skipped", NOW);
    expect(plan({ progress }).nextStep).toBe("finish");
    progress = markStep(progress, "finish", "done", NOW + 1);
    const p = plan({ progress });
    expect(p).toMatchObject({ nextStep: null, percent: 100, completedAt: NOW + 1 });
  });
  it("progreso de la versión anterior: no vuelve a ver la bienvenida y conserva lo hecho", () => {
    const old = JSON.stringify({ version: 1, steps: { company: { status: "done", at: 1 }, activity: { status: "done", at: 2 }, users: { status: "skipped", at: 3 } }, completedAt: null, updatedAt: 3 });
    const progress = parseProgress(old);
    expect(progress.steps.welcome.status).toBe("done");
    expect(progress.steps.fiscal.status).toBe("done");
    expect(progress.steps.users.status).toBe("skipped");
    expect(plan({ progress, activity: "servicios", facts: { identity: true, fiscal: true, activity: true } }).nextStep).toBe("brand");
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
