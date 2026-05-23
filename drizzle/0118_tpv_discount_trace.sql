-- Trazabilidad del descuento TPV en reservas y facturas.
--
-- Hasta ahora el descuento aplicado en TPV se guardaba SOLO en `tpv_sales`
-- (discount_amount + discount_reason). Al generar la reserva y la factura
-- a partir de la venta, el descuento no se propagaba: el cliente veía un
-- subtotal y un total incoherentes (50€ → 44€) sin línea explicativa.
--
-- Añadimos columnas idénticas a `reservations` y `invoices` para que el
-- desglose viaje con el documento contable y se pueda mostrar en CRM,
-- ficha de cliente, PDF de factura y plantilla de email.
--
-- Migración idempotente: ver scripts/apply-tpv-discount-trace.cjs

ALTER TABLE `reservations`
  ADD COLUMN `discount_amount` DECIMAL(10,2) NOT NULL DEFAULT '0.00',
  ADD COLUMN `discount_reason` VARCHAR(255) NULL;

ALTER TABLE `invoices`
  ADD COLUMN `discount` DECIMAL(10,2) NOT NULL DEFAULT '0.00',
  ADD COLUMN `discount_reason` VARCHAR(255) NULL;
