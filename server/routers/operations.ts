import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { eq, and, desc, asc } from "drizzle-orm";
import {
  monitors,
  monitorDocuments,
  monitorPayroll,
  reservationOperational,
} from "../../drizzle/schema";

const pool = mysql.createPool(process.env.DATABASE_URL!);
const db = drizzle(pool);

// ─── MONITORS CRUD ────────────────────────────────────────────────────────────
const monitorsRouter = router({
  list: adminProcedure
    .input(z.object({
      search: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .query(async ({ input }) => {
      const rows = await db.select().from(monitors).orderBy(asc(monitors.fullName));
      let result = rows;
      if (input.isActive !== undefined) {
        result = result.filter(m => m.isActive === input.isActive);
      }
      if (input.search) {
        const q = input.search.toLowerCase();
        result = result.filter(m =>
          m.fullName.toLowerCase().includes(q) ||
          (m.email ?? "").toLowerCase().includes(q) ||
          (m.phone ?? "").includes(q)
        );
      }
      return result;
    }),

  get: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [monitor] = await db.select().from(monitors).where(eq(monitors.id, input.id));
      if (!monitor) throw new Error("Monitor no encontrado");
      const docs = await db.select().from(monitorDocuments).where(eq(monitorDocuments.monitorId, input.id)).orderBy(desc(monitorDocuments.createdAt));
      const payrolls = await db.select().from(monitorPayroll).where(eq(monitorPayroll.monitorId, input.id)).orderBy(desc(monitorPayroll.year), desc(monitorPayroll.month));
      return { ...monitor, documents: docs, payrolls };
    }),

  create: adminProcedure
    .input(z.object({
      fullName: z.string().min(2),
      dni: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional().or(z.literal("")),
      address: z.string().optional(),
      birthDate: z.string().optional(),
      emergencyName: z.string().optional(),
      emergencyRelation: z.string().optional(),
      emergencyPhone: z.string().optional(),
      iban: z.string().optional(),
      ibanHolder: z.string().optional(),
      contractType: z.enum(["indefinido","temporal","autonomo","practicas","otro"]).optional(),
      contractStart: z.string().optional(),
      contractEnd: z.string().optional(),
      contractConditions: z.string().optional(),
      notes: z.string().optional(),
      isActive: z.boolean().default(true),
      photoUrl: z.string().optional(),
      photoKey: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const [result] = await db.insert(monitors).values({
        fullName: input.fullName,
        dni: input.dni,
        phone: input.phone,
        email: input.email || undefined,
        address: input.address,
        birthDate: input.birthDate ? new Date(input.birthDate) : undefined,
        emergencyName: input.emergencyName,
        emergencyRelation: input.emergencyRelation,
        emergencyPhone: input.emergencyPhone,
        iban: input.iban,
        ibanHolder: input.ibanHolder,
        contractType: input.contractType,
        contractStart: input.contractStart ? new Date(input.contractStart) : undefined,
        contractEnd: input.contractEnd ? new Date(input.contractEnd) : undefined,
        contractConditions: input.contractConditions,
        notes: input.notes,
        isActive: input.isActive,
        photoUrl: input.photoUrl,
        photoKey: input.photoKey,
      });
      return { id: (result as any).insertId };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      fullName: z.string().min(2).optional(),
      dni: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
      birthDate: z.string().optional(),
      emergencyName: z.string().optional(),
      emergencyRelation: z.string().optional(),
      emergencyPhone: z.string().optional(),
      iban: z.string().optional(),
      ibanHolder: z.string().optional(),
      contractType: z.enum(["indefinido","temporal","autonomo","practicas","otro"]).optional(),
      contractStart: z.string().optional(),
      contractEnd: z.string().optional(),
      contractConditions: z.string().optional(),
      notes: z.string().optional(),
      isActive: z.boolean().optional(),
      photoUrl: z.string().optional(),
      photoKey: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, birthDate, contractStart, contractEnd, ...rest } = input;
      await db.update(monitors).set({
        ...rest,
        birthDate: birthDate ? new Date(birthDate) : undefined,
        contractStart: contractStart ? new Date(contractStart) : undefined,
        contractEnd: contractEnd ? new Date(contractEnd) : undefined,
      }).where(eq(monitors.id, id));
      return { ok: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(monitors).where(eq(monitors.id, input.id));
      return { ok: true };
    }),

  // Documents
  addDocument: adminProcedure
    .input(z.object({
      monitorId: z.number(),
      type: z.enum(["dni","contrato","certificado","otro"]),
      name: z.string(),
      fileUrl: z.string(),
      fileKey: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.insert(monitorDocuments).values({
        monitorId: input.monitorId,
        type: input.type,
        name: input.name,
        fileUrl: input.fileUrl,
        fileKey: input.fileKey,
        uploadedBy: ctx.user.id,
      });
      return { ok: true };
    }),

  deleteDocument: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(monitorDocuments).where(eq(monitorDocuments.id, input.id));
      return { ok: true };
    }),

  // Payroll
  addPayroll: adminProcedure
    .input(z.object({
      monitorId: z.number(),
      year: z.number(),
      month: z.number().min(1).max(12),
      baseSalary: z.string(),
      extras: z.array(z.object({ concept: z.string(), amount: z.number(), type: z.string() })).default([]),
      totalAmount: z.string(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.insert(monitorPayroll).values({
        monitorId: input.monitorId,
        year: input.year,
        month: input.month,
        baseSalary: input.baseSalary,
        extras: input.extras,
        totalAmount: input.totalAmount,
        notes: input.notes,
        createdBy: ctx.user.id,
      });
      return { ok: true };
    }),

  updatePayroll: adminProcedure
    .input(z.object({
      id: z.number(),
      baseSalary: z.string().optional(),
      extras: z.array(z.object({ concept: z.string(), amount: z.number(), type: z.string() })).optional(),
      totalAmount: z.string().optional(),
      status: z.enum(["pendiente","pagado"]).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...rest } = input;
      await db.update(monitorPayroll).set({
        ...rest,
        paidAt: rest.status === "pagado" ? new Date() : undefined,
      }).where(eq(monitorPayroll.id, id));
      return { ok: true };
    }),

  deletePayroll: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(monitorPayroll).where(eq(monitorPayroll.id, input.id));
      return { ok: true };
    }),
});

// ─── CALENDAR (Unified) ───────────────────────────────────────────────────────
const calendarRouter = router({
  getEvents: protectedProcedure
    .input(z.object({
      from: z.string(), // ISO date string
      to: z.string(),   // ISO date string
    }))
    .query(async ({ input }) => {
      const fromTs = new Date(input.from).getTime();
      const toTs = new Date(input.to).getTime();

      // Query reservations (activities/packs) from the main reservations table
      const [activityRows] = await pool.execute<any[]>(`
        SELECT
          r.id,
          r.customer_name AS clientName,
          r.customer_email AS clientEmail,
          r.customer_phone AS clientPhone,
          r.scheduled_date AS scheduledDate,
          r.number_of_persons AS numberOfPersons,
          r.status,
          r.channel,
          e.title AS activityTitle,
          e.slug AS activitySlug,
          'activity' AS eventType,
          ro.client_confirmed AS clientConfirmed,
          ro.arrival_time AS arrivalTime,
          ro.op_notes AS opNotes,
          ro.monitor_id AS monitorId,
          ro.op_status AS opStatus,
          m.full_name AS monitorName
        FROM reservations r
        LEFT JOIN experiences e ON r.experience_id = e.id
        LEFT JOIN reservation_operational ro ON ro.reservation_id = r.id AND ro.reservation_type = 'activity'
        LEFT JOIN monitors m ON m.id = ro.monitor_id
        WHERE r.scheduled_date >= ? AND r.scheduled_date <= ?
          AND r.status NOT IN ('cancelled','payment_failed')
        ORDER BY r.scheduled_date ASC
      `, [fromTs, toTs]);

      // Query restaurant bookings
      const [restaurantRows] = await pool.execute<any[]>(`
        SELECT
          rb.id,
          rb.guestFirstName AS clientName,
          rb.guestEmail AS clientEmail,
          rb.guestPhone AS clientPhone,
          rb.bookingDate AS scheduledDate,
          rb.numberOfGuests AS numberOfPersons,
          rb.status,
          'manual' AS channel,
          CONCAT(rest.name, ' - ', rb.bookingTime) AS activityTitle,
          rb.bookingTime AS bookingTime,
          'restaurant' AS eventType,
          ro.client_confirmed AS clientConfirmed,
          ro.arrival_time AS arrivalTime,
          ro.op_notes AS opNotes,
          NULL AS monitorId,
          ro.op_status AS opStatus,
          NULL AS monitorName
        FROM restaurant_bookings rb
        LEFT JOIN restaurants rest ON rest.id = rb.restaurantId
        LEFT JOIN reservation_operational ro ON ro.reservation_id = rb.id AND ro.reservation_type = 'restaurant'
        WHERE rb.bookingDate >= ? AND rb.bookingDate <= ?
          AND rb.status NOT IN ('cancelled','payment_failed')
        ORDER BY rb.bookingDate ASC, rb.bookingTime ASC
      `, [fromTs, toTs]);

      return {
        activities: activityRows || [],
        restaurants: restaurantRows || [],
      };
    }),
});

// ─── DAILY ORDERS ─────────────────────────────────────────────────────────────
const dailyOrdersRouter = router({
  getForDate: protectedProcedure
    .input(z.object({ date: z.string() }))
    .query(async ({ input }) => {
      const date = new Date(input.date);
      const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0).getTime();
      const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59).getTime();

      const [activityRows] = await pool.execute<any[]>(`
        SELECT
          r.id,
          r.customer_name AS clientName,
          r.customer_email AS clientEmail,
          r.customer_phone AS clientPhone,
          r.scheduled_date AS scheduledDate,
          r.number_of_persons AS numberOfPersons,
          r.status,
          e.title AS activityTitle,
          'activity' AS eventType,
          ro.client_confirmed AS clientConfirmed,
          ro.client_confirmed_at AS clientConfirmedAt,
          ro.arrival_time AS arrivalTime,
          ro.op_notes AS opNotes,
          ro.monitor_id AS monitorId,
          ro.op_status AS opStatus,
          m.full_name AS monitorName,
          ro.id AS opId
        FROM reservations r
        LEFT JOIN experiences e ON r.experience_id = e.id
        LEFT JOIN reservation_operational ro ON ro.reservation_id = r.id AND ro.reservation_type = 'activity'
        LEFT JOIN monitors m ON m.id = ro.monitor_id
        WHERE r.scheduled_date >= ? AND r.scheduled_date <= ?
          AND r.status NOT IN ('cancelled','payment_failed')
        ORDER BY r.scheduled_date ASC
      `, [startOfDay, endOfDay]);

      const [restaurantRows] = await pool.execute<any[]>(`
        SELECT
          rb.id,
          CONCAT(rb.guestFirstName, ' ', COALESCE(rb.guestLastName, '')) AS clientName,
          rb.guestEmail AS clientEmail,
          rb.guestPhone AS clientPhone,
          rb.bookingDate AS scheduledDate,
          rb.numberOfGuests AS numberOfPersons,
          rb.status,
          CONCAT(rest.name, ' - ', rb.bookingTime) AS activityTitle,
          rb.bookingTime AS bookingTime,
          'restaurant' AS eventType,
          ro.client_confirmed AS clientConfirmed,
          ro.client_confirmed_at AS clientConfirmedAt,
          ro.arrival_time AS arrivalTime,
          ro.op_notes AS opNotes,
          NULL AS monitorId,
          ro.op_status AS opStatus,
          NULL AS monitorName,
          ro.id AS opId
        FROM restaurant_bookings rb
        LEFT JOIN restaurants rest ON rest.id = rb.restaurantId
        LEFT JOIN reservation_operational ro ON ro.reservation_id = rb.id AND ro.reservation_type = 'restaurant'
        WHERE rb.bookingDate >= ? AND rb.bookingDate <= ?
          AND rb.status NOT IN ('cancelled','payment_failed')
        ORDER BY rb.bookingDate ASC, rb.bookingTime ASC
      `, [startOfDay, endOfDay]);

      return {
        activities: activityRows || [],
        restaurants: restaurantRows || [],
        date: input.date,
      };
    }),

  updateOperational: protectedProcedure
    .input(z.object({
      reservationId: z.number(),
      reservationType: z.enum(["activity","restaurant","hotel","spa","pack"]),
      clientConfirmed: z.boolean().optional(),
      arrivalTime: z.string().optional(),
      opNotes: z.string().optional(),
      monitorId: z.number().nullable().optional(),
      opStatus: z.enum(["pendiente","confirmado","incidencia","completado"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const existing = await db.select().from(reservationOperational)
        .where(and(
          eq(reservationOperational.reservationId, input.reservationId),
          eq(reservationOperational.reservationType, input.reservationType)
        ));

      const updateData: any = {
        updatedBy: ctx.user.id,
      };
      if (input.clientConfirmed !== undefined) {
        updateData.clientConfirmed = input.clientConfirmed;
        if (input.clientConfirmed) {
          updateData.clientConfirmedAt = new Date();
          updateData.clientConfirmedBy = ctx.user.id;
        }
      }
      if (input.arrivalTime !== undefined) updateData.arrivalTime = input.arrivalTime;
      if (input.opNotes !== undefined) updateData.opNotes = input.opNotes;
      if (input.monitorId !== undefined) updateData.monitorId = input.monitorId;
      if (input.opStatus !== undefined) updateData.opStatus = input.opStatus;

      if (existing.length > 0) {
        await db.update(reservationOperational)
          .set(updateData)
          .where(eq(reservationOperational.id, existing[0].id));
      } else {
        await db.insert(reservationOperational).values({
          reservationId: input.reservationId,
          reservationType: input.reservationType,
          ...updateData,
        });
      }
      return { ok: true };
    }),

  getDashboardStats: protectedProcedure
    .input(z.object({ date: z.string() }))
    .query(async ({ input }) => {
      const date = new Date(input.date);
      const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0).getTime();
      const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59).getTime();

      const [[actStats]] = await pool.execute<any[]>(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN ro.client_confirmed = 1 THEN 1 ELSE 0 END) AS confirmed,
          SUM(CASE WHEN (ro.client_confirmed IS NULL OR ro.client_confirmed = 0) THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN ro.op_status = 'incidencia' THEN 1 ELSE 0 END) AS incidencias
        FROM reservations r
        LEFT JOIN reservation_operational ro ON ro.reservation_id = r.id AND ro.reservation_type = 'activity'
        WHERE r.scheduled_date >= ? AND r.scheduled_date <= ?
          AND r.status NOT IN ('cancelled','payment_failed')
      `, [startOfDay, endOfDay]);

      const [[restStats]] = await pool.execute<any[]>(`
        SELECT COUNT(*) AS total
        FROM restaurant_bookings rb
        WHERE rb.bookingDate >= ? AND rb.bookingDate <= ?
          AND rb.status NOT IN ('cancelled','payment_failed')
      `, [startOfDay, endOfDay]);

      return {
        totalReservations: (actStats?.total || 0) + (restStats?.total || 0),
        confirmedClients: actStats?.confirmed || 0,
        pendingConfirmation: actStats?.pending || 0,
        incidencias: actStats?.incidencias || 0,
        restaurantBookings: restStats?.total || 0,
      };
    }),
});

// ─── ACTIVITIES (Actividades del día) ─────────────────────────────────────────
const activitiesRouter = router({
  getForDate: protectedProcedure
    .input(z.object({ date: z.string() }))
    .query(async ({ input }) => {
      const date = new Date(input.date);
      const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0).getTime();
      const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59).getTime();

      const [rows] = await pool.execute<any[]>(`
        SELECT
          r.id,
          r.customer_name AS clientName,
          r.customer_email AS clientEmail,
          r.customer_phone AS clientPhone,
          r.scheduled_date AS scheduledDate,
          r.number_of_persons AS numberOfPersons,
          r.status,
          r.channel,
          e.title AS activityTitle,
          e.slug AS activitySlug,
          e.duration AS duration,
          ro.client_confirmed AS clientConfirmed,
          ro.arrival_time AS arrivalTime,
          ro.op_notes AS opNotes,
          ro.monitor_id AS monitorId,
          ro.op_status AS opStatus,
          m.full_name AS monitorName,
          ro.id AS opId
        FROM reservations r
        LEFT JOIN experiences e ON r.experience_id = e.id
        LEFT JOIN reservation_operational ro ON ro.reservation_id = r.id AND ro.reservation_type = 'activity'
        LEFT JOIN monitors m ON m.id = ro.monitor_id
        WHERE r.scheduled_date >= ? AND r.scheduled_date <= ?
          AND r.status NOT IN ('cancelled','payment_failed')
        ORDER BY r.scheduled_date ASC
      `, [startOfDay, endOfDay]);

      return rows || [];
    }),

  assignMonitor: adminProcedure
    .input(z.object({
      reservationId: z.number(),
      monitorId: z.number().nullable(),
    }))
    .mutation(async ({ input, ctx }) => {
      const existing = await db.select().from(reservationOperational)
        .where(and(
          eq(reservationOperational.reservationId, input.reservationId),
          eq(reservationOperational.reservationType, "activity")
        ));

      if (existing.length > 0) {
        await db.update(reservationOperational)
          .set({ monitorId: input.monitorId, updatedBy: ctx.user.id })
          .where(eq(reservationOperational.id, existing[0].id));
      } else {
        await db.insert(reservationOperational).values({
          reservationId: input.reservationId,
          reservationType: "activity",
          monitorId: input.monitorId,
          updatedBy: ctx.user.id,
        });
      }
      return { ok: true };
    }),
});

// ─── MAIN OPERATIONS ROUTER ───────────────────────────────────────────────────
export const operationsRouter = router({
  monitors: monitorsRouter,
  calendar: calendarRouter,
  dailyOrders: dailyOrdersRouter,
  activities: activitiesRouter,
});
