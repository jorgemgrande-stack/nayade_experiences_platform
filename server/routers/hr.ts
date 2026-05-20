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
import { eq, desc, asc, and, gte, lte, isNull, ne, sql, inArray } from "drizzle-orm";
import { randomBytes } from "crypto";
import {
  employees,
  employeeDocuments,
  monitorPayroll,
  users,
  hrTimeClock,
  hrScheduleTemplates,
  hrScheduleExceptions,
  hrPayslips,
  hrPayrollBatches,
  hrIrpfLedger,
  hrSsLedger,
  hrSettings,
  hrBonus,
  hrLeaveRequests,
  hrLeaveBalance,
  expenses,
  expenseCategories,
  costCenters,
} from "../../drizzle/schema";
import { sendEmail } from "../mailer";
import { getUserByInviteToken, setUserPassword } from "../db";
import { getDefaultCashAccountId, createCashMovementIfNotExists } from "./cashRegisterHelper";

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
    const rows = await db.select({
      isActive: employees.isActive,
      userId: employees.userId,
    }).from(employees);
    const active = rows.filter(r => r.isActive).length;
    const withPortalAccess = rows.filter(r => r.userId != null).length;
    return {
      total: rows.length,
      active,
      inactive: rows.length - active,
      withPortalAccess,
    };
  }),

  // ─── CRUD de empleado (Fase 10: migrado desde operations.monitors) ──

  /** Crear empleado. */
  create: hrViewProc
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
      contractType: z.enum(["indefinido", "temporal", "autonomo", "practicas", "otro"]).optional(),
      contractStart: z.string().optional(),
      contractEnd: z.string().optional(),
      contractConditions: z.string().optional(),
      position: z.string().optional(),
      department: z.string().optional(),
      weeklyHours: z.number().optional(),
      nss: z.string().optional(),
      irpfPercent: z.number().optional(),
      notes: z.string().optional(),
      isActive: z.boolean().default(true),
      photoUrl: z.string().optional(),
      photoKey: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const [result] = await db.insert(employees).values({
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
        position: input.position,
        department: input.department,
        weeklyHours: input.weeklyHours != null ? String(input.weeklyHours) : undefined,
        nss: input.nss,
        irpfPercent: input.irpfPercent != null ? String(input.irpfPercent) : undefined,
        notes: input.notes,
        isActive: input.isActive,
        photoUrl: input.photoUrl,
        photoKey: input.photoKey,
      } as any);
      return { ok: true, id: (result as { insertId: number }).insertId };
    }),

  /** Actualizar datos del empleado. */
  update: hrViewProc
    .input(z.object({
      id: z.number(),
      fullName: z.string().min(2).optional(),
      dni: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
      birthDate: z.string().nullable().optional(),
      emergencyName: z.string().optional(),
      emergencyRelation: z.string().optional(),
      emergencyPhone: z.string().optional(),
      iban: z.string().optional(),
      ibanHolder: z.string().optional(),
      contractType: z.enum(["indefinido", "temporal", "autonomo", "practicas", "otro"]).optional(),
      contractStart: z.string().nullable().optional(),
      contractEnd: z.string().nullable().optional(),
      contractConditions: z.string().optional(),
      position: z.string().optional(),
      department: z.string().optional(),
      weeklyHours: z.number().nullable().optional(),
      holidayDaysYear: z.number().nullable().optional(),
      nss: z.string().optional(),
      irpfPercent: z.number().nullable().optional(),
      costCenterId: z.number().nullable().optional(),
      notes: z.string().optional(),
      isActive: z.boolean().optional(),
      photoUrl: z.string().optional(),
      photoKey: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id } = input;
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      const setStr = (k: string, v: string | undefined) => { if (v !== undefined) patch[k] = v; };
      setStr("fullName", input.fullName);
      setStr("dni", input.dni);
      setStr("phone", input.phone);
      if (input.email !== undefined) patch.email = input.email || null;
      setStr("address", input.address);
      setStr("emergencyName", input.emergencyName);
      setStr("emergencyRelation", input.emergencyRelation);
      setStr("emergencyPhone", input.emergencyPhone);
      setStr("iban", input.iban);
      setStr("ibanHolder", input.ibanHolder);
      setStr("contractType", input.contractType);
      setStr("contractConditions", input.contractConditions);
      setStr("position", input.position);
      setStr("department", input.department);
      setStr("nss", input.nss);
      setStr("notes", input.notes);
      setStr("photoUrl", input.photoUrl);
      setStr("photoKey", input.photoKey);
      if (input.isActive !== undefined) patch.isActive = input.isActive;
      if (input.birthDate !== undefined) patch.birthDate = input.birthDate ? new Date(input.birthDate) : null;
      if (input.contractStart !== undefined) patch.contractStart = input.contractStart ? new Date(input.contractStart) : null;
      if (input.contractEnd !== undefined) patch.contractEnd = input.contractEnd ? new Date(input.contractEnd) : null;
      if (input.weeklyHours !== undefined) patch.weeklyHours = input.weeklyHours == null ? null : String(input.weeklyHours);
      if (input.irpfPercent !== undefined) patch.irpfPercent = input.irpfPercent == null ? null : String(input.irpfPercent);
      if (input.holidayDaysYear !== undefined) patch.holidayDaysYear = input.holidayDaysYear;
      if (input.costCenterId !== undefined) patch.costCenterId = input.costCenterId;

      await db.update(employees).set(patch).where(eq(employees.id, id));
      return { ok: true };
    }),

  /** Eliminar empleado. */
  delete: hrViewProc
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(employees).where(eq(employees.id, input.id));
      return { ok: true };
    }),

  /** Adjuntar documento al empleado. */
  addDocument: hrViewProc
    .input(z.object({
      employeeId: z.number(),
      type: z.enum(["dni", "contrato", "certificado", "prl", "formacion", "nomina_pdf", "baja_medica", "finiquito", "otro"]),
      name: z.string().min(1),
      fileUrl: z.string(),
      fileKey: z.string(),
      expiresAt: z.string().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.insert(employeeDocuments).values({
        monitorId: input.employeeId,
        type: input.type,
        name: input.name,
        fileUrl: input.fileUrl,
        fileKey: input.fileKey,
        expiresAt: input.expiresAt || null,
        uploadedBy: ctx.user.id,
      } as any);
      return { ok: true };
    }),

  /** Eliminar documento. */
  deleteDocument: hrViewProc
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(employeeDocuments).where(eq(employeeDocuments.id, input.id));
      return { ok: true };
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

  /**
   * Bonus del empleado actual (Fase 6) — solo los pagados, agrupados por mes.
   * No expone notas administrativas internas.
   */
  myBonuses: employeeProcedure.query(async ({ ctx }) => {
    const employee = await resolveCurrentEmployee(ctx.user.id);
    return await db
      .select({
        id: hrBonus.id,
        type: hrBonus.type,
        amount: hrBonus.amount,
        concept: hrBonus.concept,
        paidAt: hrBonus.paidAt,
        paymentMethod: hrBonus.paymentMethod,
      })
      .from(hrBonus)
      .where(and(
        eq(hrBonus.employeeId, employee.id),
        eq(hrBonus.status, "pagado"),
      ))
      .orderBy(desc(hrBonus.paidAt));
  }),

  /**
   * Nóminas del empleado actual (Fase 5).
   * Solo se exponen las que están en estado 'registrada' o 'pagada' —
   * los borradores administrativos no son visibles para el empleado.
   * No se expone ssCompanyEstimated (concepto puramente interno de coste).
   */
  myPayslips: employeeProcedure.query(async ({ ctx }) => {
    const employee = await resolveCurrentEmployee(ctx.user.id);
    const rows = await db
      .select({
        id: hrPayslips.id,
        period: hrPayslips.period,
        grossSalary: hrPayslips.grossSalary,
        irpfAmount: hrPayslips.irpfAmount,
        ssEmployee: hrPayslips.ssEmployee,
        netSalary: hrPayslips.netSalary,
        pdfUrl: hrPayslips.pdfUrl,
        status: hrPayslips.status,
        createdAt: hrPayslips.createdAt,
      })
      .from(hrPayslips)
      .where(and(
        eq(hrPayslips.employeeId, employee.id),
        ne(hrPayslips.status, "borrador"),
        ne(hrPayslips.status, "anulada"),
      ))
      .orderBy(desc(hrPayslips.period));
    return rows;
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
      .where(eq(hrScheduleExceptions.date, dateYmd)),
  ]);
  const applicable = excepts.filter(e => e.employeeId == null || e.employeeId === employeeId);
  if (applicable.length > 0) return 0;

  // Fase 8: una solicitud de ausencia APROBADA que cubra esta fecha también
  // anula el día teórico (vacaciones, baja, permiso). Evita generar N filas
  // en hr_schedule_exceptions: se consulta directamente hr_leave_requests.
  const [leaveOnDate] = await db.select({ id: hrLeaveRequests.id }).from(hrLeaveRequests)
    .where(and(
      eq(hrLeaveRequests.employeeId, employeeId),
      eq(hrLeaveRequests.status, "aprobada"),
      lte(hrLeaveRequests.fromDate, dateYmd),
      gte(hrLeaveRequests.toDate, dateYmd),
    ))
    .limit(1);
  if (leaveOnDate) return 0;

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

// ─── NÓMINAS Y REMESAS (Fase 5) ─────────────────────────────────────────────

const FISCAL_STATUSES = ["pendiente", "revisado", "exportado", "presentado"] as const;
const fiscalStatusEnum = z.enum(FISCAL_STATUSES);

/**
 * Devuelve la configuración global de RRHH. Si no existe la fila singleton
 * (improbable porque la migración la crea), la genera con defaults.
 */
async function getOrCreateHrSettings() {
  const [row] = await db.select().from(hrSettings).where(eq(hrSettings.id, 1)).limit(1);
  if (row) return row;
  await db.insert(hrSettings).values({ id: 1 } as any).onDuplicateKeyUpdate({ set: { id: 1 } });
  const [r2] = await db.select().from(hrSettings).where(eq(hrSettings.id, 1)).limit(1);
  return r2!;
}

/**
 * findOrCreate por nombre de categoría. Mantiene categorías propias del
 * módulo de RRHH cuando se cierra una remesa.
 */
async function findOrCreateExpenseCategory(name: string): Promise<number> {
  const [existing] = await db.select({ id: expenseCategories.id })
    .from(expenseCategories).where(eq(expenseCategories.name, name)).limit(1);
  if (existing) return existing.id;
  const [result] = await db.insert(expenseCategories).values({
    name,
    description: "Categoría auto-creada desde el módulo Personal/RRHH",
    active: true,
  } as any);
  return (result as { insertId: number }).insertId;
}

async function findOrCreateCostCenter(name: string): Promise<number> {
  const [existing] = await db.select({ id: costCenters.id })
    .from(costCenters).where(eq(costCenters.name, name)).limit(1);
  if (existing) return existing.id;
  const [result] = await db.insert(costCenters).values({
    name,
    description: "Centro de coste auto-creado desde Personal/RRHH",
    active: true,
  } as any);
  return (result as { insertId: number }).insertId;
}

// ─── PAYSLIPS (nóminas individuales) ──

const payslipInput = z.object({
  employeeId: z.number().int(),
  period: z.string().regex(/^\d{4}-\d{2}$/, "Periodo debe ser YYYY-MM"),
  grossSalary: z.number().min(0),
  irpfAmount: z.number().min(0).default(0),
  ssEmployee: z.number().min(0).default(0),
  notes: z.string().optional(),
});

async function upsertIrpfLedgerForPayslip(payslip: { id: number; employeeId: number; period: string; grossSalary: string | number; irpfAmount: string | number }) {
  const taxable = Number(payslip.grossSalary);
  const retained = Number(payslip.irpfAmount);
  // Buscar entry previa para esta nómina
  const [existing] = await db.select().from(hrIrpfLedger)
    .where(eq(hrIrpfLedger.payslipId, payslip.id))
    .limit(1);
  if (existing) {
    await db.update(hrIrpfLedger).set({
      taxableBase: String(taxable),
      retainedAmount: String(retained),
    } as any).where(eq(hrIrpfLedger.id, existing.id));
  } else if (retained > 0 || taxable > 0) {
    await db.insert(hrIrpfLedger).values({
      period: payslip.period,
      employeeId: payslip.employeeId,
      taxableBase: String(taxable),
      retainedAmount: String(retained),
      payslipId: payslip.id,
    } as any);
  }
}

const payslipsRouter = router({
  list: hrViewProc
    .input(z.object({
      period: z.string().optional(),
      employeeId: z.number().optional(),
      batchId: z.number().optional(),
      status: z.enum(["borrador", "registrada", "pagada", "anulada"]).optional(),
      fiscalStatus: fiscalStatusEnum.optional(),
    }).optional())
    .query(async ({ input }) => {
      const conditions: any[] = [];
      if (input?.period) conditions.push(eq(hrPayslips.period, input.period));
      if (input?.employeeId) conditions.push(eq(hrPayslips.employeeId, input.employeeId));
      if (input?.batchId) conditions.push(eq(hrPayslips.batchId, input.batchId));
      if (input?.status) conditions.push(eq(hrPayslips.status, input.status));
      if (input?.fiscalStatus) conditions.push(eq(hrPayslips.fiscalStatus, input.fiscalStatus));

      const rows = await db.select({
        id: hrPayslips.id,
        employeeId: hrPayslips.employeeId,
        employeeName: employees.fullName,
        period: hrPayslips.period,
        grossSalary: hrPayslips.grossSalary,
        irpfAmount: hrPayslips.irpfAmount,
        ssEmployee: hrPayslips.ssEmployee,
        netSalary: hrPayslips.netSalary,
        ssCompanyEstimated: hrPayslips.ssCompanyEstimated,
        batchId: hrPayslips.batchId,
        pdfUrl: hrPayslips.pdfUrl,
        status: hrPayslips.status,
        fiscalStatus: hrPayslips.fiscalStatus,
        createdAt: hrPayslips.createdAt,
        updatedAt: hrPayslips.updatedAt,
      })
        .from(hrPayslips)
        .leftJoin(employees, eq(employees.id, hrPayslips.employeeId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(hrPayslips.period), asc(employees.fullName));
      return rows;
    }),

  get: hrViewProc
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [row] = await db.select().from(hrPayslips).where(eq(hrPayslips.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  /**
   * Crea o actualiza una nómina por (employeeId, period). Calcula netSalary
   * y ssCompanyEstimated automáticamente con el porcentaje configurado.
   * Inserta/actualiza también la entry en hr_irpf_ledger.
   */
  upsert: hrViewProc
    .input(payslipInput)
    .mutation(async ({ input, ctx }) => {
      const settings = await getOrCreateHrSettings();
      const ssPct = Number(settings.ssCompanyPercent);
      const ssCompanyEst = parseFloat((input.grossSalary * ssPct / 100).toFixed(2));
      const net = parseFloat((input.grossSalary - input.irpfAmount - input.ssEmployee).toFixed(2));

      const [existing] = await db.select().from(hrPayslips)
        .where(and(eq(hrPayslips.employeeId, input.employeeId), eq(hrPayslips.period, input.period)))
        .limit(1);

      let payslipId: number;
      if (existing) {
        if (existing.batchId) {
          // Si la nómina ya está en una remesa cerrada, no permitir edición
          const [batch] = await db.select({ status: hrPayrollBatches.status })
            .from(hrPayrollBatches).where(eq(hrPayrollBatches.id, existing.batchId)).limit(1);
          if (batch && batch.status !== "open") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "No se puede editar una nómina cuya remesa ya está cerrada. Crea una remesa de ajuste.",
            });
          }
        }
        await db.update(hrPayslips).set({
          grossSalary: String(input.grossSalary),
          irpfAmount: String(input.irpfAmount),
          ssEmployee: String(input.ssEmployee),
          netSalary: String(net),
          ssCompanyEstimated: String(ssCompanyEst),
          notes: input.notes,
        } as any).where(eq(hrPayslips.id, existing.id));
        payslipId = existing.id;
      } else {
        const [result] = await db.insert(hrPayslips).values({
          employeeId: input.employeeId,
          period: input.period,
          grossSalary: String(input.grossSalary),
          irpfAmount: String(input.irpfAmount),
          ssEmployee: String(input.ssEmployee),
          netSalary: String(net),
          ssCompanyEstimated: String(ssCompanyEst),
          status: "registrada",
          notes: input.notes,
          createdBy: ctx.user.id,
        } as any);
        payslipId = (result as { insertId: number }).insertId;
      }

      const [payslip] = await db.select().from(hrPayslips).where(eq(hrPayslips.id, payslipId));
      await upsertIrpfLedgerForPayslip(payslip!);
      return { ok: true, id: payslipId };
    }),

  delete: hrViewProc
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const [existing] = await db.select().from(hrPayslips).where(eq(hrPayslips.id, input.id));
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.batchId) {
        const [batch] = await db.select({ status: hrPayrollBatches.status })
          .from(hrPayrollBatches).where(eq(hrPayrollBatches.id, existing.batchId)).limit(1);
        if (batch && batch.status !== "open") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No se puede borrar una nómina de una remesa cerrada." });
        }
      }
      await db.delete(hrIrpfLedger).where(eq(hrIrpfLedger.payslipId, input.id));
      await db.delete(hrPayslips).where(eq(hrPayslips.id, input.id));
      return { ok: true };
    }),

  /**
   * Adjuntar URL del PDF de la nómina (subida vía storage S3 desde el cliente).
   */
  attachPdf: hrViewProc
    .input(z.object({
      id: z.number(),
      pdfUrl: z.string().url(),
      pdfKey: z.string(),
    }))
    .mutation(async ({ input }) => {
      await db.update(hrPayslips).set({
        pdfUrl: input.pdfUrl,
        pdfKey: input.pdfKey,
      } as any).where(eq(hrPayslips.id, input.id));
      return { ok: true };
    }),

  /**
   * Carga masiva: array de { employeeId | dni, period, gross, irpf, ssEmployee }.
   * Devuelve report con ok/errores por fila.
   */
  bulkUpload: hrViewProc
    .input(z.object({
      period: z.string().regex(/^\d{4}-\d{2}$/),
      rows: z.array(z.object({
        employeeId: z.number().optional(),
        dni: z.string().optional(),
        grossSalary: z.number().min(0),
        irpfAmount: z.number().min(0).default(0),
        ssEmployee: z.number().min(0).default(0),
        notes: z.string().optional(),
      })).min(1).max(500),
    }))
    .mutation(async ({ input, ctx }) => {
      const settings = await getOrCreateHrSettings();
      const ssPct = Number(settings.ssCompanyPercent);
      const report: Array<{ row: number; ok: boolean; employeeId?: number; error?: string }> = [];

      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i];
        let empId = row.employeeId;
        try {
          if (!empId && row.dni) {
            const [found] = await db.select({ id: employees.id })
              .from(employees).where(eq(employees.dni, row.dni)).limit(1);
            if (!found) {
              report.push({ row: i + 1, ok: false, error: `Empleado con DNI ${row.dni} no encontrado` });
              continue;
            }
            empId = found.id;
          }
          if (!empId) {
            report.push({ row: i + 1, ok: false, error: "Falta employeeId o dni" });
            continue;
          }

          const ssCompanyEst = parseFloat((row.grossSalary * ssPct / 100).toFixed(2));
          const net = parseFloat((row.grossSalary - row.irpfAmount - row.ssEmployee).toFixed(2));

          const [existing] = await db.select({ id: hrPayslips.id, batchId: hrPayslips.batchId })
            .from(hrPayslips)
            .where(and(eq(hrPayslips.employeeId, empId), eq(hrPayslips.period, input.period)))
            .limit(1);

          if (existing?.batchId) {
            const [batch] = await db.select({ status: hrPayrollBatches.status })
              .from(hrPayrollBatches).where(eq(hrPayrollBatches.id, existing.batchId)).limit(1);
            if (batch && batch.status !== "open") {
              report.push({ row: i + 1, ok: false, employeeId: empId, error: "Nómina en remesa cerrada — usar remesa de ajuste" });
              continue;
            }
          }

          let payslipId: number;
          if (existing) {
            await db.update(hrPayslips).set({
              grossSalary: String(row.grossSalary),
              irpfAmount: String(row.irpfAmount),
              ssEmployee: String(row.ssEmployee),
              netSalary: String(net),
              ssCompanyEstimated: String(ssCompanyEst),
              notes: row.notes,
            } as any).where(eq(hrPayslips.id, existing.id));
            payslipId = existing.id;
          } else {
            const [r] = await db.insert(hrPayslips).values({
              employeeId: empId,
              period: input.period,
              grossSalary: String(row.grossSalary),
              irpfAmount: String(row.irpfAmount),
              ssEmployee: String(row.ssEmployee),
              netSalary: String(net),
              ssCompanyEstimated: String(ssCompanyEst),
              status: "registrada",
              notes: row.notes,
              createdBy: ctx.user.id,
            } as any);
            payslipId = (r as { insertId: number }).insertId;
          }

          const [payslip] = await db.select().from(hrPayslips).where(eq(hrPayslips.id, payslipId));
          await upsertIrpfLedgerForPayslip(payslip!);
          report.push({ row: i + 1, ok: true, employeeId: empId });
        } catch (e: any) {
          report.push({ row: i + 1, ok: false, employeeId: empId, error: e.message });
        }
      }

      const okCount = report.filter(r => r.ok).length;
      const errorCount = report.length - okCount;
      return { ok: errorCount === 0, okCount, errorCount, report };
    }),
});

// ─── BATCHES (remesas mensuales) ──

const batchesRouter = router({
  list: hrViewProc.query(async () => {
    return await db.select().from(hrPayrollBatches).orderBy(desc(hrPayrollBatches.period));
  }),

  get: hrViewProc
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [batch] = await db.select().from(hrPayrollBatches).where(eq(hrPayrollBatches.id, input.id));
      if (!batch) throw new TRPCError({ code: "NOT_FOUND" });
      const payslips = await db.select({
        id: hrPayslips.id,
        employeeId: hrPayslips.employeeId,
        employeeName: employees.fullName,
        grossSalary: hrPayslips.grossSalary,
        irpfAmount: hrPayslips.irpfAmount,
        ssEmployee: hrPayslips.ssEmployee,
        netSalary: hrPayslips.netSalary,
        ssCompanyEstimated: hrPayslips.ssCompanyEstimated,
        status: hrPayslips.status,
        pdfUrl: hrPayslips.pdfUrl,
      })
        .from(hrPayslips)
        .leftJoin(employees, eq(employees.id, hrPayslips.employeeId))
        .where(eq(hrPayslips.batchId, batch.id))
        .orderBy(asc(employees.fullName));
      return { ...batch, payslips };
    }),

  /**
   * Abre la remesa de un periodo. Idempotente: si ya existe, devuelve la
   * existente. No cambia el status de las nóminas (se vinculan al cerrar).
   */
  openMonth: hrViewProc
    .input(z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) }))
    .mutation(async ({ input, ctx }) => {
      const [existing] = await db.select().from(hrPayrollBatches)
        .where(eq(hrPayrollBatches.period, input.period))
        .limit(1);
      if (existing) {
        return { ok: true, id: existing.id, alreadyExists: true, status: existing.status };
      }
      const [result] = await db.insert(hrPayrollBatches).values({
        period: input.period,
        status: "open",
        createdBy: ctx.user.id,
      } as any);
      return { ok: true, id: (result as { insertId: number }).insertId, alreadyExists: false, status: "open" };
    }),

  /**
   * Cierra la remesa del periodo:
   *  1. Recalcula totales sumando todas las nóminas del periodo.
   *  2. Vincula las nóminas al batch (batchId).
   *  3. Genera 3 gastos automáticos (Nóminas oficiales, Retenciones IRPF,
   *     Seguridad Social empresa) en expenses, categorías auto-creadas.
   *  4. Inserta entry en hr_ss_ledger con la estimación inicial.
   *  5. Marca status='closed'.
   *
   * Idempotencia: si el batch ya está closed/exported, error explícito.
   */
  closeMonth: hrViewProc
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const [batch] = await db.select().from(hrPayrollBatches).where(eq(hrPayrollBatches.id, input.id));
      if (!batch) throw new TRPCError({ code: "NOT_FOUND" });
      if (batch.status !== "open") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `La remesa ya está ${batch.status}` });
      }

      // 1. Recoger nóminas del periodo no vinculadas o vinculadas al mismo batch
      const periodPayslips = await db.select().from(hrPayslips)
        .where(eq(hrPayslips.period, batch.period));
      if (periodPayslips.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No hay nóminas en este periodo. Añade nóminas antes de cerrar." });
      }

      // 2. Vincular las que no tengan batch aún
      for (const p of periodPayslips) {
        if (!p.batchId) {
          await db.update(hrPayslips).set({ batchId: batch.id } as any).where(eq(hrPayslips.id, p.id));
        }
      }

      // 3. Calcular totales
      const totalGross = periodPayslips.reduce((s, p) => s + Number(p.grossSalary), 0);
      const totalIrpf = periodPayslips.reduce((s, p) => s + Number(p.irpfAmount), 0);
      const totalSsEmp = periodPayslips.reduce((s, p) => s + Number(p.ssEmployee), 0);
      const totalNet = periodPayslips.reduce((s, p) => s + Number(p.netSalary), 0);
      const totalSsCompEst = periodPayslips.reduce((s, p) => s + Number(p.ssCompanyEstimated), 0);

      // 4. Auto-crear categoría y centro de coste si no existen
      const costCenterId = await findOrCreateCostCenter("Personal / RRHH");
      const catNominas = await findOrCreateExpenseCategory("Nóminas oficiales");
      const catIrpf = await findOrCreateExpenseCategory("Retenciones IRPF");
      const catSs = await findOrCreateExpenseCategory("Seguridad Social empresa");

      // 5. Crear 3 expenses
      const expenseDate = `${batch.period}-15`; // mid-month como fecha de imputación
      const createdExpenseIds: number[] = [];

      const expensesToCreate = [
        { categoryId: catNominas, concept: `Nóminas oficiales — ${batch.period}`, amount: totalNet },
        { categoryId: catIrpf, concept: `Retenciones IRPF — ${batch.period}`, amount: totalIrpf },
        { categoryId: catSs, concept: `Seguridad Social empresa (estimada) — ${batch.period}`, amount: totalSsCompEst },
      ];
      for (const e of expensesToCreate) {
        if (e.amount <= 0) continue;
        const [r] = await db.insert(expenses).values({
          date: expenseDate,
          concept: e.concept,
          amount: String(e.amount.toFixed(2)),
          categoryId: e.categoryId,
          costCenterId,
          paymentMethod: "transfer",
          status: "pending",
          source: "hr_payroll_batch",
          createdBy: ctx.user.id,
        } as any);
        createdExpenseIds.push((r as { insertId: number }).insertId);
      }

      // 6. Insertar/actualizar hr_ss_ledger del periodo
      const [existingSs] = await db.select().from(hrSsLedger).where(eq(hrSsLedger.period, batch.period)).limit(1);
      if (existingSs) {
        await db.update(hrSsLedger).set({
          estimatedAmount: String(totalSsCompEst),
          batchId: batch.id,
        } as any).where(eq(hrSsLedger.id, existingSs.id));
      } else {
        await db.insert(hrSsLedger).values({
          period: batch.period,
          estimatedAmount: String(totalSsCompEst),
          batchId: batch.id,
        } as any);
      }

      // 7. Marcar status closed + guardar totales y expense ids
      await db.update(hrPayrollBatches).set({
        status: "closed",
        totalGross: String(totalGross),
        totalIrpf: String(totalIrpf),
        totalSsEmployee: String(totalSsEmp),
        totalNet: String(totalNet),
        totalSsCompanyEstimated: String(totalSsCompEst),
        expenseIdsJson: JSON.stringify(createdExpenseIds),
        closedAt: new Date(),
        closedBy: ctx.user.id,
      } as any).where(eq(hrPayrollBatches.id, batch.id));

      return {
        ok: true,
        payslipsLinked: periodPayslips.length,
        totalGross, totalIrpf, totalSsEmp, totalNet, totalSsCompEst,
        expensesCreated: createdExpenseIds,
      };
    }),

  /**
   * Cuando llega el cargo real de la TGSS: ajusta hr_ss_ledger y registra
   * un expense de ajuste si hay diferencia positiva.
   */
  adjustSsReal: hrViewProc
    .input(z.object({
      batchId: z.number(),
      realAmount: z.number().min(0),
      realChargedAt: z.string().optional(),
      bankMovementId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [batch] = await db.select().from(hrPayrollBatches).where(eq(hrPayrollBatches.id, input.batchId));
      if (!batch) throw new TRPCError({ code: "NOT_FOUND" });

      await db.update(hrPayrollBatches).set({
        totalSsCompanyReal: String(input.realAmount),
      } as any).where(eq(hrPayrollBatches.id, batch.id));

      await db.update(hrSsLedger).set({
        realAmount: String(input.realAmount),
        realChargedAt: input.realChargedAt ? new Date(input.realChargedAt) : new Date(),
        bankMovementId: input.bankMovementId ?? null,
      } as any).where(eq(hrSsLedger.period, batch.period));

      // Si hay diferencia, crear gasto de ajuste
      const estimated = Number(batch.totalSsCompanyEstimated);
      const diff = input.realAmount - estimated;
      let adjustmentExpenseId: number | null = null;
      if (Math.abs(diff) >= 0.01) {
        const costCenterId = await findOrCreateCostCenter("Personal / RRHH");
        const cat = await findOrCreateExpenseCategory("Seguridad Social empresa — ajuste");
        const [r] = await db.insert(expenses).values({
          date: `${batch.period}-15`,
          concept: `Ajuste SS empresa real vs estimada — ${batch.period} (${diff >= 0 ? "+" : ""}${diff.toFixed(2)} €)`,
          amount: String(Math.abs(diff).toFixed(2)),
          categoryId: cat,
          costCenterId,
          paymentMethod: "transfer",
          status: "pending",
          source: "hr_ss_adjustment",
          notes: diff < 0 ? "Devolución (importe negativo conceptual)" : null,
          createdBy: ctx.user.id,
        } as any);
        adjustmentExpenseId = (r as { insertId: number }).insertId;
      }

      return { ok: true, difference: parseFloat(diff.toFixed(2)), adjustmentExpenseId };
    }),

  /**
   * Marca el batch como exportado (señal para Gestoría).
   */
  markExported: hrViewProc
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.update(hrPayrollBatches).set({
        status: "exported",
        fiscalStatus: "exportado",
      } as any).where(eq(hrPayrollBatches.id, input.id));
      // También propagamos a las nóminas del batch
      await db.update(hrPayslips).set({
        fiscalStatus: "exportado",
      } as any).where(eq(hrPayslips.batchId, input.id));
      // Y a las entries del ledger correspondientes
      const [batch] = await db.select().from(hrPayrollBatches).where(eq(hrPayrollBatches.id, input.id));
      if (batch) {
        await db.update(hrIrpfLedger).set({ fiscalStatus: "exportado" } as any)
          .where(eq(hrIrpfLedger.period, batch.period));
        await db.update(hrSsLedger).set({ fiscalStatus: "exportado" } as any)
          .where(eq(hrSsLedger.period, batch.period));
      }
      return { ok: true };
    }),
});

// ─── FISCAL LEDGERS ──

const fiscalRouter = router({
  irpfLedger: hrViewProc
    .input(z.object({
      period: z.string().optional(),
      employeeId: z.number().optional(),
      fiscalStatus: fiscalStatusEnum.optional(),
    }).optional())
    .query(async ({ input }) => {
      const conditions: any[] = [];
      if (input?.period) conditions.push(eq(hrIrpfLedger.period, input.period));
      if (input?.employeeId) conditions.push(eq(hrIrpfLedger.employeeId, input.employeeId));
      if (input?.fiscalStatus) conditions.push(eq(hrIrpfLedger.fiscalStatus, input.fiscalStatus));
      return await db.select({
        id: hrIrpfLedger.id,
        period: hrIrpfLedger.period,
        employeeId: hrIrpfLedger.employeeId,
        employeeName: employees.fullName,
        taxableBase: hrIrpfLedger.taxableBase,
        retainedAmount: hrIrpfLedger.retainedAmount,
        payslipId: hrIrpfLedger.payslipId,
        bonusId: hrIrpfLedger.bonusId,
        fiscalStatus: hrIrpfLedger.fiscalStatus,
        createdAt: hrIrpfLedger.createdAt,
      })
        .from(hrIrpfLedger)
        .leftJoin(employees, eq(employees.id, hrIrpfLedger.employeeId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(hrIrpfLedger.period));
    }),

  ssLedger: hrViewProc
    .input(z.object({ fiscalStatus: fiscalStatusEnum.optional() }).optional())
    .query(async ({ input }) => {
      const conditions: any[] = [];
      if (input?.fiscalStatus) conditions.push(eq(hrSsLedger.fiscalStatus, input.fiscalStatus));
      return await db.select().from(hrSsLedger)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(hrSsLedger.period));
    }),

  markIrpfStatus: hrViewProc
    .input(z.object({ ids: z.array(z.number()).min(1), status: fiscalStatusEnum }))
    .mutation(async ({ input }) => {
      let updated = 0;
      for (const id of input.ids) {
        await db.update(hrIrpfLedger).set({ fiscalStatus: input.status } as any).where(eq(hrIrpfLedger.id, id));
        updated++;
      }
      return { ok: true, updated };
    }),

  markSsStatus: hrViewProc
    .input(z.object({ ids: z.array(z.number()).min(1), status: fiscalStatusEnum }))
    .mutation(async ({ input }) => {
      let updated = 0;
      for (const id of input.ids) {
        await db.update(hrSsLedger).set({ fiscalStatus: input.status } as any).where(eq(hrSsLedger.id, id));
        updated++;
      }
      return { ok: true, updated };
    }),

  /**
   * Resumen trimestral del año (Fase 7 — preparación Gestoría).
   * Agrupa IRPF retenido y SS por trimestre natural. Pensado para
   * alimentar el Modelo 111 (IRPF trimestral) y el control de TC1/TC2.
   */
  quarterSummary: hrViewProc
    .input(z.object({ year: z.number().int().min(2020).max(2100) }))
    .query(async ({ input }) => {
      const yearPrefix = `${input.year}-`;
      const irpfRows = await db.select().from(hrIrpfLedger)
        .where(sql`${hrIrpfLedger.period} LIKE ${yearPrefix + "%"}`);
      const ssRows = await db.select().from(hrSsLedger)
        .where(sql`${hrSsLedger.period} LIKE ${yearPrefix + "%"}`);

      const quarterOf = (period: string) => {
        const m = Number(period.slice(5, 7));
        return Math.ceil(m / 3); // 1-4
      };

      const quarters = [1, 2, 3, 4].map(q => {
        const irpfQ = irpfRows.filter(r => quarterOf(r.period) === q);
        const ssQ = ssRows.filter(r => quarterOf(r.period) === q);
        const statusBreakdown = (rows: { fiscalStatus: string }[]) => ({
          pendiente: rows.filter(r => r.fiscalStatus === "pendiente").length,
          revisado: rows.filter(r => r.fiscalStatus === "revisado").length,
          exportado: rows.filter(r => r.fiscalStatus === "exportado").length,
          presentado: rows.filter(r => r.fiscalStatus === "presentado").length,
        });
        return {
          quarter: q,
          label: `T${q}`,
          irpfRetained: parseFloat(irpfQ.reduce((s, r) => s + Number(r.retainedAmount), 0).toFixed(2)),
          irpfTaxableBase: parseFloat(irpfQ.reduce((s, r) => s + Number(r.taxableBase), 0).toFixed(2)),
          irpfCount: irpfQ.length,
          irpfStatus: statusBreakdown(irpfQ),
          ssEstimated: parseFloat(ssQ.reduce((s, r) => s + Number(r.estimatedAmount), 0).toFixed(2)),
          ssReal: parseFloat(ssQ.reduce((s, r) => s + Number(r.realAmount ?? 0), 0).toFixed(2)),
          ssCount: ssQ.length,
          ssStatus: statusBreakdown(ssQ),
        };
      });

      return {
        year: input.year,
        quarters,
        yearIrpfRetained: parseFloat(irpfRows.reduce((s, r) => s + Number(r.retainedAmount), 0).toFixed(2)),
        yearSsEstimated: parseFloat(ssRows.reduce((s, r) => s + Number(r.estimatedAmount), 0).toFixed(2)),
        yearSsReal: parseFloat(ssRows.reduce((s, r) => s + Number(r.realAmount ?? 0), 0).toFixed(2)),
      };
    }),

  /**
   * Gastos laborales pendientes / pagados (Fase 7).
   * Filtra expenses con source en hr_payroll_batch / hr_bonus / hr_ss_adjustment.
   * Alimenta los KPIs de la sección Alertas del dashboard.
   */
  laborExpensesSummary: hrViewProc.query(async () => {
    const rows = await db.select({
      id: expenses.id,
      amount: expenses.amount,
      status: expenses.status,
      source: expenses.source,
    })
      .from(expenses)
      .where(inArray(expenses.source, ["hr_payroll_batch", "hr_bonus", "hr_ss_adjustment"]));

    const pending = rows.filter(r => r.status === "pending");
    const paid = rows.filter(r => r.status !== "pending");
    const sum = (rs: { amount: string | number }[]) => rs.reduce((s, r) => s + Number(r.amount), 0);

    return {
      pendingCount: pending.length,
      pendingAmount: parseFloat(sum(pending).toFixed(2)),
      paidCount: paid.length,
      paidAmount: parseFloat(sum(paid).toFixed(2)),
    };
  }),

  /**
   * Resumen del periodo: totales para alimentar HRDashboard sección
   * "Coste laboral".
   */
  summary: hrViewProc
    .input(z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() }).optional())
    .query(async ({ input }) => {
      const now = new Date();
      const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const period = input?.period ?? defaultPeriod;

      const monthPayslips = await db.select().from(hrPayslips).where(eq(hrPayslips.period, period));
      const totalGross = monthPayslips.reduce((s, p) => s + Number(p.grossSalary), 0);
      const totalIrpf = monthPayslips.reduce((s, p) => s + Number(p.irpfAmount), 0);
      const totalSsEst = monthPayslips.reduce((s, p) => s + Number(p.ssCompanyEstimated), 0);
      const totalNet = monthPayslips.reduce((s, p) => s + Number(p.netSalary), 0);

      // Acumulado anual
      const year = period.slice(0, 4);
      const yearPayslips = await db.select().from(hrPayslips)
        .where(sql`${hrPayslips.period} LIKE ${year + "-%"}`);
      const yearTotalCost = yearPayslips.reduce((s, p) =>
        s + Number(p.grossSalary) + Number(p.ssCompanyEstimated), 0);

      const [ssReal] = await db.select().from(hrSsLedger).where(eq(hrSsLedger.period, period)).limit(1);
      const ssRealAmount = ssReal?.realAmount ? Number(ssReal.realAmount) : null;

      return {
        period,
        payslipCount: monthPayslips.length,
        totalGross: parseFloat(totalGross.toFixed(2)),
        totalIrpf: parseFloat(totalIrpf.toFixed(2)),
        totalSsCompanyEstimated: parseFloat(totalSsEst.toFixed(2)),
        totalSsCompanyReal: ssRealAmount,
        totalNet: parseFloat(totalNet.toFixed(2)),
        totalCost: parseFloat((totalGross + totalSsEst).toFixed(2)),
        yearTotalCost: parseFloat(yearTotalCost.toFixed(2)),
      };
    }),
});

// ─── SETTINGS ──

const settingsRouter = router({
  get: hrViewProc.query(async () => await getOrCreateHrSettings()),

  update: hrViewProc
    .input(z.object({
      ssCompanyPercent: z.number().min(0).max(100).optional(),
      defaultHolidayDays: z.number().int().min(0).max(60).optional(),
      defaultWeeklyHours: z.number().min(0).max(80).optional(),
      irpfDefaultPercent: z.number().min(0).max(60).nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      await getOrCreateHrSettings(); // garantiza que existe
      const patch: any = {};
      if (input.ssCompanyPercent !== undefined) patch.ssCompanyPercent = String(input.ssCompanyPercent);
      if (input.defaultHolidayDays !== undefined) patch.defaultHolidayDays = input.defaultHolidayDays;
      if (input.defaultWeeklyHours !== undefined) patch.defaultWeeklyHours = String(input.defaultWeeklyHours);
      if (input.irpfDefaultPercent !== undefined) patch.irpfDefaultPercent = input.irpfDefaultPercent === null ? null : String(input.irpfDefaultPercent);
      if (Object.keys(patch).length === 0) return { ok: true, noChanges: true };
      await db.update(hrSettings).set(patch).where(eq(hrSettings.id, 1));
      return { ok: true };
    }),
});

// ─── BONUS E INCENTIVOS (Fase 6) ────────────────────────────────────────────

const BONUS_TYPES = ["bonus", "comision", "prima", "gratificacion", "anticipo", "ajuste"] as const;
const bonusTypeEnum = z.enum(BONUS_TYPES);

/**
 * Upsert de entry en hr_irpf_ledger para un bonus con retención IRPF.
 * Se llama al marcar el bonus como pagado para que el periodo coincida con
 * la fecha de pago (no la fecha de creación).
 */
async function upsertIrpfLedgerForBonus(bonus: {
  id: number; employeeId: number; paidAt: Date | null; amount: string | number; irpfAmount: string | number;
}) {
  const retained = Number(bonus.irpfAmount);
  if (retained <= 0) {
    // Si en algún momento se quita el IRPF, limpia el ledger.
    await db.delete(hrIrpfLedger).where(eq(hrIrpfLedger.bonusId, bonus.id));
    return;
  }
  if (!bonus.paidAt) return;
  const period = `${bonus.paidAt.getFullYear()}-${String(bonus.paidAt.getMonth() + 1).padStart(2, "0")}`;
  const taxable = Number(bonus.amount);

  const [existing] = await db.select().from(hrIrpfLedger).where(eq(hrIrpfLedger.bonusId, bonus.id)).limit(1);
  if (existing) {
    await db.update(hrIrpfLedger).set({
      period,
      taxableBase: String(taxable),
      retainedAmount: String(retained),
    } as any).where(eq(hrIrpfLedger.id, existing.id));
  } else {
    await db.insert(hrIrpfLedger).values({
      period,
      employeeId: bonus.employeeId,
      taxableBase: String(taxable),
      retainedAmount: String(retained),
      bonusId: bonus.id,
    } as any);
  }
}

const bonusInput = z.object({
  employeeId: z.number().int(),
  type: bonusTypeEnum.default("bonus"),
  amount: z.number().min(0),
  irpfAmount: z.number().min(0).default(0),
  concept: z.string().min(1).max(256),
  notes: z.string().optional(),
});

const bonusRouter = router({
  list: hrViewProc
    .input(z.object({
      employeeId: z.number().optional(),
      status: z.enum(["pendiente", "pagado", "anulado"]).optional(),
      type: bonusTypeEnum.optional(),
      period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      fiscalStatus: fiscalStatusEnum.optional(),
    }).optional())
    .query(async ({ input }) => {
      const conditions: any[] = [];
      if (input?.employeeId) conditions.push(eq(hrBonus.employeeId, input.employeeId));
      if (input?.status) conditions.push(eq(hrBonus.status, input.status));
      if (input?.type) conditions.push(eq(hrBonus.type, input.type));
      if (input?.fiscalStatus) conditions.push(eq(hrBonus.fiscalStatus, input.fiscalStatus));
      if (input?.period) {
        // Filtra por mes de paid_at, o por createdAt si no se ha pagado
        const [y, m] = input.period.split("-").map(Number);
        const start = new Date(y, m - 1, 1);
        const end = new Date(y, m, 1);
        conditions.push(sql`(
          (${hrBonus.paidAt} IS NOT NULL AND ${hrBonus.paidAt} >= ${start} AND ${hrBonus.paidAt} < ${end})
          OR (${hrBonus.paidAt} IS NULL AND ${hrBonus.createdAt} >= ${start} AND ${hrBonus.createdAt} < ${end})
        )`);
      }

      const rows = await db.select({
        id: hrBonus.id,
        employeeId: hrBonus.employeeId,
        employeeName: employees.fullName,
        type: hrBonus.type,
        amount: hrBonus.amount,
        irpfAmount: hrBonus.irpfAmount,
        concept: hrBonus.concept,
        notes: hrBonus.notes,
        paidAt: hrBonus.paidAt,
        paymentMethod: hrBonus.paymentMethod,
        expenseId: hrBonus.expenseId,
        status: hrBonus.status,
        fiscalStatus: hrBonus.fiscalStatus,
        createdAt: hrBonus.createdAt,
      })
        .from(hrBonus)
        .leftJoin(employees, eq(employees.id, hrBonus.employeeId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(hrBonus.createdAt));
      return rows;
    }),

  get: hrViewProc
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [row] = await db.select().from(hrBonus).where(eq(hrBonus.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  /**
   * Crear bonus pendiente (sin pagar todavía).
   */
  create: hrViewProc
    .input(bonusInput)
    .mutation(async ({ input, ctx }) => {
      const [result] = await db.insert(hrBonus).values({
        employeeId: input.employeeId,
        type: input.type,
        amount: String(input.amount),
        irpfAmount: String(input.irpfAmount),
        concept: input.concept,
        notes: input.notes,
        status: "pendiente",
        createdBy: ctx.user.id,
      } as any);
      return { ok: true, id: (result as { insertId: number }).insertId };
    }),

  /**
   * Editar bonus. Solo permitido si status == 'pendiente'.
   */
  update: hrViewProc
    .input(z.object({
      id: z.number(),
      type: bonusTypeEnum.optional(),
      amount: z.number().min(0).optional(),
      irpfAmount: z.number().min(0).optional(),
      concept: z.string().min(1).max(256).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const [existing] = await db.select().from(hrBonus).where(eq(hrBonus.id, input.id));
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.status !== "pendiente") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Solo se pueden editar bonus pendientes. Anula y crea uno nuevo si es necesario." });
      }
      const patch: any = {};
      if (input.type !== undefined) patch.type = input.type;
      if (input.amount !== undefined) patch.amount = String(input.amount);
      if (input.irpfAmount !== undefined) patch.irpfAmount = String(input.irpfAmount);
      if (input.concept !== undefined) patch.concept = input.concept;
      if (input.notes !== undefined) patch.notes = input.notes;
      if (Object.keys(patch).length === 0) return { ok: true, noChanges: true };
      await db.update(hrBonus).set(patch).where(eq(hrBonus.id, input.id));
      return { ok: true };
    }),

  /**
   * Borrar bonus. Solo permitido si status == 'pendiente'. Para bonus pagados
   * usar 'cancel' (que conserva trazabilidad).
   */
  delete: hrViewProc
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const [existing] = await db.select().from(hrBonus).where(eq(hrBonus.id, input.id));
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.status !== "pendiente") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Solo se pueden borrar bonus pendientes. Para los pagados usa 'Anular'." });
      }
      await db.delete(hrBonus).where(eq(hrBonus.id, input.id));
      return { ok: true };
    }),

  /**
   * Anular bonus pagado — preserva fila + expense + cash_movement por
   * auditoría. Cambia status a 'anulado'.
   */
  cancel: hrViewProc
    .input(z.object({ id: z.number(), reason: z.string().optional() }))
    .mutation(async ({ input }) => {
      const [existing] = await db.select().from(hrBonus).where(eq(hrBonus.id, input.id));
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.status === "anulado") return { ok: true, alreadyCancelled: true };
      await db.update(hrBonus).set({
        status: "anulado",
        notes: input.reason
          ? `${existing.notes ?? ""}\n[Anulado] ${input.reason}`.trim()
          : existing.notes,
      } as any).where(eq(hrBonus.id, input.id));
      return { ok: true };
    }),

  /**
   * Marcar como pagado. Punto crítico de integración con Contabilidad y Caja.
   *
   *   payment_method=cash     → crea expense paymentMethod=cash
   *                             + cash_movement (vía helper idempotente)
   *   payment_method=transfer → crea expense paymentMethod=transfer
   *   payment_method=payroll  → NO crea expense (se incluye en payslip)
   *
   * Idempotente: si ya está pagado, error explícito. Re-llamar no duplica.
   */
  markPaid: hrViewProc
    .input(z.object({
      id: z.number(),
      paymentMethod: z.enum(["cash", "transfer", "payroll"]),
      paidAt: z.string().optional(), // ISO; default = ahora
      includedInPayslipId: z.number().optional(), // solo si payment_method=payroll
    }))
    .mutation(async ({ input, ctx }) => {
      const [bonus] = await db.select().from(hrBonus).where(eq(hrBonus.id, input.id));
      if (!bonus) throw new TRPCError({ code: "NOT_FOUND" });
      if (bonus.status === "pagado") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este bonus ya está pagado." });
      }
      if (bonus.status === "anulado") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No se puede pagar un bonus anulado." });
      }

      const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
      const [emp] = await db.select({ fullName: employees.fullName })
        .from(employees).where(eq(employees.id, bonus.employeeId)).limit(1);
      const empName = emp?.fullName ?? `Empleado #${bonus.employeeId}`;

      let expenseId: number | null = null;
      let cashMovementCreated = false;

      if (input.paymentMethod === "cash" || input.paymentMethod === "transfer") {
        // 1. Crear expense
        const costCenterId = await findOrCreateCostCenter("Personal / RRHH");
        const categoryId = await findOrCreateExpenseCategory("Bonus e Incentivos");

        const expenseDate = `${paidAt.getFullYear()}-${String(paidAt.getMonth() + 1).padStart(2, "0")}-${String(paidAt.getDate()).padStart(2, "0")}`;
        const concept = `${bonus.type.charAt(0).toUpperCase()}${bonus.type.slice(1)} — ${empName} · ${bonus.concept}`;

        const [r] = await db.insert(expenses).values({
          date: expenseDate,
          concept,
          amount: bonus.amount,
          categoryId,
          costCenterId,
          paymentMethod: input.paymentMethod,
          status: "pending",
          source: "hr_bonus",
          notes: bonus.notes,
          createdBy: ctx.user.id,
        } as any);
        expenseId = (r as { insertId: number }).insertId;

        // 2. Si es cash, disparar cash_movement vía helper idempotente.
        //    El expense es la fuente de verdad: relatedEntityType='expense'.
        if (input.paymentMethod === "cash") {
          try {
            const cashAccountId = await getDefaultCashAccountId();
            if (cashAccountId) {
              const result = await createCashMovementIfNotExists({
                accountId: cashAccountId,
                date: expenseDate,
                type: "expense",
                amount: Number(bonus.amount),
                concept: `Pago en efectivo — ${concept}`,
                relatedEntityType: "expense",
                relatedEntityId: expenseId,
                createdBy: ctx.user.id,
              });
              cashMovementCreated = result.created;
            }
          } catch (e) {
            console.warn("[hr.bonus.markPaid] cash_movement no creado:", e);
            // No bloqueamos el flujo; el expense queda creado y el cash
            // movement se puede crear manualmente desde el módulo Caja.
          }
        }
      }
      // Nota: si paymentMethod=payroll, no se crea expense aquí. El admin
      // debe incluir el importe manualmente en grossSalary del payslip al
      // que apunte includedInPayslipId. En fases futuras esto puede
      // automatizarse en hr.payslips.upsert.

      // 3. Actualizar el bonus
      await db.update(hrBonus).set({
        status: "pagado",
        paidAt,
        paymentMethod: input.paymentMethod,
        expenseId,
        includedInPayslipId: input.paymentMethod === "payroll" ? (input.includedInPayslipId ?? null) : null,
      } as any).where(eq(hrBonus.id, input.id));

      // 4. Ledger IRPF si hay retención
      const [updated] = await db.select().from(hrBonus).where(eq(hrBonus.id, input.id));
      if (updated) await upsertIrpfLedgerForBonus(updated);

      return {
        ok: true,
        expenseId,
        cashMovementCreated,
        paymentMethod: input.paymentMethod,
      };
    }),

  /**
   * Resumen agregado del mes/año para HRDashboard.
   */
  summary: hrViewProc
    .input(z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() }).optional())
    .query(async ({ input }) => {
      const now = new Date();
      const period = input?.period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const [y, m] = period.split("-").map(Number);
      const monthStart = new Date(y, m - 1, 1);
      const monthEnd = new Date(y, m, 1);
      const yearStart = new Date(y, 0, 1);
      const yearEnd = new Date(y + 1, 0, 1);

      const monthRows = await db.select().from(hrBonus)
        .where(and(
          gte(hrBonus.paidAt, monthStart),
          lte(hrBonus.paidAt, monthEnd),
          ne(hrBonus.status, "anulado"),
        ));
      const yearRows = await db.select().from(hrBonus)
        .where(and(
          gte(hrBonus.paidAt, yearStart),
          lte(hrBonus.paidAt, yearEnd),
          ne(hrBonus.status, "anulado"),
        ));
      const pendingRows = await db.select({ id: hrBonus.id, amount: hrBonus.amount })
        .from(hrBonus).where(eq(hrBonus.status, "pendiente"));

      const sum = (rs: { amount: string | number }[]) => rs.reduce((s, r) => s + Number(r.amount), 0);
      const cashRows = monthRows.filter(r => r.paymentMethod === "cash");

      return {
        period,
        totalMonth: parseFloat(sum(monthRows).toFixed(2)),
        cashMonth: parseFloat(sum(cashRows).toFixed(2)),
        totalYear: parseFloat(sum(yearRows).toFixed(2)),
        pendingCount: pendingRows.length,
        pendingAmount: parseFloat(sum(pendingRows).toFixed(2)),
        monthCount: monthRows.length,
      };
    }),
});

// ─── VACACIONES Y PERMISOS (Fase 8) ─────────────────────────────────────────

/** Días naturales inclusive entre dos fechas YYYY-MM-DD. */
function daysBetweenInclusive(fromYmd: string, toYmd: string): number {
  const from = new Date(`${fromYmd}T00:00:00`);
  const to = new Date(`${toYmd}T00:00:00`);
  const diff = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
  return diff + 1;
}

/**
 * Calcula el saldo de vacaciones de un empleado para un año:
 *  accrued  — días asignados (hr_leave_balance, o defaultHolidayDays si no hay fila)
 *  taken    — días de solicitudes 'vacaciones' APROBADAS del año
 *  pending  — días de solicitudes 'vacaciones' PENDIENTES del año
 *  available = accrued - taken - pending
 */
async function computeLeaveBalance(employeeId: number, year: number) {
  const [balanceRow] = await db.select().from(hrLeaveBalance)
    .where(and(eq(hrLeaveBalance.employeeId, employeeId), eq(hrLeaveBalance.year, year)))
    .limit(1);

  let accrued: number;
  if (balanceRow) {
    accrued = Number(balanceRow.accruedDays);
  } else {
    const settings = await getOrCreateHrSettings();
    accrued = settings.defaultHolidayDays;
  }

  const requests = await db.select().from(hrLeaveRequests)
    .where(and(
      eq(hrLeaveRequests.employeeId, employeeId),
      eq(hrLeaveRequests.type, "vacaciones"),
    ));
  const ofYear = requests.filter(r => r.fromDate.startsWith(`${year}-`));
  const taken = ofYear.filter(r => r.status === "aprobada").reduce((s, r) => s + Number(r.days), 0);
  const pending = ofYear.filter(r => r.status === "pendiente").reduce((s, r) => s + Number(r.days), 0);

  return {
    year,
    accrued,
    taken: parseFloat(taken.toFixed(1)),
    pending: parseFloat(pending.toFixed(1)),
    available: parseFloat((accrued - taken - pending).toFixed(1)),
  };
}

const leavesRouter = router({
  // ── EMPLEADO ──
  /** Solicitar vacaciones / permiso desde el Portal. */
  request: employeeProcedure
    .input(z.object({
      type: z.enum(["vacaciones", "asuntos_propios", "baja_medica", "permiso", "otro"]).default("vacaciones"),
      fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const employee = await resolveCurrentEmployee(ctx.user.id);
      if (input.toDate < input.fromDate) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "La fecha de fin no puede ser anterior a la de inicio." });
      }
      const days = daysBetweenInclusive(input.fromDate, input.toDate);

      // Aviso de saldo insuficiente solo para vacaciones (no bloquea — lo decide el admin)
      const [result] = await db.insert(hrLeaveRequests).values({
        employeeId: employee.id,
        type: input.type,
        fromDate: input.fromDate,
        toDate: input.toDate,
        days: String(days),
        status: "pendiente",
        reason: input.reason,
      } as any);
      return { ok: true, id: (result as { insertId: number }).insertId, days };
    }),

  /** Mis solicitudes (del empleado autenticado). */
  listMine: employeeProcedure.query(async ({ ctx }) => {
    const employee = await resolveCurrentEmployee(ctx.user.id);
    return await db.select().from(hrLeaveRequests)
      .where(eq(hrLeaveRequests.employeeId, employee.id))
      .orderBy(desc(hrLeaveRequests.fromDate));
  }),

  /** Mi saldo de vacaciones del año en curso. */
  myBalance: employeeProcedure
    .input(z.object({ year: z.number().int().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const employee = await resolveCurrentEmployee(ctx.user.id);
      const year = input?.year ?? new Date().getFullYear();
      return await computeLeaveBalance(employee.id, year);
    }),

  /** Cancelar una solicitud propia que aún esté pendiente. */
  cancelMine: employeeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const employee = await resolveCurrentEmployee(ctx.user.id);
      const [req] = await db.select().from(hrLeaveRequests).where(eq(hrLeaveRequests.id, input.id));
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });
      if (req.employeeId !== employee.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Esta solicitud no es tuya." });
      }
      if (req.status !== "pendiente") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Solo puedes cancelar solicitudes pendientes." });
      }
      await db.update(hrLeaveRequests).set({ status: "cancelada" } as any).where(eq(hrLeaveRequests.id, input.id));
      return { ok: true };
    }),

  // ── ADMIN ──
  /** Todas las solicitudes con filtros. */
  listAll: hrViewProc
    .input(z.object({
      employeeId: z.number().optional(),
      status: z.enum(["pendiente", "aprobada", "rechazada", "cancelada"]).optional(),
      type: z.enum(["vacaciones", "asuntos_propios", "baja_medica", "permiso", "otro"]).optional(),
      year: z.number().int().optional(),
    }).optional())
    .query(async ({ input }) => {
      const conditions: any[] = [];
      if (input?.employeeId) conditions.push(eq(hrLeaveRequests.employeeId, input.employeeId));
      if (input?.status) conditions.push(eq(hrLeaveRequests.status, input.status));
      if (input?.type) conditions.push(eq(hrLeaveRequests.type, input.type));
      if (input?.year) conditions.push(sql`${hrLeaveRequests.fromDate} LIKE ${input.year + "-%"}`);

      return await db.select({
        id: hrLeaveRequests.id,
        employeeId: hrLeaveRequests.employeeId,
        employeeName: employees.fullName,
        type: hrLeaveRequests.type,
        fromDate: hrLeaveRequests.fromDate,
        toDate: hrLeaveRequests.toDate,
        days: hrLeaveRequests.days,
        status: hrLeaveRequests.status,
        reason: hrLeaveRequests.reason,
        decisionReason: hrLeaveRequests.decisionReason,
        approvedBy: hrLeaveRequests.approvedBy,
        approvedAt: hrLeaveRequests.approvedAt,
        createdAt: hrLeaveRequests.createdAt,
      })
        .from(hrLeaveRequests)
        .leftJoin(employees, eq(employees.id, hrLeaveRequests.employeeId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(hrLeaveRequests.createdAt));
    }),

  /** Aprobar una solicitud — registra approvedBy + approvedAt (trazabilidad). */
  approve: hrViewProc
    .input(z.object({ id: z.number(), decisionReason: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const [req] = await db.select().from(hrLeaveRequests).where(eq(hrLeaveRequests.id, input.id));
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });
      if (req.status !== "pendiente") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `La solicitud ya está ${req.status}.` });
      }
      await db.update(hrLeaveRequests).set({
        status: "aprobada",
        approvedBy: ctx.user.id,
        approvedAt: new Date(),
        decisionReason: input.decisionReason ?? null,
      } as any).where(eq(hrLeaveRequests.id, input.id));
      return { ok: true };
    }),

  /** Rechazar una solicitud — exige motivo, registra trazabilidad. */
  reject: hrViewProc
    .input(z.object({ id: z.number(), decisionReason: z.string().min(1, "Indica el motivo del rechazo") }))
    .mutation(async ({ input, ctx }) => {
      const [req] = await db.select().from(hrLeaveRequests).where(eq(hrLeaveRequests.id, input.id));
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });
      if (req.status !== "pendiente") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `La solicitud ya está ${req.status}.` });
      }
      await db.update(hrLeaveRequests).set({
        status: "rechazada",
        approvedBy: ctx.user.id,
        approvedAt: new Date(),
        decisionReason: input.decisionReason,
      } as any).where(eq(hrLeaveRequests.id, input.id));
      return { ok: true };
    }),

  /** Saldo de un empleado (admin). */
  balanceForEmployee: hrViewProc
    .input(z.object({ employeeId: z.number(), year: z.number().int().optional() }))
    .query(async ({ input }) => {
      const year = input.year ?? new Date().getFullYear();
      return await computeLeaveBalance(input.employeeId, year);
    }),

  /** Asignar días de vacaciones de un empleado para un año (upsert). */
  setBalance: hrViewProc
    .input(z.object({
      employeeId: z.number(),
      year: z.number().int(),
      accruedDays: z.number().min(0).max(99),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const [existing] = await db.select().from(hrLeaveBalance)
        .where(and(eq(hrLeaveBalance.employeeId, input.employeeId), eq(hrLeaveBalance.year, input.year)))
        .limit(1);
      if (existing) {
        await db.update(hrLeaveBalance).set({
          accruedDays: String(input.accruedDays),
          notes: input.notes,
        } as any).where(eq(hrLeaveBalance.id, existing.id));
      } else {
        await db.insert(hrLeaveBalance).values({
          employeeId: input.employeeId,
          year: input.year,
          accruedDays: String(input.accruedDays),
          notes: input.notes,
        } as any);
      }
      return { ok: true };
    }),

  /** KPIs agregados para HRDashboard. */
  summary: hrViewProc.query(async () => {
    const all = await db.select({
      id: hrLeaveRequests.id,
      type: hrLeaveRequests.type,
      days: hrLeaveRequests.days,
      status: hrLeaveRequests.status,
    }).from(hrLeaveRequests);

    const pending = all.filter(r => r.status === "pendiente");
    const approved = all.filter(r => r.status === "aprobada");
    const vacApproved = approved.filter(r => r.type === "vacaciones");
    const permApproved = approved.filter(r => r.type !== "vacaciones");

    return {
      pendingCount: pending.length,
      pendingDays: parseFloat(pending.reduce((s, r) => s + Number(r.days), 0).toFixed(1)),
      vacationsApprovedCount: vacApproved.length,
      vacationsApprovedDays: parseFloat(vacApproved.reduce((s, r) => s + Number(r.days), 0).toFixed(1)),
      permitsApprovedCount: permApproved.length,
    };
  }),
});

export const hrRouter = router({
  employees: employeesRouter,
  portal: portalRouter,
  timeClock: timeClockRouter,
  schedule: scheduleRouter,
  payslips: payslipsRouter,
  batches: batchesRouter,
  fiscal: fiscalRouter,
  settings: settingsRouter,
  bonus: bonusRouter,
  leaves: leavesRouter,
});
