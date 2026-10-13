-- ============================================================================
-- Elephant Source Core — baseline de esquema para bases de datos NUEVAS
-- (tenants, preproducción, CI). Generada a partir del DDL real de producción
-- (SHOW CREATE TABLE, solo estructura; sin datos) el 2026-10-13.
--
-- NO se aplica a bases de datos existentes: estas siguen su camino incremental.
-- Las migraciones de drizzle/ no pueden construir una BD vacía (ver
-- docs/db/RECONCILIACION_ESQUEMA_2026-10-13.md).
--
-- Tablas: 152
--
-- Diferencia deliberada con producción: el DEFAULT del correo de alertas internas de
-- `internalAlertEmail` es '' (en producción llevaba el correo de un cliente concreto).
-- ============================================================================

SET FOREIGN_KEY_CHECKS = 0;
CREATE TABLE IF NOT EXISTS `admin_notification_dismissals` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `kind` varchar(40) NOT NULL,
  `entity_id` int NOT NULL,
  `dismissed_at` bigint NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_kind_entity` (`user_id`,`kind`,`entity_id`),
  KEY `idx_user_kind` (`user_id`,`kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `bank_file_imports` (
  `id` int NOT NULL AUTO_INCREMENT,
  `file_name` varchar(255) NOT NULL,
  `file_type` varchar(10) NOT NULL,
  `imported_rows` int NOT NULL DEFAULT '0',
  `duplicates_skipped` int NOT NULL DEFAULT '0',
  `status` enum('ok','error','parcial') NOT NULL DEFAULT 'ok',
  `error_message` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `bank_movement_links` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bank_movement_id` int NOT NULL,
  `entity_type` enum('quote','reservation','invoice','expense','card_terminal_batch','manual') NOT NULL,
  `entity_id` int NOT NULL,
  `link_type` enum('income_transfer','card_income','cash_income','expense_payment','manual_conciliation') NOT NULL DEFAULT 'income_transfer',
  `amount_linked` decimal(12,2) NOT NULL,
  `status` enum('proposed','confirmed','rejected','unlinked') NOT NULL DEFAULT 'proposed',
  `confidence_score` int DEFAULT '0',
  `matched_by` varchar(255) DEFAULT NULL,
  `matched_at` timestamp NULL DEFAULT NULL,
  `rejected_at` timestamp NULL DEFAULT NULL,
  `unlinked_at` timestamp NULL DEFAULT NULL,
  `notes` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `bank_movements` (
  `id` int NOT NULL AUTO_INCREMENT,
  `import_id` int NOT NULL,
  `fecha` varchar(12) NOT NULL,
  `fecha_valor` varchar(12) DEFAULT NULL,
  `movimiento` varchar(255) DEFAULT NULL,
  `mas_datos` text,
  `importe` decimal(12,2) NOT NULL,
  `saldo` decimal(12,2) DEFAULT NULL,
  `duplicate_key` varchar(255) NOT NULL,
  `status` enum('pendiente','ignorado') NOT NULL DEFAULT 'pendiente',
  `notes` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `conciliation_status` enum('pendiente','conciliado') NOT NULL DEFAULT 'pendiente',
  PRIMARY KEY (`id`),
  UNIQUE KEY `bank_movements_duplicate_key_unique` (`duplicate_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `booking_monitors` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bookingId` int NOT NULL,
  `monitorId` int NOT NULL,
  `role` varchar(128) DEFAULT 'monitor',
  `notifiedAt` timestamp NULL DEFAULT NULL,
  `confirmedAt` timestamp NULL DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `bookings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bookingNumber` varchar(32) NOT NULL,
  `experienceId` int NOT NULL,
  `quoteId` int DEFAULT NULL,
  `clientName` varchar(256) NOT NULL,
  `clientEmail` varchar(320) NOT NULL,
  `clientPhone` varchar(32) DEFAULT NULL,
  `scheduledDate` timestamp NOT NULL,
  `endDate` timestamp NULL DEFAULT NULL,
  `numberOfPersons` int NOT NULL,
  `totalAmount` decimal(10,2) NOT NULL,
  `status` enum('pendiente','confirmado','en_curso','completado','cancelado') NOT NULL DEFAULT 'pendiente',
  `notes` text,
  `internalNotes` text,
  `reservationId` int DEFAULT NULL,
  `sourceChannel` enum('manual','redsys','transferencia','efectivo','otro') DEFAULT 'manual',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `bookings_bookingNumber_unique` (`bookingNumber`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `cancellation_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `request_id` int NOT NULL,
  `action_type` varchar(64) NOT NULL,
  `old_status` varchar(64) DEFAULT NULL,
  `new_status` varchar(64) DEFAULT NULL,
  `payload` json DEFAULT NULL,
  `admin_user_id` int DEFAULT NULL,
  `admin_user_name` varchar(256) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `cancellation_requests` (
  `id` int NOT NULL AUTO_INCREMENT,
  `full_name` varchar(256) NOT NULL,
  `email` varchar(320) DEFAULT NULL,
  `phone` varchar(32) DEFAULT NULL,
  `activity_date` varchar(32) NOT NULL,
  `reason` enum('meteorologicas','accidente','enfermedad','desistimiento','otra') NOT NULL,
  `reason_detail` text,
  `terms_checked` tinyint(1) NOT NULL DEFAULT '0',
  `source` varchar(64) NOT NULL DEFAULT 'landing_publica',
  `locator` varchar(128) DEFAULT NULL,
  `origin_url` text,
  `ip_address` varchar(64) DEFAULT NULL,
  `form_language` varchar(8) DEFAULT 'es',
  `linked_reservation_id` int DEFAULT NULL,
  `linked_quote_id` int DEFAULT NULL,
  `linked_invoice_id` int DEFAULT NULL,
  `original_amount` decimal(10,2) DEFAULT NULL,
  `refundable_amount` decimal(10,2) DEFAULT NULL,
  `resolved_amount` decimal(10,2) DEFAULT NULL,
  `activity_type` varchar(128) DEFAULT NULL,
  `sale_channel` varchar(64) DEFAULT NULL,
  `invoice_ref` varchar(128) DEFAULT NULL,
  `operational_status` enum('recibida','en_revision','pendiente_documentacion','pendiente_decision','resuelta','cerrada','incidencia') NOT NULL DEFAULT 'recibida',
  `resolution_status` enum('sin_resolver','rechazada','aceptada_total','aceptada_parcial') NOT NULL DEFAULT 'sin_resolver',
  `financial_status` enum('sin_compensacion','pendiente_devolucion','devuelta_economicamente','pendiente_bono','compensada_bono','compensacion_mixta','incidencia_economica') NOT NULL DEFAULT 'sin_compensacion',
  `compensation_type` enum('ninguna','devolucion','bono','mixta') DEFAULT 'ninguna',
  `voucher_id` int DEFAULT NULL,
  `cancellation_number` varchar(32) DEFAULT NULL,
  `cancellation_scope` varchar(10) NOT NULL DEFAULT 'total',
  `cancelled_items_json` text,
  `admin_notes` text,
  `assigned_user_id` int DEFAULT NULL,
  `closed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `refund_executed_at` timestamp NULL DEFAULT NULL,
  `refund_proof_url` varchar(512) DEFAULT NULL,
  `ghl_contact_id` varchar(128) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `card_terminal_batch_audit_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `batch_id` int NOT NULL,
  `action` enum('match_suggested','match_auto_ready','match_no_candidate','match_review_required','suggestion_accepted','suggestion_rejected','auto_reconciled','manual_reconciled','unreconciled','review_flagged') NOT NULL,
  `bank_movement_id` int DEFAULT NULL,
  `score` int DEFAULT NULL,
  `auto_reconciled` tinyint(1) NOT NULL DEFAULT '0',
  `performed_by` varchar(128) DEFAULT NULL,
  `notes` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `card_terminal_batch_operations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `batch_id` int NOT NULL,
  `card_terminal_operation_id` int NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `operation_type` enum('VENTA','DEVOLUCION','ANULACION','OTRO') NOT NULL DEFAULT 'VENTA',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `card_terminal_batches` (
  `id` int NOT NULL AUTO_INCREMENT,
  `batch_date` varchar(12) NOT NULL,
  `commerce_code` varchar(64) DEFAULT NULL,
  `terminal_code` varchar(64) DEFAULT NULL,
  `currency` varchar(8) NOT NULL DEFAULT 'EUR',
  `total_sales` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_refunds` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_net` decimal(12,2) NOT NULL DEFAULT '0.00',
  `operation_count` int NOT NULL DEFAULT '0',
  `linked_operations_count` int NOT NULL DEFAULT '0',
  `status` enum('pending','suggested','auto_ready','reconciled','difference','ignored','review_required') NOT NULL DEFAULT 'pending',
  `bank_movement_id` int DEFAULT NULL,
  `reconciled_at` timestamp NULL DEFAULT NULL,
  `reconciled_by` varchar(128) DEFAULT NULL,
  `difference_amount` decimal(12,2) DEFAULT NULL,
  `notes` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `suggested_bank_movement_id` int DEFAULT NULL,
  `suggested_score` int DEFAULT NULL,
  `matching_run_at` timestamp NULL DEFAULT NULL,
  `suggestion_rejected` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `card_terminal_operations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `operation_datetime` timestamp NOT NULL,
  `operation_number` varchar(64) NOT NULL,
  `commerce_code` varchar(64) DEFAULT NULL,
  `terminal_code` varchar(64) DEFAULT NULL,
  `operation_type` enum('VENTA','DEVOLUCION','ANULACION','OTRO') NOT NULL DEFAULT 'VENTA',
  `amount` decimal(12,2) NOT NULL,
  `card` varchar(32) DEFAULT NULL,
  `authorization_code` varchar(32) DEFAULT NULL,
  `linked_entity_type` enum('reservation','quote','none') DEFAULT 'none',
  `linked_entity_id` int DEFAULT NULL,
  `linked_at` timestamp NULL DEFAULT NULL,
  `linked_by` varchar(128) DEFAULT NULL,
  `status` enum('pendiente','conciliado','incidencia','ignorado','included_in_batch','settled') NOT NULL DEFAULT 'pendiente',
  `incident_reason` text,
  `notes` text,
  `import_id` int DEFAULT NULL,
  `duplicate_key` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `card_terminal_operations_duplicate_key_unique` (`duplicate_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `cash_movements` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sessionId` int NOT NULL,
  `type_cm` enum('out','in') NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `reason` varchar(300) NOT NULL,
  `cashierName` varchar(200) DEFAULT NULL,
  `createdAt` bigint NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `cash_registers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `location` varchar(200) DEFAULT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` bigint NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `cash_sessions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `registerId` int NOT NULL,
  `cashierUserId` int NOT NULL,
  `cashierName` varchar(200) NOT NULL,
  `openingAmount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `closingAmount` decimal(10,2) DEFAULT NULL,
  `countedCash` decimal(10,2) DEFAULT NULL,
  `cashDifference` decimal(10,2) DEFAULT NULL,
  `totalCash` decimal(10,2) DEFAULT '0.00',
  `totalCard` decimal(10,2) DEFAULT '0.00',
  `totalBizum` decimal(10,2) DEFAULT '0.00',
  `totalMixed` decimal(10,2) DEFAULT '0.00',
  `totalManualOut` decimal(10,2) DEFAULT '0.00',
  `totalManualIn` decimal(10,2) DEFAULT '0.00',
  `status_cs` enum('open','closed') NOT NULL DEFAULT 'open',
  `notes` text,
  `openedAt` bigint NOT NULL,
  `closedAt` bigint DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `categories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(256) NOT NULL,
  `name` varchar(256) NOT NULL,
  `description` text,
  `imageUrl` text,
  `image1` text,
  `iconName` varchar(64) DEFAULT NULL,
  `sortOrder` int NOT NULL DEFAULT '0',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `categories_slug_unique` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `clients` (
  `id` int NOT NULL AUTO_INCREMENT,
  `leadId` int DEFAULT NULL,
  `source` varchar(64) NOT NULL DEFAULT 'lead',
  `name` varchar(256) NOT NULL,
  `email` varchar(256) NOT NULL,
  `phone` varchar(64) DEFAULT '',
  `company` varchar(256) DEFAULT '',
  `nif` varchar(64) DEFAULT '',
  `address` text,
  `city` varchar(128) DEFAULT '',
  `postalCode` varchar(16) DEFAULT '',
  `country` varchar(64) DEFAULT 'ES',
  `birthDate` varchar(10) DEFAULT NULL,
  `notes` text,
  `tags` json DEFAULT (_utf8mb4'[]'),
  `isConverted` tinyint(1) NOT NULL DEFAULT '0',
  `totalBookings` int NOT NULL DEFAULT '0',
  `totalSpent` decimal(10,2) DEFAULT '0.00',
  `lastBookingAt` timestamp NULL DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `clients_email_unique` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `commercial_communications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `quoteId` int NOT NULL,
  `customerEmail` varchar(320) DEFAULT NULL,
  `customerPhone` varchar(32) DEFAULT NULL,
  `type` enum('quote_sent','automatic_reminder','manual_reminder','payment_link_sent','internal_note','phone_call','whatsapp','lost_reason') NOT NULL,
  `channel` enum('email','phone','whatsapp','internal') NOT NULL DEFAULT 'email',
  `subject` varchar(500) DEFAULT NULL,
  `bodySnapshot` text,
  `ruleId` int DEFAULT NULL,
  `status` enum('sent','failed','skipped') NOT NULL DEFAULT 'sent',
  `errorMessage` text,
  `sentByUserId` int DEFAULT NULL,
  `sentAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `metadata` json DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_comm_quote_rule` (`quoteId`,`ruleId`,`type`),
  KEY `idx_comm_quoteId` (`quoteId`),
  KEY `idx_comm_sentAt` (`sentAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `commercial_emails` (
  `id` int NOT NULL AUTO_INCREMENT,
  `account_id` int NOT NULL,
  `message_id` varchar(512) NOT NULL,
  `in_reply_to` varchar(512) DEFAULT NULL,
  `from_email` varchar(320) NOT NULL,
  `from_name` varchar(255) DEFAULT NULL,
  `to_emails` json NOT NULL,
  `cc_emails` json NOT NULL,
  `subject` varchar(512) NOT NULL,
  `body_html` mediumtext,
  `body_text` mediumtext,
  `snippet` varchar(300) DEFAULT NULL,
  `sent_at` timestamp NULL DEFAULT NULL,
  `is_read` tinyint(1) NOT NULL DEFAULT '0',
  `is_answered` tinyint(1) NOT NULL DEFAULT '0',
  `is_archived` tinyint(1) NOT NULL DEFAULT '0',
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `is_sent` tinyint(1) NOT NULL DEFAULT '0',
  `folder` varchar(100) NOT NULL DEFAULT 'INBOX',
  `has_attachments` tinyint(1) NOT NULL DEFAULT '0',
  `attachments_meta` json DEFAULT NULL,
  `labels` json DEFAULT NULL,
  `assigned_user_id` int DEFAULT NULL,
  `linked_lead_id` int DEFAULT NULL,
  `linked_client_id` int DEFAULT NULL,
  `linked_quote_id` int DEFAULT NULL,
  `linked_reservation_id` int DEFAULT NULL,
  `imap_uid` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ce_msg_id` (`message_id`(255)),
  KEY `idx_ce_account` (`account_id`),
  KEY `idx_ce_sent_at` (`sent_at`),
  KEY `idx_ce_from_email` (`from_email`(100)),
  KEY `idx_ce_folder` (`folder`),
  KEY `idx_ce_is_read` (`is_read`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `commercial_followup_rules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(200) NOT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `delayHours` int NOT NULL DEFAULT '24',
  `triggerFrom` enum('quote_sent_at','last_reminder_at') NOT NULL DEFAULT 'quote_sent_at',
  `onlyIfNotViewed` tinyint(1) NOT NULL DEFAULT '0',
  `allowIfViewedButUnpaid` tinyint(1) NOT NULL DEFAULT '1',
  `maxSendsPerQuoteForThisRule` int NOT NULL DEFAULT '1',
  `emailSubject` varchar(500) NOT NULL,
  `emailBody` text NOT NULL,
  `sortOrder` int NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `commercial_followup_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `maxTotalRemindersPerQuote` int NOT NULL DEFAULT '3',
  `maxEmailsPerRun` int NOT NULL DEFAULT '50',
  `allowedSendStart` varchar(5) NOT NULL DEFAULT '09:00',
  `allowedSendEnd` varchar(5) NOT NULL DEFAULT '21:00',
  `timezone` varchar(50) NOT NULL DEFAULT 'Europe/Madrid',
  `stopAfterDays` int NOT NULL DEFAULT '30',
  `internalCcEmail` varchar(320) DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `compensation_vouchers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `request_id` int NOT NULL,
  `code` varchar(32) NOT NULL,
  `type` enum('actividad','servicio','monetario') NOT NULL DEFAULT 'actividad',
  `activity_id` int DEFAULT NULL,
  `activity_name` varchar(256) DEFAULT NULL,
  `value` decimal(10,2) NOT NULL,
  `currency` varchar(8) NOT NULL DEFAULT 'EUR',
  `issued_at` timestamp NOT NULL DEFAULT (now()),
  `expires_at` timestamp NULL DEFAULT NULL,
  `status` enum('generado','enviado','canjeado','caducado','anulado') NOT NULL DEFAULT 'generado',
  `pdf_url` text,
  `conditions` text,
  `notes` text,
  `sent_at` timestamp NULL DEFAULT NULL,
  `redeemed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `compensation_vouchers_code_unique` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `config_change_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `entity_type` enum('feature_flag','system_setting') NOT NULL,
  `key` varchar(128) NOT NULL,
  `old_value` text,
  `new_value` text,
  `changed_by_id` int DEFAULT NULL,
  `changed_by_name` varchar(128) DEFAULT NULL,
  `changed_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `idx_ccl_key` (`key`),
  KEY `idx_ccl_changed_at` (`changed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `cost_centers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(128) NOT NULL,
  `description` text,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `coupon_email_config` (
  `id` int NOT NULL AUTO_INCREMENT,
  `autoSendCouponReceived` tinyint(1) NOT NULL DEFAULT '1',
  `autoSendCouponValidated` tinyint(1) NOT NULL DEFAULT '1',
  `autoSendInternalAlert` tinyint(1) NOT NULL DEFAULT '1',
  `emailMode` enum('per_submission','per_coupon') NOT NULL DEFAULT 'per_submission',
  `internalAlertEmail` varchar(320) NOT NULL DEFAULT '',
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `coupon_redemptions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `provider` varchar(64) NOT NULL DEFAULT 'Groupon',
  `productTicketingId` int DEFAULT NULL,
  `productRealId` int DEFAULT NULL,
  `customerName` varchar(256) NOT NULL,
  `email` varchar(320) NOT NULL,
  `phone` varchar(32) DEFAULT NULL,
  `couponCode` varchar(128) NOT NULL,
  `securityCode` varchar(128) DEFAULT NULL,
  `attachmentUrl` mediumtext,
  `requestedDate` varchar(20) DEFAULT NULL,
  `station` varchar(128) DEFAULT NULL,
  `participants` int DEFAULT '1',
  `children` int DEFAULT '0',
  `comments` text,
  `statusOperational` enum('recibido','pendiente','reserva_generada') NOT NULL DEFAULT 'recibido',
  `statusFinancial` enum('pendiente_canjear','canjeado','incidencia') NOT NULL DEFAULT 'pendiente_canjear',
  `ocrConfidenceScore` int DEFAULT NULL,
  `ocrStatus` enum('alta','media','baja','conflicto') DEFAULT NULL,
  `ocrRawData` json DEFAULT NULL,
  `duplicateFlag` tinyint(1) NOT NULL DEFAULT '0',
  `duplicateNotes` text,
  `realAmount` decimal(10,2) DEFAULT NULL,
  `settlementJustificantUrl` text,
  `settledAt` timestamp NULL DEFAULT NULL,
  `reservationId` int DEFAULT NULL,
  `platformProductId` int DEFAULT NULL,
  `settlementId` int DEFAULT NULL,
  `submissionId` varchar(64) DEFAULT NULL,
  `originSource` enum('web','admin_manual_entry') NOT NULL DEFAULT 'web',
  `channelEntry` enum('web','email','whatsapp','telefono','presencial','manual') NOT NULL DEFAULT 'web',
  `createdByAdminId` int DEFAULT NULL,
  `adminUserId` int DEFAULT NULL,
  `notes` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `ghlContactId` varchar(128) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `crm_activity_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `entityType` enum('lead','quote','reservation','invoice') NOT NULL,
  `entityId` int NOT NULL,
  `action` varchar(128) NOT NULL,
  `actorId` int DEFAULT NULL,
  `actorName` varchar(256) DEFAULT NULL,
  `details` json DEFAULT (_utf8mb4'{}'),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `crm_lead_sources` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text,
  `color` varchar(20) DEFAULT NULL,
  `icon` varchar(50) DEFAULT NULL,
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `is_system` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `crm_lead_sources_code_unique` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `customer_email_prefs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(320) NOT NULL,
  `automationsPaused` tinyint(1) NOT NULL DEFAULT '0',
  `pauseReason` text,
  `pausedAt` timestamp NULL DEFAULT NULL,
  `pausedByUserId` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_cep_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `daily_orders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `date` timestamp NOT NULL,
  `bookingId` int NOT NULL,
  `title` varchar(256) NOT NULL,
  `description` text,
  `meetingPoint` text,
  `equipment` json DEFAULT (_utf8mb4'[]'),
  `specialInstructions` text,
  `status` enum('borrador','publicado','completado') NOT NULL DEFAULT 'borrador',
  `createdBy` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `discount_code_uses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `discount_code_id` int NOT NULL,
  `code_use` varchar(50) NOT NULL,
  `discount_percent_use` decimal(5,2) NOT NULL,
  `discount_amount` decimal(10,2) NOT NULL,
  `original_amount_use` decimal(10,2) NOT NULL,
  `final_amount` decimal(10,2) NOT NULL,
  `channel_dcu` enum('tpv','online','crm','delegated') NOT NULL,
  `reservation_id` int DEFAULT NULL,
  `tpv_sale_id` int DEFAULT NULL,
  `applied_by_user_id` varchar(100) DEFAULT NULL,
  `applied_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `discount_codes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(50) NOT NULL,
  `name` varchar(200) NOT NULL,
  `description` text,
  `discount_type` enum('percent','fixed') NOT NULL DEFAULT 'percent',
  `discount_percent` decimal(5,2) NOT NULL DEFAULT '0.00',
  `discount_amount` decimal(10,2) DEFAULT NULL,
  `expires_at` timestamp NULL DEFAULT NULL,
  `status` enum('active','inactive','expired') NOT NULL DEFAULT 'active',
  `max_uses` int DEFAULT NULL,
  `current_uses` int NOT NULL DEFAULT '0',
  `observations` text,
  `origin` enum('manual','voucher') NOT NULL DEFAULT 'manual',
  `compensation_voucher_id` int DEFAULT NULL,
  `client_email` varchar(256) DEFAULT NULL,
  `client_name` varchar(256) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `discount_codes_code_unique` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `document_counters` (
  `id` int NOT NULL AUTO_INCREMENT,
  `document_type` varchar(32) NOT NULL,
  `year` int NOT NULL,
  `current_number` int NOT NULL DEFAULT '0',
  `prefix` varchar(16) NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `document_number_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `document_type` varchar(32) NOT NULL,
  `document_number` varchar(64) NOT NULL,
  `year` int NOT NULL,
  `sequence` int NOT NULL,
  `generated_at` timestamp NOT NULL DEFAULT (now()),
  `generated_by` varchar(64) DEFAULT NULL,
  `context` varchar(128) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `email_accounts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `email` varchar(320) NOT NULL,
  `imap_host` varchar(255) NOT NULL DEFAULT '',
  `imap_port` int NOT NULL DEFAULT '993',
  `imap_secure` tinyint(1) NOT NULL DEFAULT '1',
  `imap_user` varchar(320) NOT NULL DEFAULT '',
  `imap_password_enc` text NOT NULL,
  `smtp_host` varchar(255) NOT NULL DEFAULT '',
  `smtp_port` int NOT NULL DEFAULT '587',
  `smtp_secure` tinyint(1) NOT NULL DEFAULT '0',
  `smtp_user` varchar(320) NOT NULL DEFAULT '',
  `smtp_password_enc` text NOT NULL,
  `from_name` varchar(255) NOT NULL DEFAULT '',
  `from_email` varchar(320) NOT NULL DEFAULT '',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `sync_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `sync_interval_min` int NOT NULL DEFAULT '5',
  `last_sync_at` timestamp NULL DEFAULT NULL,
  `last_sync_error` text,
  `folder_inbox` varchar(100) NOT NULL DEFAULT 'INBOX',
  `folder_sent` varchar(100) NOT NULL DEFAULT 'Sent',
  `folder_archive` varchar(100) NOT NULL DEFAULT 'Archive',
  `folder_trash` varchar(100) NOT NULL DEFAULT 'Trash',
  `max_emails_per_sync` int NOT NULL DEFAULT '50',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `email_automation_rules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `templateKey` varchar(128) NOT NULL,
  `name` varchar(256) NOT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `sortOrder` int NOT NULL DEFAULT '0',
  `delayHours` int NOT NULL DEFAULT '24',
  `calculateFrom` enum('trigger_time','last_reminder','created_at','viewed_at','expires_at') NOT NULL DEFAULT 'trigger_time',
  `conditionsJson` json DEFAULT NULL,
  `maxSendsPerEntity` int NOT NULL DEFAULT '1',
  `allowedSendStart` varchar(5) NOT NULL DEFAULT '09:00',
  `allowedSendEnd` varchar(5) NOT NULL DEFAULT '21:00',
  `stopIfConverted` tinyint(1) NOT NULL DEFAULT '1',
  `stopIfPaid` tinyint(1) NOT NULL DEFAULT '1',
  `emailSubject` varchar(512) DEFAULT NULL,
  `emailBody` text,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `onlyIfNotViewed` tinyint(1) NOT NULL DEFAULT '0',
  `allowIfViewedButUnpaid` tinyint(1) NOT NULL DEFAULT '1',
  `maxCumulativeSendsPerEntity` int DEFAULT NULL,
  `stopAfterDays` int DEFAULT NULL,
  `respectCommercialPause` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_ear_template_key` (`templateKey`),
  KEY `idx_ear_active` (`isActive`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `email_comm_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `leadId` int DEFAULT NULL,
  `quoteId` int DEFAULT NULL,
  `reservationId` int DEFAULT NULL,
  `relatedEntityType` varchar(64) DEFAULT NULL,
  `relatedEntityId` int DEFAULT NULL,
  `templateKey` varchar(128) DEFAULT NULL,
  `ruleId` int DEFAULT NULL,
  `triggerEvent` varchar(128) DEFAULT NULL,
  `channel` varchar(32) NOT NULL DEFAULT 'email',
  `recipientEmail` varchar(320) DEFAULT NULL,
  `ccEmail` varchar(320) DEFAULT NULL,
  `subject` varchar(512) DEFAULT NULL,
  `status` enum('sent','failed','skipped') NOT NULL DEFAULT 'sent',
  `provider` varchar(32) DEFAULT NULL,
  `errorMessage` text,
  `sentByUserId` int DEFAULT NULL,
  `isAutomatic` tinyint(1) NOT NULL DEFAULT '0',
  `skipReason` varchar(256) DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ecl_template` (`templateKey`),
  KEY `idx_ecl_entity` (`relatedEntityType`,`relatedEntityId`),
  KEY `idx_ecl_recipient` (`recipientEmail`(32)),
  KEY `idx_ecl_created` (`createdAt`),
  KEY `idx_ecl_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `email_ingestion_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `message_id` varchar(512) NOT NULL,
  `subject` varchar(512) DEFAULT NULL,
  `sender` varchar(255) DEFAULT NULL,
  `received_at` timestamp NULL DEFAULT NULL,
  `status` enum('ok','error','skipped') NOT NULL DEFAULT 'ok',
  `operations_inserted` int NOT NULL DEFAULT '0',
  `operations_duplicate` int NOT NULL DEFAULT '0',
  `error_message` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `parsing_strategy` varchar(16) DEFAULT NULL,
  `operations_detected` int NOT NULL DEFAULT '0',
  `operations_linked` int NOT NULL DEFAULT '0',
  `operations_failed` int NOT NULL DEFAULT '0',
  `retry_count` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `email_scheduled_jobs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `relatedEntityType` varchar(64) NOT NULL,
  `relatedEntityId` int NOT NULL,
  `templateKey` varchar(128) NOT NULL,
  `ruleId` int NOT NULL,
  `recipientEmail` varchar(320) DEFAULT NULL,
  `scheduledFor` timestamp NOT NULL,
  `status` enum('pending','sent','skipped','failed','cancelled') NOT NULL DEFAULT 'pending',
  `attempts` int NOT NULL DEFAULT '0',
  `lastAttemptAt` timestamp NULL DEFAULT NULL,
  `errorMessage` text,
  `skipReason` varchar(256) DEFAULT NULL,
  `lockedAt` timestamp NULL DEFAULT NULL,
  `metadataJson` json DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_esj_status_sched` (`status`,`scheduledFor`),
  KEY `idx_esj_entity` (`relatedEntityType`,`relatedEntityId`),
  KEY `idx_esj_template` (`templateKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `email_template_configs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `key` varchar(128) NOT NULL,
  `category` varchar(64) DEFAULT NULL,
  `friendlyName` varchar(256) DEFAULT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `sendToCustomer` tinyint(1) NOT NULL DEFAULT '1',
  `sendToAdmin` tinyint(1) NOT NULL DEFAULT '0',
  `adminCopyEmail` varchar(320) DEFAULT NULL,
  `customSubject` varchar(512) DEFAULT NULL,
  `notes` text,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `key` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `email_templates` (
  `id` varchar(100) NOT NULL,
  `name` varchar(200) NOT NULL,
  `description` text,
  `category` varchar(50) NOT NULL DEFAULT 'general',
  `recipient` varchar(20) NOT NULL DEFAULT 'cliente',
  `subject` varchar(300) NOT NULL,
  `header_image_url` text,
  `header_title` varchar(200) DEFAULT NULL,
  `header_subtitle` varchar(300) DEFAULT NULL,
  `body_html` text NOT NULL,
  `footer_text` text,
  `cta_label` varchar(100) DEFAULT NULL,
  `cta_url` text,
  `variables` text,
  `is_custom` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `expense_categories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(128) NOT NULL,
  `description` text,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `expense_email_ingestion_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `message_id` varchar(512) NOT NULL,
  `subject` varchar(512) DEFAULT NULL,
  `sender` varchar(256) DEFAULT NULL,
  `received_at` timestamp NULL DEFAULT NULL,
  `status` enum('processed','duplicated','invalid_subject','missing_amount','error') NOT NULL,
  `expense_id` int DEFAULT NULL,
  `amount_detected` decimal(12,2) DEFAULT NULL,
  `attachments_count` int NOT NULL DEFAULT '0',
  `error_message` text,
  `processed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_eeil_message_id` (`message_id`),
  KEY `idx_eeil_status` (`status`),
  KEY `idx_eeil_processed` (`processed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `expense_files` (
  `id` int NOT NULL AUTO_INCREMENT,
  `expenseId` int NOT NULL,
  `filePath` varchar(1024) NOT NULL,
  `fileName` varchar(256) DEFAULT NULL,
  `mimeType` varchar(128) DEFAULT NULL,
  `uploadedAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `expense_suppliers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(256) NOT NULL,
  `fiscalName` varchar(256) DEFAULT NULL,
  `vatNumber` varchar(32) DEFAULT NULL,
  `address` text,
  `email` varchar(320) DEFAULT NULL,
  `phone` varchar(32) DEFAULT NULL,
  `iban` varchar(64) DEFAULT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `expenses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `date` varchar(20) NOT NULL,
  `concept` varchar(512) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `categoryId` int NOT NULL,
  `supplierId` int DEFAULT NULL,
  `costCenterId` int NOT NULL,
  `paymentMethod` enum('cash','card','transfer','direct_debit','tpv_cash') NOT NULL DEFAULT 'transfer',
  `status` enum('pending','justified','accounted','conciliado') NOT NULL DEFAULT 'pending',
  `reservationId` int DEFAULT NULL,
  `productId` int DEFAULT NULL,
  `notes` text,
  `createdBy` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `source` varchar(32) NOT NULL DEFAULT 'manual',
  `emailMessageId` varchar(512) DEFAULT NULL,
  `emailFrom` varchar(256) DEFAULT NULL,
  `missingAttachment` tinyint(1) NOT NULL DEFAULT '0',
  `taxBase` decimal(12,2) DEFAULT NULL,
  `taxRate` decimal(5,2) NOT NULL DEFAULT '21.00',
  `taxAmount` decimal(12,2) DEFAULT NULL,
  `deductiblePercent` decimal(5,2) NOT NULL DEFAULT '100.00',
  `supplierNif` varchar(32) DEFAULT NULL,
  `supplierName` varchar(256) DEFAULT NULL,
  `retentionPercent` decimal(5,2) DEFAULT NULL,
  `retentionAmount` decimal(12,2) DEFAULT NULL,
  `invoiceType` enum('ordinaria','simplificada','intracomunitaria','importacion','exenta','sin_factura') NOT NULL DEFAULT 'ordinaria',
  `accrualDate` varchar(10) DEFAULT NULL,
  `fiscalReviewStatus` enum('pendiente','revisado') NOT NULL DEFAULT 'pendiente',
  `isOperational` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `experience_variants` (
  `id` int NOT NULL AUTO_INCREMENT,
  `experienceId` int NOT NULL,
  `name` varchar(128) NOT NULL,
  `description` text,
  `priceModifier` decimal(10,2) DEFAULT '0.00',
  `priceType` enum('fixed','percentage','per_person') NOT NULL DEFAULT 'fixed',
  `options` json DEFAULT (_utf8mb4'[]'),
  `isRequired` tinyint(1) NOT NULL DEFAULT '0',
  `sortOrder` int NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `experiences` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(256) NOT NULL,
  `title` varchar(256) NOT NULL,
  `shortDescription` text,
  `description` text,
  `categoryId` int NOT NULL,
  `locationId` int NOT NULL,
  `coverImageUrl` text,
  `image1` text,
  `image2` text,
  `image3` text,
  `image4` text,
  `gallery` json DEFAULT (_utf8mb4'[]'),
  `basePrice` decimal(10,2) NOT NULL,
  `currency` varchar(8) NOT NULL DEFAULT 'EUR',
  `duration` varchar(128) DEFAULT NULL,
  `minPersons` int DEFAULT '1',
  `maxPersons` int DEFAULT NULL,
  `difficulty` enum('facil','moderado','dificil','experto') DEFAULT 'facil',
  `includes` json DEFAULT (_utf8mb4'[]'),
  `excludes` json DEFAULT (_utf8mb4'[]'),
  `requirements` text,
  `discountPercent` decimal(5,2) DEFAULT NULL,
  `discountExpiresAt` timestamp NULL DEFAULT NULL,
  `fiscalRegime` enum('reav','general','mixed') NOT NULL DEFAULT 'general',
  `productType` enum('own','semi_own','third_party','actividad','alojamiento','restauracion','transporte','pack') NOT NULL DEFAULT 'actividad',
  `providerPercent` decimal(5,2) DEFAULT '0.00',
  `agencyMarginPercent` decimal(5,2) DEFAULT '0.00',
  `supplierId` int DEFAULT NULL,
  `supplierCommissionPercent` decimal(5,2) DEFAULT '0.00',
  `supplierCostType` enum('comision_sobre_venta','coste_fijo','porcentaje_margen','hibrido') DEFAULT 'comision_sobre_venta',
  `settlementFrequency` enum('semanal','quincenal','mensual','manual') DEFAULT 'manual',
  `isSettlable` tinyint(1) NOT NULL DEFAULT '0',
  `isFeatured` tinyint(1) NOT NULL DEFAULT '0',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `isPublished` tinyint(1) NOT NULL DEFAULT '1',
  `isPresentialSale` tinyint(1) NOT NULL DEFAULT '0',
  `has_time_slots` tinyint(1) NOT NULL DEFAULT '0',
  `sortOrder` int NOT NULL DEFAULT '0',
  `metaTitle` varchar(256) DEFAULT NULL,
  `metaDescription` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `pricing_type` enum('per_person','per_unit') NOT NULL DEFAULT 'per_person',
  `unit_capacity` int DEFAULT NULL,
  `max_units` int DEFAULT NULL,
  `taxRate` decimal(5,2) NOT NULL DEFAULT '21.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `experiences_slug_unique` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `feature_flags` (
  `id` int NOT NULL AUTO_INCREMENT,
  `key` varchar(128) NOT NULL,
  `name` varchar(256) NOT NULL,
  `description` text,
  `module` varchar(64) NOT NULL DEFAULT 'general',
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `default_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `risk_level` enum('low','medium','high') NOT NULL DEFAULT 'low',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `feature_flags_key_unique` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `fin_cash_accounts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(128) NOT NULL,
  `description` text,
  `type` enum('principal','secondary','petty_cash','other') NOT NULL DEFAULT 'principal',
  `current_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `initial_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `currency` varchar(8) NOT NULL DEFAULT 'EUR',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `fin_cash_alerts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `type` varchar(64) NOT NULL DEFAULT 'cash_difference',
  `severity_fca` enum('info','warning','critical') NOT NULL DEFAULT 'warning',
  `amount` decimal(12,2) DEFAULT NULL,
  `closure_id` int DEFAULT NULL,
  `session_id` int DEFAULT NULL,
  `message` text,
  `is_read` tinyint(1) NOT NULL DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `resolved_at` timestamp NULL DEFAULT NULL,
  `resolved_by` varchar(128) DEFAULT NULL,
  `resolution_notes` text,
  `resolution_action` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `fin_cash_closure_actions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `closure_id` int NOT NULL,
  `action_type_fcca` enum('review','adjustment_created','accepted_difference','note_added','alert_resolved') NOT NULL,
  `amount` decimal(12,2) DEFAULT NULL,
  `notes` text,
  `created_by_id` int DEFAULT NULL,
  `created_by_name` varchar(128) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `fin_cash_closures` (
  `id` int NOT NULL AUTO_INCREMENT,
  `account_id` int NOT NULL,
  `date` varchar(10) NOT NULL,
  `opening_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_income` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_expenses` decimal(12,2) NOT NULL DEFAULT '0.00',
  `closing_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `counted_amount` decimal(12,2) DEFAULT NULL,
  `difference` decimal(12,2) DEFAULT NULL,
  `status_fcc` enum('open','closed','reconciled','balanced','difference','reviewed','adjusted','accepted_difference') NOT NULL DEFAULT 'open',
  `notes` text,
  `closed_by` int DEFAULT NULL,
  `closed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `source_entity_type` varchar(32) DEFAULT NULL,
  `source_entity_id` int DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `fin_cash_movements` (
  `id` int NOT NULL AUTO_INCREMENT,
  `account_id` int NOT NULL,
  `date` varchar(10) NOT NULL,
  `type_fcm` enum('income','expense','transfer_in','transfer_out','opening_balance','adjustment') NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `concept` varchar(512) NOT NULL,
  `counterparty` varchar(256) DEFAULT NULL,
  `category` varchar(128) DEFAULT NULL,
  `related_entity_type` enum('reservation','expense','tpv_sale','bank_deposit','manual') DEFAULT 'manual',
  `related_entity_id` int DEFAULT NULL,
  `transfer_to_account_id` int DEFAULT NULL,
  `notes` text,
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `gallery_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `imageUrl` text NOT NULL,
  `fileKey` varchar(512) NOT NULL,
  `title` varchar(256) DEFAULT '',
  `category` varchar(128) NOT NULL DEFAULT 'General',
  `sortOrder` int NOT NULL DEFAULT '0',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `ghl_conversations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `ghlConversationId` varchar(64) NOT NULL,
  `ghlContactId` varchar(64) DEFAULT NULL,
  `locationId` varchar(64) DEFAULT NULL,
  `channel` varchar(32) NOT NULL DEFAULT 'whatsapp',
  `customerName` varchar(255) DEFAULT NULL,
  `phone` varchar(32) DEFAULT NULL,
  `email` varchar(320) DEFAULT NULL,
  `lastMessagePreview` text,
  `lastMessageAt` timestamp NULL DEFAULT NULL,
  `unreadCount` int NOT NULL DEFAULT '0',
  `inbox` varchar(64) DEFAULT NULL,
  `starred` tinyint(1) NOT NULL DEFAULT '0',
  `status` enum('new','open','pending','replied','closed') NOT NULL DEFAULT 'new',
  `assignedUserId` int DEFAULT NULL,
  `linkedQuoteId` int DEFAULT NULL,
  `linkedReservationId` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ghl_conv_id` (`ghlConversationId`),
  KEY `idx_ghl_conv_status` (`status`),
  KEY `idx_ghl_conv_lastMsg` (`lastMessageAt`),
  KEY `idx_ghl_conv_contact` (`ghlContactId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `ghl_messages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `ghlMessageId` varchar(64) NOT NULL,
  `ghlConversationId` varchar(64) NOT NULL,
  `direction` enum('inbound','outbound') NOT NULL DEFAULT 'inbound',
  `messageType` varchar(32) DEFAULT 'text',
  `body` text,
  `attachmentsJson` json DEFAULT NULL,
  `senderName` varchar(255) DEFAULT NULL,
  `sentAt` timestamp NULL DEFAULT NULL,
  `deliveryStatus` varchar(32) DEFAULT NULL,
  `rawPayloadJson` json DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ghl_msg_id` (`ghlMessageId`),
  KEY `idx_ghl_msg_conv` (`ghlConversationId`),
  KEY `idx_ghl_msg_sentAt` (`sentAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `ghl_webhook_events` (
  `id` int NOT NULL AUTO_INCREMENT,
  `eventId` varchar(128) DEFAULT NULL,
  `eventType` varchar(128) NOT NULL,
  `ghlConversationId` varchar(64) DEFAULT NULL,
  `ghlContactId` varchar(64) DEFAULT NULL,
  `locationId` varchar(64) DEFAULT NULL,
  `rawPayloadJson` json DEFAULT NULL,
  `processedStatus` enum('pending','processed','failed','ignored') NOT NULL DEFAULT 'pending',
  `errorMessage` text,
  `receivedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `processedAt` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ghl_event_id` (`eventId`),
  KEY `idx_ghl_evt_conv` (`ghlConversationId`),
  KEY `idx_ghl_evt_status` (`processedStatus`),
  KEY `idx_ghl_evt_received` (`receivedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `ghl_webhook_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `event` varchar(128) NOT NULL,
  `payload` json DEFAULT NULL,
  `status` enum('recibido','procesado','error') NOT NULL DEFAULT 'recibido',
  `errorMessage` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `home_module_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `module_key` varchar(64) NOT NULL,
  `experience_id` int NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` bigint NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `hr_bonus` (
  `id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int NOT NULL,
  `type` enum('bonus','comision','prima','gratificacion','anticipo','ajuste') NOT NULL DEFAULT 'bonus',
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `irpf_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `concept` varchar(256) NOT NULL,
  `notes` text,
  `paid_at` timestamp NULL DEFAULT NULL,
  `payment_method` enum('cash','transfer','payroll') DEFAULT NULL,
  `expense_id` int DEFAULT NULL,
  `cash_movement_id` int DEFAULT NULL,
  `included_in_payslip_id` int DEFAULT NULL,
  `status` enum('pendiente','pagado','anulado') NOT NULL DEFAULT 'pendiente',
  `fiscal_status` enum('pendiente','revisado','exportado','presentado') NOT NULL DEFAULT 'pendiente',
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_hr_bonus_employee` (`employee_id`),
  KEY `idx_hr_bonus_status` (`status`),
  KEY `idx_hr_bonus_paid_at` (`paid_at`),
  KEY `idx_hr_bonus_fiscal_status` (`fiscal_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `hr_irpf_ledger` (
  `id` int NOT NULL AUTO_INCREMENT,
  `period` varchar(7) NOT NULL,
  `employee_id` int NOT NULL,
  `taxable_base` decimal(12,2) NOT NULL DEFAULT '0.00',
  `retained_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `payslip_id` int DEFAULT NULL,
  `bonus_id` int DEFAULT NULL,
  `fiscal_status` enum('pendiente','revisado','exportado','presentado') NOT NULL DEFAULT 'pendiente',
  `notes` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `idx_hr_irpf_ledger_period` (`period`),
  KEY `idx_hr_irpf_ledger_employee` (`employee_id`,`period`),
  KEY `idx_hr_irpf_ledger_fiscal_status` (`fiscal_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `hr_leave_balance` (
  `id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int NOT NULL,
  `year` int NOT NULL,
  `accrued_days` decimal(5,1) NOT NULL DEFAULT '22.0',
  `notes` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_hr_leave_balance_employee_year` (`employee_id`,`year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `hr_leave_requests` (
  `id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int NOT NULL,
  `type` enum('vacaciones','asuntos_propios','baja_medica','permiso','otro') NOT NULL DEFAULT 'vacaciones',
  `from_date` date NOT NULL,
  `to_date` date NOT NULL,
  `days` decimal(5,1) NOT NULL DEFAULT '0.0',
  `status` enum('pendiente','aprobada','rechazada','cancelada') NOT NULL DEFAULT 'pendiente',
  `reason` text,
  `decision_reason` text,
  `approved_by` int DEFAULT NULL,
  `approved_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_hr_leave_requests_employee` (`employee_id`),
  KEY `idx_hr_leave_requests_status` (`status`),
  KEY `idx_hr_leave_requests_dates` (`from_date`,`to_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `hr_payroll_batches` (
  `id` int NOT NULL AUTO_INCREMENT,
  `period` varchar(7) NOT NULL,
  `status` enum('open','closed','exported') NOT NULL DEFAULT 'open',
  `fiscal_status` enum('pendiente','revisado','exportado','presentado') NOT NULL DEFAULT 'pendiente',
  `total_gross` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_irpf` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_ss_employee` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_net` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_ss_company_estimated` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_ss_company_real` decimal(12,2) DEFAULT NULL,
  `expense_ids_json` text,
  `notes` text,
  `closed_at` timestamp NULL DEFAULT NULL,
  `closed_by` int DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_hr_payroll_batches_period` (`period`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `hr_payslips` (
  `id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int NOT NULL,
  `period` varchar(7) NOT NULL,
  `gross_salary` decimal(12,2) NOT NULL DEFAULT '0.00',
  `irpf_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `ss_employee` decimal(12,2) NOT NULL DEFAULT '0.00',
  `net_salary` decimal(12,2) NOT NULL DEFAULT '0.00',
  `ss_company_estimated` decimal(12,2) NOT NULL DEFAULT '0.00',
  `ss_company_real` decimal(12,2) DEFAULT NULL,
  `batch_id` int DEFAULT NULL,
  `pdf_url` text,
  `pdf_key` varchar(512) DEFAULT NULL,
  `notes` text,
  `status` enum('borrador','registrada','pagada','anulada') NOT NULL DEFAULT 'borrador',
  `fiscal_status` enum('pendiente','revisado','exportado','presentado') NOT NULL DEFAULT 'pendiente',
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_hr_payslips_employee_period` (`employee_id`,`period`),
  KEY `idx_hr_payslips_period` (`period`),
  KEY `idx_hr_payslips_batch` (`batch_id`),
  KEY `idx_hr_payslips_fiscal_status` (`fiscal_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `hr_schedule_exceptions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int DEFAULT NULL,
  `date` date NOT NULL,
  `type` enum('festivo','vacaciones','baja','permiso','otro') NOT NULL DEFAULT 'festivo',
  `notes` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `idx_hr_schedule_exceptions_date` (`date`),
  KEY `idx_hr_schedule_exceptions_employee` (`employee_id`,`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `hr_schedule_templates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int NOT NULL,
  `weekday` tinyint NOT NULL,
  `start_time` varchar(5) NOT NULL,
  `end_time` varchar(5) NOT NULL,
  `valid_from` date DEFAULT NULL,
  `valid_until` date DEFAULT NULL,
  `notes` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_hr_schedule_templates_employee` (`employee_id`,`weekday`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `hr_settings` (
  `id` int NOT NULL DEFAULT '1',
  `ss_company_percent` decimal(5,2) NOT NULL DEFAULT '31.00',
  `default_holiday_days` int NOT NULL DEFAULT '22',
  `default_weekly_hours` decimal(5,2) NOT NULL DEFAULT '40.00',
  `irpf_default_percent` decimal(5,2) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `hr_ss_ledger` (
  `id` int NOT NULL AUTO_INCREMENT,
  `period` varchar(7) NOT NULL,
  `estimated_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `real_amount` decimal(12,2) DEFAULT NULL,
  `real_charged_at` timestamp NULL DEFAULT NULL,
  `bank_movement_id` int DEFAULT NULL,
  `batch_id` int DEFAULT NULL,
  `fiscal_status` enum('pendiente','revisado','exportado','presentado') NOT NULL DEFAULT 'pendiente',
  `notes` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_hr_ss_ledger_period` (`period`),
  KEY `idx_hr_ss_ledger_fiscal_status` (`fiscal_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `hr_time_clock` (
  `id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int NOT NULL,
  `clock_in_at` timestamp NOT NULL,
  `clock_out_at` timestamp NULL DEFAULT NULL,
  `source` enum('portal','admin','tablet','external') NOT NULL DEFAULT 'portal',
  `meta_json` text,
  `status` enum('open','closed','incomplete','edited','cancelled') NOT NULL DEFAULT 'open',
  `notes` text,
  `created_by` int DEFAULT NULL,
  `updated_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_hr_time_clock_employee_in` (`employee_id`,`clock_in_at`),
  KEY `idx_hr_time_clock_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `invoices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `invoiceNumber` varchar(32) NOT NULL,
  `quoteId` int DEFAULT NULL,
  `reservationId` int DEFAULT NULL,
  `clientName` varchar(256) NOT NULL,
  `clientEmail` varchar(320) NOT NULL,
  `clientPhone` varchar(32) DEFAULT NULL,
  `clientNif` varchar(32) DEFAULT NULL,
  `clientAddress` text,
  `itemsJson` json DEFAULT (_utf8mb4'[]'),
  `subtotal` decimal(10,2) NOT NULL,
  `taxRate` decimal(5,2) DEFAULT '21.00',
  `taxAmount` decimal(10,2) DEFAULT '0.00',
  `total` decimal(10,2) NOT NULL,
  `currency` varchar(8) NOT NULL DEFAULT 'EUR',
  `pdfUrl` text,
  `pdfKey` text,
  `status` enum('generada','enviada','cobrada','anulada','abonada') NOT NULL DEFAULT 'generada',
  `invoiceType` enum('factura','abono') NOT NULL DEFAULT 'factura',
  `paymentMethod` enum('redsys','transferencia','efectivo','otro','tarjeta_fisica','tarjeta_redsys') DEFAULT 'redsys',
  `paymentValidatedBy` int DEFAULT NULL,
  `paymentValidatedAt` timestamp NULL DEFAULT NULL,
  `transferProofUrl` text,
  `transferProofKey` text,
  `isAutomatic` tinyint(1) NOT NULL DEFAULT '1',
  `creditNoteForId` int DEFAULT NULL,
  `creditNoteReason` text,
  `sentAt` timestamp NULL DEFAULT NULL,
  `lastSentAt` timestamp NULL DEFAULT NULL,
  `sentCount` int NOT NULL DEFAULT '0',
  `issuedAt` timestamp NOT NULL DEFAULT (now()),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `taxBreakdown` json DEFAULT NULL,
  `partnerId` int DEFAULT NULL,
  `partnerBillingBatchId` int DEFAULT NULL,
  `discount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `discount_reason` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `invoices_invoiceNumber_unique` (`invoiceNumber`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `leads` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(256) NOT NULL,
  `email` varchar(320) NOT NULL,
  `phone` varchar(32) DEFAULT NULL,
  `company` varchar(256) DEFAULT NULL,
  `message` text,
  `experienceId` int DEFAULT NULL,
  `locationId` int DEFAULT NULL,
  `preferredDate` timestamp NULL DEFAULT NULL,
  `numberOfPersons` int DEFAULT NULL,
  `budget` decimal(10,2) DEFAULT NULL,
  `status` enum('nuevo','contactado','en_proceso','convertido','perdido') NOT NULL DEFAULT 'nuevo',
  `opportunityStatus` enum('nueva','enviada','ganada','perdida') NOT NULL DEFAULT 'nueva',
  `priority` enum('baja','media','alta') NOT NULL DEFAULT 'media',
  `lastContactAt` timestamp NULL DEFAULT NULL,
  `lostReason` text,
  `seenAt` timestamp NULL DEFAULT NULL,
  `internalNotes` json DEFAULT (_utf8mb4'[]'),
  `assignedTo` int DEFAULT NULL,
  `ghlContactId` varchar(128) DEFAULT NULL,
  `source` varchar(128) DEFAULT 'web',
  `selectedCategory` varchar(128) DEFAULT NULL,
  `selectedProduct` varchar(256) DEFAULT NULL,
  `activitiesJson` json DEFAULT NULL,
  `numberOfAdults` int DEFAULT NULL,
  `numberOfChildren` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `cart_metadata` json DEFAULT NULL,
  `partnerId` int DEFAULT NULL,
  `partnerUserId` int DEFAULT NULL,
  `lead_source_id` int DEFAULT NULL,
  `preferred_time` varchar(10) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_leads_lead_source_id` (`lead_source_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `lego_pack_lines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `legoPackId` int NOT NULL,
  `sourceType` enum('experience','pack') NOT NULL,
  `sourceId` int NOT NULL,
  `internalName` varchar(256) DEFAULT NULL,
  `groupLabel` varchar(128) DEFAULT NULL,
  `sortOrder` int NOT NULL DEFAULT '0',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `isRequired` tinyint(1) NOT NULL DEFAULT '1',
  `isOptional` tinyint(1) NOT NULL DEFAULT '0',
  `isClientEditable` tinyint(1) NOT NULL DEFAULT '0',
  `isClientVisible` tinyint(1) NOT NULL DEFAULT '1',
  `defaultQuantity` int NOT NULL DEFAULT '1',
  `isQuantityEditable` tinyint(1) NOT NULL DEFAULT '0',
  `discountType` enum('percent','fixed') NOT NULL DEFAULT 'percent',
  `discountValue` decimal(10,2) NOT NULL DEFAULT '0.00',
  `overridePrice` decimal(10,2) DEFAULT NULL,
  `overridePriceLabel` varchar(64) DEFAULT NULL,
  `frontendNote` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `lego_pack_snapshots` (
  `id` int NOT NULL AUTO_INCREMENT,
  `legoPackId` int NOT NULL,
  `legoPackTitle` varchar(256) NOT NULL,
  `operationType` enum('reservation','quote','tpv_sale','invoice') NOT NULL,
  `operationId` int NOT NULL,
  `linesSnapshot` json NOT NULL,
  `totalOriginal` decimal(12,2) NOT NULL,
  `totalDiscount` decimal(12,2) NOT NULL,
  `totalFinal` decimal(12,2) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `lego_packs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(256) NOT NULL,
  `title` varchar(256) NOT NULL,
  `subtitle` varchar(512) DEFAULT NULL,
  `shortDescription` text,
  `description` text,
  `coverImageUrl` text,
  `image1` text,
  `image2` text,
  `image3` text,
  `image4` text,
  `gallery` json DEFAULT (_utf8mb4'[]'),
  `badge` varchar(64) DEFAULT NULL,
  `priceLabel` varchar(128) DEFAULT NULL,
  `categoryId` int DEFAULT NULL,
  `category` enum('dia','escolar','empresa','estancia') NOT NULL DEFAULT 'dia',
  `targetAudience` varchar(256) DEFAULT NULL,
  `availabilityMode` enum('strict','flexible') NOT NULL DEFAULT 'strict',
  `discountPercent` decimal(5,2) DEFAULT NULL,
  `discountExpiresAt` timestamp NULL DEFAULT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `isPublished` tinyint(1) NOT NULL DEFAULT '0',
  `isFeatured` tinyint(1) NOT NULL DEFAULT '0',
  `isPresentialSale` tinyint(1) NOT NULL DEFAULT '1',
  `isOnlineSale` tinyint(1) NOT NULL DEFAULT '0',
  `sortOrder` int NOT NULL DEFAULT '0',
  `metaTitle` varchar(256) DEFAULT NULL,
  `metaDescription` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `lego_packs_slug_unique` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `locations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(256) NOT NULL,
  `name` varchar(256) NOT NULL,
  `description` text,
  `imageUrl` text,
  `address` text,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `sortOrder` int NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `locations_slug_unique` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `media_files` (
  `id` int NOT NULL AUTO_INCREMENT,
  `filename` varchar(256) NOT NULL,
  `originalName` varchar(256) NOT NULL,
  `url` text NOT NULL,
  `fileKey` text NOT NULL,
  `mimeType` varchar(128) NOT NULL,
  `size` int NOT NULL,
  `type` enum('image','video','document') NOT NULL DEFAULT 'image',
  `altText` text,
  `uploadedBy` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `menu_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `parentId` int DEFAULT NULL,
  `label` varchar(128) NOT NULL,
  `url` varchar(512) DEFAULT NULL,
  `target` enum('_self','_blank') NOT NULL DEFAULT '_self',
  `sortOrder` int NOT NULL DEFAULT '0',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `menuZone` enum('header','footer') NOT NULL DEFAULT 'header',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `monitor_documents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `monitor_id` int NOT NULL,
  `type` enum('dni','contrato','certificado','prl','formacion','nomina_pdf','baja_medica','finiquito','otro') NOT NULL,
  `name` varchar(255) NOT NULL,
  `file_url` text NOT NULL,
  `file_key` varchar(512) NOT NULL,
  `uploaded_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `expires_at` date DEFAULT NULL,
  `signed_by_employee_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_monitor_documents_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `monitor_payroll` (
  `id` int NOT NULL AUTO_INCREMENT,
  `monitor_id` int NOT NULL,
  `year` int NOT NULL,
  `month` int NOT NULL,
  `base_salary` decimal(10,2) NOT NULL DEFAULT '0.00',
  `extras` json DEFAULT (_utf8mb4'[]'),
  `total_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `status` enum('pendiente','pagado') NOT NULL DEFAULT 'pendiente',
  `paid_at` timestamp NULL DEFAULT NULL,
  `notes` text,
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `monitors` (
  `id` int NOT NULL AUTO_INCREMENT,
  `full_name` varchar(255) NOT NULL,
  `dni` varchar(20) DEFAULT NULL,
  `phone` varchar(30) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `address` text,
  `birth_date` timestamp NULL DEFAULT NULL,
  `photo_url` text,
  `photo_key` varchar(512) DEFAULT NULL,
  `emergency_name` varchar(255) DEFAULT NULL,
  `emergency_relation` varchar(128) DEFAULT NULL,
  `emergency_phone` varchar(30) DEFAULT NULL,
  `iban` varchar(34) DEFAULT NULL,
  `iban_holder` varchar(255) DEFAULT NULL,
  `contract_type` enum('indefinido','temporal','autonomo','practicas','otro') DEFAULT 'temporal',
  `contract_start` timestamp NULL DEFAULT NULL,
  `contract_end` timestamp NULL DEFAULT NULL,
  `contract_conditions` text,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `notes` text,
  `user_id` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `position` varchar(64) DEFAULT NULL,
  `department` varchar(64) DEFAULT NULL,
  `weekly_hours` decimal(5,2) DEFAULT NULL,
  `holiday_days_year` int DEFAULT '22',
  `nss` varchar(20) DEFAULT NULL,
  `irpf_percent` decimal(5,2) DEFAULT NULL,
  `cost_center_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_monitors_cost_center_id` (`cost_center_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `onboarding_status` (
  `id` int NOT NULL AUTO_INCREMENT,
  `organization_id` int NOT NULL,
  `business_info_completed` tinyint(1) NOT NULL DEFAULT '0',
  `fiscal_completed` tinyint(1) NOT NULL DEFAULT '0',
  `branding_completed` tinyint(1) NOT NULL DEFAULT '0',
  `emails_completed` tinyint(1) NOT NULL DEFAULT '0',
  `modules_completed` tinyint(1) NOT NULL DEFAULT '0',
  `integrations_reviewed` tinyint(1) NOT NULL DEFAULT '0',
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `onboarding_status_org_unique` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `organizations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(256) NOT NULL,
  `slug` varchar(128) NOT NULL,
  `status` enum('active','inactive','onboarding') NOT NULL DEFAULT 'onboarding',
  `owner_user_id` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `organizations_slug_unique` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `pack_cross_sells` (
  `id` int NOT NULL AUTO_INCREMENT,
  `packId` int NOT NULL,
  `relatedPackId` int NOT NULL,
  `sortOrder` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `packs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(256) NOT NULL,
  `category` enum('dia','escolar','empresa') NOT NULL,
  `title` varchar(256) NOT NULL,
  `subtitle` varchar(512) DEFAULT NULL,
  `shortDescription` text,
  `description` text,
  `includes` json DEFAULT (_utf8mb4'[]'),
  `excludes` json DEFAULT (_utf8mb4'[]'),
  `schedule` text,
  `note` text,
  `image1` text,
  `image2` text,
  `image3` text,
  `image4` text,
  `basePrice` decimal(10,2) NOT NULL DEFAULT '0.00',
  `priceLabel` varchar(128) DEFAULT NULL,
  `duration` varchar(128) DEFAULT NULL,
  `minPersons` int DEFAULT '1',
  `maxPersons` int DEFAULT NULL,
  `targetAudience` varchar(256) DEFAULT NULL,
  `badge` varchar(64) DEFAULT NULL,
  `hasStay` tinyint(1) NOT NULL DEFAULT '0',
  `isOnlinePurchase` tinyint(1) NOT NULL DEFAULT '0',
  `discountPercent` decimal(5,2) DEFAULT NULL,
  `discountExpiresAt` timestamp NULL DEFAULT NULL,
  `fiscalRegime` enum('reav','general','mixed') NOT NULL DEFAULT 'general',
  `productType` enum('own','semi_own','third_party','actividad','alojamiento','restauracion','transporte','pack') NOT NULL DEFAULT 'pack',
  `providerPercent` decimal(5,2) DEFAULT '0.00',
  `agencyMarginPercent` decimal(5,2) DEFAULT '0.00',
  `supplierId` int DEFAULT NULL,
  `supplierCommissionPercent` decimal(5,2) DEFAULT '0.00',
  `supplierCostType` enum('comision_sobre_venta','coste_fijo','porcentaje_margen','hibrido') DEFAULT 'comision_sobre_venta',
  `settlementFrequency` enum('semanal','quincenal','mensual','manual') DEFAULT 'manual',
  `isSettlable` tinyint(1) NOT NULL DEFAULT '0',
  `isFeatured` tinyint(1) NOT NULL DEFAULT '0',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `isPresentialSale` tinyint(1) NOT NULL DEFAULT '0',
  `sortOrder` int NOT NULL DEFAULT '0',
  `metaTitle` varchar(256) DEFAULT NULL,
  `metaDescription` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `taxRate` decimal(5,2) NOT NULL DEFAULT '21.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `packs_slug_unique` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `page_blocks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `pageSlug` varchar(256) NOT NULL,
  `blockType` varchar(64) NOT NULL,
  `sortOrder` int NOT NULL DEFAULT '0',
  `data` json NOT NULL,
  `isVisible` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `partner_allowed_products` (
  `id` int NOT NULL AUTO_INCREMENT,
  `partner_id` int NOT NULL,
  `product_id` int NOT NULL,
  `product_type` varchar(32) NOT NULL,
  `can_quote` tinyint(1) NOT NULL DEFAULT '1',
  `can_redeem` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pap_partner_id` (`partner_id`),
  KEY `idx_pap_product_id` (`product_id`),
  CONSTRAINT `fk_pap_partner` FOREIGN KEY (`partner_id`) REFERENCES `partners` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `partner_billing_batch_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `batchId` int NOT NULL,
  `reservationId` int NOT NULL,
  `amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `description` varchar(512) DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `partner_billing_batches` (
  `id` int NOT NULL AUTO_INCREMENT,
  `batchNumber` varchar(32) NOT NULL,
  `partnerId` int NOT NULL,
  `periodType` enum('weekly','biweekly','monthly','manual') NOT NULL DEFAULT 'monthly',
  `periodStart` varchar(10) NOT NULL,
  `periodEnd` varchar(10) NOT NULL,
  `totalAmount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `status` enum('borrador','emitida','cobrada','anulada') NOT NULL DEFAULT 'borrador',
  `invoiceId` int DEFAULT NULL,
  `notes` text,
  `createdBy` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_batch_number` (`batchNumber`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `partners` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(256) NOT NULL,
  `slug` varchar(128) NOT NULL,
  `fiscalName` varchar(256) DEFAULT NULL,
  `nif` varchar(32) DEFAULT NULL,
  `address` text,
  `city` varchar(128) DEFAULT NULL,
  `postalCode` varchar(16) DEFAULT NULL,
  `country` varchar(4) NOT NULL DEFAULT 'ES',
  `contactName` varchar(256) DEFAULT NULL,
  `contactEmail` varchar(320) DEFAULT NULL,
  `contactPhone` varchar(32) DEFAULT NULL,
  `billingEmail` varchar(320) DEFAULT NULL,
  `canCreateReservations` tinyint(1) NOT NULL DEFAULT '0',
  `canCreateLeads` tinyint(1) NOT NULL DEFAULT '1',
  `allowedReservationProductIds` json DEFAULT NULL,
  `allowedLeadProductIds` json DEFAULT NULL,
  `commissionType` enum('none','fixed_lead','fixed_reservation','percent','per_product','manual') NOT NULL DEFAULT 'none',
  `commissionValue` decimal(10,4) DEFAULT NULL,
  `billingEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `billingPeriod` enum('weekly','biweekly','monthly','manual') NOT NULL DEFAULT 'monthly',
  `monthlyQuota` int DEFAULT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `notes` text,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `announcements` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_partner_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `password_reset_tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `token` varchar(128) NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `usedAt` timestamp NULL DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `password_reset_tokens_token_unique` (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `payment_installments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `plan_id` int NOT NULL,
  `quote_id` int NOT NULL,
  `installment_number` int NOT NULL,
  `amount_cents` int NOT NULL,
  `due_date` varchar(20) NOT NULL,
  `status` enum('pending','paid','overdue','cancelled') NOT NULL DEFAULT 'pending',
  `is_required_for_confirmation` tinyint(1) NOT NULL DEFAULT '0',
  `merchant_order` varchar(30) DEFAULT NULL,
  `reservation_id` int DEFAULT NULL,
  `payment_method` varchar(32) DEFAULT NULL,
  `paidAt` timestamp NULL DEFAULT NULL,
  `paid_by` varchar(128) DEFAULT NULL,
  `reminders_sent` int NOT NULL DEFAULT '0',
  `lastReminderAt` timestamp NULL DEFAULT NULL,
  `notes` text,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pi_plan` (`plan_id`),
  KEY `idx_pi_quote` (`quote_id`),
  KEY `idx_pi_merchant` (`merchant_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `payment_plans` (
  `id` int NOT NULL AUTO_INCREMENT,
  `quote_id` int NOT NULL,
  `plan_type` enum('full','installment') NOT NULL DEFAULT 'installment',
  `total_amount_cents` int NOT NULL,
  `created_by` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pp_quote` (`quote_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `pdf_templates` (
  `id` varchar(100) NOT NULL,
  `name` varchar(200) NOT NULL,
  `description` text,
  `category` varchar(50) NOT NULL DEFAULT 'general',
  `logo_url` text,
  `header_color` varchar(20) DEFAULT '#0a1628',
  `accent_color` varchar(20) DEFAULT '#f97316',
  `company_name` varchar(200) DEFAULT NULL,
  `company_address` text,
  `company_phone` varchar(50) DEFAULT NULL,
  `company_email` varchar(200) DEFAULT NULL,
  `company_nif` varchar(50) DEFAULT NULL,
  `footer_text` text,
  `legal_text` text,
  `show_logo` tinyint(1) NOT NULL DEFAULT '1',
  `show_watermark` tinyint(1) NOT NULL DEFAULT '0',
  `body_html` text NOT NULL,
  `variables` text,
  `is_custom` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `pending_payments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `quote_id` int NOT NULL,
  `reservation_id` int DEFAULT NULL,
  `client_name` varchar(255) NOT NULL,
  `client_email` varchar(255) DEFAULT NULL,
  `client_phone` varchar(64) DEFAULT NULL,
  `product_name` varchar(255) DEFAULT NULL,
  `amount_cents` int NOT NULL,
  `due_date` varchar(32) NOT NULL,
  `reason` text NOT NULL,
  `pp_status` enum('pending','paid','cancelled','incidentado') NOT NULL DEFAULT 'pending',
  `payment_method` varchar(32) DEFAULT NULL,
  `payment_note` text,
  `transfer_proof_url` text,
  `paid_at` bigint DEFAULT NULL,
  `reminder_sent_at` bigint DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` bigint NOT NULL,
  `updated_at` bigint NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `platform_products` (
  `id` int NOT NULL AUTO_INCREMENT,
  `platform_id` int NOT NULL,
  `experience_id` int DEFAULT NULL,
  `external_link` text,
  `external_product_name` varchar(256) DEFAULT NULL,
  `pvp_price` decimal(10,2) DEFAULT NULL,
  `net_price` decimal(10,2) DEFAULT NULL,
  `expires_at` timestamp NULL DEFAULT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `platform_settlements` (
  `id` int NOT NULL AUTO_INCREMENT,
  `platform_id` int NOT NULL,
  `period_label` varchar(64) NOT NULL,
  `period_from` varchar(20) DEFAULT NULL,
  `period_to` varchar(20) DEFAULT NULL,
  `total_coupons` int NOT NULL DEFAULT '0',
  `total_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `status` enum('pendiente','emitida','pagada') NOT NULL DEFAULT 'pendiente',
  `justificant_url` text,
  `invoice_ref` varchar(128) DEFAULT NULL,
  `coupon_ids` json DEFAULT (_utf8mb4'[]'),
  `net_total` decimal(10,2) DEFAULT '0.00',
  `notes` text,
  `emitted_at` timestamp NULL DEFAULT NULL,
  `paid_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `platforms` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(128) NOT NULL,
  `slug` varchar(64) NOT NULL,
  `logo_url` text,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `settlement_frequency` enum('quincenal','mensual','trimestral') NOT NULL DEFAULT 'mensual',
  `commission_pct` decimal(5,2) DEFAULT '20.00',
  `external_url` text,
  `notes` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `platforms_slug_unique` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `product_time_slots` (
  `id` int NOT NULL AUTO_INCREMENT,
  `product_id` int NOT NULL,
  `type` enum('fixed','flexible','range') NOT NULL DEFAULT 'fixed',
  `label` varchar(128) NOT NULL,
  `start_time` varchar(10) DEFAULT NULL,
  `end_time` varchar(10) DEFAULT NULL,
  `days_of_week` varchar(32) DEFAULT NULL,
  `capacity` int DEFAULT NULL,
  `price_override` decimal(10,2) DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `proposal_options` (
  `id` int NOT NULL AUTO_INCREMENT,
  `proposalId` int NOT NULL,
  `title` varchar(256) NOT NULL,
  `description` text,
  `items` json DEFAULT NULL,
  `subtotal` decimal(10,2) NOT NULL DEFAULT '0.00',
  `discount` decimal(10,2) DEFAULT '0.00',
  `tax` decimal(10,2) DEFAULT '0.00',
  `total` decimal(10,2) NOT NULL DEFAULT '0.00',
  `isRecommended` tinyint(1) NOT NULL DEFAULT '0',
  `sortOrder` int NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_proposal_options_proposalId` (`proposalId`),
  CONSTRAINT `fk_proposal_options_proposal` FOREIGN KEY (`proposalId`) REFERENCES `proposals` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `proposals` (
  `id` int NOT NULL AUTO_INCREMENT,
  `proposalNumber` varchar(32) NOT NULL,
  `leadId` int NOT NULL,
  `agentId` int NOT NULL,
  `title` varchar(256) NOT NULL,
  `description` text,
  `mode` enum('configurable','multi_option') NOT NULL DEFAULT 'configurable',
  `items` json DEFAULT NULL,
  `subtotal` decimal(10,2) NOT NULL DEFAULT '0.00',
  `discount` decimal(10,2) DEFAULT '0.00',
  `tax` decimal(10,2) DEFAULT '0.00',
  `total` decimal(10,2) NOT NULL DEFAULT '0.00',
  `currency` varchar(8) NOT NULL DEFAULT 'EUR',
  `status` enum('borrador','enviado','visualizado','aceptado','rechazado','expirado') NOT NULL DEFAULT 'borrador',
  `token` varchar(128) DEFAULT NULL,
  `publicUrl` text,
  `validUntil` timestamp NULL DEFAULT NULL,
  `conditions` text,
  `notes` text,
  `sentAt` timestamp NULL DEFAULT NULL,
  `viewedAt` timestamp NULL DEFAULT NULL,
  `acceptedAt` timestamp NULL DEFAULT NULL,
  `selectedOptionId` int DEFAULT NULL,
  `convertedToQuoteId` int DEFAULT NULL,
  `ghlOpportunityId` varchar(128) DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `proposals_proposalNumber_unique` (`proposalNumber`),
  UNIQUE KEY `token` (`token`),
  KEY `idx_proposals_leadId` (`leadId`),
  KEY `idx_proposals_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `quote_commercial_tracking` (
  `id` int NOT NULL AUTO_INCREMENT,
  `quoteId` int NOT NULL,
  `commercialStatus` enum('pending_followup','reminder_1_sent','reminder_2_sent','reminder_3_sent','interested','paused','lost','converted','discarded') NOT NULL DEFAULT 'pending_followup',
  `reminderPaused` tinyint(1) NOT NULL DEFAULT '0',
  `reminderPausedReason` text,
  `reminderCount` int NOT NULL DEFAULT '0',
  `lastReminderAt` timestamp NULL DEFAULT NULL,
  `nextFollowupAt` timestamp NULL DEFAULT NULL,
  `lastContactAt` timestamp NULL DEFAULT NULL,
  `lastContactChannel` enum('email','phone','whatsapp','internal') DEFAULT NULL,
  `lostReason` text,
  `internalNotes` text,
  `assignedToUserId` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `quoteId` (`quoteId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `quote_internal_notes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `quoteId` int NOT NULL,
  `channel` enum('email','phone','whatsapp','internal') NOT NULL DEFAULT 'internal',
  `body` text NOT NULL,
  `authorUserId` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `idx_quote_internal_notes_quoteId` (`quoteId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `quotes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `quoteNumber` varchar(32) NOT NULL,
  `leadId` int NOT NULL,
  `agentId` int NOT NULL,
  `title` varchar(256) NOT NULL,
  `description` text,
  `items` json DEFAULT (_utf8mb4'[]'),
  `subtotal` decimal(10,2) NOT NULL,
  `discount` decimal(10,2) DEFAULT '0.00',
  `tax` decimal(10,2) DEFAULT '0.00',
  `total` decimal(10,2) NOT NULL,
  `currency` varchar(8) NOT NULL DEFAULT 'EUR',
  `validUntil` timestamp NULL DEFAULT NULL,
  `activity_date` varchar(20) DEFAULT NULL,
  `status` enum('borrador','enviado','visualizado','aceptado','convertido_carrito','pago_fallido','pagado','convertido_reserva','facturado','rechazado','expirado','perdido') NOT NULL DEFAULT 'borrador',
  `sentAt` timestamp NULL DEFAULT NULL,
  `viewedAt` timestamp NULL DEFAULT NULL,
  `acceptedAt` timestamp NULL DEFAULT NULL,
  `conditions` text,
  `redsysOrderId` varchar(32) DEFAULT NULL,
  `invoiceNumber` varchar(32) DEFAULT NULL,
  `invoicePdfUrl` text,
  `invoiceGeneratedAt` timestamp NULL DEFAULT NULL,
  `transfer_proof_url` text,
  `transfer_proof_key` text,
  `transfer_confirmed_at` timestamp NULL DEFAULT NULL,
  `transfer_confirmed_by` varchar(255) DEFAULT NULL,
  `payment_method` enum('redsys','transferencia','efectivo','otro','tarjeta_fisica','tarjeta_redsys') DEFAULT NULL,
  `paymentLinkToken` varchar(128) DEFAULT NULL,
  `paymentLinkUrl` text,
  `paidAt` timestamp NULL DEFAULT NULL,
  `notes` text,
  `isAutoGenerated` tinyint(1) NOT NULL DEFAULT '0',
  `reminderCount` int DEFAULT '0',
  `lastReminderAt` timestamp NULL DEFAULT NULL,
  `ghlOpportunityId` varchar(128) DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `payment_plan_id` int DEFAULT NULL,
  `partnerId` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `quotes_quoteNumber_unique` (`quoteNumber`),
  UNIQUE KEY `quotes_paymentLinkToken_unique` (`paymentLinkToken`),
  KEY `idx_quotes_partner_id` (`partnerId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `reav_costs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `expedientId` int NOT NULL,
  `description` varchar(256) NOT NULL,
  `providerName` varchar(256) DEFAULT NULL,
  `providerNif` varchar(64) DEFAULT NULL,
  `invoiceRef` varchar(128) DEFAULT NULL,
  `invoiceDate` varchar(10) DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL,
  `currency` varchar(8) NOT NULL DEFAULT 'EUR',
  `category` enum('transporte','alojamiento','actividad','restauracion','guia','seguro','otros') NOT NULL DEFAULT 'otros',
  `isPaid` tinyint(1) NOT NULL DEFAULT '0',
  `paidAt` timestamp NULL DEFAULT NULL,
  `notes` text,
  `createdBy` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `includes_vat` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `reav_documents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `expedientId` int NOT NULL,
  `side` enum('client','provider') NOT NULL,
  `docType` enum('factura_emitida','factura_recibida','contrato','voucher','confirmacion_proveedor','otro') NOT NULL DEFAULT 'otro',
  `title` varchar(256) NOT NULL,
  `fileUrl` text,
  `fileKey` text,
  `mimeType` varchar(128) DEFAULT NULL,
  `fileSize` int DEFAULT NULL,
  `notes` text,
  `uploadedBy` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `reav_expedients` (
  `id` int NOT NULL AUTO_INCREMENT,
  `expedientNumber` varchar(32) NOT NULL,
  `invoiceId` int DEFAULT NULL,
  `reservationId` int DEFAULT NULL,
  `clientId` int DEFAULT NULL,
  `agentId` int DEFAULT NULL,
  `serviceDescription` text,
  `serviceDate` varchar(10) DEFAULT NULL,
  `serviceEndDate` varchar(10) DEFAULT NULL,
  `destination` varchar(256) DEFAULT NULL,
  `numberOfPax` int DEFAULT '1',
  `saleAmountTotal` decimal(10,2) DEFAULT '0.00',
  `providerCostEstimated` decimal(10,2) DEFAULT '0.00',
  `providerCostReal` decimal(10,2) DEFAULT '0.00',
  `agencyMarginEstimated` decimal(10,2) DEFAULT '0.00',
  `agencyMarginReal` decimal(10,2) DEFAULT '0.00',
  `reavTaxBase` decimal(10,2) DEFAULT '0.00',
  `reavTaxAmount` decimal(10,2) DEFAULT '0.00',
  `fiscalStatus` enum('pendiente_documentacion','documentacion_completa','en_revision','cerrado','anulado') NOT NULL DEFAULT 'pendiente_documentacion',
  `operativeStatus` enum('abierto','en_proceso','cerrado','anulado') NOT NULL DEFAULT 'abierto',
  `clientName` varchar(256) DEFAULT NULL,
  `clientEmail` varchar(256) DEFAULT NULL,
  `clientPhone` varchar(64) DEFAULT NULL,
  `clientDni` varchar(64) DEFAULT NULL,
  `clientAddress` varchar(512) DEFAULT NULL,
  `channel` enum('tpv','online','crm','manual') DEFAULT 'manual',
  `sourceRef` varchar(128) DEFAULT NULL,
  `tpvSaleId` int DEFAULT NULL,
  `quoteId` int DEFAULT NULL,
  `internalNotes` text,
  `closedAt` timestamp NULL DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `reav_expedients_expedientNumber_unique` (`expedientNumber`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `recurring_expenses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `concept` varchar(512) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `categoryId` int NOT NULL,
  `costCenterId` int NOT NULL,
  `supplierId` int DEFAULT NULL,
  `recurrenceType` enum('monthly','weekly','yearly') NOT NULL DEFAULT 'monthly',
  `nextExecutionDate` varchar(20) NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `isOperational` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `reservation_operational` (
  `id` int NOT NULL AUTO_INCREMENT,
  `reservation_id` int NOT NULL,
  `reservation_type` enum('activity','restaurant','hotel','spa','pack') NOT NULL DEFAULT 'activity',
  `client_confirmed` tinyint(1) NOT NULL DEFAULT '0',
  `client_confirmed_at` timestamp NULL DEFAULT NULL,
  `client_confirmed_by` int DEFAULT NULL,
  `arrival_time` varchar(10) DEFAULT NULL,
  `op_notes` text,
  `monitor_id` int DEFAULT NULL,
  `op_status` enum('pendiente','confirmado','incidencia','completado','anulado') NOT NULL DEFAULT 'pendiente',
  `updated_by` int DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `activities_op_json` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `reservation_operational_reservation_id_unique` (`reservation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `reservations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `product_id` int NOT NULL,
  `product_name` varchar(255) NOT NULL,
  `booking_date` varchar(20) NOT NULL,
  `people` int NOT NULL DEFAULT '1',
  `extras_json` text,
  `amount_total` int NOT NULL,
  `amount_paid` int DEFAULT '0',
  `status` enum('draft','pending_payment','paid','failed','cancelled') NOT NULL DEFAULT 'draft',
  `customer_name` varchar(255) NOT NULL,
  `customer_email` varchar(255) DEFAULT NULL,
  `customer_phone` varchar(50) DEFAULT NULL,
  `merchant_order` varchar(30) NOT NULL,
  `redsys_response` text,
  `redsys_ds_response` varchar(10) DEFAULT NULL,
  `notes` text,
  `quote_id` int DEFAULT NULL,
  `quoteSource` varchar(32) DEFAULT NULL,
  `invoiceId` int DEFAULT NULL,
  `invoiceNumber` varchar(32) DEFAULT NULL,
  `paymentMethod` enum('redsys','transferencia','efectivo','otro','tarjeta_fisica','tarjeta_redsys') DEFAULT NULL,
  `paymentValidatedBy` int DEFAULT NULL,
  `paymentValidatedAt` bigint DEFAULT NULL,
  `transferProofUrl` text,
  `channel` enum('ONLINE_DIRECTO','ONLINE_ASISTIDO','VENTA_DELEGADA','TELEFONO','EMAIL','TPV_FISICO','PARTNER','TICKETING','MANUAL','API') DEFAULT 'ONLINE_DIRECTO',
  `channel_detail` varchar(128) DEFAULT NULL,
  `origin_source` varchar(64) DEFAULT NULL,
  `platform_name` varchar(128) DEFAULT NULL,
  `redemption_id` int DEFAULT NULL,
  `status_reservation` enum('PENDIENTE_CONFIRMACION','CONFIRMADA','EN_CURSO','FINALIZADA','NO_SHOW','ANULADA') DEFAULT 'PENDIENTE_CONFIRMACION',
  `status_payment` enum('PENDIENTE','PAGO_PARCIAL','PENDIENTE_VALIDACION','PAGADO') DEFAULT 'PENDIENTE',
  `date_changed_reason` text,
  `date_modified` tinyint(1) DEFAULT '0',
  `changes_log` json DEFAULT (_utf8mb4'[]'),
  `created_at` bigint NOT NULL,
  `updated_at` bigint NOT NULL,
  `paid_at` bigint DEFAULT NULL,
  `selected_time_slot_id` int DEFAULT NULL,
  `selected_time` varchar(10) DEFAULT NULL,
  `reav_expedient_id` int DEFAULT NULL,
  `reservation_number` varchar(32) DEFAULT NULL,
  `cancellation_request_id` int DEFAULT NULL,
  `pricing_type` varchar(16) DEFAULT NULL,
  `unit_capacity` int DEFAULT NULL,
  `units_booked` int DEFAULT NULL,
  `partner_id` int DEFAULT NULL,
  `partner_user_id` int DEFAULT NULL,
  `fbp` varchar(255) DEFAULT NULL,
  `fbc` varchar(255) DEFAULT NULL,
  `client_ip_address` varchar(45) DEFAULT NULL,
  `client_user_agent` varchar(500) DEFAULT NULL,
  `invoice_exempt` tinyint(1) NOT NULL DEFAULT '0',
  `public_token` varchar(128) DEFAULT NULL,
  `delegation_proof_url` text,
  `delegation_proof_key` varchar(512) DEFAULT NULL,
  `delegation_note` text,
  `discount_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `discount_reason` varchar(255) DEFAULT NULL,
  `confirmation_email_sent_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `reservations_reservation_number_unique` (`reservation_number`),
  KEY `idx_reservations_partner_id` (`partner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `restaurant_booking_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bookingId` int NOT NULL,
  `action` varchar(128) NOT NULL,
  `details` text,
  `userId` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `restaurant_bookings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `locator` varchar(16) NOT NULL,
  `restaurantId` int NOT NULL,
  `shiftId` int NOT NULL,
  `date` varchar(10) NOT NULL,
  `time` varchar(5) NOT NULL,
  `guests` int NOT NULL,
  `depositAmount` decimal(8,2) NOT NULL,
  `guestName` varchar(256) NOT NULL,
  `guestLastName` varchar(256) DEFAULT NULL,
  `guestEmail` varchar(320) NOT NULL,
  `guestPhone` varchar(32) DEFAULT NULL,
  `highchair` tinyint(1) DEFAULT '0',
  `allergies` text,
  `birthday` tinyint(1) DEFAULT '0',
  `specialRequests` text,
  `accessibility` tinyint(1) DEFAULT '0',
  `isVip` tinyint(1) DEFAULT '0',
  `status` enum('pending_payment','confirmed','payment_failed','cancelled','modified','no_show','completed') NOT NULL DEFAULT 'pending_payment',
  `cancellationReason` text,
  `adminNotes` text,
  `channel` enum('web','manual','admin') NOT NULL DEFAULT 'web',
  `createdByUserId` int DEFAULT NULL,
  `paymentStatus` enum('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending',
  `paymentTransactionId` varchar(256) DEFAULT NULL,
  `paymentMethod` varchar(64) DEFAULT NULL,
  `merchantOrder` varchar(32) DEFAULT NULL,
  `paidAt` timestamp NULL DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `restaurant_bookings_locator_unique` (`locator`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `restaurant_closures` (
  `id` int NOT NULL AUTO_INCREMENT,
  `restaurantId` int NOT NULL,
  `date` varchar(10) NOT NULL,
  `shiftId` int DEFAULT NULL,
  `reason` varchar(512) DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `restaurant_shifts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `restaurantId` int NOT NULL,
  `name` varchar(128) NOT NULL,
  `startTime` varchar(5) NOT NULL,
  `endTime` varchar(5) NOT NULL,
  `maxCapacity` int NOT NULL,
  `daysOfWeek` json DEFAULT (_utf8mb4'[0,1,2,3,4,5,6]'),
  `slotMinutes` int NOT NULL DEFAULT '30',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `sortOrder` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `restaurant_staff` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `restaurantId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `restaurants` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(128) NOT NULL,
  `name` varchar(256) NOT NULL,
  `shortDesc` text,
  `longDesc` text,
  `cuisine` varchar(256) DEFAULT NULL,
  `heroImage` text,
  `galleryImages` json DEFAULT (_utf8mb4'[]'),
  `menuUrl` text,
  `phone` varchar(32) DEFAULT NULL,
  `email` varchar(320) DEFAULT NULL,
  `location` varchar(512) DEFAULT NULL,
  `badge` varchar(128) DEFAULT NULL,
  `depositPerGuest` decimal(8,2) NOT NULL DEFAULT '5.00',
  `maxGroupSize` int NOT NULL DEFAULT '20',
  `minAdvanceHours` int NOT NULL DEFAULT '2',
  `maxAdvanceDays` int NOT NULL DEFAULT '60',
  `cancellationHours` int NOT NULL DEFAULT '24',
  `cancellationPolicy` text,
  `legalText` text,
  `operativeEmail` varchar(320) DEFAULT NULL,
  `acceptsOnlineBooking` tinyint(1) NOT NULL DEFAULT '1',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `sortOrder` int NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `restaurants_slug_unique` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `reviews` (
  `id` int NOT NULL AUTO_INCREMENT,
  `entityType` enum('hotel','spa','experience','pack','restaurant') NOT NULL,
  `entityId` int NOT NULL,
  `authorName` varchar(256) NOT NULL,
  `authorEmail` varchar(320) DEFAULT NULL,
  `rating` int NOT NULL,
  `title` varchar(256) DEFAULT NULL,
  `body` text NOT NULL,
  `status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `adminReply` text,
  `adminRepliedAt` timestamp NULL DEFAULT NULL,
  `stayDate` varchar(10) DEFAULT NULL,
  `verifiedBooking` tinyint(1) NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `room_blocks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `roomTypeId` int NOT NULL,
  `date` varchar(10) NOT NULL,
  `availableUnits` int NOT NULL DEFAULT '0',
  `reason` varchar(256) DEFAULT NULL,
  `createdBy` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `room_rate_seasons` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(128) NOT NULL,
  `startDate` varchar(10) NOT NULL,
  `endDate` varchar(10) NOT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `sortOrder` int NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `room_rates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `roomTypeId` int NOT NULL,
  `seasonId` int DEFAULT NULL,
  `dayOfWeek` int DEFAULT NULL,
  `specificDate` varchar(10) DEFAULT NULL,
  `pricePerNight` decimal(10,2) NOT NULL,
  `currency` varchar(8) NOT NULL DEFAULT 'EUR',
  `supplement` decimal(10,2) DEFAULT '0.00',
  `supplementLabel` varchar(128) DEFAULT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `room_types` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(256) NOT NULL,
  `name` varchar(256) NOT NULL,
  `shortDescription` text,
  `description` text,
  `coverImageUrl` text,
  `image1` text,
  `image2` text,
  `image3` text,
  `image4` text,
  `gallery` json DEFAULT (_utf8mb4'[]'),
  `maxAdults` int NOT NULL DEFAULT '2',
  `maxChildren` int NOT NULL DEFAULT '0',
  `maxOccupancy` int NOT NULL DEFAULT '2',
  `surfaceM2` int DEFAULT NULL,
  `amenities` json DEFAULT (_utf8mb4'[]'),
  `basePrice` decimal(10,2) NOT NULL DEFAULT '0.00',
  `currency` varchar(8) NOT NULL DEFAULT 'EUR',
  `totalUnits` int NOT NULL DEFAULT '1',
  `internalTags` json DEFAULT (_utf8mb4'[]'),
  `discountPercent` decimal(5,2) DEFAULT NULL,
  `discountLabel` varchar(128) DEFAULT NULL,
  `discountExpiresAt` timestamp NULL DEFAULT NULL,
  `fiscalRegime` enum('reav','general','mixed') NOT NULL DEFAULT 'general',
  `productType` enum('own','semi_own','third_party','actividad','alojamiento','restauracion','transporte','pack') NOT NULL DEFAULT 'alojamiento',
  `providerPercent` decimal(5,2) DEFAULT '0.00',
  `agencyMarginPercent` decimal(5,2) DEFAULT '0.00',
  `supplierId` int DEFAULT NULL,
  `supplierCommissionPercent` decimal(5,2) DEFAULT '0.00',
  `supplierCostType` enum('comision_sobre_venta','coste_fijo','porcentaje_margen','hibrido') DEFAULT 'comision_sobre_venta',
  `settlementFrequency` enum('semanal','quincenal','mensual','manual') DEFAULT 'manual',
  `isSettlable` tinyint(1) NOT NULL DEFAULT '0',
  `isFeatured` tinyint(1) NOT NULL DEFAULT '0',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `isPresentialSale` tinyint(1) NOT NULL DEFAULT '0',
  `sortOrder` int NOT NULL DEFAULT '0',
  `metaTitle` varchar(256) DEFAULT NULL,
  `metaDescription` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `taxRate` decimal(5,2) NOT NULL DEFAULT '21.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `room_types_slug_unique` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `settlement_documents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `settlementId` int NOT NULL,
  `docType` enum('factura_recibida','contrato','justificante_pago','email','acuerdo_comision','otro') NOT NULL DEFAULT 'otro',
  `title` varchar(256) NOT NULL,
  `fileUrl` text,
  `fileKey` text,
  `notes` text,
  `uploadedBy` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `settlement_lines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `settlementId` int NOT NULL,
  `reservationId` int DEFAULT NULL,
  `invoiceId` int DEFAULT NULL,
  `productId` int DEFAULT NULL,
  `productName` varchar(256) DEFAULT NULL,
  `serviceDate` varchar(10) DEFAULT NULL,
  `paxCount` int NOT NULL DEFAULT '1',
  `saleAmount` decimal(12,2) NOT NULL,
  `commissionPercent` decimal(5,2) NOT NULL,
  `commissionAmount` decimal(12,2) NOT NULL,
  `netAmountProvider` decimal(12,2) NOT NULL,
  `costType` enum('comision_sobre_venta','coste_fijo','porcentaje_margen','hibrido') NOT NULL DEFAULT 'comision_sobre_venta',
  `notes` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `settlement_status_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `settlementId` int NOT NULL,
  `fromStatus` varchar(64) DEFAULT NULL,
  `toStatus` varchar(64) NOT NULL,
  `changedBy` int DEFAULT NULL,
  `changedByName` varchar(256) DEFAULT NULL,
  `notes` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `site_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `key` varchar(128) NOT NULL,
  `value` text,
  `type` enum('text','json','image','boolean') NOT NULL DEFAULT 'text',
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `site_settings_key_unique` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `slideshow_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `imageUrl` text NOT NULL,
  `badge` varchar(128) DEFAULT NULL,
  `title` varchar(256) DEFAULT NULL,
  `subtitle` text,
  `description` text,
  `ctaText` varchar(128) DEFAULT NULL,
  `ctaUrl` varchar(512) DEFAULT NULL,
  `reserveUrl` varchar(512) DEFAULT NULL,
  `sortOrder` int NOT NULL DEFAULT '0',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `spa_categories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(128) NOT NULL,
  `name` varchar(128) NOT NULL,
  `description` text,
  `iconName` varchar(64) DEFAULT NULL,
  `sortOrder` int NOT NULL DEFAULT '0',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `spa_categories_slug_unique` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `spa_resources` (
  `id` int NOT NULL AUTO_INCREMENT,
  `type` enum('cabina','terapeuta') NOT NULL,
  `name` varchar(128) NOT NULL,
  `description` text,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `sortOrder` int NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `spa_schedule_templates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `treatmentId` int NOT NULL,
  `resourceId` int DEFAULT NULL,
  `dayOfWeek` int NOT NULL,
  `startTime` varchar(5) NOT NULL,
  `endTime` varchar(5) NOT NULL,
  `capacity` int NOT NULL DEFAULT '1',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `slotIntervalMinutes` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `spa_slots` (
  `id` int NOT NULL AUTO_INCREMENT,
  `treatmentId` int NOT NULL,
  `resourceId` int DEFAULT NULL,
  `date` varchar(10) NOT NULL,
  `startTime` varchar(5) NOT NULL,
  `endTime` varchar(5) NOT NULL,
  `capacity` int NOT NULL DEFAULT '1',
  `bookedCount` int NOT NULL DEFAULT '0',
  `status` enum('disponible','reservado','bloqueado') NOT NULL DEFAULT 'disponible',
  `notes` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `spa_treatments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(256) NOT NULL,
  `name` varchar(256) NOT NULL,
  `categoryId` int DEFAULT NULL,
  `shortDescription` text,
  `description` text,
  `benefits` json DEFAULT (_utf8mb4'[]'),
  `coverImageUrl` text,
  `image1` text,
  `image2` text,
  `gallery` json DEFAULT (_utf8mb4'[]'),
  `durationMinutes` int NOT NULL DEFAULT '60',
  `price` decimal(10,2) NOT NULL DEFAULT '0.00',
  `currency` varchar(8) NOT NULL DEFAULT 'EUR',
  `maxPersons` int NOT NULL DEFAULT '1',
  `cabinRequired` tinyint(1) NOT NULL DEFAULT '1',
  `discountPercent` decimal(5,2) DEFAULT NULL,
  `discountLabel` varchar(128) DEFAULT NULL,
  `discountExpiresAt` timestamp NULL DEFAULT NULL,
  `fiscalRegime` enum('reav','general','mixed') NOT NULL DEFAULT 'general',
  `productType` enum('own','semi_own','third_party','actividad','alojamiento','restauracion','transporte','pack') NOT NULL DEFAULT 'actividad',
  `providerPercent` decimal(5,2) DEFAULT '0.00',
  `agencyMarginPercent` decimal(5,2) DEFAULT '0.00',
  `supplierId` int DEFAULT NULL,
  `supplierCommissionPercent` decimal(5,2) DEFAULT '0.00',
  `supplierCostType` enum('comision_sobre_venta','coste_fijo','porcentaje_margen','hibrido') DEFAULT 'comision_sobre_venta',
  `settlementFrequency` enum('semanal','quincenal','mensual','manual') DEFAULT 'manual',
  `isSettlable` tinyint(1) NOT NULL DEFAULT '0',
  `isFeatured` tinyint(1) NOT NULL DEFAULT '0',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `isPresentialSale` tinyint(1) NOT NULL DEFAULT '0',
  `sortOrder` int NOT NULL DEFAULT '0',
  `metaTitle` varchar(256) DEFAULT NULL,
  `metaDescription` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `taxRate` decimal(5,2) NOT NULL DEFAULT '21.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `spa_treatments_slug_unique` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `static_pages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(256) NOT NULL,
  `title` varchar(256) NOT NULL,
  `content` text,
  `metaTitle` varchar(256) DEFAULT NULL,
  `metaDescription` text,
  `isPublished` tinyint(1) NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `static_pages_slug_unique` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `supplier_settlements` (
  `id` int NOT NULL AUTO_INCREMENT,
  `settlementNumber` varchar(64) NOT NULL,
  `supplierId` int NOT NULL,
  `periodFrom` varchar(10) NOT NULL,
  `periodTo` varchar(10) NOT NULL,
  `grossAmount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `commissionAmount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `netAmountProvider` decimal(12,2) NOT NULL DEFAULT '0.00',
  `currency` varchar(8) NOT NULL DEFAULT 'EUR',
  `status` enum('borrador','emitida','pendiente_abono','abonada','incidencia','recalculada') NOT NULL DEFAULT 'emitida',
  `pdfUrl` text,
  `pdfKey` text,
  `sentAt` timestamp NULL DEFAULT NULL,
  `paidAt` timestamp NULL DEFAULT NULL,
  `internalNotes` text,
  `createdBy` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `supplier_settlements_settlementNumber_unique` (`settlementNumber`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `suppliers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `fiscalName` varchar(256) NOT NULL,
  `commercialName` varchar(256) DEFAULT NULL,
  `nif` varchar(32) DEFAULT NULL,
  `fiscalAddress` text,
  `adminEmail` varchar(320) DEFAULT NULL,
  `phone` varchar(32) DEFAULT NULL,
  `contactPerson` varchar(256) DEFAULT NULL,
  `iban` varchar(64) DEFAULT NULL,
  `paymentMethod` enum('transferencia','confirming','efectivo','compensacion') NOT NULL DEFAULT 'transferencia',
  `standardCommissionPercent` decimal(5,2) DEFAULT '0.00',
  `settlementFrequency` enum('quincenal','mensual','trimestral','semestral','anual','manual') NOT NULL DEFAULT 'manual',
  `settlementDayOfMonth` int DEFAULT '1',
  `autoGenerateSettlements` tinyint(1) NOT NULL DEFAULT '0',
  `internalNotes` text,
  `status` enum('activo','inactivo','bloqueado') NOT NULL DEFAULT 'activo',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `system_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `key` varchar(128) NOT NULL,
  `value` text,
  `value_type` enum('string','number','boolean','json') NOT NULL DEFAULT 'string',
  `category` varchar(64) NOT NULL DEFAULT 'general',
  `label` varchar(256) NOT NULL,
  `description` text,
  `is_sensitive` tinyint(1) NOT NULL DEFAULT '0',
  `is_public` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `system_settings_key_unique` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tax_deferral_installments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `deferral_id` int NOT NULL,
  `number` int NOT NULL,
  `due_date` varchar(10) NOT NULL,
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `interest` decimal(12,2) NOT NULL DEFAULT '0.00',
  `paid_at` varchar(10) DEFAULT NULL,
  `status` enum('pendiente','pagada') NOT NULL DEFAULT 'pendiente',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tax_deferrals` (
  `id` int NOT NULL AUTO_INCREMENT,
  `obligation_id` int NOT NULL,
  `status` enum('solicitado','concedido','denegado','fraccionado') NOT NULL DEFAULT 'solicitado',
  `requested_at` varchar(10) DEFAULT NULL,
  `resolution_at` varchar(10) DEFAULT NULL,
  `principal` decimal(12,2) NOT NULL DEFAULT '0.00',
  `interest_rate` decimal(5,2) DEFAULT NULL,
  `installment_count` int NOT NULL DEFAULT '1',
  `notes` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tax_documents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `obligation_id` int NOT NULL,
  `doc_type` enum('modelo_presentado','justificante_pago','resolucion','otro') NOT NULL DEFAULT 'otro',
  `title` varchar(256) NOT NULL,
  `file_url` text NOT NULL,
  `file_key` varchar(512) DEFAULT NULL,
  `uploaded_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tax_dossiers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `year` int NOT NULL,
  `scope` enum('iva','laboral','sociedades','global') NOT NULL DEFAULT 'global',
  `period_key` varchar(16) NOT NULL,
  `title` varchar(160) NOT NULL,
  `file_url` text,
  `file_key` varchar(512) DEFAULT NULL,
  `file_size` int DEFAULT NULL,
  `file_count` int DEFAULT NULL,
  `generated_by` int DEFAULT NULL,
  `sent_to_gestoria_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tax_obligation_lines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `obligation_id` int NOT NULL,
  `concept` varchar(256) NOT NULL,
  `base` decimal(12,2) NOT NULL DEFAULT '0.00',
  `rate` decimal(5,2) DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `source_type` varchar(32) DEFAULT NULL,
  `source_ref` varchar(64) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tax_obligation_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `obligation_id` int NOT NULL,
  `from_status` varchar(32) DEFAULT NULL,
  `to_status` varchar(32) NOT NULL,
  `user_id` int DEFAULT NULL,
  `user_name` varchar(128) DEFAULT NULL,
  `note` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tax_obligations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `model` enum('303','390','111','190','200','202') NOT NULL,
  `year` int NOT NULL,
  `period_type` enum('trimestral','anual','mensual') NOT NULL,
  `period_key` varchar(16) NOT NULL,
  `period_label` varchar(96) NOT NULL,
  `due_date` varchar(10) NOT NULL,
  `estimated_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `presented_amount` decimal(12,2) DEFAULT NULL,
  `paid_amount` decimal(12,2) DEFAULT NULL,
  `status` enum('pendiente','estimado','revisado','enviado_gestoria','presentado','pagado','aplazado','cerrado') NOT NULL DEFAULT 'pendiente',
  `deferral_id` int DEFAULT NULL,
  `presented_at` timestamp NULL DEFAULT NULL,
  `paid_at` timestamp NULL DEFAULT NULL,
  `notes` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `last_reminder_days` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tax_obligation_model_period` (`model`,`period_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tax_settings` (
  `id` int NOT NULL DEFAULT '1',
  `corporate_tax_rate` decimal(5,2) NOT NULL DEFAULT '25.00',
  `fiscal_year_end_month` int NOT NULL DEFAULT '12',
  `company_nif` varchar(32) DEFAULT NULL,
  `company_name` varchar(256) DEFAULT NULL,
  `company_address` text,
  `gestoria_emails` text,
  `iae_epigraphs` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `ticketing_products` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(256) NOT NULL,
  `provider` varchar(64) NOT NULL DEFAULT 'Groupon',
  `linkedProductId` int DEFAULT NULL,
  `stationsAllowed` json DEFAULT NULL,
  `rules` text,
  `commission` decimal(5,2) DEFAULT '20.00',
  `expectedPrice` decimal(10,2) DEFAULT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tpv_file_imports` (
  `id` int NOT NULL AUTO_INCREMENT,
  `file_name` varchar(255) NOT NULL,
  `file_type` varchar(16) NOT NULL,
  `imported_rows` int NOT NULL DEFAULT '0',
  `duplicates_skipped` int NOT NULL DEFAULT '0',
  `status` enum('ok','error') NOT NULL DEFAULT 'ok',
  `error_message` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tpv_sale_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `saleId` int NOT NULL,
  `productType_tsi` enum('experience','pack','spa','hotel','restaurant','extra','legoPack') NOT NULL,
  `productId` int NOT NULL,
  `productName` varchar(300) NOT NULL,
  `quantity` int NOT NULL DEFAULT '1',
  `unitPrice` decimal(10,2) NOT NULL,
  `discountPercent_tsi` decimal(5,2) DEFAULT '0.00',
  `subtotal_tsi` decimal(10,2) NOT NULL,
  `eventDate` varchar(10) DEFAULT NULL,
  `eventTime` varchar(10) DEFAULT NULL,
  `participants` int DEFAULT '1',
  `notes_tsi` varchar(500) DEFAULT NULL,
  `fiscalRegime_tsi` enum('reav','general','mixed') DEFAULT 'general',
  `taxBase_tsi` decimal(10,2) DEFAULT '0.00',
  `taxAmount_tsi` decimal(10,2) DEFAULT '0.00',
  `taxRate_tsi` decimal(5,2) DEFAULT '21.00',
  `reavCost_tsi` decimal(10,2) DEFAULT '0.00',
  `reavMargin_tsi` decimal(10,2) DEFAULT '0.00',
  `reavTax_tsi` decimal(10,2) DEFAULT '0.00',
  `is_manual` tinyint(1) NOT NULL DEFAULT '0',
  `concept_text` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tpv_sale_payments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `saleId` int NOT NULL,
  `payerName` varchar(200) DEFAULT NULL,
  `method_tsp` enum('cash','card','bizum','other') NOT NULL,
  `amount_tsp` decimal(10,2) NOT NULL,
  `amountTendered` decimal(10,2) DEFAULT NULL,
  `changeGiven` decimal(10,2) DEFAULT '0.00',
  `status_tsp` enum('pending','completed','failed','refunded') NOT NULL DEFAULT 'pending',
  `reference` varchar(200) DEFAULT NULL,
  `createdAt` bigint NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tpv_sales` (
  `id` int NOT NULL AUTO_INCREMENT,
  `ticketNumber` varchar(50) NOT NULL,
  `sessionId` int NOT NULL,
  `reservationId` int DEFAULT NULL,
  `invoiceId` int DEFAULT NULL,
  `customerName` varchar(200) DEFAULT NULL,
  `customerEmail` varchar(200) DEFAULT NULL,
  `customerPhone` varchar(50) DEFAULT NULL,
  `subtotal` decimal(10,2) NOT NULL DEFAULT '0.00',
  `discountAmount` decimal(10,2) DEFAULT '0.00',
  `discountReason` varchar(200) DEFAULT NULL,
  `total` decimal(10,2) NOT NULL DEFAULT '0.00',
  `status_ts` enum('pending','paid','cancelled','refunded') NOT NULL DEFAULT 'pending',
  `notes` text,
  `serviceDate` varchar(10) DEFAULT NULL,
  `createdAt` bigint NOT NULL,
  `paidAt` bigint DEFAULT NULL,
  `taxBase` decimal(10,2) DEFAULT '0.00',
  `taxAmount` decimal(10,2) DEFAULT '0.00',
  `taxRate` decimal(5,2) DEFAULT '21.00',
  `reavMargin` decimal(10,2) DEFAULT '0.00',
  `reavCost` decimal(10,2) DEFAULT '0.00',
  `reavTax` decimal(10,2) DEFAULT '0.00',
  `fiscalSummary` varchar(20) DEFAULT 'mixed',
  `saleChannel` varchar(20) DEFAULT 'tpv',
  `sellerUserId` int DEFAULT NULL,
  `sellerName` varchar(200) DEFAULT NULL,
  `operativeCenter` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tpv_sales_ticketNumber_unique` (`ticketNumber`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `transactions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `transactionNumber` varchar(32) NOT NULL,
  `bookingId` int DEFAULT NULL,
  `quoteId` int DEFAULT NULL,
  `type` enum('ingreso','reembolso','comision','gasto') NOT NULL DEFAULT 'ingreso',
  `amount` decimal(10,2) NOT NULL,
  `currency` varchar(8) NOT NULL DEFAULT 'EUR',
  `paymentMethod` enum('tarjeta','transferencia','efectivo','link_pago','otro','tarjeta_fisica','tarjeta_redsys') DEFAULT 'tarjeta',
  `status` enum('pendiente','completado','fallido','reembolsado') NOT NULL DEFAULT 'pendiente',
  `description` text,
  `externalRef` varchar(256) DEFAULT NULL,
  `processedAt` timestamp NULL DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `clientName` varchar(200) DEFAULT NULL,
  `clientEmail` varchar(200) DEFAULT NULL,
  `clientPhone` varchar(50) DEFAULT NULL,
  `productName` varchar(300) DEFAULT NULL,
  `operativeCenter` varchar(100) DEFAULT NULL,
  `sellerUserId` int DEFAULT NULL,
  `sellerName` varchar(200) DEFAULT NULL,
  `saleChannel` enum('tpv','online','crm','admin','delegado') DEFAULT 'admin',
  `taxBase` decimal(10,2) DEFAULT '0.00',
  `taxAmount` decimal(10,2) DEFAULT '0.00',
  `reavMargin` decimal(10,2) DEFAULT '0.00',
  `fiscalRegime_tx` enum('reav','general','mixed') DEFAULT 'general',
  `tpvSaleId` int DEFAULT NULL,
  `reservationId_tx` int DEFAULT NULL,
  `invoiceNumber` varchar(32) DEFAULT NULL,
  `reservationRef` varchar(32) DEFAULT NULL,
  `operationStatus` enum('confirmada','anulada','reembolsada') DEFAULT 'confirmada',
  `taxRate_tx` decimal(5,2) DEFAULT '21.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `transactions_transactionNumber_unique` (`transactionNumber`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `openId` varchar(64) NOT NULL,
  `name` text,
  `email` varchar(320) DEFAULT NULL,
  `loginMethod` varchar(64) DEFAULT NULL,
  `role` enum('user','admin','monitor','agente','adminrest','controler','partner_admin','partner_user','supplier','employee','gestoria') NOT NULL DEFAULT 'user',
  `phone` varchar(32) DEFAULT NULL,
  `avatarUrl` text,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `passwordHash` text,
  `inviteToken` varchar(128) DEFAULT NULL,
  `inviteTokenExpiry` timestamp NULL DEFAULT NULL,
  `inviteAccepted` tinyint(1) NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `lastSignedIn` timestamp NOT NULL DEFAULT (now()),
  `partnerId` int DEFAULT NULL,
  `supplierId` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_openId_unique` (`openId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `vapi_calls` (
  `id` int NOT NULL AUTO_INCREMENT,
  `vapiCallId` varchar(128) NOT NULL,
  `assistantId` varchar(128) DEFAULT NULL,
  `phoneNumber` varchar(32) DEFAULT NULL,
  `customerName` varchar(255) DEFAULT NULL,
  `customerEmail` varchar(320) DEFAULT NULL,
  `startedAt` timestamp NULL DEFAULT NULL,
  `endedAt` timestamp NULL DEFAULT NULL,
  `durationSeconds` int DEFAULT NULL,
  `status` varchar(64) DEFAULT NULL,
  `endedReason` varchar(128) DEFAULT NULL,
  `recordingUrl` text,
  `transcript` mediumtext,
  `summary` text,
  `structuredData` json DEFAULT NULL,
  `rawPayload` json DEFAULT NULL,
  `linkedLeadId` int DEFAULT NULL,
  `linkedBudgetId` int DEFAULT NULL,
  `linkedReservationId` int DEFAULT NULL,
  `reviewed` tinyint(1) NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vapi_call_id` (`vapiCallId`),
  KEY `idx_vapi_call_startedAt` (`startedAt`),
  KEY `idx_vapi_call_status` (`status`),
  KEY `idx_vapi_call_reviewed` (`reviewed`),
  KEY `idx_vapi_call_leadId` (`linkedLeadId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET FOREIGN_KEY_CHECKS = 1;
