-- Gestoría e Impuestos — Fase 5: expedientes y portal de gestoría.
--
-- tax_dossiers     → expedientes ZIP generados para la gestoría.
-- users.role       → se añade el rol 'gestoria' para el portal externo.
--
-- Migración idempotente: ver scripts/apply-tax-fase5.cjs.

CREATE TABLE IF NOT EXISTS `tax_dossiers` (
  `id` int AUTO_INCREMENT NOT NULL,
  `year` int NOT NULL,
  `scope` enum('iva','laboral','sociedades','global') NOT NULL DEFAULT 'global',
  `period_key` varchar(16) NOT NULL,
  `title` varchar(160) NOT NULL,
  `file_url` text NULL,
  `file_key` varchar(512) NULL,
  `file_size` int NULL,
  `file_count` int NULL,
  `generated_by` int NULL,
  `sent_to_gestoria_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `tax_dossiers_id` PRIMARY KEY(`id`)
);

-- El rol 'gestoria' se añade al enum preservando los valores existentes.
ALTER TABLE `users`
  MODIFY COLUMN `role` enum(
    'user','admin','monitor','agente','adminrest','controler',
    'partner_admin','partner_user','employee','gestoria'
  ) NOT NULL DEFAULT 'user';
