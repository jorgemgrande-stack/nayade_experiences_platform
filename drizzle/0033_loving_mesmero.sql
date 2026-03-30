ALTER TABLE `reservations` MODIFY COLUMN `channel` enum('ONLINE_DIRECTO','ONLINE_ASISTIDO','VENTA_DELEGADA','TPV_FISICO','PARTNER','MANUAL','API','web','crm','telefono','email','otro','tpv','groupon') DEFAULT 'ONLINE_DIRECTO';--> statement-breakpoint
ALTER TABLE `reservations` ADD `channel_detail` varchar(128);--> statement-breakpoint
ALTER TABLE `reservations` ADD `status_reservation` enum('PENDIENTE_CONFIRMACION','CONFIRMADA','EN_CURSO','FINALIZADA','NO_SHOW','ANULADA') DEFAULT 'PENDIENTE_CONFIRMACION';--> statement-breakpoint
ALTER TABLE `reservations` ADD `status_payment` enum('PENDIENTE','PAGO_PARCIAL','PENDIENTE_VALIDACION','PAGADO') DEFAULT 'PENDIENTE';--> statement-breakpoint
ALTER TABLE `reservations` ADD `date_changed_reason` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD `date_modified` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `reservations` ADD `changes_log` json DEFAULT ('[]');