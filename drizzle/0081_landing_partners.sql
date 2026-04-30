-- 0081: Landing Partners
-- Nuevo modulo para que partners externos puedan generar presupuestos
-- desde una landing privada.

-- 1. partners
CREATE TABLE IF NOT EXISTS `partners` (
  `id`                   INT           AUTO_INCREMENT PRIMARY KEY,
  `name`                 VARCHAR(256)  NOT NULL,
  `slug`                 VARCHAR(128)  NOT NULL UNIQUE,
  `contact_name`         VARCHAR(256)  NULL,
  `contact_email`        VARCHAR(320)  NULL,
  `contact_phone`        VARCHAR(32)   NULL,
  `access_key`           VARCHAR(64)   NOT NULL UNIQUE,
  `is_active`            BOOLEAN       NOT NULL DEFAULT TRUE,
  `can_send_quotes`      BOOLEAN       NOT NULL DEFAULT TRUE,
  `can_redeem_directly`  BOOLEAN       NOT NULL DEFAULT FALSE,
  `created_at`           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_partners_slug`       (`slug`),
  INDEX `idx_partners_access_key` (`access_key`),
  INDEX `idx_partners_is_active`  (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint

-- 2. partner_allowed_products
CREATE TABLE IF NOT EXISTS `partner_allowed_products` (
  `id`           INT          AUTO_INCREMENT PRIMARY KEY,
  `partner_id`   INT          NOT NULL,
  `product_id`   INT          NOT NULL,
  `product_type` VARCHAR(32)  NOT NULL,
  `can_quote`    BOOLEAN      NOT NULL DEFAULT TRUE,
  `can_redeem`   BOOLEAN      NOT NULL DEFAULT FALSE,
  `created_at`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_pap_partner_id`   (`partner_id`),
  INDEX `idx_pap_product_id`   (`product_id`),
  CONSTRAINT `fk_pap_partner`
    FOREIGN KEY (`partner_id`) REFERENCES `partners` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint

-- 3. quotes: columna partner_id (nullable)
ALTER TABLE `quotes`
  ADD COLUMN `partnerId` INT NULL DEFAULT NULL;
--> statement-breakpoint
CREATE INDEX `idx_quotes_partner_id` ON `quotes` (`partnerId`);
--> statement-breakpoint

-- 4. reservations: columna partner_id (nullable)
ALTER TABLE `reservations`
  ADD COLUMN `partner_id` INT NULL DEFAULT NULL;
--> statement-breakpoint
CREATE INDEX `idx_reservations_partner_id` ON `reservations` (`partner_id`);
