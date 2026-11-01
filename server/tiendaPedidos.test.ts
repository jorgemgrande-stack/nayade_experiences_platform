/**
 * Pedidos de la tienda online (lógica pura): estados y cambios permitidos, datos del comprador, datos fiscales en el
 * historial, mensajes del pago, líneas de la factura, enlace desde la ficha del cliente y textos sin vocabulario
 * sectorial.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  allowedStageChanges,
  billingFromLog,
  billingLogEntry,
  buyerCommentsFromNotes,
  canChangeStage,
  checkoutErrorMessage,
  isPurchasable,
  normalizeSpanishTaxId,
  orderNotes,
  soldOutMessage,
  stageEmailText,
  stageOfOrder,
  stageOfRow,
  stagePatch,
  validateBuyer,
  ORDER_STAGE_LABELS,
  type OrderStage,
} from "../shared/shopOrders";
import { invoiceLinesFor } from "./shopOrdersDb";
import { buildClientActivity } from "../shared/clientProfile";
import { buildShopOrderEmailHtml } from "./emailTemplates";

describe("estado del pedido", () => {
  it("cada línea según sus columnas de siempre", () => {
    expect(stageOfRow({ status: "pending_payment" })).toBe("pending_payment");
    expect(stageOfRow({ status: "draft" })).toBe("pending_payment");
    expect(stageOfRow({ status: "paid", statusReservation: "PENDIENTE_CONFIRMACION" })).toBe("paid");
    expect(stageOfRow({ status: "paid", statusReservation: "CONFIRMADA" })).toBe("paid");
    expect(stageOfRow({ status: "paid", statusReservation: "EN_CURSO" })).toBe("prepared");
    expect(stageOfRow({ status: "paid", statusReservation: "FINALIZADA" })).toBe("delivered");
    expect(stageOfRow({ status: "paid", statusReservation: "ANULADA" })).toBe("cancelled");
    expect(stageOfRow({ status: "cancelled" })).toBe("cancelled");
    expect(stageOfRow({ status: "failed" })).toBe("failed");
  });

  it("el pedido: el más atrasado de sus líneas vivas", () => {
    expect(stageOfOrder([])).toBe("pending_payment");
    expect(stageOfOrder([{ status: "paid", statusReservation: "FINALIZADA" }, { status: "paid", statusReservation: "EN_CURSO" }])).toBe("prepared");
    expect(stageOfOrder([{ status: "paid", statusReservation: "FINALIZADA" }, { status: "cancelled" }])).toBe("delivered");
    expect(stageOfOrder([{ status: "cancelled" }, { status: "cancelled" }])).toBe("cancelled");
    expect(stageOfOrder([{ status: "failed" }, { status: "failed" }])).toBe("failed");
  });

  it("cambios permitidos: un pagado no se cancela aquí (va con abono) y lo cerrado no cambia", () => {
    expect(allowedStageChanges("pending_payment")).toEqual(["cancelled"]);
    expect(allowedStageChanges("paid")).toEqual(["prepared", "delivered"]);
    expect(canChangeStage("paid", "cancelled")).toBe(false);
    expect(canChangeStage("prepared", "delivered")).toBe(true);
    expect(canChangeStage("delivered", "prepared")).toBe(true);
    expect(allowedStageChanges("cancelled")).toEqual([]);
    expect(allowedStageChanges("failed")).toEqual([]);
    expect(canChangeStage("paid", "pending_payment")).toBe(false);
  });

  it("columnas que se escriben y correos que se envían", () => {
    expect(stagePatch("prepared")).toEqual({ statusReservation: "EN_CURSO" });
    expect(stagePatch("delivered")).toEqual({ statusReservation: "FINALIZADA" });
    expect(stagePatch("cancelled")).toEqual({ status: "cancelled", statusReservation: "ANULADA" });
    expect(stagePatch("pending_payment")).toBeNull();
    expect(stagePatch("failed")).toBeNull();
    for (const s of ["prepared", "delivered", "cancelled"] as OrderStage[]) expect(stageEmailText(s)?.subject).toBeTruthy();
    expect(stageEmailText("paid")).toBeNull();
  });

  it("etiquetas en español y sin vocabulario sectorial", () => {
    expect(Object.values(ORDER_STAGE_LABELS)).toEqual(["Pendiente de pago", "Pagado", "Preparado o enviado", "Entregado", "Cancelado", "Pago no completado"]);
  });
});

describe("datos del comprador", () => {
  const ok = { name: "Lucía Pérez", email: "lucia@ejemplo.es" };
  it("nombre y correo obligatorios, teléfono opcional con al menos 9 cifras", () => {
    expect(validateBuyer(ok)).toEqual({});
    expect(validateBuyer({ ...ok, name: " L " }).name).toBe("Escribe tu nombre y apellidos.");
    expect(validateBuyer({ ...ok, email: "" }).email).toBeTruthy();
    expect(validateBuyer({ ...ok, email: "lucia@ejemplo" }).email).toMatch(/no es válido/);
    expect(validateBuyer({ ...ok, phone: "+34 600 111 222" })).toEqual({});
    expect(validateBuyer({ ...ok, phone: "6001" }).phone).toMatch(/9 y 15 cifras/);
  });

  it("NIF solo si pide factura: NIF, NIE y CIF con su control", () => {
    expect(validateBuyer({ ...ok, nif: "basura" })).toEqual({});
    expect(validateBuyer({ ...ok, wantsInvoice: true }).nif).toMatch(/Escribe el NIF/);
    expect(validateBuyer({ ...ok, wantsInvoice: true, nif: "12345678A" }).nif).toMatch(/no es válido/);
    expect(validateBuyer({ ...ok, wantsInvoice: true, nif: "12345678z" })).toEqual({});
    expect(normalizeSpanishTaxId(" 12.345.678-z ")).toBe("12345678Z");
    expect(normalizeSpanishTaxId("X1234567L")).toBe("X1234567L");
    expect(normalizeSpanishTaxId("B12345674")).toBe("B12345674");
    expect(normalizeSpanishTaxId("B12345675")).toBeNull();
    expect(normalizeSpanishTaxId("")).toBeNull();
  });

  it("datos fiscales y comentarios viajan con el pedido", () => {
    const log = [{ ts: 1, actor: "x", action: "status_change" }, billingLogEntry({ nif: "b12345674", name: "Textil, S.L." }, 2)];
    expect(billingFromLog(log)).toEqual({ nif: "B12345674", name: "Textil, S.L." });
    expect(billingFromLog([{ action: "datos_facturacion", to: "{roto" }])).toBeNull();
    expect(billingFromLog(null)).toBeNull();
    const notes = orderNotes(["Camiseta", "Taza"], "  Dejar en conserjería ");
    expect(notes).toBe("Carrito: Camiseta, Taza\nComentarios del cliente: Dejar en conserjería");
    expect(buyerCommentsFromNotes(notes)).toBe("Dejar en conserjería");
    expect(orderNotes(["Camiseta"], "")).toBe("Carrito: Camiseta");
    expect(buyerCommentsFromNotes("Carrito: Camiseta")).toBeNull();
  });
});

describe("pago y disponibilidad", () => {
  it("errores del pago claros para el comprador, sin jerga", () => {
    expect(checkoutErrorMessage({ code: "PRECONDITION_FAILED", message: "El pago online no está configurado en esta empresa." })).toMatch(/no está disponible en este momento/);
    expect(checkoutErrorMessage({ code: "FORBIDDEN", message: "Durante la prueba gratuita no se pueden cobrar pagos reales. Puedes probar los cobros con el entorno de pruebas de Redsys" })).not.toMatch(/Redsys|prueba/);
    expect(checkoutErrorMessage({ code: "BAD_REQUEST", message: soldOutMessage("Taza") })).toBe("«Taza» está agotado o ya no está a la venta. Quítalo del carrito para continuar.");
    expect(checkoutErrorMessage({ code: "BAD_REQUEST", message: '[{"code":"invalid_type"}]' })).toMatch(/No hemos podido iniciar el pago/);
    expect(checkoutErrorMessage({ code: "NOT_FOUND", message: "Producto 9 no encontrado" })).toMatch(/ya no está a la venta/);
    expect(checkoutErrorMessage({ message: "Failed to fetch" })).toMatch(/Revisa tu conexión/);
    expect(checkoutErrorMessage({ code: "INTERNAL_SERVER_ERROR", message: "boom" })).toMatch(/no se te ha cobrado nada/);
  });

  it("se vende lo activo y publicado", () => {
    expect(isPurchasable({ isActive: true, isPublished: true })).toBe(true);
    expect(isPurchasable({})).toBe(true);
    expect(isPurchasable({ isActive: false, isPublished: true })).toBe(false);
    expect(isPurchasable({ isActive: true, isPublished: false })).toBe(false);
  });
});

describe("factura y ficha del cliente", () => {
  it("una línea de factura por artículo, con IVA incluido y el tipo de cada producto", () => {
    const lines = invoiceLinesFor([{ productId: 1, productName: "Sudadera · Talla XL", people: 2, amountTotal: 8500 }, { productId: 2, productName: "Camiseta", people: 1, amountTotal: 2420 }], new Map([[1, 10]]));
    expect(lines).toEqual([
      { description: "Sudadera · Talla XL", quantity: 2, unitPrice: 42.5, total: 85, fiscalRegime: "general", taxRate: 10 },
      { description: "Camiseta", quantity: 1, unitPrice: 24.2, total: 24.2, fiscalRegime: "general", taxRate: 21 },
    ]);
  });

  it("la ficha del cliente abre el pedido de la tienda entero, con su estado", () => {
    const base = { createdAt: "2026-11-01T10:00:00Z", amountTotal: 2420, amountPaid: 2420 };
    const act = buildClientActivity({
      quotes: [],
      invoices: [],
      reservations: [
        { id: 7, merchantOrder: "123456789012", reservationNumber: "RES-2026-0007", productName: "Camiseta", status: "paid", statusReservation: "EN_CURSO", channel: "ONLINE_DIRECTO", quoteId: null, ...base },
        { id: 8, merchantOrder: "999", reservationNumber: "RES-2026-0008", productName: "Manual", status: "paid", channel: "MANUAL", ...base },
      ],
    });
    const shop = act.find((a) => a.id === "order-7")!;
    expect(shop).toMatchObject({ title: "Pedido 123456789012", status: "Preparado o enviado", href: "/admin/tienda/pedidos/123456789012" });
    expect(act.find((a) => a.id === "payment-order-7")!.href).toBe("/admin/tienda/pedidos/123456789012");
    expect(act.find((a) => a.id === "order-8")).toMatchObject({ title: "Pedido RES-2026-0008", status: "Pagado", href: "/admin/crm?tab=reservations&resId=8" });
  });

  it("el correo del pedido escapa los textos y no usa vocabulario sectorial", () => {
    const html = buildShopOrderEmailHtml({ title: "Pedido confirmado", customerName: "<b>Ana</b>", orderNumber: "123", intro: "Hemos recibido tu pago.", lines: [{ name: "Taza & plato", quantity: 2, total: "24,00 €" }], total: "24,00 €", invoiceNumber: "FAC-2026-0001", statusLabel: "Pagado" });
    expect(html).toContain("&lt;b&gt;Ana&lt;/b&gt;");
    expect(html).toContain("Taza &amp; plato");
    expect(html).toContain("FAC-2026-0001");
    expect(html).not.toMatch(/experiencia|reserva|hu[eé]sped|personas?\b|actividad/i);
  });
});

describe("textos de la tienda sin vocabulario sectorial", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
  it("pedidos del panel, tienda, carrito genérico y página de pago correcto genérica", () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const f of ["client/src/pages/admin/shop/OnlineOrders.tsx", "client/src/pages/Shop.tsx", "shared/shopOrders.ts"]) {
      const code = strip(read(f)).replace(/reservations\.\w+|resId|tab=reservations|statusReservation/g, "");
      expect(code, f).not.toMatch(/experiencia|reserva|hu[eé]sped|\bpersonas?\b|actividad|fecha del servicio|n[aá]yade/i);
    }
    // La página de pago correcto de la tienda: el bloque genérico no habla de reservas ni de personas
    const ok = read("client/src/pages/ReservaOk.tsx");
    const generic = ok.slice(ok.indexOf("if (generic && !isQuotePayment)"), ok.indexOf("¡{isQuotePayment"));
    expect(generic).toContain("¡Pedido confirmado!");
    expect(generic).toContain("Número de pedido");
    expect(generic).not.toMatch(/Reserva confirmada|Personas|Actividad/);
  });

  it("el carrito y el pago usan el formato es-ES y los colores de la marca", () => {
    for (const f of ["client/src/components/CartDrawer.tsx", "client/src/pages/Checkout.tsx"]) {
      const code = read(f);
      expect(code, f).not.toMatch(/toFixed\(2\)/);
      expect(code, f).not.toMatch(/orange-\d{3}/);
    }
  });
});
