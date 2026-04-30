/**
 * TEMPORAL — Limpieza de datos de prueba.
 * ELIMINAR ESTE ARCHIVO tras ejecutar la limpieza.
 */
import { Router, Request, Response } from "express";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { inArray, and, eq } from "drizzle-orm";
import {
  reservations,
  invoices,
  cancellationRequests,
  cancellationLogs,
  pendingPayments,
  reavExpedients,
  crmActivityLog,
} from "../drizzle/schema";

const router = Router();

const pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const db = drizzle(pool);

const TEST_NUMBERS = ["RES-2026-0081", "RES-2026-0080", "RES-2026-0079", "RES-2026-0076"];

router.post("/api/admin-cleanup-test", async (req: Request, res: Response) => {
  if (req.query.secret !== process.env.DEBUG_SECRET) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const dryRun = req.query.dryRun !== "false";

  try {
    const rows = await db
      .select({ id: reservations.id, reservationNumber: reservations.reservationNumber, status: reservations.status })
      .from(reservations)
      .where(inArray(reservations.reservationNumber, TEST_NUMBERS));

    const ids = rows.map(r => r.id);
    if (!ids.length) {
      res.json({ dryRun, message: "No se encontraron reservas con esos números", found: 0 });
      return;
    }

    const relInvoices = await db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber }).from(invoices).where(inArray(invoices.reservationId, ids));
    const relCancReqs = await db.select({ id: cancellationRequests.id, cancellationNumber: cancellationRequests.cancellationNumber }).from(cancellationRequests).where(inArray(cancellationRequests.linkedReservationId, ids));
    const cancReqIds = relCancReqs.map(c => c.id);
    const relCancLogs = cancReqIds.length
      ? await db.select({ id: cancellationLogs.id }).from(cancellationLogs).where(inArray(cancellationLogs.requestId, cancReqIds))
      : [];
    const relPending = await db.select({ id: pendingPayments.id }).from(pendingPayments).where(inArray(pendingPayments.reservationId, ids));
    const relReav = await db.select({ id: reavExpedients.id }).from(reavExpedients).where(inArray(reavExpedients.reservationId, ids));
    const relActivity = await db.select({ id: crmActivityLog.id }).from(crmActivityLog)
      .where(and(eq(crmActivityLog.entityType, "reservation"), inArray(crmActivityLog.entityId, ids)));

    const summary = {
      dryRun,
      reservations: rows.map(r => ({ id: r.id, number: r.reservationNumber, status: r.status })),
      invoices: relInvoices,
      cancellationRequests: relCancReqs,
      cancellationLogs: relCancLogs.length,
      pendingPayments: relPending.length,
      reavExpedients: relReav.length,
      activityLogs: relActivity.length,
    };

    if (dryRun) {
      res.json(summary);
      return;
    }

    // ── Ejecutar borrado en cascada ────────────────────────────────────────
    if (relCancLogs.length && cancReqIds.length)
      await db.delete(cancellationLogs).where(inArray(cancellationLogs.requestId, cancReqIds));
    if (relCancReqs.length)
      await db.delete(cancellationRequests).where(inArray(cancellationRequests.linkedReservationId, ids));
    if (relInvoices.length)
      await db.delete(invoices).where(inArray(invoices.reservationId, ids));
    if (relPending.length)
      await db.delete(pendingPayments).where(inArray(pendingPayments.reservationId, ids));
    if (relReav.length)
      await db.delete(reavExpedients).where(inArray(reavExpedients.reservationId, ids));
    if (relActivity.length)
      await db.delete(crmActivityLog).where(and(eq(crmActivityLog.entityType, "reservation"), inArray(crmActivityLog.entityId, ids)));
    await db.delete(reservations).where(inArray(reservations.id, ids));

    res.json({ ...summary, dryRun: false, message: "✅ Borrado completado" });
  } catch (err) {
    console.error("[cleanup]", err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
