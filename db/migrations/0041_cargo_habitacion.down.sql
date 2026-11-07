-- Reversión de 0041_cargo_habitacion: se pierde la trazabilidad de los cargos de otros módulos al folio (las líneas del
-- folio se conservan como cargos normales). Antes, desplegar el código anterior a este cambio.
DROP TABLE IF EXISTS hotel_folio_external_charges;
