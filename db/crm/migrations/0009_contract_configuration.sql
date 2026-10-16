-- Big Elephant — contratos con la configuración cotizada del catálogo de Elephant Source (aditiva).
-- Guarda la petición (plan, periodicidad, productos, cantidades) y el resultado del cotizador que
-- calculó el SERVIDOR al guardar (líneas, totales, capacidades, contratabilidad). Forma parte de las
-- versiones inmutables del contrato. Nunca se ejecuta al arrancar.

ALTER TABLE crm_contracts ADD COLUMN configuration JSON NULL;
