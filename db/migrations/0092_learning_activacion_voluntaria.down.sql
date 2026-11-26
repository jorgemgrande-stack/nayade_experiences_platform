-- Reversión de 0092: se quitan solo las columnas añadidas (las matrículas pendientes de activar pasan a ser normales sin ventana).
ALTER TABLE learning_enrollments DROP COLUMN activated_at;
ALTER TABLE learning_enrollments DROP COLUMN pending_activation_days;
ALTER TABLE learning_access_rules DROP COLUMN activation_required;
