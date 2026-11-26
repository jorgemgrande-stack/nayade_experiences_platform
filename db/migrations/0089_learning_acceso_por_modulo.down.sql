-- Reversión de 0089_learning_acceso_por_modulo.sql: quita solo lo añadido (las matrículas vuelven a tener una única ventana).
DROP TABLE IF EXISTS learning_module_extensions;
ALTER TABLE learning_access_rules DROP COLUMN permanent;
ALTER TABLE learning_access_rule_modules DROP COLUMN duration_days;
ALTER TABLE learning_access_rule_modules DROP COLUMN unlock_offset_days;
ALTER TABLE learning_enrollment_modules DROP COLUMN ends_at;
ALTER TABLE learning_enrollment_modules DROP COLUMN starts_at;
