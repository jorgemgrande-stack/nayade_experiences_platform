-- Fase 4 del módulo Personal / RRHH — Calendario laboral teórico.
--
-- hr_schedule_templates: jornada semanal teórica de cada empleado.
-- Un empleado puede tener varios "tramos" por día (mañana + tarde) usando
-- varias filas con el mismo weekday.
--
--   weekday: 0=Domingo, 1=Lunes, 2=Martes, 3=Miércoles, 4=Jueves,
--            5=Viernes, 6=Sábado  (convenio JavaScript Date.getDay()).
--   start_time / end_time: "HH:MM" en hora local de España.
--   valid_from / valid_until: rango de validez del tramo (NULL = sin límite).
--
-- hr_schedule_exceptions: festivos, bajas y permisos que rompen el patrón
-- teórico. Si employee_id es NULL la excepción afecta a toda la plantilla
-- (festivo nacional o de empresa).
--
-- En esta fase se crean las tablas sin UI de gestión (se hará en Fase 4.1
-- o en el contexto de Fase 8 Vacaciones). Los endpoints de cálculo de
-- horas teóricas las consultarán cuando exista contenido.

CREATE TABLE IF NOT EXISTS `hr_schedule_templates` (
  `id` int AUTO_INCREMENT NOT NULL,
  `employee_id` int NOT NULL,
  `weekday` tinyint NOT NULL,
  `start_time` varchar(5) NOT NULL,
  `end_time` varchar(5) NOT NULL,
  `valid_from` date DEFAULT NULL,
  `valid_until` date DEFAULT NULL,
  `notes` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (NOW()),
  `updated_at` timestamp NOT NULL DEFAULT (NOW()) ON UPDATE NOW(),
  CONSTRAINT `hr_schedule_templates_id` PRIMARY KEY (`id`)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `idx_hr_schedule_templates_employee` ON `hr_schedule_templates` (`employee_id`, `weekday`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `hr_schedule_exceptions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `employee_id` int DEFAULT NULL,
  `date` date NOT NULL,
  `type` enum('festivo','vacaciones','baja','permiso','otro') NOT NULL DEFAULT 'festivo',
  `notes` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (NOW()),
  CONSTRAINT `hr_schedule_exceptions_id` PRIMARY KEY (`id`)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `idx_hr_schedule_exceptions_date` ON `hr_schedule_exceptions` (`date`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_hr_schedule_exceptions_employee` ON `hr_schedule_exceptions` (`employee_id`, `date`);
