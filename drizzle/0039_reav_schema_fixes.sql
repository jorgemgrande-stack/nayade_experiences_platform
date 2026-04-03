-- P1: Vincular reservas con expedientes REAV (campo faltante que causaba error en Redsys IPN)
ALTER TABLE `reservations` ADD `reav_expedient_id` int;--> statement-breakpoint
-- P2: Indicar si el coste del proveedor incluye IVA (afecta al cálculo del margen real)
ALTER TABLE `reav_costs` ADD `includes_vat` boolean NOT NULL DEFAULT true;
