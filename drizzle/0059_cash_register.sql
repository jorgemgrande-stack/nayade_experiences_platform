CREATE TABLE `fin_cash_accounts` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(128) NOT NULL,
  `description` text,
  `type` enum('principal','secondary','petty_cash','other') NOT NULL DEFAULT 'principal',
  `current_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `initial_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `currency` varchar(8) NOT NULL DEFAULT 'EUR',
  `is_active` boolean NOT NULL DEFAULT true,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fin_cash_accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fin_cash_movements` (
  `id` int AUTO_INCREMENT NOT NULL,
  `account_id` int NOT NULL,
  `date` varchar(10) NOT NULL,
  `type_fcm` enum('income','expense','transfer_in','transfer_out','opening_balance','adjustment') NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `concept` varchar(512) NOT NULL,
  `counterparty` varchar(256),
  `category` varchar(128),
  `related_entity_type` enum('reservation','expense','tpv_sale','bank_deposit','manual') DEFAULT 'manual',
  `related_entity_id` int,
  `transfer_to_account_id` int,
  `notes` text,
  `created_by` int,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `fin_cash_movements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fin_cash_closures` (
  `id` int AUTO_INCREMENT NOT NULL,
  `account_id` int NOT NULL,
  `date` varchar(10) NOT NULL,
  `opening_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_income` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_expenses` decimal(12,2) NOT NULL DEFAULT '0.00',
  `closing_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `counted_amount` decimal(12,2),
  `difference` decimal(12,2),
  `status_fcc` enum('open','closed','reconciled') NOT NULL DEFAULT 'open',
  `notes` text,
  `closed_by` int,
  `closed_at` timestamp,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `fin_cash_closures_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
INSERT INTO `fin_cash_accounts` (`name`, `description`, `type`, `current_balance`, `initial_balance`, `currency`, `is_active`) VALUES ('Caja principal', 'Caja física principal del establecimiento', 'principal', '0.00', '0.00', 'EUR', true);
