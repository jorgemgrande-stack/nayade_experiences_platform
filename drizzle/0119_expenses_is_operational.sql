-- Distinción entre gastos OPERATIVOS y gastos SOLO FISCALES.
--
-- Hasta ahora todos los gastos registrados en `expenses` (y los generados
-- por `recurring_expenses`) sumaban por igual en TODOS los cálculos:
-- P&L, EBITDA, márgenes, executive summary, control diario, dashboards y
-- previsiones del Impuesto sobre Sociedades. Esto distorsiona el
-- rendimiento operativo cuando se registran gastos que existen solo a
-- efectos fiscales / tributarios (p.ej. gasolina de administradores,
-- gastos personales parcialmente deducibles, etc.).
--
-- Modelo conceptual:
--   isOperational = TRUE  → gasto real de explotación. Computa en TODO.
--   isOperational = FALSE → gasto "solo fiscal". Sigue computando en
--                            tributación (IVA, Modelo 303/200), gestoría,
--                            cashflow, tesorería y conciliación bancaria,
--                            pero NO en P&L operativo ni KPIs de negocio.
--
-- Decisión clave:
--   · DEFAULT TRUE en ambas tablas → compatibilidad total con datos
--     existentes (todo lo previo se mantiene como "operativo").
--   · NOT NULL para evitar lógica de fallback en backend/frontend.
--   · Aplicado también a `recurring_expenses` para que los gastos
--     generados por el cron hereden el tratamiento del recurrente.
--
-- Migración idempotente: ver scripts/apply-expenses-is-operational.cjs

ALTER TABLE `expenses`
  ADD COLUMN `isOperational` BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE `recurring_expenses`
  ADD COLUMN `isOperational` BOOLEAN NOT NULL DEFAULT TRUE;
