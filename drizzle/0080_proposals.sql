-- ─── 0080: Propuestas Comerciales ────────────────────────────────────────────
-- Nuevo módulo pre-presupuesto: propuesta configurable o multi-opción.
-- Flujo: Lead → Propuesta → (cliente acepta) → Presupuesto → Reserva → Factura

-- ─── 1. proposals ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `proposals` (
  `id`                 INT AUTO_INCREMENT PRIMARY KEY,
  `proposalNumber`     VARCHAR(32)  NOT NULL UNIQUE,
  `leadId`             INT          NOT NULL,
  `agentId`            INT          NOT NULL,
  `title`              VARCHAR(256) NOT NULL,
  `description`        TEXT,
  `mode`               ENUM('configurable','multi_option') NOT NULL DEFAULT 'configurable',
  `items`              JSON,
  `subtotal`           DECIMAL(10,2) NOT NULL DEFAULT 0,
  `discount`           DECIMAL(10,2) DEFAULT 0,
  `tax`                DECIMAL(10,2) DEFAULT 0,
  `total`              DECIMAL(10,2) NOT NULL DEFAULT 0,
  `currency`           VARCHAR(8)   NOT NULL DEFAULT 'EUR',
  `status`             ENUM('borrador','enviado','visualizado','aceptado','rechazado','expirado') NOT NULL DEFAULT 'borrador',
  `token`              VARCHAR(128) UNIQUE,
  `publicUrl`          TEXT,
  `validUntil`         TIMESTAMP    NULL,
  `conditions`         TEXT,
  `notes`              TEXT,
  `sentAt`             TIMESTAMP    NULL,
  `viewedAt`           TIMESTAMP    NULL,
  `acceptedAt`         TIMESTAMP    NULL,
  `selectedOptionId`   INT          NULL,
  `convertedToQuoteId` INT          NULL,
  `ghlOpportunityId`   VARCHAR(128) NULL,
  `createdAt`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_proposals_leadId`   (`leadId`),
  INDEX `idx_proposals_agentId`  (`agentId`),
  INDEX `idx_proposals_status`   (`status`),
  INDEX `idx_proposals_token`    (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint

-- ─── 2. proposal_options ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `proposal_options` (
  `id`            INT AUTO_INCREMENT PRIMARY KEY,
  `proposalId`    INT          NOT NULL,
  `title`         VARCHAR(256) NOT NULL,
  `description`   TEXT,
  `items`         JSON,
  `subtotal`      DECIMAL(10,2) NOT NULL DEFAULT 0,
  `discount`      DECIMAL(10,2) DEFAULT 0,
  `tax`           DECIMAL(10,2) DEFAULT 0,
  `total`         DECIMAL(10,2) NOT NULL DEFAULT 0,
  `isRecommended` BOOLEAN      NOT NULL DEFAULT FALSE,
  `sortOrder`     INT          NOT NULL DEFAULT 0,
  `createdAt`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_proposal_options_proposalId` (`proposalId`),
  CONSTRAINT `fk_proposal_options_proposal`
    FOREIGN KEY (`proposalId`) REFERENCES `proposals` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
