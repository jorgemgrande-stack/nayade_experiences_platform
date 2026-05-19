-- Fase 6 RRHH — Bonus e Incentivos.
--
-- Pagos adicionales a la nómina oficial. NO sustituyen a la nómina.
-- Métodos de pago:
--   cash     → al marcar pagado, se crea expense con paymentMethod=cash,
--              y el helper de Contabilidad crea automáticamente el
--              cash_movement (idempotente por relatedEntityType=expense).
--   transfer → expense con paymentMethod=transfer (sin movimiento de caja).
--   payroll  → se incluirá manualmente en la próxima nómina; no genera
--              expense propio (incluido en grossSalary del payslip).
--
-- Anti-duplicidad: la fuente de verdad de cash es el helper
-- createCashMovementIfNotExists, que detecta duplicados por
-- (relatedEntityType=expense, relatedEntityId=expense_id).

CREATE TABLE IF NOT EXISTS `hr_bonus` (
  `id` int AUTO_INCREMENT NOT NULL,
  `employee_id` int NOT NULL,
  `type` enum('bonus','comision','prima','gratificacion','anticipo','ajuste') NOT NULL DEFAULT 'bonus',
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `irpf_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `concept` varchar(256) NOT NULL,
  `notes` text DEFAULT NULL,
  `paid_at` timestamp NULL DEFAULT NULL,
  `payment_method` enum('cash','transfer','payroll') DEFAULT NULL,
  `expense_id` int DEFAULT NULL,
  `cash_movement_id` int DEFAULT NULL,
  `included_in_payslip_id` int DEFAULT NULL,
  `status` enum('pendiente','pagado','anulado') NOT NULL DEFAULT 'pendiente',
  `fiscal_status` enum('pendiente','revisado','exportado','presentado') NOT NULL DEFAULT 'pendiente',
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (NOW()),
  `updated_at` timestamp NOT NULL DEFAULT (NOW()) ON UPDATE NOW(),
  CONSTRAINT `hr_bonus_id` PRIMARY KEY (`id`)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `idx_hr_bonus_employee` ON `hr_bonus` (`employee_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_hr_bonus_status` ON `hr_bonus` (`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_hr_bonus_paid_at` ON `hr_bonus` (`paid_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_hr_bonus_fiscal_status` ON `hr_bonus` (`fiscal_status`);
