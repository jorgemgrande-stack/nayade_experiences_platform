-- P2 REAV: Indicar si el coste del proveedor incluye IVA
ALTER TABLE `reav_costs` ADD `includes_vat` boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- P1 REAV: Vincular reservas con expedientes REAV
ALTER TABLE `reservations` ADD `reav_expedient_id` int;--> statement-breakpoint
-- Número de referencia interna para reservas (RES-2026-XXXX)
ALTER TABLE `reservations` ADD `reservation_number` varchar(32);--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_reservation_number_unique` ON `reservations` (`reservation_number`);
