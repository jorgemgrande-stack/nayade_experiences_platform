-- ============================================================
-- FASE 1: Módulo Partners / Colaboradores
-- ============================================================

-- 1. Tabla principal de partners
CREATE TABLE IF NOT EXISTS `partners` (
  `id`                          int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `name`                        varchar(256) NOT NULL,
  `slug`                        varchar(128) NOT NULL,
  -- Datos fiscales
  `fiscalName`                  varchar(256),
  `nif`                         varchar(32),
  `address`                     text,
  `city`                        varchar(128),
  `postalCode`                  varchar(16),
  `country`                     varchar(4) NOT NULL DEFAULT 'ES',
  -- Contacto
  `contactName`                 varchar(256),
  `contactEmail`                varchar(320),
  `contactPhone`                varchar(32),
  `billingEmail`                varchar(320),
  -- Capacidades
  `canCreateReservations`       boolean NOT NULL DEFAULT false,
  `canCreateLeads`              boolean NOT NULL DEFAULT true,
  -- Productos permitidos (JSON arrays de IDs de experiencia)
  `allowedReservationProductIds` json,
  `allowedLeadProductIds`        json,
  -- Comisiones (preparado para futuro, por defecto sin comisión)
  `commissionType`              enum('none','fixed_lead','fixed_reservation','percent','per_product','manual') NOT NULL DEFAULT 'none',
  `commissionValue`             decimal(10,4),
  -- Facturación agrupada
  `billingEnabled`              boolean NOT NULL DEFAULT false,
  `billingPeriod`               enum('weekly','biweekly','monthly','manual') NOT NULL DEFAULT 'monthly',
  -- Control de cupos (null = sin límite)
  `monthlyQuota`                int NULL,
  -- Estado y notas
  `isActive`                    boolean NOT NULL DEFAULT true,
  `notes`                       text,
  `createdAt`                   timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`                   timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_partner_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Extender users: añadir partnerId para vincular recepcionistas
ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `partnerId` int NULL AFTER `role`;

-- 3. Extender users: nuevos roles partner_admin y partner_user
-- (MySQL no permite IF NOT EXISTS en ALTER COLUMN MODIFY para enums,
--  usamos MODIFY COLUMN directamente — es idempotente si ya tiene los valores)
ALTER TABLE `users`
  MODIFY COLUMN `role` enum(
    'user','admin','monitor','agente','adminrest','controler',
    'partner_admin','partner_user'
  ) NOT NULL DEFAULT 'user';

-- 4. Extender leads: vincular al partner y al recepcionista que lo creó
ALTER TABLE `leads`
  ADD COLUMN IF NOT EXISTS `partnerId`     int NULL AFTER `source`,
  ADD COLUMN IF NOT EXISTS `partnerUserId` int NULL AFTER `partnerId`;

-- 5. Extender reservations: vincular al partner y al recepcionista
ALTER TABLE `reservations`
  ADD COLUMN IF NOT EXISTS `partnerId`     int NULL AFTER `channelDetail`,
  ADD COLUMN IF NOT EXISTS `partnerUserId` int NULL AFTER `partnerId`;

-- 6. Extender invoices: vincular al partner (para facturación agrupada)
ALTER TABLE `invoices`
  ADD COLUMN IF NOT EXISTS `partnerId` int NULL AFTER `creditNoteReason`;

-- 7. Tablas de facturación agrupada (preparadas para Fase 4, sin romper nada)
CREATE TABLE IF NOT EXISTS `partner_billing_batches` (
  `id`           int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `batchNumber`  varchar(32) NOT NULL,
  `partnerId`    int NOT NULL,
  `periodType`   enum('weekly','biweekly','monthly','manual') NOT NULL DEFAULT 'monthly',
  `periodStart`  date NOT NULL,
  `periodEnd`    date NOT NULL,
  `totalAmount`  decimal(12,2) NOT NULL DEFAULT 0,
  `status`       enum('borrador','emitida','cobrada','anulada') NOT NULL DEFAULT 'borrador',
  `invoiceId`    int NULL,
  `notes`        text,
  `createdBy`    int NULL,
  `createdAt`    timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`    timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_batch_number` (`batchNumber`),
  INDEX `idx_batch_partner` (`partnerId`),
  INDEX `idx_batch_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `partner_billing_batch_items` (
  `id`            int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `batchId`       int NOT NULL,
  `reservationId` int NOT NULL,
  `amount`        decimal(10,2) NOT NULL DEFAULT 0,
  `description`   varchar(512),
  `createdAt`     timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_batch_item_batch` (`batchId`),
  INDEX `idx_batch_item_reservation` (`reservationId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
