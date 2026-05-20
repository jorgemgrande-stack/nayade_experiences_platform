-- Gestoría e Impuestos — Fase 6: aplazamientos y fraccionamientos.
--
-- tax_deferrals               → solicitud de aplazamiento/fraccionamiento de
--                               una obligación ante la AEAT.
-- tax_deferral_installments   → calendario de vencimientos del aplazamiento.
--
-- Migración idempotente: ver scripts/apply-tax-fase6.cjs.

CREATE TABLE IF NOT EXISTS `tax_deferrals` (
  `id` int AUTO_INCREMENT NOT NULL,
  `obligation_id` int NOT NULL,
  `status` enum('solicitado','concedido','denegado','fraccionado') NOT NULL DEFAULT 'solicitado',
  `requested_at` varchar(10) NULL,
  `resolution_at` varchar(10) NULL,
  `principal` decimal(12,2) NOT NULL DEFAULT '0.00',
  `interest_rate` decimal(5,2) NULL,
  `installment_count` int NOT NULL DEFAULT 1,
  `notes` text NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `tax_deferrals_id` PRIMARY KEY(`id`)
);

CREATE TABLE IF NOT EXISTS `tax_deferral_installments` (
  `id` int AUTO_INCREMENT NOT NULL,
  `deferral_id` int NOT NULL,
  `number` int NOT NULL,
  `due_date` varchar(10) NOT NULL,
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `interest` decimal(12,2) NOT NULL DEFAULT '0.00',
  `paid_at` varchar(10) NULL,
  `status` enum('pendiente','pagada') NOT NULL DEFAULT 'pendiente',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `tax_deferral_installments_id` PRIMARY KEY(`id`)
);
