-- Reversión de 0034_hotel_folio: se pierden los folios de estancia (cargos y pagos registrados), los cierres del día y
-- los ajustes del PMS. Las facturas ya emitidas desde un folio se conservan en `invoices`. Antes, desplegar el código
-- anterior a este cambio.
DROP TABLE IF EXISTS hotel_night_audit;
DROP TABLE IF EXISTS hotel_folio_items;
DROP TABLE IF EXISTS hotel_folios;
DROP TABLE IF EXISTS hotel_pms_settings;
