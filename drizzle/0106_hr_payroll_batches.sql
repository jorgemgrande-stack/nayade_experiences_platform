-- Fase 5 RRHH — Remesa mensual de nóminas.
-- Una fila por periodo (YYYY-MM). UNIQUE. El cierre genera gastos automáticos.

CREATE TABLE IF NOT EXISTS `hr_payroll_batches` (
  `id` int AUTO_INCREMENT NOT NULL,
  `period` varchar(7) NOT NULL,
  `status` enum('open','closed','exported') NOT NULL DEFAULT 'open',
  `fiscal_status` enum('pendiente','revisado','exportado','presentado') NOT NULL DEFAULT 'pendiente',
  `total_gross` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_irpf` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_ss_employee` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_net` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_ss_company_estimated` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_ss_company_real` decimal(12,2) DEFAULT NULL,
  `expense_ids_json` text DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `closed_at` timestamp NULL DEFAULT NULL,
  `closed_by` int DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (NOW()),
  `updated_at` timestamp NOT NULL DEFAULT (NOW()) ON UPDATE NOW(),
  CONSTRAINT `hr_payroll_batches_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_hr_payroll_batches_period` UNIQUE (`period`)
);
