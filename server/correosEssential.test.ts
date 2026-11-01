/**
 * Cuerpo de los correos de una empresa Essential (sin módulo sectorial): pedido, pago, factura, presupuesto, anulación
 * y vale de compra; nada de experiencias, reservas, actividades, monitores, temporada, hotel ni spa. La instalación
 * propia y las empresas con «Reservas y citas» conservan los textos de siempre. Lo personalizado no se toca.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { ORIGINAL, restosEn, visibleText } from "../shared/sinNayade";

vi.mock("./tenantBrand", () => ({
  brandName: () => "Asesoría Norte",
  companyName: () => "Asesoría Norte",
  brandSetting: (k: string) => ({ brand_name: "Asesoría Norte", brand_phone: "600 111 222", email_reservations: "hola@asesorianorte.test" } as Record<string, string>)[k] ?? "",
}));
vi.mock("./_core/legacyDb", () => ({ legacyDb: () => ({}), legacyPool: () => ({}) }));
vi.mock("./mailer", () => ({ sendEmail: vi.fn() }));

const { SYSTEM_TEMPLATES, templateSeedBody, genericBodyUpgrade } = await import("./routers/emailTemplatesRouter");
const { emailsAreGeneric, renderEmailAs } = await import("./emailVocabulary");
const T = await import("./emailTemplates");

// Las de restaurante solo existen con su módulo
const ESSENTIAL = SYSTEM_TEMPLATES.filter((t) => !t.id.startsWith("restaurant_"));

afterEach(() => {
  delete process.env.TENANT_MODE;
});

describe("correos de una empresa Essential", () => {
  it.each(ESSENTIAL.map((t) => [t.id, t] as const))("%s: cuerpo genérico, sin restos de la instalación original", (_id, tpl) => {
    const text = visibleText(templateSeedBody(tpl, true));
    expect(text).not.toMatch(ORIGINAL);
    expect(restosEn(text)).toEqual([]);
  });

  it("los envíos reales también: pedido, cuotas, cierre de caja y vale de compra", () => {
    const html = renderEmailAs(true, () => [
      T.buildReservationConfirmHtml({ merchantOrder: "P-1", productName: "Revisión anual", customerName: "Ana", date: "1 de diciembre", people: 3, amount: "30,00 €", reservationUrl: "https://x.test/p", paymentPending: true }),
      T.buildPartnerReservationConfirmHtml({ merchantOrder: "P-2", productName: "Revisión", customerName: "Ana", date: "1 de diciembre", people: 1, partnerName: "Socio", reservationUrl: "https://x.test/p", detailHtml: "Revisión" }),
      T.buildConfirmationHtml({ clientName: "Ana", reservationRef: "F-1", quoteTitle: "Revisión", items: [{ description: "Revisión", quantity: 1, unitPrice: 10, total: 10 }], total: "10", bookingDate: "1 de diciembre", reservationUrl: "https://x.test/p" } as never),
      T.buildCancellationReceivedHtml({ fullName: "Ana", requestId: 1, locator: "P-1", reason: "Cambio de planes" }),
      T.buildCashCloseHtml({ sessionId: 1, cashierName: "Ana", registerName: "Caja", openedAt: new Date(), closedAt: new Date(), openingAmount: 0, totalCash: 1, totalCard: 0, totalBizum: 0, totalMixed: 0, totalManualIn: 0, totalManualOut: 0, closingAmount: 1, countedCash: 1, cashDifference: 0, channels: [] } as never),
    ].join(" "));
    const text = visibleText(html);
    expect(restosEn(text)).toEqual([]);
    expect(text).toContain("Pedido Confirmado");
    expect(text).toContain("Ver tu pedido");
  });

  it("vale de compra: lleva a la tienda, no a experiencias", () => {
    const html = renderEmailAs(true, () => T.buildCancellationAcceptedVoucherHtml({ fullName: "Ana", requestId: 1, voucherCode: "V-1", activityName: "Revisión", value: "10", expiresAt: "31/12", isPartial: false }));
    expect(html).toContain("/tienda");
    expect(html).not.toContain("/experiencias");
    expect(visibleText(html)).toContain("Código del vale");
  });

  it("instalación propia o con reservas: los textos de siempre", () => {
    const text = visibleText(templateSeedBody(SYSTEM_TEMPLATES.find((t) => t.id === "reservation_confirm")!, false));
    expect(text).toContain("Tu reserva ha sido confirmada");
    expect(text).toContain("Experiencia");
  });

  it("vocabulario según la empresa: instalación propia, los de siempre; multiempresa sin precarga, genéricos", () => {
    process.env.TENANT_MODE = "single";
    expect(emailsAreGeneric()).toBe(false);
    expect(renderEmailAs(true, emailsAreGeneric)).toBe(true);
    expect(emailsAreGeneric()).toBe(false);
  });
});

describe("plantillas guardadas", () => {
  const tpl = SYSTEM_TEMPLATES.find((t) => t.id === "reservation_confirm")!;

  it("sin editar: el cuerpo de siempre pasa al genérico", () => {
    const up = genericBodyUpgrade(templateSeedBody(tpl, false), tpl);
    expect(up).toBe(templateSeedBody(tpl, true));
  });

  it("personalizada por la empresa: no se toca", () => {
    expect(genericBodyUpgrade(templateSeedBody(tpl, false).replace("Hola", "Buenos días"), tpl)).toBeNull();
    expect(genericBodyUpgrade("<p>Mi correo</p>", tpl)).toBeNull();
    expect(genericBodyUpgrade(null, tpl)).toBeNull();
  });

  it("ya genérica: nada que hacer", () => {
    expect(genericBodyUpgrade(templateSeedBody(tpl, true), tpl)).toBeNull();
  });
});
