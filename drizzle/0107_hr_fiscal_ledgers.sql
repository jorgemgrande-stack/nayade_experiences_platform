-- Fase 5 RRHH — Libros fiscales (preparado para módulo Gestoría futuro).
--
-- hr_irpf_ledger: una fila por (empleado, periodo) cuando se registra una
-- nómina o un bonus con retención IRPF. Alimentará el Modelo 111 trimestral
-- y el resumen anual 190.
--
-- hr_ss_ledger: una fila por periodo con la SS empresa estimada al cerrar
-- la remesa, y luego ajustada con el cargo real de la TGSS (modelos TC1/TC2).

CREATE TABLE IF NOT EXISTS `hr_irpf_ledger` (
  `id` int AUTO_INCREMENT NOT NULL,
  `period` varchar(7) NOT NULL,
  `employee_id` int NOT NULL,
  `taxable_base` decimal(12,2) NOT NULL DEFAULT '0.00',
  `retained_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `payslip_id` int DEFAULT NULL,
  `bonus_id` int DEFAULT NULL,
  `fiscal_status` enum('pendiente','revisado','exportado','presentado') NOT NULL DEFAULT 'pendiente',
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (NOW()),
  CONSTRAINT `hr_irpf_ledger_id` PRIMARY KEY (`id`)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `idx_hr_irpf_ledger_period` ON `hr_irpf_ledger` (`period`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_hr_irpf_ledger_employee` ON `hr_irpf_ledger` (`employee_id`, `period`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_hr_irpf_ledger_fiscal_status` ON `hr_irpf_ledger` (`fiscal_status`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `hr_ss_ledger` (
  `id` int AUTO_INCREMENT NOT NULL,
  `period` varchar(7) NOT NULL,
  `estimated_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `real_amount` decimal(12,2) DEFAULT NULL,
  `real_charged_at` timestamp NULL DEFAULT NULL,
  `bank_movement_id` int DEFAULT NULL,
  `batch_id` int DEFAULT NULL,
  `fiscal_status` enum('pendiente','revisado','exportado','presentado') NOT NULL DEFAULT 'pendiente',
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (NOW()),
  `updated_at` timestamp NOT NULL DEFAULT (NOW()) ON UPDATE NOW(),
  CONSTRAINT `hr_ss_ledger_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_hr_ss_ledger_period` UNIQUE (`period`)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `idx_hr_ss_ledger_fiscal_status` ON `hr_ss_ledger` (`fiscal_status`);
