/**
 * TPV Advanced: lógica pura (recuento por billetes y monedas, conciliación, entregas, reglas de autorización,
 * auditoría y CSV) y guardas de código (licencia en el guardián y en cada procedimiento, permisos, migración aditiva,
 * sin borrados ni la clase `truncate`).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  AUTH_KINDS,
  AUTH_VALIDITY_MS,
  authorizationRequired,
  authorizationUsable,
  denominationLabel,
  differenceTone,
  filterAudit,
  handoverOutcome,
  moneyDiff,
  normalizeDenominations,
  reconcile,
  ruleSummary,
  sortAudit,
  validateDayRange,
  validateRule,
  type AuditEvent,
} from "../shared/tpvAdvanced";
import { advSectionCsv, textCell } from "./tpvAdvancedCsv";
import { capabilityForProcedure } from "./_core/capabilities/routeGuard";
import { CUSTOM_ROLE_PERMISSIONS } from "../shared/customRoles";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("arqueos: recuento por billetes y monedas", () => {
  it("suma en céntimos sin errores de coma flotante e ignora ceros", () => {
    const r = normalizeDenominations({ "5000": 2, "10": 3, "1": 0, "20": 1 });
    expect(r).toEqual({ ok: true, pieces: { "5000": 2, "10": 3, "20": 1 }, totalCents: 10050 });
    const tiny = normalizeDenominations({ "10": 3 });
    expect(tiny.ok && tiny.totalCents).toBe(30); // 0,10 × 3 = 0,30 exacto
  });
  it("rechaza valores que no son de euro y cantidades no enteras o negativas", () => {
    expect(normalizeDenominations({ "300": 1 }).ok).toBe(false);
    expect(normalizeDenominations({ "100": 1.5 }).ok).toBe(false);
    expect(normalizeDenominations({ "100": -1 }).ok).toBe(false);
  });
  it("nombres comprensibles", () => {
    expect([denominationLabel(50000), denominationLabel(20), denominationLabel(1)]).toEqual(["500 €", "0,20 €", "0,01 €"]);
  });
  it("conciliación por método: sin declarar no hay diferencia inventada", () => {
    const rec = reconcile({ cash: 100.1, card: 50, bizum: 0, other: 0 }, { cash: 100, card: 52.5, bizum: null });
    expect(rec.map((r) => [r.method, r.difference])).toEqual([["cash", -0.1], ["card", 2.5], ["bizum", null], ["other", null]]);
    expect([differenceTone(0), differenceTone(2), differenceTone(-1), differenceTone(null)]).toEqual(["success", "warning", "danger", "neutral"]);
    expect(moneyDiff(0.3, 0.1 + 0.2)).toBe(0);
  });
});

describe("entregas de caja", () => {
  it("conforme al céntimo; si no, diferencia anotada", () => {
    expect(handoverOutcome(120, 120)).toEqual({ status: "accepted", difference: 0 });
    expect(handoverOutcome(120, 115.5)).toEqual({ status: "disputed", difference: -4.5 });
  });
});

describe("autorizaciones especiales", () => {
  it("sin regla activa nunca se pide; con umbral, solo por encima; sin umbral, siempre", () => {
    expect(authorizationRequired(null, 99)).toBe(false);
    expect(authorizationRequired({ kind: "discount", enabled: false, threshold: 10 }, 50)).toBe(false);
    expect(authorizationRequired({ kind: "discount", enabled: true, threshold: 10 }, 10)).toBe(false);
    expect(authorizationRequired({ kind: "discount", enabled: true, threshold: 10 }, 10.5)).toBe(true);
    expect(authorizationRequired({ kind: "cash_out", enabled: true, threshold: null }, 1)).toBe(true);
    expect(authorizationRequired({ kind: "drawer_open", enabled: true, threshold: null }, null)).toBe(true);
  });
  it("valida el umbral en su unidad", () => {
    expect(validateRule("discount", 120)).toMatch(/porcentaje/);
    expect(validateRule("cash_out", -1)).toMatch(/negativo/);
    expect(validateRule("drawer_open", 5)).toMatch(/no tiene umbral/);
    expect(validateRule("cash_out", 200)).toBeNull();
    expect(ruleSummary({ kind: "cash_out", enabled: true, threshold: 200 })).toBe("Más de 200,00 €");
    expect(ruleSummary({ kind: "discount", enabled: true, threshold: 15 })).toBe("Más de 15 %");
    expect(AUTH_KINDS).toContain("closed_correction");
  });
  it("una autorización aprobada caduca", () => {
    const now = Date.now();
    expect(authorizationUsable({ status: "approved", decidedAt: now - 1000 }, now)).toBe(true);
    expect(authorizationUsable({ status: "approved", decidedAt: now - AUTH_VALIDITY_MS - 1 }, now)).toBe(false);
    expect(authorizationUsable({ status: "used", decidedAt: now }, now)).toBe(false);
  });
});

describe("auditoría", () => {
  const ev = (at: number, type: AuditEvent["type"], actor: string, registerId = 1): AuditEvent => ({ at, type, actor, registerId, registerName: "C", sessionId: 1, amount: null, detail: "", ref: `${type}-${at}` });
  it("orden cronológico descendente y filtros por tipo, caja y persona", () => {
    const list = sortAudit([ev(1, "sale", "Ana"), ev(3, "shift_start", "Luis", 2), ev(2, "count", "ana maría")]);
    expect(list.map((e) => e.at)).toEqual([3, 2, 1]);
    expect(filterAudit(list, { types: ["sale", "count"] }).map((e) => e.type)).toEqual(["count", "sale"]);
    expect(filterAudit(list, { registerId: 2 })).toHaveLength(1);
    expect(filterAudit(list, { actor: "ANA" })).toHaveLength(2);
  });
  it("periodos acotados", () => {
    expect(validateDayRange("2026-11-01", "2026-11-09")).toBeNull();
    expect(validateDayRange("2026-11-09", "2026-11-01")).toMatch(/anterior/);
    expect(validateDayRange("2026-01-01", "2026-12-31")).toMatch(/92 días/);
  });
});

describe("CSV", () => {
  it("separador «;», coma decimal, BOM y sin fórmulas", () => {
    const csv = advSectionCsv("auditoria", { auditoria: [{ at: Date.UTC(2026, 10, 9, 10), type: "sale", sessionId: 1, registerId: 1, registerName: "=HYPERLINK()", actor: "Ana", amount: 12.5, detail: 'Ticket "1"', ref: "x" }] });
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain(";12,50;");
    expect(csv).toContain(`"'=HYPERLINK()"`);
    expect(csv).toContain(`"Ticket ""1"""`);
    expect(textCell("-1")).toBe(`"'-1"`);
  });
});

describe("guardas de código", () => {
  it("el namespace exige pos-advanced en el guardián de rutas", () => {
    expect(capabilityForProcedure("tpvAdvanced.createCount")).toBe("pos-advanced");
    expect(capabilityForProcedure("tpvAdvanced.audit")).toBe("pos-advanced");
  });
  it("cada procedimiento comprueba además la licencia (lectura o escritura) y los permisos del TPV", () => {
    const src = read("server/routers/tpvAdvanced.ts");
    expect(src).toContain("tpvAdvancedAllowed(true)");
    expect(src).toContain("tpvAdvancedAllowed(false)");
    expect(src).toContain('permissionProcedure("tpv.authorize", ["admin"])');
    expect(src).not.toMatch(/\b(publicProcedure|protectedProcedure)\b/);
    expect(read("server/routers.ts")).toContain("tpvAdvanced: tpvAdvancedRouter");
  });
  it("el permiso de autorizar está en el catálogo de roles propios, por defecto administración", () => {
    expect(CUSTOM_ROLE_PERMISSIONS.find((p) => p.key === "tpv.authorize")?.defaultRoles).toEqual(["admin"]);
  });
  it("migración 0065: solo crea tablas; el código no borra (anula con UPDATE) ni usa la clase truncate", () => {
    const up = read("db/migrations/0065_tpv_advanced.sql").replace(/--.*$/gm, "");
    expect(up).toMatch(/CREATE TABLE/);
    expect(up).not.toMatch(/\b(DROP|DELETE|TRUNCATE|ALTER)\b/i);
    for (const f of ["server/tpvAdvancedDb.ts", "server/routers/tpvAdvanced.ts", "server/tpvAdvancedCsv.ts"]) expect(read(f)).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)\b/i);
    expect(read("server/tpvAdvancedDb.ts")).not.toMatch(/UPDATE\s+tpv_session_closures|UPDATE\s+tpv_adv_counts/);
    for (const f of fs.readdirSync(path.join(root, "client/src/pages/admin/tpv/advanced"))) expect(read(`client/src/pages/admin/tpv/advanced/${f}`)).not.toMatch(/\btruncate\b/);
  });
});
