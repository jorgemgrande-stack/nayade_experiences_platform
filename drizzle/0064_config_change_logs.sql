CREATE TABLE `config_change_logs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `entity_type` enum('feature_flag','system_setting') NOT NULL,
  `key` varchar(128) NOT NULL,
  `old_value` text,
  `new_value` text,
  `changed_by_id` int,
  `changed_by_name` varchar(128),
  `changed_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `config_change_logs_id` PRIMARY KEY(`id`),
  INDEX `idx_ccl_key` (`key`),
  INDEX `idx_ccl_changed_at` (`changed_at`)
);
