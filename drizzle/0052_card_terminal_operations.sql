CREATE TABLE `card_terminal_operations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `operation_datetime` timestamp NOT NULL,
  `operation_number` varchar(64) NOT NULL,
  `commerce_code` varchar(64),
  `terminal_code` varchar(64),
  `operation_type` enum('VENTA','DEVOLUCION','ANULACION','OTRO') NOT NULL DEFAULT 'VENTA',
  `amount` decimal(12,2) NOT NULL,
  `card` varchar(32),
  `authorization_code` varchar(32),
  `linked_entity_type` enum('reservation','quote','none') DEFAULT 'none',
  `linked_entity_id` int,
  `linked_at` timestamp,
  `linked_by` varchar(128),
  `status` enum('pendiente','conciliado','incidencia','ignorado') NOT NULL DEFAULT 'pendiente',
  `incident_reason` text,
  `notes` text,
  `import_id` int,
  `duplicate_key` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `card_terminal_operations_duplicate_key_unique` (`duplicate_key`)
);

CREATE TABLE `tpv_file_imports` (
  `id` int NOT NULL AUTO_INCREMENT,
  `file_name` varchar(255) NOT NULL,
  `file_type` varchar(16) NOT NULL,
  `imported_rows` int NOT NULL DEFAULT 0,
  `duplicates_skipped` int NOT NULL DEFAULT 0,
  `status` enum('ok','error') NOT NULL DEFAULT 'ok',
  `error_message` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
