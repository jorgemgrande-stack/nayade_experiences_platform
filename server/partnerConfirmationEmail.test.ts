/**
 * partnerConfirmationEmail.test.ts
 * La plantilla de confirmación para reservas DELEGADAS por un partner no debe
 * afirmar que el pago se procesó (el cliente paga al partner, no a Náyade) ni
 * mostrar importe/Total; sí debe nombrar al partner.
 */
import { describe, it, expect } from "vitest";
import { buildPartnerReservationConfirmHtml } from "./emailTemplates";

const base = {
  merchantOrder: "RES-2026-0232",
  productName: "Banana Ski",
  customerName: "Akamai",
  date: "jueves, 18 de junio de 2026",
  people: 65,
  partnerName: "Hotel Nayade",
};

describe("buildPartnerReservationConfirmHtml", () => {
  const html = buildPartnerReservationConfirmHtml(base);

  it("NO incluye textos de pago de Náyade", () => {
    expect(html).not.toContain("Pago procesado correctamente");
    expect(html).not.toContain("pago procesado correctamente");
    expect(html).not.toContain("Total pagado");
  });

  it("indica que el pago se gestiona con el partner y lo nombra", () => {
    expect(html).toContain("Hotel Nayade");
    expect(html).toContain("Reserva confirmada");
    expect(html.toLowerCase()).toContain("gestionada a trav");
  });

  it("incluye los datos de la reserva", () => {
    expect(html).toContain("Banana Ski");
    expect(html).toContain("Akamai");
    expect(html).toContain("RES-2026-0232");
    expect(html).toContain("65 personas");
  });

  it("renderiza el desglose multi-actividad sin importes cuando se pasa detailHtml", () => {
    const multi = buildPartnerReservationConfirmHtml({
      ...base,
      detailHtml: "• Banana Ski — jueves · 10 pers<br/>• Paddle — viernes · 5 pers",
    });
    expect(multi).toContain("Detalle de actividades");
    expect(multi).toContain("Paddle");
  });
});
