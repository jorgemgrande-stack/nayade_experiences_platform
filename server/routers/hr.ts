/**
 * HR Router — Personal / RRHH
 *
 * Fase 1: lectura sobre `monitors` (alias `employees`).
 * Fase 3: portal del empleado (invite/activate + endpoints del propio empleado).
 *
 * Las mutaciones administrativas (create/update/delete/documentos/payroll)
 * siguen pasando por `operations.monitors.*` durante esta fase. Se moverán
 * tab a tab en fases posteriores.
 */

import { z } from "zod";
import { router, permissionProcedure, publicProcedure, employeeProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { eq, desc, asc, and, gte, lte, isNull, ne, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import {
  employees,
  employeeDocuments,
  monitorPayroll,
  users,
  hrTimeClock,
  hrScheduleTemplates,
  hrScheduleExceptions,
} from "../../drizzle/schema";
import { sendEmail } from "../mailer";
import { getUserByInviteToken, setUserPassword } from "../db";

// Permisos: lecturas RRHH accesibles para admin (con fallback a rol legacy).
const hrViewProc = permissionProcedure("hr.view", ["admin"]);

const pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const db = drizzle(pool);

// ─── EMPLOYEES (lecturas + portal access management) ─────────────────────────
const employeesRouter = router({
  /**
   * Lista de empleados. Misma fuente que operations.monitors.list.
   */
  list: hrViewProc
    .input(z.object({
      search: z.string().optional(),
      isActive: z.boolean().optional(),
      department: z.string().optional(),
      position: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const rows = await db.select().from(employees).orderBy(asc(employees.fullName));
      let result = rows;
      if (input.isActive !== undefined) {
        result = result.filter(e => e.isActive === input.isActive);
      }
      if (input.department) {
        const dep = input.department.toLowerCase();
        result = result.filter(e => (e.department ?? "").toLowerCase() === dep);
      }
      if (input.position) {
        const pos = input.position.toLowerCase();
        result = result.filter(e => (e.position ?? "").toLowerCase() === pos);
      }
      if (input.search) {
        const q = input.search.toLowerCase();
        result = result.filter(e =>
          e.fullName.toLowerCase().includes(q) ||
          (e.email ?? "").toLowerCase().includes(q) ||
          (e.phone ?? "").includes(q) ||
          (e.position ?? "").toLowerCase().includes(q) ||
          (e.department ?? "").toLowerCase().includes(q)
        );
      }
      return result;
    }),

  /**
   * Detalle de empleado incluyendo documentos, nóminas legacy
   * y estado del acceso al portal.
   */
  get: hrViewProc
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [employee] = await db.select().from(employees).where(eq(employees.id, input.id));
      if (!employee) throw new TRPCError({ code: "NOT_FOUND", message: "Empleado no encontrado" });

      const documents = await db.select().from(employeeDocuments)
        .where(eq(employeeDocuments.monitorId, input.id))
        .orderBy(desc(employeeDocuments.createdAt));
      const payrolls = await db.select().from(monitorPayroll)
        .where(eq(monitorPayroll.monitorId, input.id))
        .orderBy(desc(monitorPayroll.year), desc(monitorPayroll.month));

      // Estado del acceso al portal (sin exponer el token)
      let portalAccess: {
        userId: number;
        email: string | null;
        inviteAccepted: boolean;
        invitePending: boolean;
        isActive: boolean;
      } | null = null;
      if (employee.userId) {
        const [u] = await db.select({
          id: users.id,
          email: users.email,
          inviteAccepted: users.inviteAccepted,
          inviteToken: users.inviteToken,
          isActive: users.isActive,
        }).from(users).where(eq(users.id, employee.userId)).limit(1);
        if (u) {
          portalAccess = {
            userId: u.id,
            email: u.email,
            inviteAccepted: !!u.inviteAccepted,
            invitePending: !!u.inviteToken && !u.inviteAccepted,
            isActive: !!u.isActive,
          };
        }
      }

      return { ...employee, documents, payrolls, portalAccess };
    }),

  counters: hrViewProc.query(async () => {
    const rows = await db.select({ isActive: employees.isActive }).from(employees);
    const active = rows.filter(r => r.isActive).length;
    return {
      total: rows.length,
      active,
      inactive: rows.length - active,
    };
  }),

  /**
   * Crear acceso al Portal del Empleado.
   * Patrón clonado de partners.inviteUser: token + expiry 7 días, envío
   * opcional de email. Vincula monitors.user_id ↔ users.id.
   */
  createPortalAccess: hrViewProc
    .input(z.object({
      employeeId: z.number().int(),
      sendEmailNow: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const [employee] = await db
        .select()
        .from(employees)
        .where(eq(employees.id, input.employeeId))
        .limit(1);
      if (!employee) throw new TRPCError({ code: "NOT_FOUND", message: "Empleado no encontrado" });
      if (!employee.email) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El empleado no tiene email — añádelo antes de crear acceso al portal",
        });
      }

      const token = randomBytes(32).toString("hex");
      const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 días

      // ¿Existe ya un user con ese email?
      const [existing] = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.email, employee.email))
        .limit(1);

      let userId: number;
      if (existing) {
        // Reutilizar el user existente: re-emitir token y ascender a rol employee
        await db.update(users)
          .set({
            role: "employee" as any,
            inviteToken: token,
            inviteTokenExpiry: expiry,
            inviteAccepted: false,
          } as any)
          .where(eq(users.id, existing.id));
        userId = existing.id;
      } else {
        // Crear user pendiente de activación
        await db.insert(users).values({
          openId: `invite_${token.slice(0, 16)}`,
          name: employee.fullName,
          email: employee.email,
          role: "employee" as any,
          inviteToken: token,
          inviteTokenExpiry: expiry,
          inviteAccepted: false,
          isActive: false,
          lastSignedIn: new Date(),
        } as any);
        const [created] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, employee.email))
          .limit(1);
        if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo crear el usuario" });
        userId = created.id;
      }

      // Vincular monitor → user
      await db.update(employees)
        .set({ userId } as any)
        .where(eq(employees.id, employee.id));

      // URL de activación
      const origin = process.env.APP_URL ?? "https://www.nayadeexperiences.es";
      const inviteUrl = `${origin}/empleado/activar?token=${token}`;

      let emailSent = false;
      if (input.sendEmailNow) {
        try {
          await sendEmail({
            to: employee.email,
            subject: "Acceso al Portal del Empleado — Náyade Experiences",
            html: `
              <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;">
                <h2 style="color:#ea580c">Bienvenido al Portal del Empleado</h2>
                <p>Hola <strong>${employee.fullName}</strong>,</p>
                <p>Te damos acceso al portal interno de <strong>Náyade Experiences</strong> donde podrás consultar
                tu información personal, documentos y futuras funcionalidades (fichaje, nóminas, vacaciones).</p>
                <p style="margin:24px 0">
                  <a href="${inviteUrl}" style="background:#ea580c;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">
                    Activar mi cuenta
                  </a>
                </p>
                <p style="color:#666;font-size:13px">Este enlace caduca en 7 días. Si no funciona, copia y pega esta URL en tu navegador:<br>${inviteUrl}</p>
              </div>
            `,
          });
          emailSent = true;
        } catch (e) {
          console.warn("[hr.createPortalAccess] Email no enviado:", e);
        }
      }

      return {
        ok: true,
        userId,
        inviteUrl,
        emailSent,
        emailRequested: input.sendEmailNow,
      };
    }),

  /**
   * Revocar acceso al Portal. Desvincula el user del empleado y lo desactiva.
   * No elimina el row de users (puede tener historia/auditoría). El admin
   * puede reemitir un token nuevo más tarde.
   */
  revokePortalAccess: hrViewProc
    .input(z.object({ employeeId: z.number().int() }))
    .mutation(async ({ input }) => {
      const [employee] = await db
        .select({ id: employees.id, userId: employees.userId })
        .from(employees)
        .where(eq(employees.id, input.employeeId))
        .limit(1);
      if (!employee) throw new TRPCError({ code: "NOT_FOUND" });
      if (!employee.userId) return { ok: true, alreadyRevoked: true };

      await db.update(users)
        .set({
          role: "user" as any,
          isActive: false,
          inviteToken: null,
          inviteTokenExpiry: null,
        } as any)
        .where(eq(users.id, employee.userId));

      await db.update(employees)
        .set({ userId: null } as any)
        .where(eq(employees.id, employee.id));

      return { ok: true };
    }),
});

// ─── PORTAL DEL EMPLEADO ─────────────────────────────────────────────────────

/**
 * Resuelve el monitor/empleado asociado al usuario autenticado.
 * Lanza FORBIDDEN si el usuario no tiene un row de monitors enlazado.
 */
async function resolveCurrentEmployee(userId: number) {
  const [emp] = await db
    .select()
    .from(employees)
    .where(eq(employees.userId, userId))
    .limit(1);
  if (!emp) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Tu usuario no está vinculado a ningún empleado",
    });
  }
  return emp;
}

const portalRouter = router({
  /**
   * Activar invitación al Portal del Empleado.
   * Patrón idéntico a partners.activateInvite — publicProcedure porque el
   * usuario aún no tiene sesión cuando entra desde el link del email.
   */
  activate: publicProcedure
    .input(z.object({
      token: z.string(),
      password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
    }))
    .mutation(async ({ input }) => {
      const user = await getUserByInviteToken(input.token);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Enlace inválido o ya utilizado" });
      if (user.inviteTokenExpiry && new Date() > user.inviteTokenExpiry) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El enlace ha expirado. Solicita uno nuevo al administrador." });
      }
      // Verificación adicional de seguridad: solo activar si el rol es 'employee' o 'monitor'
      if (!["employee", "monitor"].includes(user.role as string)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Este enlace no corresponde al Portal del Empleado" });
      }

      const bcrypt = await import("bcryptjs");
      const passwordHash = await bcrypt.hash(input.password, 12);
      await setUserPassword(user.id, passwordHash); // limpia token + sets inviteAccepted=true
      await db.update(users).set({ isActive: true } as any).where(eq(users.id, user.id));

      return { ok: true, name: user.name };
    }),

  /**
   * Datos del empleado actual (perfil propio).
   * SEGURIDAD: filtra por ctx.user.id — nunca acepta employeeId del cliente.
   */
  me: employeeProcedure.query(async ({ ctx }) => {
    const employee = await resolveCurrentEmployee(ctx.user.id);
    // No exponer datos sensibles administrativos (irpfPercent, costCenterId, etc.)
    // En esta fase devolvemos todo lo que el empleado puede ver de sí mismo
    // — incluye contrato y datos personales, pero no salario ni IRPF.
    const {
      irpfPercent: _irpf,
      costCenterId: _cc,
      ...safe
    } = employee;
    return safe;
  }),

  /**
   * Documentos del empleado actual.
   */
  myDocuments: employeeProcedure.query(async ({ ctx }) => {
    const employee = await resolveCurrentEmployee(ctx.user.id);
    const docs = await db
      .select({
        id: employeeDocuments.id,
        type: employeeDocuments.type,
        name: employeeDocuments.name,
        fileUrl: employeeDocuments.fileUrl,
        expiresAt: employeeDocuments.expiresAt,
        signedByEmployeeAt: employeeDocuments.signedByEmployeeAt,
        createdAt: employeeDocuments.createdAt,
      })
      .from(employeeDocuments)
      .where(eq(employeeDocuments.monitorId, employee.id))
      .orderBy(desc(employeeDocuments.createdAt));
    return docs;
  }),
});

// ─── REGISTRO HORARIO (Fase 4) ──────────────────────────────────────────────

/**
 * Calcula horas teóricas para una fecha y empleado a partir de los tramos
 * recurrentes en hr_schedule_templates. Tiene en cuenta excepciones (festivos,
 * vacaciones, etc.) en hr_schedule_exceptions. Devuelve horas decimales.
 *
 * Si el empleado no tiene calendario teórico cargado, devuelve null.
 */
async function theoreticalHoursForDate(employeeId: number, dateYmd: string): Promise<number | null> {
  // Excepción global o personal anula el día entero
  const [excepts] = await Promise.all([
    db.select().from(hrScheduleExceptions)
      .where(and(
        eq(hrScheduleExceptions.date, dateYmd),
        // Aceptamos global (employeeId NULL) o personal del empleado
      )),
  ]);
  const applicable = excepts.filter(e => e.employeeId == null || e.employeeId === employeeId);
  if (applicable.length > 0) return 0;

  const weekday = new Date(`${dateYmd}T12:00:00`).getDay();
  const tramos = await db.select().from(hrScheduleTemplates)
    .where(and(
      eq(hrScheduleTemplates.employeeId, employeeId),
      eq(hrScheduleTemplates.weekday, weekday),
    ));
  const valid = tramos.filter(t => {
    if (t.validFrom && t.validFrom > dateYmd) return false;
    if (t.validUntil && t.validUntil < dateYmd) return false;
    return true;
  });
  if (valid.length === 0) return null;

  let total = 0;
  for (const t of valid) {
    const [h1, m1] = t.startTime.split(":").map(Number);
    const [h2, m2] = t.endTime.split(":").map(Number);
    total += ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60;
  }
  return total;
}

/**
 * Diferencia en horas entre dos timestamps. clockOut nulo => 0.
 */
function workedHours(row: { clockInAt: Date | null; clockOutAt: Date | null }): number {
  if (!row.clockInAt || !row.clockOutAt) return 0;
  const ms = row.clockOutAt.getTime() - row.clockInAt.getTime();
  if (ms <= 0) return 0;
  return ms / (1000 * 60 * 60);
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const timeClockRouter = router({
  /**
   * EMPLEADO: fichar entrada. Si el empleado ya tiene un fichaje 'open',
   * devuelve ese mismo (idempotente — evita duplicados al doble-clic).
   */
  clockIn: employeeProcedure
    .input(z.object({ notes: z.string().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const employee = await resolveCurrentEmployee(ctx.user.id);

      const [openExisting] = await db.select().from(hrTimeClock)
        .where(and(
          eq(hrTimeClock.employeeId, employee.id),
          eq(hrTimeClock.status, "open"),
        ))
        .orderBy(desc(hrTimeClock.clockInAt))
        .limit(1);
      if (openExisting) {
        return { ok: true, id: openExisting.id, alreadyOpen: true, clockInAt: openExisting.clockInAt };
      }

      const now = new Date();
      const [result] = await db.insert(hrTimeClock).values({
        employeeId: employee.id,
        clockInAt: now,
        source: "portal",
        status: "open",
        notes: input?.notes,
      } as any);
      const id = (result as { insertId: number }).insertId;
      return { ok: true, id, alreadyOpen: false, clockInAt: now };
    }),

  /**
   * EMPLEADO: fichar salida. Cierra el fichaje 'open' más reciente.
   * Si no hay ninguno abierto, error explícito.
   */
  clockOut: employeeProcedure
    .input(z.object({ notes: z.string().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const employee = await resolveCurrentEmployee(ctx.user.id);

      const [open] = await db.select().from(hrTimeClock)
        .where(and(
          eq(hrTimeClock.employeeId, employee.id),
          eq(hrTimeClock.status, "open"),
        ))
        .orderBy(desc(hrTimeClock.clockInAt))
        .limit(1);
      if (!open) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No tienes ningún fichaje abierto. Ficha entrada primero.",
        });
      }

      const now = new Date();
      await db.update(hrTimeClock)
        .set({
          clockOutAt: now,
          status: "closed",
          notes: input?.notes ?? open.notes,
        } as any)
        .where(eq(hrTimeClock.id, open.id));

      const minutes = Math.round((now.getTime() - open.clockInAt.getTime()) / (1000 * 60));
      return { ok: true, id: open.id, clockOutAt: now, durationMinutes: minutes };
    }),

  /**
   * EMPLEADO: fichaje abierto actual (si existe) — para mostrar el botón
   * correcto en el portal.
   */
  myCurrent: employeeProcedure.query(async ({ ctx }) => {
    const employee = await resolveCurrentEmployee(ctx.user.id);
    const [open] = await db.select().from(hrTimeClock)
      .where(and(
        eq(hrTimeClock.employeeId, employee.id),
        eq(hrTimeClock.status, "open"),
      ))
      .orderBy(desc(hrTimeClock.clockInAt))
      .limit(1);
    return open ?? null;
  }),

  /**
   * EMPLEADO: últimos N fichajes del propio empleado.
   */
  myList: employeeProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(30) }).optional())
    .query(async ({ ctx, input }) => {
      const employee = await resolveCurrentEmployee(ctx.user.id);
      const rows = await db.select().from(hrTimeClock)
        .where(eq(hrTimeClock.employeeId, employee.id))
        .orderBy(desc(hrTimeClock.clockInAt))
        .limit(input?.limit ?? 30);
      return rows.map(r => ({
        ...r,
        durationMinutes: r.clockInAt && r.clockOutAt
          ? Math.round((r.clockOutAt.getTime() - r.clockInAt.getTime()) / (1000 * 60))
          : null,
      }));
    }),

  /**
   * ADMIN: listado global con filtros opcionales.
   */
  list: hrViewProc
    .input(z.object({
      employeeId: z.number().optional(),
      dateFrom: z.string().optional(), // YYYY-MM-DD
      dateTo: z.string().optional(),
      status: z.enum(["open", "closed", "incomplete", "edited", "cancelled"]).optional(),
      limit: z.number().min(1).max(500).default(100),
    }))
    .query(async ({ input }) => {
      const conditions: any[] = [];
      if (input.employeeId) conditions.push(eq(hrTimeClock.employeeId, input.employeeId));
      if (input.status) conditions.push(eq(hrTimeClock.status, input.status));
      if (input.dateFrom) conditions.push(gte(hrTimeClock.clockInAt, new Date(`${input.dateFrom}T00:00:00`)));
      if (input.dateTo) conditions.push(lte(hrTimeClock.clockInAt, new Date(`${input.dateTo}T23:59:59`)));

      const rows = await db.select({
        id: hrTimeClock.id,
        employeeId: hrTimeClock.employeeId,
        employeeName: employees.fullName,
        clockInAt: hrTimeClock.clockInAt,
        clockOutAt: hrTimeClock.clockOutAt,
        source: hrTimeClock.source,
        status: hrTimeClock.status,
        notes: hrTimeClock.notes,
        createdBy: hrTimeClock.createdBy,
        updatedBy: hrTimeClock.updatedBy,
        createdAt: hrTimeClock.createdAt,
        updatedAt: hrTimeClock.updatedAt,
      })
        .from(hrTimeClock)
        .leftJoin(employees, eq(employees.id, hrTimeClock.employeeId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(hrTimeClock.clockInAt))
        .limit(input.limit);

      return rows.map(r => ({
        ...r,
        durationMinutes: r.clockInAt && r.clockOutAt
          ? Math.round((r.clockOutAt.getTime() - r.clockInAt.getTime()) / (1000 * 60))
          : null,
      }));
    }),

  /**
   * ADMIN: KPIs agregados para HRDashboard.
   */
  summary: hrViewProc.query(async () => {
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [workingNow, todayRows, monthRows, incomplete] = await Promise.all([
      db.select({ id: hrTimeClock.id, employeeId: hrTimeClock.employeeId, employeeName: employees.fullName, clockInAt: hrTimeClock.clockInAt })
        .from(hrTimeClock)
        .leftJoin(employees, eq(employees.id, hrTimeClock.employeeId))
        .where(eq(hrTimeClock.status, "open")),
      db.select({ clockInAt: hrTimeClock.clockInAt, clockOutAt: hrTimeClock.clockOutAt })
        .from(hrTimeClock)
        .where(and(
          gte(hrTimeClock.clockInAt, startOfDay),
          ne(hrTimeClock.status, "cancelled"),
        )),
      db.select({ clockInAt: hrTimeClock.clockInAt, clockOutAt: hrTimeClock.clockOutAt })
        .from(hrTimeClock)
        .where(and(
          gte(hrTimeClock.clockInAt, startOfMonth),
          ne(hrTimeClock.status, "cancelled"),
        )),
      db.select({ id: hrTimeClock.id })
        .from(hrTimeClock)
        .where(eq(hrTimeClock.status, "incomplete")),
    ]);

    const hoursToday = todayRows.reduce((s, r) => s + workedHours(r as any), 0);
    const hoursMonth = monthRows.reduce((s, r) => s + workedHours(r as any), 0);

    return {
      workingNow: workingNow.map(w => ({
        id: w.id,
        employeeId: w.employeeId,
        employeeName: w.employeeName,
        clockInAt: w.clockInAt,
      })),
      workingNowCount: workingNow.length,
      hoursToday: parseFloat(hoursToday.toFixed(2)),
      hoursMonth: parseFloat(hoursMonth.toFixed(2)),
      incompleteCount: incomplete.length,
    };
  }),

  /**
   * ADMIN: corrección de fichaje. Cualquier cambio queda registrado vía
   * updated_by y el status pasa a 'edited' para auditoría.
   */
  adminCorrect: hrViewProc
    .input(z.object({
      id: z.number(),
      clockInAt: z.string().optional(),  // ISO datetime
      clockOutAt: z.string().nullable().optional(),
      status: z.enum(["open", "closed", "incomplete", "edited", "cancelled"]).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [existing] = await db.select().from(hrTimeClock)
        .where(eq(hrTimeClock.id, input.id));
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      const patch: any = { updatedBy: ctx.user.id };
      if (input.clockInAt !== undefined) patch.clockInAt = new Date(input.clockInAt);
      if (input.clockOutAt !== undefined) patch.clockOutAt = input.clockOutAt ? new Date(input.clockOutAt) : null;
      if (input.notes !== undefined) patch.notes = input.notes;
      // Si admin no fuerza un status explícito, marcar como 'edited' (audit trail)
      patch.status = input.status ?? "edited";

      await db.update(hrTimeClock).set(patch).where(eq(hrTimeClock.id, input.id));
      return { ok: true };
    }),

  /**
   * ADMIN: crear fichaje manualmente (p.ej. el empleado olvidó fichar).
   */
  adminCreate: hrViewProc
    .input(z.object({
      employeeId: z.number(),
      clockInAt: z.string(),
      clockOutAt: z.string().nullable().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const clockOut = input.clockOutAt ? new Date(input.clockOutAt) : null;
      const [result] = await db.insert(hrTimeClock).values({
        employeeId: input.employeeId,
        clockInAt: new Date(input.clockInAt),
        clockOutAt: clockOut,
        source: "admin",
        status: clockOut ? "edited" : "open",
        notes: input.notes,
        createdBy: ctx.user.id,
        updatedBy: ctx.user.id,
      } as any);
      return { ok: true, id: (result as { insertId: number }).insertId };
    }),
});

// ─── CALENDARIO TEÓRICO (Fase 4 — soporte, sin UI propia todavía) ───────────

const scheduleRouter = router({
  listForEmployee: hrViewProc
    .input(z.object({ employeeId: z.number() }))
    .query(async ({ input }) => {
      const tramos = await db.select().from(hrScheduleTemplates)
        .where(eq(hrScheduleTemplates.employeeId, input.employeeId))
        .orderBy(asc(hrScheduleTemplates.weekday), asc(hrScheduleTemplates.startTime));
      return tramos;
    }),

  listExceptions: hrViewProc
    .input(z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      employeeId: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const conditions: any[] = [];
      if (input.dateFrom) conditions.push(gte(hrScheduleExceptions.date, input.dateFrom));
      if (input.dateTo) conditions.push(lte(hrScheduleExceptions.date, input.dateTo));
      if (input.employeeId !== undefined) {
        // Devuelve excepciones globales (employeeId IS NULL) y personales del empleado
        conditions.push(sql`(${hrScheduleExceptions.employeeId} IS NULL OR ${hrScheduleExceptions.employeeId} = ${input.employeeId})`);
      }
      return await db.select().from(hrScheduleExceptions)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(asc(hrScheduleExceptions.date));
    }),

  myTheoreticalToday: employeeProcedure.query(async ({ ctx }) => {
    const employee = await resolveCurrentEmployee(ctx.user.id);
    const today = ymd(new Date());
    const h = await theoreticalHoursForDate(employee.id, today);
    return { date: today, hours: h };
  }),
});

export const hrRouter = router({
  employees: employeesRouter,
  portal: portalRouter,
  timeClock: timeClockRouter,
  schedule: scheduleRouter,
});
