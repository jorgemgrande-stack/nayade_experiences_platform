-- Fase 5 RRHH — Configuración global del módulo Personal/RRHH.
-- Singleton row (id=1) con porcentaje de Seguridad Social empresa
-- (entre 31% y 34% según la propuesta original) y otros defaults.

CREATE TABLE IF NOT EXISTS `hr_settings` (
  `id` int NOT NULL DEFAULT 1,
  `ss_company_percent` decimal(5,2) NOT NULL DEFAULT '31.00',
  `default_holiday_days` int NOT NULL DEFAULT 22,
  `default_weekly_hours` decimal(5,2) NOT NULL DEFAULT '40.00',
  `irpf_default_percent` decimal(5,2) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (NOW()),
  `updated_at` timestamp NOT NULL DEFAULT (NOW()) ON UPDATE NOW(),
  CONSTRAINT `hr_settings_id` PRIMARY KEY (`id`)
);
--> statement-breakpoint

INSERT IGNORE INTO `hr_settings` (`id`, `ss_company_percent`, `default_holiday_days`, `default_weekly_hours`)
VALUES (1, 31.00, 22, 40.00);
