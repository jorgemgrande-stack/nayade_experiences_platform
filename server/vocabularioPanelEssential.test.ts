/**
 * Vocabulario de la instalación propia en el panel de una pyme: variantes y precios, módulos de portada, plantillas
 * de correo sembradas, ayuda, TPV y presupuestos. Con el módulo sectorial (o en la instalación propia), el de siempre.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildVocabulary } from "../shared/vocabulary";
import { getHelpArticle } from "../shared/helpCenter";

vi.mock("./tenantBrand", () => ({ brandName: () => "Asesoría Norte" }));
vi.mock("./_core/legacyDb", () => ({ legacyDb: () => ({}), legacyPool: () => ({}) }));
vi.mock("./mailer", () => ({ sendEmail: vi.fn() }));

const { SYSTEM_TEMPLATES, GENERIC_TEMPLATE_TEXTS, templateSeedTexts, upgradeableToGeneric } = await import("./routers/emailTemplatesRouter");

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const NAYADE = /reserva|experiencia|actividad|bono/i;

describe("presupuestos: condiciones por defecto", () => {
  it("«Sujeto a disponibilidad» solo con reservas y citas o en la instalación propia", () => {
    expect(buildVocabulary({ licensed: true, can: () => false }).quoteConditions).toBe("Presupuesto válido por 15 días.");
    expect(buildVocabulary({ licensed: true, can: (c) => c === "bookings-generic" }).quoteConditions).toContain("Sujeto a disponibilidad");
    expect(buildVocabulary({ licensed: false }).quoteConditions).toContain("Sujeto a disponibilidad");
  });

  it("el presupuesto creado desde una oportunidad usa las del vocabulario", () => {
    const crm = read("server/routers/crm.ts");
    expect(crm).toContain("conditions: input.conditions ?? voc.quoteConditions");
    expect(crm).not.toContain('input.conditions ?? "Presupuesto válido por 15 días. Sujeto a disponibilidad."');
  });
});

describe("plantillas de correo sembradas", () => {
  const tpl = (id: string) => SYSTEM_TEMPLATES.find((t) => t.id === id)!;

  it("empresa nueva sin reservas: nombres, asuntos y cabeceras genéricos", () => {
    for (const id of Object.keys(GENERIC_TEMPLATE_TEXTS)) {
      const t = templateSeedTexts(tpl(id), true);
      expect(`${t.name} ${t.description} ${t.subject} ${t.headerTitle} ${t.headerSubtitle}`, id).not.toMatch(NAYADE);
    }
    expect(templateSeedTexts(tpl("reservation_confirm"), true)).toMatchObject({ name: "Confirmación de Pedido", subject: "Pedido confirmado · Asesoría Norte" });
    expect(templateSeedTexts(tpl("reservation_failed"), true).name).toBe("Pago No Completado");
    expect(templateSeedTexts(tpl("cancellation_accepted_voucher"), true).name).toBe("Anulación Aceptada — Vale de compra");
  });

  it("instalación propia o con reservas: los de siempre", () => {
    expect(templateSeedTexts(tpl("reservation_confirm"), false)).toMatchObject({ name: "Confirmación de Reserva", subject: "Reserva confirmada · Asesoría Norte" });
  });

  it("empresa existente: solo se renombran las que no ha personalizado", () => {
    const t = tpl("reservation_confirm");
    expect(upgradeableToGeneric(templateSeedTexts(t, false), t)).toBe(true);
    expect(upgradeableToGeneric({ ...templateSeedTexts(t, false), subject: "Mi asunto propio" }, t)).toBe(false);
    expect(upgradeableToGeneric(templateSeedTexts(t, true), t)).toBe(false);
    // Sin versión genérica: nunca se toca
    const invite = tpl("invite");
    expect(upgradeableToGeneric(templateSeedTexts(invite, false), invite)).toBe(false);
  });
});

describe("pantallas del panel", () => {
  it("Variantes y precios: sin jerga técnica y con «producto o servicio» para una pyme", () => {
    const src = read("client/src/pages/admin/products/VariantsManager.tsx");
    expect(src).not.toMatch(/BookingModal|Redsys|modal de reserva/);
    expect(src).toContain("useVocabulary");
    expect(src).toContain('"producto o servicio"');
  });

  it("Módulos de portada: nombres genéricos para una pyme", () => {
    const src = read("client/src/pages/admin/cms/HomeModulesManager.tsx");
    expect(src).toContain('label: "Productos destacados"');
    expect(src).toMatch(/licensed \? \{ \.\.\.m, \.\.\.GENERIC_LABELS\[m\.key\] \} : m/);
  });

  it("TPV: la fecha del servicio solo con reservas y citas", () => {
    const src = read("client/src/pages/admin/tpv/TpvScreen.tsx");
    expect(src).toContain('const askServiceDate = !licensed || can("bookings-generic");');
    expect(src).toContain("{askServiceDate && <div");
  });

  it("Ayuda: crear pedidos con los textos que ve una pyme", () => {
    const a = getHelpArticle("crear-pedidos")!;
    const text = [a.summary, ...a.steps].join(" ");
    expect(text).not.toMatch(/«Reservas»|«Nueva Reserva»|«Crear Reserva»|Experiencia o pack/);
    expect(text).toContain("«Nuevo pedido»");
  });
});
