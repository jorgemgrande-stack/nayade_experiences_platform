-- Fase 2: Centro de Comunicaciones Comerciales
-- Tablas para gestión centralizada de emails: config por plantilla,
-- reglas de automatización, log global, cola de jobs y preferencias por cliente.

-- ─── 1. Configuración por plantilla ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `email_template_configs` (
  `id`              INT AUTO_INCREMENT PRIMARY KEY,
  `key`             VARCHAR(128) NOT NULL UNIQUE,
  `category`        VARCHAR(64),
  `friendlyName`    VARCHAR(256),
  `isActive`        BOOLEAN NOT NULL DEFAULT TRUE,
  `sendToCustomer`  BOOLEAN NOT NULL DEFAULT TRUE,
  `sendToAdmin`     BOOLEAN NOT NULL DEFAULT FALSE,
  `adminCopyEmail`  VARCHAR(320),
  `customSubject`   VARCHAR(512),
  `notes`           TEXT,
  `createdAt`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ─── 2. Reglas de automatización / reenvíos programados ─────────────────────
CREATE TABLE IF NOT EXISTS `email_automation_rules` (
  `id`                  INT AUTO_INCREMENT PRIMARY KEY,
  `templateKey`         VARCHAR(128) NOT NULL,
  `name`                VARCHAR(256) NOT NULL,
  `isActive`            BOOLEAN NOT NULL DEFAULT TRUE,
  `sortOrder`           INT NOT NULL DEFAULT 0,
  `delayHours`          INT NOT NULL DEFAULT 24,
  `calculateFrom`       ENUM('trigger_time','last_reminder','created_at','viewed_at','expires_at') NOT NULL DEFAULT 'trigger_time',
  `conditionsJson`      JSON,
  `maxSendsPerEntity`   INT NOT NULL DEFAULT 1,
  `allowedSendStart`    VARCHAR(5) NOT NULL DEFAULT '09:00',
  `allowedSendEnd`      VARCHAR(5) NOT NULL DEFAULT '21:00',
  `stopIfConverted`     BOOLEAN NOT NULL DEFAULT TRUE,
  `stopIfPaid`          BOOLEAN NOT NULL DEFAULT TRUE,
  `emailSubject`        VARCHAR(512),
  `emailBody`           TEXT,
  `createdAt`           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ear_template_key (`templateKey`),
  INDEX idx_ear_active (`isActive`)
);

-- ─── 3. Log global de comunicaciones ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `email_comm_log` (
  `id`                  INT AUTO_INCREMENT PRIMARY KEY,
  `leadId`              INT,
  `quoteId`             INT,
  `reservationId`       INT,
  `relatedEntityType`   VARCHAR(64),
  `relatedEntityId`     INT,
  `templateKey`         VARCHAR(128),
  `ruleId`              INT,
  `triggerEvent`        VARCHAR(128),
  `channel`             VARCHAR(32) NOT NULL DEFAULT 'email',
  `recipientEmail`      VARCHAR(320),
  `ccEmail`             VARCHAR(320),
  `subject`             VARCHAR(512),
  `status`              ENUM('sent','failed','skipped') NOT NULL DEFAULT 'sent',
  `provider`            VARCHAR(32),
  `errorMessage`        TEXT,
  `sentByUserId`        INT,
  `isAutomatic`         BOOLEAN NOT NULL DEFAULT FALSE,
  `skipReason`          VARCHAR(256),
  `createdAt`           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ecl_template   (`templateKey`),
  INDEX idx_ecl_entity     (`relatedEntityType`, `relatedEntityId`),
  INDEX idx_ecl_recipient  (`recipientEmail`(32)),
  INDEX idx_ecl_created    (`createdAt`),
  INDEX idx_ecl_status     (`status`)
);

-- ─── 4. Cola de jobs programados ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `email_scheduled_jobs` (
  `id`                  INT AUTO_INCREMENT PRIMARY KEY,
  `relatedEntityType`   VARCHAR(64) NOT NULL,
  `relatedEntityId`     INT NOT NULL,
  `templateKey`         VARCHAR(128) NOT NULL,
  `ruleId`              INT NOT NULL,
  `recipientEmail`      VARCHAR(320),
  `scheduledFor`        TIMESTAMP NOT NULL,
  `status`              ENUM('pending','sent','skipped','failed','cancelled') NOT NULL DEFAULT 'pending',
  `attempts`            INT NOT NULL DEFAULT 0,
  `lastAttemptAt`       TIMESTAMP NULL,
  `errorMessage`        TEXT,
  `skipReason`          VARCHAR(256),
  `lockedAt`            TIMESTAMP NULL,
  `metadataJson`        JSON,
  `createdAt`           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_esj_status_sched (`status`, `scheduledFor`),
  INDEX idx_esj_entity       (`relatedEntityType`, `relatedEntityId`),
  INDEX idx_esj_template     (`templateKey`)
);

-- ─── 5. Preferencias por cliente ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `customer_email_prefs` (
  `id`                  INT AUTO_INCREMENT PRIMARY KEY,
  `email`               VARCHAR(320) NOT NULL UNIQUE,
  `automationsPaused`   BOOLEAN NOT NULL DEFAULT FALSE,
  `pauseReason`         TEXT,
  `pausedAt`            TIMESTAMP NULL,
  `pausedByUserId`      INT,
  `createdAt`           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cep_email (`email`)
);

-- ─── 6. Feature flag para el cron centralizado ─────────────────────────────
INSERT IGNORE INTO `feature_flags` (`key`, `name`, `description`, `module`, `enabled`, `default_enabled`, `risk_level`)
VALUES ('email_automation_job_enabled', 'Cron automatizaciones email', 'Procesa la cola email_scheduled_jobs cada 10 min', 'email', 0, 0, 'medium');

-- ─── 7. Seed: configuración inicial de las plantillas existentes ─────────────
INSERT IGNORE INTO `email_template_configs` (`key`, `category`, `friendlyName`, `sendToCustomer`, `sendToAdmin`) VALUES
  ('budget_request_user',          'Leads',                'Solicitud de presupuesto (cliente)',          TRUE,  FALSE),
  ('budget_request_admin',         'Leads',                'Solicitud de presupuesto (aviso admin)',      FALSE, TRUE),
  ('quote',                        'Presupuestos',         'Email de presupuesto',                       TRUE,  FALSE),
  ('proposal',                     'Presupuestos',         'Propuesta comercial',                        TRUE,  FALSE),
  ('commercial_reminder_1',        'Presupuestos',         'Recordatorio comercial #1',                  TRUE,  FALSE),
  ('commercial_reminder_2',        'Presupuestos',         'Recordatorio comercial #2',                  TRUE,  FALSE),
  ('commercial_reminder_3',        'Presupuestos',         'Recordatorio comercial #3',                  TRUE,  FALSE),
  ('reservation_confirm',          'Reservas',             'Confirmación de reserva',                    TRUE,  FALSE),
  ('reservation_failed',           'Reservas',             'Fallo en pago de reserva',                   TRUE,  FALSE),
  ('confirmation',                 'Reservas',             'Confirmación completa (post-pago)',           TRUE,  FALSE),
  ('transfer_confirmation',        'Pagos / Transferencias','Confirmación de transferencia',             FALSE, TRUE),
  ('pending_payment',              'Pagos / Transferencias','Aviso pago pendiente',                      TRUE,  FALSE),
  ('pending_payment_reminder',     'Pagos / Transferencias','Recordatorio pago pendiente',               TRUE,  FALSE),
  ('installment_reminder',         'Pagos / Transferencias','Recordatorio de cuota',                    TRUE,  FALSE),
  ('cancellation_received',        'Anulaciones',          'Anulación recibida',                         TRUE,  FALSE),
  ('cancellation_rejected',        'Anulaciones',          'Anulación rechazada',                        TRUE,  FALSE),
  ('cancellation_accepted_refund', 'Anulaciones',          'Anulación aceptada — devolución',            TRUE,  FALSE),
  ('cancellation_accepted_voucher','Anulaciones',          'Anulación aceptada — bono',                  TRUE,  FALSE),
  ('cancellation_documentation',   'Anulaciones',          'Solicitud de documentación de anulación',    TRUE,  FALSE),
  ('cancellation_refund_executed', 'Anulaciones',          'Devolución ejecutada',                       TRUE,  FALSE),
  ('coupon_received',              'Cupones',              'Cupón recibido / confirmación',               TRUE,  TRUE),
  ('coupon_postponed',             'Cupones',              'Cupón pospuesto',                             TRUE,  FALSE),
  ('coupon_internal_alert',        'Cupones',              'Alerta interna de cupón',                    FALSE, TRUE),
  ('restaurant_confirm',           'Restaurantes',         'Confirmación de reserva de restaurante',     TRUE,  FALSE),
  ('restaurant_payment_link',      'Restaurantes',         'Link de pago de restaurante',                TRUE,  FALSE),
  ('tpv_ticket',                   'Operaciones internas', 'Ticket TPV',                                 FALSE, TRUE),
  ('cash_open',                    'Operaciones internas', 'Apertura de caja',                           FALSE, TRUE),
  ('cash_close',                   'Operaciones internas', 'Cierre de caja',                             FALSE, TRUE),
  ('invite',                       'Administración',       'Invitación de usuario',                      FALSE, FALSE),
  ('password_reset',               'Administración',       'Reset de contraseña',                        FALSE, FALSE);
