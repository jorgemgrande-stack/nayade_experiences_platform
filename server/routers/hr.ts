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
import { eq, desc, asc } from "drizzle-orm";
import { randomBytes } from "crypto";
import {
  employees,
  employeeDocuments,
  monitorPayroll,
  users,
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

export const hrRouter = router({
  employees: employeesRouter,
  portal: portalRouter,
});
