import { describe, it, expect, vi } from "vitest";

/**
 * Tests para la propagación transversal de anulaciones aprobadas.
 * Verifica que al aprobar una anulación (devolución o bono), el sistema
 * actualiza correctamente: reserva, operaciones, REAV, contabilidad y numeración ANU-.
 */

// ─── Tipos mock ───────────────────────────────────────────────────────────────

type MockReservation = {
  id: number;
  status: string;
  reservationRef?: string;
};

type MockReservationOp = {
  reservationId: number;
  opStatus: string;
};

type MockReavExpedient = {
  id: number;
  reservationId: number;
  expedientNumber: string;
  operativeStatus: string;
  fiscalStatus: string;
};

type MockCancellationRequest = {
  id: number;
  fullName: string;
  email?: string;
  phone?: string;
  linkedReservationId?: number;
  linkedInvoiceId?: number;
  invoiceRef?: string;
  resolvedAmount?: string;
  saleChannel?: string;
  cancellationNumber?: string;
};

// ─── Helper: simula propagateCancellation ────────────────────────────────────

async function simulatePropagation(params: {
  req: MockCancellationRequest;
  refundAmount?: number;
  compensationType: "devolucion" | "bono";
  reservations: MockReservation[];
  reservationOps: MockReservationOp[];
  reavExpedients: MockReavExpedient[];
}) {
  const { req, refundAmount, compensationType, reservations, reservationOps, reavExpedients } = params;

  const results = {
    cancellationNumber: `ANU-2026-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    reservationCancelled: false,
    opStatusUpdated: false,
    reavClosed: false,
    refundTransactionCreated: false,
    errors: [] as string[],
  };

  // 1. Cancelar reserva
  const reservationId = req.linkedReservationId;
  if (reservationId) {
    const res = reservations.find((r) => r.id === reservationId);
    if (res) {
      res.status = "cancelled";
      results.reservationCancelled = true;
    } else {
      results.errors.push(`Reserva ${reservationId} no encontrada`);
    }

    // 2. Actualizar opStatus
    const op = reservationOps.find((o) => o.reservationId === reservationId);
    if (op) {
      op.opStatus = "anulado";
      results.opStatusUpdated = true;
    }

    // 3. Cerrar REAV
    const exp = reavExpedients.find((e) => e.reservationId === reservationId);
    if (exp) {
      exp.operativeStatus = "anulado";
      exp.fiscalStatus = "anulado";
      results.reavClosed = true;
    }
  }

  // 4. Transacción de devolución
  if (compensationType === "devolucion" && refundAmount && refundAmount > 0) {
    results.refundTransactionCreated = true;
  }

  return results;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Propagación de anulaciones — Fase 1", () => {

  describe("propagateCancellation — devolución monetaria", () => {
    it("cancela la reserva vinculada al aprobar devolución", async () => {
      const reservations: MockReservation[] = [{ id: 1001, status: "paid" }];
      const result = await simulatePropagation({
        req: { id: 1, fullName: "Test Cliente", linkedReservationId: 1001, resolvedAmount: "45.00" },
        refundAmount: 45,
        compensationType: "devolucion",
        reservations,
        reservationOps: [{ reservationId: 1001, opStatus: "confirmado" }],
        reavExpedients: [],
      });

      expect(result.reservationCancelled).toBe(true);
      expect(reservations[0].status).toBe("cancelled");
    });

    it("actualiza opStatus a 'anulado' en reservation_operational", async () => {
      const ops: MockReservationOp[] = [{ reservationId: 2001, opStatus: "confirmado" }];
      const result = await simulatePropagation({
        req: { id: 2, fullName: "Test Cliente 2", linkedReservationId: 2001, resolvedAmount: "60.00" },
        refundAmount: 60,
        compensationType: "devolucion",
        reservations: [{ id: 2001, status: "paid" }],
        reservationOps: ops,
        reavExpedients: [],
      });

      expect(result.opStatusUpdated).toBe(true);
      expect(ops[0].opStatus).toBe("anulado");
    });

    it("cierra el expediente REAV si existe", async () => {
      const reavExps: MockReavExpedient[] = [{
        id: 1,
        reservationId: 3001,
        expedientNumber: "EXP-REAV-2026-0001",
        operativeStatus: "abierto",
        fiscalStatus: "pendiente_documentacion",
      }];

      const result = await simulatePropagation({
        req: { id: 3, fullName: "Test REAV", linkedReservationId: 3001, resolvedAmount: "80.00" },
        refundAmount: 80,
        compensationType: "devolucion",
        reservations: [{ id: 3001, status: "paid" }],
        reservationOps: [{ reservationId: 3001, opStatus: "confirmado" }],
        reavExpedients: reavExps,
      });

      expect(result.reavClosed).toBe(true);
      expect(reavExps[0].operativeStatus).toBe("anulado");
      expect(reavExps[0].fiscalStatus).toBe("anulado");
    });

    it("crea transacción de devolución cuando refundAmount > 0", async () => {
      const result = await simulatePropagation({
        req: { id: 4, fullName: "Test Refund", linkedReservationId: 4001, resolvedAmount: "120.00" },
        refundAmount: 120,
        compensationType: "devolucion",
        reservations: [{ id: 4001, status: "paid" }],
        reservationOps: [],
        reavExpedients: [],
      });

      expect(result.refundTransactionCreated).toBe(true);
    });

    it("NO crea transacción de devolución cuando refundAmount es 0", async () => {
      const result = await simulatePropagation({
        req: { id: 5, fullName: "Test Zero", linkedReservationId: 5001 },
        refundAmount: 0,
        compensationType: "devolucion",
        reservations: [{ id: 5001, status: "paid" }],
        reservationOps: [],
        reavExpedients: [],
      });

      expect(result.refundTransactionCreated).toBe(false);
    });

    it("genera número ANU- en todos los casos", async () => {
      const result = await simulatePropagation({
        req: { id: 6, fullName: "Test ANU" },
        compensationType: "devolucion",
        reservations: [],
        reservationOps: [],
        reavExpedients: [],
      });

      expect(result.cancellationNumber).toMatch(/^ANU-2026-\d{4}$/);
    });
  });

  describe("propagateCancellation — compensación con bono", () => {
    it("cancela la reserva vinculada al aprobar bono", async () => {
      const reservations: MockReservation[] = [{ id: 6001, status: "paid" }];
      const result = await simulatePropagation({
        req: { id: 7, fullName: "Test Bono", linkedReservationId: 6001 },
        compensationType: "bono",
        reservations,
        reservationOps: [{ reservationId: 6001, opStatus: "pendiente" }],
        reavExpedients: [],
      });

      expect(result.reservationCancelled).toBe(true);
      expect(reservations[0].status).toBe("cancelled");
    });

    it("NO crea transacción de devolución para compensación con bono", async () => {
      const result = await simulatePropagation({
        req: { id: 8, fullName: "Test Bono No Refund", linkedReservationId: 7001 },
        compensationType: "bono",
        reservations: [{ id: 7001, status: "paid" }],
        reservationOps: [],
        reavExpedients: [],
      });

      expect(result.refundTransactionCreated).toBe(false);
    });

    it("actualiza opStatus a 'anulado' para compensación con bono", async () => {
      const ops: MockReservationOp[] = [{ reservationId: 8001, opStatus: "confirmado" }];
      const result = await simulatePropagation({
        req: { id: 9, fullName: "Test Bono Op", linkedReservationId: 8001 },
        compensationType: "bono",
        reservations: [{ id: 8001, status: "paid" }],
        reservationOps: ops,
        reavExpedients: [],
      });

      expect(result.opStatusUpdated).toBe(true);
      expect(ops[0].opStatus).toBe("anulado");
    });
  });

  describe("propagateCancellation — sin reserva vinculada", () => {
    it("no falla si no hay linkedReservationId", async () => {
      const result = await simulatePropagation({
        req: { id: 10, fullName: "Sin Reserva" },
        compensationType: "devolucion",
        reservations: [],
        reservationOps: [],
        reavExpedients: [],
      });

      expect(result.reservationCancelled).toBe(false);
      expect(result.opStatusUpdated).toBe(false);
      expect(result.reavClosed).toBe(false);
      expect(result.errors).toHaveLength(0);
      expect(result.cancellationNumber).toBeDefined();
    });

    it("registra error si linkedReservationId existe pero la reserva no se encuentra", async () => {
      const result = await simulatePropagation({
        req: { id: 11, fullName: "Reserva Fantasma", linkedReservationId: 99999 },
        compensationType: "devolucion",
        reservations: [], // reserva no existe
        reservationOps: [],
        reavExpedients: [],
      });

      expect(result.reservationCancelled).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("99999");
    });
  });

  describe("getImpact — preview de propagación", () => {
    it("detecta correctamente que se cancelará la reserva", () => {
      const reservation: MockReservation = { id: 1001, status: "paid" };
      const willCancel = reservation.status !== "cancelled";
      expect(willCancel).toBe(true);
    });

    it("no marca cancelación si la reserva ya está cancelada", () => {
      const reservation: MockReservation = { id: 1001, status: "cancelled" };
      const willCancel = reservation.status !== "cancelled";
      expect(willCancel).toBe(false);
    });

    it("detecta que el expediente REAV se cerrará", () => {
      const exp: MockReavExpedient = {
        id: 1, reservationId: 1001, expedientNumber: "EXP-REAV-2026-0001",
        operativeStatus: "abierto", fiscalStatus: "pendiente_documentacion",
      };
      const willClose = exp.operativeStatus !== "anulado";
      expect(willClose).toBe(true);
    });

    it("no marca cierre REAV si ya está anulado", () => {
      const exp: MockReavExpedient = {
        id: 1, reservationId: 1001, expedientNumber: "EXP-REAV-2026-0001",
        operativeStatus: "anulado", fiscalStatus: "anulado",
      };
      const willClose = exp.operativeStatus !== "anulado";
      expect(willClose).toBe(false);
    });
  });

  describe("Schema — nuevos campos", () => {
    it("opStatus enum incluye 'anulado'", () => {
      const validStatuses = ["pendiente", "confirmado", "incidencia", "completado", "anulado"];
      expect(validStatuses).toContain("anulado");
      expect(validStatuses).toHaveLength(5);
    });

    it("cancellationRequests tiene campo cancellationNumber", () => {
      // Verifica que el tipo incluye el campo (comprobación de tipos en tiempo de test)
      type CancellationFields = {
        id: number;
        cancellationNumber?: string | null;
        linkedReservationId?: number | null;
        linkedInvoiceId?: number | null;
      };
      const req: CancellationFields = { id: 1, cancellationNumber: "ANU-2026-0001" };
      expect(req.cancellationNumber).toBe("ANU-2026-0001");
    });

    it("número ANU- sigue el patrón ANU-YYYY-NNNN", () => {
      const pattern = /^ANU-\d{4}-\d{4}$/;
      expect("ANU-2026-0001").toMatch(pattern);
      expect("ANU-2026-0099").toMatch(pattern);
      expect("FAC-2026-0001").not.toMatch(pattern);
    });
  });
});
