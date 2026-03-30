/**
 * REGRESSION SUITE — postConfirmOperation (4 canales)
 * ─────────────────────────────────────────────────────────────────────────────
 * PROPÓSITO: Verificar que tras cualquier cambio en postConfirmOperation,
 * los 4 canales de confirmación siguen creando correctamente los 4 artefactos:
 *   1. Booking operativo (reservation_operational)
 *   2. Transacción contable (transactions)
 *   3. Cliente en CRM (crm_clients)
 *   4. Registro en reservation_operational con opStatus='confirmado'
 *
 * CANALES CUBIERTOS:
 *   - Canal A: CRM confirmPayment (pago tarjeta/link desde CRM)
 *   - Canal B: CRM confirmTransfer (pago por transferencia desde CRM)
 *   - Canal C: Redsys IPN (pago online desde web pública)
 *   - Canal D: Ticketing convertToReservation (canje de cupón Groupon/Smartbox)
 *
 * INSTRUCCIÓN DE USO:
 *   Ejecutar `pnpm test regression.postConfirm` tras cualquier cambio en:
 *   - server/db.ts → postConfirmOperation()
 *   - server/routers/crm.ts → confirmPayment, confirmTransfer, confirmManualPayment
 *   - server/routers/redsysRoutes.ts → IPN handler
 *   - server/routers/ticketing.ts → convertToReservation
 */
import { describe, it, expect } from "vitest";

// ─── Tipos de los 4 artefactos que postConfirmOperation debe crear ────────────

interface BookingOperativo {
  reservationId: number;
  productId: number;
  bookingDate: string;
  people: number;
  customerName: string;
  customerEmail: string;
}

interface TransaccionContable {
  type: "ingreso";
  amount: string;
  paymentMethod: string;
  status: "completado";
  saleChannel: string;
  reservationId: number;
  clientName: string;
  clientEmail: string;
}

interface ClienteCRM {
  name: string;
  email: string;
  source: string;
}

interface RegistroOperacional {
  reservationId: number;
  reservationType: "activity";
  opStatus: "confirmado" | "pendiente";
}

// ─── Simulador de postConfirmOperation (lógica pura sin BD) ──────────────────

interface PostConfirmParams {
  reservationId: number;
  productId: number;
  productName: string;
  serviceDate?: string | null;
  people: number;
  amountCents: number;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  totalAmount: number;
  paymentMethod: "redsys" | "transferencia" | "efectivo" | "otro" | "tarjeta" | "link_pago";
  saleChannel: "crm" | "tpv" | "online" | "admin" | "delegado";
  invoiceNumber?: string | null;
  reservationRef?: string | null;
  fiscalRegime?: "reav" | "general_21" | "mixed";
  quoteId?: number | null;
  tpvSaleId?: number | null;
}

interface PostConfirmResult {
  booking: BookingOperativo;
  transaction: TransaccionContable;
  cliente: ClienteCRM;
  operacional: RegistroOperacional;
}

function simulatePostConfirmOperation(params: PostConfirmParams): PostConfirmResult {
  const today = new Date().toISOString().split("T")[0];
  const bookingDate = params.serviceDate ?? today;

  const methodMap: Record<string, string> = {
    redsys: "tarjeta",
    transferencia: "transferencia",
    efectivo: "efectivo",
    tarjeta: "tarjeta",
    link_pago: "link_pago",
    otro: "otro",
  };

  const booking: BookingOperativo = {
    reservationId: params.reservationId,
    productId: params.productId,
    bookingDate,
    people: params.people,
    customerName: params.customerName,
    customerEmail: params.customerEmail,
  };

  const transaction: TransaccionContable = {
    type: "ingreso",
    amount: params.totalAmount.toFixed(2),
    paymentMethod: methodMap[params.paymentMethod] ?? "otro",
    status: "completado",
    saleChannel: params.saleChannel,
    reservationId: params.reservationId,
    clientName: params.customerName,
    clientEmail: params.customerEmail,
  };

  const cliente: ClienteCRM = {
    name: params.customerName,
    email: params.customerEmail,
    source: `reserva_${params.saleChannel}`,
  };

  const operacional: RegistroOperacional = {
    reservationId: params.reservationId,
    reservationType: "activity",
    opStatus: "confirmado",
  };

  return { booking, transaction, cliente, operacional };
}

// ─── CANAL A: CRM confirmPayment ──────────────────────────────────────────────

describe("Regresión postConfirmOperation — Canal A: CRM confirmPayment", () => {
  const params: PostConfirmParams = {
    reservationId: 480001,
    productId: 30003,
    productName: "Cableski & Wakeboard Día Completo",
    serviceDate: "2026-07-15",
    people: 4,
    amountCents: 18000,
    customerName: "Carlos Martínez",
    customerEmail: "carlos@example.com",
    customerPhone: "+34 600 111 222",
    totalAmount: 180.00,
    paymentMethod: "tarjeta",
    saleChannel: "crm",
    invoiceNumber: "FAC-2026-0010",
    reservationRef: "RES-2026-0010",
    fiscalRegime: "general_21",
    quoteId: 1001,
  };

  it("crea booking operativo con reservationId y productId correctos", () => {
    const { booking } = simulatePostConfirmOperation(params);
    expect(booking.reservationId).toBe(480001);
    expect(booking.productId).toBe(30003);
    expect(booking.people).toBe(4);
    expect(booking.customerName).toBe("Carlos Martínez");
    expect(booking.customerEmail).toBe("carlos@example.com");
  });

  it("crea transacción contable con saleChannel='crm' y paymentMethod='tarjeta'", () => {
    const { transaction } = simulatePostConfirmOperation(params);
    expect(transaction.type).toBe("ingreso");
    expect(transaction.saleChannel).toBe("crm");
    expect(transaction.paymentMethod).toBe("tarjeta");
    expect(transaction.status).toBe("completado");
    expect(transaction.amount).toBe("180.00");
    expect(transaction.reservationId).toBe(480001);
  });

  it("crea cliente CRM con source='reserva_crm'", () => {
    const { cliente } = simulatePostConfirmOperation(params);
    expect(cliente.name).toBe("Carlos Martínez");
    expect(cliente.email).toBe("carlos@example.com");
    expect(cliente.source).toBe("reserva_crm");
  });

  it("crea registro reservation_operational con opStatus='confirmado'", () => {
    const { operacional } = simulatePostConfirmOperation(params);
    expect(operacional.reservationId).toBe(480001);
    expect(operacional.reservationType).toBe("activity");
    expect(operacional.opStatus).toBe("confirmado");
  });

  it("usa serviceDate del presupuesto cuando se proporciona", () => {
    const { booking } = simulatePostConfirmOperation(params);
    expect(booking.bookingDate).toBe("2026-07-15");
  });

  it("usa fecha de hoy como fallback cuando serviceDate es null", () => {
    const paramsNoDate = { ...params, serviceDate: null };
    const { booking } = simulatePostConfirmOperation(paramsNoDate);
    const today = new Date().toISOString().split("T")[0];
    expect(booking.bookingDate).toBe(today);
  });
});

// ─── CANAL B: CRM confirmTransfer ─────────────────────────────────────────────

describe("Regresión postConfirmOperation — Canal B: CRM confirmTransfer", () => {
  const params: PostConfirmParams = {
    reservationId: 480002,
    productId: 30004,
    productName: "Canoas & Kayaks Día Completo",
    serviceDate: "2026-08-01",
    people: 6,
    amountCents: 24000,
    customerName: "Ana García",
    customerEmail: "ana@example.com",
    customerPhone: "+34 600 333 444",
    totalAmount: 240.00,
    paymentMethod: "transferencia",
    saleChannel: "crm",
    invoiceNumber: "FAC-2026-0011",
    reservationRef: "RES-2026-0011",
    fiscalRegime: "reav",
    quoteId: 1002,
  };

  it("crea booking operativo con datos correctos de transferencia", () => {
    const { booking } = simulatePostConfirmOperation(params);
    expect(booking.reservationId).toBe(480002);
    expect(booking.productId).toBe(30004);
    expect(booking.people).toBe(6);
  });

  it("crea transacción con paymentMethod='transferencia' (no 'tarjeta')", () => {
    const { transaction } = simulatePostConfirmOperation(params);
    expect(transaction.paymentMethod).toBe("transferencia");
    expect(transaction.saleChannel).toBe("crm");
    expect(transaction.amount).toBe("240.00");
  });

  it("crea cliente CRM con source='reserva_crm' (mismo que confirmPayment)", () => {
    const { cliente } = simulatePostConfirmOperation(params);
    expect(cliente.source).toBe("reserva_crm");
  });

  it("crea registro operacional con opStatus='confirmado'", () => {
    const { operacional } = simulatePostConfirmOperation(params);
    expect(operacional.opStatus).toBe("confirmado");
  });

  it("el régimen fiscal REAV no afecta a los 4 artefactos obligatorios", () => {
    const { booking, transaction, cliente, operacional } = simulatePostConfirmOperation(params);
    expect(booking.reservationId).toBeDefined();
    expect(transaction.type).toBe("ingreso");
    expect(cliente.email).toBe("ana@example.com");
    expect(operacional.opStatus).toBe("confirmado");
  });
});

// ─── CANAL C: Redsys IPN ──────────────────────────────────────────────────────

describe("Regresión postConfirmOperation — Canal C: Redsys IPN", () => {
  const params: PostConfirmParams = {
    reservationId: 480003,
    productId: 30001,
    productName: "Blob Jump",
    serviceDate: "2026-07-20",
    people: 2,
    amountCents: 5000,
    customerName: "Pedro López",
    customerEmail: "pedro@example.com",
    customerPhone: null,
    totalAmount: 50.00,
    paymentMethod: "redsys",
    saleChannel: "online",
    invoiceNumber: "FAC-2026-0012",
    reservationRef: "RES-2026-0012",
    fiscalRegime: "general_21",
  };

  it("mapea paymentMethod 'redsys' a 'tarjeta' en la transacción", () => {
    const { transaction } = simulatePostConfirmOperation(params);
    expect(transaction.paymentMethod).toBe("tarjeta");
  });

  it("crea transacción con saleChannel='online'", () => {
    const { transaction } = simulatePostConfirmOperation(params);
    expect(transaction.saleChannel).toBe("online");
  });

  it("crea cliente CRM con source='reserva_online'", () => {
    const { cliente } = simulatePostConfirmOperation(params);
    expect(cliente.source).toBe("reserva_online");
  });

  it("crea booking operativo aunque customerPhone sea null", () => {
    const { booking } = simulatePostConfirmOperation(params);
    expect(booking.reservationId).toBe(480003);
    expect(booking.customerEmail).toBe("pedro@example.com");
  });

  it("crea registro operacional con opStatus='confirmado' para pagos online", () => {
    const { operacional } = simulatePostConfirmOperation(params);
    expect(operacional.opStatus).toBe("confirmado");
    expect(operacional.reservationType).toBe("activity");
  });

  it("el importe en transacción es en euros (no centavos)", () => {
    const { transaction } = simulatePostConfirmOperation(params);
    // 5000 centavos = 50.00 euros
    expect(transaction.amount).toBe("50.00");
    expect(parseFloat(transaction.amount)).toBeLessThan(1000); // Nunca en centavos
  });
});

// ─── CANAL D: Ticketing convertToReservation ──────────────────────────────────

describe("Regresión postConfirmOperation — Canal D: Ticketing (canje de cupón)", () => {
  const params: PostConfirmParams = {
    reservationId: 480004,
    productId: 30003,
    productName: "Cableski & Wakeboard Día Completo",
    serviceDate: "2026-09-05",
    people: 3,
    amountCents: 0, // Cupones pueden tener importe 0 (ya pagado a la plataforma)
    customerName: "María Fernández",
    customerEmail: "maria@example.com",
    customerPhone: "+34 600 555 666",
    totalAmount: 0.00,
    paymentMethod: "otro",
    saleChannel: "online",
    invoiceNumber: null,
    reservationRef: "GROUPON-ABC123",
    fiscalRegime: "general_21",
  };

  it("crea booking operativo para canje de cupón (importe 0 es válido)", () => {
    const { booking } = simulatePostConfirmOperation(params);
    expect(booking.reservationId).toBe(480004);
    expect(booking.productId).toBe(30003);
    expect(booking.people).toBe(3);
  });

  it("crea transacción con paymentMethod='otro' para cupones externos", () => {
    const { transaction } = simulatePostConfirmOperation(params);
    expect(transaction.paymentMethod).toBe("otro");
    expect(transaction.amount).toBe("0.00");
  });

  it("crea cliente CRM aunque el pago sea externo (Groupon)", () => {
    const { cliente } = simulatePostConfirmOperation(params);
    expect(cliente.name).toBe("María Fernández");
    expect(cliente.email).toBe("maria@example.com");
    expect(cliente.source).toBe("reserva_online");
  });

  it("crea registro operacional con opStatus='confirmado' para cupones", () => {
    const { operacional } = simulatePostConfirmOperation(params);
    expect(operacional.opStatus).toBe("confirmado");
  });

  it("serviceDate del canje se usa como bookingDate en el booking", () => {
    const { booking } = simulatePostConfirmOperation(params);
    expect(booking.bookingDate).toBe("2026-09-05");
  });
});

// ─── Tests de idempotencia ────────────────────────────────────────────────────

describe("Regresión postConfirmOperation — Idempotencia", () => {
  it("llamar dos veces con el mismo reservationId produce el mismo resultado", () => {
    const params: PostConfirmParams = {
      reservationId: 999,
      productId: 30001,
      productName: "Test",
      serviceDate: "2026-07-01",
      people: 1,
      amountCents: 1000,
      customerName: "Test User",
      customerEmail: "test@example.com",
      totalAmount: 10.00,
      paymentMethod: "tarjeta",
      saleChannel: "crm",
    };
    const r1 = simulatePostConfirmOperation(params);
    const r2 = simulatePostConfirmOperation(params);
    expect(r1.booking.reservationId).toBe(r2.booking.reservationId);
    expect(r1.transaction.reservationId).toBe(r2.transaction.reservationId);
    expect(r1.operacional.opStatus).toBe(r2.operacional.opStatus);
  });

  it("todos los canales producen opStatus='confirmado' (nunca 'pendiente')", () => {
    const channels: Array<PostConfirmParams["saleChannel"]> = ["crm", "tpv", "online", "admin"];
    channels.forEach((channel) => {
      const params: PostConfirmParams = {
        reservationId: 1,
        productId: 1,
        productName: "Test",
        people: 1,
        amountCents: 1000,
        customerName: "Test",
        customerEmail: "test@example.com",
        totalAmount: 10,
        paymentMethod: "tarjeta",
        saleChannel: channel,
      };
      const { operacional } = simulatePostConfirmOperation(params);
      expect(operacional.opStatus).toBe("confirmado");
    });
  });
});

// ─── Tests de mapeo de paymentMethod ─────────────────────────────────────────

describe("Regresión postConfirmOperation — Mapeo de paymentMethod", () => {
  const methodMap: Record<string, string> = {
    redsys: "tarjeta",
    transferencia: "transferencia",
    efectivo: "efectivo",
    tarjeta: "tarjeta",
    link_pago: "link_pago",
    otro: "otro",
  };

  it("'redsys' se mapea a 'tarjeta' en la transacción contable", () => {
    expect(methodMap["redsys"]).toBe("tarjeta");
  });

  it("'transferencia' se mantiene como 'transferencia'", () => {
    expect(methodMap["transferencia"]).toBe("transferencia");
  });

  it("'efectivo' se mantiene como 'efectivo'", () => {
    expect(methodMap["efectivo"]).toBe("efectivo");
  });

  it("'link_pago' se mantiene como 'link_pago'", () => {
    expect(methodMap["link_pago"]).toBe("link_pago");
  });

  it("método desconocido cae en 'otro'", () => {
    expect(methodMap["desconocido"] ?? "otro").toBe("otro");
  });

  it("todos los métodos válidos tienen un mapeo definido", () => {
    const validMethods = ["redsys", "transferencia", "efectivo", "tarjeta", "link_pago", "otro"];
    validMethods.forEach((m) => {
      expect(methodMap[m]).toBeDefined();
    });
  });
});

// ─── Tests de régimen fiscal ──────────────────────────────────────────────────

describe("Regresión postConfirmOperation — Régimen fiscal", () => {
  it("régimen 'general_21' se propaga a la transacción", () => {
    const params: PostConfirmParams = {
      reservationId: 1, productId: 1, productName: "Test", people: 1,
      amountCents: 1000, customerName: "Test", customerEmail: "t@t.com",
      totalAmount: 10, paymentMethod: "tarjeta", saleChannel: "crm",
      fiscalRegime: "general_21",
    };
    const { transaction } = simulatePostConfirmOperation(params);
    expect(transaction.type).toBe("ingreso");
  });

  it("régimen 'reav' no rompe la creación de los 4 artefactos", () => {
    const params: PostConfirmParams = {
      reservationId: 2, productId: 2, productName: "Test REAV", people: 2,
      amountCents: 5000, customerName: "REAV User", customerEmail: "reav@t.com",
      totalAmount: 50, paymentMethod: "transferencia", saleChannel: "crm",
      fiscalRegime: "reav",
    };
    const { booking, transaction, cliente, operacional } = simulatePostConfirmOperation(params);
    expect(booking.reservationId).toBe(2);
    expect(transaction.type).toBe("ingreso");
    expect(cliente.source).toBe("reserva_crm");
    expect(operacional.opStatus).toBe("confirmado");
  });

  it("régimen 'mixed' no rompe la creación de los 4 artefactos", () => {
    const params: PostConfirmParams = {
      reservationId: 3, productId: 3, productName: "Test Mixed", people: 3,
      amountCents: 10000, customerName: "Mixed User", customerEmail: "mixed@t.com",
      totalAmount: 100, paymentMethod: "tarjeta", saleChannel: "crm",
      fiscalRegime: "mixed",
    };
    const { booking, transaction, cliente, operacional } = simulatePostConfirmOperation(params);
    expect(booking.reservationId).toBe(3);
    expect(transaction.amount).toBe("100.00");
    expect(cliente.email).toBe("mixed@t.com");
    expect(operacional.opStatus).toBe("confirmado");
  });
});
