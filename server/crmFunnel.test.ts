/**
 * Embudo de ventas configurable (Business, crm-funnel-advanced): equivalencia con los cuatro estados de siempre,
 * previsión ponderada, validación de etapas, licencia por plan (servidor y panel) y migración aditiva.
 * La operación real (MySQL, roles, aislamiento entre empresas) está en server/crmFunnel.mysql.test.ts.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_STAGES, LEAD_STATUS_FOR, canRemoveStageKind, effectiveStage, funnelForecast, statusForStage, validateStageForm, type FunnelStage,
} from "../shared/crmFunnel";
import { capabilityForProcedure } from "./_core/capabilities/routeGuard";
import { TASK_NAV, resolveNav, routeAccess, type NavContext } from "../shared/adminNav";
import { capabilitiesOfTier } from "./catalog/capabilities";
import { destructiveMigration, extraordinaryChanges } from "../scripts/deploy/esRailwayLib";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const defaults: FunnelStage[] = DEFAULT_STAGES.map((s, i) => ({ ...s, id: i + 1 }));
const [nueva, enviada, ganada, perdida] = defaults;
const custom: FunnelStage[] = [
  ...defaults,
  { id: 10, name: "Negociación", position: 4, probability: 70, kind: "abierta", color: "ambar", legacyStatus: null },
  { id: 11, name: "Descartada", position: 5, probability: 0, kind: "perdida", color: "gris", legacyStatus: null },
];

describe("embudo: equivalencia con los cuatro estados de siempre", () => {
  it("las etapas por defecto son los cuatro estados, en orden, con su tipo", () => {
    expect(DEFAULT_STAGES.map((s) => s.legacyStatus)).toEqual(["nueva", "enviada", "ganada", "perdida"]);
    expect(DEFAULT_STAGES.map((s) => s.kind)).toEqual(["abierta", "abierta", "ganada", "perdida"]);
    expect(DEFAULT_STAGES.find((s) => s.kind === "ganada")?.probability).toBe(100);
    expect(DEFAULT_STAGES.find((s) => s.kind === "perdida")?.probability).toBe(0);
  });

  it("sin etapa elegida, cada oportunidad cae en la etapa de su estado (lo existente funciona sin migrar datos)", () => {
    expect(effectiveStage("nueva", null, defaults)?.id).toBe(nueva.id);
    expect(effectiveStage("enviada", undefined, defaults)?.id).toBe(enviada.id);
    expect(effectiveStage("ganada", null, defaults)?.id).toBe(ganada.id);
    expect(effectiveStage("perdida", null, defaults)?.id).toBe(perdida.id);
  });

  it("la etapa elegida manda si es coherente con el estado; si otro flujo cerró la oportunidad, se deriva del estado", () => {
    expect(effectiveStage("enviada", 10, custom)?.id).toBe(10);
    expect(effectiveStage("perdida", 11, custom)?.id).toBe(11);
    // Aceptación de un presupuesto (flujo de siempre): estaba en Negociación y ahora está ganada
    expect(effectiveStage("ganada", 10, custom)?.id).toBe(ganada.id);
    // Etapa borrada: vuelve a la de su estado
    expect(effectiveStage("enviada", 99, custom)?.id).toBe(enviada.id);
  });

  it("si se borró la etapa equivalente, cae en la primera etapa de su tipo", () => {
    const sinNueva = custom.filter((s) => s.id !== nueva.id);
    expect(effectiveStage("nueva", null, sinNueva)?.id).toBe(enviada.id);
    const sinPerdida = custom.filter((s) => s.id !== perdida.id);
    expect(effectiveStage("perdida", null, sinPerdida)?.id).toBe(11);
  });

  it("pasar de etapa deja un estado de siempre coherente (Essential, informes y flujos ven lo mismo)", () => {
    expect(statusForStage(ganada, "nueva")).toBe("ganada");
    expect(statusForStage(perdida, "enviada")).toBe("perdida");
    expect(statusForStage(custom[5], "nueva")).toBe("perdida");
    expect(statusForStage(nueva, "enviada")).toBe("nueva");
    expect(statusForStage(enviada, "nueva")).toBe("enviada");
    // Etapa abierta propia: conserva el estado abierto; si venía cerrada, queda en negociación («enviada»)
    expect(statusForStage(custom[4], "nueva")).toBe("nueva");
    expect(statusForStage(custom[4], "ganada")).toBe("enviada");
    expect(statusForStage(custom[4], "perdida")).toBe("enviada");
    expect(LEAD_STATUS_FOR).toEqual({ nueva: "nuevo", enviada: "contactado", ganada: "convertido", perdida: "perdido" });
  });
});

describe("embudo: previsión ponderada", () => {
  it("suma importe × probabilidad por etapa; el total pondera solo lo abierto; lo ganado aparte; lo perdido no suma", () => {
    const f = funnelForecast(
      [
        { stageId: nueva.id, amount: 1000 },
        { stageId: nueva.id, amount: 500 },
        { stageId: enviada.id, amount: 2000 },
        { stageId: 10, amount: 999.99 },
        { stageId: ganada.id, amount: 3000 },
        { stageId: perdida.id, amount: 800 },
        { stageId: 404, amount: 1_000_000 },
      ],
      custom,
    );
    const by = (id: number) => f.stages.find((s) => s.stageId === id)!;
    expect(by(nueva.id)).toEqual({ stageId: nueva.id, count: 2, amount: 1500, weighted: 150 });
    expect(by(enviada.id)).toEqual({ stageId: enviada.id, count: 1, amount: 2000, weighted: 1000 });
    expect(by(10).weighted).toBe(699.99);
    expect(by(perdida.id)).toEqual({ stageId: perdida.id, count: 1, amount: 800, weighted: 0 });
    expect(f.openAmount).toBe(4499.99);
    expect(f.weightedTotal).toBe(1849.99);
    expect(f.wonAmount).toBe(3000);
    // Una etapa desconocida no cuenta; el orden sigue el de las etapas
    expect(f.stages.map((s) => s.stageId)).toEqual([1, 2, 3, 4, 10, 11]);
  });

  it("sin oportunidades, todo a cero", () => {
    expect(funnelForecast([], defaults)).toMatchObject({ openAmount: 0, weightedTotal: 0, wonAmount: 0 });
  });
});

describe("embudo: etapas", () => {
  it("valida nombre, repetido, probabilidad y coherencia con el tipo", () => {
    const ok = { name: "Negociación", probability: 60, kind: "abierta" as const, color: "ambar" as const };
    expect(validateStageForm(ok, defaults)).toEqual({});
    expect(validateStageForm({ ...ok, name: "  " }).name).toBeDefined();
    expect(validateStageForm({ ...ok, name: "x".repeat(81) }).name).toMatch(/80/);
    expect(validateStageForm({ ...ok, name: "  ganada " }, defaults).name).toBe("Ya existe una etapa con ese nombre.");
    expect(validateStageForm({ ...ok, name: "Ganada", kind: "ganada", probability: 100 }, defaults, ganada.id)).toEqual({});
    expect(validateStageForm({ ...ok, probability: 101 }).probability).toBeDefined();
    expect(validateStageForm({ ...ok, probability: 2.5 }).probability).toBeDefined();
    expect(validateStageForm({ ...ok, kind: "ganada", probability: 90 }).probability).toBeDefined();
    expect(validateStageForm({ ...ok, kind: "perdida", probability: 10 }).probability).toBeDefined();
    expect(validateStageForm({ ...ok, color: "#ff0000" as never }).color).toBeDefined();
  });

  it("siempre queda al menos una etapa de cada tipo", () => {
    expect(canRemoveStageKind(ganada, defaults)).toBe(false);
    expect(canRemoveStageKind(perdida, defaults)).toBe(false);
    expect(canRemoveStageKind(nueva, defaults)).toBe(true);
    expect(canRemoveStageKind(perdida, custom)).toBe(true);
  });
});

describe("embudo: licencia por plan", () => {
  it("el embudo configurable es Business; Essential conserva oportunidades y resumen de siempre", () => {
    expect(capabilitiesOfTier("business")).toContain("crm-funnel-advanced");
    expect(capabilitiesOfTier("essential")).not.toContain("crm-funnel-advanced");
    for (const p of ["crmFunnel.board", "crmFunnel.stages", "crmFunnel.moveLead", "crmFunnel.createStage", "crmFunnel.updateStage", "crmFunnel.reorderStages", "crmFunnel.removeStage"])
      expect(capabilityForProcedure(p)).toBe("crm-funnel-advanced");
    expect(capabilityForProcedure("crm.pipeline.summary")).toBe("crm-leads");
    expect(capabilityForProcedure("crm.leads.list")).toBe("crm-leads");
  });

  it("configurar etapas es de administración; el tablero y mover, del equipo comercial", () => {
    const src = read("server/routers/crmFunnel.ts");
    for (const p of ["createStage", "updateStage", "reorderStages", "removeStage"]) expect(src).toMatch(new RegExp(`${p}: adminProcedure`));
    for (const p of ["board", "stages", "moveLead"]) expect(src).toMatch(new RegExp(`${p}: staffProcedure`));
    expect(read("server/routers.ts")).toMatch(/crmFunnel: crmFunnelRouter/);
  });

  const ctx = (role: string, caps: Record<string, "active" | "read_only" | null>): NavContext => ({
    role,
    isFlagVisible: () => true,
    isModuleVisible: () => true,
    capabilityState: (c) => caps[c] ?? null,
  });
  const essential = Object.fromEntries(capabilitiesOfTier("essential").map((c) => [c, "active" as const]));
  const business = { ...essential, ...Object.fromEntries(capabilitiesOfTier("business").map((c) => [c, "active" as const])) };
  const find = (c: NavContext, href: string) => resolveNav(TASK_NAV, c).flatMap((s) => s.items).find((i) => i.href === href);

  it("menú: Essential no ve el embudo y conserva Oportunidades; Business lo ve en «Clientes y ventas»", () => {
    expect(find(ctx("admin", essential), "/admin/crm/embudo")).toBeUndefined();
    expect(find(ctx("admin", essential), "/admin/crm?tab=leads")).toBeDefined();
    expect(find(ctx("agente", business), "/admin/crm/embudo")).toMatchObject({ label: "Embudo de ventas", readOnly: false });
    expect(find(ctx("admin", business), "/admin/crm?tab=leads")).toBeDefined();
    expect(find(ctx("controler", business), "/admin/crm/embudo")).toBeUndefined();
  });

  it("ruta del panel: sin la capacidad, «No incluido en tu plan»; Oportunidades sigue igual en Essential", () => {
    const state = (caps: Record<string, string>) => (c: string) => (caps[c] as "active" | undefined) ?? null;
    expect(routeAccess("/admin/crm/embudo", state(essential))).toBe("not_included");
    expect(routeAccess("/admin/crm/embudo", state(business))).toBe("allowed");
    expect(routeAccess("/admin/crm/leads", state(essential))).toBe("allowed");
    expect(read("client/src/App.tsx")).toMatch(/path="\/admin\/crm\/embudo"/);
  });
});

describe("embudo: migración 0021", () => {
  const up = "db/migrations/0021_crm_funnel_stages.sql";
  it("es aditiva: la publicación la trata como ordinaria", () => {
    expect(destructiveMigration(read(up))).toBeNull();
    expect(extraordinaryChanges([up, "db/migrations/0021_crm_funnel_stages.down.sql"], "", (f) => read(f))).toEqual([]);
  });

  it("el código del embudo no contiene nada que la publicación trate como destructivo", () => {
    const files = ["shared/crmFunnel.ts", "server/crmFunnelDb.ts", "server/routers/crmFunnel.ts", "client/src/pages/admin/crm/CrmFunnel.tsx"];
    const diff = files.map((f) => `diff --git a/${f} b/${f}\n` + read(f).replace(/\r\n/g, "\n").split("\n").map((l) => `+${l}`).join("\n")).join("\n");
    expect(extraordinaryChanges(files, diff, () => null)).toEqual([]);
  });

  it("crea las dos tablas que usa el servidor y tiene reversión", () => {
    const sql = read(up);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS crm_funnel_stages/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS crm_lead_stages/);
    expect(sql).not.toMatch(/ALTER TABLE leads/i);
    const db = read("server/crmFunnelDb.ts");
    expect(db).toMatch(/mysqlTable\("crm_funnel_stages"/);
    expect(db).toMatch(/mysqlTable\("crm_lead_stages"/);
    expect(read("db/migrations/0021_crm_funnel_stages.down.sql")).toMatch(/crm_funnel_stages/);
  });
});
