-- Gestoría e Impuestos — Fase 1: espina dorsal del módulo.
--
-- tax_obligations      → una fila por modelo + periodo (303/390/111/190/200/202).
--                        Es la tabla central: estima, presenta, paga, cierra.
-- tax_obligation_lines → desglose trazable del importe estimado de cada obligación.
-- tax_obligation_log   → auditoría de cambios de estado.
-- tax_documents        → adjuntos por obligación (modelo presentado, justificante…).
-- tax_settings         → configuración singleton (id=1) del módulo.
--
-- Migración idempotente: ver scripts/apply-tax-fase1.cjs.

CREATE TABLE IF NOT EXISTS `tax_obligations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `model` enum('303','390','111','190','200','202') NOT NULL,
  `year` int NOT NULL,
  `period_type` enum('trimestral','anual','mensual') NOT NULL,
  `period_key` varchar(16) NOT NULL,
  `period_label` varchar(96) NOT NULL,
  `due_date` varchar(10) NOT NULL,
  `estimated_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `presented_amount` decimal(12,2) NULL,
  `paid_amount` decimal(12,2) NULL,
  `status` enum('pendiente','estimado','revisado','enviado_gestoria','presentado','pagado','aplazado','cerrado') NOT NULL DEFAULT 'pendiente',
  `deferral_id` int NULL,
  `presented_at` timestamp NULL,
  `paid_at` timestamp NULL,
  `notes` text NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `tax_obligations_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_tax_obligation_model_period` UNIQUE(`model`,`period_key`)
);

CREATE TABLE IF NOT EXISTS `tax_obligation_lines` (
  `id` int AUTO_INCREMENT NOT NULL,
  `obligation_id` int NOT NULL,
  `concept` varchar(256) NOT NULL,
  `base` decimal(12,2) NOT NULL DEFAULT '0.00',
  `rate` decimal(5,2) NULL,
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `source_type` varchar(32) NULL,
  `source_ref` varchar(64) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `tax_obligation_lines_id` PRIMARY KEY(`id`)
);

CREATE TABLE IF NOT EXISTS `tax_obligation_log` (
  `id` int AUTO_INCREMENT NOT NULL,
  `obligation_id` int NOT NULL,
  `from_status` varchar(32) NULL,
  `to_status` varchar(32) NOT NULL,
  `user_id` int NULL,
  `user_name` varchar(128) NULL,
  `note` text NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `tax_obligation_log_id` PRIMARY KEY(`id`)
);

CREATE TABLE IF NOT EXISTS `tax_documents` (
  `id` int AUTO_INCREMENT NOT NULL,
  `obligation_id` int NOT NULL,
  `doc_type` enum('modelo_presentado','justificante_pago','resolucion','otro') NOT NULL DEFAULT 'otro',
  `title` varchar(256) NOT NULL,
  `file_url` text NOT NULL,
  `file_key` varchar(512) NULL,
  `uploaded_by` int NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `tax_documents_id` PRIMARY KEY(`id`)
);

CREATE TABLE IF NOT EXISTS `tax_settings` (
  `id` int NOT NULL DEFAULT 1,
  `corporate_tax_rate` decimal(5,2) NOT NULL DEFAULT '25.00',
  `fiscal_year_end_month` int NOT NULL DEFAULT 12,
  `company_nif` varchar(32) NULL,
  `company_name` varchar(256) NULL,
  `company_address` text NULL,
  `gestoria_emails` text NULL,
  `iae_epigraphs` text NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `tax_settings_id` PRIMARY KEY(`id`)
);

INSERT IGNORE INTO `tax_settings` (`id`) VALUES (1);
