-- Fase 5 RRHH — Nóminas oficiales (las que firma la gestoría).
-- Una fila por (empleado, periodo YYYY-MM). UNIQUE para evitar duplicados.
-- Independiente de monitor_payroll (que se mantiene como anotación legacy).

CREATE TABLE IF NOT EXISTS `hr_payslips` (
  `id` int AUTO_INCREMENT NOT NULL,
  `employee_id` int NOT NULL,
  `period` varchar(7) NOT NULL,
  `gross_salary` decimal(12,2) NOT NULL DEFAULT '0.00',
  `irpf_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `ss_employee` decimal(12,2) NOT NULL DEFAULT '0.00',
  `net_salary` decimal(12,2) NOT NULL DEFAULT '0.00',
  `ss_company_estimated` decimal(12,2) NOT NULL DEFAULT '0.00',
  `ss_company_real` decimal(12,2) DEFAULT NULL,
  `batch_id` int DEFAULT NULL,
  `pdf_url` text DEFAULT NULL,
  `pdf_key` varchar(512) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `status` enum('borrador','registrada','pagada','anulada') NOT NULL DEFAULT 'borrador',
  `fiscal_status` enum('pendiente','revisado','exportado','presentado') NOT NULL DEFAULT 'pendiente',
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (NOW()),
  `updated_at` timestamp NOT NULL DEFAULT (NOW()) ON UPDATE NOW(),
  CONSTRAINT `hr_payslips_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_hr_payslips_employee_period` UNIQUE (`employee_id`, `period`)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `idx_hr_payslips_period` ON `hr_payslips` (`period`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_hr_payslips_batch` ON `hr_payslips` (`batch_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_hr_payslips_fiscal_status` ON `hr_payslips` (`fiscal_status`);
