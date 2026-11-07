-- Reversión de 0040_travel_net: se pierden los expedientes de viaje, sus servicios, las reglas de margen, los perfiles
-- y contactos turísticos de los proveedores y las operaciones con ellos. Los proveedores (`suppliers`), presupuestos,
-- reservas y facturas del Core se conservan. Antes, desplegar el código anterior a este cambio.
DROP TABLE IF EXISTS travel_audit_log;
DROP TABLE IF EXISTS travel_operation_status_log;
DROP TABLE IF EXISTS travel_operations;
DROP TABLE IF EXISTS travel_supplier_contacts;
DROP TABLE IF EXISTS travel_supplier_profiles;
DROP TABLE IF EXISTS travel_margin_rules;
DROP TABLE IF EXISTS travel_file_services;
DROP TABLE IF EXISTS travel_files;
