-- Fase 4 del módulo Personal / RRHH — Registro Horario.
--
-- Tabla hr_time_clock: una fila por par entrada/salida.
-- En esta fase guardamos solo fecha y hora. La estructura admite ampliar
-- (IP, dispositivo, geolocalización) sin migración futura — vía meta_json.
--
-- Estados:
--   open       — entrada registrada, salida pendiente.
--   closed     — par completo.
--   incomplete — quedó sin cerrar más de 24h y un job lo marcó así
--                (la salida queda en NULL para que el admin la corrija).
--   edited     — el admin modificó manualmente la entrada o salida.
--   cancelled  — fichaje cancelado por el admin (sigue en la base por auditoría).
--
-- Idempotente con IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS `hr_time_clock` (
  `id` int AUTO_INCREMENT NOT NULL,
  `employee_id` int NOT NULL,
  `clock_in_at` timestamp NOT NULL,
  `clock_out_at` timestamp NULL DEFAULT NULL,
  `source` enum('portal','admin','tablet','external') NOT NULL DEFAULT 'portal',
  `meta_json` text DEFAULT NULL,
  `status` enum('open','closed','incomplete','edited','cancelled') NOT NULL DEFAULT 'open',
  `notes` text DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `updated_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (NOW()),
  `updated_at` timestamp NOT NULL DEFAULT (NOW()) ON UPDATE NOW(),
  CONSTRAINT `hr_time_clock_id` PRIMARY KEY (`id`)
);
--> statement-breakpoint

-- Índice principal: listar fichajes de un empleado en un rango.
CREATE INDEX IF NOT EXISTS `idx_hr_time_clock_employee_in` ON `hr_time_clock` (`employee_id`, `clock_in_at`);
--> statement-breakpoint

-- Índice por estado: para localizar rápidamente los abiertos / incompletos.
CREATE INDEX IF NOT EXISTS `idx_hr_time_clock_status` ON `hr_time_clock` (`status`);
