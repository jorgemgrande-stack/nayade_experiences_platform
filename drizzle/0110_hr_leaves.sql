-- Fase 8 RRHH — Vacaciones y Permisos.
--
-- hr_leave_requests: solicitudes de vacaciones / permisos / bajas.
--   El empleado las crea desde el Portal; el admin las aprueba o rechaza.
--   Trazabilidad: approved_by + approved_at registran quién y cuándo decidió.
--   days = días naturales del rango (inclusive), calculados en el servidor.
--
-- hr_leave_balance: días de vacaciones asignados (accrued) por empleado y año.
--   Los días disfrutados (taken) y solicitados (pending) NO se almacenan —
--   se calculan en vivo desde hr_leave_requests para evitar desincronización.
--   UNIQUE (employee_id, year): un saldo por empleado y ejercicio.

CREATE TABLE IF NOT EXISTS `hr_leave_requests` (
  `id` int AUTO_INCREMENT NOT NULL,
  `employee_id` int NOT NULL,
  `type` enum('vacaciones','asuntos_propios','baja_medica','permiso','otro') NOT NULL DEFAULT 'vacaciones',
  `from_date` date NOT NULL,
  `to_date` date NOT NULL,
  `days` decimal(5,1) NOT NULL DEFAULT '0.0',
  `status` enum('pendiente','aprobada','rechazada','cancelada') NOT NULL DEFAULT 'pendiente',
  `reason` text DEFAULT NULL,
  `decision_reason` text DEFAULT NULL,
  `approved_by` int DEFAULT NULL,
  `approved_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (NOW()),
  `updated_at` timestamp NOT NULL DEFAULT (NOW()) ON UPDATE NOW(),
  CONSTRAINT `hr_leave_requests_id` PRIMARY KEY (`id`)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `idx_hr_leave_requests_employee` ON `hr_leave_requests` (`employee_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_hr_leave_requests_status` ON `hr_leave_requests` (`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_hr_leave_requests_dates` ON `hr_leave_requests` (`from_date`, `to_date`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `hr_leave_balance` (
  `id` int AUTO_INCREMENT NOT NULL,
  `employee_id` int NOT NULL,
  `year` int NOT NULL,
  `accrued_days` decimal(5,1) NOT NULL DEFAULT '22.0',
  `notes` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (NOW()),
  `updated_at` timestamp NOT NULL DEFAULT (NOW()) ON UPDATE NOW(),
  CONSTRAINT `hr_leave_balance_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_hr_leave_balance_employee_year` UNIQUE (`employee_id`, `year`)
);
