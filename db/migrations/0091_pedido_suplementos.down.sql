-- Reversión de 0091 sin perder datos: las dos tablas se RENOMBRAN (conservan lo registrado, para revisarlo y retirarlo a mano si procede).
RENAME TABLE order_supplement_lines TO retired_order_supplement_lines, supplement_variant_scope TO retired_supplement_variant_scope;
