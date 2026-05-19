/**
 * HR Router — Personal / RRHH
 *
 * Fase 1: capa de lectura segura sobre la tabla física `monitors`
 * (aliasada como `employees` en TypeScript). Las mutaciones siguen
 * pasando por `operations.monitors.*` durante esta fase para no
 * duplicar lógica ni romper consumidores existentes.
 *
 * En fases posteriores se moverán las mutaciones aquí y se ampliará
 * con sub-routers para fichajes, nóminas, bonus, vacaciones, etc.
 */

import { z } from "zod";
import { router, permissionProcedure } from "../_core/trpc";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { eq, desc, asc } from "drizzle-orm";
import {
  employees,
  employeeDocuments,
  monitorPayroll,
} from "../../drizzle/schema";

// Permisos: lecturas RRHH accesibles para admin (con fallback a rol legacy).
// hr.view se introduce en Fase 1 como permiso nuevo del sistema RBAC.
const hrViewProc = permissionProcedure("hr.view", ["admin"]);

const pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const db = drizzle(pool);

const employeesRouter = router({
  /**
   * Lista de empleados. Misma fuente que `operations.monitors.list` —
   * apunta a la misma tabla MySQL `monitors`.
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
   * Detalle de empleado incluyendo documentos y nóminas legacy.
   */
  get: hrViewProc
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [employee] = await db.select().from(employees).where(eq(employees.id, input.id));
      if (!employee) throw new Error("Empleado no encontrado");
      const documents = await db.select().from(employeeDocuments)
        .where(eq(employeeDocuments.monitorId, input.id))
        .orderBy(desc(employeeDocuments.createdAt));
      const payrolls = await db.select().from(monitorPayroll)
        .where(eq(monitorPayroll.monitorId, input.id))
        .orderBy(desc(monitorPayroll.year), desc(monitorPayroll.month));
      return { ...employee, documents, payrolls };
    }),

  /**
   * Contadores básicos para el dashboard RRHH (Fase 2 los ampliará).
   */
  counters: hrViewProc.query(async () => {
    const rows = await db.select({ isActive: employees.isActive }).from(employees);
    const active = rows.filter(r => r.isActive).length;
    return {
      total: rows.length,
      active,
      inactive: rows.length - active,
    };
  }),
});

export const hrRouter = router({
  employees: employeesRouter,
});
