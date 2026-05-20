# Módulo Personal / RRHH — Náyade Experiences

Documentación técnica del módulo de Recursos Humanos. Construido en 9 fases
(migraciones `0100`–`0110`).

---

## 1. Decisión arquitectural clave

La tabla física MySQL se llama **`monitors`** y NO se renombró, para preservar
la relación `reservation_operational.monitor_id` que usa el módulo de
Operaciones. En `drizzle/schema.ts` se aliasa:

```ts
export const employees = monitors;          // mismo objeto, alias semántico
export const employeeDocuments = monitorDocuments;
```

El código nuevo del módulo usa `employees`. Toda la gestión (alta, edición,
documentos, foto, eliminación) se hace en `/admin/personal/*` — el módulo es
100% autónomo (Fase 10). La ruta histórica `/admin/operaciones/monitores`
redirige a `/admin/personal/empleados`. El router `operations.monitors`
conserva solo `list`/`get` (lecturas que usan Calendario y Actividades).

> **Migración de fotos y documentos:** la subida de archivos usa los
> endpoints REST `/api/upload/monitor-photo` y `/api/upload/monitor-doc`
> (devuelven `{ url, key }`). Son genéricos y se mantienen.

---

## 2. Tablas

| Tabla | Migración | Propósito |
|---|---|---|
| `monitors` (+ columnas RRHH) | 0100 | Ficha de empleado: puesto, departamento, jornada, NSS, IRPF%, centro de coste |
| `monitor_documents` (enum ampliado) | 0101 | Documentos: dni, contrato, prl, formación, nómina_pdf, baja_médica, finiquito… |
| `hr_time_clock` | 0103 | Fichajes entrada/salida |
| `hr_schedule_templates` | 0104 | Calendario laboral teórico semanal |
| `hr_schedule_exceptions` | 0104 | Festivos / bajas / permisos del calendario teórico |
| `hr_payslips` | 0105 | Nóminas oficiales (UNIQUE por empleado+periodo) |
| `hr_payroll_batches` | 0106 | Remesas mensuales |
| `hr_irpf_ledger` | 0107 | Libro fiscal de IRPF retenido |
| `hr_ss_ledger` | 0107 | Libro fiscal de Seguridad Social (estimada + real) |
| `hr_settings` | 0108 | Configuración singleton (% SS empresa, días vacaciones…) |
| `hr_bonus` | 0109 | Bonus e incentivos |
| `hr_leave_requests` | 0110 | Solicitudes de vacaciones y permisos |
| `hr_leave_balance` | 0110 | Días de vacaciones asignados por empleado y año |

`users.role` admite el rol **`employee`** (migración 0102) para el Portal del Empleado.

---

## 3. Router tRPC — `server/routers/hr.ts`

Router `hr` con sub-routers:

- **`hr.employees`** — list, get, counters, create, update, delete, addDocument, deleteDocument, createPortalAccess, revokePortalAccess
- **`hr.portal`** — activate (público), me, myDocuments, myPayslips, myBonuses (rol employee)
- **`hr.timeClock`** — clockIn, clockOut, myCurrent, myList, list, summary, adminCorrect, adminCreate
- **`hr.schedule`** — listForEmployee, listExceptions, myTheoreticalToday
- **`hr.payslips`** — list, get, upsert, delete, attachPdf, bulkUpload
- **`hr.batches`** — list, get, openMonth, closeMonth, adjustSsReal, markExported
- **`hr.fiscal`** — irpfLedger, ssLedger, markIrpfStatus, markSsStatus, quarterSummary, laborExpensesSummary, summary
- **`hr.settings`** — get, update
- **`hr.bonus`** — list, get, create, update, delete, cancel, markPaid, summary
- **`hr.leaves`** — request, listMine, myBalance, cancelMine, listAll, approve, reject, balanceForEmployee, setBalance, summary

### Permisos
- Endpoints de administración: `permissionProcedure("hr.view", ["admin"])`.
- Endpoints del portal: `employeeProcedure` (roles `employee` y `monitor`) — resuelven
  el empleado vía `monitors.user_id = ctx.user.id`. **Nunca** aceptan un `employeeId`
  del cliente.
- Activación de cuenta: `publicProcedure` con token de invitación.

---

## 4. Rutas

### Administración (`/admin/personal/*`, rol admin)
| Ruta | Pantalla |
|---|---|
| `/admin/personal` | Dashboard RRHH |
| `/admin/personal/empleados` | Listado de empleados |
| `/admin/personal/empleados/:id` | Ficha de empleado (tabs) |
| `/admin/personal/fichajes` | Registro horario global |
| `/admin/personal/nominas` | Nóminas |
| `/admin/personal/remesas` · `/remesas/:id` | Remesas mensuales |
| `/admin/personal/bonus` | Bonus e incentivos |
| `/admin/personal/vacaciones` | Vacaciones y permisos |
| `/admin/personal/fiscal` | Libros fiscales (IRPF / SS) |
| `/admin/personal/configuracion` | Configuración del módulo |

### Portal del Empleado (`/empleado/*`, rol employee)
| Ruta | Pantalla |
|---|---|
| `/empleado` | Dashboard personal |
| `/empleado/fichar` | Fichaje entrada/salida |
| `/empleado/perfil` | Mi perfil |
| `/empleado/nominas` | Mis nóminas + bonus |
| `/empleado/vacaciones` | Mis vacaciones |
| `/empleado/documentos` | Mis documentos |
| `/empleado/activar?token=…` | Activación de cuenta (pública) |

---

## 5. Integraciones

### Contabilidad → Gastos
Al **cerrar una remesa** (`hr.batches.closeMonth`) se generan automáticamente
3 `expenses` con `source = "hr_payroll_batch"`: Nóminas oficiales, Retenciones
IRPF y Seguridad Social empresa. Categorías y centro de coste "Personal / RRHH"
se auto-crean si no existen.

### Caja
Los **bonus en efectivo** (`hr.bonus.markPaid` con `payment_method=cash`) crean
un `expense` y, mediante `createCashMovementIfNotExists`, un movimiento en
`fin_cash_movements`. El expense es la **única fuente de verdad**; el helper es
idempotente, evitando duplicidades.

### Registro horario ↔ Vacaciones
`theoreticalHoursForDate` consulta `hr_leave_requests`: una ausencia **aprobada**
que cubra una fecha anula las horas teóricas de ese día.

---

## 6. Preparación para Gestoría e Impuestos

Los libros `hr_irpf_ledger` y `hr_ss_ledger` se alimentan automáticamente desde
nóminas (Fase 5) y bonus con retención (Fase 6). Cada registro tiene
`fiscal_status` con el flujo `pendiente → revisado → exportado → presentado`.
La pantalla `/admin/personal/fiscal` permite el marcado masivo y la exportación
CSV (Modelo 111/190, TC1/TC2).

---

## 7. Migraciones

Las migraciones se aplican con scripts idempotentes
`scripts/apply-hr-fase*.cjs` vía `railway run --service MySQL node …` y se
registran manualmente en `__drizzle_migrations` y `drizzle/meta/_journal.json`.
Ver convención en el propio repositorio.

Verificación de integridad de datos: `scripts/verify-hr-integrity.cjs`.

---

## 8. Estado

Módulo completo (Fases 1–9). Todas las migraciones aplicadas en producción.
Pendiente, fuera de alcance:
- Migración `0098` (drop de tablas legacy `commercial_communications`) — aplazada.
- UI de gestión del calendario teórico (`hr_schedule_templates`) — las tablas y
  endpoints existen; falta pantalla de edición.
