-- Reversión de 0011_data_exports: se pierde el registro de exportaciones (quién, cuándo, enlaces y descargas).
-- Los ZIP generados siguen en el almacenamiento (categoría data-export); no se borra ningún fichero.
DROP TABLE IF EXISTS data_exports;
